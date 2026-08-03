/**
 * Integration tests for JournalService posting flows.
 *
 * `repos` is mocked at the module boundary so the full service logic — account
 * resolution, currency conversion, FX line construction, usage gating — runs
 * end-to-end, while every journal entry the service WOULD post is captured
 * and asserted for double-entry balance and correct account usage.
 *
 * What this protects: the posting shapes every financial statement depends
 * on. A regression here (wrong side, unbalanced entry, missing VAT line)
 * corrupts the books silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Row } from '@/dal/types/database';

// ── Captured repo calls ───────────────────────────────────────────────────────

type JournalLine = {
  line_number: number;
  account_id: string;
  description: string;
  is_debit: boolean;
  amount: number;
  amount_base: number;
  currency: string;
  exchange_rate: number;
  tax_code: string;
  tax_amount: number;
};

const createdEntries: { header: Record<string, unknown>; lines: JournalLine[] }[] = [];
const postedEntryIds: string[] = [];
const invoiceUpdates: { id: string; patch: Record<string, unknown> }[] = [];
const expenseUpdates: { id: string; patch: Record<string, unknown> }[] = [];

let entrySeq = 0;

// ── Chart of accounts fixture (mirrors the seeded COA) ───────────────────────

function acc(id: string, code: string): Row<'accounts'> {
  return { id, code, name: code } as unknown as Row<'accounts'>;
}

const ACCOUNTS_BY_CODE = {
  '1110': acc('acc-cash', '1110'),
  '1131': acc('acc-debtors', '1131'),
  '1135': acc('acc-vat-rec', '1135'),
  '2111': acc('acc-creditors', '2111'),
  '2121': acc('acc-vat-pay', '2121'),
  '2122': acc('acc-paye', '2122'),
  '2131': acc('acc-sal-pay', '2131'),
  '4112': acc('acc-revenue', '4112'),
  '4230': acc('acc-fx-gain', '4230'),
  '6110': acc('acc-salaries', '6110'),
  '7300': acc('acc-fx-loss', '7300'),
};
const ACCOUNTS_BY_ID = Object.fromEntries(
  Object.values(ACCOUNTS_BY_CODE).map((a) => [a.id, a]),
);
ACCOUNTS_BY_ID['acc-bank-nbm'] = acc('acc-bank-nbm', '1120');

let currentPlanTier: string = 'growth';
let currentUsage = 0;

vi.mock('@/lib/repositories', () => ({
  repos: {
    account: {
      findByCode: (_biz: string, code: string) =>
        Promise.resolve(ACCOUNTS_BY_CODE[code as keyof typeof ACCOUNTS_BY_CODE] ?? null),
      findById: (id: string) => Promise.resolve(ACCOUNTS_BY_ID[id] ?? null),
    },
    business: {
      findById: () => Promise.resolve({ plan_tier: currentPlanTier }),
    },
    journal: {
      createBalancedEntry: (header: Record<string, unknown>, lines: JournalLine[]) => {
        createdEntries.push({ header, lines });
        return Promise.resolve({ entry: { id: `entry-${++entrySeq}` }, lines });
      },
      post: (id: string) => {
        postedEntryIds.push(id);
        return Promise.resolve({ id });
      },
    },
    invoice: {
      update: (id: string, patch: Record<string, unknown>) => {
        invoiceUpdates.push({ id, patch });
        return Promise.resolve({ id, ...patch });
      },
    },
    expense: {
      update: (id: string, patch: Record<string, unknown>) => {
        expenseUpdates.push({ id, patch });
        return Promise.resolve({ id, ...patch });
      },
    },
  },
}));

vi.mock('@/services/webhook/WebhookService', () => ({
  webhookService: { triggerWebhooks: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/lib/billing/UsageService', () => ({
  usageService: {
    getCurrentMonthUsage: () => Promise.resolve(currentUsage),
    recordTransaction: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  createInvoiceJournalEntry,
  createInvoiceReceivableEntry,
  createInvoiceSettlementEntry,
  createExpenseJournalEntry,
  createExpenseSettlementEntry,
  createPayrollJournalEntry,
} from '@/services/journalService';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mwkInvoice(overrides: Record<string, unknown> = {}): Row<'invoices'> {
  return {
    id: 'inv-1',
    invoice_number: 'INV-0001',
    issue_date: '2026-08-01',
    currency: 'MWK',
    original_currency: 'MWK',
    exchange_rate: 1,
    subtotal: 100_000,
    vat_amount: 16_500,
    total_amount: 116_500,
    functional_amount: 116_500,
    revenue_account_id: null,
    journal_entry_id: null,
    ...overrides,
  } as unknown as Row<'invoices'>;
}

function mwkExpense(overrides: Record<string, unknown> = {}): Row<'expenses'> {
  return {
    id: 'exp-1',
    expense_number: 'EXP-0001',
    expense_date: '2026-08-01',
    expense_type: 'cash',
    currency: 'MWK',
    original_currency: 'MWK',
    exchange_rate: 1,
    total_amount: 58_250,
    functional_amount: 58_250,
    ...overrides,
  } as unknown as Row<'expenses'>;
}

// ── Assertions helpers ────────────────────────────────────────────────────────

function debitTotal(lines: JournalLine[]): number {
  return lines.filter((l) => l.is_debit).reduce((s, l) => s + l.amount_base, 0);
}
function creditTotal(lines: JournalLine[]): number {
  return lines.filter((l) => !l.is_debit).reduce((s, l) => s + l.amount_base, 0);
}
function expectBalanced(lines: JournalLine[]) {
  expect(debitTotal(lines)).toBeCloseTo(creditTotal(lines), 2);
}
function lineAccount(lines: JournalLine[], pred: (l: JournalLine) => boolean) {
  return lines.filter(pred).map((l) => l.account_id);
}

beforeEach(() => {
  createdEntries.length = 0;
  postedEntryIds.length = 0;
  invoiceUpdates.length = 0;
  expenseUpdates.length = 0;
  entrySeq = 0;
  currentPlanTier = 'growth';
  currentUsage = 0;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createInvoiceReceivableEntry', () => {
  it('posts Dr Debtors / Cr Revenue / Cr VAT and balances', async () => {
    await createInvoiceReceivableEntry('biz-1', mwkInvoice());

    expect(createdEntries).toHaveLength(1);
    const { lines } = createdEntries[0];
    expectBalanced(lines);

    expect(lineAccount(lines, (l) => l.is_debit)).toEqual(['acc-debtors']);
    expect(lineAccount(lines, (l) => !l.is_debit)).toEqual(['acc-revenue', 'acc-vat-pay']);

    const vatLine = lines.find((l) => l.account_id === 'acc-vat-pay')!;
    expect(vatLine.tax_code).toBe('vat_standard');
    expect(vatLine.tax_amount).toBeCloseTo(16_500, 2);

    // entry is posted immediately and linked back to the invoice
    expect(postedEntryIds).toEqual(['entry-1']);
    expect(invoiceUpdates).toEqual([{ id: 'inv-1', patch: { journal_entry_id: 'entry-1' } }]);
  });

  it('omits the VAT line for a zero-VAT invoice', async () => {
    await createInvoiceReceivableEntry(
      'biz-1',
      mwkInvoice({ subtotal: 50_000, vat_amount: 0, total_amount: 50_000, functional_amount: 50_000 }),
    );
    const { lines } = createdEntries[0];
    expect(lines).toHaveLength(2);
    expectBalanced(lines);
  });

  it('converts to functional currency at the invoice exchange rate', async () => {
    await createInvoiceReceivableEntry('biz-1', mwkInvoice({
      original_currency: 'USD',
      exchange_rate: 1700,
      subtotal: 86.21,
      vat_amount: 13.79,
      total_amount: 100,
      functional_amount: 170_000,
    }));
    const { header, lines } = createdEntries[0];
    expect(header.currency).toBe('USD');
    expectBalanced(lines);

    const revenue = lines.find((l) => l.account_id === 'acc-revenue')!;
    expect(revenue.amount).toBeCloseTo(86.21, 2);           // original currency
    expect(revenue.amount_base).toBeCloseTo(86.21 * 1700, 2); // functional
    expect(lines[0].amount_base).toBeCloseTo(170_000, 1);
  });

  it('always books to the default 4112 revenue account in the builder path', async () => {
    // NOTE: revenue_account_id is honoured only by the quick-entry path
    // (createInvoiceJournalEntry). The builder receivable always posts to
    // 4112 — this test documents that deliberate asymmetry.
    await createInvoiceReceivableEntry('biz-1', mwkInvoice({ revenue_account_id: 'acc-bank-nbm' }));
    expect(lineAccount(createdEntries[0].lines, (l) => !l.is_debit)).toContain('acc-revenue');
  });

  it('fails loudly when the COA is missing a required account', async () => {
    // Simulate an incomplete Chart of Accounts: findByCode returns null.
    const byCode = ACCOUNTS_BY_CODE as Record<string, Row<'accounts'> | undefined>;
    const original = byCode['1131'];
    byCode['1131'] = undefined;
    await expect(createInvoiceReceivableEntry('biz-1', mwkInvoice()))
      .rejects.toThrow(/1131 not found/);
    expect(createdEntries).toHaveLength(0); // nothing posted on failure
    byCode['1131'] = original;
  });
});

describe('createInvoiceSettlementEntry — IAS 21 realised FX', () => {
  const usdInvoice = () => mwkInvoice({
    original_currency: 'USD', currency: 'USD',
    exchange_rate: 1700, total_amount: 100, functional_amount: 170_000,
    subtotal: 86.21, vat_amount: 13.79,
  });

  function payment(overrides: Record<string, unknown>): Row<'invoice_payments'> {
    return {
      id: 'pay-1',
      payment_date: '2026-08-03',
      currency: 'USD',
      original_currency: 'USD',
      original_amount: 100,
      amount: 100,
      bank_account_id: null,
      ...overrides,
    } as unknown as Row<'invoice_payments'>;
  }

  it('posts Dr Cash / Cr Debtors with no FX line when rates match', async () => {
    await createInvoiceSettlementEntry(
      'biz-1', usdInvoice(), payment({ exchange_rate: 1700, functional_amount: 170_000 }), 'MWK',
    );
    const { lines } = createdEntries[0];
    expect(lines).toHaveLength(2);
    expectBalanced(lines);
    expect(lineAccount(lines, (l) => l.is_debit)).toEqual(['acc-cash']);
    expect(lineAccount(lines, (l) => !l.is_debit)).toEqual(['acc-debtors']);
  });

  it('credits 4230 FX Gain when the kwacha weakens before settlement', async () => {
    await createInvoiceSettlementEntry(
      'biz-1', usdInvoice(), payment({ exchange_rate: 1750, functional_amount: 175_000 }), 'MWK',
    );
    const { lines } = createdEntries[0];
    expect(lines).toHaveLength(3);
    expectBalanced(lines); // cash 175,000 = debtor clear 170,000 + gain 5,000

    const fx = lines[2];
    expect(fx.account_id).toBe('acc-fx-gain');
    expect(fx.is_debit).toBe(false);
    expect(fx.amount_base).toBe(5_000);
  });

  it('debits 7300 FX Loss when the kwacha strengthens before settlement', async () => {
    await createInvoiceSettlementEntry(
      'biz-1', usdInvoice(), payment({ exchange_rate: 1650, functional_amount: 165_000 }), 'MWK',
    );
    const { lines } = createdEntries[0];
    const fx = lines[2];
    expect(fx.account_id).toBe('acc-fx-loss');
    expect(fx.is_debit).toBe(true);
    expect(fx.amount_base).toBe(5_000);
    expectBalanced(lines);
  });

  it('clears the debtor at the BOOKED rate, not the settlement rate', async () => {
    await createInvoiceSettlementEntry(
      'biz-1', usdInvoice(), payment({ exchange_rate: 1750, functional_amount: 175_000 }), 'MWK',
    );
    const debtorClear = createdEntries[0].lines[1];
    expect(debtorClear.account_id).toBe('acc-debtors');
    expect(debtorClear.amount_base).toBe(170_000);
    expect(debtorClear.exchange_rate).toBe(1700);
  });

  it('routes the cash line to the payment bank account when given', async () => {
    await createInvoiceSettlementEntry(
      'biz-1', usdInvoice(),
      payment({ exchange_rate: 1700, functional_amount: 170_000, bank_account_id: 'acc-bank-nbm' }),
      'MWK',
    );
    expect(createdEntries[0].lines[0].account_id).toBe('acc-bank-nbm');
  });
});

describe('createExpenseJournalEntry', () => {
  const alloc = [{ accountId: 'acc-salaries', amount: 50_000 }];

  it('posts allocations Dr + VAT Dr / Cr Cash for cash expenses', async () => {
    await createExpenseJournalEntry('biz-1', mwkExpense(), alloc, 8_250);
    const { lines } = createdEntries[0];

    expectBalanced(lines);
    expect(lineAccount(lines, (l) => l.is_debit)).toEqual(['acc-salaries', 'acc-vat-rec']);
    expect(lineAccount(lines, (l) => !l.is_debit)).toEqual(['acc-cash']);

    const vat = lines.find((l) => l.account_id === 'acc-vat-rec')!;
    expect(vat.tax_code).toBe('vat_standard');
    expect(vat.tax_amount).toBeCloseTo(8_250, 2);
  });

  it('credits Trade Creditors (2111) instead of Cash for supplier bills', async () => {
    await createExpenseJournalEntry(
      'biz-1', mwkExpense({ expense_type: 'bill' }), alloc, 8_250,
    );
    const { lines } = createdEntries[0];
    expect(lineAccount(lines, (l) => !l.is_debit)).toEqual(['acc-creditors']);
  });

  it('keeps line numbers contiguous across allocations, VAT and credit', async () => {
    await createExpenseJournalEntry('biz-1', mwkExpense(), [
      { accountId: 'acc-salaries', amount: 30_000 },
      { accountId: 'acc-cash', amount: 20_000, description: 'Materials' },
    ], 8_250);
    const numbers = createdEntries[0].lines.map((l) => l.line_number);
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  it('refuses to post when allocations + VAT do not equal the total', async () => {
    await expect(
      createExpenseJournalEntry('biz-1', mwkExpense(), [{ accountId: 'acc-salaries', amount: 40_000 }], 8_250),
    ).rejects.toThrow(/do not match the total/);
    expect(createdEntries).toHaveLength(0); // nothing posted on validation failure
  });

  it('enforces the monthly transaction limit of the plan', async () => {
    currentPlanTier = 'free'; // transactionLimit: 50
    currentUsage = 50;
    await expect(
      createExpenseJournalEntry('biz-1', mwkExpense(), alloc, 8_250),
    ).rejects.toThrow(/transaction limit/i);
    expect(createdEntries).toHaveLength(0);
  });
});

describe('createExpenseSettlementEntry — IAS 21 payable mirror', () => {
  const usdExpense = () => mwkExpense({
    expense_type: 'bill',
    original_currency: 'USD', currency: 'USD',
    exchange_rate: 1700, total_amount: 100, functional_amount: 170_000,
  });

  it('posts Dr Creditors / Cr Cash at matching rates, no FX line', async () => {
    await createExpenseSettlementEntry('biz-1', usdExpense(), {
      payment_date: '2026-08-03', currency: 'USD', original_currency: 'USD',
      original_amount: 100, amount: 100, exchange_rate: 1700, functional_amount: 170_000,
      bank_account_id: null,
    } as unknown as Row<'expense_payments'>, 'MWK');

    const { lines } = createdEntries[0];
    expect(lines).toHaveLength(2);
    expectBalanced(lines);
    expect(lineAccount(lines, (l) => l.is_debit)).toEqual(['acc-creditors']);
    expect(lineAccount(lines, (l) => !l.is_debit)).toEqual(['acc-cash']);
  });

  it('debits 7300 FX Loss when a foreign supplier bill costs more at settlement', async () => {
    await createExpenseSettlementEntry('biz-1', usdExpense(), {
      payment_date: '2026-08-03', currency: 'USD', original_currency: 'USD',
      original_amount: 100, amount: 100, exchange_rate: 1750, functional_amount: 175_000,
      bank_account_id: null,
    } as unknown as Row<'expense_payments'>, 'MWK');

    const { lines } = createdEntries[0];
    const fx = lines[2];
    expect(fx.account_id).toBe('acc-fx-loss');
    expect(fx.is_debit).toBe(true);
    expect(fx.amount_base).toBe(5_000);
    expectBalanced(lines); // creditors 170,000 + loss 5,000 = cash 175,000
  });
});

describe('createPayrollJournalEntry', () => {
  it('posts Dr Gross Pay / Cr PAYE / Cr Net Pay, balanced via gross = PAYE + net', async () => {
    await createPayrollJournalEntry('biz-1', 'PR-2026-08', '2026-08-31', 1_000_000, 200_000, 800_000, 'run-1');

    const { lines, header } = createdEntries[0];
    expectBalanced(lines);
    expect(header.currency).toBe('MWK');
    expect(lineAccount(lines, (l) => l.is_debit)).toEqual(['acc-salaries']);
    expect(lineAccount(lines, (l) => !l.is_debit)).toEqual(['acc-paye', 'acc-sal-pay']);

    const paye = lines.find((l) => l.account_id === 'acc-paye')!;
    expect(paye.tax_code).toBe('paye');
    expect(paye.tax_amount).toBe(200_000);
  });
});

describe('createInvoiceJournalEntry (quick-entry auto-paid path)', () => {
  it('posts BOTH the receivable and the settlement entry, each balanced', async () => {
    await createInvoiceJournalEntry('biz-1', mwkInvoice(), 100_000, 16_500);

    expect(createdEntries).toHaveLength(2);
    expectBalanced(createdEntries[0].lines);
    expectBalanced(createdEntries[1].lines);

    // Receivable: Dr Debtors / Cr Revenue / Cr VAT
    expect(lineAccount(createdEntries[0].lines, (l) => l.is_debit)).toEqual(['acc-debtors']);
    // Settlement: Dr Cash / Cr Debtors
    expect(lineAccount(createdEntries[1].lines, (l) => l.is_debit)).toEqual(['acc-cash']);
    expect(lineAccount(createdEntries[1].lines, (l) => !l.is_debit)).toEqual(['acc-debtors']);

    expect(postedEntryIds).toHaveLength(2);
  }, 15_000);

  it('honours a custom revenue_account_id on the invoice', async () => {
    ACCOUNTS_BY_ID['acc-custom-rev'] = acc('acc-custom-rev', '4113');
    await createInvoiceJournalEntry('biz-1', mwkInvoice({ revenue_account_id: 'acc-custom-rev' }), 100_000, 16_500);
    expect(lineAccount(createdEntries[0].lines, (l) => !l.is_debit)).toContain('acc-custom-rev');
    delete ACCOUNTS_BY_ID['acc-custom-rev'];
  }, 15_000);
});
