/**
 * JournalService — creates balanced, auto-posted journal entries
 * for invoices, expenses, and payroll runs.
 *
 * Account codes used (from live Chart of Accounts):
 *   1110  Cash on Hand
 *   1131  Trade Debtors
 *   1135  VAT Receivable (Input Tax)
 *   2111  Trade Creditors
 *   2121  VAT Payable (Output Tax)
 *   2122  PAYE Payable
 *   2131  Salaries & Wages Payable
 *   4112  Service Revenue
 *   4230  Foreign Exchange Gain (realised)
 *   6110  Basic Salaries
 *   7300  Foreign Exchange Loss (realised)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MULTI-CURRENCY / IAS 21 NOTE
 * ─────────────────────────────────────────────────────────────────────────
 * createInvoiceReceivableEntry / createInvoiceSettlementEntry and their
 * expense equivalents are the currency-aware posting path for the
 * invoice-builder / expense-builder flows (draft -> paid later).
 *
 * createInvoiceJournalEntry / createExpenseJournalEntry remain for the
 * quick-entry (auto-paid-immediately) flow and have been updated to use
 * each transaction's actual functional_amount rather than assuming MWK 1:1.
 *
 * Settlement FX gain/loss assumes the payment is recorded in the SAME
 * original_currency as the invoice/expense it settles — this matches the
 * standard "you pay a USD invoice in USD" case. A payment recorded in a
 * currency different from the invoice's original_currency (e.g. a USD
 * invoice settled in EUR) is a foreign-to-foreign settlement and is not
 * handled by this logic; the payment form should default/lock the
 * currency field to the invoice's original_currency to avoid this case
 * until it's explicitly supported.
 */

import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';
import { calculateRealisedFx } from '@/services/realisedFx';
import { webhookService } from '@/services/webhook/WebhookService';
import { usageService } from '@/lib/billing/UsageService';
import { getPlan, normalizePlanTier } from '@/lib/billing/plans';
import { createLogger } from '@/lib/logger';

