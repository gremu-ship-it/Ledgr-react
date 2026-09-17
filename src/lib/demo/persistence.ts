/**
 * Reading and writing the persisted demo snapshot — without the dataset.
 *
 * `store.ts` owns the live snapshot and therefore imports `dataset.ts` (the
 * seeded books, the chart of accounts, the whole generator: ~33 kB gzipped).
 * Chrome that only needs to *describe* the snapshot — the banner's
 * "resets in 3h 12m" countdown — must not drag that into the main bundle for
 * every visitor, so the storage plumbing lives here and both sides share it.
 */

import { DEMO_RESET_AFTER_MS, DEMO_STATE_VERSION, demoStateStorageKey } from './constants';
import type { DemoTables } from './dataset';
import { createLogger } from '@/lib/logger';

const log = createLogger('demoPersistence');

export interface DemoState {
  /** Schema version of the persisted snapshot — mismatches trigger a reseed. */
  version: number;
  /** Epoch ms when this snapshot was seeded. Drives the auto-reset. */
  seededAt: number;
  tables: DemoTables;
}

export function hasDemoStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** The persisted snapshot, or null when absent, unreadable or from an older schema. */
export function readPersisted(): DemoState | null {
  if (!hasDemoStorage()) return null;
  try {
    const raw = window.localStorage.getItem(demoStateStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState;
    if (
      !parsed ||
      parsed.version !== DEMO_STATE_VERSION ||
      typeof parsed.seededAt !== 'number' ||
      !parsed.tables ||
      typeof parsed.tables !== 'object'
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn('Could not read persisted demo state — reseeding', { error: err });
    return null;
  }
}

export function writePersisted(state: DemoState): void {
  if (!hasDemoStorage()) return;
  try {
    window.localStorage.setItem(demoStateStorageKey(), JSON.stringify(state));
  } catch (err) {
    // Quota exceeded / storage disabled: keep going in memory only. The demo
    // still works for this page load, it just won't survive a refresh.
    log.warn('Could not persist demo state (storage unavailable or full)', { error: err });
  }
}

export function clearPersisted(): void {
  if (!hasDemoStorage()) return;
  try {
    window.localStorage.removeItem(demoStateStorageKey());
  } catch (err) {
    log.warn('Could not clear persisted demo state', { error: err });
  }
}

export function isExpired(state: DemoState): boolean {
  return Date.now() - state.seededAt > DEMO_RESET_AFTER_MS;
}

/**
 * When the persisted snapshot was seeded, read straight from storage.
 *
 * Deliberately does not seed: the banner asks this on every render tick, and
 * building the dataset to answer a countdown would be absurd. When there is no
 * snapshot yet (first paint before seeding finishes) the full window is
 * reported, which is the honest answer — nothing has been seeded to reset.
 */
export function persistedSeededAt(): number {
  const persisted = readPersisted();
  return persisted?.seededAt ?? Date.now();
}

/** ms until the snapshot auto-resets (never negative). */
export function demoMsUntilReset(): number {
  return Math.max(0, DEMO_RESET_AFTER_MS - (Date.now() - persistedSeededAt()));
}
