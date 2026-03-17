/// <reference types="node" />
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/license-gateway.mjs');
const WEBHOOK_SECRET = 'test-webhook-secret';

interface GatewayHandle {
  process: ChildProcessWithoutNullStreams;
  baseUrl: string;
  dataPath: string;
  cleanupDir: string;
}

const runningGateways: GatewayHandle[] = [];

function buildSignature(rawBody: string) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
}

async function waitForHealth(baseUrl: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`license-gateway health check timed out: ${baseUrl}`);
}

async function stopGateway(handle: GatewayHandle) {
  if (!handle.process.killed) {
    handle.process.kill('SIGTERM');
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!handle.process.killed) {
        handle.process.kill('SIGKILL');
      }
      resolve();
    }, 4_000);
    handle.process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  fs.rmSync(handle.cleanupDir, { recursive: true, force: true });
}

async function startGateway(initialState: Record<string, unknown>) {
  const cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentshield-gateway-test-'));
  const dataPath = path.join(cleanupDir, 'license-gateway.json');
  fs.writeFileSync(dataPath, JSON.stringify(initialState, null, 2));

  const port = 42000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SCRIPT_PATH], {
    env: {
      ...process.env,
      LICENSE_GATEWAY_PORT: String(port),
      LICENSE_GATEWAY_DATA_PATH: dataPath,
      CREEM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      AGENTSHIELD_LICENSE_SIGNING_SEED: '0123456789abcdef0123456789abcdef',
      LICENSE_GATEWAY_ADMIN_PASSWORD: 'test-admin',
      CREEM_STRICT_BILLING_RESOLUTION: '1',
    },
    stdio: 'pipe',
  });

  const handle = {
    process: child,
    baseUrl,
    dataPath,
    cleanupDir,
  };
  runningGateways.push(handle);
  await waitForHealth(baseUrl);
  return handle;
}

async function postWebhook(baseUrl: string, payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload);
  const signature = buildSignature(rawBody);
  const response = await fetch(`${baseUrl}/webhooks/creem`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'creem-signature': signature,
    },
    body: rawBody,
  });
  const json = await response.json();
  return { status: response.status, json };
}

function readGatewayState(dataPath: string) {
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

afterEach(async () => {
  while (runningGateways.length > 0) {
    const handle = runningGateways.pop();
    if (handle) {
      await stopGateway(handle);
    }
  }
});

describe('license-gateway webhook handling', () => {
  it('extends subscription license only once when webhook retries with same event id', async () => {
    const handle = await startGateway({
      orders: [
        {
          id: 'ord_seed',
          provider: 'creem',
          provider_order_id: 'sub_live_123',
          provider_subscription_id: 'sub_live_123',
          provider_customer_id: 'cust_123',
          customer_email: 'user@example.com',
          sku_code: 'AGSH_PRO_30D',
          product_id: 'prod_monthly',
          product_billing_type: 'recurring',
          product_billing_period: 'every-month',
          currency: 'USD',
          amount_total: 490,
          payment_status: 'paid',
          raw_event_hash: 'seed',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
        },
      ],
      licenses: [
        {
          id: 'row_seed',
          license_id: 'lic_seed',
          provider_order_id: 'sub_live_123',
          provider_subscription_id: 'sub_live_123',
          plan: 'pro',
          billing_cycle: 'monthly',
          expires_at: '2026-03-10T00:00:00.000Z',
          customer_email: 'user@example.com',
          status: 'active',
          issued_code_hash: 'hash',
          issued_at: '2026-02-10T00:00:00.000Z',
          revoked_at: null,
          replacement_for_license_id: null,
          notes: null,
        },
      ],
    });

    const payload = {
      id: 'evt_paid_001',
      eventType: 'subscription.paid',
      object: {
        id: 'sub_live_123',
        object: 'subscription',
        status: 'active',
        billing_period: 'every-month',
        customer: {
          id: 'cust_123',
          email: 'user@example.com',
        },
        product: {
          id: 'prod_monthly',
          name: 'Monthly',
          billing_type: 'recurring',
          billing_period: 'every-month',
        },
        metadata: {
          sku_code: 'AGSH_PRO_30D',
        },
        current_period_end_date: '2026-04-10T00:00:00.000Z',
      },
    };

    const first = await postWebhook(handle.baseUrl, payload);
    expect(first.status).toBe(200);
    expect(first.json.extended_count).toBe(1);

    const stateAfterFirst = readGatewayState(handle.dataPath);
    const firstExpiry = stateAfterFirst.licenses[0].expires_at;
    expect(Date.parse(firstExpiry)).toBeGreaterThan(Date.parse('2026-03-10T00:00:00.000Z'));

    const second = await postWebhook(handle.baseUrl, payload);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);

    const stateAfterSecond = readGatewayState(handle.dataPath);
    expect(stateAfterSecond.licenses[0].expires_at).toBe(firstExpiry);
    expect(stateAfterSecond.processed_webhook_events).toHaveLength(1);
  });

  it('acknowledges subscription.paid without active license and does not grant access', async () => {
    const handle = await startGateway({
      orders: [],
      licenses: [],
    });

    const payload = {
      id: 'evt_paid_missing_license',
      eventType: 'subscription.paid',
      object: {
        id: 'sub_missing_123',
        object: 'subscription',
        status: 'active',
        customer: {
          id: 'cust_missing',
          email: 'missing@example.com',
        },
        product: {
          id: 'prod_monthly',
          name: 'Monthly',
          billing_type: 'recurring',
          billing_period: 'every-month',
        },
        metadata: {
          sku_code: 'AGSH_PRO_30D',
        },
      },
    };

    const response = await postWebhook(handle.baseUrl, payload);
    expect(response.status).toBe(202);
    expect(response.json.reason).toBe('subscription_paid_without_active_license');

    const state = readGatewayState(handle.dataPath);
    expect(state.licenses).toHaveLength(0);
    expect(state.metrics.subscription_events_without_license_total).toBe(1);
  });
});