const log = createLogger('JournalService');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAccountByCode(
  businessId: string,
  code: string,
): Promise<Row<'accounts'>> {
  const acc = await repos.account.findByCode(businessId, code);
  if (!acc) throw new Error(`Account ${code} not found. Please ensure your Chart of Accounts is set up.`);
  return acc;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- accepted for future per-business sequence support; currently timestamp-based
export async function nextEntryNumber(_businessId: string): Promise<string> {
  const now   = new Date();
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}`;
  return `JNL-${stamp}`;
}

// Realised FX gain/loss arithmetic lives in `@/services/realisedFx` — a pure,
// dependency-free module so it can be unit-tested without Supabase env vars.

/**
 * Builds the FX gain/loss journal_lines entries (0, 1, or occasionally
 * more if you want to split gain vs loss — here always 0 or 1 line) for
 * a given realised amount. Returns an empty array if the amount rounds
 * to zero (no FX movement worth posting).
 */
async function buildFxLines(
  businessId: string,
  realisedGainLoss: number,
  lineNumberStart: number,
  description: string,
  functionalCurrency: string,
): Promise<Parameters<typeof repos.journal.createBalancedEntry>[1]> {
  const rounded = Math.round(realisedGainLoss * 100) / 100;
  if (Math.abs(rounded) < 0.005) return [];

  const isGain = rounded > 0;
  const account = await getAccountByCode(businessId, isGain ? '4230' : '7300');

  return [
    {
      line_number:   lineNumberStart,
      account_id:    account.id,
      description:   `${description} — realised FX ${isGain ? 'gain' : 'loss'}`,
      is_debit:      !isGain, // gain = credit (income), loss = debit (expense)
      amount:        Math.abs(rounded),
      amount_base:   Math.abs(rounded),
      currency:      functionalCurrency,
      exchange_rate: 1,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
  ];
}

// ── Invoice Journal Entry (quick-entry / auto-paid path) ─────────────────────
// Now currency-aware: uses the invoice's actual original_amount/currency/
// exchange_rate/functional_amount rather than assuming MWK 1:1.

// ── Usage Limit Guard ───────────────────────────────────────────────────────
async function checkUsageLimit(businessId: string): Promise<void> {
  const business = await repos.business.findById(businessId);
  const planTier = normalizePlanTier(business.plan_tier);
  const plan = getPlan(planTier);

  if (plan.transactionLimit === null) return; // unlimited

  const currentUsage = await usageService.getCurrentMonthUsage(businessId);
  if (currentUsage >= plan.transactionLimit) {
    throw new Error(`Monthly transaction limit reached (${plan.transactionLimit}). Please upgrade your plan.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function createInvoiceJournalEntry(
  businessId: string,
  invoice: Row<'invoices'>,
  subtotal: number,
  vatAmount: number,
  branchId?: string | null,
  departmentId?: string | null,
): Promise<void> {
  const invoiceNumber = invoice.invoice_number;
  const invoiceDate = invoice.issue_date;
  const sourceId = invoice.id;

  const [debtors, defaultRevenue, vatPayable, cash] = await Promise.all([
    getAccountByCode(businessId, '1131'),
    getAccountByCode(businessId, '4112'),
    getAccountByCode(businessId, '2121'),
    getAccountByCode(businessId, '1110'),
  ]);

  const revenue = invoice.revenue_account_id
    ? await repos.account.findById(invoice.revenue_account_id).catch(() => defaultRevenue)
    : defaultRevenue;

  const currency        = invoice.original_currency ?? invoice.currency;
  const exchangeRate     = Number(invoice.exchange_rate);
  const totalFunctional  = Number(invoice.functional_amount ?? invoice.total_amount);
  const subtotalFunctional = subtotal * exchangeRate;
  const vatFunctional    = vatAmount * exchangeRate;

  await checkUsageLimit(businessId);

  const entryNumber = await nextEntryNumber(businessId);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [];

  lines.push({
    line_number:   1,
    account_id:    debtors.id,
    description:   `Invoice ${invoiceNumber} — receivable`,
    is_debit:      true,
    amount:        Number(invoice.total_amount),
    amount_base:   totalFunctional,
    currency,
    exchange_rate: exchangeRate,
    tax_code:      'none',
    tax_amount:    0,
    reconciled:    false,
  });

  lines.push({
    line_number:   2,
    account_id:    revenue.id,
    description:   `Invoice ${invoiceNumber} — revenue`,
    is_debit:      false,
    amount:        subtotal,
    amount_base:   subtotalFunctional,
    currency,
    exchange_rate: exchangeRate,
    tax_code:      'none',
    tax_amount:    0,
    reconciled:    false,
  });

  if (vatAmount > 0) {
    lines.push({
      line_number:   3,
      account_id:    vatPayable.id,
      description:   `Invoice ${invoiceNumber} — VAT`,
      is_debit:      false,
      amount:        vatAmount,
      amount_base:   vatFunctional,
      currency,
      exchange_rate: exchangeRate,
      tax_code:      'vat_standard',
      tax_amount:    vatFunctional,
      reconciled:    false,
    });
  }

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    invoiceDate,
      description:   `Invoice ${invoiceNumber}`,
      source_type:   'invoice',
      source_id:     sourceId,
      currency,
      exchange_rate: exchangeRate,
      status:        'draft',
      branch_id:     branchId ?? null,
      department_id: departmentId ?? null,
    },
    lines,
  );

  await repos.journal.post(entry.id, null);
  await repos.invoice.update(sourceId, { journal_entry_id: entry.id });

  // Record usage
  await usageService.recordTransaction(businessId, 'journal');

  // Trigger webhook
  try {
    await webhookService.triggerWebhooks(businessId, 'invoice.created', {
      invoice_id: sourceId,
      invoice_number: invoiceNumber,
      total_amount: invoice.total_amount,
    });
  } catch (e) { log.warn('Webhook failed (non-blocking)', { error: e }); }

  const entryNumber2 = await nextEntryNumber(businessId);
  await new Promise((r) => setTimeout(r, 100));

  const { entry: entry2 } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber2,
      entry_date:    invoiceDate,
      description:   `Receipt for Invoice ${invoiceNumber}`,
      source_type:   'invoice',
      source_id:     sourceId,
      currency,
      exchange_rate: exchangeRate,
      status:        'draft',
      branch_id:     branchId ?? null,
      department_id: departmentId ?? null,
    },
    [
      {
        line_number:   1,
        account_id:    cash.id,
        description:   `Cash received — Invoice ${invoiceNumber}`,
        is_debit:      true,
        amount:        Number(invoice.total_amount),
        amount_base:   totalFunctional,
        currency,
        exchange_rate: exchangeRate,
        tax_code:      'none',
        tax_amount:    0,
        reconciled:    false,
      },
      {
        line_number:   2,
        account_id:    debtors.id,
        description:   `Settle debtor — Invoice ${invoiceNumber}`,
        is_debit:      false,
        amount:        Number(invoice.total_amount),
        amount_base:   totalFunctional,
        currency,
        exchange_rate: exchangeRate,
        tax_code:      'none',
        tax_amount:    0,
        reconciled:    false,
      },
    ],
  );

  await repos.journal.post(entry2.id, null);

  // Trigger webhook for paid invoice
  try {
    await webhookService.triggerWebhooks(businessId, 'invoice.paid', {
      invoice_id: sourceId,
      invoice_number: invoiceNumber,
      total_amount: invoice.total_amount,
    });
  } catch (e) { log.warn('Webhook failed (non-blocking)', { error: e }); }
}

