import { create } from 'zustand';
import type { SystemInfo, OpenClawStatus, Platform } from '@/types/domain';

interface OpenClawState {
  detected: boolean;
  installed: boolean;
  version: string | null;
  installStatus: 'idle' | 'detecting' | 'installing' | 'configuring' | 'completed' | 'failed';
  installStep: number;
  systemInfo: SystemInfo | null;
  openClawStatus: OpenClawStatus | null;
  securityScore: number | null;
  connectedChannels: Platform[];

  // Actions
  setDetected: (detected: boolean) => void;
  setInstalled: (installed: boolean, version?: string) => void;
  setInstallStatus: (status: OpenClawState['installStatus']) => void;
  setInstallStep: (step: number) => void;
  setSystemInfo: (info: SystemInfo) => void;
  setOpenClawStatus: (status: OpenClawStatus) => void;
  setSecurityScore: (score: number) => void;
  addChannel: (platform: Platform) => void;
  removeChannel: (platform: Platform) => void;
  reset: () => void;
}

export const useOpenClawStore = create<OpenClawState>((set) => ({
  detected: false,
  installed: false,
  version: null,
  installStatus: 'idle',
  installStep: 0,
  systemInfo: null,
  openClawStatus: null,
  securityScore: null,
  connectedChannels: [],

  setDetected: (detected) => set({ detected }),
  setInstalled: (installed, version) => set({ installed, version: version ?? null }),
  setInstallStatus: (installStatus) => set({ installStatus }),
  setInstallStep: (installStep) => set({ installStep }),
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setOpenClawStatus: (openClawStatus) => set({ openClawStatus }),
  setSecurityScore: (securityScore) => set({ securityScore }),
  addChannel: (platform) => set((state) => ({
    connectedChannels: [...state.connectedChannels, platform],
  })),
  removeChannel: (platform) => set((state) => ({
    connectedChannels: state.connectedChannels.filter(p => p !== platform),
  })),
  reset: () => set({
    detected: false,
    installed: false,
    version: null,
    installStatus: 'idle',
    installStep: 0,
    systemInfo: null,
    openClawStatus: null,
    securityScore: null,
    connectedChannels: [],
  }),
}));
