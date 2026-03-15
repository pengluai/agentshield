import { vi } from 'vitest';

type InvokeHandler = (args?: Record<string, unknown>) => unknown | Promise<unknown>;
type EventHandler<T = unknown> = (event: { payload: T }) => void;

const invokeHandlers = new Map<string, InvokeHandler>();
const eventHandlers = new Map<string, Set<EventHandler>>();

let autostartEnabled = false;
let notificationPermissionGranted = false;
let nextNotificationPermissionResult: 'granted' | 'denied' = 'denied';

const windowController = {
  hide: vi.fn(async () => {}),
  show: vi.fn(async () => {}),
  unminimize: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
  onCloseRequested: vi.fn(async (_handler?: unknown) => () => {}),
};

export const invoke = vi.fn(async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const handler = invokeHandlers.get(cmd);
  if (!handler) {
    return undefined as T;
  }

  return await handler(args) as T;
});

export const listen = vi.fn(async <T>(event: string, handler: EventHandler<T>) => {
  const handlers = eventHandlers.get(event) ?? new Set<EventHandler>();
  handlers.add(handler as EventHandler);
  eventHandlers.set(event, handlers);

  return () => {
    handlers.delete(handler as EventHandler);
    if (handlers.size === 0) {
      eventHandlers.delete(event);
    }
  };
});

export const open = vi.fn(async (_target: string) => {});

export const isPermissionGranted = vi.fn(async () => notificationPermissionGranted);
export const requestPermission = vi.fn(async () => {
  if (nextNotificationPermissionResult === 'granted') {
    notificationPermissionGranted = true;
  }
  return nextNotificationPermissionResult;
});
export const sendNotification = vi.fn((_payload?: unknown) => {});

export const enable = vi.fn(async () => {
  autostartEnabled = true;
});
export const disable = vi.fn(async () => {
  autostartEnabled = false;
});
export const isEnabled = vi.fn(async () => autostartEnabled);

export const getVersion = vi.fn(async () => '1.0.0-test');
export const getCurrentWindow = vi.fn(() => windowController);

export function mockInvoke(
  cmd: string,
  handlerOrValue: InvokeHandler | unknown,
) {
  if (typeof handlerOrValue === 'function') {
    invokeHandlers.set(cmd, handlerOrValue as InvokeHandler);
    return;
  }

  invokeHandlers.set(cmd, async () => handlerOrValue);
}

export function emitTauriEvent<T>(event: string, payload: T) {
  const handlers = eventHandlers.get(event);
  if (!handlers) {
    return;
  }

  for (const handler of handlers) {
    handler({ payload });
  }
}

export function setNotificationPermission(granted: boolean) {
  notificationPermissionGranted = granted;
  nextNotificationPermissionResult = granted ? 'granted' : 'denied';
}

export function setNotificationPermissionRequestResult(result: 'granted' | 'denied') {
  nextNotificationPermissionResult = result;
}

export function setAutostartState(enabled: boolean) {
  autostartEnabled = enabled;
}

export function resetTauriMocks() {
  invokeHandlers.clear();
  eventHandlers.clear();

  autostartEnabled = false;
  notificationPermissionGranted = false;
  nextNotificationPermissionResult = 'denied';

  invoke.mockClear();
  listen.mockClear();
  open.mockClear();
  isPermissionGranted.mockClear();
  requestPermission.mockClear();
  sendNotification.mockClear();
  enable.mockClear();
  disable.mockClear();
  isEnabled.mockClear();
  getVersion.mockClear();
  getCurrentWindow.mockClear();

  windowController.hide.mockClear();
  windowController.show.mockClear();
  windowController.unminimize.mockClear();
  windowController.setFocus.mockClear();
  windowController.onCloseRequested.mockClear();
}
