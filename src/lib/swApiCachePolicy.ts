/**
 * IC 2026-09-25 P8 — which Supabase REST reads the service worker may ever
 * answer from its runtime cache.
 *
 * Finding (crawl 2026-09-25, CONFIRMED MEDIUM): every GET /rest/v1/* was
 * NetworkFirst with a 4 s timeout and a 24 h cache. On a slow link the SW
 * silently answered with a cached copy up to a day old — balances, invoices,
 * payments, journals and stock looked current but were not.
 *
 * Policy: FINANCIAL resources (ledger, documents, payments, stock, tax,
 * payroll, banking, POS money, all views and all RPCs) are NetworkOnly — the
 * SW never stores or serves them; a network failure surfaces as an error the
 * UI shows. Non-financial reference data (products, contacts, branches,
 * settings, …) keeps the previous NetworkFirst behaviour. Offline display
 * uses the app's own persisted query cache, not the SW cache, and the R09.1
 * logout wipe of `ledgr-api-cache` is unchanged.
 *
 * Kept as plain string data so vite.config.ts can embed it in a RegExp
 * source (workbox serialises urlPattern with toString()).
 */
export const FINANCIAL_REST_RESOURCE_PREFIXES: readonly string[] = [
  'rpc/', 'v_',
  'accounting_periods', 'accounts', 'bank_', 'budget', 'depreciation_schedules',
  'employee_', 'employees', 'exchange_rates', 'expense', 'fixed_assets', 'fx_revaluations',
  'inventory_', 'invoice', 'journal_', 'loan', 'partner_invoices', 'paye_bands',
  'payroll_', 'pos_', 'recurring_invoices', 'share_transactions', 'stock_',
  'subscription_payments', 'tax_', 'audit_log',
];

/** RegExp source for the path part AFTER `/rest/v1/`. */
export const FINANCIAL_REST_PATH_SOURCE = `(?:${FINANCIAL_REST_RESOURCE_PREFIXES
  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')})`;

/** True when a REST resource path (after /rest/v1/) must never be SW-cached. */
export function isFinancialRestResource(resourcePath: string): boolean {
  return new RegExp(`^${FINANCIAL_REST_PATH_SOURCE}`).test(resourcePath);
}
