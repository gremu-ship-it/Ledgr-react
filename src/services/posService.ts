import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';
import type { InsertDto, PaymentMethod, Row } from '@/dal/types/database';
import type { PosSaleQueuePayload } from '@/offline/payloads';
import { retryNonCritical } from '@/lib/nonCriticalRetry';
import { postPosSaleViaRpc, type PosSaleRpcResult } from '@/services/posSaleRpc';
import { refundPosSaleViaRpc, voidPosSaleViaRpc } from '@/services/posCorrectionRpc';
import { isDemoMode } from '@/lib/demo/mode';
import type {
  PosPaymentSplit,
  PosSalePayload,
  PosSaleResult,
  PosReturnPayload,
  PosVoidPayload,
  PosCartItem,
  PosDiscount,
  PosCartTotals,
  PosPaymentMethod,
  PosProduct,
} from '@/types/pos';
import {
  createInvoiceReceivableEntry,
  createInvoiceSettlementEntry,
} from '@/services/journalService';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { usageService } from '@/lib/billing/UsageService';
import { enqueue, generateOfflineNumber, isOfflineError } from '@/offline/queueApi';
import { newSaveClientKey } from '@/services/quickSaveService';
import { deriveClientKey } from '@/lib/clientKeys';

const log = createLogger('PosService');

// ── Receipt Number Generation ───────────────────────────────────────────────

