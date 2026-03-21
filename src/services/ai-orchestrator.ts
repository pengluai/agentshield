import { tauriInvoke as invoke } from '@/services/tauri';

export interface StepResult {
  success: boolean;
  step_id: string;
  message: string;
  output: string | null;
  error: string | null;
  needs_ai_help: boolean;
}

export interface AiDiagnosis {
  diagnosis: string;
  suggested_fix: string;
  auto_fixable: boolean;
  fix_command: string | null;
}

export interface AiConnectionResult {
  success: boolean;
  model_name: string;
  message: string;
}

export interface ProAiQuotaStatus {
  daily_used: number;
  daily_limit: number;
  monthly_used: number;
  monthly_limit: number;
}

export async function testAiConnection(
  provider: string,
  apiKey: string,
  model?: string,
  baseUrl?: string,
): Promise<AiConnectionResult> {
  try {
    return await invoke<AiConnectionResult>('test_ai_connection', {
      provider,
      apiKey,
      model: model || undefined,
      baseUrl: baseUrl || undefined,
    });
  } catch (error) {
    console.error('Failed to test AI connection:', error);
    throw Object.assign(new Error(`Failed to test AI connection: ${String(error)}`), { cause: error });
  }
}

export async function executeInstallStep(
  stepId: string,
  options?: {
    channelId?: string;
    token?: string;
    platformIds?: string[];
    approvalTicket?: string;
  },
): Promise<StepResult> {
  try {
    return await invoke<StepResult>('execute_install_step', {
      stepId,
      channelId: options?.channelId,
      token: options?.token,
      platformIds: options?.platformIds,
      approvalTicket: options?.approvalTicket,
    });
  } catch (error) {
    console.error('Failed to execute install step:', error);
    throw Object.assign(new Error(`Failed to execute install step: ${String(error)}`), { cause: error });
  }
}

export async function aiDiagnoseError(
  provider: string,
  apiKey: string,
  errorContext: string,
  stepName: string,
  model?: string,
  baseUrl?: string,
): Promise<AiDiagnosis> {
  try {
    return await invoke<AiDiagnosis>('ai_diagnose_error', {
      provider,
      apiKey,
      model: model || undefined,
      baseUrl: baseUrl || undefined,
      errorContext,
      stepName,
    });
  } catch (error) {
    console.error('Failed to diagnose AI setup error:', error);
    throw Object.assign(new Error(`Failed to diagnose AI setup error: ${String(error)}`), { cause: error });
  }
}

export async function getProAiQuotaStatus(): Promise<ProAiQuotaStatus> {
  try {
    return await invoke<ProAiQuotaStatus>('pro_ai_quota_status');
  } catch (error) {
    console.error('Failed to fetch Pro AI quota status:', error);
    throw Object.assign(new Error(`Failed to fetch Pro AI quota status: ${String(error)}`), {
      cause: error,
    });
  }
}
