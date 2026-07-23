import { currentFiscalYear } from '@/lib/fiscalYear';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, AlertCircle, CheckCircle, ChevronRight, ArrowLeft, X, Briefcase, Pencil,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto } from '@/dal/types/database';
import { nextEntryNumber } from '@/services/journalService';
import { EditEmployeeModal } from '@/components/payroll/EditEmployeeModal';

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PayeBand {
  band_from: number;
  band_to: number | null;
  rate: number;
}

function calculatePAYE(annualGross: number, bands: PayeBand[]): number {
  if (bands.length === 0) {
    const fallbackBands: PayeBand[] = [
      { band_from: 0,         band_to: 1_200_000, rate: 0 },
      { band_from: 1_200_000, band_to: 2_400_000, rate: 25 },
      { band_from: 2_400_000, band_to: null,       rate: 35 },
    ];
    bands = fallbackBands;
  }
  let tax = 0;
  for (const band of bands) {
    if (annualGross <= band.band_from) break;
    const upper = band.band_to ?? Infinity;
    const taxable = Math.min(annualGross, upper) - band.band_from;
    if (taxable <= 0) continue;
    tax += taxable * (band.rate/100);
  }
  return tax / 12;
}

/**
 * TPR pension: 10% employer / 5% employee, applied to gross monthly salary.
 * Rates come from tax_configurations (tax_code='tpr_pension'), not hard-coded,
 * so a business can adjust them without a code change if MRA/Pension Act
 * rates ever move. Falls back to 0/0 if no config exists yet (surfaced as a
 * warning in the UI rather than silently using a guessed default, unlike
 * the PAYE fallback bands above — pension has no universally-agreed default
 * the way the MRA bands do).
 */
function calculatePension(
  grossMonthly: number,
  employerRatePercent: number | null | undefined,
  employeeRatePercent: number | null | undefined,
): { employer: number; employee: number } {
  const employerRate = Number(employerRatePercent ?? 0) / 100;
  const employeeRate = Number(employeeRatePercent ?? 0) / 100;
  return {
    employer: Math.round(grossMonthly * employerRate * 100) / 100,
    employee: Math.round(grossMonthly * employeeRate * 100) / 100,
  };
}

type MainTab = 'runs' | 'employees';

interface Alert { type: 'success' | 'error'; message: string; }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-surface text-sub',
    approved: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    paid: 'bg-brand-500/10 text-brand-700 dark:text-brand-300',
    voided: 'bg-surface text-muted',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-surface text-sub'}`}>
      {status}
    </span>
  );
}

