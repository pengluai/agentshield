import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EnvConfigDetail } from '../env-config-detail';
import { mockInvoke } from '@/test/__mocks__/tauri';

describe('EnvConfigDetail', () => {
  it('separates real installed hosts from config-only remnants', async () => {
    const user = userEvent.setup();

    mockInvoke('detect_system', {
      os: 'macOS',
      arch: 'aarch64',
      node_installed: true,
      node_version: '22.0.0',
      npm_installed: true,
      docker_installed: false,
      openclaw_installed: false,
      openclaw_version: null,
      git_installed: true,
      detected_ai_tools: [
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
          mcp_config_path: '/Users/demo/.codex/config.toml',
          mcp_config_paths: ['/Users/demo/.codex/config.toml'],
        },
        {
          id: 'continue_dev',
          name: 'Continue',
          icon: '▶️',
          detected: true,
          host_detected: false,
          install_target_ready: false,
          detection_sources: ['config_dir'],
          path: '/Users/demo/.continue',
          version: null,
          has_mcp_config: false,
          mcp_config_path: null,
          mcp_config_paths: [],
        },
        {
          id: 'cursor',
          name: 'Cursor',
          icon: '⚡',
          detected: false,
          host_detected: false,
          install_target_ready: false,
          detection_sources: [],
          path: null,
          version: null,
          has_mcp_config: false,
          mcp_config_path: null,
          mcp_config_paths: [],
        },
      ],
    });
    mockInvoke('scan_installed_mcps', [
      {
        id: 'codex:filesystem',
        name: 'filesystem',
        platform_id: 'codex',
        platform_name: 'Codex CLI',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        config_path: '/Users/demo/.codex/config.toml',
        safety_level: 'unverified',
      },
      {
        id: 'codex:skill:review-helper',
        name: 'review-helper (skill)',
        platform_id: 'codex',
        platform_name: 'Codex CLI',
        command: 'skill',
        args: [],
        config_path: '/Users/demo/.codex/skills/review-helper',
        safety_level: 'unverified',
      },
      {
        id: 'continue_dev:skill:legacy-skill',
        name: 'legacy-skill (skill)',
        platform_id: 'continue_dev',
        platform_name: 'Continue',
        command: 'skill',
        args: [],
        config_path: '/Users/demo/.continue/skills/legacy-skill',
        safety_level: 'unverified',
      },
    ]);

    render(<EnvConfigDetail onBack={() => {}} />);

    expect(await screen.findByText('可用工具 (1)')).toBeInTheDocument();
    expect(screen.getByText('仅检测到配置痕迹 (1)')).toBeInTheDocument();
    expect(await screen.findByText('已发现的插件服务 (1)')).toBeInTheDocument();
    expect(screen.getByText('已发现的脚本 (1)')).toBeInTheDocument();
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('review-helper')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Continue/i }));

    expect(await screen.findAllByText('仅检测到配置痕迹')).not.toHaveLength(0);
    expect(
      screen.getByText('已找到配置目录或配置文件，但没有找到对应程序，可用于排查，不会当作“已安装工具”。')
    ).toBeInTheDocument();
    expect(screen.getByText('已发现的脚本 (1)')).toBeInTheDocument();
    expect(screen.getByText('legacy-skill')).toBeInTheDocument();
  });
});
