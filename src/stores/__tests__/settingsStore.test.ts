import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settingsStore';
import { isEnglishLocale, t } from '@/constants/i18n';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAll();
  });

  it('should have correct defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.language).toBe('zh-CN');
    expect(state.soundEnabled).toBe(true);
    expect(state.animationEnabled).toBe(true);
    expect(state.minimizeToTray).toBe(false);
    expect(state.scanAutoStart).toBe(false);
    expect(state.scanFrequency).toBe('manual');
    expect(state.realTimeProtection).toBe(true);
    expect(state.autoQuarantine).toBe(false);
    expect(state.safeMode).toBe(false);
    expect(state.autoLock).toBe(false);
  });

  it('should toggle sound', () => {
    useSettingsStore.getState().setSoundEnabled(false);
    expect(useSettingsStore.getState().soundEnabled).toBe(false);
  });

  it('should change theme', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('should change language', () => {
    useSettingsStore.getState().setLanguage('en-US');
    expect(useSettingsStore.getState().language).toBe('en-US');
    expect(isEnglishLocale).toBe(true);
    expect(t.back).toBe('Back');
  });

  it('should reset all settings', () => {
    useSettingsStore.getState().setTheme('light');
    useSettingsStore.getState().setLanguage('en-US');
    useSettingsStore.getState().setSoundEnabled(false);
    useSettingsStore.getState().resetAll();
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(useSettingsStore.getState().language).toBe('zh-CN');
    expect(useSettingsStore.getState().soundEnabled).toBe(true);
    expect(isEnglishLocale).toBe(false);
    expect(t.back).toBe('后退');
  });

  it('should update API settings', () => {
    useSettingsStore.getState().setApiEndpoint('https://custom.api.com/v2');
    useSettingsStore.getState().setApiKey('sk-test-key');
    expect(useSettingsStore.getState().apiEndpoint).toBe('https://custom.api.com/v2');
    expect(useSettingsStore.getState().apiKey).toBe('sk-test-key');
  });

  it('should toggle security settings', () => {
    useSettingsStore.getState().setTwoFactor(true);
    useSettingsStore.getState().setBiometric(false);
    useSettingsStore.getState().setSafeMode(true);
    expect(useSettingsStore.getState().twoFactor).toBe(true);
    expect(useSettingsStore.getState().biometric).toBe(false);
    expect(useSettingsStore.getState().safeMode).toBe(true);
  });
});
