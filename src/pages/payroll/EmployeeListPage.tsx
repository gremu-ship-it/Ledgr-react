import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { formatDate, formatMoney, employeeDisplayName, text } from './employeeUtils';

const PAGE_SIZE = 25;
type StatusFilter = '' | 'active' | 'on_leave' | 'terminated' | 'suspended';

const statusStyles: Record<Exclude<StatusFilter, ''>, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  on_leave: 'bg-amber-50 text-amber-700',
  terminated: 'bg-gray-100 text-gray-700',
  suspended: 'bg-red-50 text-red-700',
};

export function EmployeeListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);

  const employeesQuery = useQuery({
    queryKey: ['payroll-employees', businessId, { search, status, page, pageSize: PAGE_SIZE }],
    enabled: Boolean(businessId),
    queryFn: () => repos.payrollFullCycle.getEmployees(businessId, {
      search,
      status: status || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  });

  const rows = Array.isArray(employeesQuery.data?.rows) ? employeesQuery.data.rows : [];
  const totalPages = Math.max(1, Math.ceil((employeesQuery.data?.count ?? 0) / PAGE_SIZE));
  const openEmployee = (id: unknown) => navigate(`/payroll/employees/${encodeURIComponent(String(id))}`);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('payroll.employees')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('payroll.employeeDirectoryDescription')}</p>
        </div>
        <Button onClick={() => navigate('/payroll/employees/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('payroll.addEmployee')}
        </Button>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-label={t('payroll.employeeDirectoryFilters')}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('payroll.searchEmployees')}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder={t('payroll.searchEmployees')}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span className="shrink-0">{t('payroll.status')}</span>
            <select
              value={status}
              onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}
              className="h-10 min-w-40 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">{t('payroll.allStatuses')}</option>
              <option value="active">{t('payroll.statusActive')}</option>
              <option value="on_leave">{t('payroll.statusOnLeave')}</option>
              <option value="terminated">{t('payroll.statusTerminated')}</option>
              <option value="suspended">{t('payroll.statusSuspended')}</option>
            </select>
          </label>
        </div>
      </section>

      {employeesQuery.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.employeeLoadFailed')}</p>
      )}

      {employeesQuery.isPending ? <TableSkeleton rows={6} /> : rows.length === 0 ? (
        <EmptyState
          title={search || status ? t('payroll.noEmployeesMatch') : t('payroll.noEmployeesYet')}
          description={search || status ? t('payroll.adjustEmployeeFilters') : t('payroll.noEmployeesDescription')}
          actionLabel={!search && !status ? t('payroll.addEmployee') : undefined}
          onAction={!search && !status ? () => navigate('/payroll/employees/new') : undefined}
          variant={search || status ? 'search' : 'finance'}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('payroll.employee')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.department')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.jobTitle')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.hireDate')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.grossSalary')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((employee) => {
                  const employeeId = String(employee.id ?? '');
                  const employeeStatus = text(employee.status, 'active') as Exclude<StatusFilter, ''>;
                  const statusStyle = statusStyles[employeeStatus] ?? statusStyles.active;
                  return (
                    <tr
                      key={employeeId}
                      onClick={() => employeeId && openEmployee(employeeId)}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && employeeId) {
                          event.preventDefault();
                          openEmployee(employeeId);
                        }
                      }}
                      tabIndex={0}
                      className="cursor-pointer outline-none hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                      aria-label={t('payroll.openEmployee', { name: employeeDisplayName(employee) })}
                    >
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span className="block font-medium text-gray-900">{employeeDisplayName(employee) || text(employee.employee_number, '—')}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">{text(employee.employee_number, '—')}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{text(employee.department, '—')}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{text(employee.job_title, '—')}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{formatDate(employee.hire_date ?? employee.start_date, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-gray-900">{formatMoney(employee.gross_salary, currency, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle}`}>
                          {t(`payroll.status${employeeStatus === 'on_leave' ? 'OnLeave' : employeeStatus.charAt(0).toUpperCase() + employeeStatus.slice(1)}`)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
            <span>{t('payroll.employeeCount', { count: employeesQuery.data?.count ?? 0 })}</span>
            <div className="flex items-center gap-3">
              <span>{t('payroll.pageOf', { page, total: totalPages })}</span>
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label={t('payroll.previousPage')}>
                {t('payroll.previous')}
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} aria-label={t('payroll.nextPage')}>
                {t('payroll.next')}
              </Button>
            </div>
          </footer>
        </section>
      )}
    </main>
  );
}
