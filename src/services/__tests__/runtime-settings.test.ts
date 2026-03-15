import { describe, expect, it } from 'vitest';
import { open } from '@/test/__mocks__/tauri';
import { isAllowedExternalUrl, openExternalUrl } from '../runtime-settings';

describe('runtime-settings external URL guard', () => {
  it('allows https links and macOS permission panes', async () => {
    expect(isAllowedExternalUrl('https://docs.openclaw.dev')).toBe(true);
    expect(
      isAllowedExternalUrl('x-apple.systempreferences:com.apple.preference.security')
    ).toBe(true);

    await openExternalUrl('https://docs.openclaw.dev');

    expect(open).toHaveBeenCalledWith('https://docs.openclaw.dev');
  });

  it('rejects mailto and tel schemes', async () => {
    expect(isAllowedExternalUrl('mailto:test@example.com')).toBe(false);
    expect(isAllowedExternalUrl('tel:+12345678')).toBe(false);

    await expect(openExternalUrl('mailto:test@example.com')).rejects.toThrow(
      'Blocked external URL'
    );
    expect(open).not.toHaveBeenCalled();
  });
});