// ── Invoice-Builder: Receivable Entry (draft creation, no cash line) ─────────
// Posts DR Debtors / CR Revenue [+ CR VAT] only. Called when an
// invoice-builder invoice is created/sent — NOT auto-settled.

export async function createInvoiceReceivableEntry(
  businessId: string,
  invoice: Row<'invoices'>,
  branchId?: string | null,
  departmentId?: string | null,
): Promise<string> {
  const [debtors, revenue, vatPayable] = await Promise.all([
    getAccountByCode(businessId, '1131'),
    getAccountByCode(businessId, '4112'),
    getAccountByCode(businessId, '2121'),
  ]);

  const currency       = invoice.original_currency ?? invoice.currency;
  const exchangeRate    = Number(invoice.exchange_rate);
  const totalFunctional = Number(invoice.functional_amount ?? invoice.total_amount);
  const subtotal        = Number(invoice.subtotal);
  const vatAmount       = Number(invoice.vat_amount);
  const subtotalFunctional = subtotal * exchangeRate;
  const vatFunctional   = vatAmount * exchangeRate;

  const entryNumber = await nextEntryNumber(businessId);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [
    {
      line_number:   1,
      account_id:    debtors.id,
      description:   `Invoice ${invoice.invoice_number} — receivable`,
      is_debit:      true,
      amount:        Number(invoice.total_amount),
      amount_base:   totalFunctional,
      currency,
      exchange_rate: exchangeRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
    {
      line_number:   2,
      account_id:    revenue.id,
      description:   `Invoice ${invoice.invoice_number} — revenue`,
      is_debit:      false,
      amount:        subtotal,
      amount_base:   subtotalFunctional,
      currency,
      exchange_rate: exchangeRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
  ];

  if (vatAmount > 0) {
    lines.push({
      line_number:   3,
      account_id:    vatPayable.id,
      description:   `Invoice ${invoice.invoice_number} — VAT`,
      is_debit:      false,
      amount:        vatAmount,
      amount_base:   vatFunctional,
      currency,
      exchange_rate: exchangeRate,
      tax_code:      'vat_standard',
      tax_amount:    vatFunctional,
      reconciled:    false,
    });
  }

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    invoice.issue_date,
      description:   `Invoice ${invoice.invoice_number}`,
      source_type:   'invoice',
      source_id:     invoice.id,
      currency,
      exchange_rate: exchangeRate,
      status:        'draft',
      branch_id:     branchId ?? null,
      department_id: departmentId ?? null,
    },
    lines,
  );

  await repos.journal.post(entry.id, null);
  await repos.invoice.update(invoice.id, { journal_entry_id: entry.id });
  return entry.id;
}