export function generateReceiptNumber(prefix = 'REC'): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const time = String(d.getTime()).slice(-5);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${year}${month}${day}-${time}${rand}`;
}

// ── Cart Calculations ───────────────────────────────────────────────────────

export function calculateCartTotals(
  items: PosCartItem[],
  orderDiscount?: PosDiscount,
  defaultTaxRate = 0,
): PosCartTotals {
  let gross_total = 0;
  let line_discount_total = 0;
  let item_count = 0;

  items.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price ?? item.unitPrice ?? 0);
    const lineGross = qty * price;
    gross_total += lineGross;
    item_count += qty;

    if (item.discount) {
      if (item.discount.type === 'percent') {
        line_discount_total += (lineGross * Math.min(100, Math.max(0, item.discount.value))) / 100;
      } else {
        line_discount_total += Math.min(lineGross, Math.max(0, item.discount.value));
      }
    } else if (item.discountPercent) {
      line_discount_total += (lineGross * Math.min(100, Math.max(0, item.discountPercent))) / 100;
    }
  });

  const subtotalAfterLineDiscounts = Math.max(0, gross_total - line_discount_total);

  let order_discount_amount = 0;
  if (orderDiscount && orderDiscount.value > 0) {
    if (orderDiscount.type === 'percent') {
      order_discount_amount = (subtotalAfterLineDiscounts * Math.min(100, orderDiscount.value)) / 100;
    } else {
      order_discount_amount = Math.min(subtotalAfterLineDiscounts, orderDiscount.value);
    }
  }

  const discount_total = Math.round((line_discount_total + order_discount_amount) * 100) / 100;
  const taxable_subtotal = Math.max(0, gross_total - discount_total);

  // Calculate tax (Malawi VAT inclusive/exclusive standard)
  let tax_total = 0;
  if (defaultTaxRate > 0) {
    tax_total = Math.round((taxable_subtotal - (taxable_subtotal / (1 + defaultTaxRate / 100))) * 100) / 100;
  }

  const net_payable = Math.round(taxable_subtotal * 100) / 100;

  return {
    gross_total: Math.round(gross_total * 100) / 100,
    discount_total,
    taxable_subtotal: Math.round(taxable_subtotal * 100) / 100,
    tax_total,
    net_payable,
    item_count,
  };
}

// ── Cart State Helpers ──────────────────────────────────────────────────────

export function addProductToCart(
  currentItems: PosCartItem[],
  product: PosProduct | (Partial<PosCartItem> & { name: string; selling_price?: number; cost_price?: number }),
): PosCartItem[] {
  const pId = ('id' in product && product.id) || product.product_id || product.productId || 'item';
  const existingIdx = currentItems.findIndex((it) => (it.product_id || it.productId) === pId);

  const unitPrice = Number(product.unit_price ?? product.unitPrice ?? product.selling_price ?? ('sale_price' in product ? product.sale_price : 0) ?? 0);
  const costPrice = Number(product.cost_price ?? ('purchase_price' in product ? product.purchase_price : 0) ?? product.unit_cost ?? ('unitCost' in product ? product.unitCost : 0) ?? 0);

  if (existingIdx >= 0) {
    return currentItems.map((it, idx) => {
      if (idx !== existingIdx) return it;
      const newQty = it.quantity + 1;
      const baseTotal = newQty * unitPrice;
      const disc = it.discount?.type === 'percent' ? (baseTotal * it.discount.value) / 100 : (it.discount?.value || 0);
      return {
        ...it,
        quantity: newQty,
        line_total: Math.max(0, baseTotal - disc),
        lineTotal: Math.max(0, baseTotal - disc),
      };
    });
  }

  const newItem: PosCartItem = {
    product_id: pId,
    productId: pId,
    name: product.name,
    sku: product.sku || null,
    barcode: product.barcode || null,
    category: product.category || null,
    quantity: 1,
    unit_price: unitPrice,
    unitPrice: unitPrice,
    unit_cost: costPrice,
    line_total: unitPrice,
    lineTotal: unitPrice,
  };

  return [...currentItems, newItem];
}

export function updateCartItemQuantity(currentItems: PosCartItem[], productId: string, quantity: number): PosCartItem[] {
  if (quantity <= 0) {
    return removeProductFromCart(currentItems, productId);
  }
  return currentItems.map((it) => {
    if ((it.product_id || it.productId) !== productId) return it;
    const unitPrice = Number(it.unit_price ?? it.unitPrice ?? 0);
    const baseTotal = quantity * unitPrice;
    const disc = it.discount?.type === 'percent' ? (baseTotal * it.discount.value) / 100 : (it.discount?.value || 0);
    return {
      ...it,
      quantity,
      line_total: Math.max(0, baseTotal - disc),
      lineTotal: Math.max(0, baseTotal - disc),
    };
  });
}

export function removeProductFromCart(currentItems: PosCartItem[], productId: string): PosCartItem[] {
  return currentItems.filter((it) => (it.product_id || it.productId) !== productId);
}

export function clearCart(): PosCartItem[] {
  return [];
}

export function applyItemDiscount(currentItems: PosCartItem[], productId: string, discount?: PosDiscount): PosCartItem[] {
  return currentItems.map((it) => {
    if ((it.product_id || it.productId) !== productId) return it;
    const unitPrice = Number(it.unit_price ?? it.unitPrice ?? 0);
    const baseTotal = it.quantity * unitPrice;
    const discAmount = discount?.type === 'percent' ? (baseTotal * discount.value) / 100 : (discount?.value || 0);
    return {
      ...it,
      discount,
      discountPercent: discount?.type === 'percent' ? discount.value : undefined,
      line_total: Math.max(0, baseTotal - discAmount),
      lineTotal: Math.max(0, baseTotal - discAmount),
    };
  });
}

export function applyOrderDiscount(_currentItems: PosCartItem[], discount?: PosDiscount): PosDiscount | undefined {
  return discount;
}

// ── Complete POS Sale ───────────────────────────────────────────────────────

/**
 * Sentinel contact id a queued offline sale carries until the sync handler
 * resolves a real contact. Matches the sentinel the income queue already uses,
 * so both paths resolve walk-in customers the same way.
 */
export const OFFLINE_WALK_IN_CONTACT_ID = 'offline_walk_in_customer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POS payment methods → the DB `payment_method` enum.
 *
 * 'credit'/'credit_sale' are not money received, so they never become payment
 * rows; they only drive the invoice's status and due date. The DB enum has no
 * credit value at all — that mapping is deliberate, not an oversight.
 */
const POS_TO_DB_PAYMENT_METHOD: Record<PosPaymentMethod, PaymentMethod> = {
  cash: 'cash',
  airtel_money: 'airtel_money',
  tnm_mpamba: 'tnm_mpamba',
  bank_transfer: 'bank_transfer',
  card: 'card',
  other: 'other',
  credit: 'other',
  credit_sale: 'other',
};

function isCreditMethod(method: PosPaymentMethod): boolean {
  return method === 'credit' || method === 'credit_sale';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A payment leg that represents money actually taken at the till. */
export interface PosPaymentLeg {
  payment_method: PaymentMethod;
  amount: number;
  reference?: string | null;
  bank_account_id?: string | null;
}

/** A POS sale after parsing: single representation shared by every write path. */
export interface NormalizedPosSale {
  businessId: string;
  branchId: string | null;
  shiftId: string | null;
  customerId: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  cashierId: string | null;
  cashierName: string;
  items: PosCartItem[];
  /** Money received, in DB enum terms. Credit legs are excluded. */
  payments: PosPaymentLeg[];
  totals: PosCartTotals;
  isCreditSale: boolean;
  totalPaid: number;
  changeGiven: number;
  notes?: string;
  dueDate?: string;
  managerApproval?: { approverName: string; reason: string } | null;
  receiptNumber: string;
  clientKey: string;
  issueDate: string;
  /** Placeholder ('POS-OFFLINE-…') until the server reserves the real number. */
  invoiceNumber?: string;
}

export interface NormalizePosSaleOptions {
  /** Stable idempotency key; reused across retries of one logical sale. */
  clientKey?: string;
  /** Human receipt reference. Generated when absent. */
  receiptNumber?: string;
  /** Pre-reserved document number, when a caller already has one. */
  invoiceNumber?: string;
}

/**
 * Parses a caller-supplied `PosSalePayload` (two spellings for most fields)
 * into the one shape every write path below works with, and enforces the two
 * rules that make a sale valid: it has items, and a non-credit sale was
 * actually paid for.
 */
export function normalizePosSale(
  payload: PosSalePayload,
  options: NormalizePosSaleOptions = {},
): NormalizedPosSale {
  const businessId = payload.businessId || payload.business_id;
  if (!businessId) {
    throw new Error(
      'Cannot record a POS sale without a business. Reload the page or select a business first.',
    );
  }

  const items: PosCartItem[] = payload.items || [];
  if (items.length === 0) {
    throw new Error('Cart is empty. Please add items to complete sale.');
  }

  const orderDiscount = payload.orderDiscount || payload.order_discount;
  const totals = payload.totals || calculateCartTotals(items, orderDiscount);
  const totalPaid = Number(payload.totalPaid ?? payload.total_paid ?? 0);
  const changeGiven = Number(payload.changeGiven ?? payload.change_given ?? 0);

  const rawPayments = payload.payments ||
    payload.payment_splits || [{ payment_method: 'cash' as PosPaymentMethod, amount: totalPaid }];

  // Payment methods arrive under two spellings ('method'/'payment_method') and
  // may be absent entirely, in which case the till took cash.
  const paymentMethodOf = (p: PosPaymentSplit): PosPaymentMethod =>
    p.payment_method ?? p.method ?? 'cash';

  const isCreditSale = Boolean(
    payload.isCreditSale ||
    payload.is_credit_sale ||
    rawPayments.some((p) => isCreditMethod(paymentMethodOf(p))),
  );

  if (!isCreditSale && totalPaid < totals.net_payable - 0.05) {
    throw new Error(
      `Tendered payment (${totalPaid}) is less than net payable (${totals.net_payable}).`,
    );
  }

  const payments: PosPaymentLeg[] = rawPayments
    .filter((p) => !isCreditMethod(paymentMethodOf(p)) && Number(p.amount) > 0)
    .map((p) => ({
      payment_method: POS_TO_DB_PAYMENT_METHOD[paymentMethodOf(p)] ?? 'other',
      amount: Number(p.amount) || 0,
      reference: p.reference ?? null,
      bank_account_id: p.bank_account_id ?? null,
    }));

  const customerId = payload.customerId ?? payload.customer_id ?? null;

  return {
    businessId,
    branchId: payload.branchId ?? payload.branch_id ?? null,
    shiftId: payload.shiftId ?? payload.shift_id ?? null,
    customerId,
    customerName: payload.customerName || payload.customer_name || 'Walk-in Customer',
    customerPhone: payload.customerPhone || payload.customer_phone || null,
    customerEmail: payload.customerEmail || payload.customer_email || null,
    cashierId: payload.cashierId ?? payload.cashier_id ?? null,
    cashierName: payload.cashierName || payload.cashier_name || 'Cashier',
    items,
    payments,
    totals,
    isCreditSale,
    totalPaid,
    changeGiven,
    notes: payload.notes,
    dueDate: payload.dueDate || payload.due_date,
    managerApproval: payload.managerApproval ?? null,
    receiptNumber: options.receiptNumber ?? generateReceiptNumber('REC'),
    clientKey: options.clientKey ?? payload.clientKey ?? newSaveClientKey(),
    issueDate: new Date().toISOString().slice(0, 10),
    invoiceNumber: options.invoiceNumber,
  };
}

/**
 * Builds the complete set of records a sale turns into, with no I/O at all.
 *
 * This is the single definition of "what a POS sale writes": the online till
 * commits it immediately, the offline till stores it in the queue and commits
 * the exact same payload when connectivity returns. Anything that differs
 * between a synced offline sale and an online sale is therefore a bug in
 * `commitPosSaleDocuments`, not a fork in the two code paths.
 */
export function buildPosSaleQueuePayload(
  payload: PosSalePayload,
  options: NormalizePosSaleOptions = {},
): PosSaleQueuePayload {
  const sale = normalizePosSale(payload, options);
  const { totals, businessId, branchId, isCreditSale } = sale;

  // amount_paid is owned by the invoice_payments rows: recordPayment()
  // increments it atomically for every row we insert below. Setting the full
  // net payable on the header as well would count every shilling twice, which
  // is exactly what left POS invoices with amount_paid at 2× the sale and a
  // negative amount due (and, on the header, status 'paid' with no cash row).
  // Only the part of the sale that no payment row covers is set directly.
  const coveredByPayments = round2(sale.payments.reduce((sum, p) => sum + p.amount, 0));
  const headerAmountPaid = isCreditSale
    ? 0
    : Math.max(0, round2(totals.net_payable - coveredByPayments));

  // Header money. `subtotal` has to mean the same thing here as it does on
  // every other invoice in the app — VAT-exclusive and net of discount — or
  // the postings break: `createInvoiceJournalEntry` credits revenue with
  // `subtotal + discount_amount` (gross disclosure) and debits the discount to
  // 4130, so a pre-discount `subtotal` double-counts the discount and the entry
  // no longer balances. The Invoices view reads the same field as "Net
  // Subtotal", and the quick-save RPC asserts `subtotal + vat = total`.
  //
  // Till prices are VAT-inclusive (Malawi retail), so the VAT-exclusive
  // subtotal is what the customer pays (`taxable_subtotal`) less the tax
  // already inside it (`tax_total`). With the POS VAT rate at 0 this is
  // exactly the old `taxable_subtotal`, which is what the till posted before.
  const vatExclusiveSubtotal = round2(totals.taxable_subtotal - totals.tax_total);

  const invoice = {
    business_id: businessId,
    // Placeholder until commit reserves the real sequence number. Keeping the
    // marker means the sync handler knows to reserve one, and a retry after a
    // lost response does not burn a second number.
    invoice_number: sale.invoiceNumber ?? generateOfflineNumber('POS'),
    invoice_type: 'invoice',
    // Inserted as 'sent' and driven to paid/partially_paid by the payment rows.
    // Inserting 'paid' up front would claim money we have not recorded yet —
    // if a payment row then failed, the invoice would show as settled with an
    // empty cash history.
    status: 'sent',
    contact_id: sale.customerId ?? OFFLINE_WALK_IN_CONTACT_ID,
    issue_date: sale.issueDate,
    due_date: isCreditSale ? (sale.dueDate || sale.issueDate) : sale.issueDate,
    currency: 'MWK',
    exchange_rate: 1,
    subtotal: vatExclusiveSubtotal,
    discount_amount: totals.discount_total,
    discount_percent: totals.gross_total > 0
      ? Math.round((totals.discount_total / totals.gross_total) * 100)
      : 0,
    taxable_amount: vatExclusiveSubtotal,
    vat_amount: totals.tax_total,
    wht_amount: 0,
    total_amount: totals.net_payable,
    amount_paid: headerAmountPaid,
    // Resolved at commit time when the till was offline (the accounts table was
    // unreachable); journalService falls back to the standard revenue account.
    revenue_account_id: null,
    notes: sale.notes
      ? `${sale.notes} (Receipt: ${sale.receiptNumber})`
      : `POS Sale Receipt ${sale.receiptNumber}`,
    payment_reference: sale.receiptNumber,
    created_by: sale.cashierName,
    branch_id: branchId,
    client_key: sale.clientKey,
  } as InsertDto<'invoices'>;

  const lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[] = sale.items.map(
    (item, index) => {
      const unitPrice = Number(item.unit_price ?? item.unitPrice ?? 0);
      const lineTotal = Number(item.line_total ?? item.lineTotal ?? unitPrice * item.quantity);
      return {
        line_number: index + 1,
        description: item.name + (item.sku ? ` [${item.sku}]` : ''),
        quantity: item.quantity,
        unit_price: unitPrice,
        discount_percent: item.discount?.type === 'percent' ? item.discount.value : 0,
        discount_amount: item.discount ? item.quantity * unitPrice - lineTotal : 0,
        tax_code: 'none' as const,
        tax_rate: item.tax_rate || 0,
        tax_amount: 0,
        line_total: lineTotal,
        // Filled in at commit time from the business's revenue account.
        account_id: null,
        product_id: item.product_id || item.productId || null,
      };
    },
  );

  const payments: Omit<InsertDto<'invoice_payments'>, 'invoice_id' | 'business_id'>[] =
    sale.payments.map((p) => ({
      amount: p.amount,
      payment_date: sale.issueDate,
      payment_method: p.payment_method,
      bank_account_id: p.bank_account_id ?? null,
      reference: p.reference ?? null,
      notes: `POS Payment: ${p.payment_method} for ${sale.receiptNumber}`,
      currency: 'MWK',
      exchange_rate: 1,
      created_by: sale.cashierName,
    }));

  const cashSales = round2(
    sale.payments.filter((p) => p.payment_method === 'cash').reduce((s, p) => s + p.amount, 0),
  );
  const otherSales = round2(
    sale.payments.filter((p) => p.payment_method !== 'cash').reduce((s, p) => s + p.amount, 0),
  );

  return {
    invoice,
    lines,
    payments,
    customer: {
      name: sale.customerName,
      phone: sale.customerPhone ?? null,
      email: sale.customerEmail ?? null,
    },
    shiftId: sale.shiftId,
    cashSales,
    otherSales,
    receiptNumber: sale.receiptNumber,
    cashierId: sale.cashierId,
    cashierName: sale.cashierName,
    isCreditSale,
    total: totals.net_payable,
    itemCount: totals.item_count,
    notes: sale.notes,
  };
}

/**
 * The balance-sheet account a tender leg actually lands in.
 *
 * `invoice_payments.bank_account_id` is the column the invoice-payment screen
 * already uses to say *where* a payment went, and `createInvoiceSettlementEntry`
 * debits it. The till historically left it null for every method, so card and
 * mobile-money takings were posted to 1110 Cash on Hand alongside the notes —
 * the drawer then overstates the cash count at shift close by exactly those
 * takings.
 *
 * Resolution happens here, at commit time, not at the till: an offline till has
 * no accounts table to read, and this runs again on sync when it does.
 *
 *   cash                      -> null (settlement defaults to 1110 Cash on Hand)
 *   airtel_money / tnm_mpamba  -> 1125 / 1126 mobile-money floats
 *   card / bank_transfer / …   -> the business's bank account
 *
 * An unresolvable non-cash tender still posts (to cash on hand, as before) but
 * says so in a warning instead of failing the sale: the money was taken, and a
 * misclassified account is a smaller problem than a sale with no ledger entry.
 */
async function resolveTenderAccountId(
  businessId: string,
  payment: Omit<InsertDto<'invoice_payments'>, 'invoice_id' | 'business_id'>,
): Promise<{ accountId: string | null; warning?: string }> {
  if (payment.bank_account_id) return { accountId: payment.bank_account_id };

  const method = String(payment.payment_method ?? 'cash');
  if (method === 'cash') return { accountId: null };

  const mobileMoneyCode =
    method === 'airtel_money' ? '1125' : method === 'tnm_mpamba' ? '1126' : null;
  if (mobileMoneyCode) {
    const account = await repos.account.findByCode(businessId, mobileMoneyCode).catch(() => null);
    if (account) return { accountId: account.id };
    return {
      accountId: null,
      warning: `No account ${mobileMoneyCode} for this business — the ${method} takings were posted to cash on hand instead.`,
    };
  }

  const banks = await repos.account.findBankAccounts(businessId).catch(() => []);
  if (banks[0]) return { accountId: banks[0].id };
  return {
    accountId: null,
    warning: `No bank account on file — the ${method} takings were posted to cash on hand instead.`,
  };
}

/**
 * Raised when the sale document exists but a step that belongs to it failed
 * for a reason retrying cannot fix. The invoice id is carried so callers can
 * tell the cashier which document to look at instead of re-ringing the sale
 * (which would duplicate revenue and stock).
 */
export class PosSalePostCommitError extends Error {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly stage: string;

  constructor(
    message: string,
    invoice: { id: string; invoice_number: string },
    stage: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PosSalePostCommitError';
    this.invoiceId = invoice.id;
    this.invoiceNumber = invoice.invoice_number;
    this.stage = stage;
  }
}

export interface PosSaleCommitOptions {
  /** Overrides the payload's business id (queue items scope by tenant). */
  businessId?: string;
  /** Idempotency key for the document and every row derived from it. */
  clientKey?: string;
}

export interface PosSaleCommitResult {
  invoice: Row<'invoices'>;
  lines: Row<'invoice_lines'>[];
  /** Warnings for steps that failed without endangering the sale. */
  warnings: string[];
}

/**
 * Writes a POS sale to the server, from a payload built by
 * `buildPosSaleQueuePayload`. Used for online sales and for queued offline
 * sales when they sync — identical in both cases.
 *
 * Since stage 2 of docs/database/pos-sale-posting-rpc.md the sale is posted
 * server-side by `post_pos_sale`, in one transaction; the client-side path
 * below is only reached when that function does not exist yet in the
 * environment (frontend deployed ahead of `supabase db push`). Both paths are
 * idempotent on the same client key, so whichever one commits, a retry — on
 * either path — returns the committed sale instead of a second one.
 */
export async function commitPosSaleDocuments(
  payload: PosSaleQueuePayload,
  options: PosSaleCommitOptions = {},
): Promise<PosSaleCommitResult> {
  const businessId = options.businessId ?? payload.invoice.business_id;
  const clientKey = options.clientKey ?? payload.invoice.client_key ?? newSaveClientKey();

  // Server-side posting (stage 2 of docs/database/pos-sale-posting-rpc.md).
  // One transaction writes the invoice, its tenders, the ledger and the stock
  // release; the RPC is idempotent on the same client key, so a replay returns
  // the committed sale and completes it if an earlier attempt left it
  // half-posted. Falling back to the legacy path below is required while the
  // function may not exist yet in an environment (PGRST202) — the RPC has no
  // other caller and stage 3's policy narrowing is only safe once every
  // environment is on this path.
  const rpcSale = await postPosSaleViaRpc(payload, businessId, clientKey);
  if (rpcSale) {
    return loadCommittedPosSale(businessId, rpcSale);
  }

  log.info('post_pos_sale unavailable — falling back to the client-side sale path', {
    businessId,
    receiptNumber: payload.receiptNumber,
  });
  return commitPosSaleDocumentsLegacy(payload, { businessId, clientKey });
}

/**
 * Reads back what an RPC-posted sale wrote, so callers keep receiving the same
 * shape as the legacy path. Every write already happened inside the RPC's
 * transaction; this is a read of a business the caller is a member of, so it
 * needs no elevated access.
 */
async function loadCommittedPosSale(
  businessId: string,
  rpcSale: PosSaleRpcResult,
): Promise<PosSaleCommitResult> {
  const { invoice, lines } = await repos.invoice.findByIdWithLines(rpcSale.id);

  return {
    invoice: { ...invoice, business_id: invoice.business_id ?? businessId },
    lines: lines ?? [],
    // A successful RPC has nothing to warn about: every step it performs is in
    // the same transaction, so there is no "the sale stands but step N failed"
    // state to report. That state is exactly what this path removes.
    warnings: [],
  };
}

/**
 * The client-side sale path, kept as the fallback for environments where the
 * `post_pos_sale` migration is not applied yet. Deleted once stage 3 lands
 * (see the design doc); both paths are idempotent on the same client key, so
 * a fallback after a committed RPC call cannot double-post.
 *
 * Idempotent by construction: the invoice carries `clientKey`, each payment
 * row a key derived from it with `deriveClientKey` (the same derivation the
 * RPC payload uses), and the repositories look the key up before inserting,
 * so a retry after a lost response returns what already exists rather than
 * duplicating the invoice or the cash rows. The two derived halves that have
 * no key of their own are guarded by what they left behind: the sales entry is
 * skipped when the invoice already carries a `journal_entry_id`, and the
 * stock/COGS release is skipped when the invoice already has stock movements.
 * Re-running a committed sale is therefore a no-op in the ledger as well as in
 * the documents.
 */
async function commitPosSaleDocumentsLegacy(
  payload: PosSaleQueuePayload,
  resolved: { businessId: string; clientKey: string },
): Promise<PosSaleCommitResult> {
  const businessId = resolved.businessId;
  const clientKey = resolved.clientKey;
  const warnings: string[] = [];

  // 0. Plan limit, checked BEFORE anything is written. The guard used to run
  //    from the journal posting — after the invoice row existed — so tripping
  //    it left a saved sale with no ledger entry behind; on the sync path it
  //    produced a queue item that could never succeed while its document sat
  //    on the books. One transaction per document is also what the plan sells,
  //    so a till sale now costs one unit instead of three (sale, receipt, COGS).
  //    A replay of an already-committed sale is exempt: its document is
  //    written, and blocking the retry would strand it half-posted.
  await usageService.assertCanCreateDocument(businessId, clientKey);

  let invoice: InsertDto<'invoices'> = { ...payload.invoice, business_id: businessId };

  // 1. Reserve a real document number for a number that was issued offline.
  const isPlaceholderNumber =
    !invoice.invoice_number ||
    (typeof invoice.invoice_number === 'string' && invoice.invoice_number.includes('-OFFLINE-'));
  if (isPlaceholderNumber) {
    const reserved = await repos.business
      .reserveNextInvoiceNumber(businessId)
      .catch(() => `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`);
    invoice = { ...invoice, invoice_number: reserved };
  }

  // 2. Resolve the customer. A queued sale may hold the walk-in sentinel, or a
  //    contact id that was invented offline (a customer created while the
  //    contacts table was unreachable) which would fail the foreign key.
  const contactId = await resolveSaleContact(businessId, invoice.contact_id, payload.customer);
  invoice = { ...invoice, contact_id: contactId } as InsertDto<'invoices'>;

  // 3. Resolve the revenue account when it could not be read offline, and
  //    stamp it on the lines so reports agree with the invoice.
  let lines = payload.lines;
  let revenueAccountId = invoice.revenue_account_id ?? null;
  if (!revenueAccountId) {
    const accounts = await repos.account.findByBusiness(businessId).catch(() => []);
    const revenueAccount = accounts.find(
      (a) => a.code === '4000' || a.code === '4110' || a.account_type === 'income',
    );
    revenueAccountId = revenueAccount?.id ?? null;
    if (revenueAccountId) {
      invoice = { ...invoice, revenue_account_id: revenueAccountId };
      lines = lines.map((line) =>
        line.account_id ? line : { ...line, account_id: revenueAccountId },
      );
    }
  }

  // 4. The document itself: header + lines, atomically, under the client key.
  const { invoice: createdInvoice, lines: createdLines } = await repos.invoice.createWithLines(
    invoice,
    lines,
    clientKey,
  );

  // 5. Money received. These rows are what move `amount_paid` (and therefore
  //    the invoice's status and amount due) — see the note in
  //    buildPosSaleQueuePayload. A failure here is NOT retry-invisible: the
  //    invoice would sit at 'sent' with cash taken but unrecorded, so it is
  //    raised for the caller to retry (safe: same key) or surface.
  const settledPayments: Row<'invoice_payments'>[] = [];
  for (const [index, payment] of payload.payments.entries()) {
    try {
      const tender = await resolveTenderAccountId(businessId, payment);
      if (tender.warning) warnings.push(tender.warning);

      const { payment: recorded } = await repos.invoice.recordPayment(
        {
          ...payment,
          bank_account_id: tender.accountId,
          business_id: businessId,
          invoice_id: createdInvoice.id,
        } as InsertDto<'invoice_payments'>,
        // Sub-key of the queue item's key. It has to be a real uuid:
        // `invoice_payments.client_key` is a uuid column, so the readable
        // spelling `<key>:pmt:<n>` would be rejected by Postgres (22P02) and
        // the payment would never be recorded. See src/lib/clientKeys.ts.
        deriveClientKey(clientKey, index),
      );
      settledPayments.push(recorded);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PosSalePostCommitError(
        `POS sale ${payload.receiptNumber} was saved as ${createdInvoice.invoice_number}, but payment ${index + 1}/${payload.payments.length} (${payment.payment_method} ${payment.amount}) could not be recorded: ${message}`,
        createdInvoice,
        'payment',
        { cause: err },
      );
    }
  }

  // 6. Stock and cost of sale. `deductStockAndPostCogs` writes the movements
  //    AND their COGS entry, skipping products that are not inventory-tracked
  //    and reading the live average cost — which is why it has to run here and
  //    not at the till: the device may have been offline for days while other
  //    tills moved the same stock.
  const stockLines = lines
    .filter((line) => line.product_id && Number(line.quantity) > 0)
    .map((line) => ({ productId: line.product_id as string, quantity: Number(line.quantity) }));

  //    A replay (queue retry, or a second attempt after a lost response) must
  //    not release the same stock twice. Unlike the invoice and its payment
  //    rows, stock movements carry no client key and the COGS entry is derived
  //    from them, so the check is "has this invoice already moved stock?".
  const stockAlreadyReleased =
    stockLines.length > 0 &&
    (await repos.inventory
      .hasMovementsForSource(businessId, 'invoice', createdInvoice.id)
      .catch(() => false));

  if (stockAlreadyReleased) {
    log.info('Stock already released for this sale — skipping the stock/COGS posting', {
      businessId,
      invoiceId: createdInvoice.id,
      invoiceNumber: createdInvoice.invoice_number,
    });
  } else if (stockLines.length > 0) {
    const result = await retryNonCritical(
      () =>
        deductStockAndPostCogs(
          businessId,
          createdInvoice,
          stockLines,
          createdInvoice.branch_id ?? null,
          createdInvoice.department_id ?? null,
          createdInvoice.created_by ?? null,
        ),
      { module: 'PosService', operation: 'pos_stock_cogs', businessId },
    );
    if (result === null) {
      warnings.push('Stock and cost of sale could not be posted for this sale.');
    }
  }

  // 7. Sales double-entry journal — the same shape the Income screen uses for
  //    the same two cases:
  //      * the sale         -> DR Debtors / CR Revenue (+VAT) (receivable entry);
  //      * paid at the till -> then one receipt per tender, debiting the
  //        account the money actually landed in: cash to 1110 Cash on Hand,
  //        Airtel Money to 1125, Mpamba to 1126, card / bank transfer / cheque
  //        to the payment's bank account. Crediting the drawer for every leg
  //        (what the single-entry quick path does) is why a card sale showed
  //        as notes in the till and the shift's cash count never tied out;
  //      * on credit        -> the receivable only. Posting a receipt would
  //        show cash the shop never received and leave the customer's ledger
  //        balance already settled.
  //
  //    Every posting is keyed (`invoice:<id>:sale`, `invoice:<id>:settlement:<paymentId>`),
  //    so a replay of a sale that only got halfway through the ledger resumes
  //    the missing half instead of skipping it or duplicating it. A credit sale
  //    has nothing to settle, so its `journal_entry_id` is a complete guard.
  const isCreditSale = payload.isCreditSale || payload.payments.length === 0;

  if (createdInvoice.journal_entry_id && isCreditSale) {
    log.info('Credit sale already has a journal entry — skipping the ledger posting', {
      businessId,
      invoiceId: createdInvoice.id,
      journalEntryId: createdInvoice.journal_entry_id,
    });
  } else {
    const journalPosted = await retryNonCritical<void>(async () => {
      await createInvoiceReceivableEntry(
        businessId,
        createdInvoice,
        createdInvoice.branch_id ?? null,
        createdInvoice.department_id ?? null,
      );
      if (isCreditSale) return;

      const functionalCurrency =
        createdInvoice.original_currency ?? createdInvoice.currency;
      for (const settled of settledPayments) {
        await createInvoiceSettlementEntry(
          businessId,
          createdInvoice,
          settled,
          functionalCurrency,
          createdInvoice.branch_id ?? null,
          createdInvoice.department_id ?? null,
        );
      }
    }, { module: 'PosService', operation: 'pos_journal_entry', businessId });
    if (journalPosted === null) {
      warnings.push(
        isCreditSale
          ? 'The sales journal entry could not be posted for this credit sale.'
          : 'The sales journal entry could not be posted for this sale.',
      );
    }
  }

  // 8. Drawer totals for the shift this sale belongs to.
  if (payload.shiftId) {
    const applied = await applyShiftTotals(businessId, payload);
    if (!applied) {
      warnings.push(
        `Shift totals were not updated for ${payload.receiptNumber} (the shift is closed or was removed); reconcile the drawer manually.`,
      );
    }
  }

  // 9. Audit trail (best-effort; never blocks the sale).
  await retryNonCritical(
    () => logPosSaleAudit(businessId, payload, createdInvoice),
    { module: 'PosService', operation: 'pos_audit_log', businessId },
  );

  return { invoice: createdInvoice, lines: createdLines, warnings };
}

/** True when an id is a real server-generated uuid rather than an offline placeholder. */
function isServerId(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Finds or creates the contact a sale is billed to, tolerating the two kinds
 * of placeholder an offline till can leave behind.
 */
async function resolveSaleContact(
  businessId: string,
  contactId: string | null,
  customer: PosSaleQueuePayload['customer'],
): Promise<string | null> {
  if (isServerId(contactId)) return contactId;

  const name = (customer?.name ?? '').trim();
  const isWalkIn = !name || /^walk[\s-]?in/i.test(name) || contactId === OFFLINE_WALK_IN_CONTACT_ID;

  if (!isWalkIn) {
    // A named customer created while offline: reuse the existing contact if
    // one with that name is already on file (keeps retries from piling up
    // duplicates), otherwise create it now.
    const existing = await repos.contact.findByBusiness(businessId, 'customer').catch(() => []);
    const match = existing.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (match) return match.id;

    const created = await repos.contact
      .createContact({
        business_id: businessId,
        name,
        contact_type: 'customer',
        is_active: true,
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
      } as never)
      .catch(() => null);
    if (created) return created.id;
  }

  const walkIn = await repos.contact.findDefaultSaleContact(businessId).catch(() => null);
  return walkIn?.id ?? null;
}

/**
 * Adds a sale's takings to its shift's drawer totals — but only while the
 * shift is still open.
 *
 * A closed shift has already been counted, its variance explained and its
 * Z-report signed. Silently rewriting its expected cash afterwards would make
 * the signed report disagree with the data behind it, which is worse for
 * reconciliation than a shift that is visibly missing one sale. The caller
 * surfaces a warning instead so the owner can adjust deliberately.
 */
async function applyShiftTotals(
  businessId: string,
  payload: PosSaleQueuePayload,
): Promise<boolean> {
  try {
    const shift = await repos.pos.findShiftById(payload.shiftId!);
    if (!shift || shift.status !== 'open') return false;

    await repos.pos.updateShiftTotals(payload.shiftId!, {
      cashSales: payload.cashSales,
      otherSales: payload.otherSales,
    });
    return true;
  } catch (err) {
    log.warn('Could not update POS shift totals for a synced sale', {
      error: err,
      businessId,
      receiptNumber: payload.receiptNumber,
    });
    return false;
  }
}

async function logPosSaleAudit(
  businessId: string,
  payload: PosSaleQueuePayload,
  invoice: Row<'invoices'>,
): Promise<void> {
  const rpcFn = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;

  await rpcFn('log_manual_audit_event', {
    p_business_id: businessId,
    p_event_type: 'pos_sale',
    p_resource_type: 'invoices',
    p_resource_id: invoice.id,
    p_resource_ref: payload.receiptNumber,
    p_old_values: null,
    p_new_values: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      receiptNumber: payload.receiptNumber,
      branchId: invoice.branch_id,
      cashierId: payload.cashierId,
      cashierName: payload.cashierName,
      total: payload.total,
      itemsCount: payload.itemCount,
      cashSales: payload.cashSales,
      otherSales: payload.otherSales,
      isCreditSale: payload.isCreditSale,
    },
    p_notes: `POS Sale #${payload.receiptNumber} completed by ${payload.cashierName} | Total: MK ${payload.total.toLocaleString()} | Cash: MK ${payload.cashSales.toLocaleString()}, Other: MK ${payload.otherSales.toLocaleString()}`,
  });
}

