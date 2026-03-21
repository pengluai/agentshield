import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpgradePro } from '../upgrade-pro';
import { mockInvoke } from '@/test/__mocks__/tauri';
import { useLicenseStore } from '@/stores/licenseStore';
import { t } from '@/constants/i18n';
import * as runtimeSettings from '@/services/runtime-settings';

describe('UpgradePro', () => {
  let openExternalUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useLicenseStore.getState().deactivate();
    vi.stubEnv('VITE_CHECKOUT_MONTHLY_URL', '');
    vi.stubEnv('VITE_CHECKOUT_YEARLY_URL', '');
    vi.stubEnv('VITE_CHECKOUT_LIFETIME_URL', '');
    openExternalUrlSpy = vi.spyOn(runtimeSettings, 'openExternalUrl').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    openExternalUrlSpy.mockRestore();
  });

  it('starts a real trial flow and updates the license store from backend data', async () => {
    const user = userEvent.setup();

    mockInvoke('start_trial', {
      plan: 'trial',
      status: 'active',
      expires_at: null,
      trial_days_left: 14,
    });

    render(<UpgradePro />);

    await user.click(screen.getByRole('button', { name: t.freeTrial30 }));

    await waitFor(() => {
      expect(useLicenseStore.getState().plan).toBe('trial');
      expect(useLicenseStore.getState().trialDaysLeft).toBe(14);
    });

    expect((await screen.findAllByText(t.trialActive.replace('{days}', '14'))).length).toBeGreaterThan(0);
  });

  it('falls back to the production Creem monthly checkout when env URL is missing', async () => {
    const user = userEvent.setup();

    render(<UpgradePro />);
    await user.click(screen.getAllByRole('button', { name: t.buyActivationCode })[0]);

    await waitFor(() => {
      expect(openExternalUrlSpy).toHaveBeenCalledTimes(1);
    });

    const checkoutUrl = openExternalUrlSpy.mock.calls[0][0];
    const parsed = new URL(checkoutUrl);
    expect(parsed.origin).toBe('https://www.creem.io');
    expect(parsed.pathname).toBe('/payment/prod_2T8qrIwLHQ3AlG4KtTB849');
    expect(parsed.searchParams.get('metadata[sku_code]')).toBe('AGSH_PRO_30D');
  });

  it('falls back to production checkout when env URL uses placeholder host', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_CHECKOUT_MONTHLY_URL', 'https://example.com/monthly');

    render(<UpgradePro />);
    await user.click(screen.getAllByRole('button', { name: t.buyActivationCode })[0]);

    await waitFor(() => {
      expect(openExternalUrlSpy).toHaveBeenCalledTimes(1);
    });

    const checkoutUrl = openExternalUrlSpy.mock.calls[0][0];
    const parsed = new URL(checkoutUrl);
    expect(parsed.origin).toBe('https://www.creem.io');
    expect(parsed.pathname).toBe('/payment/prod_2T8qrIwLHQ3AlG4KtTB849');
  });

  it('appends checkout metadata for Creem links before opening browser', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_CHECKOUT_MONTHLY_URL', 'https://checkout.creem.io/session_123');

    render(<UpgradePro />);
    await user.click(screen.getAllByRole('button', { name: t.buyActivationCode })[0]);

    await waitFor(() => {
      expect(openExternalUrlSpy).toHaveBeenCalledTimes(1);
    });

    const checkoutUrl = openExternalUrlSpy.mock.calls[0][0];
    const parsed = new URL(checkoutUrl);
    expect(parsed.searchParams.get('metadata[sku_code]')).toBe('AGSH_PRO_30D');
    expect(parsed.searchParams.get('metadata[campaign]')).toBe('desktop_upgrade');
    expect(parsed.searchParams.get('metadata[source]')).toBe('agentshield_app');
  });
});
