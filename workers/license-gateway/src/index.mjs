import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import ADMIN_HTML from '../site/admin.html';

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
    this._currentRequest = request;
    this.data = await this.loadState();
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return this.handleCorsPreflightOrReject(request);
    }

    if (request.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      return this.serveAdminPage();
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

    if (request.method === 'POST' && pathname === '/client/proxy-token') {
      return this.handleClientProxyToken(request);
    }

    if (!pathname.startsWith('/admin/')) {
      return this.json(404, { error: 'Not Found' });
    }

    const admin = await this.requireAdmin(request);
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

    if (request.method === 'POST' && pathname === '/admin/licenses/generate') {
      return this.handleAdminGenerateLicenses(request);
    }

    if (request.method === 'GET' && pathname === '/admin/licenses/stats') {
      return this.handleAdminLicenseStats();
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

    const webhookEventKey = this.resolveWebhookEventKey(extracted, rawBody);
    if (webhookEventKey && this.hasProcessedWebhookEvent(webhookEventKey)) {
      this.data.metrics.webhook_duplicate_total += 1;
      this.addAuditLog({
        actor: 'creem:webhook',
        action: 'event.duplicate',
        target_type: 'event',
        target_id: extracted.event_id || webhookEventKey,
        payload: {
          event_name: extracted.event_name,
          provider_order_id: extracted.provider_order_id,
          event_key: webhookEventKey,
        },
      });
      await this.saveState();
      return this.json(200, {
        ok: true,
        duplicate: true,
        event_id: extracted.event_id,
        event_key: webhookEventKey,
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

    if (response.status < 500) {
      this.markWebhookEventProcessed(extracted, rawBody, webhookEventKey);
    }
    await this.saveState();
    return response;
  }

  async handleCheckoutCompletedWebhook(extracted, rawBody) {
    let order = this.data.orders.find(
      (order) =>
        order.provider === 'creem' &&
        order.provider_order_id === extracted.provider_order_id,
    );

    const existingLicense = this.data.licenses.find(
      (license) =>
        license.provider_order_id === extracted.provider_order_id &&
        license.status !== 'revoked',
    );
    if (order && existingLicense) {
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
        license_id: existingLicense.license_id,
      });
    }

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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
      order.currency = extracted.currency || order.currency || 'USD';
      order.amount_total = extracted.amount_total || order.amount_total || 0;
      order.payment_status = extracted.payment_status || order.payment_status || 'paid';
      order.raw_event_hash = this.sha256Hex(rawBody);
      order.updated_at = new Date().toISOString();
    }

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

    const activationCode = String(payload?.activation_code ?? '');
    const resolved = await this.resolveClientLicenseByActivationCode(activationCode);
    if (!resolved.ok) {
      return resolved.response;
    }

    if (resolved.stateUpdated) {
      await this.saveState();
    }

    return this.json(200, {
      ok: true,
      found: true,
      checked_at: resolved.checkedAt,
      license: this.serializeClientLicense(resolved.license),
    });
  }

  async handleClientProxyToken(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return this.json(400, { ok: false, error: 'Invalid JSON payload' });
    }

    const activationCode = String(payload?.activation_code ?? '');
    const rateLimit = await this.checkClientProxyTokenRateLimit(request, activationCode);
    if (!rateLimit.ok) {
      return this.json(rateLimit.status, {
        ok: false,
        error: rateLimit.error,
        retry_after_seconds: rateLimit.retryAfterSeconds,
      });
    }

    const resolved = await this.resolveClientLicenseByActivationCode(activationCode, {
      preserveUnknownAsNotFound: false,
    });
    if (!resolved.ok) {
      return resolved.response;
    }

    const license = resolved.license;
    if (license.status !== 'active') {
      if (resolved.stateUpdated) {
        await this.saveState();
      }
      return this.json(403, {
        ok: false,
        error: 'License is not active.',
        status: license.status,
      });
    }

    const plan = String(license.plan ?? '').trim().toLowerCase();
    if (plan !== 'pro' && plan !== 'enterprise') {
      return this.json(403, {
        ok: false,
        error: 'AI features require Pro license.',
      });
    }

    let token;
    try {
      token = this.issueProxyAccessToken(license);
    } catch (error) {
      return this.json(503, {
        ok: false,
        error: 'Proxy token service unavailable.',
      });
    }

    this.addAuditLog({
      actor: 'client:token',
      action: 'proxy_token.issue',
      target_type: 'license',
      target_id: license.license_id,
      payload: {
        jti: token.jti,
        exp: token.exp,
      },
    });
    await this.saveState();

    return this.json(200, {
      ok: true,
      token_type: 'Bearer',
      access_token: token.accessToken,
      expires_in: token.expiresIn,
      expires_at: token.expiresAtIso,
      checked_at: resolved.checkedAt,
      license: this.serializeClientLicense(license),
    });
  }

  async resolveClientLicenseByActivationCode(activationCode, options = {}) {
    const preserveUnknownAsNotFound = options.preserveUnknownAsNotFound !== false;
    const normalizedCode = String(activationCode ?? '').trim();
    if (!normalizedCode) {
      return {
        ok: false,
        response: this.json(400, { ok: false, error: 'Missing activation_code.' }),
      };
    }

    const licenseId = this.extractLicenseIdFromActivationCode(normalizedCode) ?? '';
    if (!licenseId) {
      return {
        ok: false,
        response: this.json(400, { ok: false, error: 'Invalid activation_code.' }),
      };
    }

    const sigValid = await this.verifyActivationCodeSignature(normalizedCode);
    if (!sigValid) {
      if (!preserveUnknownAsNotFound) {
        return {
          ok: false,
          response: this.json(403, { ok: false, error: 'Invalid activation_code.' }),
        };
      }
      return {
        ok: false,
        response: this.json(200, {
          ok: true,
          found: false,
          checked_at: new Date().toISOString(),
          license: null,
        }),
      };
    }

    const checkedAt = new Date().toISOString();
    const license = this.data.licenses.find((item) => item.license_id === licenseId);
    if (!license) {
      if (!preserveUnknownAsNotFound) {
        return {
          ok: false,
          response: this.json(404, { ok: false, error: 'License not found.' }),
        };
      }
      return {
        ok: false,
        response: this.json(200, {
          ok: true,
          found: false,
          checked_at: checkedAt,
          license: null,
        }),
      };
    }

    const order = this.data.orders.find(
      (item) => item.provider_order_id === license.provider_order_id,
    );

    let stateUpdated = false;
    if (order?.payment_status === 'refunded' && license.status === 'active') {
      license.status = 'revoked';
      license.revoked_at = checkedAt;
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
      stateUpdated = true;
    }

    const expiresAtMs = Date.parse(String(license.expires_at ?? ''));
    const checkedAtMs = Date.parse(checkedAt);
    if (
      license.status === 'active' &&
      Number.isFinite(expiresAtMs) &&
      Number.isFinite(checkedAtMs) &&
      expiresAtMs <= checkedAtMs
    ) {
      license.status = 'expired';
      license.revoked_at = checkedAt;
      license.notes = 'revoked_by:client_reconcile_expired';
      this.addAuditLog({
        actor: 'client:verify',
        action: 'license.reconcile_expired',
        target_type: 'license',
        target_id: license.license_id,
        payload: { expires_at: license.expires_at },
      });
      stateUpdated = true;
    }

    return {
      ok: true,
      checkedAt,
      license,
      stateUpdated,
    };
  }

  serializeClientLicense(license) {
    return {
      license_id: license.license_id,
      provider_order_id: license.provider_order_id,
      plan: license.plan,
      billing_cycle: license.billing_cycle,
      status: license.status,
      expires_at: license.expires_at,
      revoked_at: license.revoked_at,
      customer_email: license.customer_email,
    };
  }

  issueProxyAccessToken(license) {
    const secret =
      this.readEnvString('PROXY_TOKEN_SIGNING_SECRET') ||
      this.readEnvString('AI_PROXY_TOKEN_SIGNING_SECRET');
    if (!secret) {
      throw new Error('Missing PROXY_TOKEN_SIGNING_SECRET');
    }

    const issuer = this.readEnvString('AI_PROXY_TOKEN_ISSUER', 'agentshield-license-gateway');
    const audience = this.readEnvString('AI_PROXY_TOKEN_AUDIENCE', 'agentshield-ai-proxy');
    const keyId = this.readEnvString('AI_PROXY_TOKEN_KID', 'v1');
    const ttlSeconds = this.parseIntegerInRange(
      this.readEnvString('AI_PROXY_TOKEN_TTL_SECONDS', '300'),
      300,
      60,
      1800,
    );
    const skewSeconds = this.parseIntegerInRange(
      this.readEnvString('AI_PROXY_TOKEN_CLOCK_SKEW_SECONDS', '60'),
      60,
      0,
      300,
    );

    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const payload = {
      iss: issuer,
      aud: audience,
      sub: license.license_id,
      iat: now,
      nbf: Math.max(0, now - skewSeconds),
      exp,
      jti: crypto.randomBytes(16).toString('hex'),
      plan: license.plan,
      billing_cycle: license.billing_cycle,
    };
    const header = {
      alg: 'HS256',
      typ: 'at+jwt',
      kid: keyId,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto
      .createHmac('sha256', Buffer.from(secret, 'utf8'))
      .update(signingInput)
      .digest('base64url');

    return {
      accessToken: `${signingInput}.${signature}`,
      expiresIn: ttlSeconds,
      expiresAtIso: new Date(exp * 1000).toISOString(),
      jti: payload.jti,
      exp,
    };
  }

  parseIntegerInRange(rawValue, fallback, min, max) {
    const parsed = Number.parseInt(String(rawValue ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  async checkClientProxyTokenRateLimit(request, activationCode) {
    const limiter =
      this.env?.CLIENT_PROXY_TOKEN_RATE_LIMITER ?? this.env?.PROXY_TOKEN_RATE_LIMITER ?? null;
    if (!limiter || typeof limiter.limit !== 'function') {
      return { ok: true };
    }

    const ipRaw =
      request.headers.get('CF-Connecting-IP') ??
      request.headers.get('cf-connecting-ip') ??
      request.headers.get('X-Forwarded-For') ??
      request.headers.get('x-forwarded-for') ??
      '';
    const clientIp = String(ipRaw).split(',')[0]?.trim() || 'unknown';
    const licenseHint = this.extractLicenseIdFromActivationCode(activationCode) ?? 'unknown';
    const key = `proxy-token:${clientIp}:${licenseHint}`;

    try {
      const limited = await limiter.limit({ key });
      if (limited?.success) {
        return { ok: true };
      }
      return {
        ok: false,
        status: 429,
        error: 'Too many proxy token requests. Please retry in one minute.',
        retryAfterSeconds: 60,
      };
    } catch {
      // Fail open to avoid accidental auth outage if rate-limit service is temporarily unavailable.
      return { ok: true };
    }
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
      const renewalMarker =
        extracted.subscription_period_end_at ||
        extracted.event_id ||
        `hash:${this.sha256Hex(rawBody)}`;
      if (order.last_subscription_paid_marker === renewalMarker) {
        this.data.metrics.webhook_duplicate_total += 1;
        this.addAuditLog({
          actor: 'creem:webhook',
          action: 'subscription.paid_duplicate_marker',
          target_type: 'order',
          target_id: extracted.provider_order_id,
          payload: { marker: renewalMarker },
        });
        this.data.metrics.subscription_events_total += 1;
        return this.json(200, {
          ok: true,
          duplicate: true,
          event_name: extracted.event_name,
          provider_order_id: extracted.provider_order_id,
        });
      }

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

      const periodEndMs = Date.parse(String(extracted.subscription_period_end_at ?? ''));
      if (Number.isFinite(periodEndMs)) {
        const alreadyCovered = activeLicenses.every((license) => {
          const expiresAtMs = Date.parse(String(license.expires_at ?? ''));
          return Number.isFinite(expiresAtMs) && expiresAtMs >= periodEndMs;
        });
        if (alreadyCovered) {
          this.data.metrics.webhook_duplicate_total += 1;
          this.addAuditLog({
            actor: 'creem:webhook',
            action: 'subscription.paid_period_already_covered',
            target_type: 'order',
            target_id: extracted.provider_order_id,
            payload: {
              subscription_period_end_at: extracted.subscription_period_end_at,
            },
          });
          this.data.metrics.subscription_events_total += 1;
          return this.json(200, {
            ok: true,
            duplicate: true,
            event_name: extracted.event_name,
            provider_order_id: extracted.provider_order_id,
            subscription_period_end_at: extracted.subscription_period_end_at,
          });
        }
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
      order.last_subscription_paid_marker = renewalMarker;
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

  /**
   * POST /admin/licenses/generate
   * Batch generate activation codes for manual distribution.
   *
   * Body: {
   *   count: number (1-100),
   *   billing_cycle: "monthly" | "yearly" | "lifetime",
   *   label: string (e.g., "blogger-promo-march", "gift-codes")
   * }
   *
   * Returns: { ok, codes: [{ license_id, activation_code, billing_cycle, expires_at, label }] }
   */
  async handleAdminGenerateLicenses(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return this.json(400, { error: 'Invalid JSON body' });
    }

    const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 100);
    const billingCycle = body.billing_cycle;
    const label = String(body.label || 'manual').trim().slice(0, 100);

    if (!['monthly', 'yearly', 'lifetime'].includes(billingCycle)) {
      return this.json(400, {
        error: 'billing_cycle must be "monthly", "yearly", or "lifetime"',
      });
    }

    const now = new Date().toISOString();
    const results = [];

    for (let i = 0; i < count; i++) {
      const licenseId = this.createId('lic');
      const expiresAt = this.resolveExpiresAt(now, billingCycle);
      const license = {
        id: this.createId('row'),
        license_id: licenseId,
        provider_order_id: null,
        provider_subscription_id: null,
        plan: 'pro',
        billing_cycle: billingCycle,
        expires_at: expiresAt,
        customer_email: null,
        status: 'active',
        issued_code_hash: '',
        issued_at: now,
        revoked_at: null,
        replacement_for_license_id: null,
        notes: `manual:${label}`,
      };
      const activationCode = this.issueActivationCodeFromLicense(license);
      license.issued_code_hash = this.sha256Hex(activationCode);
      this.data.licenses.push(license);
      this.data.metrics.licenses_issued_total += 1;

      results.push({
        license_id: licenseId,
        activation_code: activationCode,
        billing_cycle: billingCycle,
        expires_at: expiresAt,
        label,
      });
    }

    this.addAuditLog({
      actor: this.actorFromRequest(request),
      action: 'license.batch_generate',
      target_type: 'license',
      target_id: `batch:${count}`,
      payload: { count, billing_cycle: billingCycle, label },
    });

    await this.saveState();

    return this.json(200, {
      ok: true,
      generated: results.length,
      codes: results,
    });
  }

  /**
   * GET /admin/licenses/stats
   * Overview of all licenses by status, cycle, and source.
   */
  handleAdminLicenseStats() {
    const all = this.data.licenses;
    const byStatus = { active: 0, revoked: 0, expired: 0 };
    const byCycle = { monthly: 0, yearly: 0, lifetime: 0 };
    const bySource = { creem: 0, manual: 0 };
    const now = Date.now();

    for (const lic of all) {
      // Status
      if (lic.status === 'revoked') {
        byStatus.revoked += 1;
      } else if (lic.expires_at && new Date(lic.expires_at).getTime() < now) {
        byStatus.expired += 1;
      } else {
        byStatus.active += 1;
      }
      // Cycle
      if (byCycle[lic.billing_cycle] !== undefined) {
        byCycle[lic.billing_cycle] += 1;
      }
      // Source
      if (lic.provider_order_id) {
        bySource.creem += 1;
      } else {
        bySource.manual += 1;
      }
    }

    return this.json(200, {
      total: all.length,
      by_status: byStatus,
      by_cycle: byCycle,
      by_source: bySource,
      metrics: this.data.metrics,
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

  async requireAdmin(request) {
    const adminPassword = this.readEnvString('LICENSE_GATEWAY_ADMIN_PASSWORD');
    const adminUsername = this.readEnvString('LICENSE_GATEWAY_ADMIN_USERNAME', 'admin') || 'admin';
    if (!adminPassword) {
      return {
        ok: false,
        response: this.json(503, { error: 'Admin API disabled: LICENSE_GATEWAY_ADMIN_PASSWORD is empty' }, request),
      };
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Basic ')) {
      return { ok: false, response: this.json(401, { error: 'Missing Basic authorization header' }, request) };
    }

    let decoded;
    try {
      decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8');
    } catch {
      return { ok: false, response: this.json(401, { error: 'Malformed authorization header' }, request) };
    }

    const [username, password] = decoded.split(':');
    const usernameMatch = await this.timingSafeCompare(username ?? '', adminUsername);
    const passwordMatch = await this.timingSafeCompare(password ?? '', adminPassword);
    if (!usernameMatch || !passwordMatch) {
      return { ok: false, response: this.json(403, { error: 'Invalid admin credentials' }, request) };
    }

    return { ok: true };
  }

  async timingSafeCompare(a, b) {
    const encoder = new TextEncoder();
    const aHash = await crypto.subtle.digest('SHA-256', encoder.encode(a));
    const bHash = await crypto.subtle.digest('SHA-256', encoder.encode(b));
    return crypto.subtle.timingSafeEqual(aHash, bHash);
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

  resolveWebhookEventKey(extracted, rawBody) {
    if (extracted?.event_id) {
      return `id:${extracted.event_id}`;
    }
    if (!rawBody) return null;
    return `hash:${this.sha256Hex(rawBody)}`;
  }

  hasProcessedWebhookEvent(eventKey) {
    if (!eventKey) return false;
    return this.data.processed_webhook_events.some(
      (item) => item.event_key === eventKey || (item.event_id && `id:${item.event_id}` === eventKey),
    );
  }

  markWebhookEventProcessed(extracted, rawBody, eventKey = null) {
    const eventId = extracted.event_id || null;
    const resolvedKey = eventKey ?? this.resolveWebhookEventKey(extracted, rawBody);
    if (!eventId && !resolvedKey) return;
    this.data.processed_webhook_events.push({
      event_id: eventId,
      event_key: resolvedKey,
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

  decodeBase64UrlToBytes(input) {
    const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
    const paddingNeeded = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(paddingNeeded);
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }

  async verifyActivationCodeSignature(activationCode) {
    try {
      const pubKeyB64 = this.readEnvString('AGENTSHIELD_LICENSE_PUBLIC_KEY');
      if (!pubKeyB64) {
        const allowUnsigned = String(this.env?.AGENTSHIELD_ALLOW_UNSIGNED_ACTIVATION_CODES ?? '').trim() === '1';
        if (allowUnsigned) {
          return true;
        }
        return false;
      }

      const parts = activationCode.trim().split('.');
      if (parts.length !== 3 || parts[0] !== 'AGSH') {
        return false;
      }

      const payloadBytes = this.decodeBase64UrlToBytes(parts[1]);
      const signatureBytes = this.decodeBase64UrlToBytes(parts[2]);

      const keyBytes = this.decodeBase64UrlToBytes(pubKeyB64);
      const publicKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
        false,
        ['verify'],
      );

      return await crypto.subtle.verify('NODE-ED25519', publicKey, signatureBytes, payloadBytes);
    } catch {
      return false;
    }
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

  serveAdminPage() {
    return new Response(ADMIN_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  getAllowedOrigin(request) {
    const raw = this.readEnvString('ADMIN_ALLOWED_ORIGINS');
    if (!raw) return null;
    const allowedOrigins = raw.split(',').map(o => o.trim()).filter(Boolean);
    const requestOrigin = (request?.headers?.get('Origin') ?? '').trim();
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      return requestOrigin;
    }
    return null;
  }

  corsHeaders(request) {
    const origin = this.getAllowedOrigin(request);
    if (!origin) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, creem-signature, X-Signature',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Vary': 'Origin',
    };
  }

  handleCorsPreflightOrReject(request) {
    const cors = this.corsHeaders(request);
    return new Response(null, {
      status: 204,
      headers: cors,
    });
  }

  json(status, payload, request) {
    const effectiveRequest = request ?? this._currentRequest;
    const cors = effectiveRequest ? this.corsHeaders(effectiveRequest) : {};
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...cors,
      },
    });
  }
}
