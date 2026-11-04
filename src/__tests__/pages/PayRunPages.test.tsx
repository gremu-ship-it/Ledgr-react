// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PayRunListPage } from '@/pages/payroll/PayRunListPage';
import { PayRunNewPage } from '@/pages/payroll/PayRunNewPage';
import { PayRunDetailPage } from '@/pages/payroll/PayRunDetailPage';

const mocks = vi.hoisted(() => ({
  getPayRuns: vi.fn(),
  getPayRun: vi.fn(),
  getPayRunByPeriod: vi.fn(),
  calculatePayRun: vi.fn(),
  approvePayRun: vi.fn(),
  postPayRun: vi.fn(),
  reversePayRun: vi.fn(),
  findByIdWithLines: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    payrollFullCycle: {
      getPayRuns: mocks.getPayRuns,
      getPayRun: mocks.getPayRun,
      getPayRunByPeriod: mocks.getPayRunByPeriod,
      calculatePayRun: mocks.calculatePayRun,
      approvePayRun: mocks.approvePayRun,
      postPayRun: mocks.postPayRun,
      reversePayRun: mocks.reversePayRun,
    },
    journal: { findByIdWithLines: mocks.findByIdWithLines },
  },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1', base_currency: 'MWK', name: 'Test Business' }, role: 'owner' },
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
const run = {
  id: 'run-1',
  business_id: 'business-1',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  pay_date: '2026-10-30',
  status: 'calculated',
  employee_count: 1,
  total_gross: 500000,
  total_deductions: 50000,
  total_net: 450000,
  total_employer_cost: 520000,
  lines: [{
    id: 'line-1', employee_id: 'employee-1', gross_pay: 500000, taxable_pay: 500000,
    total_deductions: 50000, net_pay: 450000, paye_amount: 40000, days_worked: 22,
    status: 'included', employee: { first_name: 'Janet', last_name: 'Banda', employee_number: 'EMP-01' },
    components: [{ id: 'component-1', amount: 500000, is_earning: true, pay_component: { name: 'Basic salary' } }],
  }],
};

function renderWithRoute(element: ReactNode, initialEntry = '/payroll/pay-runs') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/payroll/pay-runs" element={element} />
          <Route path="/payroll/pay-runs/new" element={element} />
          <Route path="/payroll/pay-runs/:id" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getPayRuns.mockReset().mockResolvedValue({ rows: [], count: 0, page: 1, pageSize: 25 });
  mocks.getPayRun.mockReset().mockResolvedValue(run);
  mocks.getPayRunByPeriod.mockReset().mockResolvedValue(null);
  mocks.calculatePayRun.mockReset().mockResolvedValue({ payRunId: 'run-1' });
  mocks.approvePayRun.mockReset().mockResolvedValue({ ...run, status: 'approved' });
  mocks.postPayRun.mockReset().mockResolvedValue({ journalEntryId: 'journal-1' });
  mocks.reversePayRun.mockReset();
  mocks.findByIdWithLines.mockReset().mockResolvedValue({ entry: { entry_number: 'JE-001' }, lines: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pay-run pages', () => {
  it('loads a paginated run list, applies a status filter, and shows row summaries', async () => {
    mocks.getPayRuns.mockResolvedValue({
      rows: [{ ...run, status: 'posted' }], count: 1, page: 1, pageSize: 25,
    });
    renderWithRoute(<PayRunListPage />);

    expect(await screen.findByText('payroll.payRuns')).toBeTruthy();
    expect(await screen.findByText('payroll.totalGross')).toBeTruthy();
    expect((await screen.findAllByText(/MWK/)).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'posted' } });
    await waitFor(() => expect(mocks.getPayRuns).toHaveBeenCalledWith('business-1', expect.objectContaining({ status: 'posted', page: 1 })));
  });

  it('calculates, reviews, approves, and posts a pay run through the three wizard steps', async () => {
    mocks.getPayRun.mockImplementation(async (_businessId: string, id: string) => ({
      ...run,
      id,
      status: mocks.postPayRun.mock.calls.length ? 'posted' : 'calculated',
      journal_entry_id: 'journal-1',
    }));
    renderWithRoute(<PayRunNewPage />, '/payroll/pay-runs/new');

    fireEvent.click(screen.getByRole('button', { name: /payroll.calculatePayRun/ }));
    expect(await screen.findByText('payroll.reviewPayRun')).toBeTruthy();
    expect(await screen.findByText('Janet Banda')).toBeTruthy();
    expect(mocks.calculatePayRun).toHaveBeenCalledWith(
      'business-1', expect.any(String), expect.any(String), expect.any(String),
    );

    fireEvent.click(screen.getByRole('button', { name: /payroll.confirmAndApprove/ }));
    expect(await screen.findByText('payroll.confirmPosting')).toBeTruthy();
    expect(mocks.approvePayRun).toHaveBeenCalledWith('business-1', 'run-1');

    fireEvent.click(screen.getByRole('button', { name: 'payroll.postPayRun' }));
    expect(await screen.findByText(/payroll.postSuccessWithJournal/)).toBeTruthy();
    expect(mocks.postPayRun).toHaveBeenCalledWith('run-1');
    expect(mocks.findByIdWithLines).toHaveBeenCalledWith('journal-1');
    fireEvent.click(await screen.findByRole('button', { name: 'payroll.viewJournalEntry' }));
    expect(await screen.findByText('payroll.journalEntryDetails')).toBeTruthy();
  });

  it('warns before recalculating an existing draft or calculated period', async () => {
    mocks.getPayRunByPeriod.mockResolvedValue({ id: 'old-run', status: 'calculated' });
    renderWithRoute(<PayRunNewPage />, '/payroll/pay-runs/new');

    fireEvent.click(screen.getByRole('button', { name: /payroll.calculatePayRun/ }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(mocks.calculatePayRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'payroll.recalculatePayRun' }));
    await waitFor(() => expect(mocks.calculatePayRun).toHaveBeenCalledTimes(1));
  });

  it('prints posted payslips and surfaces the support message when the reversal RPC is unavailable', async () => {
    mocks.getPayRun.mockResolvedValue({ ...run, status: 'posted', journal_entry_id: 'journal-1' });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    Object.defineProperty(window, 'print', { configurable: true, value: print });
    mocks.reversePayRun.mockRejectedValue(Object.assign(new Error('Could not find the function reverse_pay_run'), { code: 'PGRST202' }));
    renderWithRoute(<PayRunDetailPage />, '/payroll/pay-runs/run-1');

    fireEvent.click(await screen.findByRole('button', { name: 'payroll.printPayslips' }));
    expect(print).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'payroll.reversePayRun' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'payroll.confirmReverse' }));
    expect(await screen.findByText('payroll.reverseNotAvailable')).toBeTruthy();
    expect(mocks.reversePayRun).toHaveBeenCalledWith('run-1');
  });
});
