// HARDENING 2026-09-26 — non-POS sale stock + COGS is ONE server command.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordSaleStockAndCogs, recordMovements } = vi.hoisted(() => ({ recordSaleStockAndCogs: vi.fn(), recordMovements: vi.fn() }));
vi.mock('@/lib/repositories', () => ({
  repos: { inventory: { recordSaleStockAndCogs, recordMovements, findLocations: vi.fn(), findBalance: vi.fn() } },
}));

import { deductStockAndPostCogs } from '@/services/inventoryJournalService';

const invoice = { id: 'inv-1', invoice_number: 'INV-0001', issue_date: '2026-09-26' };

describe('deductStockAndPostCogs (atomic server command)', () => {
  beforeEach(() => { recordSaleStockAndCogs.mockReset(); recordMovements.mockReset(); });

  it('makes exactly one server call and never writes movements from the client', async () => {
    recordSaleStockAndCogs.mockResolvedValue({ idempotent: false, cogs_entry_id: 'je-1', cost_lines: [{ product_id: 'p1', quantity: 2, unit_cost: 900 }] });
    const r = await deductStockAndPostCogs('biz', invoice, [{ productId: 'p1', quantity: 2 }, { productId: '', quantity: 1 }, { productId: 'p2', quantity: 0 }], null, null, null);
    expect(recordSaleStockAndCogs).toHaveBeenCalledTimes(1);
    expect(recordSaleStockAndCogs).toHaveBeenCalledWith('inv-1', [{ productId: 'p1', quantity: 2 }]);
    expect(recordMovements).not.toHaveBeenCalled();
    expect(r).toEqual({ costLines: [{ productId: 'p1', quantity: 2, unitCost: 900 }], cogsEntryId: 'je-1' });
  });

  it('does not call the server when there is nothing to release', async () => {
    const r = await deductStockAndPostCogs('biz', invoice, [], null, null, null);
    expect(recordSaleStockAndCogs).not.toHaveBeenCalled();
    expect(r).toEqual({ costLines: [], cogsEntryId: null });
  });

  it('THROWS when the server rejects (e.g. COGS failed) — failure is never swallowed', async () => {
    recordSaleStockAndCogs.mockRejectedValue(new Error('COGS posting failed for invoice INV-0001'));
    await expect(deductStockAndPostCogs('biz', invoice, [{ productId: 'p1', quantity: 1 }], null, null, null))
      .rejects.toThrow(/Stock and cost of sale failed for invoice INV-0001: COGS posting failed/);
  });

  it('returns the committed result on replay (idempotent)', async () => {
    recordSaleStockAndCogs.mockResolvedValue({ idempotent: true, cogs_entry_id: 'je-1', cogs_missing: false, cost_lines: [] });
    const r = await deductStockAndPostCogs('biz', invoice, [{ productId: 'p1', quantity: 1 }], null, null, null);
    expect(r.cogsEntryId).toBe('je-1');
  });
});
