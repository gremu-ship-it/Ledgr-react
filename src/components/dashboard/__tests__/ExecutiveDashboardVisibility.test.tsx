// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import { ExecutiveHealthStrip } from '../ExecutiveHealthStrip';
import { ActionableExceptions } from '../ActionableExceptions';

const mocks = vi.hoisted(() => ({
  cash: vi.fn(async () => 0),
  expenses: vi.fn(async () => []),
  payroll: vi.fn(async () => null),
  outstanding: vi.fn(() => ({ data: undefined, isLoading: false, isPending: false, isError: false })),
}));

vi.mock('@/dal/repositories/FinancialStatementRepository', () => ({
  FinancialStatementRepository: class {
    getBankCashPosition = mocks.cash;
  },
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    expense: { findOutstanding: mocks.expenses },
    payroll: { findNextApproved: mocks.payroll },
    inventory: { findDashboardStockBalances: vi.fn(async () => []) },
    construction: { findOpenItems: vi.fn(async () => ({ open_holds: [] })) },
    changeOrder: { listSubmittedForApproval: vi.fn(async () => []) },
    projects: { getCostBreakdownByProject: vi.fn(async () => []) },
    manufacturing: { listWorkOrderStockouts: vi.fn(async () => []) },
  },
}));

vi.mock('@/hooks/useDashboardData', () => ({
  useOutstandingInvoices: () => mocks.outstanding(),
}));

function renderWithProviders(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  mocks.cash.mockReset().mockResolvedValue(0);
  mocks.expenses.mockReset().mockResolvedValue([]);
  mocks.payroll.mockReset().mockResolvedValue(null);
  mocks.outstanding.mockReset().mockReturnValue({ data: undefined, isLoading: false, isPending: false, isError: false });
  useAppStore.setState({ currentBusiness: null });
});

describe('executive dashboard visibility', () => {
  it('shows all four health cards and the exceptions state without a selected business', () => {
    const { unmount } = renderWithProviders(
      <>
        <ExecutiveHealthStrip />
        <ActionableExceptions construction={false} manufacturing={false} inventoryEnabled={false} />
      </>,
    );

    const strip = screen.getByTestId('executive-health-strip');
    expect(within(strip).getByText('Live Summary')).toBeTruthy();
    expect(within(strip).getAllByRole('link')).toHaveLength(4);
    expect(within(strip).getByRole('link', { name: 'Open Next payroll commitment' }).getAttribute('href'))
      .toBe('/payroll/employees');
    expect(within(strip).getAllByText(/0\.00/)).toHaveLength(4);
    expect(screen.getByTestId('actionable-exceptions')).toBeTruthy();
    expect(screen.getByText('Select a business to check for actionable exceptions.')).toBeTruthy();
    unmount();
  });

  it('falls back to zero values if health queries fail', async () => {
    useAppStore.setState({
      currentBusiness: { business: { id: 'business-1', base_currency: 'MWK' } } as never,
    });
    mocks.cash.mockRejectedValue(new Error('cash unavailable'));
    mocks.expenses.mockRejectedValue(new Error('payables unavailable'));
    mocks.payroll.mockRejectedValue(new Error('payroll unavailable'));
    mocks.outstanding.mockReturnValue({ data: undefined, isLoading: false, isPending: false, isError: true });

    renderWithProviders(<ExecutiveHealthStrip />);

    const strip = screen.getByTestId('executive-health-strip');
    await waitFor(() => expect(within(strip).getAllByText(/0\.00/)).toHaveLength(4));
    expect(within(strip).queryByText('Unavailable')).toBeNull();
  });

  it('renders four separate metric skeletons while health queries are pending', () => {
    useAppStore.setState({
      currentBusiness: { business: { id: 'business-1', base_currency: 'MWK' } } as never,
    });
    mocks.outstanding.mockReturnValue({ data: undefined, isLoading: true, isPending: true, isError: false });

    renderWithProviders(<ExecutiveHealthStrip />);

    const skeletonGrid = screen.getByLabelText('Loading…');
    expect(skeletonGrid.children).toHaveLength(4);
    expect([...skeletonGrid.children].every((card) => card.className.includes('h-20') && card.className.includes('w-full'))).toBe(true);
  });
});
