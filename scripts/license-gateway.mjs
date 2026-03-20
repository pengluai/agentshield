#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const port = Number(process.env.LICENSE_GATEWAY_PORT ?? 8787);
const dataFilePath = resolvePath(
  process.env.LICENSE_GATEWAY_DATA_PATH,
  path.join(repoRoot, 'data', 'license-gateway.json'),
);
const webhookSecret = process.env.CREEM_WEBHOOK_SECRET ?? '';
const adminUsername = process.env.LICENSE_GATEWAY_ADMIN_USERNAME ?? 'admin';
const adminPassword = process.env.LICENSE_GATEWAY_ADMIN_PASSWORD ?? '';

const signerSeed =
  process.env.AGENTSHIELD_LICENSE_SIGNING_SEED ??
  process.env.LICENSE_SIGNING_SEED ??
  '';
const issuerBinPath = process.env.AGENTSHIELD_LICENSE_ISSUER_BIN;
const resendApiKey = process.env.RESEND_API_KEY ?? '';
const deliveryFromEmail = process.env.LICENSE_DELIVERY_FROM_EMAIL ?? '';
const deliveryReplyTo = process.env.LICENSE_DELIVERY_REPLY_TO ?? '';
const strictBillingResolution =
  (process.env.CREEM_STRICT_BILLING_RESOLUTION ?? '1').trim() !== '0';

const defaultSkuBillingMap = new Map([
  ['AGSH_PRO_30D', 'monthly'],
  ['AGSH_PRO_365D', 'yearly'],
  ['AGSH_PRO_LIFETIME', 'lifetime'],
]);
const skuBillingMap = loadBillingMapFromJsonEnv(
  process.env.CREEM_SKU_BILLING_MAP_JSON,
  'CREEM_SKU_BILLING_MAP_JSON',
  defaultSkuBillingMap,
);
const productBillingMap = loadBillingMapFromJsonEnv(
  process.env.CREEM_PRODUCT_BILLING_MAP_JSON,
  'CREEM_PRODUCT_BILLING_MAP_JSON',
);

const initialState = {
  orders: [],
  licenses: [],
  license_deliveries: [],
  audit_logs: [],
  webhook_failures: [],
  processed_webhook_events: [],
  affiliates: [],
  promo_codes: [],
  conversions: [],
  commission_events: [],
  payouts: [],
  metrics: {
    orders_created_total: 0,
    licenses_issued_total: 0,
    licenses_extended_total: 0,
    licenses_reissued_total: 0,
    licenses_revoked_total: 0,
    licenses_revoked_by_refund_total: 0,
    refund_events_total: 0,
    refund_events_without_order_total: 0,
    subscription_events_total: 0,
    subscription_events_without_license_total: 0,
    subscription_state_updates_total: 0,
    webhook_verify_failed_total: 0,
    webhook_duplicate_total: 0,
    delivery_email_failed_total: 0,
    conversions_total: 0,
    commissions_accrued_total: 0,
    commissions_reversed_total: 0,
    payouts_total: 0,
  },
};

const state = loadState();

if (!adminPassword.trim()) {
  console.warn(
    '[license-gateway] LICENSE_GATEWAY_ADMIN_PASSWORD is empty; admin APIs remain disabled.',
  );
}

if (!signerSeed.trim()) {
  console.warn(
    '[license-gateway] AGENTSHIELD_LICENSE_SIGNING_SEED is empty; issue/reissue/resend endpoints will fail.',
  );
}

if (!webhookSecret.trim()) {
  console.warn(
    '[license-gateway] CREEM_WEBHOOK_SECRET is empty; webhook verification will fail until configured.',
  );
}

