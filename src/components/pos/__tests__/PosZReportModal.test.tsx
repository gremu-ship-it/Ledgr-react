// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosZReportModal } from '../PosZReportModal';
import type { PosShift } from '@/types/pos';

const reportMock = vi.hoisted(() => ({ getShiftReport: vi.fn() }));
vi.mock('@/lib/repositories', () => ({ repos: { pos: reportMock } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => {
  if (key === 'pos.zReport.reportNumber') return `Report #: ${String(options?.number ?? '')}`;
  if (key === 'pos.zReport.refunds') return `${String(options?.count ?? '')} returns`;
  if (key.startsWith('pos.paymentMethods.')) return key.split('.').at(-1);
  if (key.startsWith('pos.zReport.varianceStatus.')) return key.split('.').at(-1);
  if (key.startsWith('pos.zReport.movementTypes.')) return key.split('.').at(-1);
  return key;
} }) }));

const shift = {
  id: 'shift-1',
  business_id: 'biz-001',
  branch_id: 'branch-001',
  cashier_id: 'user-1',
  cashier_name: 'Shift cashier',
  opening_cash: 50000,
  expected_cash: 58000,
  actual_cash: 58000,
  cash_variance: 0,
  total_sales_amount: 15000,
  cash_sales_amount: 15000,
  other_sales_amount: 0,
  refunds_amount: 7000,
  cash_in_amount: 0,
  cash_out_amount: 0,
  status: 'closed',
  opened_at: '2026-09-19T08:00:00Z',
  closed_at: '2026-09-19T17:00:00Z',
} as unknown as PosShift;

const serverReport = {
  shift_id: 'shift-1',
  business_id: 'biz-001',
  cashier_name: 'Server cashier',
  opened_at: '2026-09-19T08:00:00Z',
  closed_at: '2026-09-19T17:00:00Z',
  gross_sales: 180000,
  discount_total: 10000,
  net_sales: 170000,
  tax_total: 25500,
  tax_breakdown: { '16.5% VAT': { amount: 25500, count: 3 } },
  sales_count: 3,
  return_count: 1,
  refunds_gross_total: 2000,
  cash_tenders: 120000,
  tender_breakdown: { cash: 120000, airtel_money: 50000 },
  tender_counts: { cash: { count: 2, total: 120000 }, airtel_money: { count: 1, total: 50000 } },
  cash_in_total: 5000,
  cash_out_total: 1000,
  expected_cash: 58000,
  actual_cash: 58000,
  variance: 0,
  cash_movements: [{ movement_type: 'cash_in', amount: 5000, reason: 'Float top-up', created_at: '2026-09-19T10:00:00Z' }],
  close: { report_number: 'Z-2026-42', closed_at: '2026-09-19T17:00:00Z', expected_cash: 58000, actual_cash: 58000, variance: 0 },
};

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosZReportModal open onClose={() => {}} shift={shift} businessName="Shop" branchName="Main" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  reportMock.getShiftReport.mockReset();
});

describe('PosZReportModal server-authoritative shift reporting', () => {
  it('fetches the requested shift report and renders its server values, not local shift counters', async () => {
    reportMock.getShiftReport.mockResolvedValue(serverReport);
    renderModal();

    expect(await screen.findByText(/170,000/)).toBeTruthy();
    expect(screen.getByText('Report #: Z-2026-42')).toBeTruthy();
    expect(screen.getByText('Server cashier')).toBeTruthy();
    expect(screen.getAllByText(/25,500/)).toHaveLength(2);
    expect(screen.getByText('1 returns')).toBeTruthy();
    expect(screen.getByText(/Float top-up/)).toBeTruthy();
    expect(reportMock.getShiftReport).toHaveBeenCalledExactlyOnceWith('shift-1');
    expect(screen.queryByText(/15,000/)).toBeNull();
  });

  it('shows a loading skeleton until the scoped report arrives', async () => {
    let resolveReport!: (value: typeof serverReport) => void;
    reportMock.getShiftReport.mockReturnValue(new Promise((resolve) => { resolveReport = resolve; }));
    renderModal();

    expect(screen.getByLabelText('pos.zReport.loading')).toBeTruthy();
    resolveReport(serverReport);
    expect(await screen.findByText('Server cashier')).toBeTruthy();
  });

  it('shows an explicit error and retries the same shift report', async () => {
    reportMock.getShiftReport.mockRejectedValueOnce(new Error('RPC unavailable')).mockResolvedValueOnce(serverReport);
    renderModal();

    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(reportMock.getShiftReport).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Server cashier')).toBeTruthy();
  });

  it('does not render a report payload belonging to a different shift', async () => {
    reportMock.getShiftReport.mockResolvedValue({ ...serverReport, shift_id: 'other-shift' });
    renderModal();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('MWK 170,000.00')).toBeNull();
  });
});
