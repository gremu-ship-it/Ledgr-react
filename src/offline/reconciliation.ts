/**
 * R09.3 Model 4 (P-D3-FINAL) — authorized reconciliation of typed exceptions.
 *
 * Reconciliation is an AUTHORITY ACTION, not a retry button:
 *
 *   - Eligibility (client gate, evidence-preserving): the item must carry a
 *     live typed exception ('stock-denied' | 'policy-denied'). Integrity
 *     quarantines (actor-mismatch, missing-provenance, legacy,
 *     payload-tampered) are refused LOCALLY with zero mutation — and again
 *     SERVER-side, where the function refuses any non-reconcilable class.
 *   - Authority: decided exclusively by the server. This module sends no role
 *     claim; the session token on the request is the only credential, and
 *     reconcile_offline_queue_item requires active owner/admin/manager
 *     membership (the existing R08 manager tier — no new role).
 *   - Identity: the ORIGINAL client key and the ORIGINAL, hash-verified
 *     payload are sent. No replacement key is minted; the payload is never
 *     edited (quantity/price/tax/customer/branch/terminal all stay as
 *     captured). Substantive changes need a new capture + new client key —
 *     not this path.
 *   - Exactly-once: the server replays through post_pos_sale under the same
 *     client key, so a reconciliation after a committed-but-lost response
 *     resolves against the existing document instead of duplicating it.
 *   - Fresh validation: the server function replays through post_pos_sale,
 *     which re-derives actor, membership, branch, terminal, shift (+ DEC-08
 *     late arrival), R10 quota (P0QLT) and R06 stock (23514) at reconcile
 *     time. Cached browser state decides nothing.
 *   - Audit: every accepted AND denied server decision is appended to
 *     public.offline_queue_reconciliations with origin actor (evidence) and
 *     reconciliation actor (server-derived) as separate columns.
 *
 * Local outcomes:
 *   accepted → item synced (resolvedServerId), exception metadata KEPT as
 *              evidence, server audit row 'replay-accepted'.
 *   denied   → item stays failed + exception (unchanged identity), attempt
 *              evidence recorded, server audit row 'replay-denied'.
 *   rejected → a local/transport refusal before any server decision; the
 *              item is restored exactly, no audit row exists to fake.
 */
import { offlineDB, type ExceptionClass, type QueueItem } from './db';
import { RECONCILABLE_EXCEPTION_CLASSES, INTEGRITY_QUARANTINE_REASONS } from './exceptions';
import { hasTrustworthyProvenance, quarantineItem } from './provenance';
import { verifyPayloadIntegrity } from './payloadIntegrity';
import { claimLease, releaseLease } from './lease';
import { getLeaseClaimantId } from './deviceIdentity';
import { realSupabase } from '@/lib/supabase';
import { buildPosSaleRpcPayload } from '@/services/posSaleRpc';
import type { PosSaleQueuePayload } from './payloads';
import { createLogger } from '@/lib/logger';

const log = createLogger('QueueReconciliation');

/**
 * The generated Database types only carry RPC names shipped in earlier
 * migrations; reconcile_offline_queue_item (20261002000000) reaches the same
 * transport through the narrow cast posSaleRpc already uses for post_pos_sale.
 */
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};
const rpcClient = realSupabase as unknown as RpcClient;

export type ReconcileDisposition =
  | 'replay-accepted'
  | 'replay-denied'
  | 'rejected';

export interface ReconcileResult {
  ok: boolean;
  disposition: ReconcileDisposition;
  /** Server SQLSTATE/typed code for denials and rejections, when known. */
  code: string | null;
  /** Human-safe detail (bounded; no payload contents). */
  detail: string;
  /** Authoritative document id on acceptance (existing one when idempotent). */
  documentId: string | null;
  /** True when the server resolved against an already-committed document. */
  idempotent: boolean;
}

/** Local refusal codes (pre-server; nothing reached the server). */
export type ReconcileRejectReason =
  | 'not-found'
  | 'not-an-exception'
  | 'integrity-class'
  | 'missing-provenance'
  | 'payload-tampered'
  | 'unsupported-operation-type'
  | 'reason-required'
  | 'lease-held';

