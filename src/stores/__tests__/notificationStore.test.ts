import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockInvoke, resetTauriMocks } from '@/test/__mocks__/tauri';
import type { Notification } from '@/types/domain';

vi.mock('@/services/sound', () => ({
  playSound: vi.fn(),
}));

import { playSound } from '@/services/sound';
import { resetNotificationCueState, useNotificationStore } from '../notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    resetTauriMocks();
    resetNotificationCueState();
    vi.mocked(playSound).mockClear();

    // Reset to initial mock notifications
    useNotificationStore.setState({
      notifications: [
        {
          id: '1',
          type: 'system',
          priority: 'info',
          title: 'Test 1',
          body: 'Body 1',
          timestamp: new Date().toISOString(),
          read: false,
        },
        {
          id: '2',
          type: 'security',
          priority: 'warning',
          title: 'Test 2',
          body: 'Body 2',
          timestamp: new Date().toISOString(),
          read: false,
        },
        {
          id: '3',
          type: 'update',
          priority: 'info',
          title: 'Test 3',
          body: 'Body 3',
          timestamp: new Date().toISOString(),
          read: true,
        },
      ],
      loaded: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(playSound).mockClear();
  });

  it('should have initial notifications', () => {
    expect(useNotificationStore.getState().notifications.length).toBe(3);
  });

  it('should mark notification as read', () => {
    useNotificationStore.getState().markAsRead('1');
    const n = useNotificationStore.getState().notifications.find(n => n.id === '1');
    expect(n?.read).toBe(true);
  });

  it('should mark all as read', () => {
    useNotificationStore.getState().markAllAsRead();
    const unread = useNotificationStore.getState().notifications.filter(n => !n.read);
    expect(unread.length).toBe(0);
  });

  it('should remove notification', () => {
    useNotificationStore.getState().removeNotification('2');
    expect(useNotificationStore.getState().notifications.length).toBe(2);
    expect(useNotificationStore.getState().notifications.find(n => n.id === '2')).toBeUndefined();
  });

  it('should add notification', () => {
    useNotificationStore.getState().addNotification({
      id: '4',
      type: 'system',
      priority: 'critical',
      title: 'New Alert',
      body: 'Something happened',
      timestamp: new Date().toISOString(),
      read: false,
    });
    expect(useNotificationStore.getState().notifications.length).toBe(4);
    expect(useNotificationStore.getState().notifications[0].id).toBe('4');
  });

  it('should clear all', () => {
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications.length).toBe(0);
  });

  it('does not play a sound on the first notification load', async () => {
    mockInvoke('get_notifications', [
      {
        id: '10',
        type: 'system',
        priority: 'info',
        title: 'Welcome',
        body: 'Seeded from backend',
        timestamp: new Date().toISOString(),
        read: false,
      },
    ]);

    useNotificationStore.setState({ notifications: [], loaded: false });

    await useNotificationStore.getState().loadNotifications();

    expect(playSound).not.toHaveBeenCalled();
  });

  it('plays a sound once when newly unread notifications arrive after hydration', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);

    let currentNotifications: Notification[] = [
      {
        id: '20',
        type: 'system',
        priority: 'info',
        title: 'Existing',
        body: 'Already loaded',
        timestamp: new Date().toISOString(),
        read: false,
      },
    ];

    mockInvoke('get_notifications', () => currentNotifications);

    useNotificationStore.setState({
      notifications: currentNotifications,
      loaded: true,
    });

    await useNotificationStore.getState().loadNotifications();
    expect(playSound).not.toHaveBeenCalled();

    currentNotifications = [
      {
        id: '21',
        type: 'security',
        priority: 'warning',
        title: 'New incident',
        body: 'New unread notification',
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...currentNotifications,
    ];

    await useNotificationStore.getState().loadNotifications();

    expect(playSound).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it('throttles notification sounds during rapid consecutive backend updates', async () => {
    const nowSpy = vi.spyOn(Date, 'now');

    let currentNotifications: Notification[] = [
      {
        id: '30',
        type: 'system',
        priority: 'info',
        title: 'Existing',
        body: 'Already loaded',
        timestamp: new Date().toISOString(),
        read: false,
      },
    ];

    mockInvoke('get_notifications', () => currentNotifications);

    useNotificationStore.setState({
      notifications: currentNotifications,
      loaded: true,
    });

    nowSpy.mockReturnValueOnce(20_000);
    currentNotifications = [
      {
        id: '31',
        type: 'security',
        priority: 'warning',
        title: 'First incident',
        body: 'First new unread notification',
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...currentNotifications,
    ];
    await useNotificationStore.getState().loadNotifications();

    nowSpy.mockReturnValueOnce(21_000);
    currentNotifications = [
      {
        id: '32',
        type: 'security',
        priority: 'warning',
        title: 'Second incident',
        body: 'Second new unread notification',
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...currentNotifications,
    ];
    await useNotificationStore.getState().loadNotifications();

    expect(playSound).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it('falls back to local-only notification state outside Tauri', async () => {
    const originalTauriInternals = (window as typeof window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    delete (window as typeof window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;

    useNotificationStore.setState({ notifications: [], loaded: false });
    await useNotificationStore.getState().loadNotifications();
    await useNotificationStore.getState().pushNotification({
      type: 'system',
      priority: 'info',
      title: 'Preview',
      body: 'Browser shell only',
    });

    expect(useNotificationStore.getState().loaded).toBe(true);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    (window as typeof window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = originalTauriInternals;
  });
});
