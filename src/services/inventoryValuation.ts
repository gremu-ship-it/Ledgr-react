/**
 * inventoryValuation.ts
 *
 * Pure valuation arithmetic for perpetual inventory — no database access,
 * no Supabase client, no side effects.
 *
 * Split out from inventoryJournalService so these functions can be unit
 * tested directly. They decide how much value moves between the balance
 * sheet and the income statement, which makes them the part most worth
 * testing and the part that must never depend on I/O.
 */

/** MWK rounding tolerance — matches FinancialStatementRepository. */
export const TOLERANCE = 0.01;

/**
 * One line of stock leaving on a sale, valued at the weighted-average cost
 * that applied *at the moment of the sale*. Captured by the caller before
 * the stock movement is written, so the cost used for COGS is exactly the
 * cost the subledger removed — one source of truth, no drift.
 */
export interface SaleCostLine {
  productId: string;
  /** Units sold. Sale movements are stored negative; either sign is accepted. */
  quantity: number;
  /** Weighted-average unit cost in functional currency. */
  unitCost: number;
}

/** Maps a product to the pair of GL accounts its cost moves between. */
export interface ProductAccountMapping {
  inventoryAccountId: string;
  cogsAccountId: string;
}

/**
 * Rounds to 2dp the way money should be rounded before it hits the ledger.
 * Guards against float dust breaking the double-entry balance check.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Total value of a set of stock balances at weighted-average cost.
 *
 * Negative quantities (oversold stock) are intentionally included rather
 * than clamped: a negative on-hand figure is a real data problem, and
 * hiding it here would make the reconciliation under-report the variance
 * instead of surfacing it.
 */
export function computeStockValue(
  balances: { quantity_on_hand: number | string; average_cost: number | string }[],
): number {
  return balances.reduce(
    (sum, b) => sum + Number(b.quantity_on_hand) * Number(b.average_cost),
    0,
  );
}

/**
 * Total cost of goods sold for a set of sale lines.
 * Lines with a zero/unknown cost contribute nothing — see buildCogsPostings.
 */
export function computeCogsTotal(costLines: SaleCostLine[]): number {
  return costLines.reduce(
    (sum, l) => sum + Math.abs(Number(l.quantity)) * Number(l.unitCost),
    0,
  );
}

/**
 * Variance between the stock subledger and the inventory GL accounts.
 * Positive variance = the ledger understates stock and needs a debit.
 */
export function computeInventoryVariance(
  subledgerValue: number,
  ledgerBalance: number,
): { variance: number; isReconciled: boolean } {
  const variance = roundMoney(subledgerValue - ledgerBalance);
  return { variance, isReconciled: Math.abs(variance) < TOLERANCE };
}

/**
 * Groups per-product costs into the debit (COGS) and credit (Inventory)
 * account totals for a single balanced journal entry.
 *
 * Products may map to different inventory/COGS accounts, so both sides are
 * accumulated independently. They always sum to the same total, which is
 * what keeps the entry balanced regardless of how many accounts are in play.
 *
 * Zero-cost lines are skipped: selling stock that was never received leaves
 * average_cost at 0, and posting a zero-value COGS line would add noise to
 * the ledger without changing any balance. Skipped products are returned so
 * the caller can warn rather than lose the information silently.
 */
export function buildCogsPostings(
  costLines: SaleCostLine[],
  accountsByProduct: Map<string, ProductAccountMapping>,
): {
  debitsByAccount: Map<string, number>;
  creditsByAccount: Map<string, number>;
  total: number;
  skippedProductIds: string[];
} {
  const debitsByAccount = new Map<string, number>();
  const creditsByAccount = new Map<string, number>();
  const skippedProductIds: string[] = [];
  let total = 0;

  for (const line of costLines) {
    const qty = Math.abs(Number(line.quantity));
    const cost = Number(line.unitCost);
    const amount = roundMoney(qty * cost);

    const mapping = accountsByProduct.get(line.productId);
    if (!mapping || amount <= 0) {
      if (qty > 0) skippedProductIds.push(line.productId);
      continue;
    }

    debitsByAccount.set(
      mapping.cogsAccountId,
      roundMoney((debitsByAccount.get(mapping.cogsAccountId) ?? 0) + amount),
    );
    creditsByAccount.set(
      mapping.inventoryAccountId,
      roundMoney((creditsByAccount.get(mapping.inventoryAccountId) ?? 0) + amount),
    );
    total = roundMoney(total + amount);
  }

  return { debitsByAccount, creditsByAccount, total, skippedProductIds };
}
