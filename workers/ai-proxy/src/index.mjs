// AgentShield AI Proxy — Cloudflare Worker
// Protects MiniMax API Key, verifies paid license, enforces signature/rate/quota controls.
//
// Official refs:
// - KV write + expirationTtl: https://developers.cloudflare.com/kv/api/write-key-value-pairs/
// - Rate limit binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
// - HMAC signing example: https://developers.cloudflare.com/workers/examples/signing-requests/
// - Secrets: https://developers.cloudflare.com/workers/configuration/secrets/

import { Buffer } from 'node:buffer';

const encoder = new TextEncoder();
const SIGNATURE_MAX_SKEW_SECONDS = 300;
const NONCE_TTL_SECONDS = 300;
const TOKEN_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_TOKEN_ISSUER = 'agentshield-license-gateway';
const DEFAULT_TOKEN_AUDIENCE = 'agentshield-ai-proxy';
const DEFAULT_TOKEN_TYP = 'at+jwt';
const DAILY_TTL_SECONDS = 172800; // 48h
const MONTHLY_TTL_SECONDS = 3024000; // 35d

const QUOTA_LIMITS = {
  trial: { daily: 50, monthly: 500 },
  monthly: { daily: 100, monthly: 2000 },
  yearly: { daily: 200, monthly: 5000 },
  lifetime: { daily: 200, monthly: 5000 },
};

const QUOTA_HEADER_MAP = {
  dailyUsed: 'X-Quota-Daily-Used',
  dailyLimit: 'X-Quota-Daily-Limit',
  monthlyUsed: 'X-Quota-Monthly-Used',
  monthlyLimit: 'X-Quota-Monthly-Limit',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-License-ID, X-Activation-Code, X-Signature',
  'Access-Control-Expose-Headers':
    'X-Quota-Daily-Used, X-Quota-Daily-Limit, X-Quota-Monthly-Used, X-Quota-Monthly-Limit',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        service: 'agentshield-ai-proxy',
        model: env.MINIMAX_DEFAULT_MODEL,
        now: new Date().toISOString(),
      });
    }

    if (request.method === 'GET' && url.pathname === '/v1/quota') {
      const auth = await authenticateRequest(request, env);
      if (!auth.ok) {
        return auth.response;
      }

      let usage;
      try {
        usage = await getQuotaUsage(env, auth.licenseId, auth.quotaPlan);
      } catch (error) {
        return jsonResponse(503, {
          error: 'Quota store unavailable.',
          detail: 'Internal error',
        });
      }
      const limit = getQuotaLimit(auth.quotaPlan);
      return jsonResponse(
        200,
        {
          ok: true,
          license_id: auth.licenseId,
          plan: auth.quotaPlan,
          daily_used: usage.dailyCount,
          daily_limit: limit.daily,
          monthly_used: usage.monthlyCount,
          monthly_limit: limit.monthly,
        },
        quotaHeaders({
          dailyUsed: usage.dailyCount,
          dailyLimit: limit.daily,
          monthlyUsed: usage.monthlyCount,
          monthlyLimit: limit.monthly,
        }),
      );
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return jsonResponse(404, { error: 'Not Found. Use GET /v1/quota or POST /v1/chat/completions' });
    }

    const auth = await authenticateRequest(request, env);
    if (!auth.ok) {
      return auth.response;
    }

    if (env.PRO_USER_RATE_LIMITER) {
      try {
        const { success } = await env.PRO_USER_RATE_LIMITER.limit({ key: auth.licenseId });
        if (!success) {
          return jsonResponse(429, {
            error: 'Rate limit exceeded. Max 10 requests per minute.',
            retry_after_seconds: 60,
          });
        }
      } catch (error) {
        return jsonResponse(503, { error: 'Rate limiter unavailable', detail: 'Internal error' });
      }
    }

    let quota;
    try {
      quota = await checkAndIncrementQuota(env, auth.licenseId, auth.quotaPlan);
    } catch (error) {
      return jsonResponse(503, {
        error: 'Quota store unavailable.',
        detail: 'Internal error',
      });
    }
    if (!quota.allowed) {
      return jsonResponse(
        429,
        {
          error: quota.reason,
          daily_used: quota.dailyUsed,
          daily_limit: quota.dailyLimit,
          monthly_used: quota.monthlyUsed,
          monthly_limit: quota.monthlyLimit,
        },
        quotaHeaders({
          dailyUsed: quota.dailyUsed,
          dailyLimit: quota.dailyLimit,
          monthlyUsed: quota.monthlyUsed,
          monthlyLimit: quota.monthlyLimit,
        }),
      );
    }

    const apiKey = String(env.MINIMAX_API_KEY ?? '').trim();
    if (!apiKey) {
      return jsonResponse(500, { error: 'AI service not configured. Contact support.' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }

    // Force model — prevent users from using expensive models
    body.model = env.MINIMAX_DEFAULT_MODEL;
    // Cap max_tokens to prevent abuse
    if (!body.max_tokens || Number(body.max_tokens) > 2000) {
      body.max_tokens = 2000;
    }

    const targetUrl = `${env.MINIMAX_BASE_URL}/chat/completions`;
    let minimaxResp;
    try {
      minimaxResp = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      return jsonResponse(
        502,
        { error: 'MiniMax API unreachable', detail: 'Internal error' },
        quotaHeaders({
          dailyUsed: quota.dailyUsed,
          dailyLimit: quota.dailyLimit,
          monthlyUsed: quota.monthlyUsed,
          monthlyLimit: quota.monthlyLimit,
        }),
      );
    }

    const respBody = await minimaxResp.text();
    return new Response(respBody, {
      status: minimaxResp.status,
      headers: {
        'Content-Type': minimaxResp.headers.get('Content-Type') || 'application/json',
        ...CORS_HEADERS,
        ...quotaHeaders({
          dailyUsed: quota.dailyUsed,
          dailyLimit: quota.dailyLimit,
          monthlyUsed: quota.monthlyUsed,
          monthlyLimit: quota.monthlyLimit,
        }),
      },
    });
  },
};

