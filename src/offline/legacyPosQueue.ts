import { createLogger } from '@/lib/logger';
import type { PosSalePayload } from '@/types/pos';
import { buildPosSaleQueuePayload } from '@/services/posService';
import { offlineDB, type QueueItem } from './db';
import type { PosSaleQueuePayload } from './payloads';

export const LEGACY_QUARANTINE_DETAILS =
  'Captured by the retired localStorage POS queue, which records no trustworthy original actor. ' +
  'Preserved as accepted financial evidence and held for assisted recovery — never automatically replayed or attributed to the current user.';

/**
 * R09.2 §5: place a converted legacy sale straight into the security
 * quarantine with provenance deliberately ABSENT (nothing is fabricated).
 * Written here rather than via `enqueue` so no capture-time provenance can
 * be invented by whoever happens to be signed in when the migration runs.
 */
export async function enqueueQuarantinedLegacy(
  businessId: string,
  payload: PosSaleQueuePayload,
  createdAt?: string,
): Promise<number> {
  const last = await offlineDB.queue.orderBy('sequence').last();
  const sequence = (last?.sequence ?? 0) + 1;
  const item: QueueItem = {
    sequence,
    operationType: 'pos_sale',
    status: 'quarantined',
    quarantineReason: 'legacy',
    quarantinedAt: new Date().toISOString(),
    quarantineDetails: LEGACY_QUARANTINE_DETAILS,
    businessId,
    payload,
    createdAt: createdAt ?? new Date().toISOString(),
    attemptCount: 0,
    clientKey: crypto.randomUUID(),
    // No provenance — explicit nulls, never fabricated: unknown origin is
    // the whole point of quarantine (Case C).
    payloadVersion: null,
    originUserId: null,
    originDeviceId: null,
    capturedAt: null,
    branchId: null,
    shiftId: null,
    terminalId: null,
    lease: null,
  };
  return (await offlineDB.queue.add(item)) as number;
}

const log = createLogger('LegacyPosQueue');

/**
 * The POS module used to keep its own offline queue in `localStorage`, written
 * by `posService` and read by the POS screen alone. Nothing else in the app
 * could see those sales: they never appeared in the offline drawer's counts,
 * never ran through the sync engine's retry/backoff, and a failure was recorded
 * with a `console.warn` on a device nobody was looking at.
 *
 * This module retires that store — into QUARANTINE (R09.2 §5):
 *
 *   1. Entries still sitting in localStorage are converted into real
 *      `pos_sale` queue items, but placed straight into the security
 *      quarantine: the legacy store carries NO trustworthy original-actor
 *      evidence, so these sales may never be silently attributed to, or
 *      replayed as, whichever user is signed in now. They are accepted
 *      financial evidence — payloads preserved verbatim for assisted recovery.
 *   2. The stubs the old code wrote into the canonical queue likewise become
 *      quarantined legacy items (repaired with the localStorage details where
 *      available), never ordinary 'pending'.
 */
export const LEGACY_POS_QUEUE_KEY = 'ledgr_pos_offline_queue';

/** One entry of the retired `localStorage` POS queue. */
export interface LegacyPosQueueEntry {
  offlineNum?: string;
  receiptNumber?: string;
  payload: PosSalePayload;
  queuedAt?: string;
}

/** The summary shape the old code wrote into the canonical queue. */
interface PosSaleStubPayload {
  notes?: string;
  items: unknown[];
  receiptNumber: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * True for the `income` payload shape the retired POS code queued: a summary
 * of the sale (receipt number + line items) with no invoice and no lines. The
 * sync engine's income handler reads `payload.invoice`/`payload.lines`, so such
 * an item is guaranteed to fail on every attempt.
 */
export function isPosSaleStubPayload(payload: unknown): payload is PosSaleStubPayload {
  const record = asRecord(payload);
  if (!record) return false;
  if ('invoice' in record || 'lines' in record) return false;
  return Array.isArray(record.items) && typeof record.receiptNumber === 'string';
}

/** Reads the retired localStorage queue, tolerating junk left by older builds. */
export function readLegacyPosQueue(): LegacyPosQueueEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];

  try {
    const raw = window.localStorage.getItem(LEGACY_POS_QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is LegacyPosQueueEntry => {
      const record = asRecord(entry);
      const payload = asRecord(record?.payload);
      return Boolean(payload && Array.isArray(payload.items) && payload.items.length > 0);
    });
  } catch (err) {
    log.warn('Could not read the retired POS offline queue', { error: err });
    return [];
  }
}

function writeLegacyPosQueue(entries: LegacyPosQueueEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(LEGACY_POS_QUEUE_KEY);
      return;
    }
    window.localStorage.setItem(LEGACY_POS_QUEUE_KEY, JSON.stringify(entries));
  } catch (err) {
    log.warn('Could not update the retired POS offline queue', { error: err });
  }
}

