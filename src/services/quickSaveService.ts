import { supabase, isAbortError } from '@/lib/supabase';

/**
 * quickSaveService — single-round-trip transaction saves.
 *
 * The quick-entry forms used to run the whole save as 8–25 sequential
 * Supabase round trips (reserve number → header → lines → usage → journal →
 * post → link → stock movements). On a Lilongwe→Ireland link (~110 ms RTT)
 * that is seconds of wall time. These wrappers call the atomic Postgres RPCs
 * (supabase/migrations/20260911000001_quick_save_rpc.sql) which perform the
 * entire save — document, journal posting, link and stock movements — in ONE
 * transaction, or nothing at all.
 *
 * DESIGN CONTRACT (see the migration header for the SQL side):
 *   - Policy inputs (FX rate, VAT math, account resolution, amounts) are
 *     computed by the caller exactly as before. The RPC is an executor.
 *   - client_key makes retries safe: a save that committed but whose response
 *     was lost returns the already-committed document (idempotent: true)
 *     instead of creating a duplicate. Callers should keep the same key
 *     across manual retries of one logical save and rotate it on success.
 *   - Only a MISSING FUNCTION (migration not yet applied) falls back to the
 *     legacy path. Any other error is a real failure — nothing was saved —
 *     and must surface to the user, never silently downgrade.
 *
 * TRANSIENT RETRY POLICY:
 *   On abort/timeout/network failure (which, by definition, means we do not
 *   know whether the server committed), we transparently retry ONCE using
 *   the SAME client_key. If the first attempt actually committed (the most
 *   common case on slow mobile links — the save finishes inside Postgres
 *   but the response is cut by the client's 60s write timeout) the retry
 *   returns the already-committed document; the user sees a normal success
 *   instead of an error. We do NOT retry on real server errors (PGRST202,
 *   4xx/5xx, constraint violations) because those genuinely mean "nothing
 *   was saved" and a retry would not help.
 */

const TRANSIENT_RETRY_DELAY_MS = 800;

function isRetriableTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // Network/abort/timeout from fetchWithTimeout or the browser.
  if (isAbortError(err)) return true;
  const e = err as { code?: string; message?: string; status?: number };
  // PostgREST/GoTrue 5xx — server blip, retry is reasonable.
  if (typeof e.status === 'number' && e.status >= 500 && e.status < 600) return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('network down') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_network_changed') ||
    msg.includes('upstream request timeout') ||
    msg.includes('database error') // rare GoTrue/PostgREST transient
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}


export interface QuickSaveResult {
  id: string;
  number: string;
  journal_entry_id: string | null;
  receipt_entry_id?: string | null;
  cogs_entry_id?: string | null;
  idempotent: boolean;
}

export interface QuickExpenseRpcPayload {
  business_id: string;
  client_key: string;
  /** Insert shape of the expense, WITHOUT expense_number (RPC reserves it). */
  expense: Record<string, unknown>;
  lines: Record<string, unknown>[];
  /** [{ account_id, amount, description }] — net, original currency. */
  allocations: { account_id: string; amount: number; description?: string }[];
  vat_amount: number;
  /** [{ product_id, quantity, unit_cost }] — purchases to receive. */
  stock_lines: { product_id: string; quantity: number; unit_cost: number }[];
}

export interface QuickSaleRpcPayload {
  business_id: string;
  client_key: string;
  /** Insert shape of the invoice, WITHOUT invoice_number (RPC reserves it). */
  invoice: Record<string, unknown>;
  lines: Record<string, unknown>[];
  subtotal: number;
  vat_amount: number;
  /** [{ product_id, quantity }] — unit cost is read server-side. */
  stock_lines: { product_id: string; quantity: number }[];
}

/**
 * True only when the RPC does not exist yet (migration pending on this
 * environment — e.g. preview DBs built before 20260911000001). Distinguishes
 * PostgREST's function-not-found (404 / PGRST202) from every real failure.
 */
export function isMissingFunctionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.code === 'PGRST202' || e.code === '404' || e.status === 404) return true;
  return /could not find the function|function .* does not exist|schema cache/i.test(e.message ?? '');
}

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message: string; details?: unknown; hint?: unknown } | null }>;
};

async function callRpc(fn: string, args: Record<string, unknown>): Promise<QuickSaveResult> {
  // The generated Database type predates these functions; the runtime result
  // is validated below rather than trusted from a cast.
  const client = supabase as unknown as RpcClient;

  // First attempt.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw error;
      if (
        !data ||
        typeof data !== 'object' ||
        typeof (data as QuickSaveResult).id !== 'string' ||
        typeof (data as QuickSaveResult).number !== 'string'
      ) {
        throw new Error(`${fn} returned an unexpected response`);
      }
      return data as QuickSaveResult;
    } catch (err) {
      lastErr = err;
      // Never retry a "function does not exist" — that's a migration
      // signal the caller wants to handle (fallback to legacy path).
      if (isMissingFunctionError(err)) throw err;
      // Only one retry, and only on transient/abort errors.
      if (attempt === 0 && isRetriableTransient(err)) {
        await delay(TRANSIENT_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  // Should be unreachable — loop either returns or throws.
  throw lastErr;
}

export function saveQuickExpenseViaRpc(payload: QuickExpenseRpcPayload): Promise<QuickSaveResult> {
  return callRpc('save_quick_expense', { p_payload: payload });
}

export function saveQuickSaleViaRpc(payload: QuickSaleRpcPayload): Promise<QuickSaveResult> {
  return callRpc('save_quick_sale', { p_payload: payload });
}

/**
 * Fresh idempotency key for one logical save. Rotate on success; keep the
 * same key when retrying a failed save so a lost-response commit cannot
 * duplicate.
 */
export function newSaveClientKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Non-secure contexts (http LAN previews): uuid-v4-shaped fallback.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
