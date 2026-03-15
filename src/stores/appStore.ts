import { create } from 'zustand';
import { t } from '@/constants/i18n';
import type { ModuleId, ScanStatus, ScanCardState, SecurityIssue } from '@/types/domain';

interface AppState {
  // Navigation
  currentModule: ModuleId;
  isExpanded: boolean;

  // Onboarding
  isOnboarding: boolean;

  // Scan state
  scanStatus: ScanStatus;
  scanProgress: number;
  scanScore: number;
  currentScanningFile: string;
  scanCards: ScanCardState[];

  // Cached scan results — per category
  lastScanByCategory: Record<string, SecurityIssue[]>;

  // Notifications
  unreadCount: number;

  // Actions
  setCurrentModule: (module: ModuleId) => void;
  setIsExpanded: (expanded: boolean) => void;
  completeOnboarding: () => void;
  setScanStatus: (status: ScanStatus) => void;
  setScanProgress: (progress: number) => void;
  setScanScore: (score: number) => void;
  setCurrentScanningFile: (file: string) => void;
  setScanCards: (cards: ScanCardState[]) => void;
  updateScanCard: (id: string, updates: Partial<ScanCardState>) => void;
  setUnreadCount: (count: number) => void;
  setLastScanByCategory: (data: Record<string, SecurityIssue[]>) => void;
  hydrateOnboarding: () => void;
  startScan: () => void;
  stopScan: () => void;
  completeScan: () => void;
}

const ONBOARDING_COMPLETED_KEY = 'agentshield-onboarding-completed';

function shouldShowOnboarding() {
  // Product requirement: launch directly into main app (no onboarding wizard).
  return false;
}

function persistOnboardingComplete() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
}

const initialScanCards: ScanCardState[] = [
  {
    id: 'mcp-security',
    name: t.cardMcpSecurity,
    status: 'waiting',
    gradient: { from: '#3B0A0A', to: '#EF4444' },
  },
  {
    id: 'key-security',
    name: t.cardKeySecurity,
    status: 'waiting',
    gradient: { from: '#2D1B00', to: '#F59E0B' },
  },
  {
    id: 'env-config',
    name: t.cardEnvConfig,
    status: 'waiting',
    gradient: { from: '#1E0A3E', to: '#8B5CF6' },
  },
  {
    id: 'skill-security',
    name: t.cardInstalledRisk,
    status: 'waiting',
    gradient: { from: '#042F2E', to: '#14B8A6' },
  },
  {
    id: 'system-protection',
    name: t.cardSystemProtection,
    status: 'waiting',
    gradient: { from: '#0B1120', to: '#0EA5E9' },
  },
];

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  currentModule: 'smartGuard',
  isExpanded: true,
  isOnboarding: shouldShowOnboarding(),
  scanStatus: 'idle',
  scanProgress: 0,
  scanScore: 0,
  currentScanningFile: '',
  scanCards: initialScanCards,
  lastScanByCategory: {},
  unreadCount: 3,

  // Actions
  setCurrentModule: (module) => {
    set({ currentModule: module, isExpanded: true });
  },

  setIsExpanded: (expanded) => set({ isExpanded: expanded }),

  hydrateOnboarding: () => set({ isOnboarding: shouldShowOnboarding() }),

  completeOnboarding: () => {
    persistOnboardingComplete();
    set({ isOnboarding: false });
  },

  setScanStatus: (status) => set({ scanStatus: status }),

  setScanProgress: (progress) => set({ scanProgress: progress }),

  setScanScore: (score) => set({ scanScore: score }),

  setCurrentScanningFile: (file) => set({ currentScanningFile: file }),

  setScanCards: (cards) => set({ scanCards: cards }),

  updateScanCard: (id, updates) => set((state) => ({
    scanCards: state.scanCards.map((card) =>
      card.id === id ? { ...card, ...updates } : card
    ),
  })),

  setUnreadCount: (count) => set({ unreadCount: count }),

  setLastScanByCategory: (data) => set({ lastScanByCategory: data }),

  startScan: () => {
    set({
      scanStatus: 'scanning',
      scanProgress: 0,
      scanScore: 0,
      isExpanded: true,
      lastScanByCategory: {},
      scanCards: initialScanCards.map((card) => ({
        ...card,
        status: 'waiting',
        result: undefined,
      })),
    });
  },

  stopScan: () => {
    set({
      scanStatus: 'idle',
      scanProgress: 0,
      isExpanded: true,
      scanCards: initialScanCards,
    });
  },

  completeScan: () => {
    const currentScore = get().scanScore;
    set({
      scanStatus: 'completed',
      scanProgress: 100,
      scanScore: currentScore > 0 ? currentScore : 100,
      isExpanded: true,
    });
  },
}));
