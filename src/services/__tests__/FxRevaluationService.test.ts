/**
 * Integration tests for the IAS 21 period-end FX revaluation service.
 *
 * `repos`, the exchange-rate service, and the bare supabase client are all
 * mocked at the module boundary so the whole service — open-balance
 * detection, gain/loss line construction, entry balancing, audit-trail
 * insert, and the idempotency guard — runs end-to-end while every journal
 * entry and fx_revaluations row it WOULD write is captured and asserted.
 *
 * What this protects: a misrouted revaluation corrupts Debtors/Creditors
 * and the P&L, and a broken idempotency guard double-posts unrealised
 * gains/losses on every re-run (the table's unique constraint fires only
 * AFTER the duplicate journal entry already exists).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Row } from '@/dal/types/database';

// ── Captured writes ───────────────────────────────────────────────────────────

type CapturedLine = Record<string, unknown> & {
  line_number: number;
  account_id: string;
  is_debit: boolean;
  amount: number;
  amount_base: number;
  currency: string;
  exchange_rate: number;
};

const createdEntries: { header: Record<string, unknown>; lines: CapturedLine[] }[] = [];
const postedEntryIds: string[] = [];
const insertedRuns: Record<string, unknown>[] = [];
const rateCalls: { from: string; to: string; date: string }[] = [];

let entrySeq = 0;
let existingRuns: Array<Record<string, unknown>> = [];
let closingRate = 900;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACCOUNTS = {
  '1131': { id: 'acc-debtors', code: '1131' },
  '2111': { id: 'acc-creditors', code: '2111' },
  '4230': { id: 'acc-fx-gain', code: '4230' },
  '7300': { id: 'acc-fx-loss', code: '7300' },
};
let missingAccounts = false;

let invoices: Array<Record<string, unknown>> = [];
let expenses: Array<Record<string, unknown>> = [];

function usdInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inv-1',
    invoice_number: 'INV-0001',
    status: 'sent',
    currency: 'USD',
    original_currency: 'USD',
    total_amount: 100,
    original_amount: 100,
    amount_paid: 0,
    exchange_rate: 800, // booked at 800 MWK/USD
    ...overrides,
  };
}

function usdBill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'exp-1',
    expense_number: 'EXP-0001',
    status: 'approved',
    currency: 'USD',
    original_currency: 'USD',
    total_amount: 100,
    original_amount: 100,
    amount_paid: 0,
    exchange_rate: 800,
    ...overrides,
  };
}

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/repositories', () => ({
  repos: {
    account: {
      findByCode: (_biz: string, code: string) =>
        Promise.resolve(missingAccounts ? null : ACCOUNTS[code as keyof typeof ACCOUNTS] ?? null),
    },
    business: {
      findById: () => Promise.resolve({ base_currency: 'MWK' }),
    },
    invoice: {
      findByBusiness: () => Promise.resolve(invoices as Row<'invoices'>[]),
    },
    expense: {
      findByBusiness: () => Promise.resolve(expenses as Row<'expenses'>[]),
    },
    journal: {
      createBalancedEntry: (header: Record<string, unknown>, lines: CapturedLine[]) => {
        createdEntries.push({ header, lines });
        return Promise.resolve({ entry: { id: `je-${++entrySeq}` }, lines });
      },
      post: (id: string) => {
        postedEntryIds.push(id);
        return Promise.resolve({ id });
      },
    },
  },
}));

vi.mock('@/lib/supabase', () => {
  const fxTable = () => {
    let mode: 'select' | 'insert' = 'select';
    const handler: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
              onFulfilled({ data: mode === 'select' ? existingRuns : null, error: null });
          }
          if (prop === 'select') {
            return () => {
              mode = 'select';
              return handler;
            };
          }
          if (prop === 'insert') {
            return (row: Record<string, unknown>) => {
              insertedRuns.push(row);
              mode = 'insert';
              return handler;
            };
          }
          return () => handler; // eq, etc.
        },
      },
    );
    return handler;
  };
  return { supabase: { from: () => fxTable() } };
});

vi.mock('@/lib/currency', () => ({
  exchangeRateService: {
    getRate: (_biz: string, from: string, to: string, date: string) => {
      rateCalls.push({ from, to, date });
      return Promise.resolve({ rate: closingRate, rateDate: date, isStale: false, source: 'manual' });
    },
  },
}));

vi.mock('@/services/journalService', () => ({
  nextEntryNumber: () => Promise.resolve('JE-2026-0001'),
}));

import { runFxRevaluation } from '@/services/FxRevaluationService';

beforeEach(() => {
  createdEntries.length = 0;
  postedEntryIds.length = 0;
  insertedRuns.length = 0;
  rateCalls.length = 0;
  existingRuns = [];
  invoices = [];
  expenses = [];
  closingRate = 900;
  missingAccounts = false;
  entrySeq = 0;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runFxRevaluation — guards', () => {
  it('requires a signed-in user', async () => {
    await expect(runFxRevaluation('biz-1', '2026-01-31', null)).rejects.toThrow(/signed in/);
    expect(createdEntries).toHaveLength(0);
  });

  it('refuses to re-run a date that already has a revaluation (idempotency)', async () => {
    existingRuns = [{ id: 'run-1', status: 'completed', journal_entry_id: 'je-old' }];
    invoices = [usdInvoice()];
    await expect(runFxRevaluation('biz-1', '2026-01-31', 'user-1'))
      .rejects.toThrow(/already been run for 2026-01-31/);
    // Critically, nothing may be posted before the guard fires.
    expect(createdEntries).toHaveLength(0);
    expect(insertedRuns).toHaveLength(0);
  });

  it('throws a helpful error when a COA account is missing', async () => {
    missingAccounts = true;
    await expect(runFxRevaluation('biz-1', '2026-01-31', 'user-1'))
      .rejects.toThrow(/repair\/reseed the Chart of Accounts/);
  });
});

describe('runFxRevaluation — trade receivables', () => {
  it('books an unrealised gain when the functional currency weakens', async () => {
    invoices = [usdInvoice()];
    const result = await runFxRevaluation('biz-1', '2026-01-31', 'user-1');

    expect(createdEntries).toHaveLength(1);
    const { header, lines } = createdEntries[0];
    expect(header).toMatchObject({
      entry_number: 'JE-2026-0001',
      entry_date: '2026-01-31',
      source_type: 'fx_revaluation',
      status: 'draft',
      created_by: 'user-1',
    });

    // Dr Debtors 100 USD (translated at the closing rate) / Cr FX Gains.
    expect(lines).toHaveLength(2);
    const [debtors, gain] = lines;
    expect(debtors).toMatchObject({
      line_number: 1, account_id: 'acc-debtors', is_debit: true,
      amount: 100, amount_base: 10_000, currency: 'USD', exchange_rate: 900,
    });
    expect(gain).toMatchObject({
      line_number: 2, account_id: 'acc-fx-gain', is_debit: false,
      amount: 10_000, amount_base: 10_000, currency: 'MWK', exchange_rate: 1,
    });
    expect(debtors.description).toContain('INV-0001');

    expect(postedEntryIds).toEqual(['je-1']);
    expect(result).toEqual({
      journalEntryId: 'je-1', lineCount: 2,
      totalUnrealisedGain: 10_000, totalUnrealisedLoss: 0,
    });
    expect(insertedRuns[0]).toMatchObject({
      revaluation_date: '2026-01-31', journal_entry_id: 'je-1',
      total_unrealised_gain: 10_000, total_unrealised_loss: 0, line_count: 2,
    });
  });

  it('books an unrealised loss when the functional currency strengthens', async () => {
    closingRate = 700;
    invoices = [usdInvoice()];
    const result = await runFxRevaluation('biz-1', '2026-01-31', 'user-1');

    const { lines } = createdEntries[0];
    expect(lines[0]).toMatchObject({
      line_number: 1, account_id: 'acc-fx-loss', is_debit: true,
      amount: 10_000, amount_base: 10_000, currency: 'MWK',
    });
    expect(lines[1]).toMatchObject({
      line_number: 2, account_id: 'acc-debtors', is_debit: false,
      amount: 100, amount_base: 10_000, currency: 'USD',
    });
    expect(result.totalUnrealisedGain).toBe(0);
    expect(result.totalUnrealisedLoss).toBe(10_000);
  });

  it('revalues only the OUTSTANDING portion of a partially paid invoice', async () => {
    invoices = [usdInvoice({ status: 'partially_paid', amount_paid: 40 })];
    await runFxRevaluation('biz-1', '2026-01-31', 'user-1');
    const { lines } = createdEntries[0];
    // Open = 60 USD x (900 − 800) = 6,000 MWK.
    expect(lines[0]).toMatchObject({ account_id: 'acc-debtors', amount: 60, amount_base: 6_000 });
    expect(lines[1]).toMatchObject({ account_id: 'acc-fx-gain', amount_base: 6_000 });
  });
});

describe('runFxRevaluation — trade payables (mirror image of receivables)', () => {
  it('books an unrealised LOSS when the liability grows', async () => {
    expenses = [usdBill()];
    const result = await runFxRevaluation('biz-1', '2026-01-31', 'user-1');
    const { lines } = createdEntries[0];
    expect(lines[0]).toMatchObject({
      line_number: 1, account_id: 'acc-fx-loss', is_debit: true, amount_base: 10_000,
    });
    expect(lines[1]).toMatchObject({
      line_number: 2, account_id: 'acc-creditors', is_debit: false,
      amount: 100, amount_base: 10_000, currency: 'USD',
    });
    expect(result).toMatchObject({ totalUnrealisedGain: 0, totalUnrealisedLoss: 10_000 });
  });

  it('books an unrealised GAIN when the liability shrinks', async () => {
    closingRate = 700;
    expenses = [usdBill()];
    const result = await runFxRevaluation('biz-1', '2026-01-31', 'user-1');
    const { lines } = createdEntries[0];
    expect(lines[0]).toMatchObject({
      line_number: 1, account_id: 'acc-creditors', is_debit: true,
      amount: 100, amount_base: 10_000, currency: 'USD',
    });
    expect(lines[1]).toMatchObject({
      line_number: 2, account_id: 'acc-fx-gain', is_debit: false, amount_base: 10_000,
    });
    expect(result).toMatchObject({ totalUnrealisedGain: 10_000, totalUnrealisedLoss: 0 });
  });
});

describe('runFxRevaluation — mixed and empty portfolios', () => {
  it('aggregates gains and losses into one balanced posted entry', async () => {
    // 100 USD receivable gain at 900; 50 USD payable at 700 -> gain 5,000.
    invoices = [usdInvoice()];
    expenses = [usdBill({ expense_number: 'EXP-0002', total_amount: 50, original_amount: 50 })];
    closingRate = 900;
    await runFxRevaluation('biz-1', '2026-01-31', 'user-1');

    // Rate is looked up once per open monetary item.
    expect(rateCalls).toEqual([
      { from: 'USD', to: 'MWK', date: '2026-01-31' },
      { from: 'USD', to: 'MWK', date: '2026-01-31' },
    ]);
    expect(createdEntries).toHaveLength(1);
    const { lines } = createdEntries[0];
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.line_number)).toEqual([1, 2, 3, 4]);
    const debits = lines.filter((l) => l.is_debit).reduce((s, l) => s + l.amount_base, 0);
    const credits = lines.filter((l) => !l.is_debit).reduce((s, l) => s + l.amount_base, 0);
    expect(debits).toBe(credits);
    // 50 USD payable x (900 − 800) = 5,000 additional loss.
    expect(insertedRuns[0]).toMatchObject({
      total_unrealised_gain: 10_000, total_unrealised_loss: 5_000, line_count: 4,
    });
  });

  it('posts nothing when every item is functional-currency, settled, or immaterial — but still writes the audit row', async () => {
    invoices = [
      usdInvoice({ id: 'inv-mwk', invoice_number: 'INV-MWK', currency: 'MWK', original_currency: 'MWK' }), // functional
      usdInvoice({ id: 'inv-paid', invoice_number: 'INV-PAID', status: 'paid', amount_paid: 100 }), // settled status
      usdInvoice({ id: 'inv-zero', invoice_number: 'INV-ZERO', status: 'sent', amount_paid: 100 }), // nothing open
      usdInvoice({ id: 'inv-draft', invoice_number: 'INV-DRAFT', status: 'draft' }), // not yet a receivable
      usdInvoice({ id: 'inv-tiny', invoice_number: 'INV-TINY', total_amount: 0.02, original_amount: 0.02 }), // |0.02 x 100| = 2.0 -> material
    ];
    // Make the last one immaterial instead: rate difference x open < 0.005.
    invoices.pop();
    invoices.push(usdInvoice({ id: 'inv-tiny', invoice_number: 'INV-TINY', total_amount: 0.00004, original_amount: 0.00004 }));
    expenses = [usdBill({ status: 'paid', amount_paid: 100 })];

    const result = await runFxRevaluation('biz-1', '2026-01-31', 'user-1');

    expect(result).toEqual({
      journalEntryId: null, lineCount: 0,
      totalUnrealisedGain: 0, totalUnrealisedLoss: 0,
    });
    expect(createdEntries).toHaveLength(0);
    expect(postedEntryIds).toHaveLength(0);
    // The idempotency audit row is written even for a no-op run.
    expect(insertedRuns).toHaveLength(1);
    expect(insertedRuns[0]).toMatchObject({
      revaluation_date: '2026-01-31', total_unrealised_gain: 0,
      total_unrealised_loss: 0, line_count: 0, created_by: 'user-1',
    });
  });
});
