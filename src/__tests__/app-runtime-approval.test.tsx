import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '@/App';
import { emitTauriEvent, invoke, mockInvoke } from '@/test/__mocks__/tauri';

const APPROVAL_REQUEST = {
  id: 'approval-1',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
  status: 'pending',
  component_id: 'mcp:codex:filesystem:/tmp/config.json',
  component_name: 'filesystem',
  platform_id: 'codex',
  platform_name: 'Codex CLI',
  request_kind: 'external_connection',
  trigger_event: 'network_violation',
  title: '已拦下连接 bad.example.com 的请求',
  summary: 'filesystem 想连接 bad.example.com。在你点头前，这个地址不会被加入允许名单。',
  approval_label: '允许以后连接 bad.example.com',
  deny_label: '继续拦住',
  action_kind: 'network_access',
  action_source: 'runtime_network_policy',
  action_targets: ['bad.example.com'],
  action_preview: [
    '目标地址: bad.example.com',
    '当前网络模式: allowlist',
    '已允许地址: api.example.com',
  ],
  is_destructive: false,
  is_batch: false,
  requested_host: 'bad.example.com',
  sensitive_capabilities: ['读写本地文件'],
  consequence_lines: [
    '它现在想连接 bad.example.com，这可能把聊天内容、文件内容或密钥发到外网。',
    '它可能读取、修改或删除你电脑上的文件。',
    '如果你现在不点允许，这次操作会继续被拦住，不会自动放行。',
  ],
  launch_after_approval: false,
  session_id: 'session-1',
};

describe('App runtime approvals', () => {
  const setupBaseMocks = () => {
    mockInvoke('check_license_status', {
      plan: 'free',
      status: 'active',
      expires_at: null,
      trial_days_left: null,
    });
    mockInvoke('get_notifications', []);
    mockInvoke('configure_protection', {
      enabled: true,
      watcher_ready: true,
      auto_quarantine: false,
      watched_paths: [],
      incident_count: 0,
      last_event_at: null,
      quarantine_dir: '',
      last_incident: null,
    });
    mockInvoke('detect_ai_tools', []);
    mockInvoke('get_protection_status', {
      enabled: true,
      watcher_ready: true,
      auto_quarantine: false,
      watched_paths: [],
      incident_count: 0,
      last_event_at: null,
      quarantine_dir: '',
      last_incident: null,
    });
    mockInvoke('check_installed_updates', []);
    mockInvoke('scan_full', null);
    mockInvoke('list_runtime_guard_approval_requests', []);
  };

  it('shows a real-time approval card and resolves it through the backend command', async () => {
    const user = userEvent.setup();
    localStorage.setItem('agentshield-onboarding-completed', 'true');

    setupBaseMocks();
    mockInvoke('resolve_runtime_guard_approval_request', {
      ...APPROVAL_REQUEST,
      status: 'approved',
      updated_at: '2026-03-10T00:01:00Z',
    });

    render(<App />);

    await screen.findByRole('button', { name: '扫描' });
    await act(async () => {
      emitTauriEvent('runtime-guard-approval', APPROVAL_REQUEST);
    });

    expect(await screen.findByText('已拦下连接 bad.example.com 的请求')).toBeInTheDocument();
    expect(screen.getByText(/filesystem 想连接 bad\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText('放行新的联网地址')).toBeInTheDocument();
    expect(screen.getByText('运行时守卫拦下了新的联网地址')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看详情' }));
    expect(screen.getByText('目标地址: bad.example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '允许以后连接 bad.example.com' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('resolve_runtime_guard_approval_request', {
        requestId: 'approval-1',
        request_id: 'approval-1',
        decision: 'approve',
      });
    });
  });

  it('shows inline feedback when approval submission fails', async () => {
    const user = userEvent.setup();
    localStorage.setItem('agentshield-onboarding-completed', 'true');

    setupBaseMocks();
    mockInvoke('resolve_runtime_guard_approval_request', () => {
      throw new Error('component not found');
    });

    render(<App />);

    await screen.findByRole('button', { name: '扫描' });
    await act(async () => {
      emitTauriEvent('runtime-guard-approval', APPROVAL_REQUEST);
    });

    await user.click(screen.getByRole('button', { name: '允许以后连接 bad.example.com' }));

    expect(
      await screen.findByText('审批提交失败，请重试一次。若持续失败，请查看控制台日志。')
    ).toBeInTheDocument();
  });
});
