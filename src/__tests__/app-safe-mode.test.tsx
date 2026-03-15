import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '@/App';
import { invoke, mockInvoke } from '@/test/__mocks__/tauri';
import { useSettingsStore } from '@/stores/settingsStore';
import { clearStartupTimelineEvents, listStartupTimelineEvents } from '@/services/startup-timeline';

describe('App safe mode', () => {
  beforeEach(() => {
    localStorage.setItem('agentshield-onboarding-completed', 'true');
    useSettingsStore.getState().resetAll();
    useSettingsStore.getState().setSafeMode(true);
    clearStartupTimelineEvents();
  });

  it('shows a global safe mode warning and records skipped startup tasks', async () => {
    mockInvoke('check_license_status', {
      plan: 'free',
      status: 'active',
      expires_at: null,
      trial_days_left: null,
    });
    mockInvoke('get_notifications', []);
    mockInvoke('configure_protection', {
      enabled: false,
      watcher_ready: false,
      auto_quarantine: false,
      watched_paths: [],
      incident_count: 0,
      last_event_at: null,
      quarantine_dir: '',
      last_incident: null,
    });
    mockInvoke('detect_ai_tools', []);
    mockInvoke('get_protection_status', {
      enabled: false,
      watcher_ready: false,
      auto_quarantine: false,
      watched_paths: [],
      incident_count: 0,
      last_event_at: null,
      quarantine_dir: '',
      last_incident: null,
    });
    mockInvoke('scan_full', null);
    mockInvoke('check_installed_updates', []);
    mockInvoke('list_runtime_guard_approval_requests', []);

    render(<App />);

    await screen.findByRole('button', { name: '扫描' });
    expect(
      screen.getByText('安全模式已启用。实时主动防护、后台扫描与自动更新检查已暂停。排查完成后请尽快关闭。')
    ).toBeInTheDocument();

    await waitFor(() => {
      const events = listStartupTimelineEvents();
      expect(events.some((event) => event.step === 'app_boot' && event.summary.includes('安全模式'))).toBe(true);
      expect(events.some((event) => event.step === 'background_scan' && event.status === 'skipped')).toBe(true);
      expect(events.some((event) => event.step === 'update_audit' && event.status === 'skipped')).toBe(true);
      expect(events.some((event) => event.step === 'realtime_protection' && event.status === 'completed')).toBe(true);
    });

    expect(invoke).not.toHaveBeenCalledWith('check_installed_updates');
    expect(invoke).not.toHaveBeenCalledWith('scan_full');
    expect(invoke).toHaveBeenCalledWith('configure_protection', {
      enabled: false,
      autoQuarantine: false,
    });
  });

  it('records a failed startup event when safe mode cannot pause realtime protection', async () => {
    mockInvoke('check_license_status', {
      plan: 'free',
      status: 'active',
      expires_at: null,
      trial_days_left: null,
    });
    mockInvoke('get_notifications', []);
    mockInvoke('configure_protection', async () => {
      throw new Error('pause failed');
    });
    mockInvoke('detect_ai_tools', []);
    mockInvoke('get_protection_status', {
      enabled: false,
      watcher_ready: false,
      auto_quarantine: false,
      watched_paths: [],
      incident_count: 0,
      last_event_at: null,
      quarantine_dir: '',
      last_incident: null,
    });
    mockInvoke('scan_full', null);
    mockInvoke('check_installed_updates', []);
    mockInvoke('list_runtime_guard_approval_requests', []);

    render(<App />);

    await screen.findByRole('button', { name: '扫描' });

    await waitFor(() => {
      const events = listStartupTimelineEvents();
      expect(
        events.some(
          (event) =>
            event.step === 'realtime_protection' &&
            event.status === 'failed' &&
            event.summary.includes('pause failed')
        )
      ).toBe(true);
    });
  });

  it('does not pollute the startup timeline after launch when settings change later', async () => {
    useSettingsStore.getState().setSafeMode(false);

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
    mockInvoke('scan_full', null);
    mockInvoke('check_installed_updates', []);
    mockInvoke('list_runtime_guard_approval_requests', []);

    render(<App />);

    await screen.findByRole('button', { name: '扫描' });

    await waitFor(() => {
      expect(listStartupTimelineEvents().filter((event) => event.step === 'update_audit')).toHaveLength(1);
    });

    await act(async () => {
      useSettingsStore.getState().setCheckUpdatesAuto(false);
    });

    expect(listStartupTimelineEvents().filter((event) => event.step === 'update_audit')).toHaveLength(1);
  });
});
