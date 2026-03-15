import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SmartGuardHome } from '../smart-guard-home';
import { mockInvoke } from '@/test/__mocks__/tauri';
import { useAppStore } from '@/stores/appStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { t } from '@/constants/i18n';

const DEFAULT_PROTECTION_STATUS = {
  enabled: true,
  watcher_ready: true,
  auto_quarantine: true,
  watched_paths: [],
  incident_count: 0,
  last_event_at: null,
  quarantine_dir: '',
  last_incident: null,
};

describe('SmartGuardHome', () => {
  it('fixes once and stays on the completed home state', async () => {
    const user = userEvent.setup();
    useLicenseStore.getState().startTrial(30);

    useAppStore.setState({
      currentModule: 'smartGuard',
      scanStatus: 'completed',
      scanProgress: 100,
      scanScore: 72,
      isExpanded: false,
      currentScanningFile: '',
      lastScanByCategory: {
        'env-config': [
          {
            id: 'issue-1',
            severity: 'warning',
            title: '配置文件权限过宽',
            description: '',
            platform: 'cursor',
            fixable: true,
            filePath: '/tmp/demo/.cursor/mcp.json',
          },
          {
            id: 'issue-2',
            severity: 'warning',
            title: '配置文件权限过宽',
            description: '',
            platform: 'codex',
            fixable: true,
            filePath: '/tmp/demo/.codex/config.toml',
          },
        ],
      },
      scanCards: useAppStore.getState().scanCards.map((card) => ({
        ...card,
        status: 'completed',
        result: card.id === 'env-config'
          ? { issueCount: 2, canFix: true, message: '2 warning' }
          : { issueCount: 0, canFix: false, message: t.allPassed },
      })),
    });

    let fixAllCalls = 0;
    let resolveFixAll!: (value: number) => void;

    mockInvoke('detect_ai_tools', []);
    mockInvoke('get_protection_status', DEFAULT_PROTECTION_STATUS);
    mockInvoke('request_runtime_guard_action_approval', {
      status: 'approved',
      request: {
        id: 'approval-1',
        created_at: '2026-03-11T00:00:00Z',
        updated_at: '2026-03-11T00:00:00Z',
        status: 'approved',
        component_id: 'agentshield:scan:auto-fix',
        component_name: `${t.moduleSecurityScan}一键修复`,
        platform_id: 'agentshield',
        platform_name: 'AgentShield',
        request_kind: 'bulk_file_modify',
        trigger_event: 'user_requested_fix_all',
        title: '批量修复审批',
        summary: '批准后会收紧配置文件权限。',
        approval_label: '允许这一次',
        deny_label: '继续拦住',
        action_kind: 'bulk_file_modify',
        action_source: 'user_requested_fix_all',
        action_targets: ['/tmp/demo/.codex/config.toml', '/tmp/demo/.cursor/mcp.json'],
        action_preview: ['/tmp/demo/.codex/config.toml', '/tmp/demo/.cursor/mcp.json'],
        is_destructive: true,
        is_batch: true,
        approval_scope_key: 'scope-1',
        requested_host: null,
        sensitive_capabilities: ['读写本地文件'],
        consequence_lines: [],
        launch_after_approval: false,
        session_id: null,
      },
      approval_ticket: 'ticket-1',
    });
    mockInvoke('fix_all', () => {
      fixAllCalls += 1;
      return new Promise<number>((resolve) => {
        resolveFixAll = resolve;
      });
    });
    mockInvoke('scan_full', {
      detected_tools: [],
      categories: [
        {
          id: 'env_config',
          name: '环境配置',
          issue_count: 0,
          issues: [],
          passed_count: 2,
        },
      ],
      exposed_keys: [],
      score: 96,
      total_issues: 0,
      semantic_guard: {
        licensed: false,
        configured: false,
        active: false,
        reviewed_issues: 0,
        cache_hits: 0,
        message: '',
      },
    });

    render(<SmartGuardHome />);

    const button = await screen.findByRole('button', { name: /一键无损修复全部/i });

    await user.click(button);
    await user.click(button);

    expect(fixAllCalls).toBe(1);

    resolveFixAll(2);

    await waitFor(() => {
      expect(screen.getByText('已修复 2 个自动修复项，复扫验证已完成')).toBeInTheDocument();
    });

    expect(useAppStore.getState().scanStatus).toBe('completed');
    expect(screen.getByRole('button', { name: t.startScan })).toBeInTheDocument();
  });
});
