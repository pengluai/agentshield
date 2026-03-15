import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginStartupTimelineSession,
  clearStartupTimelineEvents,
  listStartupTimelineEvents,
  recordStartupTimelineEvent,
} from '../startup-timeline';

describe('startup timeline', () => {
  beforeEach(() => {
    clearStartupTimelineEvents();
  });

  it('starts a fresh session and records the boot event', () => {
    beginStartupTimelineSession({ safeMode: true });

    const events = listStartupTimelineEvents();

    expect(events).toHaveLength(1);
    expect(events[0].step).toBe('app_boot');
    expect(events[0].status).toBe('started');
    expect(events[0].summary).toContain('安全模式');
  });

  it('keeps newest events first', () => {
    beginStartupTimelineSession({ safeMode: false });
    recordStartupTimelineEvent('approval_center', 'completed', '审批中心已就绪。');
    recordStartupTimelineEvent('background_scan', 'skipped', '后台自动扫描当前未启用。');

    const events = listStartupTimelineEvents();

    expect(events[0].step).toBe('background_scan');
    expect(events[1].step).toBe('approval_center');
    expect(events[2].step).toBe('app_boot');
  });
});
