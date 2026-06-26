import { create } from 'zustand';
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
  setCurrentBusiness: (membership: BusinessMembership | null) => void;
  setBusinesses: (memberships: BusinessMembership[]) => void;
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

const THEME_STORAGE_KEY = 'ledgr-theme';
const SIDEBAR_STORAGE_KEY = 'ledgr-sidebar-open';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  isAuthLoading: true,
  setCurrentUser: (user) => set({ currentUser: user }),
  setAuthLoading: (loading) => set({ isAuthLoading: loading }),

  currentBusiness: null,
  businesses: [],
  setCurrentBusiness: (membership) => set({ currentBusiness: membership }),
  setBusinesses: (memberships) => set({ businesses: memberships }),
  switchBusiness: (businessId) => {
    const found = get().businesses.find((m) => m.business.id === businessId);
    if (found) set({ currentBusiness: found });
  },

  sidebarOpen: getInitialSidebarOpen(),
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarOpen;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return { sidebarOpen: next };
    }),
  setSidebarOpen: (open) => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
    set({ sidebarOpen: open });
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

  reset: () =>
    set({
      currentUser: null,
      currentBusiness: null,
      businesses: [],
    }),
}));