// ── Invoice-Builder: Settlement Entry (payment recorded later) ───────────────
// Posts DR Cash / CR Debtors [+ FX Gain/Loss line]. Called from the
// payment-recording flow, AFTER InvoiceRepository.recordPayment succeeds.

export async function createInvoiceSettlementEntry(
  businessId: string,
  invoice: Row<'invoices'>,
  payment: Row<'invoice_payments'>,
  functionalCurrency: string,
  branchId?: string | null,
  departmentId?: string | null,
): Promise<string> {
  const [debtors, cash] = await Promise.all([
    getAccountByCode(businessId, '1131'),
    payment.bank_account_id
      ? repos.account.findById(payment.bank_account_id)
      : getAccountByCode(businessId, '1110'),
  ]);

  const paymentCurrency   = payment.original_currency ?? payment.currency;
  const settledOriginal    = Number(payment.original_amount ?? payment.amount);
  const settlementRate     = Number(payment.exchange_rate);
  const bookedRate         = Number(invoice.exchange_rate);
  const cashFunctional     = Number(payment.functional_amount ?? payment.amount);
  const debtorsClearFunctional = settledOriginal * bookedRate; // clears exactly what was booked

  const direction = 'receivable' as const;
  const realisedGainLoss = calculateRealisedFx(settledOriginal, bookedRate, settlementRate, direction);

  const entryNumber = await nextEntryNumber(businessId);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [
    {
      line_number:   1,
      account_id:    cash.id,
      description:   `Cash received — Invoice ${invoice.invoice_number}`,
      is_debit:      true,
      amount:        settledOriginal,
      amount_base:   cashFunctional,
      currency:      paymentCurrency,
      exchange_rate: settlementRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
    {
      line_number:   2,
      account_id:    debtors.id,
      description:   `Settle debtor — Invoice ${invoice.invoice_number}`,
      is_debit:      false,
      amount:        settledOriginal,
      amount_base:   debtorsClearFunctional,
      currency:      paymentCurrency,
      exchange_rate: bookedRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
  ];

  const fxLines = await buildFxLines(
    businessId,
    realisedGainLoss,
    3,
    `Invoice ${invoice.invoice_number}`,
    functionalCurrency,
  );
  lines.push(...fxLines);

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    payment.payment_date,
      description:   `Receipt for Invoice ${invoice.invoice_number}`,
      source_type:   'invoice',
      source_id:     invoice.id,
      currency:      paymentCurrency,
      exchange_rate: settlementRate,
      status:        'draft',
      branch_id:     branchId ?? null,
      department_id: departmentId ?? null,
    },
    lines,
  );

  await repos.journal.post(entry.id, null);
  await repos.invoice.update(invoice.id, { journal_entry_id: invoice.journal_entry_id ?? entry.id });
  return entry.id;
}

// ── Expense Journal Entry (quick-entry / auto-paid path) ─────────────────────
// Now currency-aware.

export interface ExpenseAccountAllocation {
  accountId: string;
  amount: number;
  description?: string;
}

