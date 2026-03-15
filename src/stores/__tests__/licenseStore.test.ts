import { describe, it, expect, beforeEach } from 'vitest';
import { useLicenseStore } from '../licenseStore';

describe('licenseStore', () => {
  beforeEach(() => {
    useLicenseStore.getState().deactivate();
  });

  it('should start as free plan', () => {
    const state = useLicenseStore.getState();
    expect(state.plan).toBe('free');
    expect(state.isPro).toBe(false);
    expect(state.isTrial).toBe(false);
  });

  it('should activate pro', () => {
    useLicenseStore.getState().activatePro('2027-01-01T00:00:00Z');
    const state = useLicenseStore.getState();
    expect(state.plan).toBe('pro');
    expect(state.isPro).toBe(true);
    expect(state.isTrial).toBe(false);
  });

  it('should start trial', () => {
    useLicenseStore.getState().startTrial(14);
    const state = useLicenseStore.getState();
    expect(state.plan).toBe('trial');
    expect(state.isTrial).toBe(true);
    expect(state.trialDaysLeft).toBe(14);
  });

  it('should deactivate to free', () => {
    useLicenseStore.getState().activatePro('2027-01-01T00:00:00Z');
    useLicenseStore.getState().deactivate();
    expect(useLicenseStore.getState().plan).toBe('free');
    expect(useLicenseStore.getState().isPro).toBe(false);
  });

  it('should check features correctly', () => {
    // Free plan
    expect(useLicenseStore.getState().checkFeature('basic_scan')).toBe(true);
    expect(useLicenseStore.getState().checkFeature('auto_fix')).toBe(false);

    // Pro plan
    useLicenseStore.getState().activatePro('2027-01-01T00:00:00Z');
    expect(useLicenseStore.getState().checkFeature('auto_fix')).toBe(true);
    expect(useLicenseStore.getState().checkFeature('unlimited_keys')).toBe(true);
  });

  it('should downgrade expired trial to free feature set', () => {
    useLicenseStore.getState().setLicenseInfo({
      plan: 'trial',
      status: 'expired',
      trialDaysLeft: 0,
      expiresAt: '2026-03-01T00:00:00Z',
      features: [],
    });

    const state = useLicenseStore.getState();
    expect(state.isTrial).toBe(false);
    expect(state.isPro).toBe(false);
    expect(state.checkFeature('auto_fix')).toBe(false);
  });

  it('should downgrade expired pro to free feature set', () => {
    useLicenseStore.getState().setLicenseInfo({
      plan: 'pro',
      status: 'expired',
      trialDaysLeft: undefined,
      expiresAt: '2026-03-01T00:00:00Z',
      features: [],
    });

    const state = useLicenseStore.getState();
    expect(state.isTrial).toBe(false);
    expect(state.isPro).toBe(false);
    expect(state.checkFeature('batch_operations')).toBe(false);
  });
});
