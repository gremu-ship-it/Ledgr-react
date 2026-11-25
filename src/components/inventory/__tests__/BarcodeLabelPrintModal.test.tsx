// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { BarcodeLabelPrintModal } from '../BarcodeLabelPrintModal';

afterEach(cleanup);

const product = {
  id: 'p1',
  name: 'Maize flour 2kg',
  sku: 'MF-2',
  barcode: '1234567890123',
  unit_price: 2500,
  stock_quantity: 5,
};

describe('BarcodeLabelPrintModal', () => {
  it('defaults the label count to stock and renders one sticker per requested label', () => {
    const onClose = vi.fn();
    render(
      <BarcodeLabelPrintModal
        open
        onClose={onClose}
        products={[product]}
        businessName="LEDGR Retail"
      />,
    );

    const input = screen.getByLabelText('Number of labels to print') as HTMLInputElement;
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('step')).toBe('1');
    expect(input.value).toBe('5');
    expect(document.querySelectorAll('#ledgr-barcode-sheet .label-card')).toHaveLength(5);

    fireEvent.change(input, { target: { value: '3' } });
    expect(document.querySelectorAll('#ledgr-barcode-sheet .label-card')).toHaveLength(3);
    expect(screen.getAllByText(/Preview \(3 labels\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SKU: MF-2/)).toHaveLength(3);
    expect(screen.getAllByText(/MK 2,500\.00/)).toHaveLength(3);
    expect(screen.getAllByText('LEDGR Retail')).toHaveLength(3);
  });

  it('never drops below one label when the requested count is cleared', () => {
    render(<BarcodeLabelPrintModal open onClose={vi.fn()} products={[product]} />);
    const input = screen.getByLabelText('Number of labels to print');

    fireEvent.change(input, { target: { value: '0' } });
    expect(document.querySelectorAll('#ledgr-barcode-sheet .label-card')).toHaveLength(1);
  });
});
