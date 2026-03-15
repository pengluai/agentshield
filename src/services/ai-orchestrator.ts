import { invoke } from '@tauri-apps/api/core';

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

export async function testAiConnection(
  provider: string,
  apiKey: string,
  model?: string,
  baseUrl?: string,
): Promise<AiConnectionResult> {
  return invoke<AiConnectionResult>('test_ai_connection', {
    provider,
    apiKey,
    model: model || undefined,
    baseUrl: baseUrl || undefined,
  });
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
  return invoke<StepResult>('execute_install_step', {
    stepId,
    channelId: options?.channelId,
    token: options?.token,
    platformIds: options?.platformIds,
    approvalTicket: options?.approvalTicket,
  });
}

export async function aiDiagnoseError(
  provider: string,
  apiKey: string,
  errorContext: string,
  stepName: string,
  model?: string,
  baseUrl?: string,
): Promise<AiDiagnosis> {
  return invoke<AiDiagnosis>('ai_diagnose_error', {
    provider,
    apiKey,
    model: model || undefined,
    baseUrl: baseUrl || undefined,
    errorContext,
    stepName,
  });
}
