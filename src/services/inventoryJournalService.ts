/**
 * inventoryJournalService.ts
 *
 * Perpetual inventory — keeps the stock subledger (`inventory_balances` /
 * `stock_movements`) and the general ledger in step so that Inventory
 * actually appears under Current Assets on the Statement of Financial
 * Position.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES
 * ─────────────────────────────────────────────────────────────────────────
 * Stock was tracked exclusively in `stock_movements`. No code path ever
 * posted a journal line to an inventory account, so accounts 1141-1145
 * always had a nil GL balance. `FinancialStatementRepository.buildSection`
 * drops any account whose balance is within TOLERANCE of zero, so the
 * Inventory lines were filtered out of Current Assets entirely — the
 * warehouse showed stock on hand while the balance sheet showed nothing.
 *
 * Purchases were expensed straight to Cost of Sales, which also overstated
 * gross profit in the buying period and understated it in the selling
 * period.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE POSTING MODEL (perpetual, weighted average)
 * ─────────────────────────────────────────────────────────────────────────
 *   Purchase of tracked stock   DR 1141 Inventory      CR Cash / Creditors
 *     (the expense debit is redirected away from COGS by
 *      resolveExpenseLineAccountId — the asset is capitalised, not expensed)
 *
 *   Sale of tracked stock       DR 5100 COGS           CR 1141 Inventory
 *     (a separate companion entry posted at weighted-average cost, so cost
 *      is recognised in the same period as the revenue — IAS 2.34)
 *
 *   Warehouse receipt           DR 1141 Inventory      CR 2114 GRNI
 *     (no supplier invoice exists yet; the credit sits in Goods Received
 *      Not Invoiced until the expense is recorded)
 *
 *   Adjustment / shrinkage      DR 5180 Inventory Adj  CR 1141 Inventory
 *     (or the reverse for a write-up)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CURRENCY
 * ─────────────────────────────────────────────────────────────────────────
 * `inventory_balances.average_cost` is stored in the functional currency
 * (MWK), so every entry this module posts is functional-currency native:
 * amount === amount_base and exchange_rate === 1. There is deliberately no
 * FX handling here — the FX difference on a foreign-currency purchase is
 * already realised on the expense/payable side by journalService, and
 * re-applying a rate to an average cost that is *already* in MWK would
 * double count it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TRANSACTION LIMITS
 * ─────────────────────────────────────────────────────────────────────────
 * COGS and receipt entries deliberately do NOT call the plan transaction
 * limit check. They are system-generated companions to a user transaction
 * that has already been counted; billing a customer twice for one sale
 * would be wrong, and failing the COGS half on a limit breach would leave
 * the ledger permanently unbalanced against the subledger.
 */

import { repos } from '@/lib/repositories';
import { createLogger } from '@/lib/logger';

const log = createLogger('InventoryJournalService');
import type { Row } from '@/dal/types/database';
import {
  TOLERANCE,
  roundMoney,
  computeStockValue,
  computeInventoryVariance,
  buildCogsPostings,
  type SaleCostLine,
} from './inventoryValuation';

// Re-exported so callers have a single import site for the inventory API.
export {
  TOLERANCE,
  roundMoney,
  computeStockValue,
  computeCogsTotal,
  computeInventoryVariance,
  buildCogsPostings,
} from './inventoryValuation';
export type { SaleCostLine, ProductAccountMapping } from './inventoryValuation';

// ── Account codes ─────────────────────────────────────────────────────────────

/** Default inventory (asset) account — 1141 Trading Stock. */
export const DEFAULT_INVENTORY_ACCOUNT_CODE = '1141';
/** Default cost-of-sales account — 5100 Cost of Goods Sold. */
export const DEFAULT_COGS_ACCOUNT_CODE = '5100';
/** Goods Received Not Invoiced — the credit side of a warehouse receipt. */
export const GRNI_ACCOUNT_CODE = '2114';
/** Inventory adjustments / shrinkage — variance and write-off account. */
export const INVENTORY_ADJUSTMENT_ACCOUNT_CODE = '5180';

