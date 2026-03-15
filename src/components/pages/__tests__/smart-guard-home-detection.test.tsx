import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SmartGuardHome } from '../smart-guard-home';
import { mockInvoke } from '@/test/__mocks__/tauri';

const DEFAULT_PROTECTION_STATUS = {
  enabled: true,
  watcher_ready: true,
  auto_quarantine: false,
  watched_paths: [],
  incident_count: 0,
  last_event_at: null,
  quarantine_dir: '',
  last_incident: null,
};

describe('SmartGuardHome idle layout', () => {
  it('keeps the home screen focused on the main copy without showing host badges', async () => {
    mockInvoke('get_protection_status', DEFAULT_PROTECTION_STATUS);

    render(<SmartGuardHome />);

    expect(await screen.findByRole('button', { name: '扫描' })).toBeInTheDocument();
    expect(screen.queryByText('Codex CLI')).not.toBeInTheDocument();
    expect(screen.queryByText('VS Code')).not.toBeInTheDocument();
  });
});
