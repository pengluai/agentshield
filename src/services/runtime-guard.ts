import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriInvoke as invoke } from '@/services/tauri';

export interface RuntimeGuardComponent {
  component_id: string;
  component_type: string;
  name: string;
  platform_id: string;
  platform_name: string;
  source_kind: string;
  install_channel: string;
  config_path: string;
  exec_command: string;
  exec_args: string[];
  file_hash: string;
  signing_state: string;
  trust_state: string;
  network_mode: string;
  allowed_domains: string[];
  allowed_env_keys: string[];
  sensitive_capabilities: string[];
  requires_explicit_approval: boolean;
  risk_summary: string;
  first_seen_at: string;
  last_seen_at: string;
  last_launched_at: string | null;
  last_parent_pid: number | null;
  last_supervisor_session_id: string | null;
}

export interface RuntimeGuardEvent {
  id: string;
  timestamp: string;
  event_type: string;
  component_id: string;
  severity: string;
  title: string;
  description: string;
  action: string;
}

export interface RuntimeApprovalRequest {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  expires_at?: string | null;
  component_id: string;
  component_name: string;
  platform_id: string;
  platform_name: string;
  request_kind: string;
  trigger_event: string;
  title: string;
  summary: string;
  approval_label: string;
  deny_label: string;
  action_kind: string;
  action_source: string;
  action_targets: string[];
  action_preview: string[];
  is_destructive: boolean;
  is_batch: boolean;
  approval_scope_key?: string | null;
  requested_host: string | null;
  sensitive_capabilities: string[];
  consequence_lines: string[];
  launch_after_approval: boolean;
  session_id: string | null;
}

export interface RuntimeActionApprovalInput {
  component_id?: string | null;
  component_name: string;
  platform_id: string;
  platform_name: string;
  request_kind: string;
  trigger_event?: string | null;
  action_kind: string;
  action_source: string;
  action_targets: string[];
  action_preview: string[];
  sensitive_capabilities?: string[];
  requested_host?: string | null;
  is_destructive?: boolean;
  is_batch?: boolean;
}

export interface RuntimeActionApprovalResult {
  status: 'approved' | 'pending';
  request: RuntimeApprovalRequest;
  approval_ticket?: string | null;
}

export interface RuntimeConnection {
  pid: number;
  protocol: string;
  local_address: string;
  remote_address: string;
  remote_host_hint: string;
  state: string;
  observed_at: string;
}

export interface RuntimeGuardSession {
  session_id: string;
  component_id: string;
  component_name: string;
  platform_id: string;
  pid: number;
  parent_pid: number | null;
  child_pids: number[];
  observed: boolean;
  supervised: boolean;
  status: string;
  commandline: string;
  exe_path: string;
  cwd: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  network_connections: RuntimeConnection[];
  last_violation: string | null;
}

export interface RuntimeGuardStatus {
  enabled: boolean;
  polling: boolean;
  last_poll_at: string | null;
  active_sessions: number;
  blocked_actions: number;
  pending_approvals: number;
  last_violation: string | null;
}

export interface RuntimeGuardPolicy {
  unknown_default_trust: string;
  managed_default_trust: string;
  reviewed_default_trust: string;
  blocked_network_mode: string;
  restricted_network_mode: string;
  trusted_network_mode: string;
  enforce_blocked_runtime: boolean;
  enforce_restricted_allowlist: boolean;
  poll_interval_secs: number;
  max_sessions: number;
}

function isTauriEnvironment() {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

export async function syncRuntimeGuardComponents(): Promise<RuntimeGuardComponent[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    const result = await invoke<RuntimeGuardComponent[]>('sync_runtime_guard_components');
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error('Failed to sync runtime guard components:', error);
    return [];
  }
}

export async function listRuntimeGuardComponents(): Promise<RuntimeGuardComponent[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    const result = await invoke<RuntimeGuardComponent[]>('list_runtime_guard_components');
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error('Failed to list runtime guard components:', error);
    return [];
  }
}

export async function listRuntimeGuardSessions(): Promise<RuntimeGuardSession[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    const result = await invoke<RuntimeGuardSession[]>('list_runtime_guard_sessions');
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error('Failed to list runtime guard sessions:', error);
    return [];
  }
}

export async function listRuntimeGuardEvents(): Promise<RuntimeGuardEvent[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    const result = await invoke<RuntimeGuardEvent[]>('list_runtime_guard_events');
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error('Failed to list runtime guard events:', error);
    return [];
  }
}

export async function listRuntimeGuardApprovalRequests(): Promise<RuntimeApprovalRequest[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    const result = await invoke<RuntimeApprovalRequest[]>('list_runtime_guard_approval_requests');
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error('Failed to list runtime guard approval requests:', error);
    return [];
  }
}