if (strictBillingResolution && skuBillingMap.size === 0) {
  console.warn(
    '[license-gateway] billing resolution is strict but CREEM_SKU_BILLING_MAP_JSON is empty; only built-in SKU defaults will work.',
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'license-gateway',
        now: new Date().toISOString(),
        data_path: dataFilePath,
        metrics: state.metrics,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/webhooks/creem') {
      await handleCreemWebhook(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/webhooks/lemonsqueezy') {
      sendJson(res, 410, {
        ok: false,
        error: 'Deprecated webhook endpoint. Use /webhooks/creem.',
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/client/licenses/verify') {
      await handleClientLicenseVerify(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/promos/validate') {
      const body = JSON.parse((await readRawBody(req)).toString('utf8'));
      const code = String(body?.code ?? '').trim().toUpperCase();
      if (!code) {
        sendJson(res, 200, { valid: false, message: 'Missing code' });
        return;
      }
      const promo = state.promo_codes.find((p) => p.code === code && p.active);
      if (!promo) {
        sendJson(res, 200, { valid: false, message: 'Invalid promo code' });
        return;
      }
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        sendJson(res, 200, { valid: false, message: 'Promo code expired' });
        return;
      }
      if (promo.max_uses > 0 && promo.times_used >= promo.max_uses) {
        sendJson(res, 200, { valid: false, message: 'Promo code fully redeemed' });
        return;
      }
      const affiliate = state.affiliates.find((a) => a.id === promo.affiliate_id);
      sendJson(res, 200, {
        valid: true,
        discount_pct: promo.discount_pct,
        affiliate_id: promo.affiliate_id,
        affiliate_name: affiliate?.name ?? null,
        message: `${promo.discount_pct}% discount applied`,
      });
      return;
    }

    if (!pathname.startsWith('/admin/')) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    if (!requireAdmin(req, res)) {
      return;
    }

    // Admin dashboard UI
    if (req.method === 'GET' && pathname === '/admin/dashboard') {
      const dashboardPath = path.join(scriptDir, 'admin-dashboard.html');
      try {
        const html = fs.readFileSync(dashboardPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        sendJson(res, 500, { error: 'Dashboard file not found' });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/licenses') {
      const email = requestUrl.searchParams.get('email');
      const status = requestUrl.searchParams.get('status');
      const licenseId = requestUrl.searchParams.get('license_id');
      const providerOrderId = requestUrl.searchParams.get('provider_order_id');
      const items = state.licenses.filter((license) => {
        if (email && license.customer_email !== email) {
          return false;
        }
        if (status && license.status !== status) {
          return false;
        }
        if (licenseId && license.license_id !== licenseId) {
          return false;
        }
        if (providerOrderId && license.provider_order_id !== providerOrderId) {
          return false;
        }
        return true;
      });

      sendJson(res, 200, { total: items.length, items });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/webhook-failures') {
      sendJson(res, 200, {
        total: state.webhook_failures.length,
        items: state.webhook_failures.slice(-100).reverse(),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/licenses/issue') {
      await handleAdminLicenseIssue(req, res);
      return;
    }

    const reissueMatch = pathname.match(/^\/admin\/licenses\/([^/]+)\/reissue$/);
    if (req.method === 'POST' && reissueMatch) {
      const targetLicenseId = decodeURIComponent(reissueMatch[1]);
      const target = state.licenses.find((license) => license.license_id === targetLicenseId);
      if (!target) {
        sendJson(res, 404, { error: 'License not found' });
        return;
      }
      if (target.status === 'revoked') {
        sendJson(res, 409, { error: 'License already revoked' });
        return;
      }

      const now = new Date().toISOString();
      const replacementLicenseId = createId('lic');
      const replacement = {
        id: createId('row'),
        license_id: replacementLicenseId,
        provider_order_id: target.provider_order_id,
        plan: target.plan,
        billing_cycle: target.billing_cycle,
        expires_at: target.expires_at,
        customer_email: target.customer_email,
        status: 'active',
        issued_code_hash: '',
        issued_at: now,
        revoked_at: null,
        replacement_for_license_id: target.license_id,
        notes: 'reissued',
        verify_count: 0,
        last_verified_at: null,
        last_verified_device: null,
      };

      const code = issueActivationCodeFromLicense(replacement);
      replacement.issued_code_hash = sha256Hex(code);

      target.status = 'replaced';
      target.revoked_at = now;
      target.notes = 'reissued_to:' + replacement.license_id;

      state.licenses.push(replacement);
      state.metrics.licenses_issued_total += 1;
      state.metrics.licenses_reissued_total += 1;

      recordDelivery(replacement.license_id, 'manual_resend', replacement.customer_email);
      const reissueEmailResult = await trySendActivationCodeEmail({
        license: replacement,
        activationCode: code,
      });

      addAuditLog({
        actor: actorFromRequest(req),
        action: 'license.reissue',
        target_type: 'license',
        target_id: target.license_id,
        payload: {
          replacement_license_id: replacement.license_id,
          provider_order_id: replacement.provider_order_id,
        },
      });

      saveState();
      sendJson(res, 200, {
        ok: true,
        old_license_id: target.license_id,
        replacement_license_id: replacement.license_id,
        activation_code: code,
        email_sent: reissueEmailResult.sent,
        email_error: reissueEmailResult.sent ? null : reissueEmailResult.reason,
      });
      return;
    }

    const revokeMatch = pathname.match(/^\/admin\/licenses\/([^/]+)\/revoke$/);
    if (req.method === 'POST' && revokeMatch) {
      const targetLicenseId = decodeURIComponent(revokeMatch[1]);
      const target = state.licenses.find((license) => license.license_id === targetLicenseId);
      if (!target) {
        sendJson(res, 404, { error: 'License not found' });
        return;
      }

      if (target.status !== 'revoked') {
        target.status = 'revoked';
        target.revoked_at = new Date().toISOString();
        state.metrics.licenses_revoked_total += 1;
      }

      addAuditLog({
        actor: actorFromRequest(req),
        action: 'license.revoke',
        target_type: 'license',
        target_id: target.license_id,
        payload: { provider_order_id: target.provider_order_id },
      });
      saveState();

      sendJson(res, 200, { ok: true, license: target });
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/affiliates') {
      const body = JSON.parse((await readRawBody(req)).toString('utf8'));
      const name = String(body?.name ?? '').trim();
      const email = String(body?.email ?? '').trim();
      const platform = String(body?.platform ?? '').trim();
      const commissionPct = Number(body?.commission_pct ?? 20);
      const discountPct = Number(body?.discount_pct ?? 30);
      const promoCodeStr = String(body?.promo_code ?? '').trim().toUpperCase();
      const payoutMethod = body?.payout_method ?? { type: 'wechat', account: '' };
      const notes = String(body?.notes ?? '').trim();

      if (!name || !promoCodeStr) {
        sendJson(res, 400, { error: 'name and promo_code are required' });
        return;
      }
      if (state.promo_codes.find((p) => p.code === promoCodeStr)) {
        sendJson(res, 409, { error: `Promo code ${promoCodeStr} already exists` });
        return;
      }

      const affiliateId = createId('aff');
      let creemDiscountId = null;

      // Try to create discount on Creem
      const creemApiKey = process.env.CREEM_API_KEY ?? '';
      const productIdsJson = process.env.CREEM_PRODUCT_IDS_JSON ?? '[]';
      let productIds = [];
      try { productIds = JSON.parse(productIdsJson); } catch {}

      if (creemApiKey) {
        try {
          const creemResp = await fetch('https://api.creem.io/v1/discounts', {
            method: 'POST',
            headers: { 'x-api-key': creemApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `Affiliate ${name} ${discountPct}off`,
              code: promoCodeStr,
              type: 'percentage',
              percentage: discountPct,
              duration: 'once',
              applies_to_products: productIds.length > 0 ? productIds : undefined,
              max_redemptions: Number(body?.max_uses ?? 10000),
              expiry_date: body?.expires_at ?? '2027-12-31T23:59:59Z',
            }),
          });
          const creemData = await creemResp.json();
          creemDiscountId = creemData?.id ?? null;
          if (!creemResp.ok) {
            console.warn('[license-gateway] Creem discount creation warning:', JSON.stringify(creemData));
          }
        } catch (err) {
          console.warn('[license-gateway] Creem discount API error:', String(err));
        }
      }

      const affiliate = {
        id: affiliateId,
        name,
        email,
        platform,
        commission_pct: commissionPct,
        status: 'active',
        payout_method: payoutMethod,
        promo_code: promoCodeStr,
        creem_discount_id: creemDiscountId,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.affiliates.push(affiliate);

      const promo = {
        code: promoCodeStr,
        affiliate_id: affiliateId,
        creem_discount_id: creemDiscountId,
        discount_pct: discountPct,
        max_uses: Number(body?.max_uses ?? 10000),
        times_used: 0,
        expires_at: body?.expires_at ?? '2027-12-31T23:59:59Z',
        active: true,
        created_at: new Date().toISOString(),
      };
      state.promo_codes.push(promo);

      addAuditLog({
        actor: actorFromRequest(req),
        action: 'affiliate.create',
        target_type: 'affiliate',
        target_id: affiliateId,
        payload: { name, promo_code: promoCodeStr, discount_pct: discountPct, commission_pct: commissionPct },
      });
      saveState();
      sendJson(res, 201, { ok: true, affiliate, promo, creem_discount_id: creemDiscountId });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/affiliates') {
      const result = state.affiliates.map((aff) => {
        const affConversions = state.conversions.filter((c) => c.affiliate_id === aff.id);
        const affEvents = state.commission_events.filter((e) => e.affiliate_id === aff.id);
        const totalRevenueCents = affConversions.reduce((s, c) => s + (c.paid_amount_cents || 0), 0);
        const totalAccruedCents = affEvents.filter((e) => e.event_type === 'accrue').reduce((s, e) => s + e.amount_cents, 0);
        const totalReversedCents = affEvents.filter((e) => e.event_type === 'reversal').reduce((s, e) => s + e.amount_cents, 0);
        const totalPaidCents = state.payouts
          .filter((p) => p.affiliate_id === aff.id && p.status === 'completed')
          .reduce((s, p) => s + p.amount_cents, 0);
        const pendingCents = totalAccruedCents + totalReversedCents - totalPaidCents;
        const promoRecord = state.promo_codes.find((p) => p.affiliate_id === aff.id);
        return {
          ...aff,
          stats: {
            total_conversions: affConversions.length,
            total_revenue_cents: totalRevenueCents,
            total_accrued_cents: totalAccruedCents,
            total_reversed_cents: totalReversedCents,
            total_paid_cents: totalPaidCents,
            pending_cents: pendingCents,
            promo_times_used: promoRecord?.times_used ?? 0,
          },
        };
      });
      sendJson(res, 200, { total: result.length, items: result });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/commissions') {
      sendJson(res, 200, {
        total_conversions: state.conversions.length,
        total_commission_events: state.commission_events.length,
        conversions: state.conversions.slice(-200).reverse(),
        recent_events: state.commission_events.slice(-100).reverse(),
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/commissions/export') {
      const rows = [['affiliate_name', 'email', 'platform', 'promo_code', 'conversions', 'revenue_cents', 'accrued_cents', 'reversed_cents', 'paid_cents', 'pending_cents', 'payout_method'].join(',')];
      for (const aff of state.affiliates) {
        const affConv = state.conversions.filter((c) => c.affiliate_id === aff.id);
        const affEvts = state.commission_events.filter((e) => e.affiliate_id === aff.id);
        const rev = affConv.reduce((s, c) => s + (c.paid_amount_cents || 0), 0);
        const acc = affEvts.filter((e) => e.event_type === 'accrue').reduce((s, e) => s + e.amount_cents, 0);
        const revd = affEvts.filter((e) => e.event_type === 'reversal').reduce((s, e) => s + e.amount_cents, 0);
        const paid = state.payouts.filter((p) => p.affiliate_id === aff.id && p.status === 'completed').reduce((s, p) => s + p.amount_cents, 0);
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        rows.push([esc(aff.name), esc(aff.email), esc(aff.platform), esc(aff.promo_code), affConv.length, rev, acc, revd, paid, acc + revd - paid, esc(aff.payout_method?.type ?? '')].join(','));
      }
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="commissions.csv"' });
      res.end(rows.join('\n'));
      return;
    }

    if (req.method === 'POST' && pathname === '/admin/payouts/mark-paid') {
      const body = JSON.parse((await readRawBody(req)).toString('utf8'));
      const affiliateId = String(body?.affiliate_id ?? '').trim();
      const amountCents = Number(body?.amount_cents ?? 0);
      const currency = String(body?.currency ?? 'USD').trim();
      const payoutNotes = String(body?.notes ?? '').trim();
      if (!affiliateId || !amountCents) {
        sendJson(res, 400, { error: 'affiliate_id and amount_cents required' });
        return;
      }
      const affiliate = state.affiliates.find((a) => a.id === affiliateId);
      if (!affiliate) {
        sendJson(res, 404, { error: 'Affiliate not found' });
        return;
      }
      const payoutId = createId('pay');
      const payout = {
        id: payoutId,
        affiliate_id: affiliateId,
        amount_cents: amountCents,
        currency,
        payout_method: affiliate.payout_method,
        status: 'completed',
        notes: payoutNotes,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };
      state.payouts.push(payout);
      state.commission_events.push({
        id: createId('ce'),
        conversion_id: null,
        affiliate_id: affiliateId,
        event_type: 'payout',
        amount_cents: -amountCents,
        currency,
        related_provider_event: null,
        notes: `payout marked: ${payoutNotes}`,
        created_at: new Date().toISOString(),
      });
      state.metrics.payouts_total += 1;
      addAuditLog({
        actor: actorFromRequest(req),
        action: 'payout.mark_paid',
        target_type: 'payout',
        target_id: payoutId,
        payload: { affiliate_id: affiliateId, amount_cents: amountCents },
      });
      saveState();
      sendJson(res, 200, { ok: true, payout });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/promo-codes') {
      sendJson(res, 200, { total: state.promo_codes.length, items: state.promo_codes });
      return;
    }

    const resendMatch = pathname.match(/^\/admin\/orders\/([^/]+)\/resend$/);
    if (req.method === 'POST' && resendMatch) {
      const providerOrderId = decodeURIComponent(resendMatch[1]);
      const activeLicense = state.licenses.find(
        (license) =>
          license.provider_order_id === providerOrderId && license.status === 'active',
      );
      if (!activeLicense) {
        sendJson(res, 404, { error: 'Active license for this order was not found' });
        return;
      }

      const code = issueActivationCodeFromLicense(activeLicense);
      recordDelivery(activeLicense.license_id, 'manual_resend', activeLicense.customer_email);
      const resendEmailResult = await trySendActivationCodeEmail({
        license: activeLicense,
        activationCode: code,
      });

      addAuditLog({
        actor: actorFromRequest(req),
        action: 'order.resend',
        target_type: 'order',
        target_id: providerOrderId,
        payload: { license_id: activeLicense.license_id },
      });

      saveState();
      sendJson(res, 200, {
        ok: true,
        provider_order_id: providerOrderId,
        license_id: activeLicense.license_id,
        activation_code: code,
        email_sent: resendEmailResult.sent,
        email_error: resendEmailResult.sent ? null : resendEmailResult.reason,
      });
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (error) {
    console.error('[license-gateway] Unhandled error', error);
    sendJson(res, 500, { error: String(error) });
  }
});

server.listen(port, () => {
  console.log(
    `[license-gateway] listening on :${port} using data store ${dataFilePath}`,
  );
});

async function handleCreemWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const signature = (req.headers['creem-signature'] ?? '').toString();

  if (!verifyWebhookSignature(rawBody, signature)) {
    state.metrics.webhook_verify_failed_total += 1;
    recordWebhookFailure({
      reason: 'signature_verification_failed',
      raw_event_hash: sha256Hex(rawBody),
    });
    saveState();
    sendJson(res, 401, { error: 'Invalid webhook signature' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    recordWebhookFailure({
      reason: 'invalid_json',
      raw_event_hash: sha256Hex(rawBody),
    });
    saveState();
    sendJson(res, 400, { error: 'Invalid JSON payload' });
    return;
  }

  const extracted = extractCreemOrder(payload);
  const eventId = extracted.event_id;

  if (eventId && hasProcessedWebhookEvent(eventId)) {
    state.metrics.webhook_duplicate_total += 1;
    addAuditLog({
      actor: 'creem:webhook',
      action: 'event.duplicate',
      target_type: 'event',
      target_id: eventId,
      payload: {
        event_name: extracted.event_name,
        provider_order_id: extracted.provider_order_id,
      },
    });
    saveState();
    sendJson(res, 200, {
      ok: true,
      duplicate: true,
      event_id: eventId,
      event_name: extracted.event_name,
    });
    return;
  }

  let handled = false;

  if (extracted.event_name === 'checkout.completed') {
    handled = await handleCheckoutCompletedWebhook(extracted, rawBody, res);
  } else if (extracted.event_name === 'refund.created') {
    handled = handleRefundWebhook(extracted, rawBody, res);
  } else if (isSubscriptionLifecycleEvent(extracted.event_name)) {
    handled = handleSubscriptionWebhook(extracted, rawBody, res);
  } else {
    sendJson(res, 202, { ok: true, ignored: true, event_name: extracted.event_name });
    handled = true;
  }

  if (!handled) {
    return;
  }

  markWebhookEventProcessed(extracted, rawBody);
  saveState();
}

async function handleCheckoutCompletedWebhook(extracted, rawBody, res) {
  const existingOrder = state.orders.find(
    (order) =>
      order.provider === 'creem' &&
      order.provider_order_id === extracted.provider_order_id,
  );

  if (existingOrder) {
    state.metrics.webhook_duplicate_total += 1;
    addAuditLog({
      actor: 'creem:webhook',
      action: 'order.duplicate',
      target_type: 'order',
      target_id: extracted.provider_order_id,
      payload: { raw_event_hash: sha256Hex(rawBody) },
    });
    saveState();
    sendJson(res, 200, {
      ok: true,
      duplicate: true,
      provider_order_id: extracted.provider_order_id,
    });
    return true;
  }

  const order = {
    id: createId('ord'),
    provider: 'creem',
    provider_order_id: extracted.provider_order_id,
    provider_subscription_id: extracted.provider_subscription_id,
    provider_customer_id: extracted.provider_customer_id,
    customer_email: extracted.customer_email,
    sku_code: extracted.sku_code,
    product_id: extracted.product_id,
    product_billing_type: extracted.product_billing_type,
    product_billing_period: extracted.product_billing_period,
    currency: extracted.currency,
    amount_total: extracted.amount_total,
    payment_status: extracted.payment_status,
    raw_event_hash: sha256Hex(rawBody),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.orders.push(order);
  state.metrics.orders_created_total += 1;

  try {
    const issuedAt = new Date().toISOString();
    const billingCycle = resolveBillingCycle(extracted);
    const expiresAt = resolveExpiresAt(issuedAt, billingCycle);
    const licenseId = createId('lic');

    const license = {
      id: createId('row'),
      license_id: licenseId,
      provider_order_id: order.provider_order_id,
      provider_subscription_id: order.provider_subscription_id,
      plan: 'pro',
      billing_cycle: billingCycle,
      expires_at: expiresAt,
      customer_email: order.customer_email,
      status: 'active',
      issued_code_hash: '',
      issued_at: issuedAt,
      revoked_at: null,
      replacement_for_license_id: null,
      notes: null,
      verify_count: 0,
      last_verified_at: null,
      last_verified_device: null,
    };

    const activationCode = issueActivationCodeFromLicense(license);
    license.issued_code_hash = sha256Hex(activationCode);
    state.licenses.push(license);
    state.metrics.licenses_issued_total += 1;

    // --- Promo code + commission tracking ---
    if (extracted.promo_code) {
      const promoRecord = state.promo_codes.find(
        (p) => p.code === extracted.promo_code && p.active
      );
      if (promoRecord) {
        promoRecord.times_used += 1;
        // Anti-abuse: skip commission if same email already used this promo
        const alreadyUsed = state.conversions.find(
          (c) => c.promo_code === extracted.promo_code && c.customer_email === extracted.customer_email && c.status === 'paid'
        );
        const affiliate = !alreadyUsed ? state.affiliates.find(
          (a) => a.id === (extracted.affiliate_id || promoRecord.affiliate_id) && a.status === 'active'
        ) : null;
        if (affiliate) {
          const paidAmountCents = extracted.amount_total;
          const commissionPct = affiliate.commission_pct;
          const commissionCents = Math.round(paidAmountCents * commissionPct / 100);
          const lockedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const convId = createId('conv');
          const conversion = {
            id: convId,
            affiliate_id: affiliate.id,
            promo_code: extracted.promo_code,
            provider_order_id: extracted.provider_order_id,
            customer_email: extracted.customer_email,
            product_id: extracted.product_id,
            original_price_cents: extracted.product_price_cents || paidAmountCents,
            paid_amount_cents: paidAmountCents,
            discount_cents: (extracted.product_price_cents || paidAmountCents) - paidAmountCents,
            discount_pct: promoRecord.discount_pct,
            commission_pct: commissionPct,
            commission_cents: commissionCents,
            status: 'paid',
            locked_until: lockedUntil,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          state.conversions.push(conversion);
          state.commission_events.push({
            id: createId('ce'),
            conversion_id: convId,
            affiliate_id: affiliate.id,
            event_type: 'accrue',
            amount_cents: commissionCents,
            currency: extracted.currency,
            related_provider_event: extracted.event_id,
            notes: `checkout.completed promo=${extracted.promo_code}`,
            created_at: new Date().toISOString(),
          });
          state.metrics.conversions_total += 1;
          state.metrics.commissions_accrued_total += 1;
          addAuditLog({
            actor: 'creem:webhook',
            action: 'commission.accrue',
            target_type: 'conversion',
            target_id: convId,
            payload: {
              affiliate_id: affiliate.id,
              promo_code: extracted.promo_code,
              commission_cents: commissionCents,
              paid_amount_cents: paidAmountCents,
            },
          });
        }
      }
    }

    recordDelivery(license.license_id, 'checkout_page', license.customer_email);
    const webhookEmailResult = await trySendActivationCodeEmail({
      license,
      activationCode,
    });

    addAuditLog({
      actor: 'creem:webhook',
      action: 'license.issue',
      target_type: 'license',
      target_id: license.license_id,
      payload: {
        provider_order_id: license.provider_order_id,
        billing_cycle: license.billing_cycle,
      },
    });

    saveState();
    sendJson(res, 200, {
      ok: true,
      provider_order_id: order.provider_order_id,
      license_id: license.license_id,
      customer_email: license.customer_email,
      expires_at: license.expires_at,
      email_sent: webhookEmailResult.sent,
      email_error: webhookEmailResult.sent ? null : webhookEmailResult.reason,
    });
    return true;
  } catch (error) {
    recordWebhookFailure({
      reason: 'license_issue_failed',
      raw_event_hash: order.raw_event_hash,
      details: String(error),
      provider_order_id: order.provider_order_id,
    });
    saveState();
    sendJson(res, 500, { error: String(error) });
    return false;
  }
}

async function handleAdminLicenseIssue(req, res) {
  const rawBody = await readRawBody(req);
  let payload = {};
  if (rawBody.length > 0) {
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON payload' });
      return;
    }
  }

  const billingCycle = normalizeBillingCycle(payload?.billing_cycle);
  if (!billingCycle || !isValidBillingCycle(billingCycle)) {
    sendJson(res, 400, { error: 'billing_cycle must be monthly, yearly, or lifetime' });
    return;
  }

  const plan = normalizePlan(payload?.plan);
  if (!plan) {
    sendJson(res, 400, { error: 'plan must be pro or enterprise' });
    return;
  }

  const sendEmail = Boolean(payload?.send_email);
  const quantityInput = Array.isArray(payload?.customer_emails)
    ? payload.customer_emails.length
    : payload?.quantity;
  const quantity = resolveIssueQuantity(quantityInput);
  if (!quantity) {
    sendJson(res, 400, { error: 'quantity must be an integer between 1 and 200' });
    return;
  }

  const issuedAt = normalizeIsoDatetime(payload?.issued_at) ?? new Date().toISOString();
  const expiresAtOverride = normalizeIsoDatetime(payload?.expires_at);

  let days = null;
  if (payload?.days !== undefined && payload?.days !== null && payload?.days !== '') {
    const parsedDays = Number(payload.days);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0 || parsedDays > 3650) {
      sendJson(res, 400, { error: 'days must be a number between 1 and 3650' });
      return;
    }
    days = Math.floor(parsedDays);
  }

  if (expiresAtOverride && days !== null) {
    sendJson(res, 400, { error: 'expires_at and days cannot be provided together' });
    return;
  }

  const customerEmails = buildManualIssueCustomerEmails({
    payload,
    quantity,
    issuedAt,
  });
  if (!customerEmails.ok) {
    sendJson(res, 400, { error: customerEmails.error });
    return;
  }

  const issuedItems = [];
  for (const customerEmail of customerEmails.items) {
    const providerOrderId = `manual_${createId('ord')}`;
    const now = new Date().toISOString();
    const expiresAt = resolveManualIssueExpiresAt({
      billingCycle,
      issuedAt,
      days,
      expiresAtOverride,
    });
    const normalizedEmail = customerEmail || null;

    const order = {
      id: createId('ord'),
      provider: 'manual',
      provider_order_id: providerOrderId,
      provider_subscription_id: null,
      provider_customer_id: null,
      customer_email: normalizedEmail,
      sku_code: null,
      product_id: null,
      product_billing_type: billingCycle === 'lifetime' ? 'one_time' : 'recurring',
      product_billing_period: billingCycle,
      currency: null,
      amount_total: 0,
      payment_status: 'manual_issued',
      raw_event_hash: null,
      created_at: now,
      updated_at: now,
    };
    state.orders.push(order);
    state.metrics.orders_created_total += 1;

    const license = {
      id: createId('row'),
      license_id: createId('lic'),
      provider_order_id: providerOrderId,
      provider_subscription_id: null,
      plan,
      billing_cycle: billingCycle,
      expires_at: expiresAt,
      customer_email: normalizedEmail,
      status: 'active',
      issued_code_hash: '',
      issued_at: issuedAt,
      revoked_at: null,
      replacement_for_license_id: null,
      notes: 'manual_issue',
      verify_count: 0,
      last_verified_at: null,
      last_verified_device: null,
    };

    const activationCode = issueActivationCodeFromLicense(license);
    license.issued_code_hash = sha256Hex(activationCode);
    state.licenses.push(license);
    state.metrics.licenses_issued_total += 1;
    recordDelivery(license.license_id, 'manual_issue', normalizedEmail);

    let emailResult = { sent: false, reason: 'email_not_requested' };
    if (sendEmail) {
      emailResult = await trySendActivationCodeEmail({
        license,
        activationCode,
      });
    }

    addAuditLog({
      actor: actorFromRequest(req),
      action: 'license.issue_manual',
      target_type: 'license',
      target_id: license.license_id,
      payload: {
        provider_order_id: providerOrderId,
        billing_cycle: billingCycle,
        customer_email: normalizedEmail,
        send_email: sendEmail,
      },
    });

    issuedItems.push({
      provider_order_id: providerOrderId,
      license_id: license.license_id,
      customer_email: normalizedEmail,
      billing_cycle: billingCycle,
      expires_at: license.expires_at,
      activation_code: activationCode,
      email_sent: emailResult.sent,
      email_error: emailResult.sent ? null : emailResult.reason,
    });
  }

  saveState();
  sendJson(res, 200, {
    ok: true,
    count: issuedItems.length,
    items: issuedItems,
  });
}

async function handleClientLicenseVerify(req, res) {
  const rawBody = await readRawBody(req);

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
    return;
  }

  const activationCode = String(payload?.activation_code ?? '').trim();
  if (!activationCode) {
    sendJson(res, 400, {
      ok: false,
      error: 'Missing activation_code.',
    });
    return;
  }

  const licenseId = extractLicenseIdFromActivationCode(activationCode) ?? '';
  if (!licenseId) {
    sendJson(res, 400, {
      ok: false,
      error: 'Invalid activation_code.',
    });
    return;
  }

  const now = new Date().toISOString();
  const license = state.licenses.find((item) => item.license_id === licenseId);
  let stateTouched = false;

  if (!license) {
    sendJson(res, 200, {
      ok: true,
      found: false,
      checked_at: now,
      license: null,
    });
    return;
  }

  license.verify_count = Number(license.verify_count ?? 0) + 1;
  license.last_verified_at = now;
  const deviceHint = String(
    payload?.device_id ??
      payload?.machine_id ??
      payload?.installation_id ??
      '',
  ).trim();
  if (deviceHint) {
    license.last_verified_device = deviceHint.slice(0, 128);
  }
  stateTouched = true;

  const order = state.orders.find(
    (item) => item.provider_order_id === license.provider_order_id,
  );

  // Reconcile refund-first edge case: if order is refunded but license still active, revoke now.
  if (order?.payment_status === 'refunded' && license.status === 'active') {
    license.status = 'revoked';
    license.revoked_at = now;
    license.notes = 'revoked_by:client_reconcile_refund';
    state.metrics.licenses_revoked_total += 1;
    state.metrics.licenses_revoked_by_refund_total += 1;
    addAuditLog({
      actor: 'client:verify',
      action: 'license.reconcile_refund_revoke',
      target_type: 'license',
      target_id: license.license_id,
      payload: {
        provider_order_id: license.provider_order_id,
      },
    });
    stateTouched = true;
  }

  if (stateTouched) {
    saveState();
  }

  sendJson(res, 200, {
    ok: true,
    found: true,
    checked_at: now,
    license: {
      license_id: license.license_id,
      provider_order_id: license.provider_order_id,
      plan: license.plan,
      billing_cycle: license.billing_cycle,
      status: license.status,
      expires_at: license.expires_at,
      revoked_at: license.revoked_at,
      customer_email: license.customer_email,
      verify_count: Number(license.verify_count ?? 0),
      last_verified_at: license.last_verified_at ?? null,
      last_verified_device: license.last_verified_device ?? null,
    },
  });
}

function handleRefundWebhook(extracted, rawBody, res) {
  const now = new Date().toISOString();
  let order = state.orders.find(
    (item) =>
      item.provider === 'creem' &&
      item.provider_order_id === extracted.provider_order_id,
  );

  if (order) {
    order.payment_status = 'refunded';
    order.provider_subscription_id = extracted.provider_subscription_id || order.provider_subscription_id || null;
    order.product_id = extracted.product_id || order.product_id || null;
    order.product_billing_type = extracted.product_billing_type || order.product_billing_type || null;
    order.product_billing_period = extracted.product_billing_period || order.product_billing_period || null;
    order.updated_at = now;
  } else {
    state.metrics.refund_events_without_order_total += 1;
    order = {
      id: createId('ord'),
      provider: 'creem',
      provider_order_id: extracted.provider_order_id,
      provider_subscription_id: extracted.provider_subscription_id,
      provider_customer_id: extracted.provider_customer_id,
      customer_email: extracted.customer_email,
      sku_code: extracted.sku_code,
      product_id: extracted.product_id,
      product_billing_type: extracted.product_billing_type,
      product_billing_period: extracted.product_billing_period,
      currency: extracted.currency,
      amount_total: extracted.amount_total,
      payment_status: 'refunded',
      raw_event_hash: sha256Hex(rawBody),
      created_at: now,
      updated_at: now,
    };
    state.orders.push(order);
    state.metrics.orders_created_total += 1;
  }

  const activeLicenses = state.licenses.filter(
    (license) =>
      license.provider_order_id === extracted.provider_order_id &&
      license.status === 'active',
  );

  for (const license of activeLicenses) {
    license.status = 'revoked';
    license.revoked_at = now;
    license.notes = `revoked_by:${extracted.event_name}`;

    addAuditLog({
      actor: 'creem:webhook',
      action: 'license.revoke_refund',
      target_type: 'license',
      target_id: license.license_id,
      payload: {
        provider_order_id: extracted.provider_order_id,
        event_name: extracted.event_name,
      },
    });
  }

  if (activeLicenses.length === 0) {
    addAuditLog({
      actor: 'creem:webhook',
      action: 'order.refunded_no_active_license',
      target_type: 'order',
      target_id: extracted.provider_order_id,
      payload: {
        event_name: extracted.event_name,
      },
    });
  }

  // --- Reverse commissions on refund ---
  const relatedConversions = state.conversions.filter(
    (c) => c.provider_order_id === extracted.provider_order_id && c.status === 'paid'
  );
  for (const conv of relatedConversions) {
    conv.status = 'refunded';
    conv.updated_at = new Date().toISOString();
    state.commission_events.push({
      id: createId('ce'),
      conversion_id: conv.id,
      affiliate_id: conv.affiliate_id,
      event_type: 'reversal',
      amount_cents: -conv.commission_cents,
      currency: extracted.currency,
      related_provider_event: extracted.event_id,
      notes: 'refund.created reversal',
      created_at: new Date().toISOString(),
    });
    state.metrics.commissions_reversed_total += 1;
    addAuditLog({
      actor: 'creem:webhook',
      action: 'commission.reverse',
      target_type: 'conversion',
      target_id: conv.id,
      payload: { affiliate_id: conv.affiliate_id, reversed_cents: conv.commission_cents },
    });
  }

  state.metrics.refund_events_total += 1;
  state.metrics.licenses_revoked_total += activeLicenses.length;
  state.metrics.licenses_revoked_by_refund_total += activeLicenses.length;

  saveState();
  sendJson(res, 200, {
    ok: true,
    event_name: extracted.event_name,
    provider_order_id: extracted.provider_order_id,
    revoked_count: activeLicenses.length,
  });
  return true;
}

function isSubscriptionLifecycleEvent(eventName) {
  return eventName.startsWith('subscription.');
}

function handleSubscriptionWebhook(extracted, rawBody, res) {
  const now = new Date().toISOString();
  let order = state.orders.find(
    (item) =>
      item.provider === 'creem' &&
      item.provider_order_id === extracted.provider_order_id,
  );

  if (!order) {
    order = {
      id: createId('ord'),
      provider: 'creem',
      provider_order_id: extracted.provider_order_id,
      provider_subscription_id: extracted.provider_subscription_id,
      provider_customer_id: extracted.provider_customer_id,
      customer_email: extracted.customer_email,
      sku_code: extracted.sku_code,
      product_id: extracted.product_id,
      product_billing_type: extracted.product_billing_type,
      product_billing_period: extracted.product_billing_period,
      currency: extracted.currency,
      amount_total: extracted.amount_total,
      payment_status: extracted.payment_status,
      raw_event_hash: sha256Hex(rawBody),
      created_at: now,
      updated_at: now,
    };
    state.orders.push(order);
    state.metrics.orders_created_total += 1;
  } else {
    order.provider_subscription_id =
      extracted.provider_subscription_id || order.provider_subscription_id || null;
    order.provider_customer_id =
      extracted.provider_customer_id || order.provider_customer_id || null;
    order.customer_email = extracted.customer_email || order.customer_email || null;
    order.sku_code = extracted.sku_code || order.sku_code || null;
    order.product_id = extracted.product_id || order.product_id || null;
    order.product_billing_type =
      extracted.product_billing_type || order.product_billing_type || null;
    order.product_billing_period =
      extracted.product_billing_period || order.product_billing_period || null;
    order.currency = extracted.currency || order.currency || null;
    order.amount_total = extracted.amount_total || order.amount_total || 0;
    order.payment_status = extracted.payment_status || order.payment_status;
    order.updated_at = now;
  }

  const activeLicenses = state.licenses.filter(
    (license) =>
      license.provider_order_id === extracted.provider_order_id &&
      license.status === 'active',
  );

  if (extracted.event_name === 'subscription.paid') {
    if (activeLicenses.length === 0) {
      state.metrics.subscription_events_without_license_total += 1;
      addAuditLog({
        actor: 'creem:webhook',
        action: 'subscription.paid_no_active_license',
        target_type: 'order',
        target_id: extracted.provider_order_id,
        payload: { event_name: extracted.event_name },
      });
      state.metrics.subscription_events_total += 1;
      saveState();
      sendJson(res, 202, {
        ok: true,
        ignored: true,
        reason: 'subscription_paid_without_active_license',
        provider_order_id: extracted.provider_order_id,
      });
      return true;
    }

    const resolvedCycle = resolveBillingCycle(extracted, activeLicenses[0].billing_cycle);
    for (const license of activeLicenses) {
      const renewalAnchor = resolveRenewalAnchor(now, license.expires_at);
      const renewedExpiresAt = resolveExpiresAt(renewalAnchor, resolvedCycle);
      license.billing_cycle = resolvedCycle;
      license.status = 'active';
      license.revoked_at = null;
      license.expires_at = renewedExpiresAt;
      license.notes = `renewed_by:${extracted.event_name}`;
      addAuditLog({
        actor: 'creem:webhook',
        action: 'license.extend_subscription',
        target_type: 'license',
        target_id: license.license_id,
        payload: {
          provider_order_id: extracted.provider_order_id,
          billing_cycle: resolvedCycle,
          expires_at: renewedExpiresAt,
        },
      });
    }

    order.payment_status = 'paid';
    order.updated_at = now;
    state.metrics.subscription_events_total += 1;
    state.metrics.licenses_extended_total += activeLicenses.length;
    saveState();
    sendJson(res, 200, {
      ok: true,
      event_name: extracted.event_name,
      provider_order_id: extracted.provider_order_id,
      extended_count: activeLicenses.length,
      billing_cycle: resolvedCycle,
    });
    return true;
  }

  if (extracted.event_name === 'subscription.expired') {
    for (const license of activeLicenses) {
      license.status = 'revoked';
      license.revoked_at = now;
      license.notes = `revoked_by:${extracted.event_name}`;
      addAuditLog({
        actor: 'creem:webhook',
        action: 'license.revoke_subscription_expired',
        target_type: 'license',
        target_id: license.license_id,
        payload: { provider_order_id: extracted.provider_order_id },
      });
    }
    order.payment_status = 'expired';
    order.updated_at = now;
    state.metrics.subscription_events_total += 1;
    state.metrics.subscription_state_updates_total += 1;
    state.metrics.licenses_revoked_total += activeLicenses.length;
    saveState();
    sendJson(res, 200, {
      ok: true,
      event_name: extracted.event_name,
      provider_order_id: extracted.provider_order_id,
      revoked_count: activeLicenses.length,
    });
    return true;
  }

  if (extracted.event_name === 'subscription.canceled') {
    for (const license of activeLicenses) {
      if (extracted.subscription_period_end_at && license.billing_cycle !== 'lifetime') {
        license.expires_at = extracted.subscription_period_end_at;
      }
      license.notes = `updated_by:${extracted.event_name}`;
      addAuditLog({
        actor: 'creem:webhook',
        action: 'license.mark_subscription_canceled',
        target_type: 'license',
        target_id: license.license_id,
        payload: {
          provider_order_id: extracted.provider_order_id,
          expires_at: license.expires_at,
        },
      });
    }
    order.payment_status = 'cancelled';
    order.updated_at = now;
    state.metrics.subscription_events_total += 1;
    state.metrics.subscription_state_updates_total += 1;
    saveState();
    sendJson(res, 200, {
      ok: true,
      event_name: extracted.event_name,
      provider_order_id: extracted.provider_order_id,
      updated_count: activeLicenses.length,
      subscription_period_end_at: extracted.subscription_period_end_at,
    });
    return true;
  }

  // Non-critical subscription lifecycle events are acknowledged for state sync.
  order.payment_status = extracted.payment_status || order.payment_status;
  order.updated_at = now;
  state.metrics.subscription_events_total += 1;
  state.metrics.subscription_state_updates_total += 1;
  addAuditLog({
    actor: 'creem:webhook',
    action: 'subscription.lifecycle_acked',
    target_type: 'order',
    target_id: extracted.provider_order_id,
    payload: { event_name: extracted.event_name },
  });
  saveState();
  sendJson(res, 200, {
    ok: true,
    event_name: extracted.event_name,
    provider_order_id: extracted.provider_order_id,
    acked: true,
  });
  return true;
}

function extractLicenseIdFromActivationCode(activationCode) {
  const parts = activationCode.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'AGSH') {
    return null;
  }

  try {
    const payloadJson = decodeBase64UrlToUtf8(parts[1]);
    const payload = JSON.parse(payloadJson);
    const licenseId = String(payload?.license_id ?? '').trim();
    return licenseId || null;
  } catch {
    return null;
  }
}

function decodeBase64UrlToUtf8(input) {
  const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(paddingNeeded);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function loadState() {
  ensureDir(path.dirname(dataFilePath));
  if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, JSON.stringify(initialState, null, 2));
    return structuredClone(initialState);
  }

  try {
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(initialState),
      ...parsed,
      metrics: {
        ...initialState.metrics,
        ...(parsed.metrics ?? {}),
      },
    };
  } catch (error) {
    console.error('[license-gateway] Failed to parse data file, recreating:', error);
    fs.writeFileSync(dataFilePath, JSON.stringify(initialState, null, 2));
    return structuredClone(initialState);
  }
}

function saveState() {
  ensureDir(path.dirname(dataFilePath));
  const tempFilePath = `${dataFilePath}.tmp`;
  fs.writeFileSync(tempFilePath, JSON.stringify(state, null, 2));
  fs.renameSync(tempFilePath, dataFilePath);
}

function verifyWebhookSignature(rawBody, providedSignature) {
  if (!webhookSecret.trim() || !providedSignature.trim()) {
    return false;
  }
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  return safeTimingEqual(providedSignature.trim().toLowerCase(), expectedSignature);
}

function safeTimingEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function extractCreemOrder(payload) {
  const eventName = String(payload?.eventType ?? payload?.type ?? 'unknown').trim() || 'unknown';
  const object = payload?.object ?? payload?.data ?? {};
  const orderNode = object?.order ?? object?.transaction?.order ?? {};
  const customerNode = object?.customer ?? {};
  const subscriptionObject =
    object?.object === 'subscription' ? object : object?.subscription ?? {};
  const productNode =
    object?.product ??
    subscriptionObject?.product ??
    object?.checkout?.product ??
    {};
  const metadata = object?.metadata ?? {};
  const subscriptionNode = subscriptionObject;
  const providerSubscriptionId = String(
    readNodeId(subscriptionNode) ?? object?.subscription_id ?? '',
  ).trim();

  const providerOrderId = resolveProviderOrderId({
    eventName,
    object,
    orderNode,
    subscriptionNode,
    providerSubscriptionId,
  });
  if (!providerOrderId) {
    throw new Error('Missing provider order ID in webhook payload');
  }

  const productBillingType = String(
    productNode?.billing_type ?? object?.billing_type ?? '',
  ).trim();
  const productBillingPeriod = String(
    productNode?.billing_period ??
      subscriptionNode?.billing_period ??
      object?.billing_period ??
      '',
  ).trim();

  const customerEmail = String(
    customerNode?.email ??
      object?.customer_email ??
      metadata?.user_email_hint ??
      '',
  ).trim();

  const skuCode = String(
    metadata?.sku_code ??
      metadata?.plan ??
      metadata?.sku ??
      productNode?.name ??
      productNode?.id ??
      'AGSH_PRO_30D',
  ).trim();

  const amountTotal = Number(
    orderNode?.amount ??
      object?.transaction?.amount_paid ??
      object?.refund_amount ??
      productNode?.price ??
      0,
  );

  const paymentStatus = String(
    orderNode?.status ??
      object?.transaction?.status ??
      object?.status ??
      subscriptionNode?.status ??
      inferPaymentStatusFromEvent(eventName) ??
      'paid',
  ).trim().toLowerCase();

  const productId = String(
    readNodeId(productNode) ?? object?.product_id ?? '',
  ).trim();

  const eventId = String(payload?.id ?? payload?.event_id ?? '').trim();
  const subscriptionPeriodEndAt = normalizeIsoDatetime(
    subscriptionNode?.current_period_end_date ??
      object?.current_period_end_date ??
      null,
  );

  return {
    event_id: eventId || null,
    event_name: eventName,
    provider_order_id: providerOrderId,
    provider_subscription_id: providerSubscriptionId || null,
    provider_customer_id: String(
      readNodeId(customerNode) ?? object?.customer_id ?? '',
    ).trim(),
    customer_email: customerEmail,
    sku_code: skuCode,
    product_id: productId || null,
    product_billing_type: productBillingType || null,
    product_billing_period: productBillingPeriod || null,
    currency: String(
      orderNode?.currency ??
        object?.transaction?.currency ??
        productNode?.currency ??
        object?.refund_currency ??
        'USD',
    ).toUpperCase(),
    amount_total: Number.isFinite(amountTotal) ? amountTotal : 0,
    payment_status: paymentStatus || 'paid',
    subscription_period_end_at: subscriptionPeriodEndAt,
    affiliate_id: String(metadata?.affiliate_id ?? '').trim() || null,
    promo_code: String(metadata?.promo_code ?? '').trim().toUpperCase() || null,
    product_price_cents: Number(productNode?.price ?? 0) || 0,
  };
}

function readNodeId(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && typeof value.id === 'string') {
    return value.id;
  }
  return null;
}

function resolveBillingCycle(extracted, fallbackCycle = null) {
  const skuCode = String(extracted?.sku_code ?? '').trim();
  const productId = String(extracted?.product_id ?? '').trim();
  const normalizedSkuCode = skuCode.toUpperCase();
  const normalizedProductId = productId.toLowerCase();
  const productBillingType = String(extracted?.product_billing_type ?? '').trim().toLowerCase();
  const productBillingPeriod = String(extracted?.product_billing_period ?? '').trim().toLowerCase();

  if (normalizedSkuCode && skuBillingMap.has(normalizedSkuCode)) {
    return skuBillingMap.get(normalizedSkuCode);
  }

  if (normalizedProductId && productBillingMap.has(normalizedProductId)) {
    return productBillingMap.get(normalizedProductId);
  }

  if (productBillingType === 'recurring') {
    const recurringCycle = resolveRecurringPeriodToCycle(productBillingPeriod);
    if (recurringCycle) {
      return recurringCycle;
    }
  }

  if (fallbackCycle && isValidBillingCycle(fallbackCycle)) {
    return fallbackCycle;
  }

  if (!strictBillingResolution) {
    return inferBillingCycleFromSkuOrName(skuCode);
  }

  throw new Error(
    [
      'Unable to resolve billing cycle from webhook payload.',
      `sku_code=${skuCode || '∅'}`,
      `product_id=${productId || '∅'}`,
      `product_billing_type=${productBillingType || '∅'}`,
      `product_billing_period=${productBillingPeriod || '∅'}`,
      'Fix: set CREEM_SKU_BILLING_MAP_JSON and/or CREEM_PRODUCT_BILLING_MAP_JSON.',
    ].join(' '),
  );
}

function resolveExpiresAt(issuedAt, billingCycle) {
  if (billingCycle === 'lifetime') {
    return null;
  }

  const issuedAtMs = new Date(issuedAt).getTime();
  const days = billingCycle === 'yearly' ? 365 : 30;
  return new Date(issuedAtMs + days * 24 * 60 * 60 * 1000).toISOString();
}

function resolveRenewalAnchor(nowIso, currentExpiresAt) {
  const nowMs = Date.parse(nowIso);
  const expiresMs = Date.parse(String(currentExpiresAt ?? ''));
  if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
    return new Date(expiresMs).toISOString();
  }
  return nowIso;
}

function resolveProviderOrderId({
  eventName,
  object,
  orderNode,
  subscriptionNode,
  providerSubscriptionId,
}) {
  if (
    providerSubscriptionId &&
    (isSubscriptionLifecycleEvent(eventName) ||
      eventName === 'checkout.completed' ||
      eventName === 'refund.created')
  ) {
    return providerSubscriptionId;
  }

  const orderId = String(
    readNodeId(orderNode) ??
      object?.order_id ??
      object?.checkout_id ??
      object?.transaction_id ??
      '',
  ).trim();
  if (orderId) {
    return orderId;
  }

  if (providerSubscriptionId) {
    return providerSubscriptionId;
  }

  return String(
    object?.id ??
      readNodeId(subscriptionNode) ??
      '',
  ).trim();
}

function inferPaymentStatusFromEvent(eventName) {
  if (eventName === 'refund.created') {
    return 'refunded';
  }
  if (eventName === 'subscription.canceled') {
    return 'cancelled';
  }
  if (eventName === 'subscription.expired') {
    return 'expired';
  }
  if (eventName === 'subscription.paused') {
    return 'paused';
  }
  if (eventName === 'subscription.paid' || eventName === 'checkout.completed') {
    return 'paid';
  }
  return null;
}

function normalizeIsoDatetime(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function resolveRecurringPeriodToCycle(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes('year') || normalized.includes('annual')) {
    return 'yearly';
  }
  if (normalized.includes('month')) {
    return 'monthly';
  }
  return null;
}

function inferBillingCycleFromSkuOrName(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (
    normalized.includes('lifetime') ||
    normalized.includes('forever') ||
    normalized.includes('permanent')
  ) {
    return 'lifetime';
  }
  if (
    normalized.includes('365') ||
    normalized.includes('year') ||
    normalized.includes('annual')
  ) {
    return 'yearly';
  }
  return 'monthly';
}

function isValidBillingCycle(value) {
  return value === 'monthly' || value === 'yearly' || value === 'lifetime';
}

function normalizeBillingCycle(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'month' || normalized === 'monthly') {
    return 'monthly';
  }
  if (normalized === 'year' || normalized === 'annual' || normalized === 'yearly') {
    return 'yearly';
  }
  if (normalized === 'lifetime' || normalized === 'forever' || normalized === 'permanent') {
    return 'lifetime';
  }
  return null;
}

function normalizePlan(value) {
  const normalized = String(value ?? 'pro').trim().toLowerCase();
  if (normalized === 'pro' || normalized === 'enterprise') {
    return normalized;
  }
  return null;
}

function resolveIssueQuantity(value) {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const integer = Math.floor(parsed);
  if (integer < 1 || integer > 200) {
    return null;
  }
  return integer;
}

function resolveManualIssueExpiresAt({
  billingCycle,
  issuedAt,
  days,
  expiresAtOverride,
}) {
  if (billingCycle === 'lifetime') {
    return null;
  }
  if (expiresAtOverride) {
    return expiresAtOverride;
  }
  if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
    return new Date(Date.parse(issuedAt) + days * 24 * 60 * 60 * 1000).toISOString();
  }
  return resolveExpiresAt(issuedAt, billingCycle);
}

function buildManualIssueCustomerEmails({ payload, quantity, issuedAt }) {
  const parseInputEmails = (input) => {
    if (!input) {
      return [];
    }
    if (Array.isArray(input)) {
      return input.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    if (typeof input === 'string') {
      return input
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  };

  const providedEmails = parseInputEmails(payload?.customer_emails);
  if (providedEmails.length > 0) {
    if (providedEmails.length !== quantity) {
      return {
        ok: false,
        error: 'customer_emails length must match quantity',
      };
    }
    if (providedEmails.some((email) => !isLikelyEmail(email))) {
      return {
        ok: false,
        error: 'customer_emails contains invalid email address',
      };
    }
    return { ok: true, items: providedEmails };
  }

  const singleEmail = String(payload?.customer_email ?? '').trim();
  if (singleEmail) {
    if (!isLikelyEmail(singleEmail)) {
      return { ok: false, error: 'customer_email is invalid' };
    }
    if (quantity === 1) {
      return { ok: true, items: [singleEmail] };
    }
    const aliasBatchTag = formatBatchTag(issuedAt);
    return {
      ok: true,
      items: Array.from({ length: quantity }, (_, index) =>
        buildAliasEmail(singleEmail, aliasBatchTag, index + 1),
      ),
    };
  }

  const rawPrefix = String(payload?.customer_prefix ?? 'gift').trim().toLowerCase();
  const customerPrefix = rawPrefix.replace(/[^a-z0-9._-]/g, '') || 'gift';
  const rawDomain = String(payload?.customer_domain ?? 'agentshield.local').trim().toLowerCase();
  const customerDomain = rawDomain.replace(/[^a-z0-9.-]/g, '') || 'agentshield.local';
  const batchTag = formatBatchTag(issuedAt);
  return {
    ok: true,
    items: Array.from({ length: quantity }, (_, index) =>
      `${customerPrefix}+${batchTag}-${String(index + 1).padStart(3, '0')}@${customerDomain}`,
    ),
  };
}

function buildAliasEmail(email, batchTag, index) {
  const [localPart, domainPart] = email.split('@');
  if (!localPart || !domainPart) {
    return email;
  }
  const baseLocal = localPart.split('+')[0] || localPart;
  return `${baseLocal}+gift-${batchTag}-${String(index).padStart(3, '0')}@${domainPart}`;
}

function formatBatchTag(issuedAt) {
  return issuedAt
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replaceAll('.', '')
    .replaceAll('T', '')
    .replaceAll('Z', '')
    .slice(0, 14);
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

function loadBillingMapFromJsonEnv(rawValue, envName, defaults = new Map()) {
  const map = new Map(defaults);
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) {
    return map;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }

    for (const [rawKey, rawCycle] of Object.entries(parsed)) {
      const key = String(rawKey ?? '').trim();
      const cycle = normalizeBillingCycle(rawCycle);
      if (!key) {
        continue;
      }
      if (!cycle) {
        throw new Error(`invalid cycle for key "${key}": ${String(rawCycle)}`);
      }
      const normalizedKey = envName.includes('PRODUCT')
        ? key.toLowerCase()
        : key.toUpperCase();
      map.set(normalizedKey, cycle);
    }
  } catch (error) {
    throw new Error(`[license-gateway] failed to parse ${envName}: ${String(error)}`);
  }

  return map;
}

function hasProcessedWebhookEvent(eventId) {
  if (!eventId) {
    return false;
  }
  return state.processed_webhook_events.some((item) => item.event_id === eventId);
}

function markWebhookEventProcessed(extracted, rawBody) {
  const eventId = extracted.event_id;
  if (!eventId) {
    return;
  }
  state.processed_webhook_events.push({
    event_id: eventId,
    event_name: extracted.event_name,
    provider_order_id: extracted.provider_order_id,
    raw_event_hash: sha256Hex(rawBody),
    processed_at: new Date().toISOString(),
  });
  if (state.processed_webhook_events.length > 5000) {
    state.processed_webhook_events.splice(0, state.processed_webhook_events.length - 5000);
  }
}

function issueActivationCodeFromLicense(license) {
  if (!signerSeed.trim()) {
    throw new Error('Missing AGENTSHIELD_LICENSE_SIGNING_SEED');
  }

  const issueArgs = [
    'issue',
    '--plan',
    license.plan,
    '--billing-cycle',
    license.billing_cycle,
    '--issued-at',
    license.issued_at,
    '--license-id',
    license.license_id,
    '--seed',
    signerSeed,
  ];

  if (license.expires_at) {
    issueArgs.push('--expires-at', license.expires_at);
  }
  if (license.customer_email) {
    issueArgs.push('--customer', license.customer_email);
  }

  let command;
  let args;
  if (issuerBinPath) {
    command = issuerBinPath;
    args = issueArgs;
  } else {
    command = 'cargo';
    args = [
      'run',
      '--quiet',
      '--manifest-path',
      path.join(repoRoot, 'src-tauri', 'Cargo.toml'),
      '--bin',
      'issue_activation_code',
      '--',
      ...issueArgs,
    ];
  }

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 4,
  });

  if (result.status !== 0) {
    throw new Error(
      `issue_activation_code failed: ${result.stderr?.trim() || result.stdout?.trim() || 'unknown error'}`,
    );
  }

  const payload = JSON.parse(result.stdout.trim());
  if (typeof payload.code !== 'string' || !payload.code.startsWith('AGSH.')) {
    throw new Error('issuer returned invalid activation code');
  }
  return payload.code;
}

async function trySendActivationCodeEmail({ license, activationCode }) {
  if (!license.customer_email) {
    state.metrics.delivery_email_failed_total += 1;
    return { sent: false, reason: 'customer_email_missing' };
  }

  if (!resendApiKey.trim() || !deliveryFromEmail.trim()) {
    state.metrics.delivery_email_failed_total += 1;
    addAuditLog({
      actor: 'license-gateway',
      action: 'delivery.email_skipped',
      target_type: 'license',
      target_id: license.license_id,
      payload: { reason: 'email_provider_not_configured' },
    });
    return { sent: false, reason: 'email_provider_not_configured' };
  }

  const expiryLabel = license.expires_at
    ? new Date(license.expires_at).toISOString()
    : 'Never';
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; line-height: 1.5;">
      <h2>AgentShield Activation Code</h2>
      <p>Your activation code is ready. Copy the code below and paste it into AgentShield.</p>
      <p><strong>Plan:</strong> ${escapeHtml(license.billing_cycle)}</p>
      <p><strong>Expires at:</strong> ${escapeHtml(expiryLabel)}</p>
      <pre style="padding: 12px; background: #0f172a; color: #f8fafc; border-radius: 8px; overflow:auto;">${escapeHtml(activationCode)}</pre>
      <p>If you did not request this code, please contact support.</p>
    </div>
  `;

  const payload = {
    from: deliveryFromEmail,
    to: [license.customer_email],
    subject: `AgentShield activation code (${license.billing_cycle})`,
    html,
  };
  if (deliveryReplyTo.trim()) {
    payload.reply_to = deliveryReplyTo;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`resend_http_${response.status}: ${errorText}`);
    }

    recordDelivery(license.license_id, 'email', license.customer_email);
    return { sent: true };
  } catch (error) {
    state.metrics.delivery_email_failed_total += 1;
    addAuditLog({
      actor: 'license-gateway',
      action: 'delivery.email_failed',
      target_type: 'license',
      target_id: license.license_id,
      payload: { reason: String(error) },
    });
    return { sent: false, reason: String(error) };
  }
}

function recordDelivery(licenseId, channel, deliveredTo) {
  state.license_deliveries.push({
    id: createId('delivery'),
    license_id: licenseId,
    channel,
    delivered_to: deliveredTo || null,
    delivered_at: new Date().toISOString(),
  });
}

function addAuditLog({ actor, action, target_type, target_id, payload }) {
  state.audit_logs.push({
    id: createId('audit'),
    actor,
    action,
    target_type,
    target_id,
    payload,
    created_at: new Date().toISOString(),
  });
}

function recordWebhookFailure({
  reason,
  raw_event_hash,
  details = null,
  provider_order_id = null,
}) {
  state.webhook_failures.push({
    id: createId('whf'),
    reason,
    raw_event_hash,
    details,
    provider_order_id,
    created_at: new Date().toISOString(),
  });
}

function requireAdmin(req, res) {
  if (!adminPassword.trim()) {
    sendJson(res, 503, { error: 'Admin API disabled: LICENSE_GATEWAY_ADMIN_PASSWORD is empty' });
    return false;
  }

  // Add RFC-compliant challenge so browsers show the Basic Auth login prompt.
  const setAuthChallenge = () => {
    res.setHeader('WWW-Authenticate', 'Basic realm="AgentShield Admin", charset="UTF-8"');
  };

  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Basic ')) {
    setAuthChallenge();
    sendJson(res, 401, { error: 'Missing Basic authorization header' });
    return false;
  }

  const encoded = authHeader.slice('Basic '.length);
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    setAuthChallenge();
    sendJson(res, 401, { error: 'Malformed authorization header' });
    return false;
  }

  const [username, password] = decoded.split(':');
  if (username !== adminUsername || password !== adminPassword) {
    // Keep challenge on wrong credentials so browser can re-prompt login dialog.
    setAuthChallenge();
    sendJson(res, 401, { error: 'Invalid admin credentials' });
    return false;
  }

  return true;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, creem-signature, X-Signature',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.end(JSON.stringify(payload));
}

function actorFromRequest(req) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Basic ')) {
    return 'admin:unknown';
  }
  const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
  const [username] = decoded.split(':');
  return `admin:${username ?? 'unknown'}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolvePath(inputPath, defaultPath) {
  if (!inputPath) {
    return defaultPath;
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(repoRoot, inputPath);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
