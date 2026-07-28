import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JournalRepository } from '../JournalRepository';
import { ValidationError } from '../../errors/RepositoryError';
import type { Database, InsertDto } from '../../types/database';

/**
 * Double-entry integrity tests.
 *
 * `createBalancedEntry` is the chokepoint every posting in the system flows
 * through — invoices, expenses, payroll, FX revaluation, depreciation, capital.
 * If it ever lets an unbalanced entry through, the trial balance stops summing
 * to zero and every downstream financial statement is quietly wrong. These
 * tests assert the guard rejects bad input BEFORE any write is attempted.
 *
 * The Supabase client is stubbed: the guard runs before any network call, so
 * the balanced-path stub only needs to satisfy the insert that follows.
 */

type Line = Omit<InsertDto<'journal_lines'>, 'journal_entry_id' | 'business_id'>;

/** Minimal journal line; only the fields the balance check reads matter. */
function line(amountBase: number, isDebit: boolean, lineNumber = 1): Line {
  return {
    line_number: lineNumber,
    account_id: `acct-${lineNumber}`,
    description: 'test line',
    is_debit: isDebit,
    amount: amountBase,
    amount_base: amountBase,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none',
    tax_amount: 0,
    reconciled: false,
  } as Line;
}

const ENTRY = {
  business_id: 'biz-1',
  entry_number: 'JE-0001',
  entry_date: '2026-07-28',
  description: 'test entry',
  source_type: 'manual',
  currency: 'MWK',
  exchange_rate: 1,
  status: 'draft',
} as unknown as InsertDto<'journal_entries'>;

/**
 * Builds a repo whose `create` succeeds and whose journal_lines insert returns
 * the rows given to it, so the happy path can be followed to completion.
 */
function makeRepo() {
  const insertedLines: unknown[] = [];

  const client = {
    from: vi.fn(() => ({
      insert: vi.fn((rows: unknown[]) => {
        insertedLines.push(...rows);
        return { select: vi.fn(async () => ({ data: rows, error: null })) };
      }),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  } as unknown as SupabaseClient<Database>;

  const repo = new JournalRepository(client);
  // `create` belongs to BaseRepository and does its own query building;
  // stub it so these tests isolate the balance invariant.
  vi.spyOn(repo, 'create').mockResolvedValue({
    id: 'entry-1',
    business_id: 'biz-1',
  } as never);

  return { repo, insertedLines };
}

describe('JournalRepository.createBalancedEntry — double-entry invariant', () => {
  it('rejects an entry with fewer than two lines', async () => {
    const { repo } = makeRepo();
    await expect(repo.createBalancedEntry(ENTRY, [line(100, true)])).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects an entry with no lines at all', async () => {
    const { repo } = makeRepo();
    await expect(repo.createBalancedEntry(ENTRY, [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when debits do not equal credits', async () => {
    const { repo } = makeRepo();
    const lines = [line(1000, true, 1), line(900, false, 2)];
    await expect(repo.createBalancedEntry(ENTRY, lines)).rejects.toThrow(/does not balance/i);
  });

  it('does not write anything when the entry is unbalanced', async () => {
    const { repo, insertedLines } = makeRepo();
    const lines = [line(1000, true, 1), line(900, false, 2)];
    await expect(repo.createBalancedEntry(ENTRY, lines)).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
    expect(insertedLines).toHaveLength(0);
  });

  it('accepts a simple balanced two-line entry', async () => {
    const { repo, insertedLines } = makeRepo();
    const lines = [line(1000, true, 1), line(1000, false, 2)];
    await expect(repo.createBalancedEntry(ENTRY, lines)).resolves.toBeTruthy();
    expect(insertedLines).toHaveLength(2);
  });

  it('accepts a balanced multi-line (split) entry', async () => {
    const { repo } = makeRepo();
    // e.g. an expense split across two accounts plus VAT, settled from bank
    const lines = [
      line(700, true, 1),
      line(300, true, 2),
      line(160, true, 3),
      line(1160, false, 4),
    ];
    await expect(repo.createBalancedEntry(ENTRY, lines)).resolves.toBeTruthy();
  });

  it('tolerates sub-half-tambala rounding drift', async () => {
    const { repo } = makeRepo();
    // 0.004 difference is below the 0.005 tolerance and must be accepted,
    // otherwise legitimate FX/tax rounding would block posting.
    const lines = [line(1000.004, true, 1), line(1000, false, 2)];
    await expect(repo.createBalancedEntry(ENTRY, lines)).resolves.toBeTruthy();
  });

  it('rejects drift at or beyond the half-tambala tolerance', async () => {
    const { repo } = makeRepo();
    const lines = [line(1000.02, true, 1), line(1000, false, 2)];
    await expect(repo.createBalancedEntry(ENTRY, lines)).rejects.toThrow(/does not balance/i);
  });

  it('balances on amount_base (functional currency), not the original amount', async () => {
    const { repo } = makeRepo();
    // A USD invoice: `amount` differs wildly between the two legs, but the
    // MWK functional amounts match. This must post.
    const debit = { ...line(1000, true, 1), amount: 1000, amount_base: 1_750_000 } as Line;
    const credit = { ...line(1000, false, 2), amount: 5, amount_base: 1_750_000 } as Line;
    await expect(repo.createBalancedEntry(ENTRY, [debit, credit])).resolves.toBeTruthy();
  });

  it('rejects when amount_base is unbalanced even though amount balances', async () => {
    const { repo } = makeRepo();
    const debit = { ...line(1000, true, 1), amount: 1000, amount_base: 1_750_000 } as Line;
    const credit = { ...line(1000, false, 2), amount: 1000, amount_base: 1_600_000 } as Line;
    await expect(repo.createBalancedEntry(ENTRY, [debit, credit])).rejects.toThrow(
      /does not balance/i,
    );
  });

  it('stamps every line with the parent entry id and business id', async () => {
    const { repo, insertedLines } = makeRepo();
    await repo.createBalancedEntry(ENTRY, [line(500, true, 1), line(500, false, 2)]);
    for (const l of insertedLines as Record<string, unknown>[]) {
      expect(l.journal_entry_id).toBe('entry-1');
      expect(l.business_id).toBe('biz-1');
    }
  });
});
