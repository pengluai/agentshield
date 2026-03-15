import { useAppStore } from '@/stores/appStore';

export function useModuleTransition() {
  const activeModule = useAppStore((s) => s.currentModule);
  const setActiveModule = useAppStore((s) => s.setCurrentModule);
  return { activeModule, setActiveModule };
}