async function authenticateRequest(request, env) {
  const bearerToken = parseBearerToken(request.headers.get('Authorization'));
  if (bearerToken) {
    const tokenAuth = await verifyProxyAccessToken(env, bearerToken);
    if (!tokenAuth.ok) {
      return {
        ok: false,
        response: jsonResponse(403, { error: tokenAuth.error }),
      };
    }
    return {
      ok: true,
      licenseId: tokenAuth.licenseId,
      quotaPlan: tokenAuth.quotaPlan,
      auth_mode: 'bearer',
    };
  }

  if (!legacyAuthEnabled(env)) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: 'Legacy proxy authentication is disabled. Please upgrade client authentication.',
      }),
    };
  }

  return authenticateLegacyRequest(request, env);
}

function legacyAuthEnabled(env) {
  const raw = String(env.ALLOW_LEGACY_AUTH ?? env.AI_PROXY_ALLOW_LEGACY_AUTH ?? '1')
    .trim()
    .toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

async function authenticateLegacyRequest(request, env) {
  const licenseId = String(request.headers.get('X-License-ID') ?? '').trim();
  if (!licenseId) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: 'Missing X-License-ID header. Pro license required.',
      }),
    };
  }

  const activationCode = String(request.headers.get('X-Activation-Code') ?? '').trim();
  if (!activationCode) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: 'Missing X-Activation-Code header. License activation required.',
      }),
    };
  }

  const signature = String(request.headers.get('X-Signature') ?? '').trim();
  const signatureOk = await verifySignature(env, licenseId, activationCode, signature);
  if (!signatureOk) {
    return {
      ok: false,
      response: jsonResponse(403, { error: 'Invalid signature.' }),
    };
  }

  const verifyResult = await verifyLicense(env, activationCode);
  if (!verifyResult.ok) {
    return {
      ok: false,
      response: verifyResult.response,
    };
  }

  const remoteLicenseId = String(verifyResult.license.license_id ?? '').trim();
  if (!remoteLicenseId || remoteLicenseId !== licenseId) {
    return {
      ok: false,
      response: jsonResponse(403, {
        error: 'License identity mismatch.',
      }),
    };
  }

  const quotaPlan = resolveQuotaPlan(verifyResult.license);
  if (quotaPlan === 'free') {
    return {
      ok: false,
      response: jsonResponse(403, {
        error: 'AI features require Pro license.',
        hint: 'Upgrade to Pro for AI-powered features. 14-day free trial included.',
      }),
    };
  }

  return {
    ok: true,
    licenseId,
    quotaPlan,
    license: verifyResult.license,
    auth_mode: 'legacy',
  };
}

function parseBearerToken(authorizationHeader) {
  const value = String(authorizationHeader ?? '').trim();
  if (!value) return null;
  const parts = value.split(/\s+/);
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  return token || null;
}

