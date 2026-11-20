import { describe, it, expect, vi } from 'vitest';
import { JournalRepository } from '../JournalRepository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, Row } from '../../types/database';
import { ValidationError, UnauthorizedError } from '../../errors/RepositoryError';

/**
 * `createBalancedEntry` posts through `public.post_financial_journal`.
 *
 * Issue Shares, loans, depreciation, fixed assets, inventory journals, tax
 * accruals and payroll accruals all build a balanced header + lines here. The
 * old implementation inserted into `journal_entries`/`journal_lines` from the
 * browser, which the command-only RLS policies refuse for every role — the
 * reported "new row violates row-level security policy for table
 * \"journal_entries\"". The command is now the only write path.
 */

const entryHeader = {
  business_id: 'biz-1',
  entry_number: 'JNL-20261120-000001',
  entry_date: '2026-11-20',
  description: 'Share capital issued — Jane Banda',
  currency: 'MWK',
  exchange_rate: 1,
  source_type: 'share_issue',
  status: 'draft',
  created_by: 'user-1',
} as unknown as InsertDto<'journal_entries'>;

const lines = [
  {
    line_number: 1,
    account_id: 'bank-account',
    description: 'Share capital issued',
    is_debit: true,
    amount: 500,
    amount_base: 500,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none' as const,
    tax_amount: 0,
    reconciled: false,
    rate_is_stale: false,
  },
  {
    line_number: 2,
    account_id: 'share-account',
    description: 'Share capital issued',
    is_debit: false,
    amount: 500,
    amount_base: 500,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none' as const,
    tax_amount: 0,
    reconciled: false,
    rate_is_stale: false,
  },
];

const storedEntry = { id: 'je-1', ...entryHeader } as unknown as Row<'journal_entries'>;
const storedLines = lines.map((line, index) => ({
  id: `jl-${index + 1}`,
  journal_entry_id: 'je-1',
  business_id: 'biz-1',
  ...line,
})) as unknown as Row<'journal_lines'>[];

function makeClient(overrides: { rpcResult?: { data: unknown; error: unknown } } = {}) {
  const rpc = vi.fn().mockResolvedValue(overrides.rpcResult ?? { data: 'je-1', error: null });

  // findById → journal_entries … .eq().maybeSingle()
  const entryMaybeSingle = vi.fn().mockResolvedValue({ data: storedEntry, error: null });
  const entryEq = vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: entryMaybeSingle })), maybeSingle: entryMaybeSingle }));

  // lines read → journal_lines … .eq().eq().order()
  const order = vi.fn().mockResolvedValue({ data: storedLines, error: null });
  const linesSecondEq = vi.fn(() => ({ order }));
  const linesFirstEq = vi.fn(() => ({ eq: linesSecondEq }));

  const insert = vi.fn();
  const update = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === 'journal_lines') return { select: vi.fn(() => ({ eq: linesFirstEq })), insert };
    return { select: vi.fn(() => ({ eq: entryEq })), insert, update };
  });

  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    spies: { from, rpc, insert, update, entryMaybeSingle, order },
  };
}

describe('JournalRepository.createBalancedEntry command', () => {
  it('posts through post_financial_journal and returns the stored entry with its lines', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    const result = await repo.createBalancedEntry(entryHeader, lines);

    expect(spies.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = spies.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('post_financial_journal');
    expect(args).toMatchObject({
      p_business_id: 'biz-1',
      p_entry_date: '2026-11-20',
      p_description: 'Share capital issued — Jane Banda',
      p_source_type: 'share_issue',
      p_currency: 'MWK',
      p_exchange_rate: 1,
      // Header drafts stay drafts; posting is an explicit second command.
      p_status: 'draft',
      p_entry_number: 'JNL-20261120-000001',
    });
    // Lines are mapped to the schema's vocabulary, not the debit/credit pair.
    expect(args.p_lines).toEqual([
      expect.objectContaining({ account_id: 'bank-account', is_debit: true, amount: 500, amount_base: 500 }),
      expect.objectContaining({ account_id: 'share-account', is_debit: false, amount: 500, amount_base: 500 }),
    ]);

    // No direct table writes: the command owns the ledger.
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();

    expect(result.entry.id).toBe('je-1');
    expect(result.lines).toHaveLength(2);
  });

  it('rejects fewer than two lines before calling the command', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    await expect(repo.createBalancedEntry(entryHeader, [lines[0]])).rejects.toThrow(/at least two lines/i);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('rejects an unbalanced entry before calling the command', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    await expect(repo.createBalancedEntry(entryHeader, [
      { ...lines[0], amount: 500, amount_base: 500 },
      { ...lines[1], amount: 400, amount_base: 400 },
    ])).rejects.toThrow(/does not balance/i);
    expect(spies.rpc).not.toHaveBeenCalled();
  });

  it('surfaces a closed-period refusal with the server sentence, not a generic database error', async () => {
    const { client } = makeClient({
      rpcResult: {
        data: null,
        error: {
          code: '22023',
          message: 'period-closed: Journal entry dated 2026-08-31 falls in the closed period "FY2025" (2025-01-01 to 2025-12-31). Record the correction in an open period (credit note, reversing journal or stock adjustment).',
        },
      },
    });
    const repo = new JournalRepository(client);

    const error = await repo.createBalancedEntry(entryHeader, lines).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/^period-closed:/);
    expect((error as Error).message).not.toMatch(/Database error/);
  });

  it('surfaces an authority refusal as an UnauthorizedError', async () => {
    const { client } = makeClient({
      rpcResult: {
        data: null,
        error: { code: '42501', message: 'Not authorised to post financial journals for this business.' },
      },
    });
    const repo = new JournalRepository(client);

    await expect(repo.createBalancedEntry(entryHeader, lines)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('re-assigns the cost centre through the command instead of updating the tables', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    await repo.assignCostCentre('je-1', 'branch-1', null);

    expect(spies.rpc).toHaveBeenCalledWith('assign_financial_journal_cost_centre', {
      p_entry_id: 'je-1',
      p_branch_id: 'branch-1',
      p_department_id: null,
    });
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('fails loudly when the command returns no entry id', async () => {
    const { client } = makeClient({ rpcResult: { data: null, error: null } });
    const repo = new JournalRepository(client);

    await expect(repo.createBalancedEntry(entryHeader, lines)).rejects.toThrow(/returned no journal entry/i);
  });
});
