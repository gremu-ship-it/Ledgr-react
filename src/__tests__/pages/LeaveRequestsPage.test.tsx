// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LeaveRequestsPage } from '@/pages/payroll/LeaveRequestsPage';

const mocks = vi.hoisted(() => ({
  getLeaveRequests: vi.fn(),
  getEmployees: vi.fn(),
  getLeaveTypes: vi.fn(),
  submitLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    payrollFullCycle: {
      getLeaveRequests: mocks.getLeaveRequests,
      getEmployees: mocks.getEmployees,
      getLeaveTypes: mocks.getLeaveTypes,
      submitLeaveRequest: mocks.submitLeaveRequest,
      approveLeaveRequest: mocks.approveLeaveRequest,
    },
  },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1', base_currency: 'MWK' }, role: 'owner' },
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

const pendingRequest = {
  id: 'request-1', employee_id: 'employee-1', leave_type_id: 'type-1',
  start_date: '2026-11-02', end_date: '2026-11-06', total_days: 5, status: 'pending', reason: 'Family event',
  employee: { id: 'employee-1', first_name: 'Janet', last_name: 'Banda', employee_number: 'EMP-0001' },
  leave_type: { id: 'type-1', code: 'ANNUAL', name: 'Annual leave' },
};

function renderPage(initialEntry = '/payroll/leave') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes><Route path="/payroll/leave" element={<LeaveRequestsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getLeaveRequests.mockReset().mockResolvedValue({ rows: [], count: 0, page: 1, pageSize: 20 });
  mocks.getEmployees.mockReset().mockResolvedValue({ rows: [{ id: 'employee-1', first_name: 'Janet', last_name: 'Banda', employee_number: 'EMP-0001' }], count: 1, page: 1, pageSize: 100 });
  mocks.getLeaveTypes.mockReset().mockResolvedValue([{ id: 'type-1', code: 'ANNUAL', name: 'Annual leave' }]);
  mocks.submitLeaveRequest.mockReset().mockResolvedValue({ requestId: 'request-2', status: 'pending' });
  mocks.approveLeaveRequest.mockReset().mockResolvedValue({ requestId: 'request-1', status: 'approved' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LeaveRequestsPage', () => {
  it('shows requests, filters by status, and approves or rejects pending rows', async () => {
    mocks.getLeaveRequests.mockResolvedValue({
      rows: [pendingRequest, { ...pendingRequest, id: 'request-2', employee_id: 'employee-2', employee: { first_name: 'Peter', last_name: 'Phiri' } }],
      count: 2, page: 1, pageSize: 20,
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'payroll.leaveRequests' })).toBeTruthy();
    const janetRow = (await screen.findByText('Janet Banda')).closest('tr');
    expect(janetRow).toBeTruthy();
    fireEvent.click(within(janetRow as HTMLElement).getByRole('button', { name: /payroll.approve/ }));
    await waitFor(() => expect(mocks.approveLeaveRequest).toHaveBeenCalledWith('request-1', true));

    const peterRow = (await screen.findByText('Peter Phiri')).closest('tr');
    fireEvent.click(within(peterRow as HTMLElement).getByRole('button', { name: /payroll.reject/ }));
    await waitFor(() => expect(mocks.approveLeaveRequest).toHaveBeenCalledWith('request-2', false));

    fireEvent.click(screen.getByRole('tab', { name: 'payroll.pending' }));
    await waitFor(() => expect(mocks.getLeaveRequests).toHaveBeenCalledWith('business-1', expect.objectContaining({ status: 'pending', page: 1 })));
  });

  it('calculates weekdays and submits a leave request from the new-request dialog', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /payroll.newRequest/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Janet Banda' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Annual leave' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('payroll.selectEmployee'), { target: { value: 'employee-1' } });
    fireEvent.change(screen.getByLabelText('payroll.selectLeaveType'), { target: { value: 'type-1' } });
    fireEvent.change(screen.getByLabelText('payroll.startDate'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('payroll.endDate'), { target: { value: '2026-11-06' } });
    fireEvent.change(screen.getByLabelText('payroll.reason'), { target: { value: 'Family event' } });
    expect(screen.getByText('5 payroll.businessDays')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'payroll.submitRequest' }));
    await waitFor(() => expect(mocks.submitLeaveRequest).toHaveBeenCalledWith('business-1', {
      employeeId: 'employee-1', leaveTypeId: 'type-1', startDate: '2026-11-02', endDate: '2026-11-06',
      totalDays: 5, reason: 'Family event',
    }));
    expect(await screen.findByText('payroll.leaveSubmitted')).toBeTruthy();
  });

  it('provides pagination for request results and an empty state', async () => {
    mocks.getLeaveRequests.mockResolvedValueOnce({ rows: [pendingRequest], count: 21, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ rows: [pendingRequest], count: 21, page: 2, pageSize: 20 });
    renderPage();
    expect(await screen.findByText('Janet Banda')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'payroll.next' }));
    await waitFor(() => expect(mocks.getLeaveRequests).toHaveBeenCalledWith('business-1', expect.objectContaining({ page: 2 })));

    mocks.getLeaveRequests.mockResolvedValue({ rows: [], count: 0, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByRole('tab', { name: 'payroll.rejected' }));
    expect(await screen.findByText('payroll.noLeaveRequestsMatch')).toBeTruthy();
  });
});
