import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demo/mode';
import { isMissingFunctionError } from '@/services/quickSaveService';
import type { PosSaleQueuePayload } from '@/offline/payloads';
import { deriveClientKey } from '@/lib/clientKeys';
import { createLogger } from '@/lib/logger';

const log = createLogger('PosSaleRpc');

/**
 * posSaleRpc — server-side POS sale posting.
 *
 * Calls the Phase 6E-3 plan-gated wrapper, which checks retail entitlement
 * and exact tender settlement before delegating to canonical `post_pos_sale`
 * (R08). That function writes the invoice, its lines, tender rows, ledger
 * entries and stock release in ONE transaction, or nothing at all.
 *
 * Why the till needs it beyond speed: with the posting server-side, a cashier
 * never holds INSERT on invoices / invoice_lines / invoice_payments /
 * journal_entries, so a cashier session cannot reach the ledger at all.
 *
 * FAILURE POLICY — this function answers "can this backend post the sale
 * server-side?", so it returns null for the two ways the answer is no, and
 * throws for everything else:
 *
 *   null  -> only the explicitly selected demo client answered without a
 *            committed document, so the demo uses its local materializer.
 *   throw -> every real backend failure, including a missing plan-gated RPC.
 *            The RPC is atomic, so nothing was written; falling back to client
 *            writes could bypass subscription gates and is never permitted.
 *
 * Falling back is safe against double-posting in every case: both paths are
 * idempotent on the same client key, and the fallback's own repository calls
 * look the key up before inserting.
 *
 * A single transient retry (network/5xx, same client_key) matches the
 * quick-save service: on a slow link the commit often succeeds inside Postgres
 * while the response is cut, and the retry returns the committed document.
 */

const TRANSIENT_RETRY_DELAY_MS = 800;

function isRetriableTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (typeof e.status === 'number' && e.status >= 500 && e.status < 600) return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_network_changed') ||
    msg.includes('upstream request timeout') ||
    msg.includes('timeout')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface PosSaleRpcResult {
  id: string;
  number: string;
  journal_entry_id: string | null;
  cogs_entry_id?: string | null;
  idempotent: boolean;
}

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};

/**
 * The payload `post_pos_sale` expects, built from the queue payload the till
 * already assembles. Field names are the ones the SQL reads; the mapping from
 * the camelCase queue shape is deliberately explicit here rather than in SQL,
 * so the two shapes can be read side by side.
 */
export function buildPosSaleRpcPayload(
  payload: PosSaleQueuePayload,
  businessId: string,
  clientKey: string,
): Record<string, unknown> {
  return {
    business_id: businessId,
    client_key: clientKey,
    shift_id: payload.shiftId,
    cash_sales: payload.cashSales,
    other_sales: payload.otherSales,
    receipt_number: payload.receiptNumber,
    is_credit_sale: payload.isCreditSale,
    customer: {
      name: payload.customer?.name ?? '',
      phone: payload.customer?.phone ?? null,
      email: payload.customer?.email ?? null,
    },
    // The invoice as the till built it: the RPC reserves its own number, so a
    // placeholder from an offline sale is expected and ignored.
    invoice: payload.overrides?.discountToken
      ? { ...payload.invoice, discount_override_token: payload.overrides.discountToken }
      : payload.invoice,
    lines: payload.lines.map((line, index) => {
      const token = payload.overrides?.lineTokens[index];
      return token ? { ...line, price_override_token: token } : line;
    }),
    // Per-tender keys must stay identical to the legacy path's
    // (deriveClientKey(clientKey, index)) so that whichever path commits
    // first, the other recognises the rows instead of duplicating them.
    payments: payload.payments.map((payment, index) => ({
      ...payment,
      client_key: deriveClientKey(clientKey, index),
    })),
  };
}

export async function postPosSaleViaRpc(
  payload: PosSaleQueuePayload,
  businessId: string,
  clientKey: string,
): Promise<PosSaleRpcResult | null> {
  const client = supabase as unknown as RpcClient;
  const args = { p_payload: buildPosSaleRpcPayload(payload, businessId, clientKey) };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await client.rpc('post_pos_sale_plan_gated', args);
      if (error) throw error;

      const result = data as PosSaleRpcResult | null;
      if (!result || typeof result.id !== 'string' || typeof result.number !== 'string') {
        if (isDemoMode()) {
          log.info('Demo backend does not emulate the POS sale RPC — using its local sale path', {
            businessId,
            receiptNumber: payload.receiptNumber,
          });
          return null;
        }
        throw new Error('The server did not confirm this POS sale. No client-side fallback was attempted.');
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (isMissingFunctionError(err)) {
        if (isDemoMode()) {
          log.info('Demo backend does not expose the POS sale RPC — using its local sale path', {
            businessId,
            receiptNumber: payload.receiptNumber,
          });
          return null;
        }
        throw new Error('POS checkout security controls are not deployed on this server. Apply the POS Phase 6E-3 migration before accepting sales.', { cause: err });
      }
      if (attempt === 0 && isRetriableTransient(err)) {
        log.warn('POS sale RPC failed transiently — retrying once with the same client key', {
          businessId,
          receiptNumber: payload.receiptNumber,
          error: err instanceof Error ? err.message : String(err),
        });
        await delay(TRANSIENT_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
