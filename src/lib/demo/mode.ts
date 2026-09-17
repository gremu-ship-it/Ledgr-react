/**
 * The demo-mode flag: one boolean, one storage key, zero dependencies.
 *
 * This module is intentionally dependency-free because `src/lib/supabase.ts`
 * reads it on every call to decide whether to serve the real client or the
 * demo client, and a cycle back into the app store / query cache there would
 * be fragile. Keep it that way.
 *
 * The flag lives in `localStorage` (not `sessionStorage`) so a visitor who
 * opens the demo, browses the marketing site in another tab and comes back is
 * still in the demo. It is origin-scoped by the browser, so a demo flag set on
 * the app domain can never affect another deployment.
 */

import { DEMO_MODE_KEY } from './constants';

type Listener = () => void;

const listeners = new Set<Listener>();
let cached: boolean | null = null;

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function read(): boolean {
  if (!hasStorage()) return false;
  try {
    return window.localStorage.getItem(DEMO_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Synchronous, safe to call from anywhere (including render). */
export function isDemoMode(): boolean {
  if (cached === null) cached = read();
  return cached;
}

/** Snapshot getter for `useSyncExternalStore`. */
export function getDemoModeSnapshot(): boolean {
  return isDemoMode();
}

/** Server snapshot — demo mode is always off during SSR. */
export function getDemoModeServerSnapshot(): boolean {
  return false;
}

export function subscribeDemoMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDemoMode(on: boolean): void {
  cached = on;
  if (hasStorage()) {
    try {
      if (on) window.localStorage.setItem(DEMO_MODE_KEY, '1');
      else window.localStorage.removeItem(DEMO_MODE_KEY);
    } catch {
      // Storage blocked (private mode): the in-memory flag still works for
      // this page load, so the demo remains usable.
    }
  }
  for (const listener of [...listeners]) listener();
}
