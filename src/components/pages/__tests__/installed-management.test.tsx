import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { InstalledManagement } from '../installed-management';
import { invoke, mockInvoke, open } from '@/test/__mocks__/tauri';
import { useLicenseStore } from '@/stores/licenseStore';

describe('InstalledManagement', () => {
  beforeEach(() => {
    useLicenseStore.getState().startTrial(14);
  });

  it('reveals local source paths in Finder instead of trying to open them as external URLs', async () => {
    const user = userEvent.setup();

    mockInvoke('scan_installed_mcps', [
      {
        name: 'playwright',
        command: 'npx',
        args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        platform_id: 'cursor',
        config_path: '/tmp/playwright.json',
        safety_level: 'caution',
      },
    ]);
    mockInvoke('list_installed_items', [
      {
        id: 'playwright',
        name: 'playwright',
        version: '1.0.0',
        platform: 'cursor',
        installed_at: '2026-03-09T00:00:00Z',
        source_url: '/tmp/playwright.json',
      },
    ]);
    mockInvoke('sync_runtime_guard_components', [
      {
        component_id: 'mcp:cursor:playwright:/tmp/playwright.json',
        component_type: 'mcp',
        name: 'playwright',
        platform_id: 'cursor',
        platform_name: 'Cursor',
        source_kind: 'managed_reviewed',
        install_channel: 'builtin_npm',
        config_path: '/tmp/playwright.json',
        exec_command: 'npx',
        exec_args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        file_hash: 'hash',
        signing_state: 'unsigned',
        trust_state: 'trusted',
        network_mode: 'inherit',
        allowed_domains: [],
        allowed_env_keys: [],
        risk_summary: '等待首次运行审批',
        first_seen_at: '2026-03-09T00:00:00Z',
        last_seen_at: '2026-03-09T00:00:00Z',
        last_launched_at: null,
        last_parent_pid: null,
        last_supervisor_session_id: null,
      },
    ]);

    render(<InstalledManagement onBack={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /playwright/i }));
    await user.click(await screen.findByRole('button', { name: /\/tmp\/playwright\.json/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('reveal_path_in_finder', {
        path: '/tmp/playwright.json',
      });
    });

    expect(open).not.toHaveBeenCalled();
  });

  it('launches guarded skills through the real backend command when approved', async () => {
    const user = userEvent.setup();

    mockInvoke('scan_installed_mcps', [
      {
        name: 'storyboard-manager (skill)',
        command: 'skill',
        args: [],
        platform_id: 'openclaw',
        config_path: '/tmp/storyboard-manager',
        safety_level: 'unverified',
      },
    ]);
    mockInvoke('list_installed_items', []);
    mockInvoke('sync_runtime_guard_components', [
      {
        component_id: 'skill:openclaw:storyboard-manager (skill):/tmp/storyboard-manager',
        component_type: 'skill',
        name: 'storyboard-manager (skill)',
        platform_id: 'openclaw',
        platform_name: 'OpenClaw',
        source_kind: 'managed_reviewed',
        install_channel: 'managed',
        config_path: '/tmp/storyboard-manager',
        exec_command: 'skill',
        exec_args: [],
        file_hash: 'hash',
        signing_state: 'unsigned',
        trust_state: 'restricted',
        network_mode: 'allowlist',
        allowed_domains: ['api.example.com'],
        allowed_env_keys: [],
        risk_summary: '等待首次运行审批',
        first_seen_at: '2026-03-09T00:00:00Z',
        last_seen_at: '2026-03-09T00:00:00Z',
        last_launched_at: null,
        last_parent_pid: null,
        last_supervisor_session_id: null,
      },
    ]);
    mockInvoke('launch_runtime_guard_component', {
      session_id: 'session-1',
      component_id: 'skill:openclaw:storyboard-manager (skill):/tmp/storyboard-manager',
      component_name: 'storyboard-manager (skill)',
      platform_id: 'openclaw',
      pid: 1234,
      parent_pid: 1,
      child_pids: [],
      observed: false,
      supervised: true,
      status: 'running',
      commandline: 'node index.js',
      exe_path: 'node',
      cwd: '/tmp/storyboard-manager',
      started_at: '2026-03-09T00:00:00Z',
      last_seen_at: '2026-03-09T00:00:00Z',
      ended_at: null,
      network_connections: [],
      last_violation: null,
    });

    render(<InstalledManagement onBack={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /storyboard-manager \(skill\)/i }));
    await user.click(await screen.findByRole('button', { name: '受控启动' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('launch_runtime_guard_component', {
        componentId: 'skill:openclaw:storyboard-manager (skill):/tmp/storyboard-manager',
      });
    });
  });

  it('requests approval before applying a managed component update and forwards the approval ticket', async () => {
    const user = userEvent.setup();

    mockInvoke('scan_installed_mcps', [
      {
        name: 'playwright',
        command: 'npx',
        args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        platform_id: 'cursor',
        config_path: '/tmp/playwright.json',
        safety_level: 'caution',
      },
    ]);
    mockInvoke('list_installed_items', [
      {
        id: 'playwright',
        name: 'playwright',
        version: '1.0.0',
        platform: 'cursor',
        installed_at: '2026-03-09T00:00:00Z',
        source_url: '/tmp/playwright.json',
      },
    ]);
    mockInvoke('sync_runtime_guard_components', [
      {
        component_id: 'mcp:cursor:playwright:/tmp/playwright.json',
        component_type: 'mcp',
        name: 'playwright',
        platform_id: 'cursor',
        platform_name: 'Cursor',
        source_kind: 'managed_reviewed',
        install_channel: 'builtin_npm',
        config_path: '/tmp/playwright.json',
        exec_command: 'npx',
        exec_args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        file_hash: 'hash',
        signing_state: 'unsigned',
        trust_state: 'trusted',
        network_mode: 'inherit',
        allowed_domains: [],
        allowed_env_keys: [],
        risk_summary: '等待首次运行审批',
        first_seen_at: '2026-03-09T00:00:00Z',
        last_seen_at: '2026-03-09T00:00:00Z',
        last_launched_at: null,
        last_parent_pid: null,
        last_supervisor_session_id: null,
      },
    ]);
    mockInvoke('check_installed_updates', [
      {
        item_id: 'playwright',
        platform: 'cursor',
        source_path: '/tmp/playwright.json',
        current_version: '1.0.0',
        new_version: '1.1.0',
        has_update: true,
        tracked: true,
        reason: '',
      },
    ]);
    mockInvoke('request_runtime_guard_action_approval', {
      status: 'approved',
      request: {
        id: 'approval-1',
        created_at: '2026-03-11T00:00:00Z',
        updated_at: '2026-03-11T00:00:00Z',
        status: 'approved',
        component_id: 'agentshield:update:cursor:playwright',
        component_name: 'playwright',
        platform_id: 'cursor',
        platform_name: 'Cursor',
        request_kind: 'component_update',
        trigger_event: 'installed_item_update_request',
        title: '升级审批',
        summary: '升级前需要你的确认',
        approval_label: '允许这一次',
        deny_label: '继续拦住',
        action_kind: 'component_update',
        action_source: 'user_requested_update',
        action_targets: ['/tmp/playwright.json'],
        action_preview: [],
        is_destructive: false,
        is_batch: false,
        approval_scope_key: 'scope-1',
        requested_host: null,
        sensitive_capabilities: ['修改 MCP / Skill 配置'],
        consequence_lines: [],
        launch_after_approval: false,
        session_id: null,
      },
      approval_ticket: 'ticket-1',
    });
    mockInvoke('update_installed_item', true);

    render(<InstalledManagement onBack={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /playwright/i }));
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByRole('button', { name: '升级到 1.1.0' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '升级到 1.1.0' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('request_runtime_guard_action_approval', expect.objectContaining({
        input: expect.objectContaining({
          component_id: 'agentshield:update:cursor:playwright',
          action_kind: 'component_update',
          action_targets: ['/tmp/playwright.json'],
        }),
      }));
      expect(invoke).toHaveBeenCalledWith('update_installed_item', {
        itemId: 'playwright',
        platform: 'cursor',
        sourcePath: '/tmp/playwright.json',
        approvalTicket: 'ticket-1',
      });
    });
  });

  it('executes global cleanup through preview -> approval -> execute chain with one approval ticket', async () => {
    const user = userEvent.setup();

    mockInvoke('scan_installed_mcps', [
      {
        name: 'playwright',
        command: 'npx',
        args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        platform_id: 'cursor',
        config_path: '/tmp/playwright.json',
        safety_level: 'caution',
      },
    ]);
    mockInvoke('list_installed_items', [
      {
        id: 'playwright',
        name: 'playwright',
        version: '1.0.0',
        platform: 'cursor',
        installed_at: '2026-03-09T00:00:00Z',
        source_url: '/tmp/playwright.json',
      },
    ]);
    mockInvoke('sync_runtime_guard_components', []);
    mockInvoke('list_runtime_guard_sessions', []);
    mockInvoke('get_runtime_guard_status', null);
    mockInvoke('list_runtime_guard_events', []);
    mockInvoke('get_runtime_guard_policy', null);
    mockInvoke('detect_ai_tools', [
      {
        id: 'cursor',
        name: 'Cursor',
        detected: true,
        host_detected: true,
        install_target_ready: true,
        host_confidence: 'high',
        management_capability: 'one_click',
        source_tier: 'a',
        risk_surface: {
          has_mcp: true,
          has_skill: false,
          has_exec_signal: false,
          has_secret_signal: false,
          evidence_count: 1,
        },
        evidence_items: [
          {
            evidence_type: 'mcp_config',
            path: '/tmp/playwright.json',
          },
        ],
      },
    ]);
    mockInvoke('preview_global_cleanup', {
      plan_id: 'cleanup-plan-1',
      generated_at: '2026-03-14T00:00:00Z',
      scope_platforms: [],
      include_dependency_cleanup: true,
      include_openclaw_deep_cleanup: false,
      action_targets: ['/tmp/playwright.json', 'dependency:npm_global:@modelcontextprotocol/server-playwright'],
      component_count: 1,
      auto_cleanup_component_count: 1,
      manual_only_component_count: 0,
      dependency_task_count: 1,
      components: [],
      dependency_tasks: [],
    });
    mockInvoke('request_runtime_guard_action_approval', {
      status: 'approved',
      request: {
        id: 'approval-global-1',
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z',
        status: 'approved',
        component_id: 'agentshield:installed:global_cleanup',
        component_name: '全局卸载与依赖清理',
        platform_id: 'agentshield',
        platform_name: 'AgentShield',
        request_kind: 'bulk_file_modify',
        trigger_event: 'global_cleanup_execute_request',
        title: '全局清理审批',
        summary: '执行前需要你的确认',
        approval_label: '允许这一次',
        deny_label: '继续拦住',
        action_kind: 'bulk_file_modify',
        action_source: 'user_requested_global_cleanup',
        action_targets: ['/tmp/playwright.json'],
        action_preview: [],
        is_destructive: true,
        is_batch: true,
        approval_scope_key: 'scope-global',
        requested_host: null,
        sensitive_capabilities: ['读写本地文件'],
        consequence_lines: [],
        launch_after_approval: false,
        session_id: null,
      },
      approval_ticket: 'ticket-global-1',
    });
    mockInvoke('execute_global_cleanup', {
      run_id: 'cleanup-run-1',
      plan_id: 'cleanup-plan-1',
      started_at: '2026-03-14T00:00:00Z',
      completed_at: '2026-03-14T00:00:05Z',
      backup_dir: '/tmp/backups/cleanup-run-1',
      backup_count: 1,
      total_actions: 2,
      success_actions: 2,
      failed_actions: 0,
      skipped_actions: 0,
      remaining_components: [],
      results: [],
    });

    render(<InstalledManagement onBack={() => {}} />);

    await user.click(await screen.findByRole('button', { name: '一键全局卸载与清理' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('preview_global_cleanup', {
        scopePlatforms: [],
        includeDependencyCleanup: true,
      });
      expect(invoke).toHaveBeenCalledWith('request_runtime_guard_action_approval', expect.objectContaining({
        input: expect.objectContaining({
          component_id: 'agentshield:installed:global_cleanup',
          action_kind: 'bulk_file_modify',
        }),
      }));
      expect(invoke).toHaveBeenCalledWith('execute_global_cleanup', {
        planId: 'cleanup-plan-1',
        approvalTicket: 'ticket-global-1',
      });
    });
  });

  it('shows recent runtime guard events and clears them through the backend command', async () => {
    const user = userEvent.setup();

    mockInvoke('scan_installed_mcps', [
      {
        name: 'playwright',
        command: 'npx',
        args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        platform_id: 'cursor',
        config_path: '/tmp/playwright.json',
        safety_level: 'caution',
      },
    ]);
    mockInvoke('list_installed_items', []);
    mockInvoke('sync_runtime_guard_components', [
      {
        component_id: 'mcp:cursor:playwright:/tmp/playwright.json',
        component_type: 'mcp',
        name: 'playwright',
        platform_id: 'cursor',
        platform_name: 'Cursor',
        source_kind: 'manual_config',
        install_channel: 'manual',
        config_path: '/tmp/playwright.json',
        exec_command: 'npx',
        exec_args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        file_hash: 'hash',
        signing_state: 'unsigned',
        trust_state: 'restricted',
        network_mode: 'allowlist',
        allowed_domains: ['api.example.com'],
        allowed_env_keys: [],
        risk_summary: '等待首次运行审批',
        first_seen_at: '2026-03-09T00:00:00Z',
        last_seen_at: '2026-03-09T00:00:00Z',
        last_launched_at: null,
        last_parent_pid: null,
        last_supervisor_session_id: null,
      },
    ]);
    mockInvoke('list_runtime_guard_events', [
      {
        id: 'event-1',
        timestamp: '2026-03-09T00:00:00Z',
        event_type: 'network_violation',
        component_id: 'mcp:cursor:playwright:/tmp/playwright.json',
        severity: 'critical',
        title: '已拦截未知外联并隔离组件',
        description: 'playwright 访问了未授权的远端 bad.example.com',
        action: 'kill',
      },
    ]);
    mockInvoke('clear_runtime_guard_events', true);

    render(<InstalledManagement onBack={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /playwright/i }));
    expect(await screen.findByText('已拦截未知外联并隔离组件')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '清空事件' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('clear_runtime_guard_events');
    });
  });

  it('defaults to host overview and coerces unknown hosts to manual capability', async () => {
    mockInvoke('scan_installed_mcps', []);
    mockInvoke('list_installed_items', []);
    mockInvoke('sync_runtime_guard_components', []);
    mockInvoke('list_runtime_guard_sessions', []);
    mockInvoke('get_runtime_guard_status', null);
    mockInvoke('list_runtime_guard_events', []);
    mockInvoke('get_runtime_guard_policy', null);
    mockInvoke('detect_ai_tools', [
      {
        id: 'unknown_ai_tool_openagent',
        name: 'OpenAgent',
        path: '/Users/demo/.openagent/mcp.json',
        detected: true,
        host_detected: true,
        install_target_ready: false,
        host_confidence: 'medium',
        management_capability: 'one_click',
        source_tier: 'c',
        risk_surface: {
          has_mcp: true,
          has_skill: true,
          has_exec_signal: true,
          has_secret_signal: false,
          evidence_count: 2,
        },
        evidence_items: [
          {
            evidence_type: 'mcp_config',
            path: '/Users/demo/.openagent/mcp.json',
          },
          {
            evidence_type: 'skill_root',
            path: '/Users/demo/.openagent/skills/demo',
          },
        ],
      },
    ]);

    render(<InstalledManagement onBack={() => {}} />);

    expect(await screen.findByRole('heading', { name: '未知工具 · Openagent' })).toBeInTheDocument();
    expect(await screen.findAllByText('需要手动处理')).not.toHaveLength(0);
    expect(screen.queryByText('可一键处理')).not.toBeInTheDocument();
    expect(await screen.findAllByText('插件配置文件')).not.toHaveLength(0);
  });

  it('supports host to component drill-down from overview', async () => {
    const user = userEvent.setup();

    mockInvoke('scan_installed_mcps', [
      {
        name: 'playwright',
        command: 'npx',
        args: ['@modelcontextprotocol/server-playwright@1.0.0'],
        platform_id: 'cursor',
        config_path: '/tmp/playwright.json',
        safety_level: 'caution',
      },
    ]);
    mockInvoke('list_installed_items', []);
    mockInvoke('sync_runtime_guard_components', []);
    mockInvoke('list_runtime_guard_sessions', []);
    mockInvoke('get_runtime_guard_status', null);
    mockInvoke('list_runtime_guard_events', []);
    mockInvoke('get_runtime_guard_policy', null);
    mockInvoke('detect_ai_tools', [
      {
        id: 'cursor',
        name: 'Cursor',
        detected: true,
        host_detected: true,
        install_target_ready: true,
        host_confidence: 'high',
        management_capability: 'one_click',
        source_tier: 'a',
        risk_surface: {
          has_mcp: true,
          has_skill: false,
          has_exec_signal: false,
          has_secret_signal: false,
          evidence_count: 1,
        },
        evidence_items: [
          {
            evidence_type: 'mcp_config',
            path: '/tmp/playwright.json',
          },
        ],
      },
    ]);

    render(<InstalledManagement onBack={() => {}} />);

    expect(await screen.findByText('选择组件')).toBeInTheDocument();
    expect(await screen.findAllByText('playwright')).not.toHaveLength(0);
  });
});
