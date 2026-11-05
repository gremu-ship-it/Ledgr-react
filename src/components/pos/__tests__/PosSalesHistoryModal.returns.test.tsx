// @vitest-environment jsdom
import '@/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PosSalesHistoryModal } from '../PosSalesHistoryModal';
import type { PosSale } from '@/types/pos';

afterEach(cleanup);

const sale: PosSale = {
  id: 'invoice-1',
  receipt_number: 'REC-001',
  invoice_number: 'INV-001',
  created_at: '2026-11-05T10:00:00Z',
  customer_name: 'A. Customer',
  total_amount: 2000,
  net_amount: 2000,
  status: 'completed',
  items: [{
    id: 'invoice-line-1',
    product_id: 'product-1',
    product_name: 'Tea',
    name: 'Tea',
    quantity: 2,
    returnable_quantity: 2,
    unit_price: 1000,
    line_total: 2000,
  }],
};

describe('POS return register', () => {
  it('submits receipt-line quantity, reason, and restock choice through the return callback', async () => {
    const onProcessReturn = vi.fn().mockResolvedValue({
      returnId: 'return-1', returnNumber: 'RET-20261105-000001', amount: 1000.01, refundMethod: 'cash',
      lines: [{ invoiceLineId: 'invoice-line-1', quantity: 1, refundAmount: 1000.01, reason: 'Damaged packaging', restock: false }],
    });
    const { container } = render(
      <PosSalesHistoryModal
        open
        onClose={() => {}}
        sales={[sale]}
        currentShiftId="shift-1"
        onSearchSales={() => {}}
        onProcessReturn={onProcessReturn}
      />,
    );

    fireEvent.click(screen.getByText('REC-001'));
    const quantity = document.querySelector('input[type="number"]');
    if (!quantity) throw new Error('Return quantity input was not rendered.');
    fireEvent.change(quantity, { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Reason for returning this item'), { target: { value: 'Damaged packaging' } });
    fireEvent.click(screen.getByLabelText('Restock item'));
    fireEvent.click(screen.getByRole('button', { name: 'Process return' }));

    await waitFor(() => expect(onProcessReturn).toHaveBeenCalledWith(
      'invoice-1',
      [{
        invoice_line_id: 'invoice-line-1', product_id: 'product-1', product_name: 'Tea',
        quantity: 1, unit_price: 1000, refund_amount: 1000, reason: 'Damaged packaging', restock: false,
      }],
      'cash',
      '',
      undefined,
    ));
    expect(await screen.findByRole('button', { name: 'Print return receipt or voucher' })).toBeTruthy();
    expect(container.textContent).toContain('RET-20261105-000001');
    expect(container.textContent).toContain('000.01');
  });

  it('exposes store credit only when Growth+ access is supplied', () => {
    const { rerender, container } = render(
      <PosSalesHistoryModal open onClose={() => {}} sales={[sale]} currentShiftId="shift-1" onSearchSales={() => {}} />,
    );
    fireEvent.click(screen.getByText('REC-001'));
    expect(container.querySelector('option[value="credit"]')).toBeNull();
    rerender(
      <PosSalesHistoryModal open onClose={() => {}} sales={[sale]} currentShiftId="shift-1" canUseStoreCredit canSearchHistorical onSearchSales={() => {}} />,
    );
    expect(container.querySelector('option[value="credit"]')?.textContent).toBe('Store credit');
  });
});
