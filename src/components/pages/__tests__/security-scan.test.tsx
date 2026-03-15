import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SecurityScanDetail } from '../security-scan';
import { invoke, mockInvoke } from '@/test/__mocks__/tauri';

describe('SecurityScanDetail', () => {
  it('fixes a single issue without auto-starting a new scan', async () => {
    const user = userEvent.setup();

    mockInvoke('fix_issue', true);

    render(
      <SecurityScanDetail
        onBack={() => {}}
        cachedIssues={[
          {
            id: 'issue-1',
            severity: 'critical',
            title: '配置文件权限过宽',
            description: '配置文件可被其他用户读取',
            platform: 'claude_code',
            fixable: true,
            filePath: '/tmp/demo/.mcp.json',
          },
          {
            id: 'issue-2',
            severity: 'warning',
            title: '同路径重复告警',
            description: '同一个配置路径重复命中',
            platform: 'claude_code',
            fixable: true,
            filePath: '/tmp/demo/.mcp.json',
          },
        ]}
      />
    );

    await user.click(await screen.findByRole('button', { name: '修复此问题' }));

    await waitFor(() => {
      expect(
        screen.getByText('该问题已修好。你可以继续处理其他问题，需要时再手动点击重扫。')
      ).toBeInTheDocument();
    });

    expect(screen.queryByText('配置文件权限过宽')).not.toBeInTheDocument();
    expect(screen.queryByText('同路径重复告警')).not.toBeInTheDocument();
    expect(screen.queryByText('安全扫描中')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('fix_issue', {
      issueId: 'issue-1',
      filePath: '/tmp/demo/.mcp.json',
    });
  });
});
