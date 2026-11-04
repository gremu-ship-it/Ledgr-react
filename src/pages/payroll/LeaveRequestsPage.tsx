import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import type { LeaveRequestStatus } from '@/lib/repositories/payroll.repository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { asRow, employeeDisplayName, formatDate, text } from './employeeUtils';
import { countBusinessDays } from './leaveUtils';

const PAGE_SIZE = 20;
type StatusFilter = '' | LeaveRequestStatus;
type LeaveStatus = LeaveRequestStatus;
type Feedback = { kind: 'success' | 'error'; key: string } | null;

const STATUS_KEYS: Record<LeaveStatus, string> = {
  pending: 'payroll.pending',
  approved: 'payroll.approved',
  rejected: 'payroll.rejected',
  cancelled: 'payroll.cancelled',
};

const STATUS_STYLES: Record<LeaveStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  rejected: 'bg-red-50 text-red-800 ring-red-200',
  cancelled: 'bg-gray-100 text-gray-700 ring-gray-200',
};

function statusKey(status: string): string {
  return status in STATUS_KEYS ? STATUS_KEYS[status as LeaveStatus] : 'payroll.pending';
}

function leaveErrorKey(error: unknown): string {
  const detail = error && typeof error === 'object' ? error as { message?: unknown } : {};
  const message = error instanceof Error ? error.message : String(detail.message ?? error ?? '');
  if (/insufficient leave balance/i.test(message)) return 'payroll.insufficientBalance';
  if (/End date must be on or after start date|Total days must be positive/i.test(message)) return 'payroll.invalidLeaveDates';
  return 'payroll.leaveRequestFailed';
}

