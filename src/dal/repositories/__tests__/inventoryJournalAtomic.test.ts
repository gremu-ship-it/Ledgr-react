// POST-CONTAINMENT HARDENING H-3 (2026-09-26): stock receipts and manual
// adjustments are ONE server command; the pages no longer sequence a
// movement write and a best-effort journal post from the browser.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InventoryRepository } from '@/dal/repositories/InventoryRepository';

const makeRepo = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(result);
  const repo = new InventoryRepository({ rpc, from: vi.fn() } as never);
  return { repo, rpc };
};
const input = {
  businessId: 'biz', kind: 'adjustment' as const, clientKey: '00000000-0000-4000-8000-000000000001', locationId: 'loc',
  movementDate: '2026-09-26', movementType: 'adjustment_out' as const, reference: 'ADJ-1', notes: null,
  lines: [{ productId: 'p1', quantity: -3, unitCost: 900 }],
};

describe('InventoryRepository.recordInventoryJournalMovement', () => {
  it('makes exactly one RPC with a positive quantity (direction from movement_type) and the stable client key', async () => {
    const { repo, rpc } = makeRepo({ data: { idempotent: false, movement_ids: ['m1'], journal_entry_id: 'je1' }, error: null });
    const r = await repo.recordInventoryJournalMovement(input);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_inventory_journal_movement', { p_payload: {
      business_id: 'biz', kind: 'adjustment', client_key: input.clientKey, location_id: 'loc', movement_date: '2026-09-26',
      movement_type: 'adjustment_out', reference: 'ADJ-1', notes: null, lines: [{ product_id: 'p1', quantity: 3, unit_cost: 900 }],
    } });
    expect(r.journal_entry_id).toBe('je1');
  });

  it('throws when the server rejects (journal or stock failure is never swallowed)', async () => {
    const { repo } = makeRepo({ data: null, error: { code: 'P0001', message: 'Account 2114 not found' } });
    await expect(repo.recordInventoryJournalMovement(input)).rejects.toThrow();
  });

  it('throws when the server returns no result', async () => {
    const { repo } = makeRepo({ data: null, error: null });
    await expect(repo.recordInventoryJournalMovement(input)).rejects.toThrow(/not confirmed/);
  });
});

describe('pages use the atomic command (source contract)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('WarehousePage receipt: one atomic call; no client movement write + separate GRNI post', () => {
    const s = src('src/pages/WarehousePage.tsx');
    const receive = s.slice(s.indexOf('const receiveMutation'), s.indexOf('onSuccess', s.indexOf('const receiveMutation')));
    expect(receive).toMatch(/recordInventoryJournalMovement\(\{[\s\S]*kind: 'receipt'[\s\S]*clientKey: receiptKey/);
    expect(receive).not.toMatch(/recordMovements\(|postWarehouseReceipt\(/);
  });
  it('ProductsPage adjustment: one atomic call; no client movement write + separate adjustment post', () => {
    const s = src('src/pages/ProductsPage.tsx');
    expect(s).toMatch(/recordInventoryJournalMovement\(\{[\s\S]*kind: 'adjustment'[\s\S]*clientKey: movementKey\.current/);
    expect(s).not.toMatch(/postStockMovementAdjustment\(|repos\.inventory\.recordMovement\(/);
  });
});