/**
 * Converts one retired entry into a `pos_sale` payload. The receipt number and
 * the offline document number are carried across verbatim so the receipt the
 * customer holds still matches the record that eventually syncs.
 */
export function legacyEntryToQueuePayload(entry: LegacyPosQueueEntry): PosSaleQueuePayload {
  return buildPosSaleQueuePayload(entry.payload, {
    receiptNumber: entry.receiptNumber,
    invoiceNumber: entry.offlineNum,
  });
}

export interface LegacyPosQueueMigration {
  /** Retired entries converted into queue items. */
  migrated: number;
  /** Broken queue stubs rewritten in place into real POS sale items. */
  repaired: number;
  /** Stubs that had no recoverable sale data and were marked as needing attention. */
  flagged: number;
  /** Entries that were not usable at all and have been dropped. */
  discarded: number;
}

const EMPTY_MIGRATION: LegacyPosQueueMigration = {
  migrated: 0,
  repaired: 0,
  flagged: 0,
  discarded: 0,
};

/**
 * One-time reconciliation of the retired POS queue. Safe to call on every
 * mount: with nothing left to move it reads two stores and returns.
 */
export async function migrateLegacyPosQueue(): Promise<LegacyPosQueueMigration> {
  const stubItems = await findPosSaleStubs().catch(() => [] as QueueItem[]);
  const legacyEntries = readLegacyPosQueue();
  if (stubItems.length === 0 && legacyEntries.length === 0) return { ...EMPTY_MIGRATION };

  const summary: LegacyPosQueueMigration = { ...EMPTY_MIGRATION };
  const remaining = [...legacyEntries];

  // 1. Repair the stubs whose sale details are still in localStorage. Matching
  //    by receipt number is what ties the two stores together.
  for (const item of stubItems) {
    const stub = item.payload as unknown as PosSaleStubPayload;
    const index = remaining.findIndex((entry) => entry.receiptNumber === stub.receiptNumber);

    if (index === -1) {
      await offlineDB.queue.update(item.localId!, {
        status: 'quarantined',
        quarantineReason: 'legacy',
        quarantinedAt: new Date().toISOString(),
        attemptCount: 0,
        lastError:
          `Queued by an older POS build with only a receipt summary attached (receipt ${stub.receiptNumber}); ` +
          'the sale details are not on this device, so it cannot be synced. Re-enter the sale if it is missing from your books, or discard this item.',
        quarantineDetails:
          'Old-build stub without the sale details on this device. ' + LEGACY_QUARANTINE_DETAILS,
      });
      summary.flagged += 1;
      continue;
    }

    try {
      const payload = legacyEntryToQueuePayload(remaining[index]);
      // `lastError: undefined` clears the property (Dexie deletes undefined
      // values), so a repaired item does not keep the old failure text.
      const changes: Partial<QueueItem> = {
        operationType: 'pos_sale',
        payload,
        // R09.2 §5: repaired from a legacy store => quarantine, never replay.
        status: 'quarantined',
        quarantineReason: 'legacy',
        quarantinedAt: new Date().toISOString(),
        quarantineDetails: LEGACY_QUARANTINE_DETAILS,
        attemptCount: 0,
        lastError: undefined,
      };
      await offlineDB.queue.update(item.localId!, changes);
      remaining.splice(index, 1);
      summary.repaired += 1;
    } catch (err) {
      log.warn('Could not repair a queued POS sale stub', { error: err, receiptNumber: stub.receiptNumber });
    }
  }

  // 2. Move anything left over into the canonical queue, oldest first so the
  //    queue's sequence keeps the order the sales were taken in.
  const stillPending: LegacyPosQueueEntry[] = [];
  for (const entry of remaining) {
    const businessId = entry.payload?.businessId || entry.payload?.business_id;
    if (!businessId) {
      summary.discarded += 1;
      continue;
    }

    try {
      // R09.2 §5: writes go through the quarantined enqueue path — never a
      // replayable pending item, never attributed to the current session.
      await enqueueQuarantinedLegacy(
        businessId,
        legacyEntryToQueuePayload(entry),
        entry.queuedAt,
      );
      summary.migrated += 1;
    } catch (err) {
      // Most likely a full queue (see MAX_PENDING_QUEUE_ITEMS). Keep the entry
      // where it is so the next launch retries rather than losing the sale.
      log.warn('Could not migrate a retired POS offline sale', { error: err });
      stillPending.push(entry);
    }
  }

  writeLegacyPosQueue(stillPending);

  return summary;
}

async function findPosSaleStubs(): Promise<QueueItem[]> {
  const incomeItems = await offlineDB.queue.where('operationType').equals('income').toArray();
  return incomeItems.filter(
    (item) => item.status !== 'synced' && isPosSaleStubPayload(item.payload),
  );
}