export async function createExpenseJournalEntry(
  businessId: string,
  expense: Row<'expenses'>, // CHANGED: pass full row for currency fields
  allocations: ExpenseAccountAllocation[],
  vatAmount: number,
  branchId?: string | null,
  departmentId?: string | null,
): Promise<string> {
  if (allocations.length === 0) {
    throw new Error('At least one expense account allocation is required.');
  }

  const totalAmount = Number(expense.total_amount);
  const allocatedSubtotal = allocations.reduce((s, a) => s + a.amount, 0);
  const expectedTotal     = allocatedSubtotal + vatAmount;
  if (Math.abs(expectedTotal - totalAmount) > 0.01) {
    throw new Error(
      `Expense allocations (${allocatedSubtotal} + VAT ${vatAmount} = ${expectedTotal}) ` +
      `do not match the total amount (${totalAmount}). Please check category amounts.`,
    );
  }

  await checkUsageLimit(businessId);

  const currency      = expense.original_currency ?? expense.currency;
  const exchangeRate   = Number(expense.exchange_rate);
  const vatFunctional  = vatAmount * exchangeRate;

  const [vatReceivable, creditors, cash] = await Promise.all([
    vatAmount > 0 ? getAccountByCode(businessId, '1135') : Promise.resolve(null),
    getAccountByCode(businessId, '2111'),
    getAccountByCode(businessId, '1110'),
  ]);

  const isBill        = expense.expense_type === 'bill';
  const creditAccount = isBill ? creditors : cash;
  const entryNumber   = await nextEntryNumber(businessId);
  const totalFunctional = Number(expense.functional_amount ?? totalAmount);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [];
  let lineNumber = 1;

  for (const alloc of allocations) {
    if (alloc.amount <= 0) continue;
    lines.push({
      line_number:   lineNumber++,
      account_id:    alloc.accountId,
      description:   alloc.description ?? `Expense ${expense.expense_number}`,
      is_debit:      true,
      amount:        alloc.amount,
      amount_base:   alloc.amount * exchangeRate,
      currency,
      exchange_rate: exchangeRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    });
  }

  if (vatAmount > 0 && vatReceivable) {
    lines.push({
      line_number:   lineNumber++,
      account_id:    vatReceivable.id,
      description:   `VAT input — Expense ${expense.expense_number}`,
      is_debit:      true,
      amount:        vatAmount,
      amount_base:   vatFunctional,
      currency,
      exchange_rate: exchangeRate,
      tax_code:      'vat_standard',
      tax_amount:    vatFunctional,
      reconciled:    false,
    });
  }

  lines.push({
    line_number:   lineNumber + 1,
    account_id:    creditAccount.id,
    description:   isBill
      ? `Payable — Expense ${expense.expense_number}`
      : `Cash paid — Expense ${expense.expense_number}`,
    is_debit:      false,
    amount:        totalAmount,
    amount_base:   totalFunctional,
    currency,
    exchange_rate: exchangeRate,
    tax_code:      'none',
    tax_amount:    0,
    reconciled:    false,
  });

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    expense.expense_date,
      description:   `Expense ${expense.expense_number}`,
      source_type:   'expense',
      source_id:     expense.id,
      currency,
      exchange_rate: exchangeRate,
      status:        'draft',
      branch_id:     branchId ?? null,
      department_id: departmentId ?? null,
    },
    lines,
  );

  await repos.journal.post(entry.id, null);
  await repos.expense.update(expense.id, { journal_entry_id: entry.id });

  // Trigger webhook
  try {
    await webhookService.triggerWebhooks(businessId, 'expense.created', {
      expense_id: expense.id,
      expense_number: expense.expense_number,
      total_amount: expense.total_amount,
    });
  } catch (e) { log.warn('Webhook failed (non-blocking)', { error: e }); }

  return entry.id;
}

// ── Expense-Builder: Settlement Entry (payment recorded later) ───────────────
// Posts DR Creditors / CR Cash [+ FX Gain/Loss line]. Only relevant for
// 'bill' type expenses (a 'cash' expense is settled at creation via
// createExpenseJournalEntry's DR .../CR Cash line already).

