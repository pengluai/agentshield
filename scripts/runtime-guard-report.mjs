import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseDir = process.env.AGENTSHIELD_DATA_DIR || path.join(os.homedir(), '.agentshield');

function readJson(filename, fallback) {
  const target = path.join(baseDir, filename);
  if (!fs.existsSync(target)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    console.error(`[runtime-guard-report] failed to parse ${target}:`, error.message);
    return fallback;
  }
}

function groupCount(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item?.[key] || 'unknown';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printSection(title, rows) {
  console.log(`\n## ${title}`);
  if (!rows.length) {
    console.log('- none');
    return;
  }

  for (const row of rows) {
    console.log(`- ${row}`);
  }
}

const components = readJson('runtime-guard-components.json', []);
const events = readJson('runtime-guard-events.json', []);
const sessions = readJson('runtime-guard-sessions.json', []);
const policy = readJson('runtime-guard-policy.json', null);

console.log('# AgentShield Runtime Guard Report');
console.log(`data_dir: ${baseDir}`);
console.log(`generated_at: ${new Date().toISOString()}`);
console.log(`components: ${components.length}`);
console.log(`events: ${events.length}`);
console.log(`sessions: ${sessions.length}`);

printSection(
  'Trust Distribution',
  groupCount(components, 'trust_state').map(([key, count]) => `${key}: ${count}`),
);

printSection(
  'Source Distribution',
  groupCount(components, 'source_kind').map(([key, count]) => `${key}: ${count}`),
);

printSection(
  'Recent Critical Events',
  events
    .filter((event) => event?.severity === 'critical')
    .slice(0, 10)
    .map((event) => `${event.timestamp} | ${event.title} | ${event.component_id} | ${event.action}`),
);

printSection(
  'Active Sessions',
  sessions
    .filter((session) => session?.status === 'running')
    .slice(0, 20)
    .map((session) => `${session.component_name} | pid=${session.pid} | supervised=${session.supervised} | violation=${session.last_violation || 'none'}`),
);

if (policy) {
  printSection('Policy Baseline', [
    `unknown_default_trust: ${policy.unknown_default_trust}`,
    `managed_default_trust: ${policy.managed_default_trust}`,
    `reviewed_default_trust: ${policy.reviewed_default_trust}`,
    `restricted_network_mode: ${policy.restricted_network_mode}`,
    `enforce_blocked_runtime: ${policy.enforce_blocked_runtime}`,
    `enforce_restricted_allowlist: ${policy.enforce_restricted_allowlist}`,
    `poll_interval_secs: ${policy.poll_interval_secs}`,
    `max_sessions: ${policy.max_sessions}`,
  ]);
}
