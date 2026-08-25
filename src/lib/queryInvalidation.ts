import type { QueryClient } from '@tanstack/react-query';

/**
 * Scoped cache invalidation for transaction saves.
 *
 * Recording an expense or an invoice used to finish with a bare
 * `queryClient.invalidateQueries()`, which marks EVERY cached query in the app
 * stale. React Query then immediately refetches all of them that are mounted:
 * contacts, products, branches, departments, assets, payroll, team, partner
 * billing, every report. On a mobile connection that is the lag felt after the
 * success tick, and almost none of it can be affected by the save.
 *
 * The lists below name only what a new transaction can actually change. Keys
 * are matched by prefix, so ['expenses', businessId] is covered by 'expenses'.
 *
 * Keep in sync with the queryKey values used across the app — an unlisted key
 * shows stale data until its own staleTime expires, so err towards including a
 * key when a transaction plausibly affects it.
 */

/** Ledger and reporting surfaces that any posted transaction moves. */
const LEDGER_KEYS = [
  'journal',
  'journal_entry_detail',
  'accounts',
  'accounts_by_type',
  'posting_accounts',
  // Financial statements are derived from the ledger.
  'sofp',
  'profit_or_loss',
  'cash_flow',
  'changes_in_equity',
  'branch_performance',
  // Dashboard/report aliases use different historical naming conventions.
  'profit_loss',
  'trial_balance',
  'multi_currency_report',
  'revenue-breakdown',
  'trend',
  'vat',
] as const;

/** Stock surfaces, touched only when the line references a tracked product. */
const INVENTORY_KEYS = [
  'inventory_balances',
  'products',
  'products_all',
  'reorder_alerts',
  'locations',
  'balances',
  'movements',
  'inventory_reconciliation',
  'products_trackable',
] as const;

/** Third segment used by the tenant-first detail keys in queryKeys.ts. */
type BusinessDetailSegment =
  | 'journal-entry'
  | 'accounting-period'
  | 'invoice'
  | 'contact'
  | 'payroll-run'
  | 'stock-transfer';

const LEDGER_DETAIL_SEGMENTS: BusinessDetailSegment[] = [
  'journal-entry',
  'accounting-period',
];

/**
 * Invalidate the caches a saved expense affects.
 *
 * @param options.touchedInventory - whether the expense moved tracked stock.
 *   Skipping the inventory keys when it did not avoids refetching product and
 *   stock lists that cannot have changed.
 */
export function invalidateAfterExpense(
  queryClient: QueryClient,
  options: { touchedInventory?: boolean } = {},
): void {
  const keys: string[] = ['expenses', ...LEDGER_KEYS, 'usage'];
  if (options.touchedInventory) keys.push(...INVENTORY_KEYS);
  invalidateKeys(queryClient, keys);
  invalidateBusinessDetails(queryClient, LEDGER_DETAIL_SEGMENTS);
}

/**
 * Invalidate the caches a saved invoice affects.
 *
 * Includes 'contacts' because an invoice changes a customer's outstanding
 * balance and AR ageing.
 */
export function invalidateAfterIncome(
  queryClient: QueryClient,
  options: { touchedInventory?: boolean } = {},
): void {
  const keys: string[] = ['invoices', 'income', 'contacts', ...LEDGER_KEYS, 'usage'];
  if (options.touchedInventory) keys.push(...INVENTORY_KEYS);
  invalidateKeys(queryClient, keys);
  invalidateBusinessDetails(queryClient, [
    ...LEDGER_DETAIL_SEGMENTS,
    'invoice',
    'contact',
  ]);
}

/** Refresh payroll, tax, journal, dashboard and report data after payroll writes. */
export function invalidateAfterPayroll(queryClient: QueryClient): void {
  invalidateKeys(queryClient, [
    'payroll_runs',
    'payroll_run',
    'employees',
    'paye',
    'tax_returns',
    ...LEDGER_KEYS,
    'usage',
  ]);
  invalidateBusinessDetails(queryClient, [
    ...LEDGER_DETAIL_SEGMENTS,
    'payroll-run',
  ]);
}

/** Refresh every stock representation and the financial reports stock affects. */
export function invalidateAfterInventory(queryClient: QueryClient): void {
  invalidateKeys(queryClient, [...INVENTORY_KEYS, ...LEDGER_KEYS]);
  invalidateBusinessDetails(queryClient, [
    ...LEDGER_DETAIL_SEGMENTS,
    'stock-transfer',
  ]);
}

/**
 * Invalidate everything a batch of synced offline items could have touched.
 *
 * The offline queue mixes expenses and invoices and does not report which
 * kinds it flushed, so this is the union of both. Still far narrower than a
 * bare invalidateQueries(), which would also refetch payroll, team, partner
 * and settings data that the queue never writes.
 */
export function invalidateAfterSync(queryClient: QueryClient): void {
  invalidateKeys(queryClient, [
    'expenses',
    'invoices',
    'contacts',
    ...LEDGER_KEYS,
    ...INVENTORY_KEYS,
    'usage',
  ]);
  invalidateBusinessDetails(queryClient, [
    ...LEDGER_DETAIL_SEGMENTS,
    'invoice',
    'contact',
  ]);
}

function invalidateKeys(queryClient: QueryClient, keys: string[]): void {
  for (const key of keys) {
    // Not awaited: invalidation marks queries stale synchronously, and the
    // refetches it triggers should not block the success animation.
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * Invalidate only the sensitive tenant-first detail families affected by a
 * write. The business id deliberately remains unconstrained here: inactive
 * tenants are merely marked stale, while only mounted observers can refetch.
 * This avoids missing a detail entry whose business id is not available at a
 * low-level journal/inventory callsite without widening to unrelated webhook
 * or partner-admin data.
 */
function invalidateBusinessDetails(
  queryClient: QueryClient,
  segments: readonly BusinessDetailSegment[],
): void {
  const allowed = new Set<string>(segments);
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return key[0] === 'business' && typeof key[2] === 'string' && allowed.has(key[2]);
    },
  });
}
