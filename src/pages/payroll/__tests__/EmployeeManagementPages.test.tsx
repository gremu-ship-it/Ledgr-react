// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { EmployeeListPage } from '@/pages/payroll/EmployeeListPage';
import { EmployeeNewPage } from '@/pages/payroll/EmployeeNewPage';
import { EmployeeDetailPage } from '@/pages/payroll/EmployeeDetailPage';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Test Business', base_currency: 'MWK' },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}</output>;
}

function renderPage(page: React.ReactNode, initialPath = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        {page}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDetailPage(initialPath = '/payroll/employees/employee-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Routes><Route path="/payroll/employees/:id" element={<EmployeeDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useAppStore.setState({ currentBusiness: business });
});

describe('employee management pages', () => {
  it('loads a searchable and status-filtered employee directory', async () => {
    const getEmployees = vi.spyOn(repos.payrollFullCycle, 'getEmployees').mockImplementation(async (_businessId, filters = {}) => {
      const allRows = [
        { id: 'employee-1', first_name: 'Aisha', last_name: 'Banda', employee_number: 'EMP-001', status: 'active', gross_salary: 180000, department: 'Finance', job_title: 'Clerk', hire_date: '2024-01-03' },
        { id: 'employee-2', first_name: 'Peter', last_name: 'Phiri', employee_number: 'EMP-002', status: 'on_leave', gross_salary: 220000, department: 'Sales', job_title: 'Lead', hire_date: '2023-08-11' },
      ];
      const filtered = allRows.filter((row) => (!filters.search || `${row.first_name} ${row.last_name} ${row.employee_number}`.toLowerCase().includes(filters.search.toLowerCase()))
        && (!filters.status || row.status === filters.status));
      return { rows: filtered, count: filtered.length, page: filters.page ?? 1, pageSize: filters.pageSize ?? 25 };
    });

    renderPage(<EmployeeListPage />);
    expect(await screen.findByText('Aisha Banda')).toBeTruthy();
    expect(screen.getByText('Peter Phiri')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('payroll.searchEmployees'), { target: { value: 'EMP-002' } });
    expect(await screen.findByText('Peter Phiri')).toBeTruthy();
    await waitFor(() => expect(getEmployees).toHaveBeenLastCalledWith('business-1', expect.objectContaining({ search: 'EMP-002' })));
    expect(screen.queryByText('Aisha Banda')).toBeNull();

    fireEvent.change(screen.getByLabelText('payroll.status'), { target: { value: 'on_leave' } });
    await waitFor(() => expect(getEmployees).toHaveBeenLastCalledWith('business-1', expect.objectContaining({ status: 'on_leave' })));
  });

  it('validates and saves the new employee form using the repository', async () => {
    const createEmployee = vi.spyOn(repos.payrollFullCycle, 'createEmployee').mockResolvedValue({ id: 'employee-new' });
    renderPage(<EmployeeNewPage />, '/payroll/employees/new');

    fireEvent.change(screen.getByLabelText(/payroll.firstName/), { target: { value: 'Grace' } });
    fireEvent.change(screen.getByLabelText(/payroll.lastName/), { target: { value: 'Moyo' } });
    fireEvent.change(screen.getByLabelText(/payroll.grossSalary/), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: 'payroll.saveEmployee' }));

    await waitFor(() => expect(createEmployee).toHaveBeenCalledWith('business-1', expect.objectContaining({
      first_name: 'Grace', last_name: 'Moyo', gross_salary: 250000, currency: 'MWK', hire_date: expect.any(String),
    })));
    await waitFor(() => expect(screen.getByTestId('current-location').textContent).toBe('/payroll/employees/employee-new'));
  });

  it('shows employee overview, pay-component overrides, leave balances, and accrual action', async () => {
    const getEmployee = vi.spyOn(repos.payrollFullCycle, 'getEmployee').mockResolvedValue({
      id: 'employee-1', first_name: 'Ada', last_name: 'Lovelace', employee_number: 'EMP-001', status: 'active',
      department: 'Engineering', job_title: 'Analyst', hire_date: '2024-03-01', gross_salary: 300000,
      contracts: [], components: [],
    });
    vi.spyOn(repos.payrollFullCycle, 'getPayComponents').mockResolvedValue([
      { id: 'component-1', name: 'Housing allowance', component_type: 'earning', calculation_basis: 'fixed', default_amount: 25000, default_rate: 0 },
    ]);
    vi.spyOn(repos.payrollFullCycle, 'getLeaveBalances').mockResolvedValue([
      { id: 'balance-1', year: new Date().getFullYear(), entitled_days: 18, used_days: 4, leave_type: { name: 'Annual leave' } },
    ]);
    const accrueLeave = vi.spyOn(repos.payrollFullCycle, 'accrueLeave').mockResolvedValue({});

    renderDetailPage();
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(getEmployee).toHaveBeenCalledWith('business-1', 'employee-1');

    fireEvent.click(screen.getByRole('tab', { name: 'payroll.payComponentsTab' }));
    expect(await screen.findByText('Housing allowance')).toBeTruthy();
    expect(screen.getByRole('button', { name: /payroll.addOverride/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'payroll.leaveBalanceTab' }));
    expect(await screen.findByText('Annual leave')).toBeTruthy();
    expect(screen.getByText('14 payroll.days')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /payroll.accrueLeave/ }));
    await waitFor(() => expect(accrueLeave).toHaveBeenCalledWith('business-1', new Date().getFullYear(), new Date().getMonth() + 1));
  });
});
