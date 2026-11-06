// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const queryMock = vi.hoisted(() => ({ usePosOwnerAnalytics: vi.fn() }));
vi.mock('@/hooks/usePosOwnerAnalytics', () => queryMock);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => {
  if (key === 'pos.analytics.orderCount') return `${String(options?.count)} orders`;
  if (key === 'pos.analytics.returnCount') return `${String(options?.count)} returns`;
  return key;
} }) }));

import { PosOwnerAnalytics } from '../PosOwnerAnalytics';

const baseReport = {
  order_count: 2,
  gross_sales: 120000,
  net_sales: 100000,
  average_ticket: 50000,
  discount_total: 20000,
  return_count: 1,
  refunds_total: 5000,
  payment_breakdown: { cash: { count: 2, total: 75000 }, airtel_money: { count: 1, total: 25000 } },
};

afterEach(() => {
  cleanup();
  queryMock.usePosOwnerAnalytics.mockReset();
});

describe('PosOwnerAnalytics server query states', () => {
  it('shows loading placeholders while the aggregate query is in flight', () => {
    queryMock.usePosOwnerAnalytics.mockReturnValue({ isLoading: true });
    render(<PosOwnerAnalytics businessId="biz-1" currentBranchId="branch-1" />);
    expect(screen.getByLabelText('pos.analytics.loading')).toBeTruthy();
  });

  it('shows an error and a retry action when the aggregate query fails', () => {
    const refetch = vi.fn();
    queryMock.usePosOwnerAnalytics.mockReturnValue({ isLoading: false, isError: true, isFetching: false, refetch });
    render(<PosOwnerAnalytics businessId="biz-1" />);
    expect(screen.getByRole('alert').textContent).toContain('pos.analytics.loadError');
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes a successful zero-sales response with an explicit empty state', () => {
    queryMock.usePosOwnerAnalytics.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { ...baseReport, order_count: 0 },
    });
    render(<PosOwnerAnalytics businessId="biz-1" />);
    expect(screen.getByRole('status').textContent).toBe('pos.analytics.empty');
  });

  it('renders server totals and payment breakdown, independent of any sales history prop', () => {
    queryMock.usePosOwnerAnalytics.mockReturnValue({ isLoading: false, isError: false, data: baseReport });
    render(
      <PosOwnerAnalytics
        businessId="biz-1"
        currentBranchId="branch-1"
        branches={[{ id: 'branch-1', name: 'Main' }]}
      />,
    );

    expect(screen.getByText('2 orders')).toBeTruthy();
    expect(screen.getByText('1 returns')).toBeTruthy();
    expect(screen.getByText('pos.analytics.paymentBreakdown')).toBeTruthy();
    expect(screen.getByText('pos.paymentMethods.cash')).toBeTruthy();
    expect(queryMock.usePosOwnerAnalytics).toHaveBeenCalledWith('biz-1', 'branch-1', 'today');
  });
});
