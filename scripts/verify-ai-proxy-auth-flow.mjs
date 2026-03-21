import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import aiProxyWorker from '../workers/ai-proxy/src/index.mjs';

class MemoryKv {
  constructor() {
    this.data = new Map();
  }

  async get(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  async put(key, value) {
    this.data.set(key, String(value));
  }
}

function encodeJsonBase64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signHs256Jwt(secret, claims, header = { alg: 'HS256', typ: 'at+jwt', kid: 'v1' }) {
  const encodedHeader = encodeJsonBase64Url(header);
  const encodedClaims = encodeJsonBase64Url(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

async function runAiProxyBearerSuccessTest() {
  const signingSecret = 'proxy-signing-secret-for-test';
  const kv = new MemoryKv();
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256Jwt(signingSecret, {
    iss: 'agentshield-license-gateway',
    aud: 'agentshield-ai-proxy',
    sub: 'lic_bearer_ok',
    iat: now,
    nbf: now - 30,
    exp: now + 300,
    jti: crypto.randomBytes(16).toString('hex'),
    plan: 'pro',
    billing_cycle: 'monthly',
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch URL in bearer success test: ${url}`);
    };

    const response = await aiProxyWorker.fetch(
      new Request('https://ai-proxy.example/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      {
        PROXY_TOKEN_SIGNING_SECRET: signingSecret,
        AI_PROXY_TOKEN_ISSUER: 'agentshield-license-gateway',
        AI_PROXY_TOKEN_AUDIENCE: 'agentshield-ai-proxy',
        MINIMAX_API_KEY: 'minimax_test_key',
        MINIMAX_BASE_URL: 'https://api.minimax.chat/v1',
        MINIMAX_DEFAULT_MODEL: 'MiniMax-M2.7',
        USAGE_KV: kv,
        PRO_USER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        },
      },
    );

    assert.equal(response.status, 200, 'ai-proxy bearer path should succeed');
    const payload = await response.json();
    assert.equal(payload.choices?.[0]?.message?.content, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runAiProxyBearerExpiredTest() {
  const signingSecret = 'proxy-signing-secret-for-test';
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256Jwt(signingSecret, {
    iss: 'agentshield-license-gateway',
    aud: 'agentshield-ai-proxy',
    sub: 'lic_bearer_expired',
    iat: now - 600,
    nbf: now - 600,
    exp: now - 180,
    jti: crypto.randomBytes(16).toString('hex'),
    plan: 'pro',
    billing_cycle: 'monthly',
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error('Expired token should be rejected before upstream fetch');
    };

    const response = await aiProxyWorker.fetch(
      new Request('https://ai-proxy.example/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      {
        PROXY_TOKEN_SIGNING_SECRET: signingSecret,
        AI_PROXY_TOKEN_ISSUER: 'agentshield-license-gateway',
        AI_PROXY_TOKEN_AUDIENCE: 'agentshield-ai-proxy',
        MINIMAX_API_KEY: 'minimax_test_key',
        MINIMAX_BASE_URL: 'https://api.minimax.chat/v1',
        MINIMAX_DEFAULT_MODEL: 'MiniMax-M2.7',
        USAGE_KV: new MemoryKv(),
        PRO_USER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        },
      },
    );

    assert.equal(response.status, 403, 'expired bearer token must be rejected');
    const payload = await response.json();
    const errorText = String(payload.error ?? '').toLowerCase();
    assert.ok(errorText.includes('expired'));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runAiProxyBearerTypeMismatchTest() {
  const signingSecret = 'proxy-signing-secret-for-test';
  const now = Math.floor(Date.now() / 1000);
  const token = signHs256Jwt(
    signingSecret,
    {
      iss: 'agentshield-license-gateway',
      aud: 'agentshield-ai-proxy',
      sub: 'lic_bearer_bad_typ',
      iat: now,
      nbf: now - 30,
      exp: now + 300,
      jti: crypto.randomBytes(16).toString('hex'),
      plan: 'pro',
      billing_cycle: 'monthly',
    },
    { alg: 'HS256', typ: 'id+jwt', kid: 'v1' },
  );

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error('type-mismatch token should be rejected before upstream fetch');
    };

    const response = await aiProxyWorker.fetch(
      new Request('https://ai-proxy.example/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      {
        PROXY_TOKEN_SIGNING_SECRET: signingSecret,
        AI_PROXY_TOKEN_ISSUER: 'agentshield-license-gateway',
        AI_PROXY_TOKEN_AUDIENCE: 'agentshield-ai-proxy',
        AI_PROXY_TOKEN_TYP: 'at+jwt',
        MINIMAX_API_KEY: 'minimax_test_key',
        MINIMAX_BASE_URL: 'https://api.minimax.chat/v1',
        MINIMAX_DEFAULT_MODEL: 'MiniMax-M2.7',
        USAGE_KV: new MemoryKv(),
        PRO_USER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        },
      },
    );

    assert.equal(response.status, 403, 'mismatched token type must be rejected');
    const payload = await response.json();
    assert.equal(payload.error, 'Access token type mismatch.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runAiProxyLegacyFallbackTest() {
  const licenseId = 'lic_legacy_ok';
  const activationCode = 'activation_code_for_legacy_test';
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = '12345';
  const signature = crypto
    .createHmac('sha256', Buffer.from(activationCode, 'utf8'))
    .update(`${licenseId}${timestamp}${nonce}`)
    .digest('base64url');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/client/licenses/verify')) {
        return new Response(
          JSON.stringify({
            ok: true,
            found: true,
            license: {
              license_id: licenseId,
              plan: 'pro',
              billing_cycle: 'monthly',
              status: 'active',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'legacy-ok' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch URL in legacy test: ${url}`);
    };

    const response = await aiProxyWorker.fetch(
      new Request('https://ai-proxy.example/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-License-ID': licenseId,
          'X-Activation-Code': activationCode,
          'X-Signature': `${timestamp}-${nonce}-${signature}`,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      }),
      {
        LICENSE_GATEWAY_URL: 'https://gateway.example',
        MINIMAX_API_KEY: 'minimax_test_key',
        MINIMAX_BASE_URL: 'https://api.minimax.chat/v1',
        MINIMAX_DEFAULT_MODEL: 'MiniMax-M2.7',
        USAGE_KV: new MemoryKv(),
        PRO_USER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        },
      },
    );

    assert.equal(response.status, 200, 'legacy signature flow should remain available');
    const payload = await response.json();
    assert.equal(payload.choices?.[0]?.message?.content, 'legacy-ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runAiProxyLegacyDisabledTest() {
  const licenseId = 'lic_legacy_disabled';
  const activationCode = 'activation_code_for_legacy_disabled_test';
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = '55555';
  const signature = crypto
    .createHmac('sha256', Buffer.from(activationCode, 'utf8'))
    .update(`${licenseId}${timestamp}${nonce}`)
    .digest('base64url');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error('legacy-disabled request should be rejected before fetch');
    };

    const response = await aiProxyWorker.fetch(
      new Request('https://ai-proxy.example/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-License-ID': licenseId,
          'X-Activation-Code': activationCode,
          'X-Signature': `${timestamp}-${nonce}-${signature}`,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      }),
      {
        ALLOW_LEGACY_AUTH: '0',
        LICENSE_GATEWAY_URL: 'https://gateway.example',
        MINIMAX_API_KEY: 'minimax_test_key',
        MINIMAX_BASE_URL: 'https://api.minimax.chat/v1',
        MINIMAX_DEFAULT_MODEL: 'MiniMax-M2.7',
        USAGE_KV: new MemoryKv(),
        PRO_USER_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        },
      },
    );

    assert.equal(response.status, 401, 'legacy auth must be blocked when disabled');
    const payload = await response.json();
    assert.equal(
      payload.error,
      'Legacy proxy authentication is disabled. Please upgrade client authentication.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  await runAiProxyBearerSuccessTest();
  await runAiProxyBearerExpiredTest();
  await runAiProxyBearerTypeMismatchTest();
  await runAiProxyLegacyFallbackTest();
  await runAiProxyLegacyDisabledTest();
  console.log('verify-ai-proxy-auth-flow: all checks passed');
}

main().catch((error) => {
  console.error('verify-ai-proxy-auth-flow: failed');
  console.error(error);
  process.exit(1);
});
