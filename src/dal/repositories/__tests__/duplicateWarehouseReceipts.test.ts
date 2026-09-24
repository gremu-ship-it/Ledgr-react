import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InventoryRepository } from '../InventoryRepository';
import type { Database } from '../../types/database';

/**
 * Regression cover for duplicate Receive Stock detection
 * (findDuplicateWarehouseReceiptCandidates).
 *
 * The anomaly being repaired: a stock receipt posted twice. Detection is
 * deliberately conservative — a false positive would reverse genuine stock —
 * so these tests pin BOTH sides of the line:
 *
 *   flags:   same receipt identity replayed (any time apart), identical
 *            unkeyed receipts within the window, mixed unkeyed/keyed pairs
 *   ignores: identical receipts far apart, distinct client_keys, multi-line
 *            inserts sharing one timestamp, rows differing in notes/reference
 */

type MovementRow = Record<string, unknown>;

function movement(overrides: MovementRow = {}): MovementRow {
  return {
    id: 'mv-1',
    product_id: 'prod-1',
    location_id: 'loc-1',
    movement_date: '2026-07-01',
    quantity: 10,
    unit_cost: 500,
    notes: null,
    created_by: 'user-1',
    created_at: '2026-07-01T08:00:00.000Z',
    source_type: null,
    source_id: null,
    reference: null,
    client_key: null,
    ...overrides,
  };
}

/** Client whose only table serves both the scan (paged via .range) and the
 *  already-repaired lookup (awaited directly). */
function repoWith(rows: MovementRow[], repairedIds: string[] = []) {
  const from = vi.fn((table: string) => {
    if (table !== 'stock_movements') throw new Error(`unexpected table ${table}`);
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      range: async () => ({ data: rows, error: null }),
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
        resolve({ data: repairedIds.map((id) => ({ source_id: id })), error: null }),
    };
    return chain;
  });
  const client = { from } as unknown as SupabaseClient<Database>;
  return new InventoryRepository(client);
}

describe('findDuplicateWarehouseReceiptCandidates', () => {
  it('flags a legacy unkeyed receipt resubmitted within the window', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1' }),
      movement({ id: 'mv-2', created_at: '2026-07-01T08:01:30.000Z' }),
    ]);

    const candidates = await repo.findDuplicateWarehouseReceiptCandidates('biz-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      duplicateMovementId: 'mv-2',
      keptMovementId: 'mv-1',
      quantity: 10,
      unitCost: 500,
      value: 5000,
    });
  });

  it('leaves identical legacy receipts far apart alone (a legitimate repeat receive)', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1' }),
      movement({ id: 'mv-2', created_at: '2026-07-01T09:30:00.000Z' }),
    ]);

    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });

  it('never pairs rows that carry distinct client_keys (two separate keyed receipts)', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1', client_key: 'key-1' }),
      movement({ id: 'mv-2', client_key: 'key-2', created_at: '2026-07-01T08:01:00.000Z' }),
    ]);

    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });

  it('flags the same receipt identity replayed hours later (window does not apply)', async () => {
    const repo = repoWith([
      movement({
        id: 'mv-1',
        source_type: 'stock_receipt',
        source_id: 'rcpt-1',
        reference: 'GRN-ABCD1234',
      }),
      movement({
        id: 'mv-2',
        created_at: '2026-07-01T14:00:00.000Z',
        source_type: 'stock_receipt',
        source_id: 'rcpt-1',
        reference: 'GRN-ABCD1234',
      }),
    ]);

    const candidates = await repo.findDuplicateWarehouseReceiptCandidates('biz-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      duplicateMovementId: 'mv-2',
      keptMovementId: 'mv-1',
    });
  });

  it('never pairs rows with identical created_at (multi-line insert on one receipt)', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1', source_type: 'stock_receipt', source_id: 'rcpt-1', client_key: 'key-0' }),
      movement({ id: 'mv-2', source_type: 'stock_receipt', source_id: 'rcpt-1', client_key: 'key-1' }),
    ]);

    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });

  it('flags a mixed unkeyed/keyed identical pair inside the window', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1' }),
      movement({ id: 'mv-2', created_at: '2026-07-01T08:01:00.000Z', client_key: 'key-9' }),
    ]);

    const candidates = await repo.findDuplicateWarehouseReceiptCandidates('biz-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].duplicateMovementId).toBe('mv-2');
  });

  it('keeps receipts with different notes or references in separate groups', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1', notes: 'first delivery' }),
      movement({ id: 'mv-2', created_at: '2026-07-01T08:01:00.000Z', notes: 'second delivery' }),
      movement({ id: 'mv-3', created_at: '2026-07-01T08:02:00.000Z', reference: 'GRN-ONE' }),
    ]);

    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });

  it('does not pair backfilled purchases from two different expenses', async () => {
    const repo = repoWith([
      movement({ id: 'mv-1', source_type: 'expense', source_id: 'exp-1', created_by: 'backfill' }),
      movement({ id: 'mv-2', source_type: 'expense', source_id: 'exp-2', created_at: '2026-07-01T08:01:00.000Z' }),
    ]);

    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });

  it('skips duplicates already neutralised by a repair movement', async () => {
    const repo = repoWith(
      [
        movement({ id: 'mv-1' }),
        movement({ id: 'mv-2', created_at: '2026-07-01T08:01:30.000Z' }),
      ],
      ['mv-2'],
    );

    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });

  it('reports nothing when the business has no purchase movements', async () => {
    const repo = repoWith([]);
    await expect(repo.findDuplicateWarehouseReceiptCandidates('biz-1')).resolves.toEqual([]);
  });
});