function rejected(code: ReconcileRejectReason, detail: string): ReconcileResult {
  return { ok: false, disposition: 'rejected', code, detail, documentId: null, idempotent: false };
}

/** True when this item is currently eligible for a reconciliation attempt. */
export function isReconcilable(item: QueueItem): boolean {
  return (
    item.status === 'failed' &&
    RECONCILABLE_EXCEPTION_CLASSES.includes(item.exceptionClass as ExceptionClass)
  );
}

/** All live typed exceptions for a business, oldest first (drawer surface). */
export async function getExceptionItems(businessId: string): Promise<QueueItem[]> {
  const items = await offlineDB.queue.where('businessId').equals(businessId).sortBy('sequence');
  return items.filter(isReconcilable);
}

interface ReconcileRpcResponse {
  ok?: unknown;
  disposition?: unknown;
  document_id?: unknown;
  idempotent?: unknown;
  code?: unknown;
  message?: unknown;
}

const MAX_REASON_LENGTH = 500;

/**
 * Initiate Model-4 reconciliation for one typed-exception item.
 *
 * @param localId  queue row identity on THIS device
 * @param reason   manager-recorded reason (mandatory, 1–500 chars)
 */
export async function reconcileQueueItem(
  localId: number,
  reason: string,
): Promise<ReconcileResult> {
  const item = await offlineDB.queue.get(localId);
  if (!item) return rejected('not-found', 'Queue item no longer exists on this device.');

  // Integrity classes are refused locally with ZERO mutation (mirror of the
  // server-side refusal; both layers are required).
  const quarantineReason = item.quarantineReason;
  if (
    item.status === 'quarantined' ||
    (quarantineReason != null &&
      (INTEGRITY_QUARANTINE_REASONS as readonly string[]).includes(quarantineReason))
  ) {
    return rejected(
      'integrity-class',
      'Integrity quarantines are never reconciled. Assisted recovery is the only path.',
    );
  }
  if (!isReconcilable(item)) {
    return rejected('not-an-exception', 'Only a live typed exception can be reconciled.');
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0 || trimmedReason.length > MAX_REASON_LENGTH) {
    return rejected('reason-required', 'A reconciliation reason (1–500 characters) is required.');
  }

  // Provenance must be complete evidence: reconciliation records the origin
  // actor — an item that cannot prove its origin cannot be audited honestly.
  if (!hasTrustworthyProvenance(item)) {
    return rejected('missing-provenance', 'Capture evidence is incomplete; reconciliation would falsify the audit record.');
  }

  // The original payload must be byte-exact as captured. Tampering converts
  // the item into a permanent integrity quarantine (never reconcilable).
  if (!(await verifyPayloadIntegrity(item))) {
    await quarantineItem(
      localId,
      'payload-tampered',
      'The stored payload no longer matches its capture-time integrity hash. Never reconciled; held for assisted recovery.',
    );
    return rejected('payload-tampered', 'Payload integrity check failed; the item was quarantined.');
  }

  // This revision replays only through the single server-authoritative POS
  // posting function. Other queue types stay classified + visible and are
  // deliberately not replayable here.
  if (item.operationType !== 'pos_sale') {
    return rejected(
      'unsupported-operation-type',
      'This operation type stays exception-classified; reconciliation replay is available for POS sales only.',
    );
  }

  // Cross-tab exclusive lease on the SAME row lock the sync engine uses:
  // two tabs (or a racing sync pass) cannot double-reconcile.
  const claimant = getLeaseClaimantId();
  const claim = await claimLease(localId, claimant);
  if (!claim.ok) {
    return rejected('lease-held', 'Another tab is currently processing this item. Try again shortly.');
  }

  const attemptedAt = new Date().toISOString();
  try {
    // Mark in-flight so other surfaces see the attempt, never a retry.
    await offlineDB.queue.update(localId, {
      status: 'syncing',
      lastAttemptAt: attemptedAt,
    });

    const request = {
      business_id: item.businessId,
      client_key: item.clientKey,
      operation_type: item.operationType,
      exception_class: item.exceptionClass,
      reason: trimmedReason,
      // R09.2 provenance, evidence only — the server never authorizes on it.
      origin_user_id: item.originUserId ?? null,
      origin_device_id: item.originDeviceId ?? null,
      captured_at: item.capturedAt ?? null,
      // The ORIGINAL payload, rebuilt for the SAME sanctioned posting path
      // with the SAME client key. Nothing else is derived, added or removed.
      payload: buildPosSaleRpcPayload(
        item.payload as PosSaleQueuePayload,
        item.businessId,
        item.clientKey!,
      ),
    };

    const { data, error } = await rpcClient.rpc('reconcile_offline_queue_item', {
      p_request: request,
    });

    if (error) {
      // Server-side refusal (unauthorized manager tier, identity mismatch,
      // integrity class, transport): zero financial mutation, item restored.
      const code = (error as { code?: string }).code ?? null;
      await restoreAfterAttempt(localId, attemptedAt,
        `Reconciliation refused by the server (${code ?? 'network'}). The exception is unchanged.`);
      log.warn('Reconciliation refused', { code, localId });
      return {
        ok: false,
        disposition: 'rejected',
        code,
        detail: describeRefusal(code),
        documentId: null,
        idempotent: false,
      };
    }

    const result = (data ?? {}) as ReconcileRpcResponse;
    if (result.ok === true) {
      const documentId = typeof result.document_id === 'string' ? result.document_id : null;
      await offlineDB.queue.update(localId, {
        status: 'synced',
        resolvedServerId: documentId ?? undefined,
        // lastError/lastErrorCode stay as the historical denial evidence; the
        // drawer reads the exception surface for reconciled items instead.
        reconcileAttempts: (item.reconcileAttempts ?? 0) + 1,
        lastReconcileAt: attemptedAt,
        lease: null,
      });
      return {
        ok: true,
        disposition: 'replay-accepted',
        code: null,
        detail:
          result.idempotent === true
            ? 'Reconciled: the original transaction was already committed — the existing document was confirmed, not duplicated.'
            : 'Reconciled: the original transaction was replayed and committed with its original reference.',
        documentId,
        idempotent: result.idempotent === true,
      };
    }

    // Authoritative replay denial (stock still short, plan still exhausted,
    // shift/branch conditions not met): the audit row exists server-side;
    // the exception remains for a later eligible attempt.
    const code = typeof result.code === 'string' ? result.code : null;
    await restoreAfterAttempt(localId, attemptedAt,
      `Reconciliation replay denied (${code ?? 'unknown'}). The exception is unchanged.`);
    return {
      ok: false,
      disposition: 'replay-denied',
      code,
      detail: describeDenial(code),
      documentId: null,
      idempotent: false,
    };
  } finally {
    await releaseLease(localId, claim.lease!.token);
  }
}

