import Dexie, { type EntityTable } from 'dexie';

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
  | 'stock_movement';

export type QueueItemStatus =
  | 'pending'   // waiting to sync
  | 'syncing'   // currently being sent to Supabase
  | 'synced'    // successfully written
  | 'failed';   // sync attempted and failed (see lastError)

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
   * depends on `operationType` — see `OfflinePayloads` in payloads.ts for
   * the exact discriminated union.
   */
  payload: unknown;

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

  /** Client-side timestamp of when the user performed the action (ISO string). */
  createdAt: string;

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
  }
}

export const offlineDB = new LedgrOfflineDB();