async function verifyProxyAccessToken(env, token) {
  const secret =
    String(env.PROXY_TOKEN_SIGNING_SECRET ?? '').trim() ||
    String(env.AI_PROXY_TOKEN_SIGNING_SECRET ?? '').trim();
  if (!secret) {
    return {
      ok: false,
      error: 'Proxy token verifier is not configured.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'Invalid access token format.' };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;
  let signatureBytes;
  try {
    header = decodeBase64UrlJson(encodedHeader);
    payload = decodeBase64UrlJson(encodedPayload);
    signatureBytes = decodeBase64UrlBytes(encodedSignature);
  } catch {
    return { ok: false, error: 'Malformed access token.' };
  }

  if (String(header?.alg ?? '') !== 'HS256') {
    return { ok: false, error: 'Unsupported access token algorithm.' };
  }
  const expectedType = String(env.AI_PROXY_TOKEN_TYP ?? DEFAULT_TOKEN_TYP).trim();
  if (expectedType && String(header?.typ ?? '') !== expectedType) {
    return { ok: false, error: 'Access token type mismatch.' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(signingInput),
  );
  if (!verified) {
    return { ok: false, error: 'Access token signature is invalid.' };
  }

  const issuer = String(env.AI_PROXY_TOKEN_ISSUER ?? DEFAULT_TOKEN_ISSUER).trim();
  const audience = String(env.AI_PROXY_TOKEN_AUDIENCE ?? DEFAULT_TOKEN_AUDIENCE).trim();
  if (String(payload?.iss ?? '') !== issuer) {
    return { ok: false, error: 'Access token issuer mismatch.' };
  }
  if (!tokenAudienceMatches(payload?.aud, audience)) {
    return { ok: false, error: 'Access token audience mismatch.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = parseNumericClaim(payload?.exp);
  const nbf = parseNumericClaim(payload?.nbf);
  const iat = parseNumericClaim(payload?.iat);
  if (!exp || !nbf || !iat) {
    return { ok: false, error: 'Access token is missing required time claims.' };
  }
  if (now > exp + TOKEN_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: 'Access token has expired.' };
  }
  if (now + TOKEN_CLOCK_SKEW_SECONDS < nbf) {
    return { ok: false, error: 'Access token is not yet valid.' };
  }
  if (iat > now + TOKEN_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: 'Access token issued-at is in the future.' };
  }

  const licenseId = String(payload?.sub ?? '').trim();
  if (!licenseId) {
    return { ok: false, error: 'Access token subject is missing.' };
  }
  const jti = String(payload?.jti ?? '').trim();
  if (!jti) {
    return { ok: false, error: 'Access token jti is missing.' };
  }

  if (env.USAGE_KV) {
    const [revokedByJti, revokedByLicense] = await Promise.all([
      env.USAGE_KV.get(`revoked:jti:${jti}`),
      env.USAGE_KV.get(`revoked:license:${licenseId}`),
    ]);
    if (revokedByJti || revokedByLicense) {
      return { ok: false, error: 'Access token has been revoked.' };
    }
  }

  const quotaPlan = resolveQuotaPlan({
    plan: payload?.plan,
    billing_cycle: payload?.billing_cycle,
  });
  if (quotaPlan === 'free') {
    return { ok: false, error: 'AI features require Pro license.' };
  }

  return {
    ok: true,
    licenseId,
    quotaPlan,
  };
}

function decodeBase64UrlJson(value) {
  const bytes = decodeBase64UrlBytes(value);
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function decodeBase64UrlBytes(value) {
  return new Uint8Array(Buffer.from(String(value ?? ''), 'base64url'));
}

function parseNumericClaim(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function tokenAudienceMatches(tokenAud, expectedAudience) {
  if (typeof tokenAud === 'string') {
    return tokenAud === expectedAudience;
  }
  if (Array.isArray(tokenAud)) {
    return tokenAud.some((aud) => String(aud) === expectedAudience);
  }
  return false;
}

function splitSignatureHeader(signatureHeader) {
  const first = signatureHeader.indexOf('-');
  if (first <= 0) return null;
  const second = signatureHeader.indexOf('-', first + 1);
  if (second <= first + 1) return null;

  const timestampText = signatureHeader.slice(0, first);
  const nonce = signatureHeader.slice(first + 1, second);
  const signature = signatureHeader.slice(second + 1);
  if (!timestampText || !nonce || !signature) return null;

  const timestamp = Number.parseInt(timestampText, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, nonce, signature };
}

async function verifySignature(env, licenseId, activationCode, signatureHeader) {
  if (!signatureHeader) return false;
  const parsed = splitSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > SIGNATURE_MAX_SKEW_SECONDS) {
    return false;
  }

  if (!env.USAGE_KV) {
    return false;
  }

  const nonceKey = `nonce:${licenseId}:${parsed.nonce}`;
  const reused = await env.USAGE_KV.get(nonceKey);
  if (reused) {
    return false;
  }

  const perLicenseKey = String(activationCode ?? '').trim();
  if (!perLicenseKey) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(perLicenseKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payload = `${licenseId}${parsed.timestamp}${parsed.nonce}`;

  let receivedMac;
  try {
    receivedMac = Buffer.from(parsed.signature, 'base64url');
  } catch {
    return false;
  }

  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    receivedMac,
    encoder.encode(payload),
  );
  if (!verified) {
    return false;
  }

  await env.USAGE_KV.put(nonceKey, '1', { expirationTtl: NONCE_TTL_SECONDS });
  return true;
}

async function verifyLicense(env, activationCode) {
  try {
    const verifyResp = await fetch(`${env.LICENSE_GATEWAY_URL}/client/licenses/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activation_code: activationCode }),
    });

    if (!verifyResp.ok) {
      return {
        ok: false,
        response: jsonResponse(502, {
          error: 'License verification service unavailable.',
          status: verifyResp.status,
        }),
      };
    }

    const verifyData = await verifyResp.json();
    if (!verifyData?.ok || !verifyData?.found || !verifyData?.license) {
      return {
        ok: false,
        response: jsonResponse(403, {
          error: 'Invalid or unknown license.',
        }),
      };
    }

    if (verifyData.license.status !== 'active') {
      return {
        ok: false,
        response: jsonResponse(403, {
          error: 'License is not active.',
          status: verifyData.license.status,
        }),
      };
    }

    return {
      ok: true,
      license: verifyData.license,
    };
  } catch (error) {
    return {
      ok: false,
      response: jsonResponse(502, {
        error: 'License verification failed.',
        detail: 'Internal error',
      }),
    };
  }
}

function normalizeBillingCycle(value) {
  const cycle = String(value ?? '')
    .trim()
    .toLowerCase();
  if (cycle === 'yearly' || cycle === 'annual') return 'yearly';
  if (cycle === 'lifetime' || cycle === 'one_time' || cycle === 'onetime') return 'lifetime';
  return 'monthly';
}

function resolveQuotaPlan(license) {
  const plan = String(license?.plan ?? '')
    .trim()
    .toLowerCase();
  if (plan === 'trial') {
    return 'trial';
  }
  if (plan === 'pro' || plan === 'enterprise') {
    return normalizeBillingCycle(license?.billing_cycle);
  }
  return 'free';
}

function getQuotaLimit(plan) {
  return QUOTA_LIMITS[plan] ?? QUOTA_LIMITS.monthly;
}

function buildQuotaKeys(licenseId, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  return {
    dayKey: `usage:daily:${licenseId}:${day}`,
    monthKey: `usage:monthly:${licenseId}:${month}`,
  };
}

function parseUsageCounter(value) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

async function getQuotaUsage(env, licenseId, plan) {
  if (!env.USAGE_KV) {
    throw new Error('USAGE_KV binding missing.');
  }
  const { dayKey, monthKey } = buildQuotaKeys(licenseId);
  const [dailyRaw, monthlyRaw] = await Promise.all([
    env.USAGE_KV.get(dayKey),
    env.USAGE_KV.get(monthKey),
  ]);
  return {
    dailyCount: parseUsageCounter(dailyRaw),
    monthlyCount: parseUsageCounter(monthlyRaw),
    limit: getQuotaLimit(plan),
    keys: { dayKey, monthKey },
  };
}

async function checkAndIncrementQuota(env, licenseId, plan) {
  const usage = await getQuotaUsage(env, licenseId, plan);
  const { dailyCount, monthlyCount, limit, keys } = usage;

  if (dailyCount >= limit.daily) {
    return {
      allowed: false,
      reason: `Daily limit reached (${limit.daily}/day)`,
      dailyUsed: dailyCount,
      dailyLimit: limit.daily,
      monthlyUsed: monthlyCount,
      monthlyLimit: limit.monthly,
    };
  }
  if (monthlyCount >= limit.monthly) {
    return {
      allowed: false,
      reason: `Monthly limit reached (${limit.monthly}/month)`,
      dailyUsed: dailyCount,
      dailyLimit: limit.daily,
      monthlyUsed: monthlyCount,
      monthlyLimit: limit.monthly,
    };
  }

  const nextDaily = dailyCount + 1;
  const nextMonthly = monthlyCount + 1;
  await Promise.all([
    env.USAGE_KV.put(keys.dayKey, String(nextDaily), { expirationTtl: DAILY_TTL_SECONDS }),
    env.USAGE_KV.put(keys.monthKey, String(nextMonthly), { expirationTtl: MONTHLY_TTL_SECONDS }),
  ]);

  return {
    allowed: true,
    dailyUsed: nextDaily,
    dailyLimit: limit.daily,
    monthlyUsed: nextMonthly,
    monthlyLimit: limit.monthly,
  };
}

function quotaHeaders(value) {
  return {
    [QUOTA_HEADER_MAP.dailyUsed]: String(value.dailyUsed),
    [QUOTA_HEADER_MAP.dailyLimit]: String(value.dailyLimit),
    [QUOTA_HEADER_MAP.monthlyUsed]: String(value.monthlyUsed),
    [QUOTA_HEADER_MAP.monthlyLimit]: String(value.monthlyLimit),
  };
}

function jsonResponse(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}
