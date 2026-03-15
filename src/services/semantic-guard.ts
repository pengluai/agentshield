import { invoke } from '@tauri-apps/api/core';

export interface SemanticGuardStatus {
  licensed: boolean;
  configured: boolean;
  active: boolean;
  message: string;
}

export async function getSemanticGuardStatus(): Promise<SemanticGuardStatus> {
  return invoke<SemanticGuardStatus>('get_semantic_guard_status');
}

export async function configureSemanticGuard(accessKey: string): Promise<SemanticGuardStatus> {
  return invoke<SemanticGuardStatus>('configure_semantic_guard', { accessKey });
}

export async function clearSemanticGuardKey(): Promise<boolean> {
  return invoke<boolean>('clear_semantic_guard_key');
}
