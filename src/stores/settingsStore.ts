import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { currentLang, setAppLanguage } from '@/constants/i18n';

interface SettingsState {
  // Existing fields (kept for backward compatibility)
  soundEnabled: boolean;
  animationEnabled: boolean;
  language: 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP';
  region: string;

  // Theme & appearance
  theme: 'dark' | 'light' | 'system';
  accentColor: string;

  // General
  autoStart: boolean;
  minimizeToTray: boolean;
  checkUpdatesAuto: boolean;

  // Notifications
  notificationsEnabled: boolean;
  notificationSound: boolean;
  criticalAlerts: boolean;
  weeklyReport: boolean;

  // Security
  realTimeProtection: boolean;
  autoQuarantine: boolean;
  safeMode: boolean;
  twoFactor: boolean;
  biometric: boolean;
  autoLock: boolean;

  // Scan
  scanAutoStart: boolean;
  scanFrequency: 'daily' | 'weekly' | 'manual';

  // API
  apiEndpoint: string;
  apiKey: string;

  // AI Model Configuration (Pro feature)
  aiProvider: 'deepseek' | 'gemini' | 'openai' | 'custom';
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  aiConnectionTested: boolean;

  // Setters
  setSoundEnabled: (val: boolean) => void;
  setAnimationEnabled: (val: boolean) => void;
  setLanguage: (lang: SettingsState['language']) => void;
  setRegion: (region: string) => void;
  setTheme: (theme: SettingsState['theme']) => void;
  setAccentColor: (color: string) => void;
  setAutoStart: (val: boolean) => void;
  setMinimizeToTray: (val: boolean) => void;
  setCheckUpdatesAuto: (val: boolean) => void;
  setNotificationsEnabled: (val: boolean) => void;
  setNotificationSound: (val: boolean) => void;
  setCriticalAlerts: (val: boolean) => void;
  setWeeklyReport: (val: boolean) => void;
  setRealTimeProtection: (val: boolean) => void;
  setAutoQuarantine: (val: boolean) => void;
  setSafeMode: (val: boolean) => void;
  setTwoFactor: (val: boolean) => void;
  setBiometric: (val: boolean) => void;
  setAutoLock: (val: boolean) => void;
  setScanAutoStart: (val: boolean) => void;
  setScanFrequency: (freq: SettingsState['scanFrequency']) => void;
  setApiEndpoint: (url: string) => void;
  setApiKey: (key: string) => void;
  setAiProvider: (provider: SettingsState['aiProvider']) => void;
  setAiApiKey: (key: string) => void;
  setAiModel: (model: string) => void;
  setAiBaseUrl: (url: string) => void;
  setAiConnectionTested: (tested: boolean) => void;
  resetAll: () => void;
}

