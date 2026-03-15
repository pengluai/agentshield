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
const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';
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

const initialState = {
  orders: [],
  licenses: [],
  license_deliveries: [],
  audit_logs: [],
  webhook_failures: [],
  metrics: {
    orders_created_total: 0,
    licenses_issued_total: 0,
    licenses_reissued_total: 0,
    licenses_revoked_total: 0,
    licenses_revoked_by_refund_total: 0,
    refund_events_total: 0,
    refund_events_without_order_total: 0,
    webhook_verify_failed_total: 0,
    webhook_duplicate_total: 0,
    delivery_email_failed_total: 0,
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
    '[license-gateway] LEMONSQUEEZY_WEBHOOK_SECRET is empty; webhook verification will fail until configured.',
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

    if (req.method === 'POST' && pathname === '/webhooks/lemonsqueezy') {
      await handleLemonWebhook(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/client/licenses/verify') {
      await handleClientLicenseVerify(req, res);
      return;
    }

    if (!pathname.startsWith('/admin/')) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    if (!requireAdmin(req, res)) {
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

async function handleLemonWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const signature = (req.headers['x-signature'] ?? '').toString();

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

  const extracted = extractLemonOrder(
    payload,
    (req.headers['x-event-name'] ?? '').toString(),
  );

  if (extracted.event_name === 'order_created') {
    await handleOrderCreatedWebhook(extracted, rawBody, res);
    return;
  }

  if (
    extracted.event_name === 'order_refunded' ||
    extracted.event_name === 'subscription_payment_refunded'
  ) {
    handleRefundWebhook(extracted, rawBody, res);
    return;
  }

  sendJson(res, 202, { ok: true, ignored: true, event_name: extracted.event_name });
}

async function handleOrderCreatedWebhook(extracted, rawBody, res) {
  const existingOrder = state.orders.find(
    (order) =>
      order.provider === 'lemonsqueezy' &&
      order.provider_order_id === extracted.provider_order_id,
  );

  if (existingOrder) {
    state.metrics.webhook_duplicate_total += 1;
    addAuditLog({
      actor: 'lemonsqueezy:webhook',
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
    return;
  }

  const order = {
    id: createId('ord'),
    provider: 'lemonsqueezy',
    provider_order_id: extracted.provider_order_id,
    provider_customer_id: extracted.provider_customer_id,
    customer_email: extracted.customer_email,
    sku_code: extracted.sku_code,
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
    const billingCycle = resolveBillingCycle(order.sku_code);
    const expiresAt = resolveExpiresAt(issuedAt, billingCycle);
    const licenseId = createId('lic');

    const license = {
      id: createId('row'),
      license_id: licenseId,
      provider_order_id: order.provider_order_id,
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
    };

    const activationCode = issueActivationCodeFromLicense(license);
    license.issued_code_hash = sha256Hex(activationCode);
    state.licenses.push(license);
    state.metrics.licenses_issued_total += 1;

    recordDelivery(license.license_id, 'checkout_page', license.customer_email);
    const webhookEmailResult = await trySendActivationCodeEmail({
      license,
      activationCode,
    });

    addAuditLog({
      actor: 'lemonsqueezy:webhook',
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
  } catch (error) {
    recordWebhookFailure({
      reason: 'license_issue_failed',
      raw_event_hash: order.raw_event_hash,
      details: String(error),
      provider_order_id: order.provider_order_id,
    });
    saveState();
    sendJson(res, 500, { error: String(error) });
  }
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

  if (!license) {
    sendJson(res, 200, {
      ok: true,
      found: false,
      checked_at: now,
      license: null,
    });
    return;
  }

  const order = state.orders.find(
    (item) =>
      item.provider === 'lemonsqueezy' &&
      item.provider_order_id === license.provider_order_id,
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
    },
  });
}

function handleRefundWebhook(extracted, rawBody, res) {
  const now = new Date().toISOString();
  let order = state.orders.find(
    (item) =>
      item.provider === 'lemonsqueezy' &&
      item.provider_order_id === extracted.provider_order_id,
  );

  if (order) {
    order.payment_status = 'refunded';
    order.updated_at = now;
  } else {
    state.metrics.refund_events_without_order_total += 1;
    order = {
      id: createId('ord'),
      provider: 'lemonsqueezy',
      provider_order_id: extracted.provider_order_id,
      provider_customer_id: extracted.provider_customer_id,
      customer_email: extracted.customer_email,
      sku_code: extracted.sku_code,
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
      actor: 'lemonsqueezy:webhook',
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
      actor: 'lemonsqueezy:webhook',
      action: 'order.refunded_no_active_license',
      target_type: 'order',
      target_id: extracted.provider_order_id,
      payload: {
        event_name: extracted.event_name,
      },
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

function extractLemonOrder(payload, eventNameHeader = '') {
  const eventName =
    eventNameHeader.trim() ||
    payload?.meta?.event_name ||
    payload?.event_name ||
    payload?.type ||
    'unknown';

  const data = payload?.data ?? {};
  const attributes = data?.attributes ?? {};
  const firstOrderItem = attributes?.first_order_item ?? {};
  const nestedCustomData = firstOrderItem?.custom_data ?? {};
  const customData = attributes?.custom_data ?? payload?.meta?.custom_data ?? {};
  const mergedCustomData = { ...customData, ...nestedCustomData };

  const providerOrderId = String(
    data?.id ??
      attributes?.order_id ??
      attributes?.related_order_id ??
      attributes?.order_number ??
      attributes?.identifier ??
      data?.relationships?.order?.data?.id ??
      data?.relationships?.order?.id ??
      '',
  ).trim();
  if (!providerOrderId) {
    throw new Error('Missing provider order ID in webhook payload');
  }

  const customerEmail = String(
    attributes?.user_email ??
      attributes?.customer_email ??
      mergedCustomData?.user_email_hint ??
      '',
  ).trim();

  const skuCode = String(
    mergedCustomData?.sku_code ??
      firstOrderItem?.variant_name ??
      firstOrderItem?.product_name ??
      attributes?.variant_name ??
      'AGSH_PRO_30D',
  ).trim();

  const amountTotal = Number(
    attributes?.total ??
      attributes?.subtotal ??
      firstOrderItem?.price ??
      0,
  );

  return {
    event_name: eventName,
    provider_order_id: providerOrderId,
    provider_customer_id: String(
      attributes?.customer_id ?? attributes?.user_id ?? '',
    ).trim(),
    customer_email: customerEmail,
    sku_code: skuCode,
    currency: String(attributes?.currency ?? 'USD').toUpperCase(),
    amount_total: Number.isFinite(amountTotal) ? amountTotal : 0,
    payment_status: String(attributes?.status ?? 'paid'),
  };
}

function resolveBillingCycle(skuCode) {
  const normalized = skuCode.toLowerCase();
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

function resolveExpiresAt(issuedAt, billingCycle) {
  if (billingCycle === 'lifetime') {
    return null;
  }

  const issuedAtMs = new Date(issuedAt).getTime();
  const days = billingCycle === 'yearly' ? 365 : 30;
  return new Date(issuedAtMs + days * 24 * 60 * 60 * 1000).toISOString();
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

  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Basic ')) {
    sendJson(res, 401, { error: 'Missing Basic authorization header' });
    return false;
  }

  const encoded = authHeader.slice('Basic '.length);
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    sendJson(res, 401, { error: 'Malformed authorization header' });
    return false;
  }

  const [username, password] = decoded.split(':');
  if (username !== adminUsername || password !== adminPassword) {
    sendJson(res, 403, { error: 'Invalid admin credentials' });
    return false;
  }

  return true;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Signature');
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
