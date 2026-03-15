import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      currentModule: 'smartGuard',
      isExpanded: true,
      isOnboarding: false,
      scanStatus: 'idle',
      scanProgress: 0,
      scanScore: 0,
      currentScanningFile: '',
      unreadCount: 3,
    });
  });

  it('should set current module', () => {
    useAppStore.getState().setCurrentModule('securityScan');
    expect(useAppStore.getState().currentModule).toBe('securityScan');
  });

  it('keeps sidebar expanded on module change', () => {
    useAppStore.getState().setCurrentModule('securityScan');
    expect(useAppStore.getState().isExpanded).toBe(true);
  });

  it('should start scan', () => {
    useAppStore.getState().startScan();
    expect(useAppStore.getState().scanStatus).toBe('scanning');
    expect(useAppStore.getState().scanProgress).toBe(0);
    expect(useAppStore.getState().isExpanded).toBe(true);
  });

  it('should complete scan with score', () => {
    useAppStore.getState().startScan();
    useAppStore.getState().completeScan();
    expect(useAppStore.getState().scanStatus).toBe('completed');
    expect(useAppStore.getState().scanProgress).toBe(100);
    expect(useAppStore.getState().scanScore).toBe(100);
  });

  it('should stop scan and reset', () => {
    useAppStore.getState().startScan();
    useAppStore.getState().stopScan();
    expect(useAppStore.getState().scanStatus).toBe('idle');
    expect(useAppStore.getState().isExpanded).toBe(true);
  });

  it('should complete onboarding', () => {
    useAppStore.setState({ isOnboarding: true });
    useAppStore.getState().completeOnboarding();
    expect(useAppStore.getState().isOnboarding).toBe(false);
    expect(localStorage.getItem('agentshield-onboarding-completed')).toBe('true');
  });

  it('hydrates onboarding visibility from local storage', () => {
    localStorage.removeItem('agentshield-onboarding-completed');
    useAppStore.getState().hydrateOnboarding();
    expect(useAppStore.getState().isOnboarding).toBe(false);

    localStorage.setItem('agentshield-onboarding-completed', 'true');
    useAppStore.getState().hydrateOnboarding();
    expect(useAppStore.getState().isOnboarding).toBe(false);
  });

  it('should update unread count', () => {
    useAppStore.getState().setUnreadCount(5);
    expect(useAppStore.getState().unreadCount).toBe(5);
  });
});