/** Restore the durable exception state after any non-accepted attempt. */
async function restoreAfterAttempt(localId: number, attemptedAt: string, note: string): Promise<void> {
  const item = await offlineDB.queue.get(localId);
  if (!item) return;
  await offlineDB.queue.update(localId, {
    status: 'failed', // the same exception surface as before the attempt
    lastAttemptAt: attemptedAt,
    attemptCount: item.attemptCount + 1,
    reconcileAttempts: (item.reconcileAttempts ?? 0) + 1,
    lastReconcileAt: attemptedAt,
    lastError: note,
    lease: null,
  });
}

function describeRefusal(code: string | null): string {
  switch (code) {
    case '42501':
      return 'Reconciliation denied: manager-tier authority is required, verified server-side.';
    case '22023':
      return 'Reconciliation denied: the request does not match the original transaction, or this exception class/operation is not reconcilable.';
    case null:
      return 'Reconciliation could not reach the server. The exception is unchanged; try again when connected.';
    default:
      return `Reconciliation denied by the server (${code}). The exception is unchanged.`;
  }
}

function describeDenial(code: string | null): string {
  switch (code) {
    case 'P0QLT':
      return 'Replay denied again: the monthly plan limit is still reached. The original sale is preserved untouched.';
    case '23514':
      return 'Replay denied again: stock is still insufficient. The original sale is preserved untouched.';
    case '42501':
    case '22023':
      return `Replay denied by server authority (${code}). Branch/terminal/shift conditions stand — no override was applied.`;
    default:
      return `Replay denied by the server (${code ?? 'unknown'}). The original sale is preserved untouched.`;
  }
}