/** Assembles the receipt/sale view model both branches return to the UI. */
function buildPosSaleResult(
  sale: NormalizedPosSale,
  options: { invoiceId: string; invoiceNumber: string; isOffline: boolean; warnings?: string[] },
): PosSaleResult {
  const now = new Date().toISOString();
  const resultItems = sale.items.map((i) => {
    const productId = i.product_id || i.productId || null;
    const unitPrice = i.unit_price ?? i.unitPrice ?? 0;
    const lineTotal = i.line_total ?? i.lineTotal ?? 0;
    return {
      productId,
      product_id: productId,
      name: i.name,
      product_name: i.name,
      quantity: i.quantity,
      unitPrice,
      unit_price: unitPrice,
      lineTotal,
      line_total: lineTotal,
    };
  });

  return {
    saleId: options.invoiceId,
    invoiceId: options.invoiceId,
    invoiceNumber: options.invoiceNumber,
    receiptNumber: sale.receiptNumber,
    timestamp: now,
    createdAt: now,
    cashierName: sale.cashierName,
    branchName: sale.branchId || 'Main Branch',
    customerName: sale.customerName,
    customerPhone: sale.customerPhone ?? undefined,
    items: resultItems,
    subtotal: sale.totals.gross_total,
    discountAmount: sale.totals.discount_total,
    taxAmount: sale.totals.tax_total,
    netPayable: sale.totals.net_payable,
    grandTotal: sale.totals.net_payable,
    totalPaid: sale.totalPaid,
    changeGiven: sale.changeGiven,
    payments: sale.payments.map((p) => ({
      payment_method: p.payment_method as PosPaymentMethod,
      amount: p.amount,
      reference: p.reference ?? undefined,
    })),
    notes: sale.notes,
    isOffline: options.isOffline,
    warnings: options.warnings,
    sale: {
      id: options.invoiceId,
      receipt_number: sale.receiptNumber,
      created_at: now,
      customer_name: sale.customerName,
      cashier_name: sale.cashierName,
      net_amount: sale.totals.net_payable,
      gross_amount: sale.totals.gross_total,
      discount_amount: sale.totals.discount_total,
      total_paid: sale.totalPaid,
      change_given: sale.changeGiven,
      status: 'completed',
    },
  };
}

