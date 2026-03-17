import { tauriInvoke as invoke } from '@/services/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// Types matching Rust backend
export interface DetectedTool {
  id: string;
  name: string;
  icon: string;
  detected: boolean;
  host_detected?: boolean;
  install_target_ready?: boolean;
  detection_sources?: string[];
  path: string | null;
  version: string | null;
  has_mcp_config: boolean;
  mcp_config_path: string | null;
  mcp_config_paths: string[];
  host_confidence?: 'high' | 'medium' | 'low';
  risk_surface?: {
    has_mcp: boolean;
    has_skill: boolean;
    has_exec_signal: boolean;
    has_secret_signal: boolean;
    evidence_count: number;
  };
  management_capability?: 'detect_only' | 'manual' | 'one_click';
  source_tier?: 'a' | 'b' | 'c';
  evidence_items?: Array<{
    evidence_type: string;
    path: string;
    detail?: string | null;
  }>;
}

export interface ExposedKey {
  id: string;
  key_pattern: string;
  file_path: string;
  platform: string;
  service: string;
  masked_value: string;
}

export interface RustSecurityIssue {
  id: string;
  severity: string;
  title: string;
  description: string;
  auto_fixable: boolean;
  pro_required: boolean;
  file_path: string | null;
  semantic_review: {
    verdict: string;
    confidence: number;
    summary: string;
    recommended_action: string;
  } | null;
}

export interface SemanticGuardSummary {
  licensed: boolean;
  configured: boolean;
  active: boolean;
  reviewed_issues: number;
  cache_hits: number;
  message: string;
}

export interface ScanCategory {
  id: string;
  name: string;
  issue_count: number;
  issues: RustSecurityIssue[];
  passed_count: number;
}

export interface RealScanResult {
  detected_tools: DetectedTool[];
  categories: ScanCategory[];
  exposed_keys: ExposedKey[];
  score: number;
  total_issues: number;
  semantic_guard: SemanticGuardSummary;
}

export interface ScanProgressEvent {
  phase_id: string;
  label: string;
  progress: number;
  status: 'running' | 'completed' | 'failed' | string;
}

function isTauriEnvironment() {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as typeof window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

/**
 * Detect AI tools installed on the system.
 * Calls Rust backend which scans filesystem for .app bundles, CLI tools, and config dirs.
 */
export async function detectAiTools(): Promise<DetectedTool[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    return await invoke<DetectedTool[]>('detect_ai_tools');
  } catch (e) {
    console.error('Failed to detect AI tools:', e);
    return [];
  }
}

/**
 * Run a full security scan.
 * Returns real scan results from the Rust backend.
 */
export async function runFullScan(): Promise<RealScanResult | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  try {
    return await invoke<RealScanResult>('scan_full');
  } catch (e) {
    console.error('Failed to run full scan:', e);
    return null;
  }
}

/**
 * Scan for exposed API keys in config files.
 */
export async function scanExposedKeys(): Promise<ExposedKey[]> {
  if (!isTauriEnvironment()) {
    return [];
  }

  try {
    return await invoke<ExposedKey[]>('scan_exposed_keys');
  } catch (e) {
    console.error('Failed to scan exposed keys:', e);
    return [];
  }
}

export async function listenScanProgress(
  handler: (event: ScanProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriEnvironment()) {
    return () => {};
  }

  return listen<ScanProgressEvent>('scan-progress', (event) => {
    handler(event.payload);
  });
}

export async function runFullScanWithProgress(
  handler: (event: ScanProgressEvent) => void,
): Promise<RealScanResult | null> {
  const unlisten = await listenScanProgress(handler);

  try {
    return await runFullScan();
  } finally {
    unlisten();
  }
}

// Manual fix guide for free users
export interface ManualFixStep {
  step_type: string;
  title: string;
  description: string;
  commands: string[];
  target_path: string;
  severity: string;
}

export async function getManualFixGuide(
  issueType: string,
  targetPath: string,
  detail?: string,
): Promise<ManualFixStep[]> {
  if (!isTauriEnvironment()) {
    return [];
  }
  return invoke<ManualFixStep[]>('generate_manual_fix_guide', {
    issueType,
    targetPath,
    detail: detail ?? null,
  });
}

export async function cancelScan(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    await invoke('scan_cancel');
    return true;
  } catch (error) {
    console.error('Failed to cancel scan:', error);
    return false;
  }
}
