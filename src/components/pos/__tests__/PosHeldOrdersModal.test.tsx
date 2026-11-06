// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import type { PosHeldOrder } from '@/types/pos';
import { PosHeldOrdersModal } from '../PosHeldOrdersModal';

afterEach(cleanup);

const heldOrder: PosHeldOrder = {
  id: 'held-1', business_id: 'biz-1', branch_id: 'branch-1', shift_id: 'shift-1',
  cashier_id: 'user-1', cashier_name: 'Tadala', customer_id: 'customer-1',
  customer_snapshot: { id: 'customer-1', name: 'Chisomo Banda' },
  reference_note: 'Collect after lunch',
  cart_items: [{ product_id: 'product-1', productId: 'product-1', name: 'Maize flour', quantity: 2, unit_price: 1500, line_total: 3000 }],
  subtotal: 3000, discount_amount: 0, total_amount: 3000, order_discount: null, cart_notes: 'Keep aside',
  status: 'held', resumed_at: null, resumed_by: null, expired_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

describe('held POS order history', () => {
  it('shows the persisted customer, cart reference and total, and blocks resume over a non-empty cart', () => {
    render(
      <PosHeldOrdersModal
        open
        orders={[heldOrder]}
        isLoading={false}
        canViewHistory
        currentCartIsEmpty={false}
        onClose={() => {}}
        onLoadOrders={vi.fn().mockResolvedValue(undefined)}
        onResume={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText('Collect after lunch')).toBeTruthy();
    expect(screen.getByText(/Chisomo Banda/)).toBeTruthy();
    expect(screen.getByText('MK 3,000.00')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Resume cart' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads Growth history on demand and resumes an active order', () => {
    const onLoadOrders = vi.fn().mockResolvedValue(undefined);
    const onResume = vi.fn().mockResolvedValue(undefined);
    render(
      <PosHeldOrdersModal
        open
        orders={[heldOrder]}
        isLoading={false}
        canViewHistory
        currentCartIsEmpty
        onClose={() => {}}
        onLoadOrders={onLoadOrders}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    expect(onLoadOrders).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Resume cart' }));
    expect(onResume).toHaveBeenCalledWith(heldOrder);
  });
});
