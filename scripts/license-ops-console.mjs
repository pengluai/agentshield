#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const defaultEnvPath = path.join(repoRoot, '.env.public-sale.local');
const envPath = process.env.AGENTSHIELD_PUBLIC_SALE_ENV || defaultEnvPath;
loadEnvLiteral(envPath);

const consolePort = Number(process.env.LICENSE_OPS_PORT ?? 8790);
const refreshMs = clampInteger(process.env.LICENSE_OPS_REFRESH_MS, 5000, 1000, 60000);
const gatewayBase = normalizeBaseUrl(
  process.env.LICENSE_OPS_GATEWAY_BASE || 'http://127.0.0.1:8787',
);
const adminUsername = String(process.env.LICENSE_GATEWAY_ADMIN_USERNAME ?? 'admin');
const adminPassword = String(process.env.LICENSE_GATEWAY_ADMIN_PASSWORD ?? '');

const batchesDir = path.join(repoRoot, 'data', 'license-ops-batches');
let latestBatch = [];

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/') {
    sendHtml(res, 200, renderConsoleHtml());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    sendJson(res, 200, {
      ok: true,
      gateway_base: gatewayBase,
      refresh_ms: refreshMs,
      admin_username: adminUsername,
      env_path: envPath,
      env_exists: fs.existsSync(envPath),
      admin_password_configured: Boolean(adminPassword.trim()),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/latest-batch') {
    sendJson(res, 200, {
      ok: true,
      count: latestBatch.length,
      items: latestBatch,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/latest-batch.csv') {
    const csv = toCsv(latestBatch);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="latest-license-batch.csv"');
    res.end(csv);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    try {
      const email = String(requestUrl.searchParams.get('email') ?? '').trim();
      const status = String(requestUrl.searchParams.get('status') ?? '').trim();
      const query = new URLSearchParams();
      if (email) {
        query.set('email', email);
      }
      if (status) {
        query.set('status', status);
      }
      const querySuffix = query.toString() ? `?${query.toString()}` : '';
      const [licensesPayload, failuresPayload, healthPayload] = await Promise.all([
        gatewayFetchJson(`/admin/licenses${querySuffix}`),
        gatewayFetchJson('/admin/webhook-failures'),
        gatewayFetchJson('/health', { withAuth: false }),
      ]);
      const licenses = Array.isArray(licensesPayload?.items)
        ? licensesPayload.items
        : [];
      sendJson(res, 200, {
        ok: true,
        now: new Date().toISOString(),
        summary: buildSummary(licenses),
        licenses,
        webhook_failures: Array.isArray(failuresPayload?.items)
          ? failuresPayload.items
          : [],
        health: healthPayload,
      });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        error: String(error),
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/issue') {
    try {
      const payload = await readJsonBody(req);
      const mappedPayload = buildIssuePayload(payload);
      const result = await gatewayFetchJson('/admin/licenses/issue', {
        method: 'POST',
        body: mappedPayload,
      });
      latestBatch = Array.isArray(result?.items) ? result.items : [];
      const savedPaths = persistBatchFiles(latestBatch);
      sendJson(res, 200, {
        ok: true,
        result,
        files: savedPaths,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: String(error),
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/revoke') {
    try {
      const payload = await readJsonBody(req);
      const licenseId = String(payload?.license_id ?? '').trim();
      if (!licenseId) {
        throw new Error('license_id is required');
      }
      const result = await gatewayFetchJson(
        `/admin/licenses/${encodeURIComponent(licenseId)}/revoke`,
        {
          method: 'POST',
          body: {},
        },
      );
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reissue') {
    try {
      const payload = await readJsonBody(req);
      const licenseId = String(payload?.license_id ?? '').trim();
      if (!licenseId) {
        throw new Error('license_id is required');
      }
      const result = await gatewayFetchJson(
        `/admin/licenses/${encodeURIComponent(licenseId)}/reissue`,
        {
          method: 'POST',
          body: {},
        },
      );
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/resend') {
    try {
      const payload = await readJsonBody(req);
      const providerOrderId = String(payload?.provider_order_id ?? '').trim();
      if (!providerOrderId) {
        throw new Error('provider_order_id is required');
      }
      const result = await gatewayFetchJson(
        `/admin/orders/${encodeURIComponent(providerOrderId)}/resend`,
        {
          method: 'POST',
          body: {},
        },
      );
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error) });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not Found' });
});

server.listen(consolePort, () => {
  console.log(`[license-ops-console] running on http://127.0.0.1:${consolePort}`);
  console.log(`[license-ops-console] gateway: ${gatewayBase}`);
  if (!adminPassword.trim()) {
    console.warn(
      '[license-ops-console] LICENSE_GATEWAY_ADMIN_PASSWORD is empty; admin calls will fail.',
    );
  }
});

function buildIssuePayload(input) {
  const billingCycle = normalizeBillingCycleInput(input?.billing_cycle);
  if (!billingCycle) {
    throw new Error('billing_cycle must be monthly, yearly, or lifetime');
  }
  const quantity = clampInteger(input?.quantity, 1, 1, 200);
  const payload = {
    billing_cycle: billingCycle,
    quantity,
    send_email: Boolean(input?.send_email),
    plan: normalizePlanInput(input?.plan),
  };

  const daysRaw = String(input?.days ?? '').trim();
  if (daysRaw) {
    const days = Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw new Error('days must be a number between 1 and 3650');
    }
    payload.days = Math.floor(days);
  }

  const customerEmail = String(input?.customer_email ?? '').trim();
  if (customerEmail) {
    payload.customer_email = customerEmail;
  }

  const customerEmails = splitCustomerEmails(String(input?.customer_emails ?? ''));
  if (customerEmails.length > 0) {
    payload.customer_emails = customerEmails;
    payload.quantity = customerEmails.length;
  }

  const customerPrefix = String(input?.customer_prefix ?? '').trim();
  if (customerPrefix) {
    payload.customer_prefix = customerPrefix;
  }

  const customerDomain = String(input?.customer_domain ?? '').trim();
  if (customerDomain) {
    payload.customer_domain = customerDomain;
  }

  return payload;
}

function splitCustomerEmails(value) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBillingCycleInput(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'monthly' || normalized === 'month') {
    return 'monthly';
  }
  if (normalized === 'yearly' || normalized === 'year' || normalized === 'annual') {
    return 'yearly';
  }
  if (normalized === 'lifetime' || normalized === 'forever' || normalized === 'permanent') {
    return 'lifetime';
  }
  return null;
}

function normalizePlanInput(value) {
  const normalized = String(value ?? 'pro').trim().toLowerCase();
  return normalized === 'enterprise' ? 'enterprise' : 'pro';
}

function loadEnvLiteral(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeBaseUrl(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '');
}

async function gatewayFetchJson(pathname, { method = 'GET', body, withAuth = true } = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (withAuth) {
    const authToken = Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64');
    headers.Authorization = `Basic ${authToken}`;
  }

  const response = await fetch(`${gatewayBase}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const rawText = await response.text();
  let parsed = {};
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }
  }
  if (!response.ok) {
    const reason =
      typeof parsed?.error === 'string'
        ? parsed.error
        : rawText || `${response.status} ${response.statusText}`;
    throw new Error(`Gateway ${response.status}: ${reason}`);
  }
  return parsed;
}

function persistBatchFiles(items) {
  ensureDir(batchesDir);
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const jsonPath = path.join(batchesDir, `license-batch-${stamp}.json`);
  const csvPath = path.join(batchesDir, `license-batch-${stamp}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2));
  fs.writeFileSync(csvPath, toCsv(items));
  return { json_path: jsonPath, csv_path: csvPath };
}

function toCsv(items) {
  const rows = Array.isArray(items) ? items : [];
  const headers = [
    'provider_order_id',
    'license_id',
    'customer_email',
    'billing_cycle',
    'expires_at',
    'activation_code',
    'email_sent',
    'email_error',
  ];
  const escape = (value) => {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) {
      return text;
    }
    return `"${text.replaceAll('"', '""')}"`;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row?.[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildSummary(licenses) {
  const nowMs = Date.now();
  const in7Days = nowMs + 7 * 24 * 60 * 60 * 1000;
  const in24Hours = nowMs - 24 * 60 * 60 * 1000;
  const summary = {
    total: 0,
    active: 0,
    revoked: 0,
    replaced: 0,
    expiring_in_7_days: 0,
    verified_in_24h: 0,
  };
  for (const license of licenses) {
    summary.total += 1;
    if (license?.status === 'active') {
      summary.active += 1;
    } else if (license?.status === 'revoked') {
      summary.revoked += 1;
    } else if (license?.status === 'replaced') {
      summary.replaced += 1;
    }
    const expiresMs = Date.parse(String(license?.expires_at ?? ''));
    if (Number.isFinite(expiresMs) && expiresMs <= in7Days && expiresMs >= nowMs) {
      summary.expiring_in_7_days += 1;
    }
    const verifiedMs = Date.parse(String(license?.last_verified_at ?? ''));
    if (Number.isFinite(verifiedMs) && verifiedMs >= in24Hours) {
      summary.verified_in_24h += 1;
    }
  }
  return summary;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const integer = Math.floor(parsed);
  if (integer < min) {
    return min;
  }
  if (integer > max) {
    return max;
  }
  return integer;
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) {
    return {};
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function renderConsoleHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentShield License Ops Console</title>
  <style>
    :root {
      --bg: #0b1220;
      --panel: #111b30;
      --muted: #94a3b8;
      --text: #e2e8f0;
      --accent: #22d3ee;
      --danger: #f87171;
      --ok: #34d399;
      --warn: #fbbf24;
      --line: #22314d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: radial-gradient(1200px 600px at 20% -10%, #12315f 0%, var(--bg) 40%);
      color: var(--text);
      min-height: 100vh;
    }
    .container {
      width: min(1200px, 96vw);
      margin: 20px auto 40px;
      display: grid;
      gap: 14px;
    }
    .panel {
      background: color-mix(in srgb, var(--panel) 92%, #000 8%);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
    }
    h1, h2 { margin: 0 0 10px; font-weight: 700; }
    h1 { font-size: 20px; }
    h2 { font-size: 16px; }
    .hint { color: var(--muted); font-size: 12px; margin-top: 6px; }
    .grid { display: grid; gap: 10px; grid-template-columns: repeat(12, 1fr); }
    .field { display: grid; gap: 6px; }
    .span-2 { grid-column: span 2; }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    label { font-size: 12px; color: var(--muted); }
    input, select, textarea, button {
      width: 100%;
      background: #0c1528;
      color: var(--text);
      border: 1px solid #2b3b60;
      border-radius: 8px;
      padding: 9px 10px;
      font: inherit;
    }
    textarea { min-height: 88px; resize: vertical; }
    button {
      cursor: pointer;
      transition: transform .1s ease, border-color .1s ease;
    }
    button:hover { transform: translateY(-1px); border-color: var(--accent); }
    button.secondary { background: #0f1c34; }
    button.danger { border-color: #7f1d1d; color: #fecaca; }
    button.warn { border-color: #713f12; color: #fde68a; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); font-size: 12px; color: var(--muted); }
    .cards { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
    .card { background: #0f1b32; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
    .card .k { color: var(--muted); font-size: 11px; }
    .card .v { font-size: 18px; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #22314d; padding: 7px 6px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    code { background: #0a1326; border: 1px solid #253a63; border-radius: 6px; padding: 1px 6px; }
    .status-ok { color: var(--ok); }
    .status-err { color: var(--danger); }
    .status-warn { color: var(--warn); }
    .sticky-tools { position: sticky; top: 0; backdrop-filter: blur(8px); z-index: 1; }
    @media (max-width: 980px) {
      .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .span-2, .span-3, .span-4, .span-6, .span-8 { grid-column: span 12; }
      th:nth-child(n+7), td:nth-child(n+7) { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <section class="panel">
      <h1>AgentShield License Ops Console</h1>
      <div class="row">
        <span id="gatewayStatus" class="badge">Gateway: checking...</span>
        <span id="envStatus" class="badge">Env: checking...</span>
        <span id="refreshStatus" class="badge">Refresh: --</span>
      </div>
      <div class="hint">用于本地管理激活码：批量签发、撤销、重发、实时追踪验证状态。</div>
    </section>

    <section class="panel">
      <h2>批量签发</h2>
      <form id="issueForm" class="grid">
        <div class="field span-2">
          <label>数量 (1-200)</label>
          <input name="quantity" type="number" min="1" max="200" value="10" />
        </div>
        <div class="field span-2">
          <label>周期</label>
          <select name="billing_cycle">
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
            <option value="lifetime">lifetime</option>
          </select>
        </div>
        <div class="field span-2">
          <label>自定义天数 (可选)</label>
          <input name="days" type="number" min="1" max="3650" placeholder="留空用默认" />
        </div>
        <div class="field span-3">
          <label>单邮箱 (可选，批量会自动 +gift 别名)</label>
          <input name="customer_email" type="email" placeholder="creator@example.com" />
        </div>
        <div class="field span-3">
          <label>自动生成前缀/域名 (可选)</label>
          <div class="row">
            <input name="customer_prefix" placeholder="gift" />
            <input name="customer_domain" placeholder="agentshield.local" />
          </div>
        </div>
        <div class="field span-12">
          <label>多邮箱列表 (可选，支持换行/逗号，填了会覆盖数量)</label>
          <textarea name="customer_emails" placeholder="a@example.com&#10;b@example.com"></textarea>
        </div>
        <div class="field span-12">
          <label><input name="send_email" type="checkbox" style="width:auto;margin-right:6px;" /> 同步发邮件（需要 Resend 已配置）</label>
        </div>
        <div class="field span-12">
          <div class="row">
            <button type="submit">生成激活码</button>
            <button type="button" id="downloadLatestCsv" class="secondary">下载最近批次 CSV</button>
          </div>
        </div>
      </form>
      <div id="issueMessage" class="hint"></div>
      <div id="issuedTableWrap"></div>
    </section>

    <section class="panel sticky-tools">
      <h2>实时追踪</h2>
      <div class="grid">
        <div class="field span-3">
          <label>按邮箱过滤</label>
          <input id="filterEmail" placeholder="buyer@example.com" />
        </div>
        <div class="field span-2">
          <label>状态</label>
          <select id="filterStatus">
            <option value="">all</option>
            <option value="active">active</option>
            <option value="revoked">revoked</option>
            <option value="replaced">replaced</option>
          </select>
        </div>
        <div class="field span-3">
          <label>自动刷新</label>
          <div class="row">
            <button type="button" id="refreshNow">立即刷新</button>
            <button type="button" id="toggleAuto" class="secondary">暂停自动刷新</button>
          </div>
        </div>
      </div>
      <div id="summaryCards" class="cards"></div>
    </section>

    <section class="panel">
      <div id="dashboardMessage" class="hint"></div>
      <div style="overflow:auto;">
        <table>
          <thead>
            <tr>
              <th>license_id</th>
              <th>customer</th>
              <th>cycle</th>
              <th>status</th>
              <th>expires_at</th>
              <th>verify_count</th>
              <th>last_verified_at</th>
              <th>order_id</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody id="licensesBody"></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>Webhook 失败队列</h2>
      <div id="webhookFailures"></div>
    </section>
  </div>

  <script>
    const state = {
      autoRefresh: true,
      refreshTimer: null,
      refreshMs: 5000,
      gatewayBase: '',
      latestBatch: [],
    };

    const qs = (selector) => document.querySelector(selector);
    const esc = (v) => String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

    async function api(path, options = {}) {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const err = data.error || response.statusText || 'request failed';
        throw new Error(err);
      }
      return data;
    }

    function setMessage(target, text, type = 'hint') {
      target.className = type === 'error' ? 'status-err' : type === 'ok' ? 'status-ok' : 'hint';
      target.textContent = text;
    }

    function renderSummary(summary) {
      const cards = [
        ['总数', summary.total],
        ['Active', summary.active],
        ['Revoked', summary.revoked],
        ['Replaced', summary.replaced],
        ['7天内到期', summary.expiring_in_7_days],
        ['24h有验证', summary.verified_in_24h],
      ];
      qs('#summaryCards').innerHTML = cards.map(([k, v]) => (
        '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'
      )).join('');
    }

    function renderLicenses(licenses) {
      const rows = licenses.map((item) => {
        const actions = [
          '<button data-action="revoke" data-license-id="' + esc(item.license_id) + '" class="danger">撤销</button>',
          '<button data-action="reissue" data-license-id="' + esc(item.license_id) + '" class="warn">重签</button>',
          item.provider_order_id
            ? '<button data-action="resend" data-order-id="' + esc(item.provider_order_id) + '" class="secondary">重发</button>'
            : '',
        ].join('');
        return [
          '<tr>',
          '<td><code>' + esc(item.license_id) + '</code></td>',
          '<td>' + esc(item.customer_email || '-') + '</td>',
          '<td>' + esc(item.billing_cycle || '-') + '</td>',
          '<td>' + esc(item.status || '-') + '</td>',
          '<td>' + esc(item.expires_at || 'Never') + '</td>',
          '<td>' + esc(item.verify_count ?? 0) + '</td>',
          '<td>' + esc(item.last_verified_at || '-') + '</td>',
          '<td><code>' + esc(item.provider_order_id || '-') + '</code></td>',
          '<td><div class="row">' + actions + '</div></td>',
          '</tr>',
        ].join('');
      });
      qs('#licensesBody').innerHTML = rows.join('');
    }

    function renderWebhookFailures(items) {
      if (!items.length) {
        qs('#webhookFailures').innerHTML = '<div class="status-ok">暂无失败事件</div>';
        return;
      }
      qs('#webhookFailures').innerHTML = '<div style="overflow:auto;"><table><thead><tr><th>time</th><th>reason</th><th>order_id</th><th>details</th></tr></thead><tbody>' +
        items.slice(0, 20).map((item) => (
          '<tr><td>' + esc(item.created_at || '-') + '</td><td>' + esc(item.reason || '-') + '</td><td>' + esc(item.provider_order_id || '-') + '</td><td>' + esc(item.details || '-') + '</td></tr>'
        )).join('') +
        '</tbody></table></div>';
    }

    function renderLatestBatch(items) {
      state.latestBatch = items;
      if (!items.length) {
        qs('#issuedTableWrap').innerHTML = '';
        return;
      }
      const rows = items.map((item) => (
        '<tr>' +
        '<td><code>' + esc(item.license_id) + '</code></td>' +
        '<td>' + esc(item.customer_email || '-') + '</td>' +
        '<td>' + esc(item.billing_cycle || '-') + '</td>' +
        '<td>' + esc(item.expires_at || 'Never') + '</td>' +
        '<td><code>' + esc(item.activation_code) + '</code></td>' +
        '<td>' + esc(item.email_sent ? 'yes' : 'no') + '</td>' +
        '</tr>'
      )).join('');
      qs('#issuedTableWrap').innerHTML =
        '<h2 style="margin-top:12px;">最近批次</h2>' +
        '<div style="overflow:auto;"><table><thead><tr><th>license_id</th><th>customer</th><th>cycle</th><th>expires</th><th>code</th><th>email_sent</th></tr></thead><tbody>' +
        rows +
        '</tbody></table></div>';
    }

    async function refreshDashboard() {
      const email = qs('#filterEmail').value.trim();
      const status = qs('#filterStatus').value;
      const params = new URLSearchParams();
      if (email) params.set('email', email);
      if (status) params.set('status', status);
      const suffix = params.toString() ? '?' + params.toString() : '';
      const msg = qs('#dashboardMessage');
      try {
        const data = await api('/api/dashboard' + suffix);
        renderSummary(data.summary || {});
        renderLicenses(data.licenses || []);
        renderWebhookFailures(data.webhook_failures || []);
        setMessage(msg, '刷新成功: ' + new Date().toLocaleTimeString(), 'ok');
      } catch (error) {
        setMessage(msg, String(error), 'error');
      }
    }

    function updateRefreshStatus() {
      qs('#refreshStatus').textContent = 'Refresh: ' + (state.autoRefresh ? (state.refreshMs / 1000) + 's auto' : 'paused');
      qs('#toggleAuto').textContent = state.autoRefresh ? '暂停自动刷新' : '恢复自动刷新';
    }

    function startAutoRefresh() {
      stopAutoRefresh();
      state.refreshTimer = setInterval(() => {
        if (state.autoRefresh) {
          refreshDashboard();
        }
      }, state.refreshMs);
    }

    function stopAutoRefresh() {
      if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
      }
      state.refreshTimer = null;
    }

    async function bootstrap() {
      const gatewayStatus = qs('#gatewayStatus');
      const envStatus = qs('#envStatus');
      try {
        const config = await api('/api/config');
        state.refreshMs = config.refresh_ms;
        state.gatewayBase = config.gateway_base;
        gatewayStatus.textContent = 'Gateway: ' + config.gateway_base;
        gatewayStatus.className = 'badge status-ok';
        envStatus.textContent = 'Env: ' + (config.env_exists ? 'loaded' : 'not found');
        envStatus.className = 'badge ' + (config.env_exists ? 'status-ok' : 'status-warn');
      } catch (error) {
        gatewayStatus.textContent = 'Gateway: ' + String(error);
        gatewayStatus.className = 'badge status-err';
      }

      try {
        const latest = await api('/api/latest-batch');
        renderLatestBatch(latest.items || []);
      } catch {
        renderLatestBatch([]);
      }

      updateRefreshStatus();
      startAutoRefresh();
      await refreshDashboard();
    }

    qs('#issueForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        quantity: Number(formData.get('quantity') || 1),
        billing_cycle: formData.get('billing_cycle'),
        days: formData.get('days'),
        customer_email: formData.get('customer_email'),
        customer_emails: formData.get('customer_emails'),
        customer_prefix: formData.get('customer_prefix'),
        customer_domain: formData.get('customer_domain'),
        send_email: formData.get('send_email') === 'on',
      };
      const msg = qs('#issueMessage');
      setMessage(msg, '正在生成...', 'hint');
      try {
        const result = await api('/api/issue', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        renderLatestBatch(result.result.items || []);
        const fileHint = result.files
          ? ('，已保存: ' + result.files.csv_path)
          : '';
        setMessage(msg, '生成成功，共 ' + (result.result.count || 0) + ' 个激活码' + fileHint, 'ok');
        await refreshDashboard();
      } catch (error) {
        setMessage(msg, String(error), 'error');
      }
    });

    qs('#downloadLatestCsv').addEventListener('click', () => {
      window.location.href = '/api/latest-batch.csv';
    });

    qs('#refreshNow').addEventListener('click', () => refreshDashboard());
    qs('#toggleAuto').addEventListener('click', () => {
      state.autoRefresh = !state.autoRefresh;
      updateRefreshStatus();
      if (state.autoRefresh) {
        refreshDashboard();
      }
    });

    qs('#filterEmail').addEventListener('change', () => refreshDashboard());
    qs('#filterStatus').addEventListener('change', () => refreshDashboard());

    qs('#licensesBody').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) {
        return;
      }
      const action = button.dataset.action;
      const licenseId = button.dataset.licenseId;
      const orderId = button.dataset.orderId;
      const msg = qs('#dashboardMessage');
      try {
        if (action === 'revoke' && licenseId) {
          await api('/api/revoke', {
            method: 'POST',
            body: JSON.stringify({ license_id: licenseId }),
          });
          setMessage(msg, '已撤销: ' + licenseId, 'ok');
        } else if (action === 'reissue' && licenseId) {
          const result = await api('/api/reissue', {
            method: 'POST',
            body: JSON.stringify({ license_id: licenseId }),
          });
          const newCode = result?.result?.activation_code;
          if (newCode) {
            await navigator.clipboard.writeText(newCode).catch(() => {});
          }
          setMessage(msg, '已重签: ' + licenseId + (newCode ? '（新码已尝试复制）' : ''), 'ok');
        } else if (action === 'resend' && orderId) {
          const result = await api('/api/resend', {
            method: 'POST',
            body: JSON.stringify({ provider_order_id: orderId }),
          });
          const code = result?.result?.activation_code;
          if (code) {
            await navigator.clipboard.writeText(code).catch(() => {});
          }
          setMessage(msg, '已重发: ' + orderId + (code ? '（激活码已尝试复制）' : ''), 'ok');
        }
        await refreshDashboard();
      } catch (error) {
        setMessage(msg, String(error), 'error');
      }
    });

    bootstrap();
  </script>
</body>
</html>`;
}
