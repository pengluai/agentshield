import { describe, it, expect, beforeEach } from 'vitest';
import { useScanStore } from '../scanStore';

describe('scanStore', () => {
  beforeEach(() => {
    useScanStore.getState().reset();
  });

  it('should start as idle', () => {
    expect(useScanStore.getState().status).toBe('idle');
    expect(useScanStore.getState().progress).toBe(0);
  });

  it('should start scan', () => {
    useScanStore.getState().startScan();
    expect(useScanStore.getState().status).toBe('scanning');
    expect(useScanStore.getState().foundIssues).toEqual([]);
  });

  it('should update progress', () => {
    useScanStore.getState().startScan();
    useScanStore.getState().updateProgress(50, 'API 密钥安全');
    expect(useScanStore.getState().progress).toBe(50);
    expect(useScanStore.getState().currentItem).toBe('API 密钥安全');
  });

  it('should add and fix issues', () => {
    useScanStore.getState().startScan();
    useScanStore.getState().addIssue({
      id: 'issue-1',
      severity: 'warning',
      title: 'Test Issue',
      description: 'A test issue',
      platform: 'cursor',
      fixable: true,
    });
    expect(useScanStore.getState().foundIssues.length).toBe(1);

    useScanStore.getState().fixIssue('issue-1');
    expect(useScanStore.getState().foundIssues.length).toBe(0);
  });

  it('should fix all fixable issues', () => {
    useScanStore.getState().startScan();
    useScanStore.getState().addIssue({
      id: 'fix-1', severity: 'warning', title: 'Fixable', description: '', platform: 'cursor', fixable: true,
    });
    useScanStore.getState().addIssue({
      id: 'fix-2', severity: 'critical', title: 'Not fixable', description: '', platform: 'vscode', fixable: false,
    });
    useScanStore.getState().fixAll();
    expect(useScanStore.getState().foundIssues.length).toBe(1);
    expect(useScanStore.getState().foundIssues[0].id).toBe('fix-2');
  });

  it('should cancel scan', () => {
    useScanStore.getState().startScan();
    useScanStore.getState().cancelScan();
    expect(useScanStore.getState().status).toBe('idle');
  });

  it('should complete scan with report', () => {
    useScanStore.getState().startScan();
    useScanStore.getState().completeScan({
      id: 'report-1',
      score: 85,
      issues: [],
      passed: [],
      platform_reports: [],
      timestamp: new Date().toISOString(),
    });
    expect(useScanStore.getState().status).toBe('completed');
    expect(useScanStore.getState().securityScore).toBe(85);
  });
});
