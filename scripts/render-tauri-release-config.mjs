#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outputPath = path.resolve(
  rootDir,
  process.env.PUBLIC_TAURI_CONFIG_PATH || 'src-tauri/tauri.release.json',
);

const publicKey = (process.env.TAURI_UPDATER_PUBLIC_KEY || '').trim();
const endpointInput =
  (process.env.TAURI_UPDATER_ENDPOINTS_JSON || '').trim() ||
  (process.env.TAURI_UPDATER_ENDPOINTS || '').trim() ||
  (process.env.TAURI_UPDATER_ENDPOINT || '').trim();

if (!publicKey) {
  console.error(
    '[render-tauri-release-config] missing TAURI_UPDATER_PUBLIC_KEY',
  );
  process.exit(2);
}

if (!endpointInput) {
  console.error(
    '[render-tauri-release-config] missing TAURI_UPDATER_ENDPOINT / TAURI_UPDATER_ENDPOINTS / TAURI_UPDATER_ENDPOINTS_JSON',
  );
  process.exit(2);
}

let endpoints = [];
if (endpointInput.startsWith('[')) {
  try {
    const parsed = JSON.parse(endpointInput);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('endpoint array is empty');
    }
    endpoints = parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch (error) {
    console.error(
      `[render-tauri-release-config] invalid TAURI_UPDATER_ENDPOINTS_JSON: ${error.message}`,
    );
    process.exit(2);
  }
} else {
  endpoints = endpointInput
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

if (endpoints.length === 0) {
  console.error('[render-tauri-release-config] no valid updater endpoints');
  process.exit(2);
}

for (const endpoint of endpoints) {
  if (!endpoint.startsWith('https://')) {
    console.error(
      `[render-tauri-release-config] updater endpoint must start with https:// -> ${endpoint}`,
    );
    process.exit(2);
  }
}

const windowsThumbprint = (process.env.WINDOWS_CERTIFICATE_THUMBPRINT || '').trim();
const windowsTimestampUrl = (process.env.WINDOWS_TIMESTAMP_URL || '').trim();

const bundle = {
  createUpdaterArtifacts: true,
};

if (windowsThumbprint || windowsTimestampUrl) {
  if (!windowsThumbprint || !windowsTimestampUrl) {
    console.error(
      '[render-tauri-release-config] WINDOWS_CERTIFICATE_THUMBPRINT and WINDOWS_TIMESTAMP_URL must both be set when enabling windows signing fields',
    );
    process.exit(2);
  }

  bundle.windows = {
    certificateThumbprint: windowsThumbprint,
    digestAlgorithm: 'sha256',
    timestampUrl: windowsTimestampUrl,
  };
}

const config = {
  $schema:
    'https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json',
  bundle,
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints,
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(
  `[render-tauri-release-config] wrote ${path.relative(rootDir, outputPath)}`,
);