function AlertBox({ alert }: { alert: Alert }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${alert.type === 'success' ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'bg-danger/10 text-danger'}`}>
      {alert.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {alert.message}
    </div>
  );
}

function AddEmployeeModal({ businessId, onClose, onSuccess }: { businessId: string; onClose: () => void; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [form, setForm] = useState({
    first_name: '', last_name: '', employee_number: '', job_title: '',
    employment_type: 'permanent', pay_frequency: 'monthly', gross_salary: '',
    payment_method: 'bank_transfer', bank_name: '', bank_account_number: '',
    mobile_money_type: '', mobile_money_number: '', start_date: today(),
    national_id: '', tpin: '',
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.first_name.trim()) throw new Error('First name is required');
      if (!form.last_name.trim()) throw new Error('Last name is required');
      if (!form.employee_number.trim()) throw new Error('Employee number is required');
      const salary = parseFloat(form.gross_salary);
      if (isNaN(salary) || salary <= 0) throw new Error('Enter a valid gross salary');

      const { data, error } = await (repos.payroll as any).client
        .from('employees')
        .insert({
          business_id: businessId,
          first_name: form.first_name, last_name: form.last_name,
          employee_number: form.employee_number, job_title: form.job_title || null,
          employment_type: form.employment_type, pay_frequency: form.pay_frequency,
          gross_salary: salary, currency: 'MWK', payment_method: form.payment_method,
          bank_name: form.bank_name || null, bank_account_number: form.bank_account_number || null,
          mobile_money_type: form.mobile_money_type || null, mobile_money_number: form.mobile_money_number || null,
          start_date: form.start_date, national_id: form.national_id || null,
          tpin: form.tpin || null, tax_exempt: false, is_active: true,
        })
        .select().single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Employee added successfully.' });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setTimeout(() => { onSuccess(); onClose(); }, 1200);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-card p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-ink">Add Employee</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-sub transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">First Name</label>
              <input type="text" value={form.first_name} onChange={(e) => set('first_name', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Last Name</label>
              <input type="text" value={form.last_name} onChange={(e) => set('last_name', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Employee Number</label>
              <input type="text" placeholder="e.g. EMP-001" value={form.employee_number} onChange={(e) => set('employee_number', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Job Title</label>
              <input type="text" placeholder="e.g. Accountant" value={form.job_title} onChange={(e) => set('job_title', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Employment Type</label>
              <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
                <option value="casual">Casual</option>
                <option value="part_time">Part Time</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Gross Monthly Salary (MWK)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={form.gross_salary} onChange={(e) => set('gross_salary', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Start Date</label>
              <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Payment Method</label>
              <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="bank_transfer">Bank Transfer</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>

          {form.payment_method === 'bank_transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Bank Name</label>
                <input type="text" placeholder="e.g. NBS Bank" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Account Number</label>
                <input type="text" value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          {form.payment_method === 'mobile_money' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Provider</label>
                <select value={form.mobile_money_type} onChange={(e) => set('mobile_money_type', e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                  <option value="">Select…</option>
                  <option value="airtel_money">Airtel Money</option>
                  <option value="tnm_mpamba">TNM Mpamba</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Mobile Number</label>
                <input type="text" placeholder="e.g. 0999123456" value={form.mobile_money_number} onChange={(e) => set('mobile_money_number', e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">National ID (optional)</label>
              <input type="text" value={form.national_id} onChange={(e) => set('national_id', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-sub">TPIN (optional)</label>
              <input type="text" value={form.tpin} onChange={(e) => set('tpin', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-sub hover:bg-bg transition-colors">Cancel</button>
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
              {mutation.isPending ? 'Saving…' : 'Add Employee'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunPayrollModal({ businessId, onClose, onSuccess }: { businessId: string; onClose: () => void; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [step, setStep] = useState<'setup' | 'review'>('setup');

  const now = new Date();
  const [form, setForm] = useState({
    payroll_period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    period_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    period_end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    pay_date: today(),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', businessId],
    queryFn: () => repos.payroll.findEmployees(businessId),
    enabled: Boolean(businessId),
  });

  const { data: payeBands = [] } = useQuery({
    queryKey: ['paye_bands', businessId],
    queryFn: () => repos.payroll.findPayeBands(businessId, currentFiscalYear()),
    enabled: Boolean(businessId),
  });

  // TPR pension rates — mirrors the payeBands query above. Note: no
  // as-of-date is passed, so this uses "today" via TaxRepository.findByCode's
  // default — fine for a payroll run being created now, but if you ever
  // backfill a historical run, this won't use the rate that was in effect
  // at that time. Flag if that matters for your use case.
  const { data: tprConfig } = useQuery({
    queryKey: ['tax_configurations', businessId, 'tpr_pension'],
    queryFn: () => repos.tax.findByCode(businessId, 'tpr_pension'),
    enabled: Boolean(businessId),
  });

  const payrollLines = employees.map((emp) => {
    const grossMonthly = Number(emp.gross_salary);
    const annualGross = grossMonthly * 12;
    const monthlyPaye = emp.tax_exempt ? 0 : calculatePAYE(annualGross, payeBands as PayeBand[]);
    const pension = calculatePension(grossMonthly, tprConfig?.employer_rate, tprConfig?.employee_rate);
    const netPay = grossMonthly - monthlyPaye - pension.employee;
    return {
      employee: emp,
      gross_pay: grossMonthly,
      paye_deduction: monthlyPaye,
      pension_employer: pension.employer,
      pension_employee: pension.employee,
      net_pay: netPay,
    };
  });

  const totals = payrollLines.reduce(
    (acc, line) => ({
      gross: acc.gross + line.gross_pay,
      paye: acc.paye + line.paye_deduction,
      pensionEmployer: acc.pensionEmployer + line.pension_employer,
      pensionEmployee: acc.pensionEmployee + line.pension_employee,
      net: acc.net + line.net_pay,
    }),
    { gross: 0, paye: 0, pensionEmployer: 0, pensionEmployee: 0, net: 0 },
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (employees.length === 0) throw new Error('No active employees found');
      const runNumber = await repos.business.reserveNextPayrollNumber(businessId);

      // NOTE: journal posting no longer happens here. Payroll runs are
      // created as 'draft' only; posting the journal entry (and
      // generating PAYE/TPR tax_returns) now happens explicitly via the
      // "Approve Payroll" action, which calls PayrollRepository.approve().
      // This replaces the old auto-post-at-creation flow.
      await repos.payroll.createWithLines(
        {
          business_id: businessId,
          run_number: runNumber,
          payroll_period: form.payroll_period,
          period_start: form.period_start,
          period_end: form.period_end,
          pay_date: form.pay_date,
          status: 'draft',
          total_gross: totals.gross,
          total_paye: totals.paye,
          total_other_deductions: 0,
          total_net: totals.net,
          created_by: null,
        } as InsertDto<'payroll_runs'>,
        payrollLines.map((line) => ({
          business_id: businessId,
          employee_id: line.employee.id,
          basic_salary: line.gross_pay,
          total_allowances: 0,
          gross_pay: line.gross_pay,
          paye_taxable_income: line.gross_pay,
          paye_deduction: line.paye_deduction,
          pension_employee: line.pension_employee,
          pension_employer: line.pension_employer,
          other_deductions: 0,
          total_deductions: line.paye_deduction + line.pension_employee,
          net_pay: line.net_pay,
          payment_method: line.employee.payment_method,
          payslip_generated: false,
        } as Omit<InsertDto<'payroll_employee_lines'>, 'payroll_run_id'>)),
      );
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Payroll run created as a draft. Approve it from the run detail view to post the journal entry.' });
      queryClient.invalidateQueries({ queryKey: ['payroll_runs'] });
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-card p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-ink">Run Payroll</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-sub transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        {step === 'setup' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Payroll Period</label>
                <input type="month" value={form.payroll_period} onChange={(e) => setForm((f) => ({ ...f, payroll_period: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Pay Date</label>
                <input type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Period Start</label>
                <input type="date" value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-sub">Period End</label>
                <input type="date" value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
            <div className="rounded-xl bg-bg px-4 py-3 text-sm text-sub">
              <span className="font-medium text-ink">{employees.length}</span> active employee{employees.length !== 1 ? 's' : ''} will be included.
              {payeBands.length === 0 && <span className="ml-2 text-warning">⚠ No PAYE bands configured — using MRA 2024/25 defaults.</span>}
              {!tprConfig && <span className="ml-2 text-warning">⚠ TPR pension rates not configured — pension will be calculated as MK 0.00.</span>}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-sub hover:bg-bg transition-colors">Cancel</button>
              <button onClick={() => setStep('review')} disabled={employees.length === 0}
                className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
                Review Payroll →
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Employee</th>
                    <th className="px-4 py-2.5 text-right">Gross Pay</th>
                    <th className="px-4 py-2.5 text-right">PAYE</th>
                    <th className="px-4 py-2.5 text-right">Pension (5%)</th>
                    <th className="px-4 py-2.5 text-right">Net Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payrollLines.map((line) => (
                    <tr key={line.employee.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{line.employee.first_name} {line.employee.last_name}</p>
                        <p className="text-xs text-muted">{line.employee.job_title ?? line.employee.employee_number}</p>
                      </td>
                      <td className="px-4 py-3 text-right">{formatMwk(line.gross_pay)}</td>
                      <td className="px-4 py-3 text-right text-danger">−{formatMwk(line.paye_deduction)}</td>
                      <td className="px-4 py-3 text-right text-danger">−{formatMwk(line.pension_employee)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-brand-700 dark:text-brand-300">{formatMwk(line.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line bg-bg">
                  <tr>
                    <td className="px-4 py-3 text-sm font-semibold text-ink">Totals</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold">{formatMwk(totals.gross)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-danger">−{formatMwk(totals.paye)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-danger">−{formatMwk(totals.pensionEmployee)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-brand-700 dark:text-brand-300">{formatMwk(totals.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {totals.pensionEmployer > 0 && (
              <p className="text-xs text-muted">
                Additional employer pension contribution (10%, not deducted from employees):{' '}
                <span className="font-medium text-sub">{formatMwk(totals.pensionEmployer)}</span>
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setStep('setup')} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-sub hover:bg-bg transition-colors">← Back</button>
              <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
                className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
                {mutation.isPending ? 'Creating…' : 'Create Payroll Run'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Approve a draft payroll run: posts the journal entry via
 * PayrollRepository.approve() and moves the run to 'approved'.
 *
 * ASSUMPTION: useAppStore's currentUser shape is { id, email, profile }
 * based on useAuthListener.ts's setCurrentUser call — used here for the
 * approvedBy audit field. If that selector path is wrong, this will need
 * adjusting, but it matches the only place in the codebase that populates
 * a user object into the store.
 */
function ApprovePayrollModal({
  businessId, run, userId, onClose, onSuccess,
}: {
  businessId: string;
  run: Row<'payroll_runs'>;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [alert, setAlert] = useState<Alert | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank_accounts', businessId],
    queryFn: () => repos.account.findBankAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Unable to determine the current user. Please sign in again.');
      if (!bankAccountId) throw new Error('Select a bank account for net pay disbursement.');
      const entryNumber = await nextEntryNumber(businessId);
      await repos.payroll.approve(run.id, userId, entryNumber, bankAccountId);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Payroll approved and posted to the journal.' });
      setTimeout(() => { onSuccess(); onClose(); }, 1200);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-ink">Approve Payroll — {run.run_number}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-sub transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        <p className="mb-4 text-sm text-muted">
          This posts the payroll journal entry (salaries, PAYE, pension) and disburses net pay of{' '}
          <span className="font-semibold text-ink">{formatMwk(Number(run.total_net))}</span> from the selected account.
          PAYE and TPR remittances will be generated automatically. This cannot be undone from here.
        </p>

        <div className="mb-5">
          <label className="mb-1 block text-sm font-medium text-sub">Pay From Account</label>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="">Select an account…</option>
            {bankAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.code} — {acc.name}</option>
            ))}
          </select>
          {bankAccounts.length === 0 && (
            <p className="mt-1 text-xs text-warning">⚠ No bank accounts found. Mark an account as a bank account in Chart of Accounts first.</p>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-sub hover:bg-bg transition-colors">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !bankAccountId}
            className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Approving…' : 'Approve & Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayrollRunsTab({ businessId, onRunPayroll, canApprove }: { businessId: string; onRunPayroll: () => void; canApprove: boolean }) {
  const [selectedRun, setSelectedRun] = useState<Row<'payroll_runs'> | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const queryClient = useQueryClient();
  const currentUser = useAppStore((s) => s.currentUser);

  const { data: runs = [], isLoading, isError } = useQuery({
    queryKey: ['payroll_runs', businessId],
    queryFn: () => repos.payroll.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: runWithLines } = useQuery({
    queryKey: ['payroll_run', 'lines', selectedRun?.id],
    queryFn: () => repos.payroll.findWithLines(selectedRun!.id),
    enabled: Boolean(selectedRun?.id),
  });

  if (selectedRun) {
    return (
      <div>
        <button onClick={() => setSelectedRun(null)} className="mb-5 flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink transition-colors">
          <ArrowLeft className="h-4 w-4" />Back to Payroll Runs
        </button>
        <div className="rounded-2xl border border-line bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">{selectedRun.run_number}</h2>
              <p className="text-sm text-muted">Period: {selectedRun.period_start} → {selectedRun.period_end}</p>
              <p className="text-sm text-muted">Pay Date: {selectedRun.pay_date}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={selectedRun.status} />
              {selectedRun.status === 'draft' && canApprove && (
                <button onClick={() => setShowApproveModal(true)}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                  <CheckCircle className="h-4 w-4" />Approve Payroll
                </button>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left">Employee</th>
                  <th className="px-4 py-2.5 text-right">Gross Pay</th>
                  <th className="px-4 py-2.5 text-right">PAYE</th>
                  <th className="px-4 py-2.5 text-right">Pension (Employee)</th>
                  <th className="px-4 py-2.5 text-right">Other Deductions</th>
                  <th className="px-4 py-2.5 text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(runWithLines?.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 font-medium text-ink">{line.employee_id}</td>
                    <td className="px-4 py-3 text-right">{formatMwk(Number(line.gross_pay))}</td>
                    <td className="px-4 py-3 text-right text-danger">−{formatMwk(Number(line.paye_deduction))}</td>
                    <td className="px-4 py-3 text-right text-danger">−{formatMwk(Number(line.pension_employee))}</td>
                    <td className="px-4 py-3 text-right text-danger">−{formatMwk(Number(line.other_deductions))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-700 dark:text-brand-300">{formatMwk(Number(line.net_pay))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line bg-bg">
                <tr>
                  <td className="px-4 py-3 text-sm font-semibold">Totals</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold">{formatMwk(Number(selectedRun.total_gross))}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-danger">−{formatMwk(Number(selectedRun.total_paye))}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-danger">
                    −{formatMwk((runWithLines?.lines ?? []).reduce((s, l) => s + Number(l.pension_employee), 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-danger">−{formatMwk(Number(selectedRun.total_other_deductions))}</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-brand-700 dark:text-brand-300">{formatMwk(Number(selectedRun.total_net))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {showApproveModal && (
          <ApprovePayrollModal
            businessId={businessId}
            run={selectedRun}
            userId={currentUser?.id ?? null}
            onClose={() => setShowApproveModal(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['payroll_runs'] });
              queryClient.invalidateQueries({ queryKey: ['payroll_run', 'lines', selectedRun.id] });
              queryClient.invalidateQueries({ queryKey: ['tax_returns'] });
            }}
          />
        )}
      </div>
    );
  }

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />)}</div>;
  if (isError) return <div className="flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"><AlertCircle className="h-4 w-4 shrink-0" />Failed to load payroll runs.</div>;

  if (runs.length === 0) {
    return (
      <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
          <Briefcase className="h-7 w-7 text-brand-600 dark:text-brand-400" />
        </div>
        <h2 className="text-base font-semibold text-ink">No payroll runs yet</h2>
        <p className="max-w-xs text-sm text-muted">Run your first payroll to calculate PAYE and net pay for all employees.</p>
        <button onClick={onRunPayroll} className="mt-2 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
          <Plus className="h-4 w-4" />Run Payroll
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 text-left">Run #</th>
            <th className="px-4 py-3 text-left">Period</th>
            <th className="px-4 py-3 text-left">Pay Date</th>
            <th className="px-4 py-3 text-right">Total Gross</th>
            <th className="px-4 py-3 text-right">Total PAYE</th>
            <th className="px-4 py-3 text-right">Total Net</th>
            <th className="px-4 py-3 text-center">Status</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((run) => (
            <tr key={run.id} onClick={() => setSelectedRun(run)} className="cursor-pointer transition-colors hover:bg-bg">
              <td className="px-4 py-3 font-medium text-brand-700 dark:text-brand-300">{run.run_number}</td>
              <td className="px-4 py-3 text-muted">{run.payroll_period}</td>
              <td className="px-4 py-3 text-muted">{run.pay_date}</td>
              <td className="px-4 py-3 text-right">{formatMwk(Number(run.total_gross))}</td>
              <td className="px-4 py-3 text-right text-danger">{formatMwk(Number(run.total_paye))}</td>
              <td className="px-4 py-3 text-right font-semibold text-brand-700 dark:text-brand-300">{formatMwk(Number(run.total_net))}</td>
              <td className="px-4 py-3 text-center"><StatusBadge status={run.status} /></td>
              <td className="px-3 py-3"><ChevronRight className="h-4 w-4 text-muted" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeesTab({ businessId, onAddEmployee, canEdit }: { businessId: string; onAddEmployee: () => void; canEdit: boolean }) {
  const [editingEmployee, setEditingEmployee] = useState<Row<'employees'> | null>(null);
  const queryClient = useQueryClient();

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ['employees', businessId],
    queryFn: () => repos.payroll.findEmployees(businessId),
    enabled: Boolean(businessId),
  });

  // FIX: this previously called calculatePAYE(gross * 12, []) — an
  // always-empty bands array — meaning the "Est. PAYE" column silently
  // used the hardcoded MRA-default fallback for every business, every
  // employee, regardless of that business's actual configured bands.
  // Now fetches the real bands, same as RunPayrollModal does.
  const { data: payeBands = [] } = useQuery({
    queryKey: ['paye_bands', businessId, currentFiscalYear()],
    queryFn: () => repos.payroll.findPayeBands(businessId, currentFiscalYear()),
    enabled: Boolean(businessId),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />)}</div>;
  if (isError) return <div className="flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"><AlertCircle className="h-4 w-4 shrink-0" />Failed to load employees.</div>;

  if (employees.length === 0) {
    return (
      <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
          <Users className="h-7 w-7 text-brand-600 dark:text-brand-400" />
        </div>
        <h2 className="text-base font-semibold text-ink">No employees yet</h2>
        <p className="max-w-xs text-sm text-muted">Add your first employee to start running payroll.</p>
        <button onClick={onAddEmployee} className="mt-2 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
          <Plus className="h-4 w-4" />Add Employee
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Employee #</th>
              <th className="px-4 py-3 text-left">Job Title</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-right">Gross Salary</th>
              <th className="px-4 py-3 text-right">Est. PAYE</th>
              <th className="px-4 py-3 text-right">Est. Net</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {employees.map((emp) => {
              const gross = Number(emp.gross_salary);
              const paye = emp.tax_exempt ? 0 : calculatePAYE(gross * 12, payeBands as PayeBand[]);
              const net = gross - paye;
              return (
                <tr
                  key={emp.id}
                  onClick={() => canEdit && setEditingEmployee(emp)}
                  className={`transition-colors hover:bg-bg ${canEdit ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{emp.first_name} {emp.last_name}</p>
                    <p className="text-xs text-muted">{emp.payment_method.replace(/_/g, ' ')}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{emp.employee_number}</td>
                  <td className="px-4 py-3 text-muted">{emp.job_title ?? '—'}</td>
                  <td className="px-4 py-3 text-muted capitalize">{emp.employment_type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right">{formatMwk(gross)}</td>
                  <td className="px-4 py-3 text-right text-danger">−{formatMwk(paye)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-700 dark:text-brand-300">{formatMwk(net)}</td>
                  {canEdit && (
                    <td className="px-3 py-3">
                      <Pencil className="h-4 w-4 text-muted" />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['employees'] })}
        />
      )}
    </>
  );
}

