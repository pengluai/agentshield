import { useLicenseStore } from '@/stores/licenseStore';

export function useProGate() {
  const isPro = useLicenseStore((s) => s.isPro);
  const isTrial = useLicenseStore((s) => s.isTrial);
  const checkFeature = useLicenseStore((s) => s.checkFeature);
  const plan = useLicenseStore((s) => s.plan);

  const canAccess = (feature: string): boolean => {
    return isPro || isTrial || checkFeature(feature);
  };

  const isLocked = (feature: string): boolean => {
    return !canAccess(feature);
  };

  return { isPro, isTrial, plan, canAccess, isLocked };
}
