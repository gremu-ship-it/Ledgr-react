import { describe, it, expect, vi } from 'vitest';
import { JournalRepository } from '../JournalRepository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../../types/database';

/**
 * PERF regression cover for the transaction save path.
 *
 * JournalRepository.post() used to read the entry (findById) and then update
 * it — two sequential round trips on EVERY invoice/expense/payroll save. It
 * now enforces the same draft→posted immutability rule with a single
 * conditional UPDATE (.eq('id').eq('status','draft')), dropping to the
 * read-based path only when the conditional update matches nothing (rare
 * conflict/missing-row path) so the error semantics are preserved.
 */

const draftEntry = { id: 'je-1', status: 'draft' } as unknown as Row<'journal_entries'>;

function makeClient(overrides: {
  updateResult?: { data: Row<'journal_entries'> | null; error: unknown };
  findByIdResult?: { data: Row<'journal_entries'> | null; error: unknown };
} = {}) {
  const conditionalUpdate = vi.fn().mockResolvedValue(
    overrides.updateResult ?? { data: { ...draftEntry, status: 'posted' }, error: null },
  );
  const selectAfterEq = vi.fn(() => ({ maybeSingle: conditionalUpdate }));
  const secondEq = vi.fn(() => ({ select: selectAfterEq }));
  const firstEq = vi.fn(() => ({ eq: secondEq, select: selectAfterEq }));

  const update = vi.fn(() => ({ eq: firstEq }));

  const maybeSingleFind = vi.fn().mockResolvedValue(
    overrides.findByIdResult ?? { data: draftEntry, error: null },
  );
  const eqFind = vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: maybeSingleFind })), maybeSingle: maybeSingleFind }));
  const selectRoot = vi.fn(() => ({ eq: eqFind }));

  const from = vi.fn(() => ({ update, select: selectRoot }));

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    spies: { from, update, firstEq, secondEq, selectAfterEq, conditionalUpdate, maybeSingleFind },
  };
}

describe('JournalRepository.post fast path', () => {
  it('posts with a single conditional UPDATE round trip (no prior read)', async () => {
    const { client, spies } = makeClient();
    const repo = new JournalRepository(client);

    const result = await repo.post('je-1', 'user-1');

    expect(result.status).toBe('posted');
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.firstEq).toHaveBeenCalledWith('id', 'je-1');
    expect(spies.secondEq).toHaveBeenCalledWith('status', 'draft');
    // The draft-read fallback must NOT run on the happy path.
    expect(spies.maybeSingleFind).not.toHaveBeenCalled();
  });

  it('null posted_by is accepted (system posts)', async () => {
    const { client } = makeClient();
    const repo = new JournalRepository(client);
    await expect(repo.post('je-1', null)).resolves.toBeDefined();
  });

  it('surfaces update errors without a fallback read', async () => {
    const { client, spies } = makeClient({
      updateResult: { data: null, error: { message: 'RLS violation', code: '42501' } },
    });
    const repo = new JournalRepository(client);
    await expect(repo.post('je-1', null)).rejects.toThrow();
    expect(spies.maybeSingleFind).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the conditional update matches nothing and the entry does not exist', async () => {
    const { client } = makeClient({
      updateResult: { data: null, error: null },
      findByIdResult: { data: null, error: null },
    });
    const repo = new JournalRepository(client);
    await expect(repo.post('missing', null)).rejects.toThrow(/was not found/i);
  });

  it('throws the immutability error when the entry is not in draft', async () => {
    const { client } = makeClient({
      updateResult: { data: null, error: null },
      findByIdResult: { data: { id: 'je-1', status: 'posted' } as unknown as Row<'journal_entries'>, error: null },
    });
    const repo = new JournalRepository(client);
    await expect(repo.post('je-1', null)).rejects.toThrow(/Only 'draft' entries may be posted/);
  });
});
