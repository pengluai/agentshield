import { create } from 'zustand';
import type { StoreCatalogItem, InstalledItem } from '@/types/domain';

interface StoreState {
  catalog: StoreCatalogItem[];
  installedItems: InstalledItem[];
  selectedItem: StoreCatalogItem | null;
  searchQuery: string;
  activeCategory: string;
  isLoading: boolean;

  // Actions
  setCatalog: (items: StoreCatalogItem[]) => void;
  setInstalledItems: (items: InstalledItem[]) => void;
  setSelectedItem: (item: StoreCatalogItem | null) => void;
  setSearchQuery: (query: string) => void;
  setActiveCategory: (category: string) => void;
  setIsLoading: (loading: boolean) => void;
  addInstalledItem: (item: InstalledItem) => void;
  removeInstalledItem: (itemId: string) => void;
  updateInstalledItem: (itemId: string, updates: Partial<InstalledItem>) => void;
}

export const useStoreStore = create<StoreState>((set) => ({
  catalog: [],
  installedItems: [],
  selectedItem: null,
  searchQuery: '',
  activeCategory: 'all',
  isLoading: false,

  setCatalog: (catalog) => set({ catalog }),
  setInstalledItems: (installedItems) => set({ installedItems }),
  setSelectedItem: (selectedItem) => set({ selectedItem }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setIsLoading: (isLoading) => set({ isLoading }),
  addInstalledItem: (item) => set((state) => ({
    installedItems: [...state.installedItems, item],
  })),
  removeInstalledItem: (itemId) => set((state) => ({
    installedItems: state.installedItems.filter(i => i.itemId !== itemId),
  })),
  updateInstalledItem: (itemId, updates) => set((state) => ({
    installedItems: state.installedItems.map(i =>
      i.itemId === itemId ? { ...i, ...updates } : i
    ),
  })),
}));
