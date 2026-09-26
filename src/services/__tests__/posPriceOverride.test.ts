/**
 * Owner decision 2026-09-26 — client plumbing for supervisor-only price /
 * discount overrides. The SERVER is the authority (tests/release OD.PRICE.*);
 * these tests pin that tokens reach post_pos_sale and nowhere else.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() }, realSupabase: { rpc: vi.fn() } }));

import { applyItemPriceOverride, buildPosSaleQueuePayload } from '../posService';
import { buildPosSaleRpcPayload } from '../posSaleRpc';
import { isPosSupervisorRole } from '../posPriceOverrideRpc';
import type { PosCartItem } from '@/types/pos';

const item = (over: Partial<PosCartItem> = {}): PosCartItem => ({
  product_id: 'p-1', productId: 'p-1', name: 'Sugar 1kg', quantity: 2,
  unit_price: 1500, unitPrice: 1500, line_total: 3000, lineTotal: 3000, ...over,
} as PosCartItem);

const sale = (items: PosCartItem[], discountOverrideToken?: string) => ({
  businessId: 'biz-1', branchId: 'br-1', shiftId: 'sh-1', cashierId: 'u-1', cashierName: 'Cashier',
  customerId: null, customerName: 'Walk-in Customer', items,
  payments: [{ payment_method: 'cash' as const, amount: 5000, tendered: 5000 }], totalPaid: 5000, changeGiven: 0,
  discountOverrideToken,
});

describe('applyItemPriceOverride', () => {
  it('reprices the line, keeps its discount and records the token', () => {
    const [line] = applyItemPriceOverride([item({ discount: { type: 'percent', value: 10 } })], 'p-1', 1400, 'tok-1');
    expect(line.unit_price).toBe(1400);
    expect(line.line_total).toBe(2520);  // 2 × 1400 − 10 %
    expect(line.priceOverrideToken).toBe('tok-1');
  });
  it('supervisor path carries no token', () => {
    expect(applyItemPriceOverride([item()], 'p-1', 1400)[0].priceOverrideToken).toBeNull();
  });
  it('leaves other lines untouched', () => {
    const other = item({ product_id: 'p-2', productId: 'p-2' });
    expect(applyItemPriceOverride([item(), other], 'p-1', 1400)[1]).toBe(other);
  });
});

describe('override tokens reach post_pos_sale only', () => {
  const items = applyItemPriceOverride([item()], 'p-1', 1400, 'tok-price');
  const queue = buildPosSaleQueuePayload(sale(items, 'tok-disc'), { receiptNumber: 'R-1', clientKey: 'k-1' });

  it('the queue payload keeps tokens outside invoice/lines (the legacy insert path stays column-clean)', () => {
    expect(queue.overrides).toEqual({ discountToken: 'tok-disc', lineTokens: ['tok-price'] });
    expect(queue.invoice).not.toHaveProperty('discount_override_token');
    expect(queue.lines[0]).not.toHaveProperty('price_override_token');
    expect(queue.lines[0].unit_price).toBe(1400);
  });
  it('the RPC payload carries them where the server reads them', () => {
    const rpc = buildPosSaleRpcPayload(queue, 'biz-1', 'k-1') as { invoice: Record<string, unknown>; lines: Record<string, unknown>[] };
    expect(rpc.invoice.discount_override_token).toBe('tok-disc');
    expect(rpc.lines[0].price_override_token).toBe('tok-price');
  });
  it('a sale with no overrides sends no token keys', () => {
    const plain = buildPosSaleQueuePayload(sale([item()]), { receiptNumber: 'R-2', clientKey: 'k-2' });
    const rpc = buildPosSaleRpcPayload(plain, 'biz-1', 'k-2') as { invoice: Record<string, unknown>; lines: Record<string, unknown>[] };
    expect(rpc.invoice).not.toHaveProperty('discount_override_token');
    expect(rpc.lines[0]).not.toHaveProperty('price_override_token');
  });
});

describe('isPosSupervisorRole (display only; mirrors _ledgr_is_pos_supervisor)', () => {
  it.each([['owner', true], ['admin', true], ['manager', true], ['sales_manager', true], ['branch_manager', true],
    ['cashier', false], ['sales_clerk', false], ['accountant', false], [null, false]] as const)('%s → %s', (role, expected) => {
    expect(isPosSupervisorRole(role)).toBe(expected);
  });
});