export async function processSale(
  payload: PosSalePayload,
  options: { isOnline?: boolean; userRole?: string } = {},
): Promise<PosSaleResult> {
  const sale = normalizePosSale(payload);
  const queuePayload = buildPosSaleQueuePayload(payload, {
    clientKey: sale.clientKey,
    receiptNumber: sale.receiptNumber,
    invoiceNumber: sale.invoiceNumber,
  });

  const isOnline = options.isOnline !== false && (typeof navigator === 'undefined' || navigator.onLine);

  if (!isOnline) {
    await enqueuePosSale(queuePayload);
    return buildPosSaleResult(sale, {
      invoiceId: `offline-${queuePayload.invoice.invoice_number}`,
      invoiceNumber: String(queuePayload.invoice.invoice_number),
      isOffline: true,
    });
  }

  try {
    const committed = await commitPosSaleDocuments(queuePayload, {
      businessId: sale.businessId,
      clientKey: sale.clientKey,
    });

    return buildPosSaleResult(sale, {
      invoiceId: committed.invoice.id,
      invoiceNumber: committed.invoice.invoice_number,
      isOffline: false,
      warnings: committed.warnings,
    });
  } catch (err) {
    // The document exists but a step belonging to it failed for a reason a
    // retry cannot fix. Telling the cashier the sale failed would invite them
    // to ring it up again, duplicating revenue and stock — so the sale stands,
    // and the problem is handed to them as a follow-up on the receipt and in
    // the offline drawer.
    if (err instanceof PosSalePostCommitError) {
      log.error('POS sale saved with a failed follow-up step', err, {
        businessId: sale.businessId,
        receiptNumber: sale.receiptNumber,
        invoiceNumber: err.invoiceNumber,
        stage: err.stage,
      });
      return buildPosSaleResult(sale, {
        invoiceId: err.invoiceId,
        invoiceNumber: err.invoiceNumber,
        isOffline: false,
        warnings: [err.message],
      });
    }

    // The till must not stop selling because the connection dropped, and we
    // cannot know from a network failure whether the server committed. Queue
    // the sale under the SAME client key: the replay returns whatever already
    // exists instead of duplicating it, and fills in the rest.
    if (isOfflineError(err)) {
      await enqueuePosSale(queuePayload);
      return buildPosSaleResult(sale, {
        invoiceId: `offline-${queuePayload.invoice.invoice_number}`,
        invoiceNumber: String(queuePayload.invoice.invoice_number),
        isOffline: true,
      });
    }

    throw err;
  }
}

