// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PosProductCatalog } from '../PosProductCatalog';
import { PosStockStatusBanner } from '../PosStockStatusBanner';
import type { PosProduct } from '@/types/pos';

/**
 * IC 2026-09-25 P4 — a failed stock read must never be displayed as zero.
 * Unknown stock is shown as "Stock ?" and stays sellable (R06 still rejects a
 * real shortfall server-side); a KNOWN zero is still "Out" and blocked.
 */
afterEach(cleanup);

const base = { unit_price: 100, unitPrice: 100, selling_price: 100, category: 'General' };
const unknown = { ...base, id: 'p-unknown', name: 'Unknown Item', track_inventory: true, stock_unknown: true } as PosProduct;
const knownZero = { ...base, id: 'p-zero', name: 'Zero Item', track_inventory: true, stock_quantity: 0, stockQuantity: 0 } as PosProduct;
const inStock = { ...base, id: 'p-ok', name: 'Stocked Item', track_inventory: true, stock_quantity: 7, stockQuantity: 7 } as PosProduct;

describe('POS catalog stock display (IC P4)', () => {
  it('shows unknown stock as "Stock ?" — not "Out" — and keeps it sellable', () => {
    const onAdd = vi.fn();
    render(<PosProductCatalog products={[unknown, knownZero, inStock]} onAddToCart={onAdd} />);
    const unknownBtn = screen.getByText('Unknown Item').closest('button')!;
    expect(unknownBtn.textContent).toContain('Stock ?');
    expect(unknownBtn.textContent).not.toContain('Out');
    expect((unknownBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(unknownBtn);
    expect(onAdd).toHaveBeenCalledWith(unknown);
  });

  it('a KNOWN zero is still "Out" and blocked (no overselling from the UI)', () => {
    render(<PosProductCatalog products={[knownZero]} onAddToCart={vi.fn()} />);
    const btn = screen.getByText('Zero Item').closest('button')!;
    expect(btn.textContent).toContain('Out');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('known stock shows the server quantity', () => {
    render(<PosProductCatalog products={[inStock]} onAddToCart={vi.fn()} />);
    expect(screen.getByText('Stocked Item').closest('button')!.textContent).toContain('7 left');
  });
});

describe('POS stock status banner (IC P4)', () => {
  it('a read failure renders an alert with Retry', () => {
    const onRetry = vi.fn();
    render(<PosStockStatusBanner status={{ state: 'error', message: 'network down' }} onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/could not be loaded/i);
    expect(alert.textContent).toMatch(/unknown \(not zero\)/i);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a fallback location is named so the cashier knows what is being sold from', () => {
    render(<PosStockStatusBanner status={{ state: 'ok', locationName: 'Main Warehouse', isFallback: true, noLocation: false }} onRetry={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Main Warehouse');
  });

  it('the branch\'s own location renders nothing', () => {
    const { container } = render(<PosStockStatusBanner status={{ state: 'ok', locationName: 'Shop A', isFallback: false, noLocation: false }} onRetry={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
