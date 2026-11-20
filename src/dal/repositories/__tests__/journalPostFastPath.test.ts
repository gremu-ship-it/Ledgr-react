import { describe, it, expect, vi } from 'vitest';
import { JournalRepository } from '../JournalRepository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../../types/database';

/**
 * `JournalRepository.post()` is a command call now.
 *
 * The draft→posted transition used to be a conditional `UPDATE` on
 * `journal_entries`, which the command-only RLS policy refuses
 * (`journal_entries_command_update` is `USING (false)`), so every posting
 * attempt failed with "new row violates row-level security policy".
 *
 * The transition now goes through `public.post_draft_financial_journal`, which
 * holds the row lock, re-checks `can_write_financial_data`, refuses any
 * non-draft entry, and fires the period-lock trigger. The repository still
 * returns the stored row, so callers are unchanged.
 */

const postedEntry = {
  id: 'je-1',
  status: 'posted',
  posted_by: 'user-1',
} as unknown as Row<'journal_entries'>;

function makeClient(overrides: {
  rpcResult?: { data: unknown; error: unknown };
  row?: Row<'journal_entries'> | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue(overrides.rpcResult ?? { data: 'je-1', error: null });

  const maybeSingle = vi.fn().mockResolvedValue({
    data: overrides.row === undefined ? postedEntry : overrides.row,
    error: null,
  });
  const eq = vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle })), maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const update = vi.fn();
  const insert = vi.fn();
  const del = vi.fn();
  const from = vi.fn(() => ({ select, update, insert, delete: del }));

  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    spies: { from, rpc, select, eq, maybeSingle, update, insert, del },
  };
}

describe('JournalRepository.post command', () => {
  it('posts through the SECURITY DEFINER command and never writes the table directly', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    const result = await repo.post('je-1', 'user-1');

    expect(spies.rpc).toHaveBeenCalledTimes(1);
    expect(spies.rpc).toHaveBeenCalledWith('post_draft_financial_journal', {
      p_entry_id: 'je-1',
      p_posted_by: 'user-1',
    });
    // The command-only policy is the boundary: the client must not attempt DML.
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.del).not.toHaveBeenCalled();

    expect(result.status).toBe('posted');
  });

  it('accepts a null posted_by (system posts) and still returns the stored row', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    await expect(repo.post('je-1', null)).resolves.toMatchObject({ id: 'je-1' });
    expect(spies.rpc).toHaveBeenCalledWith('post_draft_financial_journal', {
      p_entry_id: 'je-1',
      p_posted_by: null,
    });
  });

  it('surfaces a permission refusal from the command', async () => {
    const { client } = makeClient({
      rpcResult: {
        data: null,
        error: { code: '42501', message: 'Not authorised to post financial journals for this business.' },
      },
    });
    const repo = new JournalRepository(client);

    await expect(repo.post('je-1', 'user-1')).rejects.toThrow(/not authori[sz]ed/i);
  });

  it('surfaces the draft-only immutability rule with the server message', async () => {
    const { client } = makeClient({
      rpcResult: {
        data: null,
        error: {
          code: '22023',
          message: "Cannot post journal entry je-1: current status is 'posted'. Only 'draft' entries may be posted. To correct a posted entry, create a reversal.",
        },
      },
    });
    const repo = new JournalRepository(client);

    await expect(repo.post('je-1', null)).rejects.toThrow(/Only 'draft' entries may be posted/);
  });

  it('surfaces a missing entry as a not-found style refusal', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { code: '22023', message: 'Journal entry missing was not found.' } },
    });
    const repo = new JournalRepository(client);

    await expect(repo.post('missing', null)).rejects.toThrow(/was not found/i);
  });
});