/**
 * Queues a sale for the sync engine. Deliberately the only way a POS sale is
 * stored offline — the device-local queue the POS module used to keep in
 * localStorage is gone, because nothing but the POS screen could ever read,
 * retry or report on it.
 */
async function enqueuePosSale(queuePayload: PosSaleQueuePayload): Promise<number> {
  return enqueue('pos_sale', queuePayload.invoice.business_id, queuePayload);
}

export const createSale = processSale;

// ── Process POS Return / Refund ─────────────────────────────────────────────

// ── Process POS Return / Refund (canonical, server-authoritative) ───────────
//
// R07 correction-safety release: a refund is a financial correction and can
// therefore ONLY be executed by the canonical server command — see
// services/posCorrectionRpc.ts for the failure policy. The raw-DML bodies
// live on exclusively for the offline demo simulator (an in-memory dataset
// with no server boundary at all) and are unreachable for any real session.

export async function processReturn(
  payload: PosReturnPayload,
  options: { isOnline?: boolean; userRole?: string } = {},
): Promise<{ returnInvoiceId: string; returnNumber: string }> {
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const originalInvoiceId = payload.originalInvoiceId || payload.sale_id || '';
  const reason = payload.reason || 'Customer return';
  const rawItems = payload.items || [];
  const lines = rawItems.map((it) => ({
    product_id: it.productId || it.product_id || null,
    quantity: Math.abs(Number(it.quantity) || 0),
    amount: Math.abs(Number(it.refundAmount ?? it.refund_amount ?? ((it.unitPrice ?? it.unit_price ?? 0) * it.quantity)) || 0),
  }));

  if (isDemoMode()) {
    return processReturnLocal(payload, options);
  }

  const result = await refundPosSaleViaRpc({
    businessId,
    invoiceId: originalInvoiceId,
    reason,
    approvalToken: payload.approvalToken ?? null,
    commandKey: payload.commandKey,
    lines,
  });

  return {
    returnInvoiceId: result.journalEntryId ?? originalInvoiceId,
    returnNumber: generateReceiptNumber('RET'),
  };
}