export async function clearRuntimeGuardEvents(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    const result = await invoke<boolean>('clear_runtime_guard_events');
    return Boolean(result);
  } catch (error) {
    console.error('Failed to clear runtime guard events:', error);
    return false;
  }
}

export async function listenRuntimeGuardApprovals(
  handler: (approval: RuntimeApprovalRequest) => void
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }

  return listen<RuntimeApprovalRequest>('runtime-guard-approval', (event) => {
    handler(event.payload);
  });
}

export async function getRuntimeGuardStatus(): Promise<RuntimeGuardStatus | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    const result = await invoke<RuntimeGuardStatus>('get_runtime_guard_status');
    return result && typeof result === 'object' ? result : null;
  } catch (error) {
    console.error('Failed to get runtime guard status:', error);
    return null;
  }
}

export async function getRuntimeGuardPolicy(): Promise<RuntimeGuardPolicy | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    const result = await invoke<RuntimeGuardPolicy>('get_runtime_guard_policy');
    return result && typeof result === 'object' ? result : null;
  } catch (error) {
    console.error('Failed to get runtime guard policy:', error);
    return null;
  }
}

export async function runRuntimeGuardPollNow(): Promise<RuntimeGuardStatus | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    const result = await invoke<RuntimeGuardStatus>('run_runtime_guard_poll_now');
    return result && typeof result === 'object' ? result : null;
  } catch (error) {
    console.error('Failed to run runtime guard poll:', error);
    return null;
  }
}

export async function updateRuntimeGuardPolicy(policy: RuntimeGuardPolicy, approvalTicket?: string) {
  try {
    return await invoke<RuntimeGuardPolicy>('update_runtime_guard_policy', {
      policy,
      approvalTicket: approvalTicket ?? null,
      approval_ticket: approvalTicket ?? null,
    });
  } catch (error) {
    console.error('Failed to update runtime guard policy:', error);
    throw Object.assign(new Error(`Failed to update runtime guard policy: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function resolveRuntimeGuardApprovalRequest(requestId: string, decision: 'approve' | 'deny') {
  try {
    return await invoke<RuntimeApprovalRequest>('resolve_runtime_guard_approval_request', {
      requestId,
      request_id: requestId,
      decision,
    });
  } catch (error) {
    console.error('Failed to resolve runtime approval request:', error);
    throw Object.assign(
      new Error(`Failed to resolve runtime approval request: ${String(error)}`),
      { cause: error }
    );
  }
}

export async function requestRuntimeGuardActionApproval(input: RuntimeActionApprovalInput) {
  try {
    return await invoke<RuntimeActionApprovalResult>('request_runtime_guard_action_approval', {
      input,
    });
  } catch (error) {
    console.error('Failed to request runtime action approval:', error);
    throw Object.assign(new Error(`Failed to request runtime action approval: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function updateComponentTrustState(
  componentId: string,
  trustState: string,
  reason?: string,
  approvalTicket?: string,
) {
  try {
    return await invoke<RuntimeGuardComponent>('update_component_trust_state', {
      componentId,
      trustState,
      reason: reason ?? null,
      approvalTicket: approvalTicket ?? null,
      approval_ticket: approvalTicket ?? null,
    });
  } catch (error) {
    console.error('Failed to update component trust state:', error);
    throw Object.assign(new Error(`Failed to update component trust state: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function updateComponentNetworkPolicy(
  componentId: string,
  allowedDomains: string[],
  networkMode?: string,
  approvalTicket?: string,
) {
  try {
    return await invoke<RuntimeGuardComponent>('update_component_network_policy', {
      componentId,
      allowedDomains,
      networkMode: networkMode ?? null,
      approvalTicket: approvalTicket ?? null,
      approval_ticket: approvalTicket ?? null,
    });
  } catch (error) {
    console.error('Failed to update component network policy:', error);
    throw Object.assign(new Error(`Failed to update component network policy: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function launchRuntimeGuardComponent(componentId: string) {
  try {
    return await invoke<RuntimeGuardSession>('launch_runtime_guard_component', {
      componentId,
    });
  } catch (error) {
    console.error('Failed to launch runtime guard component:', error);
    throw Object.assign(new Error(`Failed to launch runtime guard component: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function terminateRuntimeGuardSession(sessionId: string) {
  try {
    return await invoke<boolean>('terminate_runtime_guard_session', {
      sessionId,
    });
  } catch (error) {
    console.error('Failed to terminate runtime guard session:', error);
    throw Object.assign(new Error(`Failed to terminate runtime guard session: ${String(error)}`), {
      cause: error,
    });
  }
}