const defaultSettings = {
  soundEnabled: true,
  animationEnabled: true,
  language: (currentLang as 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP') || 'zh-CN' as const,
  region: 'China',
  theme: 'dark' as const,
  accentColor: 'cyan',
  autoStart: false,
  minimizeToTray: false,
  checkUpdatesAuto: true,
  notificationsEnabled: true,
  notificationSound: true,
  criticalAlerts: true,
  weeklyReport: false,
  realTimeProtection: true,
  autoQuarantine: false,
  safeMode: false,
  twoFactor: false,
  biometric: true,
  autoLock: false,
  scanAutoStart: false,
  scanFrequency: 'manual' as const,
  apiEndpoint: 'https://api.agentshield.com/v1',
  apiKey: '',
  aiProvider: 'deepseek' as const,
  aiApiKey: '',
  aiModel: 'deepseek-chat',
  aiBaseUrl: '',
  aiConnectionTested: false,
};

const persistedKeys = [
  'soundEnabled',
  'animationEnabled',
  'language',
  'region',
  'theme',
  'accentColor',
  'autoStart',
  'minimizeToTray',
  'checkUpdatesAuto',
  'notificationsEnabled',
  'notificationSound',
  'criticalAlerts',
  'weeklyReport',
  'realTimeProtection',
  'autoQuarantine',
  'safeMode',
  'twoFactor',
  'biometric',
  'autoLock',
  'scanAutoStart',
  'scanFrequency',
  'apiEndpoint',
  'aiProvider',
  'aiModel',
  'aiBaseUrl',
] as const;

type PersistedSettingsKey = (typeof persistedKeys)[number];

function getPersistedSettings(state: SettingsState) {
  return {
    soundEnabled: state.soundEnabled,
    animationEnabled: state.animationEnabled,
    language: state.language,
    region: state.region,
    theme: state.theme,
    accentColor: state.accentColor,
    autoStart: state.autoStart,
    minimizeToTray: state.minimizeToTray,
    checkUpdatesAuto: state.checkUpdatesAuto,
    notificationsEnabled: state.notificationsEnabled,
    notificationSound: state.notificationSound,
    criticalAlerts: state.criticalAlerts,
    weeklyReport: state.weeklyReport,
    realTimeProtection: state.realTimeProtection,
    autoQuarantine: state.autoQuarantine,
    safeMode: state.safeMode,
    twoFactor: state.twoFactor,
    biometric: state.biometric,
    autoLock: state.autoLock,
    scanAutoStart: state.scanAutoStart,
    scanFrequency: state.scanFrequency,
    apiEndpoint: state.apiEndpoint,
    aiProvider: state.aiProvider,
    aiModel: state.aiModel,
    aiBaseUrl: state.aiBaseUrl,
  } satisfies Pick<SettingsState, PersistedSettingsKey>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setSoundEnabled: (val) => set({ soundEnabled: val }),
      setAnimationEnabled: (val) => set({ animationEnabled: val }),
      setLanguage: (lang) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('agentshield-language', lang);
          localStorage.setItem('agentshield-language-manual', '1');
        }
        setAppLanguage(lang);
        set({ language: lang });
      },
      setRegion: (region) => set({ region }),
      setTheme: (theme) => set({ theme }),
      setAccentColor: (color) => set({ accentColor: color }),
      setAutoStart: (val) => set({ autoStart: val }),
      setMinimizeToTray: (val) => set({ minimizeToTray: val }),
      setCheckUpdatesAuto: (val) => set({ checkUpdatesAuto: val }),
      setNotificationsEnabled: (val) => set({ notificationsEnabled: val }),
      setNotificationSound: (val) => set({ notificationSound: val }),
      setCriticalAlerts: (val) => set({ criticalAlerts: val }),
      setWeeklyReport: (val) => set({ weeklyReport: val }),
      setRealTimeProtection: (val) => set({ realTimeProtection: val }),
      setAutoQuarantine: (val) => set({ autoQuarantine: val }),
      setSafeMode: (val) => set({ safeMode: val }),
      setTwoFactor: (val) => set({ twoFactor: val }),
      setBiometric: (val) => set({ biometric: val }),
      setAutoLock: (val) => set({ autoLock: val }),
      setScanAutoStart: (val) => set({ scanAutoStart: val }),
      setScanFrequency: (freq) => set({ scanFrequency: freq }),
      setApiEndpoint: (url) => set({ apiEndpoint: url }),
      setApiKey: (key) => set({ apiKey: key }),
      setAiProvider: (provider) => set({ aiProvider: provider, aiConnectionTested: false }),
      setAiApiKey: (key) => set({ aiApiKey: key, aiConnectionTested: false }),
      setAiModel: (model) => set({ aiModel: model }),
      setAiBaseUrl: (url) => set({ aiBaseUrl: url, aiConnectionTested: false }),
      setAiConnectionTested: (tested) => set({ aiConnectionTested: tested }),
      resetAll: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('agentshield-language-manual');
        }
        setAppLanguage(defaultSettings.language);
        set(defaultSettings);
      },
    }),
    {
      name: 'agentshield-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: getPersistedSettings,
      migrate: (persistedState, version) => {
        const next = {
          ...(persistedState as Partial<SettingsState>),
        };

        if (version < 2) {
          next.scanAutoStart = false;
          next.scanFrequency = 'manual';
        }

        if (version < 3) {
          // v3: default back to normal close behavior to avoid confusing "cannot quit" reports.
          next.minimizeToTray = false;
        }

        return next;
      },
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<SettingsState>),
        ...(typeof window !== 'undefined' && localStorage.getItem('agentshield-language-manual') !== '1'
          ? { language: currentLang as SettingsState['language'] }
          : {}),
        autoLock: false,
      }),
      version: 3,
    }
  )
);