// ── Process POS Void (canonical, server-authoritative) ──────────────────────

export async function processVoid(
  payload: PosVoidPayload,
  options: { isOnline?: boolean; userRole?: string } = {},
): Promise<{ success: boolean }> {
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const invoiceId = payload.invoiceId || payload.sale_id || '';
  const reason = payload.reason || 'Transaction voided';

  if (isDemoMode()) {
    return processVoidLocal(payload, options);
  }

  await voidPosSaleViaRpc({
    businessId,
    invoiceId,
    reason,
    approvalToken: payload.approvalToken ?? null,
    commandKey: payload.commandKey,
  });

  return { success: true };
}

async function processReturnLocal(
  payload: PosReturnPayload,
  options: { isOnline?: boolean; userRole?: string } = {},
): Promise<{ returnInvoiceId: string; returnNumber: string }> {
  void options;
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const branchId = payload.branchId ?? payload.branch_id ?? null;
  const shiftId = payload.shiftId ?? payload.shift_id ?? null;
  const originalInvoiceId = payload.originalInvoiceId || payload.sale_id || '';
  const receiptNumber = payload.receiptNumber || 'REC';
  const cashierName = payload.cashierName || payload.returned_by || 'Cashier';
  
  const reason = payload.reason || 'Customer return';
  const refundMethod = payload.refundMethod || payload.refund_payment_method || 'cash';
  const rawItems = payload.items || [];
  const items = rawItems.map((it) => ({
    productId: it.productId || it.product_id,
    productName: it.productName || it.product_name || 'Product',
    quantity: Number(it.quantity) || 1,
    unitPrice: Number(it.unitPrice ?? it.unit_price ?? 0),
    refundAmount: Number(it.refundAmount ?? it.refund_amount ?? ((it.unitPrice ?? it.unit_price ?? 0) * it.quantity)),
  }));

  const totalRefund = Number(payload.totalRefund || items.reduce((s: number, i) => s + i.refundAmount, 0));

  const today = new Date().toISOString().slice(0, 10);
  const returnNumber = generateReceiptNumber('RET');

  // 1. Fetch original invoice
  const original = await repos.invoice.findById(originalInvoiceId);

  // 2. Create Credit Note Invoice
  const creditNoteHeader: InsertDto<'invoices'> = {
    business_id: businessId,
    invoice_number: `CN-${original.invoice_number}`,
    invoice_type: 'credit_note',
    status: 'paid',
    contact_id: original.contact_id,
    issue_date: today,
    due_date: today,
    currency: 'MWK',
    exchange_rate: 1,
    subtotal: -Math.abs(totalRefund),
    discount_amount: 0,
    discount_percent: 0,
    taxable_amount: -Math.abs(totalRefund),
    vat_amount: 0,
    wht_amount: 0,
    total_amount: -Math.abs(totalRefund),
    amount_paid: -Math.abs(totalRefund),
    credit_note_for: original.id,
    notes: `Refund for Receipt #${receiptNumber}. Reason: ${reason} (demo-simulated correction)`,
    created_by: cashierName,
    branch_id: branchId || original.branch_id,
  } as InsertDto<'invoices'>;

  const creditLines = items.map((it, idx: number) => ({
    line_number: idx + 1,
    description: `Return: ${it.productName}`,
    quantity: -Math.abs(it.quantity),
    unit_price: it.unitPrice,
    discount_percent: 0,
    tax_code: 'none' as const,
    tax_rate: 0,
    tax_amount: 0,
    line_total: -Math.abs(it.refundAmount),
    product_id: it.productId || null,
  }));

  const { invoice: createdCreditNote } = await repos.invoice.createWithLines(creditNoteHeader, creditLines);

  // 3. Return stock to warehouse/branch location
  try {
    let locationId: string | null = null;
    if (branchId) {
      const loc = await repos.branch.findLocationByBranch(branchId).catch(() => null);
      locationId = loc?.id || null;
    }
    if (!locationId) {
      const defaultLoc = await repos.inventory.findDefaultLocation(businessId).catch(() => null);
      locationId = defaultLoc?.id || null;
    }

    if (locationId) {
      for (const it of items) {
        if (it.productId) {
          await repos.inventory.recordMovement({
            business_id: businessId,
            product_id: it.productId,
            location_id: locationId,
            movement_date: today,
            movement_type: 'return_in',
            quantity: Math.abs(it.quantity),
            unit_cost: it.unitPrice,
            reference: returnNumber,
            notes: `POS Return for ${receiptNumber} (${reason})`,
            source_type: 'pos_return',
            source_id: createdCreditNote.id,
            created_by: cashierName,
          }).catch((e) => log.warn('Return stock movement error', { error: e }));
        }
      }
    }
  } catch (invErr) {
    log.warn('Inventory return error', { error: invErr });
  }

  // 4. Update Shift Refunds if cash refund
  if (shiftId && refundMethod === 'cash') {
    await repos.pos.updateShiftTotals(shiftId, {
      refunds: Math.abs(totalRefund),
    }).catch((e) => log.warn('Could not update shift refunds', { error: e }));
  }

  // 5. Audit log
  try {
    const rpcFn = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    await rpcFn('log_manual_audit_event', {
      p_business_id: businessId,
      p_event_type: 'pos_refund',
      p_resource_type: 'invoices',
      p_resource_id: createdCreditNote.id,
      p_resource_ref: receiptNumber,
      p_old_values: { invoiceId: originalInvoiceId, receiptNumber },
      p_new_values: {
        returnNumber,
        refundAmount: totalRefund,
        refundMethod,
        items,
        cashierName,
        reason,
      },
      p_notes: `POS Refund of MK ${totalRefund.toLocaleString()} for #${receiptNumber}. Reason: ${reason} (demo simulation)`,  
    });
  } catch (auditErr) {
    log.warn('Audit log failed for POS refund', { error: auditErr });
  }

  return { returnInvoiceId: createdCreditNote.id, returnNumber };
}

