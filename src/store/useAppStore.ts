import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrentUser, BusinessMembership, Theme } from '@/types';

interface AppState {
  // ── Auth / session ──────────────────────────────────────────────
  currentUser: CurrentUser | null;
  isAuthLoading: boolean;
  setCurrentUser: (user: CurrentUser | null) => void;
  setAuthLoading: (loading: boolean) => void;

  // ── Business switching ──────────────────────────────────────────
  currentBusiness: BusinessMembership | null;
  businesses: BusinessMembership[];
  isBusinessesLoading: boolean;
  setCurrentBusiness: (membership: BusinessMembership | null) => void;
  setBusinesses: (memberships: BusinessMembership[]) => void;
  setBusinessesLoading: (loading: boolean) => void;
  switchBusiness: (businessId: string) => void;

  // ── UI state ─────────────────────────────────────────────────────
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // ── Reset (on logout) ───────────────────────────────────────────
  reset: () => void;
}

const THEME_STORAGE_KEY   = 'ledgr-theme';
const SIDEBAR_STORAGE_KEY = 'ledgr-sidebar-open';

function getInitialSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.innerWidth < 1024) return false;
  const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.documentElement.style.colorScheme = t;
  try { localStorage.setItem(THEME_STORAGE_KEY, t); } catch { /* ignore */ }
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      isAuthLoading: true,
      setCurrentUser: (user) => set({ currentUser: user }),
      setAuthLoading: (loading) => set({ isAuthLoading: loading }),

      currentBusiness: null,
      businesses: [],
      isBusinessesLoading: true,
      setCurrentBusiness: (membership) => set({ currentBusiness: membership }),
      setBusinesses: (memberships) => set({ businesses: memberships }),
      setBusinessesLoading: (loading) => set({ isBusinessesLoading: loading }),
      switchBusiness: (businessId) => {
        const found = get().businesses.find((m) => m.business.id === businessId);
        if (found) set({ currentBusiness: found });
      },

      sidebarOpen: getInitialSidebarOpen(),
      toggleSidebar: () =>
        set((state) => {
          const next = !state.sidebarOpen;
          if (window.innerWidth >= 1024) {
            window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
          }
          return { sidebarOpen: next };
        }),
      setSidebarOpen: (open) => {
        if (window.innerWidth >= 1024) {
          window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
        }
        set({ sidebarOpen: open });
      },

      theme: getInitialTheme(),
      setTheme: (t) => { applyTheme(t); set({ theme: t }); },
      toggleTheme: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        applyTheme(next); set({ theme: next });
      },

      reset: () =>
        set({
          currentUser: null,
          currentBusiness: null,
          businesses: [],
          isBusinessesLoading: true,
        }),
    }),
    {
      name: 'ledgr-app-store',
      partialize: (state) => ({
        theme: state.theme,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.classList.toggle('dark', state.theme === 'dark');
          document.documentElement.style.colorScheme = state.theme;
        }
      },
    },
  ),
);

export function initTheme() {
  applyTheme(useAppStore.getState().theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_STORAGE_KEY)) {
      useAppStore.getState().setTheme(e.matches ? 'dark' : 'light');
    }
  });
}
