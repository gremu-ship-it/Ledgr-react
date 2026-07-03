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
 *   6110  Basic Salaries
 */

import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAccountByCode(
  businessId: string,
  code: string,
): Promise<Row<'accounts'>> {
  const acc = await repos.account.findByCode(businessId, code);
  if (!acc) throw new Error(`Account ${code} not found. Please ensure your Chart of Accounts is set up.`);
  return acc;
}

async function nextEntryNumber(_businessId: string): Promise<string> {
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

// ── Invoice Journal Entry ─────────────────────────────────────────────────────
// For a paid invoice:
//   DR  Trade Debtors (1131)      — full invoice amount
//   CR  Service Revenue (4112)    — subtotal (ex-VAT)
//   CR  VAT Payable (2121)        — VAT amount (if any)
//
// Then immediately settle:
//   DR  Cash on Hand (1110)       — full invoice amount
//   CR  Trade Debtors (1131)      — full invoice amount
//
// branchId — optional branch/location this sale belongs to.
// Stored in journal_entries.branch_id so branch-level P&L reports
// can filter correctly.

export async function createInvoiceJournalEntry(
  businessId: string,
  invoiceNumber: string,
  invoiceDate: string,
  totalAmount: number,
  subtotal: number,
  vatAmount: number,
  sourceId: string,
  branchId?: string | null,   // NEW
): Promise<void> {
  const [debtors, revenue, vatPayable, cash] = await Promise.all([
    getAccountByCode(businessId, '1131'),
    getAccountByCode(businessId, '4112'),
    getAccountByCode(businessId, '2121'),
    getAccountByCode(businessId, '1110'),
  ]);

  const entryNumber = await nextEntryNumber(businessId);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [];

  // Invoice recognition lines
  lines.push({
    line_number:   1,
    account_id:    debtors.id,
    description:   `Invoice ${invoiceNumber} — receivable`,
    is_debit:      true,
    amount:        totalAmount,
    amount_base:   totalAmount,
    currency:      'MWK',
    exchange_rate: 1,
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
    amount_base:   subtotal,
    currency:      'MWK',
    exchange_rate: 1,
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
      amount_base:   vatAmount,
      currency:      'MWK',
      exchange_rate: 1,
      tax_code:      'vat_standard',
      tax_amount:    vatAmount,
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
      currency:      'MWK',
      exchange_rate: 1,
      status:        'draft',
      branch_id:     branchId ?? null,   // NEW
    },
    lines,
  );

  await repos.journal.post(entry.id, null as any);

  // Settlement entry (cash received)
  const entryNumber2 = await nextEntryNumber(businessId);
  await new Promise((r) => setTimeout(r, 100)); // ensure unique timestamp

  const { entry: entry2 } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber2,
      entry_date:    invoiceDate,
      description:   `Receipt for Invoice ${invoiceNumber}`,
      source_type:   'invoice',
      source_id:     sourceId,
      currency:      'MWK',
      exchange_rate: 1,
      status:        'draft',
      branch_id:     branchId ?? null,   // NEW
    },
    [
      {
        line_number:   1,
        account_id:    cash.id,
        description:   `Cash received — Invoice ${invoiceNumber}`,
        is_debit:      true,
        amount:        totalAmount,
        amount_base:   totalAmount,
        currency:      'MWK',
        exchange_rate: 1,
        tax_code:      'none',
        tax_amount:    0,
        reconciled:    false,
      },
      {
        line_number:   2,
        account_id:    debtors.id,
        description:   `Settle debtor — Invoice ${invoiceNumber}`,
        is_debit:      false,
        amount:        totalAmount,
        amount_base:   totalAmount,
        currency:      'MWK',
        exchange_rate: 1,
        tax_code:      'none',
        tax_amount:    0,
        reconciled:    false,
      },
    ],
  );

  await repos.journal.post(entry2.id, null as any);
}