export function PayrollPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const role = currentBusiness?.role;
  const canEditEmployees = role === 'owner' || role === 'admin';
  // ASSUMPTION: approve should be restricted similarly to employee edits,
  // plus accountant (who's likely to be the one actually running payroll
  // approvals in practice). Adjust if your role model intends something
  // narrower or wider for this action.
  const canApprovePayroll = role === 'owner' || role === 'admin' || role === 'accountant';
  const [tab, setTab] = useState<MainTab>('runs');
  const [showRunModal, setShowRunModal] = useState(false);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const queryClient = useQueryClient();

  if (!businessId) {
    return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-muted">No business selected.</p></div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Payroll</h1>
          <p className="mt-1 text-sm text-muted">Manage payroll and employees for {currentBusiness.business.name}</p>
        </div>
        <div className="flex gap-2">
          {tab === 'employees' && (
            <button onClick={() => setShowAddEmployeeModal(true)}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors">
              <Plus className="h-4 w-4 text-brand-600 dark:text-brand-400" />Add Employee
            </button>
          )}
          <button onClick={() => setShowRunModal(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
            <Briefcase className="h-4 w-4" />Run Payroll
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-1 rounded-xl border border-line bg-bg p-1 w-fit">
        <button onClick={() => setTab('runs')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'runs' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'}`}>
          <Briefcase className="h-4 w-4" />Payroll Runs
        </button>
        <button onClick={() => setTab('employees')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'employees' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'}`}>
          <Users className="h-4 w-4" />Employees
        </button>
      </div>

      {tab === 'runs' && <PayrollRunsTab businessId={businessId} onRunPayroll={() => setShowRunModal(true)} canApprove={canApprovePayroll} />}
      {tab === 'employees' && <EmployeesTab businessId={businessId} onAddEmployee={() => setShowAddEmployeeModal(true)} canEdit={canEditEmployees} />}

      {showRunModal && (
        <RunPayrollModal businessId={businessId} onClose={() => setShowRunModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['payroll_runs'] })} />
      )}
      {showAddEmployeeModal && (
        <AddEmployeeModal businessId={businessId} onClose={() => setShowAddEmployeeModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['employees'] })} />
      )}
    </div>
  );
}
