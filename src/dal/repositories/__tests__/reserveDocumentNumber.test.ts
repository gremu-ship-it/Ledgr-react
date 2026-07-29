import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessRepository } from '../BusinessRepository';
import type { Database } from '../../types/database';

/**
 * Regression cover for:
 *   "businesses with id "…" was not found."  on Quick Expense Entry
 *
 * Recording a transaction reserves a document number first. That used to be
 * read-then-write:
 *     findById()                       -- SELECT, allowed for any member
 *     update({ expense_next_number })  -- UPDATE, restricted to owner/admin
 * Under RLS a forbidden UPDATE matches zero rows rather than raising, and
 * BaseRepository.update() turns "zero rows" into NotFoundError — naming a
 * business that exists and is perfectly readable.
 *
 * The reservation now goes through a SECURITY DEFINER RPC, so a writer can
 * advance a counter without holding UPDATE on the whole businesses row.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260728000011_reserve_document_number_rpc.sql',
);

function repoWithRpc(impl: () => { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockImplementation(async () => impl());
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { repo: new BusinessRepository(client), rpc };
}

describe('document number reservation', () => {
  it('calls the RPC instead of updating the businesses row', async () => {
    const { repo, rpc } = repoWithRpc(() => ({ data: 'EXP-0007', error: null }));

    await expect(repo.reserveNextExpenseNumber('biz-1')).resolves.toBe('EXP-0007');

    expect(rpc).toHaveBeenCalledWith('reserve_next_document_number', {
      p_business_id: 'biz-1',
      p_kind: 'expense',
    });
  });

  it('passes the right kind for each document type', async () => {
    for (const [method, kind] of [
      ['reserveNextInvoiceNumber', 'invoice'],
      ['reserveNextExpenseNumber', 'expense'],
      ['reserveNextPayrollNumber', 'payroll'],
    ] as const) {
      const { repo, rpc } = repoWithRpc(() => ({ data: 'X-0001', error: null }));
      await repo[method]('biz-1');
      expect(rpc).toHaveBeenCalledWith(
        'reserve_next_document_number',
        expect.objectContaining({ p_kind: kind }),
      );
    }
  });

  it('surfaces a permission denial as UnauthorizedError, not "not found"', async () => {
    // 42501 is what the RPC raises when the caller lacks write permission.
    // The old code path reported this as NotFoundError against businesses,
    // which sent everyone looking for a missing row.
    const { repo } = repoWithRpc(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }));

    await expect(repo.reserveNextExpenseNumber('biz-1')).rejects.toMatchObject({
      name: 'UnauthorizedError',
    });
  });

  it('still reports a genuinely absent business as not found', async () => {
    const { repo } = repoWithRpc(() => ({
      data: null,
      error: { code: 'P0002', message: 'Business does not exist or has been deleted.' },
    }));

    await expect(repo.reserveNextExpenseNumber('biz-1')).rejects.toThrow();
  });
});

describe('reserve_next_document_number migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('is SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
  });

  it('gates payroll separately from general writes', () => {
    expect(sql).toContain('public.can_write_payroll(p_business_id)');
    expect(sql).toContain('public.can_write_business_data(p_business_id)');
  });

  it('increments atomically rather than reading then writing', () => {
    // UPDATE ... RETURNING in one statement; concurrent callers serialise on
    // the row lock and cannot receive the same number.
    expect(sql).toMatch(/set\s+expense_next_number\s*=\s*expense_next_number\s*\+\s*1/i);
    expect(sql).toMatch(/returning\s+expense_next_number\s*-\s*1/i);
  });

  it('returns the pre-increment value, matching the previous numbering', () => {
    // Old code returned the current value then bumped the column. The RPC
    // bumps first and returns (new - 1), which is the same number.
    for (const kind of ['invoice', 'expense', 'payroll']) {
      expect(sql).toMatch(new RegExp(`returning\\s+${kind}_next_number\\s*-\\s*1`, 'i'));
    }
  });

  it('skips soft-deleted businesses', () => {
    expect(sql).toMatch(/where id = p_business_id\s*\n\s*and deleted_at is null/i);
  });

  it('is not executable by anon', () => {
    expect(sql).toMatch(/revoke all on function public\.reserve_next_document_number/i);
    expect(sql).toMatch(/grant execute on function public\.reserve_next_document_number\(uuid, text\) to authenticated, service_role/i);
  });
});
