/**
 * R09.2 provenance — capture, verification, quarantine.
 *
 * Provenance is EVIDENCE ONLY (§3): it is written at enqueue time from the
 * app session context and is consulted at replay time to decide whether an
 * item may LEAVE the device at all for the currently authenticated actor.
 * It never grants authority: the server re-derives the actor from the live
 * session (`auth.uid()`) and enforces membership/role/branch/terminal/shift
 * exactly as before. Editing `originUserId` in IndexedDB can only make an
 * item LESS replayable (it will mismatch more users), never more powerful.
 */
import { offlineDB, type QueueItem, type QuarantineReason, type QueueOperationType } from './db';
import { getInstallId } from './deviceIdentity';
import { createLogger } from '@/lib/logger';

const log = createLogger('QueueProvenance');

/** Current payload schema version recorded on every new queue item. */
export const QUEUE_PAYLOAD_VERSION = 1;

export interface CapturedProvenance {
  originUserId: string | null;
  originDeviceId: string | null;
  capturedAt: string;
  payloadVersion: number;
}

/**
 * Provenance at enqueue time. `captureUserId` is the authenticated app user
 * id at capture (from the hydrated app session — never fabricated: when the
 * caller cannot supply one, originUserId is null and the item will be
 * treated as unverifiable at replay, i.e. quarantine).
 */
export function buildProvenance(captureUserId: string | null | undefined): CapturedProvenance {
  return {
    originUserId: captureUserId ?? null,
    originDeviceId: getInstallId(),
    capturedAt: new Date().toISOString(),
    payloadVersion: QUEUE_PAYLOAD_VERSION,
  };
}

/**
 * Context recorded where already present in the well-known payload shapes
 * (§2: business/branch/terminal/shift "where available" — nothing invented;
 * a payload that carries no branch context simply records null).
 */
export interface CapturedContext {
  branchId: string | null;
  shiftId: string | null;
  terminalId: string | null;
}

export function captureContext(
  operationType: QueueOperationType,
  payload: unknown,
): CapturedContext {
  const ctx: CapturedContext = { branchId: null, shiftId: null, terminalId: null };
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!record) return ctx;

  // Branch context: present on document payloads (invoice/expense headers).
  const invoice = record.invoice as { branch_id?: string | null } | undefined;
  const expense = record.expense as { branch_id?: string | null } | undefined;
  ctx.branchId = invoice?.branch_id ?? expense?.branch_id ?? null;

  if (operationType === 'pos_sale') {
    const shiftId = (record as { shiftId?: string | null }).shiftId;
    ctx.shiftId = shiftId ?? null;
    const terminalId = (record as { terminalId?: string | null; terminal_id?: string | null });
    ctx.terminalId = terminalId.terminalId ?? terminalId.terminal_id ?? null;
  }
  return ctx;
}

/** v2 provenance present and internally complete enough to trust. */
export function hasTrustworthyProvenance(item: QueueItem): boolean {
  return Boolean(
    item.payloadVersion != null &&
      typeof item.originUserId === 'string' &&
      item.originUserId.length > 0 &&
      typeof item.capturedAt === 'string' &&
      item.capturedAt.length > 0,
  );
}

/**
 * Item-level replay gate (§4). Pure: returns the quarantine reason when the
 * item must NOT be sent to the server, or null when it may enter the normal
 * replay path (where full server authorization still applies).
 *
 * Callers must only consult this once the self actor IS known (the sync
 * engine resolves the session user first; when unknown it replays nothing
 * and mutates no provenance-bearing item — fail closed).
 */
export function replayViolation(item: QueueItem, currentUserId: string): QuarantineReason | null {
  if (!hasTrustworthyProvenance(item)) return 'missing-provenance';
  if (item.originUserId !== currentUserId) return 'actor-mismatch';
  return null;
}

/**
 * Move one item into durable quarantine — evidence is preserved, only
 * status/quarantine metadata changes. Financial document payloads are never
 * mutated here.
 */
export async function quarantineItem(
  localId: number,
  reason: QuarantineReason,
  details: string,
): Promise<void> {
  await offlineDB.queue.update(localId, {
    status: 'quarantined',
    quarantineReason: reason,
    quarantinedAt: new Date().toISOString(),
    quarantineDetails: details,
    // Drop any lease a dying tab left behind: a quarantined item must not
    // hold an indefinitely unusable lock (§18).
    lease: null,
  });
}

export interface QuarantineSweepResult {
  actorMismatch: number;
  missingProvenance: number;
}

/**
 * Deterministic pre-flight sweep at the start of every sync pass: every
 * item the normal loop would select is vetted BEFORE any network replay.
 *
 * Fail-closed (§4B/§4C and §10): items that fail the gate are quarantined
 * (visible, durable, never retried by the background loop). Items that pass
 * Case A keep their status untouched. When the self actor is unknown,
 * PROVENANCE-BEARING items are simply not replayed this pass (no mutation —
 * a legitimate signed-out transient must not vandalize evidence); items
 * with missing provenance are still quarantined, since they can never be
 * replayed by anyone.
 */
export async function sweepUnverifiableItems(
  currentUserId: string | null,
): Promise<QuarantineSweepResult> {
  const candidates = await offlineDB.queue
    .where('status')
    .anyOf('pending', 'failed')
    .toArray();

  const result: QuarantineSweepResult = { actorMismatch: 0, missingProvenance: 0 };
  for (const item of candidates) {
    if (!hasTrustworthyProvenance(item)) {
      await quarantineItem(
        item.localId!,
        'missing-provenance',
        'No trustworthy capture evidence (recorded before queue v2, or edited after capture). Held for assisted recovery.',
      );
      result.missingProvenance += 1;
      continue;
    }
    if (currentUserId && item.originUserId !== currentUserId) {
      await quarantineItem(
        item.localId!,
        'actor-mismatch',
        `Captured by a different signed-in user than the current session. Held for assisted recovery; never replayed as the current user.`,
      );
      result.actorMismatch += 1;
      continue;
    }
    if (!currentUserId) {
      // Not verified as self — stays pending, NOT replayed (see caller).
      continue;
    }
    // Case A: provenance matches the current actor — allowed into the
    // existing replay path, where server authorization still applies.
  }
  if (result.actorMismatch + result.missingProvenance > 0) {
    log.warn('Queue quarantine sweep held items out of replay', { ...result });
  }
  return result;
}
