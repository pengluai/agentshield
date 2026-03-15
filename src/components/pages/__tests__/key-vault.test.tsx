import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { KeyVaultDetail } from '../key-vault';
import { mockInvoke } from '@/test/__mocks__/tauri';
import { useLicenseStore } from '@/stores/licenseStore';
import { t } from '@/constants/i18n';

describe('KeyVaultDetail', () => {
  beforeEach(() => {
    useLicenseStore.getState().deactivate();
  });

  it('shows the free-plan storage limit using real vault data and blocks extra adds', async () => {
    mockInvoke(
      'vault_list_keys',
      Array.from({ length: 10 }, (_, index) => ({
        id: `key-${index}`,
        name: `Key ${index}`,
        service: 'openai',
        masked_value: 'sk-****',
        created_at: '2026-03-09T00:00:00Z',
        last_used: null,
        encrypted: true,
      })),
    );
    mockInvoke('vault_scan_exposed_keys', []);

    render(<KeyVaultDetail keyId="all" onBack={() => {}} />);

    expect(await screen.findByText(/10\/10/)).toBeInTheDocument();
    expect(
      await screen.findByText(/免费版已达到 10 个密钥上限/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.addKey })).toBeDisabled();
  });
});
