import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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

function makeInitialState() {
  return {
    orders: [],
    licenses: [],
    license_deliveries: [],
    audit_logs: [],
    webhook_failures: [],
    processed_webhook_events: [],
    metrics: { ...METRICS_TEMPLATE },
  };
}

function signWebhookBody(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function createGatewayWithState(initialState, envOverrides = {}) {
  let state = structuredClone(initialState);
  const gateway = new LicenseGatewayDurableObject(
    {
      storage: {
        async get() {
          return null;
        },
        async put() {},
      },
    },
    {
      CREEM_WEBHOOK_SECRET: 'creem-webhook-secret-for-test',
      AGENTSHIELD_LICENSE_SIGNING_SEED: crypto.randomBytes(32).toString('base64url'),
      CREEM_STRICT_BILLING_RESOLUTION: '1',
      CREEM_SKU_BILLING_MAP_JSON: JSON.stringify({ AGSH_PRO_30D: 'monthly' }),
      CREEM_PRODUCT_BILLING_MAP_JSON: JSON.stringify({ prod_monthly: 'monthly' }),
      ...envOverrides,
    },
  );

  gateway.loadState = async () => structuredClone(state);
  gateway.saveState = async () => {
    state = structuredClone(gateway.data);
  };

  return {
    gateway,
    readState: () => structuredClone(state),
  };
}

function webhookRequest(payload, secret = 'creem-webhook-secret-for-test') {
  const rawBody = JSON.stringify(payload);
  const signature = signWebhookBody(rawBody, secret);
  return new Request('https://api.51silu.com/webhooks/creem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'creem-signature': signature,
    },
    body: rawBody,
  });
}

async function runCheckoutRetryNotLockedTest() {
  const { gateway, readState } = createGatewayWithState(makeInitialState());

  let failOnce = true;
  const originalResolveBillingCycle = gateway.resolveBillingCycle.bind(gateway);
  gateway.resolveBillingCycle = (...args) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('transient-billing-resolution-failure');
    }
    return originalResolveBillingCycle(...args);
  };

  const payload = {
    id: 'evt_checkout_retry_1',
    eventType: 'checkout.completed',
    object: {
      order: {
        id: 'ord_checkout_retry_1',
        status: 'paid',
        amount: 1999,
        currency: 'USD',
      },
      product: {
        id: 'prod_monthly',
        name: 'Monthly Plan',
        billing_type: 'recurring',
        billing_period: 'every-month',
        price: 1999,
        currency: 'USD',
      },
      customer: {
        id: 'cust_checkout_retry_1',
        email: 'retry@example.com',
      },
      metadata: {
        sku_code: 'AGSH_PRO_30D',
      },
    },
  };

  const first = await gateway.fetch(webhookRequest(payload));
  assert.equal(first.status, 500, 'first checkout.completed should fail to simulate transient issue');

  const second = await gateway.fetch(webhookRequest(payload));
  assert.equal(second.status, 200, 'retry should recover and issue license');
  const secondJson = await second.json();
  assert.ok(secondJson.license_id, 'retry should return issued license_id');

  const third = await gateway.fetch(webhookRequest(payload));
  assert.equal(third.status, 200);
  const thirdJson = await third.json();
  assert.equal(thirdJson.duplicate, true, 'successful event replay should be deduplicated');

  const state = readState();
  const issued = state.licenses.filter((item) => item.provider_order_id === 'ord_checkout_retry_1');
  assert.equal(issued.length, 1, 'only one license should be issued after retry + replay');
}

async function runSubscriptionPaidNoEventIdDedupTest() {
  const base = makeInitialState();
  const now = new Date().toISOString();
  base.orders.push({
    id: 'ord_row_1',
    provider: 'creem',
    provider_order_id: 'sub_no_event_id_1',
    provider_subscription_id: 'sub_no_event_id_1',
    provider_customer_id: 'cust_sub_1',
    customer_email: 'subscriber@example.com',
    sku_code: 'AGSH_PRO_30D',
    product_id: 'prod_monthly',
    product_billing_type: 'recurring',
    product_billing_period: 'every-month',
    currency: 'USD',
    amount_total: 1999,
    payment_status: 'paid',
    raw_event_hash: 'seed',
    created_at: now,
    updated_at: now,
  });
  base.licenses.push({
    id: 'lic_row_1',
    license_id: 'lic_sub_no_event_1',
    provider_order_id: 'sub_no_event_id_1',
    provider_subscription_id: 'sub_no_event_id_1',
    plan: 'pro',
    billing_cycle: 'monthly',
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    customer_email: 'subscriber@example.com',
    status: 'active',
    issued_code_hash: 'hash',
    issued_at: now,
    revoked_at: null,
    replacement_for_license_id: null,
    notes: null,
  });

  const { gateway, readState } = createGatewayWithState(base);
  const payload = {
    eventType: 'subscription.paid',
    object: {
      id: 'sub_no_event_id_1',
      status: 'active',
      product: {
        id: 'prod_monthly',
        billing_type: 'recurring',
        billing_period: 'every-month',
      },
      customer: {
        id: 'cust_sub_1',
        email: 'subscriber@example.com',
      },
      metadata: {
        sku_code: 'AGSH_PRO_30D',
      },
    },
  };

  const first = await gateway.fetch(webhookRequest(payload));
  assert.equal(first.status, 200, 'first subscription.paid should extend once');
  const firstState = readState();
  const firstExpires = firstState.licenses[0].expires_at;

  const second = await gateway.fetch(webhookRequest(payload));
  assert.equal(second.status, 200, 'replay without event_id should be deduplicated by hash marker');
  const secondJson = await second.json();
  assert.equal(secondJson.duplicate, true);

  const secondState = readState();
  assert.equal(
    secondState.licenses[0].expires_at,
    firstExpires,
    'deduplicated replay must not extend expiry again',
  );
}

async function main() {
  await runCheckoutRetryNotLockedTest();
  await runSubscriptionPaidNoEventIdDedupTest();
  console.log('verify-license-gateway-webhook-idempotency: all checks passed');
}

main().catch((error) => {
  console.error('verify-license-gateway-webhook-idempotency: failed');
  console.error(error);
  process.exit(1);
});
