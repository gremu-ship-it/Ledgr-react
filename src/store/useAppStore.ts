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
  sidebarWidth: number; // px, 200-360, only when open
  density: 'comfortable' | 'compact';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setDensity: (d: 'comfortable' | 'compact') => void;

  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // ── Inactivity timeout (minutes) ────────────────────────────────
  inactivityTimeoutMinutes: number; // default 60
  setInactivityTimeoutMinutes: (minutes: number) => void;

  // ── Orientation lock (optional rotation control) ────────────────
  orientationLock: boolean;
  setOrientationLock: (v: boolean) => void;

  // ── Reset (on logout) ───────────────────────────────────────────
  reset: () => void;
}

const THEME_STORAGE_KEY   = 'ledgr-theme';
const SIDEBAR_STORAGE_KEY = 'ledgr-sidebar-open';
const SIDEBAR_WIDTH_KEY   = 'ledgr-sidebar-width';
const DENSITY_KEY         = 'ledgr-density';
const ORIENTATION_LOCK_KEY = 'ledgr-orientation-lock';

function getInitialSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.innerWidth < 1024) return false;
  const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

function getInitialSidebarWidth(): number {
  if (typeof window === 'undefined') return 256;
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!stored || isNaN(stored)) return 256;
  return Math.min(360, Math.max(200, stored));
}

function getInitialDensity(): 'comfortable' | 'compact' {
  if (typeof window === 'undefined') return 'comfortable';
  const stored = window.localStorage.getItem(DENSITY_KEY);
  return stored === 'compact' ? 'compact' : 'comfortable';
}

function getInitialOrientationLock(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ORIENTATION_LOCK_KEY) === 'true';
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
      sidebarWidth: getInitialSidebarWidth(),
      density: getInitialDensity(),
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
      setSidebarWidth: (w) => {
        const clamped = Math.min(360, Math.max(200, Math.round(w)));
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
        set({ sidebarWidth: clamped });
      },
      setDensity: (d) => {
        window.localStorage.setItem(DENSITY_KEY, d);
        set({ density: d });
      },

      theme: getInitialTheme(),
      setTheme: (theme) => {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        set({ theme });
      },
      toggleTheme: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        get().setTheme(next);
      },

      inactivityTimeoutMinutes: 60,
      setInactivityTimeoutMinutes: (minutes) => set({ inactivityTimeoutMinutes: minutes }),

      orientationLock: getInitialOrientationLock(),
      setOrientationLock: (v) => {
        window.localStorage.setItem(ORIENTATION_LOCK_KEY, String(v));
        set({ orientationLock: v });
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
        sidebarWidth: state.sidebarWidth,
        density: state.density,
        orientationLock: state.orientationLock,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          document.documentElement.classList.toggle('dark', state.theme === 'dark');
        }
      },
    },
  ),
);
