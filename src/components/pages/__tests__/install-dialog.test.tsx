import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallDialog } from '../install-dialog';
import { mockInvoke, invoke } from '@/test/__mocks__/tauri';
import { t } from '@/constants/i18n';
import type { StoreCatalogItem } from '@/types/domain';
import { useLicenseStore } from '@/stores/licenseStore';

const item: StoreCatalogItem = {
  id: 'playwright',
  name: 'Playwright',
  description: 'Browser automation',
  safety_level: 'caution',
  compatible_platforms: ['cursor', 'codex'],
  rating: 4.6,
  install_count: 21000,
  installable: true,
};

describe('InstallDialog', () => {
  beforeEach(() => {
    useLicenseStore.getState().startTrial(14);
  });

  it('toggles target platforms and installs using the selected real payload', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    mockInvoke('detect_ai_tools', [
      {
        id: 'cursor',
        name: 'Cursor',
        icon: '⚡',
        detected: true,
        host_detected: true,
        install_target_ready: true,
        detection_sources: ['app'],
        path: '/Applications/Cursor.app',
        version: '1.0.0',
        has_mcp_config: true,
        mcp_config_path: '/tmp/cursor.json',
        mcp_config_paths: ['/tmp/cursor.json'],
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        icon: '🧠',
        detected: true,
        host_detected: true,
        install_target_ready: true,
        detection_sources: ['cli'],
        path: '/usr/local/bin/codex',
        version: '0.1.0',
        has_mcp_config: true,
        mcp_config_path: '/tmp/codex.toml',
        mcp_config_paths: ['/tmp/codex.toml'],
      },
    ]);
    mockInvoke('install_store_item', ({ platforms }: { platforms?: string[] } = {}) => ({
      success: true,
      message: '安装完成',
      installed_platforms: platforms ?? [],
      errors: [],
    }));
    mockInvoke('resolve_install_target_paths', ({ platforms }: { platforms?: string[] } = {}) =>
      (platforms ?? []).map((platform) => ({
        platform,
        config_path: `/tmp/${platform}.config`,
        exists: true,
      })),
    );
    mockInvoke('request_runtime_guard_action_approval', {
      status: 'approved',
      request: {
        id: 'approval-1',
        created_at: '2026-03-11T00:00:00Z',
        updated_at: '2026-03-11T00:00:00Z',
        status: 'approved',
        component_id: 'agentshield:store:playwright',
        component_name: 'Playwright',
        platform_id: 'cursor',
        platform_name: 'Cursor',
        request_kind: 'component_install',
        trigger_event: 'store_item_install_request',
        title: '这次安装操作需要你点头',
        summary: '安装预览',
        approval_label: '允许这一次',
        deny_label: '继续拦住',
        action_kind: 'component_install',
        action_source: 'user_requested_install',
        action_targets: ['/tmp/cursor.config'],
        action_preview: [],
        is_destructive: false,
        is_batch: false,
        approval_scope_key: 'scope-1',
        requested_host: null,
        sensitive_capabilities: [],
        consequence_lines: [],
        launch_after_approval: false,
        session_id: null,
      },
      approval_ticket: 'ticket-1',
    });

    render(
      <InstallDialog
        item={item}
        open
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );

    await screen.findByText('Codex CLI');

    await user.click(screen.getByRole('button', { name: /Codex CLI/i }));
    await user.click(screen.getByRole('button', { name: t.install }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('install_store_item', {
        itemId: 'playwright',
        platforms: ['cursor'],
        approvalTicket: 'ticket-1',
      });
    });

    expect(onConfirm).toHaveBeenCalledWith(['cursor']);
    expect(await screen.findByText('安装完成')).toBeInTheDocument();
  });

  it('hides stale config remnants that are not real install targets', async () => {
    mockInvoke('detect_ai_tools', [
      {
        id: 'cursor',
        name: 'Cursor',
        icon: '⚡',
        detected: true,
        host_detected: false,
        install_target_ready: false,
        detection_sources: ['config_dir'],
        path: '/Users/demo/.cursor',
        version: null,
        has_mcp_config: false,
        mcp_config_path: null,
        mcp_config_paths: [],
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        icon: '🧠',
        detected: true,
        host_detected: true,
        install_target_ready: true,
        detection_sources: ['cli'],
        path: '/usr/local/bin/codex',
        version: '0.1.0',
        has_mcp_config: true,
        mcp_config_path: '/tmp/codex.toml',
        mcp_config_paths: ['/tmp/codex.toml'],
      },
    ]);
    mockInvoke('resolve_install_target_paths', [{ platform: 'codex', config_path: '/tmp/codex.toml', exists: true }]);

    render(
      <InstallDialog
        item={item}
        open
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(await screen.findByText('Codex CLI')).toBeInTheDocument();
    expect(screen.queryByText('Cursor')).not.toBeInTheDocument();
  });
});
