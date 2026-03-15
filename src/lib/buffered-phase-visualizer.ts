export interface BufferedPhaseEvent {
  phaseId: string;
  label: string;
  progress: number;
  status: string;
}

interface BufferedPhaseVisualizerOptions {
  phaseOrder: string[];
  initialPhaseId: string;
  minPhaseVisibleMs: number;
  onApply: (event: BufferedPhaseEvent) => void;
  onIdle?: () => void;
}

export function createBufferedPhaseVisualizer({
  phaseOrder,
  initialPhaseId,
  minPhaseVisibleMs,
  onApply,
  onIdle,
}: BufferedPhaseVisualizerOptions) {
  let currentPhaseId = initialPhaseId;
  let highestProgress = 0;
  let disposed = false;
  let timer: number | null = null;
  let finalizeCallback: (() => void) | null = null;
  const pendingPhaseEvents = new Map<string, BufferedPhaseEvent>();

  const currentPhaseIndex = () => phaseOrder.indexOf(currentPhaseId);

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const flushFinalize = () => {
    if (finalizeCallback) {
      const callback = finalizeCallback;
      finalizeCallback = null;
      callback();
      return;
    }

    onIdle?.();
  };

  const applyEvent = (event: BufferedPhaseEvent) => {
    currentPhaseId = event.phaseId;
    highestProgress = Math.max(highestProgress, event.progress);
    onApply({
      ...event,
      progress: highestProgress,
    });
  };

  const nextPendingPhaseId = () => {
    const startIndex = Math.max(currentPhaseIndex() + 1, 0);
    for (let index = startIndex; index < phaseOrder.length; index += 1) {
      const phaseId = phaseOrder[index];
      if (pendingPhaseEvents.has(phaseId)) {
        return phaseId;
      }
    }

    return null;
  };

  const advance = () => {
    if (disposed) {
      return;
    }

    clearTimer();
    const nextPhaseId = nextPendingPhaseId();
    if (!nextPhaseId) {
      flushFinalize();
      return;
    }

    const nextEvent = pendingPhaseEvents.get(nextPhaseId);
    pendingPhaseEvents.delete(nextPhaseId);
    if (!nextEvent) {
      flushFinalize();
      return;
    }

    applyEvent(nextEvent);
    timer = window.setTimeout(advance, minPhaseVisibleMs);
  };

  const scheduleAdvance = () => {
    if (disposed || timer !== null) {
      return;
    }

    timer = window.setTimeout(advance, minPhaseVisibleMs);
  };

  return {
    push(event: BufferedPhaseEvent) {
      if (disposed) {
        return;
      }

      const incomingIndex = phaseOrder.indexOf(event.phaseId);
      const activeIndex = currentPhaseIndex();
      if (
        event.phaseId === currentPhaseId ||
        incomingIndex === -1 ||
        incomingIndex <= activeIndex
      ) {
        applyEvent(event);
        return;
      }

      pendingPhaseEvents.set(event.phaseId, event);
      scheduleAdvance();
    },

    finalize(callback: () => void) {
      if (disposed) {
        return;
      }

      if (pendingPhaseEvents.size === 0 && timer === null) {
        callback();
        return;
      }

      finalizeCallback = callback;
    },

    reset() {
      pendingPhaseEvents.clear();
      finalizeCallback = null;
      currentPhaseId = initialPhaseId;
      highestProgress = 0;
      clearTimer();
    },

    dispose() {
      disposed = true;
      pendingPhaseEvents.clear();
      finalizeCallback = null;
      highestProgress = 0;
      clearTimer();
    },
  };
}
