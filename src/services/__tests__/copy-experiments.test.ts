import { describe, expect, it } from 'vitest';
import {
  getRiskCopyPayload,
  getRiskCopyVariant,
  listRiskCopyEventsForDebug,
  trackRiskCopyAction,
  trackRiskCopyExposure,
} from '../copy-experiments';

describe('copy-experiments', () => {
  it('keeps variant stable for the same device in one runtime', () => {
    const first = getRiskCopyVariant();
    const second = getRiskCopyVariant();

    expect(['control', 'anxiety']).toContain(first);
    expect(second).toBe(first);
  });

  it('records exposure and action events', () => {
    trackRiskCopyExposure('runtime_approval', { request_id: 'req-1' });
    trackRiskCopyAction('runtime_approval', 'approve', { request_id: 'req-1' });

    const events = listRiskCopyEventsForDebug();
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('exposure');
    expect(events[1].event_type).toBe('action');
    expect(events[1].action).toBe('approve');
  });

  it('returns different copy payloads by variant for runtime approvals', () => {
    const control = getRiskCopyPayload('runtime_approval', 'control');
    const anxiety = getRiskCopyPayload('runtime_approval', 'anxiety');

    expect(control.hookLine).not.toBe(anxiety.hookLine);
    expect(control.footerLine).not.toBe(anxiety.footerLine);
  });
});