export async function createExpenseSettlementEntry(
  businessId: string,
  expense: Row<'expenses'>,
  payment: Row<'expense_payments'>,
  functionalCurrency: string,
  branchId?: string | null,
  departmentId?: string | null,
): Promise<string> {
  const [creditors, cash] = await Promise.all([
    getAccountByCode(businessId, '2111'),
    payment.bank_account_id
      ? repos.account.findById(payment.bank_account_id)
      : getAccountByCode(businessId, '1110'),
  ]);

  const paymentCurrency = payment.original_currency ?? payment.currency;
  const settledOriginal  = Number(payment.original_amount ?? payment.amount);
  const settlementRate   = Number(payment.exchange_rate);
  const bookedRate       = Number(expense.exchange_rate);
  const cashFunctional   = Number(payment.functional_amount ?? payment.amount);
  const creditorsClearFunctional = settledOriginal * bookedRate;

  const direction = 'payable' as const;
  const realisedGainLoss = calculateRealisedFx(settledOriginal, bookedRate, settlementRate, direction);

  const entryNumber = await nextEntryNumber(businessId);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [
    {
      line_number:   1,
      account_id:    creditors.id,
      description:   `Settle creditor — Expense ${expense.expense_number}`,
      is_debit:      true,
      amount:        settledOriginal,
      amount_base:   creditorsClearFunctional,
      currency:      paymentCurrency,
      exchange_rate: bookedRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
    {
      line_number:   2,
      account_id:    cash.id,
      description:   `Cash paid — Expense ${expense.expense_number}`,
      is_debit:      false,
      amount:        settledOriginal,
      amount_base:   cashFunctional,
      currency:      paymentCurrency,
      exchange_rate: settlementRate,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    },
  ];

  const fxLines = await buildFxLines(
    businessId,
    realisedGainLoss,
    3,
    `Expense ${expense.expense_number}`,
    functionalCurrency,
  );
  lines.push(...fxLines);

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    payment.payment_date,
      description:   `Payment for Expense ${expense.expense_number}`,
      source_type:   'expense',
      source_id:     expense.id,
      currency:      paymentCurrency,
      exchange_rate: settlementRate,
      status:        'draft',
      branch_id:     branchId ?? null,
      department_id: departmentId ?? null,
    },
    lines,
  );

  await repos.journal.post(entry.id, null);
  return entry.id;
}

// ── Payroll Journal Entry (unchanged — MWK only, payroll has no FX exposure) ─

export async function createPayrollJournalEntry(
  businessId: string,
  runNumber: string,
  payDate: string,
  totalGross: number,
  totalPaye: number,
  totalNet: number,
  sourceId: string,
): Promise<void> {
  const [salariesExp, payePayable, salariesPayable] = await Promise.all([
    getAccountByCode(businessId, '6110'),
    getAccountByCode(businessId, '2122'),
    getAccountByCode(businessId, '2131'),
  ]);

  const entryNumber = await nextEntryNumber(businessId);

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    payDate,
      description:   `Payroll Run ${runNumber}`,
      source_type:   'payroll',
      source_id:     sourceId,
      currency:      'MWK',
      exchange_rate: 1,
      status:        'draft',
    },
    [
      {
        line_number:   1,
        account_id:    salariesExp.id,
        description:   `Gross pay — ${runNumber}`,
        is_debit:      true,
        amount:        totalGross,
        amount_base:   totalGross,
        currency:      'MWK',
        exchange_rate: 1,
        tax_code:      'none',
        tax_amount:    0,
        reconciled:    false,
      },
      {
        line_number:   2,
        account_id:    payePayable.id,
        description:   `PAYE payable — ${runNumber}`,
        is_debit:      false,
        amount:        totalPaye,
        amount_base:   totalPaye,
        currency:      'MWK',
        exchange_rate: 1,
        tax_code:      'paye',
        tax_amount:    totalPaye,
        reconciled:    false,
      },
      {
        line_number:   3,
        account_id:    salariesPayable.id,
        description:   `Net salaries payable — ${runNumber}`,
        is_debit:      false,
        amount:        totalNet,
        amount_base:   totalNet,
        currency:      'MWK',
        exchange_rate: 1,
        tax_code:      'none',
        tax_amount:    0,
        reconciled:    false,
      },
    ],
  );

  await repos.journal.post(entry.id, null);

  // Trigger webhook
  try {
    await webhookService.triggerWebhooks(businessId, 'payroll.run', {
      payroll_run_id: sourceId,
      run_number: runNumber,
      total_gross: totalGross,
      total_net: totalNet,
    });
  } catch (e) { log.warn('Webhook failed (non-blocking)', { error: e }); }
}