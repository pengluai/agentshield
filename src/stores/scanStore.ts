import { create } from 'zustand';
import type { ScanStatus, SecurityIssue, ScanReport } from '@/types/domain';

interface ScanState {
  status: ScanStatus;
  progress: number;
  currentItem: string;
  completedItems: number;
  totalItems: number;
  foundIssues: SecurityIssue[];
  report: ScanReport | null;
  securityScore: number;

  // Actions
  startScan: () => void;
  updateProgress: (progress: number, currentItem: string) => void;
  addIssue: (issue: SecurityIssue) => void;
  completeScan: (report: ScanReport) => void;
  cancelScan: () => void;
  fixIssue: (issueId: string) => void;
  fixAll: () => void;
  reset: () => void;
}

export const useScanStore = create<ScanState>((set, get) => ({
  status: 'idle',
  progress: 0,
  currentItem: '',
  completedItems: 0,
  totalItems: 23,
  foundIssues: [],
  report: null,
  securityScore: 0,

  startScan: () => set({
    status: 'scanning',
    progress: 0,
    currentItem: '',
    completedItems: 0,
    foundIssues: [],
    report: null,
  }),

  updateProgress: (progress, currentItem) => set({
    progress,
    currentItem,
    completedItems: Math.floor((progress / 100) * get().totalItems),
  }),

  addIssue: (issue) => set((state) => ({
    foundIssues: [...state.foundIssues, issue],
  })),

  completeScan: (report) => set({
    status: 'completed',
    progress: 100,
    completedItems: get().totalItems,
    report,
    securityScore: report.score,
  }),

  cancelScan: () => set({
    status: 'idle',
    progress: 0,
    currentItem: '',
  }),

  fixIssue: (issueId) => set((state) => ({
    foundIssues: state.foundIssues.filter(i => i.id !== issueId),
    securityScore: Math.min(100, state.securityScore + 5),
  })),

  fixAll: () => set((state) => ({
    foundIssues: state.foundIssues.filter(i => !i.fixable),
    securityScore: Math.min(100, state.securityScore + state.foundIssues.filter(i => i.fixable).length * 5),
  })),

  reset: () => set({
    status: 'idle',
    progress: 0,
    currentItem: '',
    completedItems: 0,
    foundIssues: [],
    report: null,
    securityScore: 0,
  }),
}));
