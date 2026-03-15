import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsPage } from '../settings-page';
import { invoke, mockInvoke } from '@/test/__mocks__/tauri';
import { t } from '@/constants/i18n';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { beginStartupTimelineSession, clearStartupTimelineEvents, recordStartupTimelineEvent } from '@/services/startup-timeline';

const DEFAULT_PROTECTION_STATUS = {
  enabled: true,
  watcher_ready: true,
  auto_quarantine: false,
  watched_paths: ['/Users/demo/.codex'],
  incident_count: 0,
  last_event_at: null,
  quarantine_dir: '/Users/demo/.agentshield/quarantine',
  last_incident: null,
} as const;

function mockSettingsPageBoot(
  incidents: Array<{
    id: string;
    timestamp: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    file_path: string;
    action: string;
  }> = []
) {
  mockInvoke('get_protection_status', DEFAULT_PROTECTION_STATUS);
  mockInvoke('list_protection_incidents', incidents);
  mockInvoke('get_semantic_guard_status', {
    licensed: false,
    configured: false,
    active: false,
    message: '',
  });
  mockInvoke('configure_protection', ({ enabled, autoQuarantine }: Record<string, unknown> = {}) => ({
    ...DEFAULT_PROTECTION_STATUS,
    enabled: Boolean(enabled),
    watcher_ready: Boolean(enabled),
    auto_quarantine: Boolean(autoQuarantine),
  }));
  mockInvoke('clear_protection_incidents', true);
}

function getToggleFor(label: string) {
  const labelNode = screen.getByText(label);
  const row = labelNode.closest('div')?.parentElement;
  if (!row) {
    throw new Error(`Unable to find toggle row for ${label}`);
  }
  return within(row as HTMLElement).getByRole('switch');
}

describe('SettingsPage', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAll();
    useLicenseStore.getState().deactivate();
    clearStartupTimelineEvents();
    localStorage.removeItem('agentshield-rule-sync-last-free');
    localStorage.removeItem('agentshield-rule-sync-last-auto');
  });

  it('toggles realtime protection through the real backend command', async () => {
    const user = userEvent.setup();
    mockSettingsPageBoot();

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.settingsSecurity }));
    await user.click(getToggleFor(t.activeDefense));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('configure_protection', {
        enabled: false,
        autoQuarantine: false,
      });
    });
  });

  it('toggles auto quarantine through the real backend command', async () => {
    const user = userEvent.setup();
    mockSettingsPageBoot();

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.settingsSecurity }));
    await user.click(getToggleFor(t.autoQuarantine));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('configure_protection', {
        enabled: true,
        autoQuarantine: true,
      });
    });
  });

  it('clears protection incidents through the backend command', async () => {
    const user = userEvent.setup();
    mockSettingsPageBoot([
      {
        id: 'incident-1',
        timestamp: '2026-03-10T00:00:00Z',
        category: 'skill',
        severity: 'warning',
        title: '实时防护发现需审批 Skill',
        description: 'storyboard-manager 具备联网能力，需人工审批',
        file_path: '/tmp/storyboard-manager',
        action: 'reported',
      },
    ]);

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.settingsSecurity }));
    await user.click(await screen.findByRole('button', { name: t.protectionClearIncidents }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('clear_protection_incidents');
    });
  });

  it('toggles safe mode and reveals the startup timeline', async () => {
    const user = userEvent.setup();
    mockSettingsPageBoot();
    beginStartupTimelineSession({ safeMode: false });
    recordStartupTimelineEvent('approval_center', 'completed', '审批中心已就绪，当前没有待处理审批。');

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.settingsSecurity }));
    expect(await screen.findByText('最近启动发生了什么')).toBeInTheDocument();
    expect(screen.getByText('审批中心已就绪，当前没有待处理审批。')).toBeInTheDocument();

    await user.click(getToggleFor('安全模式启动'));

    await waitFor(() => {
      expect(useSettingsStore.getState().safeMode).toBe(true);
    });
  });

  it('shows that realtime protection only watches discovered AI tool paths', async () => {
    const user = userEvent.setup();
    mockSettingsPageBoot();

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.settingsSecurity }));

    expect(
      await screen.findByText('仅监听 1 条已发现的 AI 工具配置与 Skill 路径')
    ).toBeInTheDocument();
    expect(screen.getByText('/Users/demo/.codex')).toBeInTheDocument();
    expect(screen.queryByText('不会监听其它普通工具')).not.toBeInTheDocument();
  });

  it('tests AI connection in the AI configuration section for pro users', async () => {
    const user = userEvent.setup();
    useLicenseStore.getState().activatePro('2099-01-01T00:00:00Z');
    mockSettingsPageBoot();
    mockInvoke('test_ai_connection', {
      success: true,
      model_name: 'deepseek-chat',
      message: 'Successfully connected to deepseek (deepseek-chat)',
    });

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.settingsAI }));
    await user.type(screen.getByPlaceholderText(t.apiKeyHint), 'sk-test-key');
    await user.click(screen.getByRole('button', { name: t.testConnection }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('test_ai_connection', {
        provider: 'deepseek',
        apiKey: 'sk-test-key',
        model: 'deepseek-chat',
        baseUrl: undefined,
      });
    });
  });

  it('applies manual rule sync frequency limit for free users', async () => {
    const user = userEvent.setup();
    mockSettingsPageBoot();
    localStorage.setItem('agentshield-rule-sync-last-free', String(Date.now()));

    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: t.about }));
    await user.click(screen.getByRole('button', { name: /同步安全规则/ }));

    expect(screen.getByText(/免费版规则同步频率为每 7 天一次/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('download_and_apply_rules');
  });
});