// ── Expense Journal Entry ─────────────────────────────────────────────────────
// For a paid expense (receipt) or supplier bill:
//   DR  Real expense account(s) — one line per selected category, net of VAT
//   DR  VAT Receivable (1135)   — VAT amount, if any
//   CR  Cash on Hand (1110) or Trade Creditors (2111) if bill — full total
//
// branchId — optional cost centre / branch this expense belongs to.
// Stored in journal_entries.branch_id for branch-level P&L reporting.

export interface ExpenseAccountAllocation {
  /** accounts.id for the expense category this portion should be debited to */
  accountId: string;
  /** net amount (excl. VAT) allocated to this account */
  amount: number;
  description?: string;
}

export async function createExpenseJournalEntry(
  businessId: string,
  expenseNumber: string,
  expenseDate: string,
  totalAmount: number,
  allocations: ExpenseAccountAllocation[],
  vatAmount: number,
  expenseType: string,
  sourceId: string,
  branchId?: string | null,   // NEW
): Promise<string> {
  if (allocations.length === 0) {
    throw new Error('At least one expense account allocation is required.');
  }

  const allocatedSubtotal = allocations.reduce((s, a) => s + a.amount, 0);
  const expectedTotal     = allocatedSubtotal + vatAmount;
  if (Math.abs(expectedTotal - totalAmount) > 0.01) {
    throw new Error(
      `Expense allocations (${allocatedSubtotal} + VAT ${vatAmount} = ${expectedTotal}) ` +
      `do not match the total amount (${totalAmount}). Please check category amounts.`,
    );
  }

  const [vatReceivable, creditors, cash] = await Promise.all([
    vatAmount > 0 ? getAccountByCode(businessId, '1135') : Promise.resolve(null),
    getAccountByCode(businessId, '2111'),
    getAccountByCode(businessId, '1110'),
  ]);

  const isBill        = expenseType === 'bill';
  const creditAccount = isBill ? creditors : cash;
  const entryNumber   = await nextEntryNumber(businessId);

  const lines: Parameters<typeof repos.journal.createBalancedEntry>[1] = [];
  let lineNumber = 1;

  for (const alloc of allocations) {
    if (alloc.amount <= 0) continue;
    lines.push({
      line_number:   lineNumber++,
      account_id:    alloc.accountId,
      description:   alloc.description ?? `Expense ${expenseNumber}`,
      is_debit:      true,
      amount:        alloc.amount,
      amount_base:   alloc.amount,
      currency:      'MWK',
      exchange_rate: 1,
      tax_code:      'none',
      tax_amount:    0,
      reconciled:    false,
    });
  }

  if (vatAmount > 0 && vatReceivable) {
    lines.push({
      line_number:   lineNumber++,
      account_id:    vatReceivable.id,
      description:   `VAT input — Expense ${expenseNumber}`,
      is_debit:      true,
      amount:        vatAmount,
      amount_base:   vatAmount,
      currency:      'MWK',
      exchange_rate: 1,
      tax_code:      'vat_standard',
      tax_amount:    vatAmount,
      reconciled:    false,
    });
  }

  lines.push({
    line_number:   lineNumber++,
    account_id:    creditAccount.id,
    description:   isBill
      ? `Payable — Expense ${expenseNumber}`
      : `Cash paid — Expense ${expenseNumber}`,
    is_debit:      false,
    amount:        totalAmount,
    amount_base:   totalAmount,
    currency:      'MWK',
    exchange_rate: 1,
    tax_code:      'none',
    tax_amount:    0,
    reconciled:    false,
  });

  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id:   businessId,
      entry_number:  entryNumber,
      entry_date:    expenseDate,
      description:   `Expense ${expenseNumber}`,
      source_type:   'expense',
      source_id:     sourceId,
      currency:      'MWK',
      exchange_rate: 1,
      status:        'draft',
      branch_id:     branchId ?? null,   // NEW
    },
    lines,
  );

  await repos.journal.post(entry.id, null as any);

  return entry.id;
}

// ── Payroll Journal Entry ─────────────────────────────────────────────────────
// DR  Basic Salaries (6110)           — gross pay
// CR  PAYE Payable (2122)             — paye deduction
// CR  Salaries & Wages Payable (2131) — net pay

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

  await repos.journal.post(entry.id, null as any);
}