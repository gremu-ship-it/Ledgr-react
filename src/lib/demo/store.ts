/**
 * Demo state: the visitor's private copy of the seeded books.
 *
 * Persistence model
 * -----------------
 * The dataset lives in `localStorage` under a versioned key. That gives a
 * demo visitor continuity (their invoices are still there after a refresh)
 * while keeping everything on their device:
 *
 *   - nothing is uploaded — there is no backend in demo mode;
 *   - two visitors never share state, so nobody can wreck anyone's tour;
 *   - the snapshot auto-resets after `DEMO_RESET_AFTER_MS`, which is the
 *     per-browser equivalent of the "nightly reset" a shared demo tenant
 *     would need, and stops storage growing forever on a shared machine;
 *   - `resetDemoData()` reseeds on demand from the demo banner.
 *
 * Storage is optional: in private-mode browsers, on SSR and in unit tests we
 * fall back to memory-only, which keeps the demo fully functional for the
 * lifetime of the page.
 *
 * This module imports the dataset generator, so it is loaded on demand (see
 * `loader.ts` and `session.ts`) rather than from the app shell.
 */

import {
  clearPersisted,
  isExpired,
  readPersisted,
  writePersisted,
  type DemoState,
} from './persistence';
import { DEMO_STATE_VERSION } from './constants';
import { buildDemoDataset, type DemoTables } from './dataset';
import { createLogger } from '@/lib/logger';

const log = createLogger('demoStore');

export type { DemoState };
export { demoMsUntilReset, persistedSeededAt as demoSeededAt } from './persistence';

let memory: DemoState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function freshState(now: Date = new Date()): DemoState {
  return { version: DEMO_STATE_VERSION, seededAt: Date.now(), tables: buildDemoDataset(now) };
}

/**
 * The live demo tables. Seeds on first call, reseeds when the persisted
 * snapshot is stale or was written by an older schema version.
 */
export function getDemoState(): DemoState {
  if (memory && !isExpired(memory)) return memory;

  const persisted = memory ? null : readPersisted();
  if (persisted && !isExpired(persisted)) {
    memory = persisted;
    return memory;
  }

  if (persisted && isExpired(persisted)) {
    log.info('Demo snapshot older than the reset window — reseeding');
  }
  memory = freshState();
  writePersisted(memory);
  return memory;
}

/** Table rows for a query, always non-null. Unknown tables read as empty. */
export function getDemoTables(): DemoTables {
  return getDemoState().tables;
}

/**
 * Queue a save. Writes are debounced because a single form save can touch a
 * header, several lines and a journal entry in quick succession.
 */
export function markDemoStateChanged(): void {
  if (!memory) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (memory) writePersisted(memory);
  }, 250);
}

/** Flush any pending write immediately (used before unload and in tests). */
export function flushDemoState(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (memory) writePersisted(memory);
}

/** Restore pristine seeded books. Returns the new seededAt timestamp. */
export function resetDemoData(): number {
  memory = freshState();
  writePersisted(memory);
  return memory.seededAt;
}

/** Drop the persisted snapshot entirely (used when leaving demo mode). */
export function clearDemoData(): void {
  memory = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  clearPersisted();
}
