import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { OnboardingWizard } from '../onboarding-wizard';
import {
  open,
  requestPermission,
  setNotificationPermission,
  setNotificationPermissionRequestResult,
} from '@/test/__mocks__/tauri';
import { useSettingsStore } from '@/stores/settingsStore';
import { t } from '@/constants/i18n';

describe('OnboardingWizard', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAll();
    useSettingsStore.getState().setNotificationsEnabled(false);
  });

  it.skipIf(process.platform !== 'darwin')('uses real permission actions instead of local fake toggles', async () => {
    const user = userEvent.setup();

    setNotificationPermission(false);
    setNotificationPermissionRequestResult('granted');

    render(<OnboardingWizard onComplete={() => {}} />);

    await user.click(screen.getByRole('button', { name: t.continueBtn }));
    await screen.findByText(t.permFullDisk);

    await user.click(screen.getAllByRole('button', { name: '打开系统设置' })[0]);
    expect(open).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    );

    await user.click(screen.getByRole('button', { name: '授权通知' }));

    await waitFor(() => {
      expect(requestPermission).toHaveBeenCalled();
      expect(useSettingsStore.getState().notificationsEnabled).toBe(true);
    });

    expect(await screen.findByText('桌面通知权限已启用。')).toBeInTheDocument();
  });
});
