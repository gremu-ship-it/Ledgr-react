import Dexie, { type EntityTable } from 'dexie';
import type { QueuePayloadFor } from './payloads';

/**
 * The seven financial write operations that must work offline, per the
 * Ledgr modules they belong to. Each maps to a specific repository method
 * that will be called once the item syncs.
 *
 * Note on 'income': there is no standalone income-recording repository
 * method in the live DAL — income is recorded as a sales invoice via
 * `InvoiceRepository.createWithLines`. The queue type 'income' therefore
 * targets the same sync handler as 'invoice', distinguished only for UI/
 * labelling purposes (so the offline banner can say "2 income entries,
 * 1 invoice" etc. if desired).
 */
export type QueueOperationType =
  | 'income'            // sales invoice (invoice_type = 'invoice') recorded as income
  | 'expense'
  | 'invoice'
  | 'invoice_payment'
  | 'expense_payment'
  | 'payroll_run'
  | 'stock_movement'
  | 'pos_sale';         // a full POS till sale: invoice + lines + payments + stock + shift

export type QueueItemStatus =
  | 'pending'    // waiting to sync
  | 'syncing'    // currently being sent to Supabase
  | 'synced'     // successfully written
  | 'failed'     // sync attempted and failed (see lastError)
  | 'quarantined'; // R09.2: held out of ALL replay paths pending assisted
                   // recovery (see quarantineReason). Durable: survives
                   // reload, never touched by the background sync loop.

/**
 * R09.2 (D-1): why an item was taken out of the replay path.
 *  - 'actor-mismatch'      — trustworthy origin differs from the currently
 *                            authenticated actor (Case B: DENY + quarantine).
 *  - 'missing-provenance'  — no trustworthy origin evidence (legacy v1 rows,
 *                            forged/stripped rows). Case C.
 *  - 'legacy'              — originated in the retired localStorage POS queue
 *                            or an old-build stub; accepted financial evidence
 *                            with unknown actor (§5).
 */
export type QuarantineReason = 'actor-mismatch' | 'missing-provenance' | 'legacy';

/**
 * R09.2 cross-tab replay lease metadata (see ./lease.ts). The lease is the
 * OWNED, browser-visible lock: an in-memory ref cannot coordinate two tabs.
 * The claimant token identifies an install+tab pair, never a user alone.
 */
export interface QueueLease {
  /** Random unique token for THIS acquisition (changes on every claim). */
  token: string;
  /** install:tab claimant identifier that took the lease. */
  claimant: string;
  /** ISO timestamp after which another tab may reclaim the item. */
  expiresAt: string;
}

/**
 * A single queued offline write operation.
 *
 * Dependency model: some operations are naturally parent-child — e.g. an
 * `invoice_payment` queued against an `invoice` that was itself created
 * offline and hasn't synced yet. `dependsOnLocalId` points at the
 * `localId` of the parent queue item. The sync engine processes items in
 * `sequence` order, but will defer (re-queue) any item whose
 * `dependsOnLocalId` hasn't reached `status: 'synced'` yet, and will
 * rewrite the dependent payload's foreign key once the parent's real
 * (server-generated) id is known — see `resolvedServerId` on the parent
 * and `dependentFkField` here.
 */
export interface QueueItem {
  /** Auto-incrementing local primary key — also used as the dependency anchor. */
  localId?: number;

  /** Monotonically increasing counter that preserves creation order across
   *  all operation types, independent of `localId` reuse after cleanup. */
  sequence: number;

  operationType: QueueOperationType;

  status: QueueItemStatus;

  /**
   * The tenant this record belongs to. Always present so that, even if the
   * user switches businesses while offline, each queued item syncs into
   * the correct tenant rather than whichever business happens to be
   * "current" at sync time.
   */
  businessId: string;

  /**
   * The payload to send to the repository's create/record method. Shape
   * is determined by `operationType` via the discriminated union in
   * `QueuePayloadFor` (see ./payloads.ts).
   */
  payload: QueuePayloadFor<QueueOperationType>;

  /** If this item depends on another queued item's server-generated id. */
  dependsOnLocalId?: number;

  /**
   * Which field in `payload` must be rewritten with the parent's real
   * server id once the parent syncs (e.g. 'invoice_id', 'expense_id').
   * Required if `dependsOnLocalId` is set.
   */
  dependentFkField?: string;

  /** Set once this item itself syncs successfully — lets children resolve their FK. */
  resolvedServerId?: string;

