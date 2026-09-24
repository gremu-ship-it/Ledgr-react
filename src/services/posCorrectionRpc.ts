import { supabase } from '@/lib/supabase';
import { isMissingFunctionError, newSaveClientKey } from '@/services/quickSaveService';

/**
 * posCorrectionRpc — the ONLY client path for POS voids and refunds after the
 * R07 correction-safety release (supabase/migrations/20260928000002).
 *
 * Voids and refunds are financial corrections. They are executed exclusively by
 * the canonical server commands (`void_pos_sale_command` /
 * `refund_pos_sale_command`), which verify — server-side and in one atomic
 * transaction — the caller's identity, organisation, authority (direct tier
 * owner/admin/manager, or a live, bound, single-use approval token), the
 * document's ownership/status/eligibility, the cumulative-refund boundary and
 * idempotency/replay, BEFORE any financial row moves. A rejected command
 * mutates nothing.
 *
 * This module deliberately has NO client-side fallback (unlike the sale
 * posting path, which still tolerates pre-migration backends). A stale
 * backend that does not know these functions fails closed with
 * `PosCorrectionUnavailableError`; silently resurrecting the old raw-DML
 * write path would re-open the exact boundary R07 removed. Approvals live in
 * the same world: the client may only REQUEST an approval
 * (`request_pos_approval`) — the server mints a token bound to one
 * organisation, one document and one action, requester/approver/timestamp
 * recorded. The client can never authorize; it merely retried-consumes the
 * token once the server says the approval is authorized.
 */

export class PosCorrectionUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      'This POS needs the database correction update (R07) before it can process voids or refunds. Ask the system administrator to apply the latest migrations.',
      { cause },
    );
    this.name = 'PosCorrectionUnavailableError';
  }
}

/** The approval token is known but the manager has not authorized it yet. */
export class PosApprovalPendingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PosApprovalPendingError';
  }
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const rpcClient = supabase as unknown as RpcClient;

export interface PosApprovalToken {
  /** Server-minted bearer token (uuid). Only ever used to CONSUME the approval. */
  token: string;
  expiresAt: string;
}

export interface VoidPosSaleResult {
  idempotent: boolean;
  journalEntries: unknown[];
}

export interface RefundPosSaleResult {
  idempotent: boolean;
  amount: number;
  remaining: number;
  journalEntryId: string | null;
}

export type PosCorrectionAction = 'void_sale' | 'refund_sale';

function versionCheck(err: { code?: string } | null | undefined): never | null {
  if (err && isMissingFunctionError(err as { code?: string; message?: string })) {
    throw new PosCorrectionUnavailableError(err);
  }
  return null;
}

/**
 * Requests a server-bound approval for one document and one action. The
 * caller's own session identity is recorded as the requester; nothing in the
 * request can pre-authorize anything (approval requires a separate
 * owner/admin/manager session calling `authorize_pos_approval` on the
 * server-mounted tooling).
 */
export async function requestPosApproval(
  businessId: string,
  action: PosCorrectionAction,
  documentId: string,
  reason?: string,
): Promise<PosApprovalToken> {
  const { data, error } = await rpcClient.rpc('request_pos_approval', {
    p_business_id: businessId,
    p_action: action,
    p_document_id: documentId,
    p_amount: null,
    p_reason: reason ?? null,
    p_ttl_minutes: 15,
  });
  versionCheck(error as { code?: string } | null);
  if (error) throw error;
  const row = data as { token?: string; expires_at?: string } | null;
  if (!row || !row.token) throw new PosCorrectionUnavailableError();
  return { token: row.token, expiresAt: row.expires_at ?? '' };
}

/** Executes the canonical void command. `approvalToken` is required unless the caller is in the direct correction tier. */
export async function voidPosSaleViaRpc(options: {
  businessId: string;
  invoiceId: string;
  reason: string;
  approvalToken?: string | null;
  commandKey?: string;
}): Promise<VoidPosSaleResult> {
  const payload = {
    business_id: options.businessId,
    invoice_id: options.invoiceId,
    command_key: options.commandKey ?? newSaveClientKey(),
    reason: options.reason,
    approval_token: options.approvalToken ?? null,
  };
  const { data, error } = await rpcClient.rpc('void_pos_sale_command', { p_payload: payload });
  versionCheck(error as { code?: string } | null);
  if (error) throw classifyApprovalError(error);
  const r = data as { idempotent?: boolean; journal_entries?: unknown[] } | null;
  if (r === null) throw new PosCorrectionUnavailableError();
  return { idempotent: !!r?.idempotent, journalEntries: r?.journal_entries ?? [] };
}

/** Executes the canonical refund command — cumulative-refund-safe, restocking, settling. */
export async function refundPosSaleViaRpc(options: {
  businessId: string;
  invoiceId: string;
  reason: string;
  approvalToken?: string | null;
  commandKey?: string;
  lines: Array<{ product_id: string | null; quantity: number; amount: number }>;
}): Promise<RefundPosSaleResult> {
  const payload = {
    business_id: options.businessId,
    invoice_id: options.invoiceId,
    command_key: options.commandKey ?? newSaveClientKey(),
    reason: options.reason,
    approval_token: options.approvalToken ?? null,
    lines: options.lines,
  };
  const { data, error } = await rpcClient.rpc('refund_pos_sale_command', { p_payload: payload });
  versionCheck(error as { code?: string } | null);
  if (error) throw classifyApprovalError(error);
  const r = data as {
    idempotent?: boolean;
    amount?: number;
    remaining?: number;
    journal_entry_id?: string | null;
  } | null;
  if (r === null) throw new PosCorrectionUnavailableError();
  return {
    idempotent: !!r?.idempotent,
    amount: Number(r?.amount ?? 0),
    remaining: Number(r?.remaining ?? 0),
    journalEntryId: r?.journal_entry_id ?? null,
  };
}

/**
 * A consumed-not-yet/token-known strike surfaces as SQLSTATE 22023 with a
 * dedicated wording for "authorized manager still missing"; all other 22023s
 * (binding mismatches, expiry, cumulative overflow, wrong status) are real
 * business denials the caller shows verbatim.
 */
function classifyApprovalError(error: unknown): unknown {
  const e = error as { code?: string; message?: string };
  if (e?.code === '22023' && /has not been authorized/i.test(e.message ?? '')) {
    return new PosApprovalPendingError(
      'Approval is still pending: an owner, admin or manager must authorize the request before this operation can continue.',
      error,
    );
  }
  return error;
}
