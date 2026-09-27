// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PosStockStatusBanner } from '../PosStockStatusBanner';

afterEach(cleanup);

describe('PosStockStatusBanner — owner decision 2026-09-26 (branch stock only)', () => {
  it('warns that a shop without its own location cannot sell stock items (no warehouse fallback)', () => {
    render(<PosStockStatusBanner status={{ state: 'ok', locationName: null, isFallback: false, noLocation: true, branchLocationMissing: true }} onRetry={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/no stock location/i);
    expect(screen.getByRole('alert').textContent).toMatch(/never take stock from the warehouse/i);
  });
  it('shows nothing when the branch has its own location', () => {
    const { container } = render(<PosStockStatusBanner status={{ state: 'ok', locationName: 'Shop A1', isFallback: false, noLocation: false, branchLocationMissing: false }} onRetry={() => {}} />);
    expect(container.textContent).toBe('');
  });
});
