import { describe, expect, it, vi } from 'vitest';
import {
  createBufferedPhaseVisualizer,
  type BufferedPhaseEvent,
} from '../buffered-phase-visualizer';

describe('createBufferedPhaseVisualizer', () => {
  it('replays real future phases in order with a minimum visible duration', () => {
    vi.useFakeTimers();
    const applied: BufferedPhaseEvent[] = [];
    const finalized = vi.fn();

    const visualizer = createBufferedPhaseVisualizer({
      phaseOrder: ['detect_tools', 'mcp_security', 'key_security'],
      initialPhaseId: 'detect_tools',
      minPhaseVisibleMs: 200,
      onApply: (event) => {
        applied.push(event);
      },
    });

    visualizer.push({
      phaseId: 'detect_tools',
      label: '检测 AI 工具与配置入口',
      progress: 5,
      status: 'running',
    });
    visualizer.push({
      phaseId: 'mcp_security',
      label: '分析 MCP 配置与命令风险',
      progress: 18,
      status: 'running',
    });
    visualizer.push({
      phaseId: 'key_security',
      label: '扫描明文密钥与凭据暴露',
      progress: 52,
      status: 'running',
    });
    visualizer.finalize(finalized);

    expect(applied.map((event) => event.phaseId)).toEqual(['detect_tools']);

    vi.advanceTimersByTime(200);
    expect(applied.map((event) => event.phaseId)).toEqual([
      'detect_tools',
      'mcp_security',
    ]);
    expect(finalized).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(applied.map((event) => event.phaseId)).toEqual([
      'detect_tools',
      'mcp_security',
      'key_security',
    ]);
    expect(finalized).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(finalized).toHaveBeenCalledTimes(1);

    visualizer.dispose();
    vi.useRealTimers();
  });

  it('never regresses progress when late events report lower values', () => {
    vi.useFakeTimers();
    const applied: BufferedPhaseEvent[] = [];

    const visualizer = createBufferedPhaseVisualizer({
      phaseOrder: ['detect_tools', 'mcp_security'],
      initialPhaseId: 'detect_tools',
      minPhaseVisibleMs: 100,
      onApply: (event) => {
        applied.push(event);
      },
    });

    visualizer.push({
      phaseId: 'detect_tools',
      label: 'detect',
      progress: 50,
      status: 'running',
    });

    visualizer.push({
      phaseId: 'detect_tools',
      label: 'detect-late',
      progress: 20,
      status: 'running',
    });

    visualizer.push({
      phaseId: 'mcp_security',
      label: 'mcp',
      progress: 40,
      status: 'running',
    });

    vi.advanceTimersByTime(100);

    const progressHistory = applied.map((event) => event.progress);
    expect(progressHistory).toEqual([50, 50, 50]);

    visualizer.dispose();
    vi.useRealTimers();
  });
});