/**
 * Code prefix for the seeded inventory block (1140 group, 1141-1145 leaves).
 * Used to discover which GL accounts hold stock when reconciling.
 */
export const INVENTORY_CODE_PREFIX = '114';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A stock line being received into the warehouse with no supplier invoice. */
export interface ReceiptCostLine {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface InventoryReconciliation {
  asOfDate: string;
  /** Σ (quantity_on_hand × average_cost) across every location. */
  subledgerValue: number;
  /** Balance of the inventory GL accounts, including opening balances. */
  ledgerBalance: number;
  /** subledgerValue − ledgerBalance. Positive = ledger understates stock. */
  variance: number;
  /** True when |variance| is within rounding tolerance. */
  isReconciled: boolean;
  /** Inventory accounts discovered for this business. */
  accounts: { id: string; code: string; name: string; balance: number }[];
}

// ── Account resolution ───────────────────────────────────────────────────────

async function getAccountByCode(businessId: string, code: string): Promise<Row<'accounts'>> {
  const acc = await repos.account.findByCode(businessId, code);
  if (!acc) {
    throw new Error(
      `Account ${code} not found. Open Settings → Chart of Accounts and run "Repair / seed accounts" to add the inventory accounts.`,
    );
  }
  return acc;
}

/**
 * Group accounts are headers — posting to one breaks the roll-up and is
 * rejected everywhere else in the app, so it's rejected here too rather
 * than silently producing a malformed statement.
 */
function assertPostable(account: Row<'accounts'>, role: string): Row<'accounts'> {
  if (account.is_group) {
    throw new Error(
      `${role} account ${account.code} (${account.name}) is a group/header account and cannot be posted to. Pick a leaf account instead.`,
    );
  }
  return account;
}

async function findAccountById(id: string): Promise<Row<'accounts'> | null> {
  try {
    return await repos.account.findById(id);
  } catch {
    // The product points at an account that has since been deleted — fall
    // back to the default rather than failing the whole transaction.
    return null;
  }
}

/**
 * Resolves the inventory (asset) account for a product: the product's own
 * `inventory_account_id` when set, otherwise 1141 Trading Stock.
 */
export async function resolveInventoryAccount(
  businessId: string,
  product?: Pick<Row<'products'>, 'inventory_account_id'> | null,
): Promise<Row<'accounts'>> {
  if (product?.inventory_account_id) {
    const linked = await findAccountById(product.inventory_account_id);
    if (linked && !linked.is_group) return linked;
  }
  return assertPostable(
    await getAccountByCode(businessId, DEFAULT_INVENTORY_ACCOUNT_CODE),
    'Inventory',
  );
}

/**
 * Resolves the cost-of-sales account for a product: the product's own
 * `cogs_account_id` when set, otherwise 5100 Cost of Goods Sold.
 */
export async function resolveCogsAccount(
  businessId: string,
  product?: Pick<Row<'products'>, 'cogs_account_id'> | null,
): Promise<Row<'accounts'>> {
  if (product?.cogs_account_id) {
    const linked = await findAccountById(product.cogs_account_id);
    if (linked && !linked.is_group) return linked;
  }
  return assertPostable(
    await getAccountByCode(businessId, DEFAULT_COGS_ACCOUNT_CODE),
    'Cost of sales',
  );
}

/**
 * THE KEY FIX ON THE BUYING SIDE.
 *
 * Decides which GL account an expense line should debit.
 *
 *   - Inventory-tracked product  -> the inventory ASSET account, so the
 *                                   purchase is capitalised onto the
 *                                   balance sheet instead of expensed.
 *   - Non-tracked product        -> the product's COGS account (previous
 *                                   behaviour, still correct: consumables
 *                                   and services are expensed on purchase).
 *   - No product                 -> whatever account the user picked.
 *
 * Callers pass their existing fallback so this is a drop-in replacement for
 * the old `product?.cogs_account_id ?? line.account_id` expression.
 */
export async function resolveExpenseLineAccountId(
  businessId: string,
  product: Row<'products'> | null | undefined,
  fallbackAccountId: string,
): Promise<string> {
  if (!product) return fallbackAccountId;

  if (product.track_inventory) {
    try {
      const inventoryAccount = await resolveInventoryAccount(businessId, product);
      return inventoryAccount.id;
    } catch (err) {
      // Chart of accounts is incomplete. Expensing the purchase is the
      // lesser evil versus blocking the user from recording it at all —
      // the reconciliation panel on the Warehouse page will surface the
      // resulting variance.
      log.warn(
        'Could not resolve an inventory account; expensing this purchase instead.',
        { error: err },
      );
    }
  }

  return product.cogs_account_id ?? fallbackAccountId;
}

/**
 * Batch version of resolveExpenseLineAccountId for multi-line documents.
 * Resolves each distinct product once instead of per line.
 */
export async function resolveExpenseLineAccountIds(
  businessId: string,
  lines: { productId: string | null; fallbackAccountId: string }[],
  products: Row<'products'>[],
): Promise<string[]> {
  const productById = new Map(products.map((p) => [p.id, p]));
  const resolvedByProduct = new Map<string, string>();

  const distinctProductIds = [
    ...new Set(lines.map((l) => l.productId).filter((id): id is string => Boolean(id))),
  ];

  for (const productId of distinctProductIds) {
    const product = productById.get(productId);
    if (!product) continue;
    // Fallback is irrelevant here — we only cache the product-driven answer
    // and fall back per line below when the product resolves to nothing.
    const resolved = await resolveExpenseLineAccountId(businessId, product, '');
    if (resolved) resolvedByProduct.set(productId, resolved);
  }

  return lines.map((line) => {
    if (!line.productId) return line.fallbackAccountId;
    return resolvedByProduct.get(line.productId) || line.fallbackAccountId;
  });
}

// ── Entry numbering ──────────────────────────────────────────────────────────

/**
 * journalService.nextEntryNumber is timestamp-to-the-second. A COGS entry is
 * posted in the same tick as the revenue entry it accompanies, so reusing
 * that helper risks a duplicate entry_number collision. The suffix keeps
 * companion entries unique and makes them self-describing in the journal.
 */
function inventoryEntryNumber(suffix: string): string {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}` +
    `${String(now.getMilliseconds()).padStart(3, '0')}`;
  return `JNL-${stamp}-${suffix}`;
}

type JournalLineInput = Parameters<typeof repos.journal.createBalancedEntry>[1][number];

/**
 * Builds a functional-currency journal line. Inventory postings are always
 * MWK-native: amount === amount_base, exchange_rate === 1.
 */
function functionalLine(
  lineNumber: number,
  accountId: string,
  description: string,
  isDebit: boolean,
  amount: number,
  currency: string,
  branchId?: string | null,
  departmentId?: string | null,
): JournalLineInput {
  return {
    line_number: lineNumber,
    account_id: accountId,
    description,
    is_debit: isDebit,
    amount,
    amount_base: amount,
    currency,
    exchange_rate: 1,
    tax_code: 'none',
    tax_amount: 0,
    reconciled: false,
    branch_id: branchId ?? null,
    department_id: departmentId ?? null,
  };
}

async function functionalCurrencyFor(businessId: string): Promise<string> {
  try {
    const business = await repos.business.findById(businessId);
    return business.base_currency ?? 'MWK';
  } catch {
    return 'MWK';
  }
}

// ── Posting: cost of goods sold on a sale ────────────────────────────────────

/**
 * Posts the COGS half of a sale: DR Cost of Sales / CR Inventory, valued at
 * the weighted-average cost captured when the stock movement was written.
 *
 * This is a *companion* entry to the revenue entry, deliberately kept
 * separate rather than folded into createInvoiceJournalEntry:
 *   - the revenue entry is currency-aware (invoice may be in USD); the cost
 *     entry is always functional-currency, so merging them would force one
 *     side through a rate conversion it must not have;
 *   - the invoice-builder flow posts revenue on issue and settlement later,
 *     while cost is recognised once on dispatch. Different lifecycles.
 *
 * `source_type` is 'inventory_cogs' rather than 'invoice' on purpose. The
 * reversal path in JournalRepository auto-voids the source record for
 * recognised source types; tagging this as 'invoice' would mean reversing
 * the COGS entry silently voids the whole sale.
 *
 * Never throws — a failure here is logged and swallowed so it cannot roll
 * back a sale that has already been recorded. The Warehouse reconciliation
 * panel is the safety net that surfaces any resulting gap.
 *
 * @returns the journal entry id, or null when there was nothing to post.
 */
export async function postCogsForSale(
  businessId: string,
  invoice: Pick<Row<'invoices'>, 'id' | 'invoice_number' | 'issue_date'>,
  costLines: SaleCostLine[],
  branchId?: string | null,
  departmentId?: string | null,
): Promise<string | null> {
  try {
    if (costLines.length === 0) return null;

    const products = await loadProducts(businessId, costLines.map((l) => l.productId));
    const accountsByProduct = await buildProductAccountMap(businessId, products);

    const { debitsByAccount, creditsByAccount, total, skippedProductIds } =
      buildCogsPostings(costLines, accountsByProduct);

    if (skippedProductIds.length > 0) {
      log.warn(
        `No cost recognised for ${skippedProductIds.length} sold line(s) — ` +
        'stock was sold with a zero average cost (received without a cost, or sold before being received).',
        { skippedProductIds },
      );
    }

    if (total < TOLERANCE) return null;

    // Always the business's functional currency: average_cost is stored in
    // MWK regardless of the currency the invoice was raised in.
    const currency = await functionalCurrencyFor(businessId);
    const lines: JournalLineInput[] = [];
    let lineNumber = 1;

    for (const [accountId, amount] of debitsByAccount) {
      lines.push(functionalLine(
        lineNumber++, accountId,
        `Cost of sales — Invoice ${invoice.invoice_number}`,
        true, amount, currency, branchId, departmentId,
      ));
    }
    for (const [accountId, amount] of creditsByAccount) {
      lines.push(functionalLine(
        lineNumber++, accountId,
        `Stock released — Invoice ${invoice.invoice_number}`,
        false, amount, currency, branchId, departmentId,
      ));
    }

    const { entry } = await repos.journal.createBalancedEntry(
      {
        business_id: businessId,
        entry_number: inventoryEntryNumber('COGS'),
        entry_date: invoice.issue_date,
        description: `Cost of goods sold — Invoice ${invoice.invoice_number}`,
        source_type: 'inventory_cogs',
        source_id: invoice.id,
        currency,
        exchange_rate: 1,
        status: 'draft',
        branch_id: branchId ?? null,
        department_id: departmentId ?? null,
      },
      lines,
    );

    await repos.journal.post(entry.id, null);
    return entry.id;
  } catch (err) {
    log.error(
      `Failed to post COGS for invoice ${invoice.invoice_number}. ` +
      'The sale is recorded; inventory and cost of sales will be out of step until reconciled ' +
      '(Warehouse → Ledger reconciliation).',
      err as Error,
    );
    return null;
  }
}

/**
 * Records the stock movements for a sale AND posts the matching COGS entry.
 *
 * Shared by the desktop income page, the mobile quick-sale sheet and the
 * offline sync engine so all three value stock identically. Keeping this in
 * one place is what stops the three paths drifting apart — the previous
 * per-page copies were already subtly different from each other.
 *
 * The weighted-average cost is read BEFORE the movement is written, because
 * the DB trigger recalculates `average_cost` as soon as the movement lands.
 * Reading it afterwards would value the sale at the post-sale average.
 *
 * Never throws: a sale that has already been recorded must not be rolled
 * back because stock accounting failed.
 */
export async function deductStockAndPostCogs(
  businessId: string,
  invoice: Pick<Row<'invoices'>, 'id' | 'invoice_number' | 'issue_date'>,
  saleLines: { productId: string; quantity: number }[],
  branchId: string | null,
  departmentId: string | null,
  createdBy: string | null,
): Promise<{ costLines: SaleCostLine[]; cogsEntryId: string | null }> {
  const linesWithProducts = saleLines.filter((l) => l.productId && Number(l.quantity) > 0);
  if (linesWithProducts.length === 0) return { costLines: [], cogsEntryId: null };

  try {
    const locations = await repos.inventory.findLocations(businessId);
    let targetLocation = branchId ? locations.find((l) => l.branch_id === branchId) : null;
    if (!targetLocation) {
      targetLocation = locations.find((l) => l.is_default) ?? locations[0] ?? null;
    }
    if (!targetLocation) {
      log.warn(
        `No stock location for business ${businessId} — stock not adjusted for invoice ${invoice.invoice_number}.`,
      );
      return { costLines: [], cogsEntryId: null };
    }

    const costLines: SaleCostLine[] = [];
    const movements = [];
    for (const line of linesWithProducts) {
      const balance = await repos.inventory.findBalance(businessId, line.productId, targetLocation.id);
      const unitCost = balance ? Number(balance.average_cost) : 0;
      costLines.push({ productId: line.productId, quantity: line.quantity, unitCost });
      movements.push({
        business_id: businessId,
        product_id: line.productId,
        location_id: targetLocation.id,
        movement_type: 'sale' as const,
        movement_date: invoice.issue_date,
        quantity: -line.quantity,
        unit_cost: unitCost,
        source_type: 'invoice',
        source_id: invoice.id,
        reference: invoice.invoice_number,
        created_by: createdBy,
      });
    }

    await repos.inventory.recordMovements(movements);

    const cogsEntryId = await postCogsForSale(
      businessId, invoice, costLines, branchId, departmentId,
    );
    return { costLines, cogsEntryId };
  } catch (err) {
    log.error(
      `Stock deduction failed for invoice ${invoice.invoice_number}.`,
      err as Error,
    );
    return { costLines: [], cogsEntryId: null };
  }
}

// ── Posting: warehouse receipt with no supplier invoice ──────────────────────

/**
 * Posts a direct warehouse receipt: DR Inventory / CR Goods Received Not
 * Invoiced.
 *
 * "Receive Stock" on the Warehouse page has a quantity and a unit cost but
 * no supplier document, so the credit cannot go to cash or to a specific
 * creditor. GRNI (2114) is the standard holding account for exactly this —
 * goods are on the shelf and owed for, but not yet invoiced.
 *
 * Without this the receipt would move the subledger and leave the ledger
 * behind, recreating the very divergence this module exists to prevent.
 */
export async function postWarehouseReceipt(
  businessId: string,
  receiptLines: ReceiptCostLine[],
  movementDate: string,
  reference: string | null,
  branchId?: string | null,
  departmentId?: string | null,
): Promise<string | null> {
  try {
    const valued = receiptLines.filter((l) => Number(l.quantity) > 0 && Number(l.unitCost) > 0);
    if (valued.length === 0) return null;

    const products = await loadProducts(businessId, valued.map((l) => l.productId));
    const productById = new Map(products.map((p) => [p.id, p]));

    const debitsByAccount = new Map<string, number>();
    let total = 0;

    for (const line of valued) {
      const product = productById.get(line.productId) ?? null;
      const inventoryAccount = await resolveInventoryAccount(businessId, product);
      const amount = roundMoney(Number(line.quantity) * Number(line.unitCost));
      debitsByAccount.set(
        inventoryAccount.id,
        roundMoney((debitsByAccount.get(inventoryAccount.id) ?? 0) + amount),
      );
      total = roundMoney(total + amount);
    }

    if (total < TOLERANCE) return null;

    const grni = assertPostable(await getAccountByCode(businessId, GRNI_ACCOUNT_CODE), 'GRNI');
    const currency = await functionalCurrencyFor(businessId);
    const label = reference ? `Stock receipt ${reference}` : 'Stock receipt';

    const lines: JournalLineInput[] = [];
    let lineNumber = 1;
    for (const [accountId, amount] of debitsByAccount) {
      lines.push(functionalLine(
        lineNumber++, accountId, label, true, amount, currency, branchId, departmentId,
      ));
    }
    lines.push(functionalLine(
      lineNumber, grni.id, `${label} — awaiting supplier invoice`,
      false, total, currency, branchId, departmentId,
    ));

    const { entry } = await repos.journal.createBalancedEntry(
      {
        business_id: businessId,
        entry_number: inventoryEntryNumber('GRN'),
        entry_date: movementDate,
        description: `${label} — goods received not invoiced`,
        source_type: 'stock_receipt',
        source_id: null,
        currency,
        exchange_rate: 1,
        status: 'draft',
        branch_id: branchId ?? null,
        department_id: departmentId ?? null,
      },
      lines,
    );

    await repos.journal.post(entry.id, null);
    return entry.id;
  } catch (err) {
    log.error(
      'Failed to post the GL entry for a warehouse receipt. ' +
      'Stock levels are updated; run the Warehouse → Ledger reconciliation to correct the balance sheet.',
      err as Error,
    );
    return null;
  }
}

// ── Posting: manual stock movement (adjustment / opening balance) ────────────

/**
 * Posts the GL side of a manually recorded stock movement.
 *
 *   stock in  (adjustment_in, purchase, opening_balance)
 *       DR Inventory / CR Inventory Adjustments
 *   stock out (adjustment_out)
 *       DR Inventory Adjustments / CR Inventory
 *
 * `opening_balance` is included deliberately: an opening stock figure is
 * precisely the case where inventory must appear on the balance sheet from
 * day one, and it was previously the most common way to end up with stock
 * on hand and nothing under Current Assets.
 *
 * The contra account is 5180 rather than a specific expense: a manual
 * adjustment has no supplier and no customer, so the offset is a variance
 * by definition. Where the movement represents a genuine purchase the user
 * should record it as an expense instead, which routes through
 * resolveExpenseLineAccountId and credits cash or creditors properly.
 */
export async function postStockMovementAdjustment(
  businessId: string,
  movement: {
    productId: string;
    /** Always positive; direction comes from movementType. */
    quantity: number;
    unitCost: number;
    movementType: string;
    movementDate: string;
    reference?: string | null;
  },
): Promise<string | null> {
  try {
    const quantity = Math.abs(Number(movement.quantity));
    const amount = roundMoney(quantity * Number(movement.unitCost));
    if (amount < TOLERANCE) return null;

    const products = await loadProducts(businessId, [movement.productId]);
    const product = products[0] ?? null;

    // Non-tracked products carry no balance-sheet value, so there is
    // nothing to capitalise.
    if (product && !product.track_inventory) return null;

    const [inventoryAccount, adjustmentAccount] = await Promise.all([
      resolveInventoryAccount(businessId, product),
      getAccountByCode(businessId, INVENTORY_ADJUSTMENT_ACCOUNT_CODE)
        .then((a) => assertPostable(a, 'Inventory adjustment')),
    ]);

    const isStockIn = movement.movementType !== 'adjustment_out'
      && movement.movementType !== 'transfer_out'
      && movement.movementType !== 'return_out';

    const currency = await functionalCurrencyFor(businessId);
    const label = movement.reference
      ? `Stock ${movement.movementType.replace(/_/g, ' ')} — ${movement.reference}`
      : `Stock ${movement.movementType.replace(/_/g, ' ')}`;

    const lines: JournalLineInput[] = isStockIn
      ? [
          functionalLine(1, inventoryAccount.id, label, true, amount, currency),
          functionalLine(2, adjustmentAccount.id, label, false, amount, currency),
        ]
      : [
          functionalLine(1, adjustmentAccount.id, label, true, amount, currency),
          functionalLine(2, inventoryAccount.id, label, false, amount, currency),
        ];

    const { entry } = await repos.journal.createBalancedEntry(
      {
        business_id: businessId,
        entry_number: inventoryEntryNumber('STK'),
        entry_date: movement.movementDate,
        description: label,
        source_type: 'stock_adjustment',
        source_id: null,
        currency,
        exchange_rate: 1,
        status: 'draft',
      },
      lines,
    );

    await repos.journal.post(entry.id, null);
    return entry.id;
  } catch (err) {
    log.error(
      'Failed to post the GL entry for a manual stock movement. ' +
      'Stock levels are updated; use Warehouse → Ledger reconciliation to correct the balance sheet.',
      err as Error,
    );
    return null;
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Every GL account that can hold stock for this business: the seeded 114x
 * block plus any account a product explicitly points at. Covers businesses
 * that renamed or added their own inventory accounts.
 */
async function findInventoryAccounts(businessId: string): Promise<Row<'accounts'>[]> {
  const all = await repos.account.findByBusiness(businessId);
  const products = await repos.inventory.findAllProducts(businessId);

  const linkedIds = new Set(
    products
      .map((p) => p.inventory_account_id)
      .filter((id): id is string => Boolean(id)),
  );

  return all.filter(
    (a) =>
      !a.is_group &&
      (a.code.startsWith(INVENTORY_CODE_PREFIX) || linkedIds.has(a.id)),
  );
}

/**
 * Balance of the inventory GL accounts as at a date.
 *
 * Mirrors FinancialStatementRepository.computeBalances precisely — posted
 * and reversed entries only, `amount_base` only, plus `opening_balance` —
 * so the number here is the same number the SOFP prints. Any other method
 * would produce a variance that disagrees with the balance sheet.
 */
async function computeInventoryLedgerBalance(
  businessId: string,
  accounts: Row<'accounts'>[],
  asOfDate: string,
): Promise<Map<string, number>> {
  const balances = new Map<string, number>(
    accounts.map((a) => [a.id, Number(a.opening_balance ?? 0)]),
  );
  if (accounts.length === 0) return balances;

  const { data, error } = await repos.account.db
    .from('journal_lines')
    .select('account_id, is_debit, amount_base, journal_entries!inner(entry_date, status, business_id)')
    .eq('business_id', businessId)
    .eq('journal_entries.business_id', businessId)
    .in('journal_entries.status', ['posted', 'reversed'])
    .lte('journal_entries.entry_date', asOfDate)
    .in('account_id', accounts.map((a) => a.id));

  if (error) throw new Error(`Could not read inventory ledger balance: ${error.message}`);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const line of (data ?? []) as unknown as {
    account_id: string; is_debit: boolean; amount_base: number;
  }[]) {
    const account = accountById.get(line.account_id);
    if (!account) continue;
    const signed = line.is_debit ? Number(line.amount_base) : -Number(line.amount_base);
    // Normalise onto the account's natural side, as computeBalances does.
    const natural = account.normal_balance === 'debit' ? signed : -signed;
    balances.set(line.account_id, (balances.get(line.account_id) ?? 0) + natural);
  }

  return balances;
}

/**
 * Compares the stock subledger against the inventory GL accounts.
 *
 * This is both the catch-up mechanism for historical data recorded before
 * perpetual inventory existed, and an ongoing period-end control.
 */
export async function reconcileInventoryToLedger(
  businessId: string,
  asOfDate: string,
): Promise<InventoryReconciliation> {
  const [accounts, stockBalances] = await Promise.all([
    findInventoryAccounts(businessId),
    repos.inventory.findAllWithDetails(businessId),
  ]);

  const subledgerValue = roundMoney(computeStockValue(stockBalances));
  const balanceById = await computeInventoryLedgerBalance(businessId, accounts, asOfDate);
  const ledgerBalance = roundMoney(
    [...balanceById.values()].reduce((s, v) => s + v, 0),
  );

  const { variance, isReconciled } = computeInventoryVariance(subledgerValue, ledgerBalance);

  return {
    asOfDate,
    subledgerValue,
    ledgerBalance,
    variance,
    isReconciled,
    accounts: accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      balance: roundMoney(balanceById.get(a.id) ?? 0),
    })),
  };
}

/**
 * Posts the adjusting entry that brings the inventory GL account into
 * agreement with the stock subledger.
 *
 *   ledger understates stock   DR Inventory        CR 5180 Inventory Adj
 *   ledger overstates stock    DR 5180 Inventory Adj  CR Inventory
 *
 * For a business migrating from the old expense-everything behaviour the
 * credit to 5180 is exactly the closing-stock adjustment that periodic
 * inventory would post at year end: it removes the cost of unsold goods
 * from cost of sales and puts it on the balance sheet where it belongs.
 *
 * 5180 sits under cost_of_sales, so gross profit corrects by the same
 * amount whether the original mis-posting went to 5100 or elsewhere.
 *
 * Unlike the automatic postings above this one DOES throw on failure — it
 * is an explicit, user-initiated action and silently doing nothing would
 * be worse than an error message.
 */
export async function postInventoryReconciliationAdjustment(
  businessId: string,
  asOfDate: string,
  note?: string,
): Promise<{ entryId: string; variance: number } | null> {
  const reconciliation = await reconcileInventoryToLedger(businessId, asOfDate);
  if (reconciliation.isReconciled) return null;

  const { variance } = reconciliation;
  const amount = roundMoney(Math.abs(variance));

  const [inventoryAccount, adjustmentAccount] = await Promise.all([
    getAccountByCode(businessId, DEFAULT_INVENTORY_ACCOUNT_CODE).then((a) =>
      assertPostable(a, 'Inventory')),
    getAccountByCode(businessId, INVENTORY_ADJUSTMENT_ACCOUNT_CODE).then((a) =>
      assertPostable(a, 'Inventory adjustment')),
  ]);

  const currency = await functionalCurrencyFor(businessId);
  const ledgerUnderstates = variance > 0;
  const description = note?.trim()
    ? `Inventory reconciliation — ${note.trim()}`
    : 'Inventory reconciliation to stock subledger';

  const lines: JournalLineInput[] = ledgerUnderstates
    ? [
        functionalLine(1, inventoryAccount.id, description, true, amount, currency),
        functionalLine(2, adjustmentAccount.id, description, false, amount, currency),
      ]
    : [
        functionalLine(1, adjustmentAccount.id, description, true, amount, currency),
        functionalLine(2, inventoryAccount.id, description, false, amount, currency),
      ];

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: businessId,
      entry_number: inventoryEntryNumber('INVADJ'),
      entry_date: asOfDate,
      description,
      source_type: 'inventory_reconciliation',
      source_id: null,
      currency,
      exchange_rate: 1,
      status: 'draft',
    },
    lines,
  );

  await repos.journal.post(entry.id, null);
  return { entryId: entry.id, variance };
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function loadProducts(businessId: string, productIds: string[]): Promise<Row<'products'>[]> {
  const distinct = [...new Set(productIds.filter(Boolean))];
  if (distinct.length === 0) return [];
  const all = await repos.inventory.findAllProducts(businessId);
  const wanted = new Set(distinct);
  return all.filter((p) => wanted.has(p.id));
}

async function buildProductAccountMap(
  businessId: string,
  products: Row<'products'>[],
): Promise<Map<string, { inventoryAccountId: string; cogsAccountId: string }>> {
  const map = new Map<string, { inventoryAccountId: string; cogsAccountId: string }>();
  for (const product of products) {
    // Only inventory-tracked products carry a balance-sheet cost to release.
    // A non-tracked product was already expensed when it was bought, so
    // posting COGS again here would double count it.
    if (!product.track_inventory) continue;
    const [inventoryAccount, cogsAccount] = await Promise.all([
      resolveInventoryAccount(businessId, product),
      resolveCogsAccount(businessId, product),
    ]);
    map.set(product.id, {
      inventoryAccountId: inventoryAccount.id,
      cogsAccountId: cogsAccount.id,
    });
  }
  return map;
}
