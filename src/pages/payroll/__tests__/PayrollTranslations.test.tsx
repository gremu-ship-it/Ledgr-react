// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { i18n } from '@/i18n';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { EmployeeListPage } from '../EmployeeListPage';

const business = {
  role: 'owner',
  business: { id: 'business-1', name: 'Test Business', base_currency: 'MWK' },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><EmployeeListPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.setState({ currentBusiness: business as never });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('payroll English translations', () => {
  it('renders employee directory headings, controls, and table headers in English', async () => {
    vi.spyOn(repos.payrollFullCycle, 'getEmployees').mockResolvedValue({
      rows: [{
        id: 'employee-1',
        first_name: 'Aisha',
        last_name: 'Banda',
        employee_number: 'EMP-001',
        status: 'active',
        gross_salary: 180000,
        department: 'Finance',
        job_title: 'Clerk',
        hire_date: '2024-01-03',
      }],
      count: 1,
      page: 1,
      pageSize: 25,
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeTruthy();
    expect(await screen.findByText('Aisha Banda')).toBeTruthy();
    expect(screen.getByText('Manage employee records, job details, and salary configurations.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Employee' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Search employees...')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Employee directory filters' })).toBeTruthy();
    expect(screen.getByText('1 employee')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual([
      'Employee', 'Department', 'Job Title', 'Hire Date', 'Gross Salary', 'Status',
    ]);
    expect(screen.getByRole('combobox').textContent).toContain('All Statuses');
  });

  it('resolves the payroll navigation label and legacy uppercase fallbacks', () => {
    expect(i18n.t('payroll.employees')).toBe('Employees');
    expect(i18n.t('payroll.payRuns')).toBe('Pay Runs');
    expect(i18n.t('PAYROLL.TITLE')).toBe('Payroll');
    expect(i18n.t('PAYROLL.EMPLOYEE')).toBe('Employee');
    expect(i18n.t('PAYROLL.DEPARTMENT')).toBe('Department');
    expect(i18n.t('PAYROLL.JOBTITLE')).toBe('Job Title');
    expect(i18n.t('PAYROLL.HIREDATE')).toBe('Hire Date');
    expect(i18n.t('PAYROLL.GROSSSALARY')).toBe('Gross Salary');
  });
});
