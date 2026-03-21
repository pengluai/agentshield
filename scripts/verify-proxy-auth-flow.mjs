import { spawnSync } from 'node:child_process';

function run(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

run('verify-ai-proxy-auth-flow', ['scripts/verify-ai-proxy-auth-flow.mjs']);
run('verify-license-gateway-proxy-token', [
  '--loader',
  './scripts/html-loader.mjs',
  'scripts/verify-license-gateway-proxy-token.mjs',
]);
run('verify-license-gateway-webhook-idempotency', [
  '--loader',
  './scripts/html-loader.mjs',
  'scripts/verify-license-gateway-webhook-idempotency.mjs',
]);

console.log('verify-proxy-auth-flow: all checks passed');
