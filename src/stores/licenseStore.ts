import { create } from 'zustand';
import type { PlanType, LicenseStatus, LicenseInfo } from '@/types/domain';

interface LicenseState {
  plan: PlanType;
  status: LicenseStatus;
  isPro: boolean;
  isTrial: boolean;
  trialDaysLeft: number | null;
  expiresAt: string | null;
  features: string[];

  // Actions
  setLicenseInfo: (info: LicenseInfo) => void;
  activatePro: (expiresAt: string) => void;
  startTrial: (daysLeft: number) => void;
  deactivate: () => void;
  checkFeature: (feature: string) => boolean;
}

const FREE_FEATURES = ['basic_scan', 'key_vault_10', 'notifications'];
const PRO_FEATURES = [...FREE_FEATURES, 'full_scan', 'auto_fix', 'unlimited_keys', 'priority_support', 'rule_updates', 'batch_operations', 'semantic_guard'];

export const useLicenseStore = create<LicenseState>((set, get) => ({
  plan: 'free',
  status: 'active',
  isPro: false,
  isTrial: false,
  trialDaysLeft: null,
  expiresAt: null,
  features: FREE_FEATURES,

  setLicenseInfo: (info) => {
    const activePaidPlan = info.status === 'active'
      && (info.plan === 'pro' || info.plan === 'enterprise' || info.plan === 'trial');

    set({
      plan: info.plan,
      status: info.status,
      isPro: info.status === 'active' && (info.plan === 'pro' || info.plan === 'enterprise'),
      isTrial: info.status === 'active' && info.plan === 'trial',
      trialDaysLeft: info.trialDaysLeft ?? null,
      expiresAt: info.expiresAt ?? null,
      features: activePaidPlan ? PRO_FEATURES : FREE_FEATURES,
    });
  },

  activatePro: (expiresAt) => set({
    plan: 'pro',
    status: 'active',
    isPro: true,
    isTrial: false,
    trialDaysLeft: null,
    expiresAt,
    features: PRO_FEATURES,
  }),

  startTrial: (daysLeft) => set({
    plan: 'trial',
    status: 'active',
    isPro: false,
    isTrial: true,
    trialDaysLeft: daysLeft,
    expiresAt: new Date(Date.now() + daysLeft * 86400000).toISOString(),
    features: PRO_FEATURES,
  }),

  deactivate: () => set({
    plan: 'free',
    status: 'active',
    isPro: false,
    isTrial: false,
    trialDaysLeft: null,
    expiresAt: null,
    features: FREE_FEATURES,
  }),

  checkFeature: (feature) => get().features.includes(feature),
}));