export function LeaveRequestsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [status, setStatus] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const requestsQuery = useQuery({
    queryKey: ['payroll-leave-requests', businessId, { status, page, pageSize: PAGE_SIZE }],
    enabled: Boolean(businessId),
    queryFn: () => repos.payrollFullCycle.getLeaveRequests(businessId, {
      status: status || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  });
  const employeesQuery = useQuery({
    queryKey: ['payroll-leave-request-employees', businessId],
    enabled: Boolean(businessId && dialogOpen),
    queryFn: () => repos.payrollFullCycle.getEmployees(businessId, { status: 'active', page: 1, pageSize: 100 }),
  });
  const leaveTypesQuery = useQuery({
    queryKey: ['payroll-leave-types', businessId],
    enabled: Boolean(businessId && dialogOpen),
    queryFn: () => repos.payrollFullCycle.getLeaveTypes(businessId),
  });

  const resetForm = () => {
    setEmployeeId('');
    setLeaveTypeId('');
    setStartDate('');
    setEndDate('');
    setReason('');
    setFeedback(null);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    resetForm();
    submitMutation.reset();
  };

  const submitMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.submitLeaveRequest(businessId, {
      employeeId,
      leaveTypeId,
      startDate,
      endDate,
      totalDays: countBusinessDays(startDate, endDate),
      reason,
    }),
    onSuccess: async () => {
      setDialogOpen(false);
      resetForm();
      setFeedback({ kind: 'success', key: 'payroll.leaveSubmitted' });
      await queryClient.invalidateQueries({ queryKey: ['payroll-leave-requests', businessId] });
    },
    onError: (error) => setFeedback({ kind: 'error', key: leaveErrorKey(error) }),
  });

  const decisionMutation = useMutation({
    mutationFn: ({ requestId, approved }: { requestId: string; approved: boolean }) =>
      repos.payrollFullCycle.approveLeaveRequest(requestId, approved),
    onSuccess: async (_result, variables) => {
      setFeedback({ kind: 'success', key: variables.approved ? 'payroll.leaveApproved' : 'payroll.leaveRejected' });
      await queryClient.invalidateQueries({ queryKey: ['payroll-leave-requests', businessId] });
    },
    onError: (error) => setFeedback({ kind: 'error', key: leaveErrorKey(error) }),
  });

  const rows = requestsQuery.data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((requestsQuery.data?.count ?? 0) / PAGE_SIZE));
  const businessDays = countBusinessDays(startDate, endDate);

  const openDialog = () => {
    resetForm();
    submitMutation.reset();
    setDialogOpen(true);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    submitMutation.mutate();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('payroll.leaveRequests')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('payroll.leaveRequestsDescription')}</p>
        </div>
        <Button onClick={openDialog}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('payroll.newRequest')}
        </Button>
      </header>

      {feedback && !dialogOpen && (
        <p role={feedback.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${feedback.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {t(feedback.key)}
        </p>
      )}

      <div role="tablist" aria-label={t('payroll.leaveRequestFilters')} className="flex flex-wrap gap-2 border-b border-gray-200">
        {([
          ['', 'payroll.allRequests'],
          ['pending', 'payroll.pending'],
          ['approved', 'payroll.approved'],
          ['rejected', 'payroll.rejected'],
          ['cancelled', 'payroll.cancelled'],
        ] as [StatusFilter, string][]).map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => { setStatus(value); setPage(1); setFeedback(null); }}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${status === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >{t(label)}</button>
        ))}
      </div>

      {requestsQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.leaveRequestsLoadFailed')}</p>}

      {requestsQuery.isPending ? <TableSkeleton rows={6} /> : rows.length === 0 ? (
        <EmptyState
          title={status ? t('payroll.noLeaveRequestsMatch') : t('payroll.noLeaveRequests')}
          description={status ? t('payroll.noLeaveRequestsMatchDescription') : t('payroll.noLeaveRequestsDescription')}
          actionLabel={!status ? t('payroll.newRequest') : undefined}
          onAction={!status ? openDialog : undefined}
          variant={status ? 'search' : 'finance'}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('payroll.employee')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.leaveType')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.startDate')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.endDate')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.totalDays')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.status')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((request, index) => {
                  const employee = asRow(request.employee);
                  const leaveType = asRow(request.leave_type);
                  const requestStatus = text(request.status, 'pending');
                  const requestId = text(request.id, `leave-request-${index}`);
                  return (
                    <tr key={requestId}>
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-gray-900">
                        {employeeDisplayName(employee) || text(employee.employee_number, t('payroll.employee'))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800">{text(leaveType.name, text(leaveType.code, t('payroll.leaveType')))}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{formatDate(request.start_date, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{formatDate(request.end_date, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-gray-700">{text(request.total_days, '0')}</td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[requestStatus as LeaveStatus] ?? STATUS_STYLES.pending}`}>{t(statusKey(requestStatus))}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">
                        {requestStatus === 'pending' ? (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => { setFeedback(null); decisionMutation.mutate({ requestId: text(request.id), approved: true }); }} isLoading={decisionMutation.isPending}>
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />{t('payroll.approve')}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { setFeedback(null); decisionMutation.mutate({ requestId: text(request.id), approved: false }); }} disabled={decisionMutation.isPending}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" />{t('payroll.reject')}
                            </Button>
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-600">{t('payroll.pageOf', { page, total: totalPages })}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t('payroll.previous')}</Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t('payroll.next')}</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="leave-request-title" className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
            <header className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="leave-request-title" className="text-lg font-semibold text-gray-900">{t('payroll.newRequest')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('payroll.newLeaveRequestDescription')}</p>
              </div>
              <Button variant="secondary" size="icon" aria-label={t('payroll.close')} onClick={closeDialog}><X className="h-4 w-4" aria-hidden="true" /></Button>
            </header>

            {feedback?.kind === 'error' && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t(feedback.key)}</p>}
            {employeesQuery.isError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.leaveEmployeesLoadFailed')}</p>}
            {leaveTypesQuery.isError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.leaveTypesLoadFailed')}</p>}

            <form onSubmit={submit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-gray-700">{t('payroll.selectEmployee')}</span>
                <select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} disabled={employeesQuery.isPending} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                  <option value="">{employeesQuery.isPending ? t('payroll.loadingEmployees') : t('payroll.selectEmployee')}</option>
                  {(employeesQuery.data?.rows ?? []).map((employee) => (
                    <option key={text(employee.id)} value={text(employee.id)}>{employeeDisplayName(employee) || text(employee.employee_number, t('payroll.employee'))}</option>
                  ))}
                </select>
                {!employeesQuery.isPending && (employeesQuery.data?.rows.length ?? 0) === 0 && <span className="block text-xs text-gray-500">{t('payroll.noActiveEmployees')}</span>}
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-gray-700">{t('payroll.selectLeaveType')}</span>
                <select required value={leaveTypeId} onChange={(event) => setLeaveTypeId(event.target.value)} disabled={leaveTypesQuery.isPending} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                  <option value="">{leaveTypesQuery.isPending ? t('payroll.loadingLeaveTypes') : t('payroll.selectLeaveType')}</option>
                  {(leaveTypesQuery.data ?? []).map((leaveType) => (
                    <option key={text(leaveType.id)} value={text(leaveType.id)}>{text(leaveType.name, text(leaveType.code))}</option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-gray-700">{t('payroll.startDate')}</span>
                  <input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-gray-700">{t('payroll.endDate')}</span>
                  <input required type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                </label>
              </div>

              <div className="flex items-center gap-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-900" aria-live="polite">
                <CalendarDays className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span><strong>{t('payroll.totalDays')}:</strong> {businessDays} {t('payroll.businessDays')}</span>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-gray-700">{t('payroll.reason')}</span>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
              </label>

              <footer className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                <Button type="button" variant="secondary" onClick={closeDialog}>{t('payroll.cancel')}</Button>
                <Button type="submit" isLoading={submitMutation.isPending} disabled={!employeeId || !leaveTypeId || !startDate || !endDate || businessDays <= 0 || employeesQuery.isError || leaveTypesQuery.isError}>
                  {t('payroll.submitRequest')}
                </Button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
