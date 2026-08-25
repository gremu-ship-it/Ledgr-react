import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from '@/store/useAppStore';
import { notificationMatchesContext } from '@/lib/notificationScope';

export interface AppNotification {
  id: string;
  type: 'warning' | 'error' | 'info' | 'success';
  title: string;
  message: string;
  timestamp: string;
  link?: string;
  /** Tenant scope. Null is reserved for deliberately global notifications. */
  businessId?: string | null;
  /** Auth identity that created the notification. Required for signed-in data. */
  userId: string | null;
  /** Optional branch scope for future branch-specific notifications. */
  branchId?: string | null;
  read: boolean;
}

type NewNotification = Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'userId'> & {
  userId?: string | null;
};

interface NotificationState {
  notifications: AppNotification[];
  addNotification: (notif: NewNotification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: (businessId?: string | null, userId?: string | null) => void;
  clearAll: (businessId?: string | null, userId?: string | null) => void;
  removeNotification: (id: string) => void;
}

function resolveBusinessId(notif: NewNotification): string | null {
  if (notif.businessId !== undefined) return notif.businessId;
  return useAppStore.getState().currentBusiness?.business?.id ?? null;
}

function resolveUserId(notif: NewNotification): string | null {
  if (notif.userId !== undefined) return notif.userId;
  return useAppStore.getState().currentUser?.id ?? null;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: [],

      addNotification: (notif) => {
        const newNotif: AppNotification = {
          ...notif,
          businessId: resolveBusinessId(notif),
          userId: resolveUserId(notif),
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          read: false,
        };
        set((state) => ({
          notifications: [newNotif, ...state.notifications].slice(0, 50),
        }));
      },

      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      markAllAsRead: (businessId, userId) =>
        set((state) => ({
          notifications: state.notifications.map((n) =>
            businessId === undefined || notificationMatchesContext(n, businessId, userId ?? null)
              ? { ...n, read: true }
              : n,
          ),
        })),

      clearAll: (businessId, userId) =>
        set((state) => ({
          notifications:
            businessId === undefined
              ? []
              : state.notifications.filter(
                  (n) => !notificationMatchesContext(n, businessId, userId ?? null),
                ),
        })),

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
    }),
    {
      name: 'ledgr-notifications',
      version: 2,
      partialize: (state) => ({ notifications: state.notifications }),
      // Version 1 records had no user identity and cannot be safely attributed.
      migrate: () => ({ notifications: [] }),
    },
  ),
);
