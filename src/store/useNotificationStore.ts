import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from '@/store/useAppStore';

export interface AppNotification {
  id: string;
  type: 'warning' | 'error' | 'info' | 'success';
  title: string;
  message: string;
  timestamp: string;
  link?: string;           // optional navigation target
  businessId?: string | null; // tenant scope; null only for deliberately global/legacy notifications
  read: boolean;
}

type NewNotification = Omit<AppNotification, 'id' | 'timestamp' | 'read'>;

interface NotificationState {
  notifications: AppNotification[];
  addNotification: (notif: NewNotification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: (businessId?: string | null) => void;
  clearAll: (businessId?: string | null) => void;
  removeNotification: (id: string) => void;
}

function resolveBusinessId(notif: NewNotification): string | null {
  if (notif.businessId !== undefined) {
    return notif.businessId;
  }

  return useAppStore.getState().currentBusiness?.business?.id ?? null;
}

function matchesBusinessScope(notification: AppNotification, businessId: string | null): boolean {
  return (notification.businessId ?? null) === businessId;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: [],

      addNotification: (notif) => {
        const newNotif: AppNotification = {
          ...notif,
          businessId: resolveBusinessId(notif),
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          read: false,
        };
        set((state) => ({
          notifications: [newNotif, ...state.notifications].slice(0, 50), // keep latest 50
        }));
      },

      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        })),

      markAllAsRead: (businessId) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            businessId === undefined || matchesBusinessScope(n, businessId)
              ? { ...n, read: true }
              : n
          ),
        })),

      clearAll: (businessId) =>
        set((state) => ({
          notifications:
            businessId === undefined
              ? []
              : state.notifications.filter((n) => !matchesBusinessScope(n, businessId)),
        })),

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
    }),
    {
      name: 'ledgr-notifications',
      partialize: (state) => ({ notifications: state.notifications }),
    }
  )
);
