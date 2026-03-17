import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const STATE_KEY = 'license-gateway-state';
const SINGLETON_NAME = 'singleton';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const initialState = {
  orders: [],
  licenses: [],
  license_deliveries: [],
  audit_logs: [],
  webhook_failures: [],
  processed_webhook_events: [],
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
  },
};

export default {
  async fetch(request, env) {
    const id = env.LICENSE_GATEWAY.idFromName(SINGLETON_NAME);
    return env.LICENSE_GATEWAY.get(id).fetch(request);
  },
};

export class LicenseGatewayDurableObject {
  constructor(state, env) {
    this.ctx = state;
    this.env = env;
    this.data = null;
    this.defaultSkuBillingMap = new Map([
      ['AGSH_PRO_30D', 'monthly'],
      ['AGSH_PRO_365D', 'yearly'],
      ['AGSH_PRO_LIFETIME', 'lifetime'],
    ]);
  }

  readEnvString(name, fallback = '') {
    const raw = this.env?.[name] ?? fallback;
    let value = String(raw ?? '').trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1).trim();
      }
    }
    return value;
  }

  async fetch(request) {
    this.data = await this.loadState();
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return this.json(204, {});
    }

    if (request.method === 'GET' && pathname === '/health') {
      return this.json(200, {
        ok: true,
        service: 'license-gateway-worker',
        now: new Date().toISOString(),
        metrics: this.data.metrics,
      });
    }

    if (request.method === 'POST' && pathname === '/webhooks/creem') {
      return this.handleCreemWebhook(request);
    }

    if (request.method === 'POST' && pathname === '/client/licenses/verify') {
      return this.handleClientLicenseVerify(request);
    }

    if (!pathname.startsWith('/admin/')) {
      return this.json(404, { error: 'Not Found' });
    }

    const admin = this.requireAdmin(request);
    if (!admin.ok) {
      return admin.response;
    }

    if (request.method === 'GET' && pathname === '/admin/licenses') {
      return this.handleAdminListLicenses(url);
    }

    if (request.method === 'GET' && pathname === '/admin/webhook-failures') {
      return this.json(200, {
        total: this.data.webhook_failures.length,
        items: this.data.webhook_failures.slice(-100).reverse(),
      });
    }

    const reissueMatch = pathname.match(/^\/admin\/licenses\/([^/]+)\/reissue$/);
    if (request.method === 'POST' && reissueMatch) {
      return this.handleAdminReissueLicense(request, decodeURIComponent(reissueMatch[1]));
    }

    const revokeMatch = pathname.match(/^\/admin\/licenses\/([^/]+)\/revoke$/);
    if (request.method === 'POST' && revokeMatch) {
      return this.handleAdminRevokeLicense(request, decodeURIComponent(revokeMatch[1]));
    }

    return this.json(404, { error: 'Not Found' });
  }

  async handleCreemWebhook(request) {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const providedSignature =
      request.headers.get('creem-signature') ?? request.headers.get('X-Signature') ?? '';

    if (!this.verifyWebhookSignature(rawBody, providedSignature)) {
      this.data.metrics.webhook_verify_failed_total += 1;
      this.recordWebhookFailure({
        reason: 'invalid_signature',
        raw_event_hash: this.sha256Hex(rawBody),
      });
      await this.saveState();
      return this.json(401, { error: 'Invalid webhook signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      this.recordWebhookFailure({
        reason: 'invalid_json',
        raw_event_hash: this.sha256Hex(rawBody),
      });
      await this.saveState();
      return this.json(400, { error: 'Invalid JSON payload' });
    }

    let extracted;
    try {
      extracted = this.extractCreemOrder(payload);
    } catch (error) {
      this.recordWebhookFailure({
        reason: 'invalid_payload',
        raw_event_hash: this.sha256Hex(rawBody),
        details: String(error),
      });
      await this.saveState();
      return this.json(400, { error: String(error) });
    }

    if (extracted.event_id && this.hasProcessedWebhookEvent(extracted.event_id)) {
      this.data.metrics.webhook_duplicate_total += 1;
      this.addAuditLog({
        actor: 'creem:webhook',
        action: 'event.duplicate',
        target_type: 'event',
        target_id: extracted.event_id,
        payload: {
          event_name: extracted.event_name,
          provider_order_id: extracted.provider_order_id,
        },
      });
      await this.saveState();
      return this.json(200, {
        ok: true,
        duplicate: true,
        event_id: extracted.event_id,
        event_name: extracted.event_name,
      });
    }

    let response;
    if (extracted.event_name === 'checkout.completed') {
      response = await this.handleCheckoutCompletedWebhook(extracted, rawBody);
    } else if (extracted.event_name === 'refund.created') {
      response = await this.handleRefundWebhook(extracted, rawBody);
    } else if (this.isSubscriptionLifecycleEvent(extracted.event_name)) {
      response = await this.handleSubscriptionWebhook(extracted, rawBody);
    } else {
      response = this.json(202, {
        ok: true,
        ignored: true,
        event_name: extracted.event_name,
      });
    }

    this.markWebhookEventProcessed(extracted, rawBody);
    await this.saveState();
    return response;
  }

  async handleCheckoutCompletedWebhook(extracted, rawBody) {
    const existingOrder = this.data.orders.find(
      (order) =>
        order.provider === 'creem' &&
        order.provider_order_id === extracted.provider_order_id,
    );

    if (existingOrder) {
      this.data.metrics.webhook_duplicate_total += 1;
      this.addAuditLog({
        actor: 'creem:webhook',
        action: 'order.duplicate',
        target_type: 'order',
        target_id: extracted.provider_order_id,
        payload: { raw_event_hash: this.sha256Hex(rawBody) },
      });
      return this.json(200, {
        ok: true,
        duplicate: true,
        provider_order_id: extracted.provider_order_id,
      });
    }

    const order = {
      id: this.createId('ord'),
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
      raw_event_hash: this.sha256Hex(rawBody),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.orders.push(order);
    this.data.metrics.orders_created_total += 1;

    try {
      const issuedAt = new Date().toISOString();
      const billingCycle = this.resolveBillingCycle(extracted);
      const expiresAt = this.resolveExpiresAt(issuedAt, billingCycle);
      const licenseId = this.createId('lic');
      const license = {
        id: this.createId('row'),
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
      };
      const activationCode = this.issueActivationCodeFromLicense(license);
      license.issued_code_hash = this.sha256Hex(activationCode);
      this.data.licenses.push(license);
      this.data.metrics.licenses_issued_total += 1;

      this.recordDelivery(license.license_id, 'checkout_page', license.customer_email);
      const emailResult = await this.trySendActivationCodeEmail({ license, activationCode });
      this.addAuditLog({
        actor: 'creem:webhook',
        action: 'license.issue',
        target_type: 'license',
        target_id: license.license_id,
        payload: {
          provider_order_id: license.provider_order_id,
          billing_cycle: license.billing_cycle,
        },
      });

      return this.json(200, {
        ok: true,
        provider_order_id: order.provider_order_id,
        license_id: license.license_id,
        customer_email: license.customer_email,
        expires_at: license.expires_at,
        email_sent: emailResult.sent,
        email_error: emailResult.sent ? null : emailResult.reason,
      });
    } catch (error) {
      this.recordWebhookFailure({
        reason: 'license_issue_failed',
        raw_event_hash: order.raw_event_hash,
        details: String(error),
        provider_order_id: order.provider_order_id,
      });
      return this.json(500, { error: String(error) });
    }
  }

  async handleClientLicenseVerify(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return this.json(400, { ok: false, error: 'Invalid JSON payload' });
    }

    const activationCode = String(payload?.activation_code ?? '').trim();
    if (!activationCode) {
      return this.json(400, { ok: false, error: 'Missing activation_code.' });
    }

    const licenseId = this.extractLicenseIdFromActivationCode(activationCode) ?? '';
    if (!licenseId) {
      return this.json(400, { ok: false, error: 'Invalid activation_code.' });
    }

    const now = new Date().toISOString();
    const license = this.data.licenses.find((item) => item.license_id === licenseId);
    if (!license) {
      return this.json(200, {
        ok: true,
        found: false,
        checked_at: now,
        license: null,
      });
    }

    const order = this.data.orders.find(
      (item) => item.provider_order_id === license.provider_order_id,
    );

    if (order?.payment_status === 'refunded' && license.status === 'active') {
      license.status = 'revoked';
      license.revoked_at = now;
      license.notes = 'revoked_by:client_reconcile_refund';
      this.data.metrics.licenses_revoked_total += 1;
      this.data.metrics.licenses_revoked_by_refund_total += 1;
      this.addAuditLog({
        actor: 'client:verify',
        action: 'license.reconcile_refund_revoke',
        target_type: 'license',
        target_id: license.license_id,
        payload: { provider_order_id: license.provider_order_id },
      });
      await this.saveState();
    }

    return this.json(200, {
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

  async handleRefundWebhook(extracted, rawBody) {
    const now = new Date().toISOString();
    let order = this.data.orders.find(
      (item) => item.provider === 'creem' && item.provider_order_id === extracted.provider_order_id,
    );

    if (order) {
      order.payment_status = 'refunded';
      order.provider_subscription_id = extracted.provider_subscription_id || order.provider_subscription_id || null;
      order.product_id = extracted.product_id || order.product_id || null;
      order.product_billing_type = extracted.product_billing_type || order.product_billing_type || null;
      order.product_billing_period = extracted.product_billing_period || order.product_billing_period || null;
      order.updated_at = now;
    } else {
      this.data.metrics.refund_events_without_order_total += 1;
      order = {
        id: this.createId('ord'),
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
        raw_event_hash: this.sha256Hex(rawBody),
        created_at: now,
        updated_at: now,
      };
      this.data.orders.push(order);
      this.data.metrics.orders_created_total += 1;
    }

    const activeLicenses = this.data.licenses.filter(
      (license) =>
        license.provider_order_id === extracted.provider_order_id &&
        license.status === 'active',
    );

    for (const license of activeLicenses) {
      license.status = 'revoked';
      license.revoked_at = now;
      license.notes = `revoked_by:${extracted.event_name}`;
      this.addAuditLog({
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
      this.addAuditLog({
        actor: 'creem:webhook',
        action: 'order.refunded_no_active_license',
        target_type: 'order',
        target_id: extracted.provider_order_id,
        payload: { event_name: extracted.event_name },
      });
    }

    this.data.metrics.refund_events_total += 1;
    this.data.metrics.licenses_revoked_total += activeLicenses.length;
    this.data.metrics.licenses_revoked_by_refund_total += activeLicenses.length;

    return this.json(200, {
      ok: true,
      event_name: extracted.event_name,
      provider_order_id: extracted.provider_order_id,
      revoked_count: activeLicenses.length,
    });
  }

  async handleSubscriptionWebhook(extracted, rawBody) {
    const now = new Date().toISOString();
    let order = this.data.orders.find(
      (item) => item.provider === 'creem' && item.provider_order_id === extracted.provider_order_id,
    );

    if (!order) {
      order = {
        id: this.createId('ord'),
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
        raw_event_hash: this.sha256Hex(rawBody),
        created_at: now,
        updated_at: now,
      };
      this.data.orders.push(order);
      this.data.metrics.orders_created_total += 1;
    } else {
      order.provider_subscription_id = extracted.provider_subscription_id || order.provider_subscription_id || null;
      order.provider_customer_id = extracted.provider_customer_id || order.provider_customer_id || null;
      order.customer_email = extracted.customer_email || order.customer_email || null;
      order.sku_code = extracted.sku_code || order.sku_code || null;
      order.product_id = extracted.product_id || order.product_id || null;
      order.product_billing_type = extracted.product_billing_type || order.product_billing_type || null;
      order.product_billing_period = extracted.product_billing_period || order.product_billing_period || null;
      order.currency = extracted.currency || order.currency || null;
      order.amount_total = extracted.amount_total || order.amount_total || 0;
      order.payment_status = extracted.payment_status || order.payment_status;
      order.updated_at = now;
    }

    const activeLicenses = this.data.licenses.filter(
      (license) =>
        license.provider_order_id === extracted.provider_order_id &&
        license.status === 'active',
    );

    if (extracted.event_name === 'subscription.paid') {
      if (activeLicenses.length === 0) {
        this.data.metrics.subscription_events_without_license_total += 1;
        this.addAuditLog({
          actor: 'creem:webhook',
          action: 'subscription.paid_no_active_license',
          target_type: 'order',
          target_id: extracted.provider_order_id,
          payload: { event_name: extracted.event_name },
        });
        this.data.metrics.subscription_events_total += 1;
        return this.json(202, {
          ok: true,
          ignored: true,
          reason: 'subscription_paid_without_active_license',
          provider_order_id: extracted.provider_order_id,
        });
      }

      const resolvedCycle = this.resolveBillingCycle(extracted, activeLicenses[0].billing_cycle);
      for (const license of activeLicenses) {
        const renewalAnchor = this.resolveRenewalAnchor(now, license.expires_at);
        const renewedExpiresAt = this.resolveExpiresAt(renewalAnchor, resolvedCycle);
        license.billing_cycle = resolvedCycle;
        license.status = 'active';
        license.revoked_at = null;
        license.expires_at = renewedExpiresAt;
        license.notes = `renewed_by:${extracted.event_name}`;
        this.addAuditLog({
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
      this.data.metrics.subscription_events_total += 1;
      this.data.metrics.licenses_extended_total += activeLicenses.length;
      return this.json(200, {
        ok: true,
        event_name: extracted.event_name,
        provider_order_id: extracted.provider_order_id,
        extended_count: activeLicenses.length,
        billing_cycle: resolvedCycle,
      });
    }

    if (extracted.event_name === 'subscription.expired') {
      for (const license of activeLicenses) {
        license.status = 'revoked';
        license.revoked_at = now;
        license.notes = `revoked_by:${extracted.event_name}`;
        this.addAuditLog({
          actor: 'creem:webhook',
          action: 'license.revoke_subscription_expired',
          target_type: 'license',
          target_id: license.license_id,
          payload: { provider_order_id: extracted.provider_order_id },
        });
      }
      order.payment_status = 'expired';
      order.updated_at = now;
      this.data.metrics.subscription_events_total += 1;
      this.data.metrics.subscription_state_updates_total += 1;
      this.data.metrics.licenses_revoked_total += activeLicenses.length;
      return this.json(200, {
        ok: true,
        event_name: extracted.event_name,
        provider_order_id: extracted.provider_order_id,
        revoked_count: activeLicenses.length,
      });
    }

    if (extracted.event_name === 'subscription.canceled') {
      for (const license of activeLicenses) {
        if (extracted.subscription_period_end_at && license.billing_cycle !== 'lifetime') {
          license.expires_at = extracted.subscription_period_end_at;
        }
        license.notes = `updated_by:${extracted.event_name}`;
        this.addAuditLog({
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
      this.data.metrics.subscription_events_total += 1;
      this.data.metrics.subscription_state_updates_total += 1;
      return this.json(200, {
        ok: true,
        event_name: extracted.event_name,
        provider_order_id: extracted.provider_order_id,
        updated_count: activeLicenses.length,
        subscription_period_end_at: extracted.subscription_period_end_at,
      });
    }

    order.payment_status = extracted.payment_status || order.payment_status;
    order.updated_at = now;
    this.data.metrics.subscription_events_total += 1;
    this.data.metrics.subscription_state_updates_total += 1;
    this.addAuditLog({
      actor: 'creem:webhook',
      action: 'subscription.lifecycle_acked',
      target_type: 'order',
      target_id: extracted.provider_order_id,
      payload: { event_name: extracted.event_name },
    });
    return this.json(200, {
      ok: true,
      event_name: extracted.event_name,
      provider_order_id: extracted.provider_order_id,
      acked: true,
    });
  }

  handleAdminListLicenses(url) {
    const email = url.searchParams.get('email');
    const status = url.searchParams.get('status');
    const licenseId = url.searchParams.get('license_id');
    const providerOrderId = url.searchParams.get('provider_order_id');
    const items = this.data.licenses.filter((license) => {
      if (email && license.customer_email !== email) return false;
      if (status && license.status !== status) return false;
      if (licenseId && license.license_id !== licenseId) return false;
      if (providerOrderId && license.provider_order_id !== providerOrderId) return false;
      return true;
    });
    return this.json(200, { total: items.length, items });
  }

  async handleAdminReissueLicense(request, targetLicenseId) {
    const target = this.data.licenses.find((license) => license.license_id === targetLicenseId);
    if (!target) {
      return this.json(404, { error: 'License not found' });
    }
    if (target.status === 'revoked') {
      return this.json(409, { error: 'License already revoked' });
    }

    const now = new Date().toISOString();
    const replacement = {
      id: this.createId('row'),
      license_id: this.createId('lic'),
      provider_order_id: target.provider_order_id,
      provider_subscription_id: target.provider_subscription_id,
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

    const code = this.issueActivationCodeFromLicense(replacement);
    replacement.issued_code_hash = this.sha256Hex(code);

    target.status = 'replaced';
    target.revoked_at = now;
    target.notes = `reissued_to:${replacement.license_id}`;

    this.data.licenses.push(replacement);
    this.data.metrics.licenses_issued_total += 1;
    this.data.metrics.licenses_reissued_total += 1;
    this.recordDelivery(replacement.license_id, 'manual_resend', replacement.customer_email);
    const emailResult = await this.trySendActivationCodeEmail({ license: replacement, activationCode: code });
    this.addAuditLog({
      actor: this.actorFromRequest(request),
      action: 'license.reissue',
      target_type: 'license',
      target_id: target.license_id,
      payload: {
        replacement_license_id: replacement.license_id,
        provider_order_id: replacement.provider_order_id,
      },
    });
    await this.saveState();
    return this.json(200, {
      ok: true,
      old_license_id: target.license_id,
      replacement_license_id: replacement.license_id,
      activation_code: code,
      email_sent: emailResult.sent,
      email_error: emailResult.sent ? null : emailResult.reason,
    });
  }

  async handleAdminRevokeLicense(request, targetLicenseId) {
    const target = this.data.licenses.find((license) => license.license_id === targetLicenseId);
    if (!target) {
      return this.json(404, { error: 'License not found' });
    }

    if (target.status !== 'revoked') {
      target.status = 'revoked';
      target.revoked_at = new Date().toISOString();
      target.notes = 'revoked_by:admin';
      this.data.metrics.licenses_revoked_total += 1;
      this.addAuditLog({
        actor: this.actorFromRequest(request),
        action: 'license.revoke',
        target_type: 'license',
        target_id: target.license_id,
        payload: { provider_order_id: target.provider_order_id },
      });
      await this.saveState();
    }

    return this.json(200, {
      ok: true,
      license_id: target.license_id,
      status: target.status,
      revoked_at: target.revoked_at,
    });
  }

  async loadState() {
    const stored = await this.ctx.storage.get(STATE_KEY);
    if (!stored || typeof stored !== 'object') {
      return structuredClone(initialState);
    }
    return {
      ...structuredClone(initialState),
      ...stored,
      metrics: {
        ...initialState.metrics,
        ...(stored.metrics ?? {}),
      },
    };
  }

  async saveState() {
    await this.ctx.storage.put(STATE_KEY, this.data);
  }

  requireAdmin(request) {
    const adminPassword = this.readEnvString('LICENSE_GATEWAY_ADMIN_PASSWORD');
    const adminUsername = this.readEnvString('LICENSE_GATEWAY_ADMIN_USERNAME', 'admin') || 'admin';
    if (!adminPassword) {
      return {
        ok: false,
        response: this.json(503, { error: 'Admin API disabled: LICENSE_GATEWAY_ADMIN_PASSWORD is empty' }),
      };
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Basic ')) {
      return { ok: false, response: this.json(401, { error: 'Missing Basic authorization header' }) };
    }

    let decoded;
    try {
      decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
    } catch {
      return { ok: false, response: this.json(401, { error: 'Malformed authorization header' }) };
    }

    const [username, password] = decoded.split(':');
    if (username !== adminUsername || password !== adminPassword) {
      return { ok: false, response: this.json(403, { error: 'Invalid admin credentials' }) };
    }

    return { ok: true };
  }

  actorFromRequest(request) {
    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Basic ')) {
      return 'admin:unknown';
    }
    const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
    const [username] = decoded.split(':');
    return `admin:${username ?? 'unknown'}`;
  }

  verifyWebhookSignature(rawBody, providedSignature) {
    const secret = this.readEnvString('CREEM_WEBHOOK_SECRET');
    if (!secret || !providedSignature.trim()) {
      return false;
    }
    const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return this.safeTimingEqual(providedSignature.trim().toLowerCase(), expectedSignature);
  }

  safeTimingEqual(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
      return false;
    }
    return crypto.timingSafeEqual(left, right);
  }

  extractCreemOrder(payload) {
    const eventName = String(payload?.eventType ?? payload?.type ?? 'unknown').trim() || 'unknown';
    const object = payload?.object ?? payload?.data ?? {};
    const orderNode = object?.order ?? object?.transaction?.order ?? {};
    const customerNode = object?.customer ?? {};
    const subscriptionObject = object?.object === 'subscription' ? object : object?.subscription ?? {};
    const productNode = object?.product ?? subscriptionObject?.product ?? object?.checkout?.product ?? {};
    const metadata = object?.metadata ?? {};
    const subscriptionNode = subscriptionObject;
    const providerSubscriptionId = String(
      this.readNodeId(subscriptionNode) ?? object?.subscription_id ?? '',
    ).trim();

    const providerOrderId = this.resolveProviderOrderId({
      eventName,
      object,
      orderNode,
      subscriptionNode,
      providerSubscriptionId,
    });
    if (!providerOrderId) {
      throw new Error('Missing provider order ID in webhook payload');
    }

    const productBillingType = String(productNode?.billing_type ?? object?.billing_type ?? '').trim();
    const productBillingPeriod = String(
      productNode?.billing_period ?? subscriptionNode?.billing_period ?? object?.billing_period ?? '',
    ).trim();

    const customerEmail = String(
      customerNode?.email ?? object?.customer_email ?? metadata?.user_email_hint ?? '',
    ).trim();

    const skuCode = String(
      metadata?.sku_code ?? metadata?.plan ?? metadata?.sku ?? productNode?.name ?? productNode?.id ?? 'AGSH_PRO_30D',
    ).trim();

    const amountTotal = Number(
      orderNode?.amount ?? object?.transaction?.amount_paid ?? object?.refund_amount ?? productNode?.price ?? 0,
    );

    const paymentStatus = String(
      orderNode?.status ??
        object?.transaction?.status ??
        object?.status ??
        subscriptionNode?.status ??
        this.inferPaymentStatusFromEvent(eventName) ??
        'paid',
    ).trim().toLowerCase();

    const productId = String(this.readNodeId(productNode) ?? object?.product_id ?? '').trim();
    const eventId = String(payload?.id ?? payload?.event_id ?? '').trim();
    const subscriptionPeriodEndAt = this.normalizeIsoDatetime(
      subscriptionNode?.current_period_end_date ?? object?.current_period_end_date ?? null,
    );

    return {
      event_id: eventId || null,
      event_name: eventName,
      provider_order_id: providerOrderId,
      provider_subscription_id: providerSubscriptionId || null,
      provider_customer_id: String(this.readNodeId(customerNode) ?? object?.customer_id ?? '').trim(),
      customer_email: customerEmail,
      sku_code: skuCode,
      product_id: productId || null,
      product_billing_type: productBillingType || null,
      product_billing_period: productBillingPeriod || null,
      currency: String(
        orderNode?.currency ?? object?.transaction?.currency ?? productNode?.currency ?? object?.refund_currency ?? 'USD',
      ).toUpperCase(),
      amount_total: Number.isFinite(amountTotal) ? amountTotal : 0,
      payment_status: paymentStatus || 'paid',
      subscription_period_end_at: subscriptionPeriodEndAt,
    };
  }

  readNodeId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.id === 'string') return value.id;
    return null;
  }

  resolveProviderOrderId({ eventName, object, orderNode, subscriptionNode, providerSubscriptionId }) {
    if (
      providerSubscriptionId &&
      (this.isSubscriptionLifecycleEvent(eventName) || eventName === 'checkout.completed' || eventName === 'refund.created')
    ) {
      return providerSubscriptionId;
    }

    const orderId = String(
      this.readNodeId(orderNode) ?? object?.order_id ?? object?.checkout_id ?? object?.transaction_id ?? '',
    ).trim();
    if (orderId) return orderId;
    if (providerSubscriptionId) return providerSubscriptionId;
    return String(object?.id ?? this.readNodeId(subscriptionNode) ?? '').trim();
  }

  resolveBillingCycle(extracted, fallbackCycle = null) {
    const skuBillingMap = this.loadBillingMapFromJsonEnv(
      this.env.CREEM_SKU_BILLING_MAP_JSON,
      'CREEM_SKU_BILLING_MAP_JSON',
      this.defaultSkuBillingMap,
    );
    const productBillingMap = this.loadBillingMapFromJsonEnv(
      this.env.CREEM_PRODUCT_BILLING_MAP_JSON,
      'CREEM_PRODUCT_BILLING_MAP_JSON',
    );
    const strictBillingResolution = this.readEnvString('CREEM_STRICT_BILLING_RESOLUTION', '1') !== '0';

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
      const recurringCycle = this.resolveRecurringPeriodToCycle(productBillingPeriod);
      if (recurringCycle) return recurringCycle;
    }
    if (fallbackCycle && this.isValidBillingCycle(fallbackCycle)) {
      return fallbackCycle;
    }
    if (!strictBillingResolution) {
      return this.inferBillingCycleFromSkuOrName(skuCode);
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

  resolveExpiresAt(issuedAt, billingCycle) {
    if (billingCycle === 'lifetime') return null;
    const issuedAtMs = new Date(issuedAt).getTime();
    const days = billingCycle === 'yearly' ? 365 : 30;
    return new Date(issuedAtMs + days * 24 * 60 * 60 * 1000).toISOString();
  }

  resolveRenewalAnchor(nowIso, currentExpiresAt) {
    const nowMs = Date.parse(nowIso);
    const expiresMs = Date.parse(String(currentExpiresAt ?? ''));
    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
      return new Date(expiresMs).toISOString();
    }
    return nowIso;
  }

  resolveRecurringPeriodToCycle(value) {
    const normalized = String(value ?? '').toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('year') || normalized.includes('annual')) return 'yearly';
    if (normalized.includes('month')) return 'monthly';
    return null;
  }

  inferBillingCycleFromSkuOrName(value) {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized.includes('lifetime') || normalized.includes('forever') || normalized.includes('permanent')) {
      return 'lifetime';
    }
    if (normalized.includes('365') || normalized.includes('year') || normalized.includes('annual')) {
      return 'yearly';
    }
    return 'monthly';
  }

  isValidBillingCycle(value) {
    return value === 'monthly' || value === 'yearly' || value === 'lifetime';
  }

  normalizeBillingCycle(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'month' || normalized === 'monthly') return 'monthly';
    if (normalized === 'year' || normalized === 'annual' || normalized === 'yearly') return 'yearly';
    if (normalized === 'lifetime' || normalized === 'forever' || normalized === 'permanent') return 'lifetime';
    return null;
  }

  loadBillingMapFromJsonEnv(rawValue, envName, defaults = new Map()) {
    const map = new Map(defaults);
    const trimmed = this.readEnvString(envName, rawValue ?? '');
    if (!trimmed) {
      return map;
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`[license-gateway] failed to parse ${envName}: must be a JSON object`);
    }
    for (const [rawKey, rawCycle] of Object.entries(parsed)) {
      const key = String(rawKey ?? '').trim();
      const cycle = this.normalizeBillingCycle(rawCycle);
      if (!key) continue;
      if (!cycle) {
        throw new Error(`[license-gateway] failed to parse ${envName}: invalid cycle for key "${key}"`);
      }
      const normalizedKey = envName.includes('PRODUCT') ? key.toLowerCase() : key.toUpperCase();
      map.set(normalizedKey, cycle);
    }
    return map;
  }

  isSubscriptionLifecycleEvent(eventName) {
    return eventName.startsWith('subscription.');
  }

  inferPaymentStatusFromEvent(eventName) {
    if (eventName === 'refund.created') return 'refunded';
    if (eventName === 'subscription.canceled') return 'cancelled';
    if (eventName === 'subscription.expired') return 'expired';
    if (eventName === 'subscription.paused') return 'paused';
    if (eventName === 'subscription.paid' || eventName === 'checkout.completed') return 'paid';
    return null;
  }

  normalizeIsoDatetime(value) {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) return null;
    return new Date(parsed).toISOString();
  }

  hasProcessedWebhookEvent(eventId) {
    if (!eventId) return false;
    return this.data.processed_webhook_events.some((item) => item.event_id === eventId);
  }

  markWebhookEventProcessed(extracted, rawBody) {
    const eventId = extracted.event_id;
    if (!eventId) return;
    this.data.processed_webhook_events.push({
      event_id: eventId,
      event_name: extracted.event_name,
      provider_order_id: extracted.provider_order_id,
      raw_event_hash: this.sha256Hex(rawBody),
      processed_at: new Date().toISOString(),
    });
    if (this.data.processed_webhook_events.length > 5000) {
      this.data.processed_webhook_events.splice(0, this.data.processed_webhook_events.length - 5000);
    }
  }

  issueActivationCodeFromLicense(license) {
    const signerSeed = this.readEnvString('AGENTSHIELD_LICENSE_SIGNING_SEED');
    if (!signerSeed) {
      throw new Error('Missing AGENTSHIELD_LICENSE_SIGNING_SEED');
    }
    const payload = {
      plan: license.plan,
      billing_cycle: license.billing_cycle,
      expires_at: license.expires_at,
      issued_at: license.issued_at,
      license_id: license.license_id,
      customer: license.customer_email,
    };
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) {
        delete payload[key];
      }
    }
    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    const seed = this.decodeSeed(signerSeed);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = crypto.sign(null, payloadBytes, privateKey);
    return `AGSH.${payloadBytes.toString('base64url')}.${Buffer.from(signature).toString('base64url')}`;
  }

  decodeSeed(input) {
    const trimmed = String(input ?? '').trim();
    if (!trimmed) {
      throw new Error('Signing seed is empty.');
    }
    let decoded = null;
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      decoded = Buffer.from(trimmed, 'hex');
    } else {
      decoded = this.tryDecodeBase64Url(trimmed) ?? this.tryDecodeBase64(trimmed);
    }
    if (!decoded || decoded.length !== 32) {
      throw new Error('Signing seed must decode to exactly 32 bytes.');
    }
    return decoded;
  }

  tryDecodeBase64Url(value) {
    try {
      const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
      const paddingNeeded = (4 - (normalized.length % 4)) % 4;
      return Buffer.from(normalized + '='.repeat(paddingNeeded), 'base64');
    } catch {
      return null;
    }
  }

  tryDecodeBase64(value) {
    try {
      return Buffer.from(value, 'base64');
    } catch {
      return null;
    }
  }

  extractLicenseIdFromActivationCode(activationCode) {
    const parts = activationCode.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'AGSH') {
      return null;
    }
    try {
      const payloadJson = this.decodeBase64UrlToUtf8(parts[1]);
      const payload = JSON.parse(payloadJson);
      const licenseId = String(payload?.license_id ?? '').trim();
      return licenseId || null;
    } catch {
      return null;
    }
  }

  decodeBase64UrlToUtf8(input) {
    const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
    const paddingNeeded = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(paddingNeeded);
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  async trySendActivationCodeEmail({ license, activationCode }) {
    if (!license.customer_email) {
      this.data.metrics.delivery_email_failed_total += 1;
      return { sent: false, reason: 'customer_email_missing' };
    }

    const resendApiKey = this.readEnvString('RESEND_API_KEY');
    const deliveryFromEmail = this.readEnvString('LICENSE_DELIVERY_FROM_EMAIL');
    const deliveryReplyTo = this.readEnvString('LICENSE_DELIVERY_REPLY_TO');
    if (!resendApiKey || !deliveryFromEmail) {
      this.data.metrics.delivery_email_failed_total += 1;
      this.addAuditLog({
        actor: 'license-gateway-worker',
        action: 'delivery.email_skipped',
        target_type: 'license',
        target_id: license.license_id,
        payload: { reason: 'email_provider_not_configured' },
      });
      return { sent: false, reason: 'email_provider_not_configured' };
    }

    const expiryLabel = license.expires_at ? new Date(license.expires_at).toISOString() : 'Never';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; line-height: 1.5;">
        <h2>AgentShield Activation Code</h2>
        <p>Your activation code is ready. Copy the code below and paste it into AgentShield.</p>
        <p><strong>Plan:</strong> ${this.escapeHtml(license.billing_cycle)}</p>
        <p><strong>Expires at:</strong> ${this.escapeHtml(expiryLabel)}</p>
        <pre style="padding: 12px; background: #0f172a; color: #f8fafc; border-radius: 8px; overflow:auto;">${this.escapeHtml(activationCode)}</pre>
        <p>If you did not request this code, please contact support.</p>
      </div>
    `;
    const payload = {
      from: deliveryFromEmail,
      to: [license.customer_email],
      subject: `AgentShield activation code (${license.billing_cycle})`,
      html,
    };
    if (deliveryReplyTo) {
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
      this.recordDelivery(license.license_id, 'email', license.customer_email);
      return { sent: true };
    } catch (error) {
      this.data.metrics.delivery_email_failed_total += 1;
      this.addAuditLog({
        actor: 'license-gateway-worker',
        action: 'delivery.email_failed',
        target_type: 'license',
        target_id: license.license_id,
        payload: { reason: String(error) },
      });
      return { sent: false, reason: String(error) };
    }
  }

  recordDelivery(licenseId, channel, deliveredTo) {
    this.data.license_deliveries.push({
      id: this.createId('delivery'),
      license_id: licenseId,
      channel,
      delivered_to: deliveredTo || null,
      delivered_at: new Date().toISOString(),
    });
  }

  addAuditLog({ actor, action, target_type, target_id, payload }) {
    this.data.audit_logs.push({
      id: this.createId('audit'),
      actor,
      action,
      target_type,
      target_id,
      payload,
      created_at: new Date().toISOString(),
    });
  }

  recordWebhookFailure({ reason, raw_event_hash, details = null, provider_order_id = null }) {
    this.data.webhook_failures.push({
      id: this.createId('whf'),
      reason,
      raw_event_hash,
      details,
      provider_order_id,
      created_at: new Date().toISOString(),
    });
  }

  sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  createId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  json(status, payload) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, creem-signature, X-Signature',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      },
    });
  }
}
