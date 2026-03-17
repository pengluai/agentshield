import { tauriInvoke as invoke } from '@/services/tauri';

export interface SemanticGuardStatus {
  licensed: boolean;
  configured: boolean;
  active: boolean;
  message: string;
}

export async function getSemanticGuardStatus(): Promise<SemanticGuardStatus> {
  try {
    return await invoke<SemanticGuardStatus>('get_semantic_guard_status');
  } catch (error) {
    console.error('Failed to get semantic guard status:', error);
    throw Object.assign(new Error(`Failed to get semantic guard status: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function configureSemanticGuard(accessKey: string): Promise<SemanticGuardStatus> {
  try {
    return await invoke<SemanticGuardStatus>('configure_semantic_guard', { accessKey });
  } catch (error) {
    console.error('Failed to configure semantic guard:', error);
    throw Object.assign(new Error(`Failed to configure semantic guard: ${String(error)}`), {
      cause: error,
    });
  }
}

export async function clearSemanticGuardKey(): Promise<boolean> {
  try {
    return await invoke<boolean>('clear_semantic_guard_key');
  } catch (error) {
    console.error('Failed to clear semantic guard key:', error);
    throw Object.assign(new Error(`Failed to clear semantic guard key: ${String(error)}`), {
      cause: error,
    });
  }
}