// ── Process POS Void ────────────────────────────────────────────────────────

async function processVoidLocal(
  payload: PosVoidPayload,
  options: { isOnline?: boolean; userRole?: string } = {},
): Promise<{ success: boolean }> {
  void options;
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const branchId = payload.branchId ?? payload.branch_id ?? null;
  const invoiceId = payload.invoiceId || payload.sale_id || '';
  const receiptNumber = payload.receiptNumber || 'REC';
  const cashierName = payload.cashierName || payload.voided_by || 'Cashier';
  
  const reason = payload.reason || 'Transaction voided';
  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch invoice and lines
  const { invoice, lines } = await repos.invoice.findByIdWithLines(invoiceId);

  // 2. Mark invoice as void
  await repos.invoice.update(invoiceId, {
    status: 'void',
    notes: `${invoice.notes || ''} [VOIDED: ${reason} by ${cashierName} (demo-simulated correction)]`,
  } as never);

  // 3. Reverse stock movements
  try {
    let locationId: string | null = null;
    if (branchId || invoice.branch_id) {
      const loc = await repos.branch.findLocationByBranch(branchId || invoice.branch_id!).catch(() => null);
      locationId = loc?.id || null;
    }
    if (!locationId) {
      const defaultLoc = await repos.inventory.findDefaultLocation(businessId).catch(() => null);
      locationId = defaultLoc?.id || null;
    }

    if (locationId) {
      for (const l of lines) {
        if (l.product_id) {
          await repos.inventory.recordMovement({
            business_id: businessId,
            product_id: l.product_id,
            location_id: locationId,
            movement_date: today,
            movement_type: 'adjustment_in',
            quantity: Math.abs(Number(l.quantity)),
            unit_cost: Number(l.unit_price),
            reference: `VOID-${receiptNumber}`,
            notes: `Void reversal for ${receiptNumber} (${reason})`,
            source_type: 'pos_void',
            source_id: invoiceId,
            created_by: cashierName,
          }).catch((e) => log.warn('Void stock reversal error', { error: e }));
        }
      }
    }
  } catch (invErr) {
    log.warn('Inventory void reversal error', { error: invErr });
  }

  // 4. Reverse Journal Entry if posted
  if (invoice.journal_entry_id) {
    try {
      await repos.journal.reverse(
        invoice.journal_entry_id,
        `REV-${invoice.invoice_number}`,
        today,
        cashierName,
        `Void of ${receiptNumber} (${reason})`,
      );
    } catch (jErr) {
      log.warn('Journal reversal failed during void', { error: jErr });
    }
  }

  // 5. Audit Log
  try {
    const rpcFn = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    await rpcFn('log_manual_audit_event', {
      p_business_id: businessId,
      p_event_type: 'pos_void',
      p_resource_type: 'invoices',
      p_resource_id: invoiceId,
      p_resource_ref: receiptNumber,
      p_old_values: { status: invoice.status, total: invoice.total_amount },
      p_new_values: {
        status: 'void',
        voidReason: reason,
        cashierName,
      },
      p_notes: `POS Void of #${receiptNumber} (MK ${Number(invoice.total_amount).toLocaleString()}). Reason: ${reason} (demo simulation)`,
    });
  } catch (auditErr) {
    log.warn('Audit log failed for POS void', { error: auditErr });
  }

  return { success: true };
}

export const voidSale = processVoid;

export const posService = {
  calculateCartTotals,
  generateReceiptNumber,
  processSale,
  createSale,
  normalizePosSale,
  buildPosSaleQueuePayload,
  commitPosSaleDocuments,
  processReturn,
  processVoid,
  voidSale,
  addProductToCart,
  updateCartItemQuantity,
  removeProductFromCart,
  clearCart,
  applyItemDiscount,
  applyOrderDiscount,
};