  /**
   * Stable idempotency key generated once at enqueue time and passed through
   * to the server insert. Lets a retried sync detect that the record already
   * exists (server committed but the local 'synced' mark was lost) instead of
   * creating a duplicate. Backed by a unique (business_id, client_key) index.
   */
  clientKey?: string;

  /** Client-side timestamp of when the user performed the action (ISO string). */
  createdAt: string;

  /* ── R09.2 provenance (evidence only — NEVER an authorization credential) ── */

  /** Payload schema version written at enqueue (see QUEUE_PAYLOAD_VERSION). */
  payloadVersion?: number | null;

  /**
   * `auth.users.id` of the session that captured this operation. Evidence
   * only: replay re-derives the real actor from the server session; this
   * field decides only whether the item may LEAVE for the server at all
   * (same actor) or must be quarantined (different/unknown actor).
   */
  originUserId?: string | null;

  /** Stable per-install device identifier present when the op was captured. */
  originDeviceId?: string | null;

  /** ISO capture timestamp recorded at enqueue (never re-imputed later). */
  capturedAt?: string | null;

  /** Business/branch/terminal/shift context recorded where available. */
  branchId?: string | null;
  shiftId?: string | null;
  terminalId?: string | null;

  /* ── R09.2 quarantine metadata ── */

  quarantineReason?: QuarantineReason | null;
  quarantinedAt?: string | null;
  /** Short human-safe detail shown in the drawer (no payload contents). */
  quarantineDetails?: string | null;

  /* ── R09.2 cross-tab lease ── */

  lease?: QueueLease | null;

  /** Last sync attempt timestamp, if any. */
  lastAttemptAt?: string;

  /** Number of sync attempts so far — used for backoff / giving up. */
  attemptCount: number;

  /** Human-readable error from the last failed attempt, if any. */
  lastError?: string;

  /**
   * For conflict resolution on tables that have `updated_at` (invoices,
   * expenses, payroll_runs): the timestamp the user last modified this
   * record on this device, used for last-write-wins comparison against
   * the server's `updated_at` if the same record was also edited elsewhere.
   * Not used for append-only tables (invoice_payments, expense_payments,
   * stock_movements) since those have no `updated_at` column and are
   * insert-only by schema design — there is no conflict to resolve.
   */
  localUpdatedAt?: string;
}

/**
 * A short human label per operation type, used by the sync progress UI
 * ("Syncing 3 invoices, 1 payroll run...").
 */
export const QUEUE_TYPE_LABELS: Record<QueueOperationType, string> = {
  income: 'income entry',
  expense: 'expense',
  invoice: 'invoice',
  invoice_payment: 'invoice payment',
  expense_payment: 'expense payment',
  payroll_run: 'payroll run',
  stock_movement: 'stock movement',
  pos_sale: 'POS sale',
};

class LedgrOfflineDB extends Dexie {
  queue!: EntityTable<QueueItem, 'localId'>;

  constructor() {
    super('ledgr-offline');

    this.version(1).stores({
      // Indexes: sequence (ordering), status (filtering pending/failed),
      // businessId (tenant scoping), dependsOnLocalId (dependency lookups).
      queue: '++localId, sequence, status, businessId, dependsOnLocalId, operationType',
    });

    // R09.2 v2: provenance/quarantine/lease fields. Indexes are unchanged
    // (additive, lossless); the upgrade populates ONLY-defensive defaults and
    // never fabricates provenance: v1 rows keep payloadVersion/origin* as
    // null, which the sync engine treats as "unverifiable" (Case C →
    // quarantine). Dexie applies the upgrade atomically; re-running it on a
    // partially upgraded store is idempotent because defaults are only
    // written where a field is still undefined.
    this.version(2)
      .stores({
        queue: '++localId, sequence, status, businessId, dependsOnLocalId, operationType',
      })
      .upgrade(async (tx) => {
        await tx
          .table('queue')
          .toCollection()
          .modify((item: QueueItem) => {
            if (item.payloadVersion === undefined) item.payloadVersion = null;
            if (item.originUserId === undefined) item.originUserId = null;
            if (item.originDeviceId === undefined) item.originDeviceId = null;
            if (item.capturedAt === undefined) item.capturedAt = null;
            if (item.branchId === undefined) item.branchId = null;
            if (item.shiftId === undefined) item.shiftId = null;
            if (item.terminalId === undefined) item.terminalId = null;
            if (item.quarantineReason === undefined) item.quarantineReason = null;
            if (item.quarantinedAt === undefined) item.quarantinedAt = null;
            if (item.quarantineDetails === undefined) item.quarantineDetails = null;
            if (item.lease === undefined) item.lease = null;
          });
      });
  }
}

export const offlineDB = new LedgrOfflineDB();