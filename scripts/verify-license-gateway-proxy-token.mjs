import assert from 'node:assert/strict';

import { LicenseGatewayDurableObject } from '../workers/license-gateway/src/index.mjs';

const METRICS_TEMPLATE = {
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
};

function makeActivationCodeWithLicenseId(licenseId) {
  const payload = Buffer.from(JSON.stringify({ license_id: licenseId }), 'utf8').toString('base64url');
  return `AGSH.${payload}.sig`;
}

async function main() {
  const signingSecret = 'proxy-signing-secret-for-test';
  const licenseId = 'lic_demo_token_issue';
  const state = {
    orders: [
      {
        provider_order_id: 'ord_demo',
        payment_status: 'paid',
      },
    ],
    licenses: [
      {
        id: 'row_demo',
        license_id: licenseId,
        provider_order_id: 'ord_demo',
        provider_subscription_id: null,
        plan: 'pro',
        billing_cycle: 'monthly',
        expires_at: '2099-01-01T00:00:00.000Z',
        customer_email: 'demo@example.com',
        status: 'active',
        issued_code_hash: '',
        issued_at: '2026-03-21T00:00:00.000Z',
        revoked_at: null,
        replacement_for_license_id: null,
        notes: null,
      },
    ],
    license_deliveries: [],
    audit_logs: [],
    webhook_failures: [],
    processed_webhook_events: [],
    metrics: { ...METRICS_TEMPLATE },
  };

  const makeGateway = (extraEnv = {}) =>
    new LicenseGatewayDurableObject(
      {
        storage: {
          async get() {
            return null;
          },
          async put() {},
        },
      },
      {
        AGENTSHIELD_ALLOW_UNSIGNED_ACTIVATION_CODES: '1',
        PROXY_TOKEN_SIGNING_SECRET: signingSecret,
        AI_PROXY_TOKEN_ISSUER: 'agentshield-license-gateway',
        AI_PROXY_TOKEN_AUDIENCE: 'agentshield-ai-proxy',
        AI_PROXY_TOKEN_TTL_SECONDS: '300',
        AI_PROXY_TOKEN_CLOCK_SKEW_SECONDS: '60',
        AI_PROXY_TOKEN_KID: 'v1',
        ...extraEnv,
      },
    );

  const gateway = makeGateway();
  gateway.loadState = async () => structuredClone(state);
  gateway.saveState = async () => {};

  const response = await gateway.fetch(
    new Request('https://api.51silu.com/client/proxy-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.10',
      },
      body: JSON.stringify({ activation_code: makeActivationCodeWithLicenseId(licenseId) }),
    }),
  );

  assert.equal(response.status, 200, 'gateway should issue token');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.token_type, 'Bearer');
  assert.ok(typeof payload.access_token === 'string' && payload.access_token.includes('.'));
  assert.ok(Number(payload.expires_in) > 0);

  const gatewayRateLimited = makeGateway({
    CLIENT_PROXY_TOKEN_RATE_LIMITER: {
      async limit() {
        return { success: false };
      },
    },
  });
  gatewayRateLimited.loadState = async () => structuredClone(state);
  gatewayRateLimited.saveState = async () => {};

  const limited = await gatewayRateLimited.fetch(
    new Request('https://api.51silu.com/client/proxy-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.10',
      },
      body: JSON.stringify({ activation_code: makeActivationCodeWithLicenseId(licenseId) }),
    }),
  );
  assert.equal(limited.status, 429, 'proxy-token should enforce rate limit when binding rejects');

  const strictGateway = makeGateway({
    AGENTSHIELD_ALLOW_UNSIGNED_ACTIVATION_CODES: '0',
  });
  strictGateway.loadState = async () => structuredClone(state);
  strictGateway.saveState = async () => {};

  const invalid = await strictGateway.fetch(
    new Request('https://api.51silu.com/client/proxy-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activation_code: makeActivationCodeWithLicenseId(licenseId) }),
    }),
  );
  assert.equal(invalid.status, 403, 'invalid activation code should not return pseudo-success');

  const expiredState = structuredClone(state);
  expiredState.licenses[0].expires_at = '2020-01-01T00:00:00.000Z';
  expiredState.licenses[0].status = 'active';
  const expiredGateway = makeGateway();
  expiredGateway.loadState = async () => structuredClone(expiredState);
  expiredGateway.saveState = async () => {};
  const expired = await expiredGateway.fetch(
    new Request('https://api.51silu.com/client/proxy-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activation_code: makeActivationCodeWithLicenseId(licenseId) }),
    }),
  );
  assert.equal(expired.status, 403, 'expired licenses should not be able to issue proxy token');
  const expiredPayload = await expired.json();
  assert.equal(expiredPayload.status, 'expired');

  console.log('verify-license-gateway-proxy-token: all checks passed');
}

main().catch((error) => {
  console.error('verify-license-gateway-proxy-token: failed');
  console.error(error);
  process.exit(1);
});
