import { currentFiscalYear } from '@/lib/fiscalYear';
import { calculatePAYE, type PayeBand } from '@/lib/paye';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, AlertCircle, CheckCircle, ChevronRight, ArrowLeft, X, Briefcase, Pencil, Download,
  Building2, Check, Upload, Filter, Search, RotateCcw, PieChart, Layers,
} from 'lucide-react';
import { formatMwkDetailed } from '@/lib/formatters';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto } from '@/dal/types/database';
import { nextEntryNumber } from '@/services/journalService';
import { csvCell } from '@/services/dataBackupService';
import { isMobileMoney } from '@/lib/paymentMethod';
import type { EmployeeWithOrg } from '@/dal/repositories/PayrollRepository';
import { EditEmployeeModal } from '@/components/payroll/EditEmployeeModal';
import { ImportEmployeesModal } from '@/components/payroll/ImportEmployeesModal';


function today(): string {
  return new Date().toISOString().slice(0, 10);
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

type MainTab = 'runs' | 'employees' | 'cost_centers';

interface Alert { type: 'success' | 'error'; message: string; }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    approved: 'bg-blue-50 text-blue-700',
    paid: 'bg-brand-50 text-brand-700',
    voided: 'bg-gray-100 text-gray-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function AlertBox({ alert }: { alert: Alert }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
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
    national_id: '', tpin: '', salary_account_id: '',
    branch_id: '', department_id: '',
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const { data: postingAccounts = [] } = useQuery({
    queryKey: ['posting_accounts', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.first_name.trim()) throw new Error('First name is required');
      if (!form.last_name.trim()) throw new Error('Last name is required');
      if (!form.employee_number.trim()) throw new Error('Employee number is required');
      const salary = parseFloat(form.gross_salary);
      if (isNaN(salary) || salary <= 0) throw new Error('Enter a valid gross salary');

      // `repos.payroll.client` is the base Supabase client; the in-app wrapper
      // type doesn't expose `.client`, hence the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- base client accessor on repos.payroll
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
          tpin: form.tpin || null, salary_account_id: form.salary_account_id || null,
          branch_id: form.branch_id || null,
          department_id: form.department_id || null,
          tax_exempt: false, is_active: true,
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
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Add Employee</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">First Name</label>
              <input type="text" value={form.first_name} onChange={(e) => set('first_name', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Last Name</label>
              <input type="text" value={form.last_name} onChange={(e) => set('last_name', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Employee Number</label>
              <input type="text" placeholder="e.g. EMP-001" value={form.employee_number} onChange={(e) => set('employee_number', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Job Title</label>
              <input type="text" placeholder="e.g. Accountant" value={form.job_title} onChange={(e) => set('job_title', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Employment Type</label>
              <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
                <option value="casual">Casual</option>
                <option value="part_time">Part Time</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Gross Monthly Salary (MWK)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={form.gross_salary} onChange={(e) => set('gross_salary', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
              <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Payment Method</label>
              <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
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
                <label className="mb-1 block text-sm font-medium text-gray-700">Bank Name</label>
                <input type="text" placeholder="e.g. NBS Bank" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Account Number</label>
                <input type="text" value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          {form.payment_method === 'mobile_money' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Provider</label>
                <select value={form.mobile_money_type} onChange={(e) => set('mobile_money_type', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                  <option value="">Select…</option>
                  <option value="airtel_money">Airtel Money</option>
                  <option value="tnm_mpamba">TNM Mpamba</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mobile Number</label>
                <input type="text" placeholder="e.g. 0999123456" value={form.mobile_money_number} onChange={(e) => set('mobile_money_number', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          {/* Cost Center / Branch & Department */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Branch (Cost Center)</label>
              <select value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">No branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Department</label>
              <select value={form.department_id} onChange={(e) => set('department_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.cost_centre ? ` [${d.cost_centre}]` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Salary Expense Account</label>
            <select value={form.salary_account_id} onChange={(e) => set('salary_account_id', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="">Select a salary expense account…</option>
              {postingAccounts.filter((account) => account.account_type === 'expense').map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">Required before approving payroll. Choose the expense account for this employee's gross pay.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">National ID (optional)</label>
              <input type="text" value={form.national_id} onChange={(e) => set('national_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">TPIN (optional)</label>
              <input type="text" value={form.tpin} onChange={(e) => set('tpin', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
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
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Run Payroll</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        {step === 'setup' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Payroll Period</label>
                <input type="month" value={form.payroll_period} onChange={(e) => setForm((f) => ({ ...f, payroll_period: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Pay Date</label>
                <input type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Period Start</label>
                <input type="date" value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Period End</label>
                <input type="date" value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <span className="font-medium text-gray-900">{employees.length}</span> active employee{employees.length !== 1 ? 's' : ''} will be included.
              {payeBands.length === 0 && <span className="ml-2 text-amber-600">⚠ No PAYE bands configured — using MRA 2024/25 defaults.</span>}
              {!tprConfig && <span className="ml-2 text-amber-600">⚠ TPR pension rates not configured — pension will be calculated as MK 0.00.</span>}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={() => setStep('review')} disabled={employees.length === 0}
                className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
                Review Payroll →
              </button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left">Employee</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Gross Pay</th>
                    <th scope="col" className="px-4 py-2.5 text-right">PAYE</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Pension (5%)</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Net Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payrollLines.map((line) => (
                    <tr key={line.employee.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{line.employee.first_name} {line.employee.last_name}</p>
                        <p className="text-xs text-gray-600">{line.employee.job_title ?? line.employee.employee_number}</p>
                      </td>
                      <td className="px-4 py-3 text-right">{formatMwkDetailed(line.gross_pay)}</td>
                      <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(line.paye_deduction)}</td>
                      <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(line.pension_employee)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-brand-700">{formatMwkDetailed(line.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">Totals</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold">{formatMwkDetailed(totals.gross)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-red-600">−{formatMwkDetailed(totals.paye)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-red-600">−{formatMwkDetailed(totals.pensionEmployee)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-brand-700">{formatMwkDetailed(totals.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {totals.pensionEmployer > 0 && (
              <p className="text-xs text-gray-500">
                Additional employer pension contribution (10%, not deducted from employees):{' '}
                <span className="font-medium text-gray-700">{formatMwkDetailed(totals.pensionEmployer)}</span>
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setStep('setup')} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">← Back</button>
              <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
                className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
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
  const [pensionAccountId, setPensionAccountId] = useState('');

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['payroll_payment_accounts', businessId],
    queryFn: () => repos.account.findPayrollPaymentAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const { data: tprConfig } = useQuery({
    queryKey: ['tax_configurations', businessId, 'tpr_pension'],
    queryFn: () => repos.tax.findByCode(businessId, 'tpr_pension'),
    enabled: Boolean(businessId),
  });

  const { data: postingAccounts = [] } = useQuery({
    queryKey: ['posting_accounts', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId),
    enabled: Boolean(businessId),
  });

  // Default pension account selection if unlinked
  const resolvedPensionAccount = pensionAccountId || tprConfig?.tax_payable_account_id || (
    postingAccounts.find((a) => a.code === '2132' || a.name.toLowerCase().includes('pension'))?.id ?? ''
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Unable to determine the current user. Please sign in again.');
      if (!bankAccountId) throw new Error('Select a bank account for net pay disbursement.');

      // Ensure pension payable account is linked if available
      const activePensionAccount = pensionAccountId || resolvedPensionAccount;
      if (activePensionAccount) {
        if (tprConfig && tprConfig.tax_payable_account_id !== activePensionAccount) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- base client accessor
          const { error } = await (repos.tax as any).client
            .from('tax_configurations')
            .update({ tax_payable_account_id: activePensionAccount })
            .eq('id', tprConfig.id);
          if (error) throw new Error(`Failed to link TPR pension account: ${error.message}`);
        } else if (!tprConfig) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- base client accessor
          const { error } = await (repos.tax as any).client
            .from('tax_configurations')
            .insert({
              business_id: businessId,
              tax_code: 'tpr_pension',
              name: 'TPR Pension',
              rate: 0,
              employer_rate: 10,
              employee_rate: 5,
              tax_payable_account_id: activePensionAccount,
              effective_from: '2011-01-01',
              is_active: true,
            });
          if (error) throw new Error(`Failed to create TPR pension config: ${error.message}`);
        }
      }

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
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Approve Payroll — {run.run_number}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        <p className="mb-4 text-sm text-gray-500">
          This posts the payroll journal entry (salaries, PAYE, pension) and disburses net pay of{' '}
          <span className="font-semibold text-gray-900">{formatMwkDetailed(Number(run.total_net))}</span> from the selected account.
          PAYE and TPR remittances will be generated automatically. This cannot be undone from here.
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">Pay From Bank or Cash Account</label>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="">Select an account…</option>
            {bankAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.code} — {acc.name}</option>
            ))}
          </select>
          {bankAccounts.length === 0 && (
            <p className="mt-1 text-xs text-amber-800">⚠ No bank or cash accounts found. Add a bank account or a Cash on Hand/Petty Cash account in Chart of Accounts first.</p>
          )}
        </div>

        <div className="mb-5">
          <label className="mb-1 block text-sm font-medium text-gray-700">TPR Pension Payable Account</label>
          <select
            value={pensionAccountId || resolvedPensionAccount}
            onChange={(e) => setPensionAccountId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Select Pension Payable account…</option>
            {postingAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.code} — {acc.name}</option>
            ))}
          </select>
          {!tprConfig?.tax_payable_account_id && (
            <p className="mt-1 text-xs text-amber-700">
              ⚠ TPR pension payable account is not linked. Linking it here will save it to your tax configuration.
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !bankAccountId}
            className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Approving…' : 'Approve & Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

function downloadPayrollCsv(headers: string[], rows: (string | number)[][], filename: string) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function PayrollRunsTab({ businessId, onRunPayroll, canApprove }: { businessId: string; onRunPayroll: () => void; canApprove: boolean }) {
  const [selectedRun, setSelectedRun] = useState<Row<'payroll_runs'> | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('all');
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

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', businessId],
    queryFn: () => repos.payroll.findEmployees(businessId),
    enabled: Boolean(businessId),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const employeeMap = new Map(employees.map((e) => [e.id, e] as const));

  if (selectedRun) {
    const allLines = runWithLines?.lines ?? [];
    const lines = allLines.filter((line) => {
      const emp = employeeMap.get(line.employee_id);
      if (selectedBranchId !== 'all') {
        if (selectedBranchId === 'unassigned') {
          if (emp?.branch_id) return false;
        } else if (emp?.branch_id !== selectedBranchId) {
          return false;
        }
      }
      if (selectedDepartmentId !== 'all') {
        if (selectedDepartmentId === 'unassigned') {
          if (emp?.department_id) return false;
        } else if (emp?.department_id !== selectedDepartmentId) {
          return false;
        }
      }
      return true;
    });

    const isFiltered = selectedBranchId !== 'all' || selectedDepartmentId !== 'all';
    const totalBeneficiaries = lines.length;
    const totalGross = lines.reduce((s, l) => s + Number(l.gross_pay || 0), 0);
    const totalPaye = lines.reduce((s, l) => s + Number(l.paye_deduction || 0), 0);
    const totalPensionEmployee = lines.reduce((s, l) => s + Number(l.pension_employee || 0), 0);
    const totalOtherDeductions = lines.reduce((s, l) => s + Number(l.other_deductions || 0), 0);
    const totalDeductions = totalPaye + totalPensionEmployee + totalOtherDeductions;
    const totalNet = lines.reduce((s, l) => s + Number(l.net_pay || 0), 0);

    // Group payment channels
    const channelSummary = lines.reduce((acc, line) => {
      const emp = employeeMap.get(line.employee_id);
      const method = emp?.payment_method ?? 'unspecified';
      const net = Number(line.net_pay || 0);
      if (!acc[method]) {
        acc[method] = { count: 0, amount: 0 };
      }
      acc[method].count += 1;
      acc[method].amount += net;
      return acc;
    }, {} as Record<string, { count: number; amount: number }>);

    // Cost Center Summary breakdown for this run
    const costCenterSummaryMap = lines.reduce((acc, line) => {
      const emp = employeeMap.get(line.employee_id);
      const bName = emp?.branch?.name || (emp?.branch_id ? 'Assigned Branch' : 'Unassigned Branch');
      const bCode = emp?.branch?.code || '';
      const dName = emp?.department?.name || (emp?.department_id ? 'Assigned Dept' : 'Unassigned Cost Centre');
      const cc = emp?.department?.cost_centre || '';
      const key = `${emp?.branch_id || 'unassigned'}__${emp?.department_id || 'unassigned'}`;

      if (!acc[key]) {
        acc[key] = {
          branchName: bName,
          branchCode: bCode,
          deptName: dName,
          costCentre: cc,
          count: 0,
          gross: 0,
          paye: 0,
          pension: 0,
          other: 0,
          net: 0,
        };
      }
      acc[key].count += 1;
      acc[key].gross += Number(line.gross_pay || 0);
      acc[key].paye += Number(line.paye_deduction || 0);
      acc[key].pension += Number(line.pension_employee || 0);
      acc[key].other += Number(line.other_deductions || 0);
      acc[key].net += Number(line.net_pay || 0);
      return acc;
    }, {} as Record<string, {
      branchName: string;
      branchCode: string;
      deptName: string;
      costCentre: string;
      count: number;
      gross: number;
      paye: number;
      pension: number;
      other: number;
      net: number;
    }>);

    const costCenterSummaryList = Object.values(costCenterSummaryMap).sort((a, b) => b.gross - a.gross);

    const handleExportCsv = () => {
      const headers = [
        'Run #',
        'Period Start',
        'Period End',
        'Pay Date',
        'Employee Number',
        'Employee Name',
        'Branch / Cost Centre',
        'Department',
        'Payment Method',
        'Payment Details',
        'Gross Salary',
        'PAYE Deduction',
        'Pension (Employee)',
        'Pension (Employer)',
        'Other Deductions',
        'Net Amount Received',
      ];

      const rows = lines.map((line) => {
        const emp = employeeMap.get(line.employee_id);
        const branchStr = emp?.branch?.name ? `${emp.branch.name}${emp.branch.code ? ' (' + emp.branch.code + ')' : ''}` : '';
        const deptStr = emp?.department?.name ? `${emp.department.name}${emp.department.cost_centre ? ' [' + emp.department.cost_centre + ']' : ''}` : '';
        const payDetail = emp?.payment_method === 'bank_transfer'
          ? `${emp?.bank_name || ''} - ${emp?.bank_account_number || ''}`.trim()
          : isMobileMoney(emp?.payment_method)
          ? `${emp?.mobile_money_type || ''} - ${emp?.mobile_money_number || ''}`.trim()
          : '';

        return [
          selectedRun.run_number,
          selectedRun.period_start,
          selectedRun.period_end,
          selectedRun.pay_date,
          emp?.employee_number || line.employee_id,
          emp ? `${emp.first_name} ${emp.last_name}` : line.employee_id,
          branchStr,
          deptStr,
          emp?.payment_method ? emp.payment_method.replace(/_/g, ' ') : '',
          payDetail,
          Number(line.gross_pay || 0).toFixed(2),
          Number(line.paye_deduction || 0).toFixed(2),
          Number(line.pension_employee || 0).toFixed(2),
          Number(line.pension_employer || 0).toFixed(2),
          Number(line.other_deductions || 0).toFixed(2),
          Number(line.net_pay || 0).toFixed(2),
        ];
      });

      const fileSuffix = isFiltered ? '_filtered' : '';
      downloadPayrollCsv(headers, rows, `payroll_${selectedRun.run_number}_${selectedRun.pay_date}${fileSuffix}.csv`);
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => setSelectedRun(null)} className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
            <ArrowLeft className="h-4 w-4" />Back to Payroll Runs
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
            >
              <Download className="h-4 w-4 text-gray-500" />
              Export Breakdown (CSV)
            </button>
            <StatusBadge status={selectedRun.status} />
            {selectedRun.status === 'draft' && canApprove && (
              <button onClick={() => setShowApproveModal(true)}
                className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
                <CheckCircle className="h-4 w-4" />Approve Payroll
              </button>
            )}
          </div>
        </div>

        {/* Detailed Breakdown Header & Metrics */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">{selectedRun.run_number}</h2>
                <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  {selectedRun.payroll_period}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Period: <span className="font-medium text-gray-700">{selectedRun.period_start}</span> to <span className="font-medium text-gray-700">{selectedRun.period_end}</span> • Pay Date: <span className="font-medium text-gray-700">{selectedRun.pay_date}</span>
              </p>
            </div>
          </div>

          {/* Cost Center / Branch Filter Bar */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-3.5 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-gray-600">
                <Filter className="h-3.5 w-3.5 text-brand-500" />
                Cost Center Filter:
              </div>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.code ? ` (${b.code})` : ''}
                  </option>
                ))}
                <option value="unassigned">Unassigned Branch</option>
              </select>

              <select
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Departments / Cost Centres</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.cost_centre ? ` [CC: ${d.cost_centre}]` : ''}
                  </option>
                ))}
                <option value="unassigned">Unassigned Department</option>
              </select>

              {isFiltered && (
                <button
                  onClick={() => {
                    setSelectedBranchId('all');
                    setSelectedDepartmentId('all');
                  }}
                  className="flex items-center gap-1 font-medium text-brand-600 hover:text-brand-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset Filter
                </button>
              )}
            </div>

            <div className="text-gray-500">
              Showing <strong className="text-gray-900">{lines.length}</strong> of{' '}
              <strong>{allLines.length}</strong> beneficiary lines
            </div>
          </div>

          {/* Monthly KPI Overview Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                <Users className="h-4 w-4 text-blue-500" />
                Beneficiaries
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{totalBeneficiaries}</p>
              <p className="text-xs text-gray-500">
                {isFiltered ? 'Filtered beneficiaries' : 'Employees paid'}
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                <Briefcase className="h-4 w-4 text-gray-500" />
                Total Gross Paid
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-900">{formatMwkDetailed(totalGross)}</p>
              <p className="text-xs text-gray-500">Before statutory deductions</p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                Total Deductions
              </div>
              <p className="mt-2 text-2xl font-bold text-red-600">−{formatMwkDetailed(totalDeductions)}</p>
              <p className="text-xs text-gray-500">PAYE ({formatMwkDetailed(totalPaye)}) + Pension ({formatMwkDetailed(totalPensionEmployee)})</p>
            </div>

            <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-brand-700">
                <Check className="h-4 w-4 text-brand-600" />
                Total Net Paid
              </div>
              <p className="mt-2 text-2xl font-bold text-brand-700">{formatMwkDetailed(totalNet)}</p>
              <p className="text-xs text-brand-600">Disbursed to beneficiaries</p>
            </div>
          </div>

          {/* Payment Method / Channel Breakdown */}
          {Object.keys(channelSummary).length > 0 && (
            <div className="mt-5 rounded-xl border border-gray-100 bg-white p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Disbursement by Payment Method {isFiltered && '(Filtered)'}
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {Object.entries(channelSummary).map(([method, data]) => (
                  <div key={method} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm">
                    <div>
                      <span className="font-medium capitalize text-gray-900">{method.replace(/_/g, ' ')}</span>
                      <span className="ml-2 text-xs text-gray-500">({data.count} {data.count === 1 ? 'employee' : 'employees'})</span>
                    </div>
                    <span className="font-semibold text-brand-700">{formatMwkDetailed(data.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost Center / Branch Summary Breakdown Widget */}
          {costCenterSummaryList.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50/80 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-brand-600" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                    Cost Center & Branch Allocation Breakdown
                  </h3>
                </div>
                <span className="text-xs text-gray-500">
                  {costCenterSummaryList.length} cost centre unit(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/50 text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left">Branch</th>
                      <th scope="col" className="px-4 py-2.5 text-left">Department / Cost Centre</th>
                      <th scope="col" className="px-4 py-2.5 text-center">Headcount</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Gross Pay</th>
                      <th scope="col" className="px-4 py-2.5 text-right">PAYE</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Pension</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Net Paid</th>
                      <th scope="col" className="px-4 py-2.5 text-right">% of Run</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {costCenterSummaryList.map((cc, idx) => {
                      const pct = totalGross > 0 ? (cc.gross / totalGross) * 100 : 0;
                      return (
                        <tr key={idx} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 font-medium text-gray-900">
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="h-3 w-3 text-blue-500" />
                              {cc.branchName}{cc.branchCode ? ` (${cc.branchCode})` : ''}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-700">
                            {cc.deptName}
                            {cc.costCentre && (
                              <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600">
                                CC: {cc.costCentre}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center font-medium text-gray-700">{cc.count}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-900">{formatMwkDetailed(cc.gross)}</td>
                          <td className="px-4 py-2.5 text-right text-red-600">−{formatMwkDetailed(cc.paye)}</td>
                          <td className="px-4 py-2.5 text-right text-red-600">−{formatMwkDetailed(cc.pension)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-brand-700">{formatMwkDetailed(cc.net)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detailed Employee Breakdown Table */}
          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">
                Beneficiary Payment Lines & Cost Centre Allocation {isFiltered && '(Filtered)'}
              </h3>
              <span className="text-xs text-gray-500">
                {lines.length} beneficiary line(s)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left">Beneficiary / Employee</th>
                    <th scope="col" className="px-4 py-2.5 text-left">Branch & Cost Centre</th>
                    <th scope="col" className="px-4 py-2.5 text-left">Payment Channel</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Gross Pay</th>
                    <th scope="col" className="px-4 py-2.5 text-right">PAYE</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Pension (Emp)</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Other Ded.</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Amount Received (Net)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line) => {
                    const emp = employeeMap.get(line.employee_id);
                    const branchName = emp?.branch?.name;
                    const branchCode = emp?.branch?.code;
                    const deptName = emp?.department?.name;
                    const costCentre = emp?.department?.cost_centre;

                    return (
                      <tr key={line.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">
                            {emp ? `${emp.first_name} ${emp.last_name}` : line.employee_id}
                          </p>
                          <p className="text-xs text-gray-500">
                            {emp?.employee_number ? `#${emp.employee_number}` : 'No ID'} • {emp?.job_title || 'Staff'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {branchName || deptName ? (
                            <div className="space-y-0.5">
                              {branchName && (
                                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                                  <Building2 className="h-3 w-3" />
                                  {branchName}{branchCode ? ` (${branchCode})` : ''}
                                </span>
                              )}
                              {deptName && (
                                <p className="text-xs text-gray-600">
                                  {deptName}{costCentre ? ` • CC: ${costCentre}` : ''}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block text-xs font-medium capitalize text-gray-700">
                            {emp?.payment_method ? emp.payment_method.replace(/_/g, ' ') : '—'}
                          </span>
                          {emp?.payment_method === 'bank_transfer' && emp.bank_account_number && (
                            <p className="text-xs text-gray-400">{emp.bank_name || 'Bank'}: {emp.bank_account_number}</p>
                          )}
                          {emp && isMobileMoney(emp.payment_method) && emp.mobile_money_number && (
                            <p className="text-xs text-gray-400">{emp.mobile_money_type || 'Mobile'}: {emp.mobile_money_number}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700">{formatMwkDetailed(Number(line.gross_pay))}</td>
                        <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(Number(line.paye_deduction))}</td>
                        <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(Number(line.pension_employee))}</td>
                        <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(Number(line.other_deductions))}</td>
                        <td className="px-4 py-3 text-right font-bold text-brand-700">{formatMwkDetailed(Number(line.net_pay))}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-sm font-bold text-gray-900">
                      Totals ({totalBeneficiaries} {totalBeneficiaries === 1 ? 'beneficiary' : 'beneficiaries'})
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">{formatMwkDetailed(totalGross)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-600">−{formatMwkDetailed(totalPaye)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-600">
                      −{formatMwkDetailed(totalPensionEmployee)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-red-600">−{formatMwkDetailed(totalOtherDeductions)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-brand-700">{formatMwkDetailed(totalNet)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
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

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />Failed to load payroll runs.</div>;

  if (runs.length === 0) {
    return (
      <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <Briefcase className="h-7 w-7 text-brand-500" />
        </div>
        <h2 className="text-base font-semibold text-gray-900">No payroll runs yet</h2>
        <p className="max-w-xs text-sm text-gray-500">Run your first payroll to calculate PAYE and net pay for all employees.</p>
        <button onClick={onRunPayroll} className="mt-2 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          <Plus className="h-4 w-4" />Run Payroll
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cost Center Filter Bar for Runs list */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-gray-600">
            <Filter className="h-3.5 w-3.5 text-brand-500" />
            Cost Center Filter:
          </div>
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.code ? ` (${b.code})` : ''}
              </option>
            ))}
            <option value="unassigned">Unassigned Branch</option>
          </select>

          <select
            value={selectedDepartmentId}
            onChange={(e) => setSelectedDepartmentId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All Departments / Cost Centres</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}{d.cost_centre ? ` [CC: ${d.cost_centre}]` : ''}
              </option>
            ))}
            <option value="unassigned">Unassigned Department</option>
          </select>

          {(selectedBranchId !== 'all' || selectedDepartmentId !== 'all') && (
            <button
              onClick={() => {
                setSelectedBranchId('all');
                setSelectedDepartmentId('all');
              }}
              className="flex items-center gap-1 font-medium text-brand-600 hover:text-brand-800"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset Filter
            </button>
          )}
        </div>

        {(selectedBranchId !== 'all' || selectedDepartmentId !== 'all') ? (
          <span className="text-brand-700 font-medium">
            Filter active. Click any run to inspect filtered cost center figures.
          </span>
        ) : (
          <span className="text-gray-500">
            Select a run to view detailed cost center allocation & KPI metrics
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Run #</th>
              <th scope="col" className="px-4 py-3 text-left">Period</th>
              <th scope="col" className="px-4 py-3 text-left">Pay Date</th>
              <th scope="col" className="px-4 py-3 text-right">Total Gross</th>
              <th scope="col" className="px-4 py-3 text-right">Total PAYE</th>
              <th scope="col" className="px-4 py-3 text-right">Total Net</th>
              <th scope="col" className="px-4 py-3 text-center">Status</th>
              <th scope="col" className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map((run) => (
              <tr key={run.id} onClick={() => setSelectedRun(run)} className="cursor-pointer transition-colors hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-brand-700">{run.run_number}</td>
                <td className="px-4 py-3 text-gray-500">{run.payroll_period}</td>
                <td className="px-4 py-3 text-gray-500">{run.pay_date}</td>
                <td className="px-4 py-3 text-right">{formatMwkDetailed(Number(run.total_gross))}</td>
                <td className="px-4 py-3 text-right text-red-600">{formatMwkDetailed(Number(run.total_paye))}</td>
                <td className="px-4 py-3 text-right font-semibold text-brand-700">{formatMwkDetailed(Number(run.total_net))}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={run.status} /></td>
                <td className="px-3 py-3"><ChevronRight className="h-4 w-4 text-gray-400" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmployeesTab({
  businessId,
  onAddEmployee,
  onImportEmployees,
  canEdit,
}: {
  businessId: string;
  onAddEmployee: () => void;
  onImportEmployees: () => void;
  canEdit: boolean;
}) {
  const [editingEmployee, setEditingEmployee] = useState<Row<'employees'> | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const queryClient = useQueryClient();

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ['employees', businessId],
    queryFn: () => repos.payroll.findEmployees(businessId),
    enabled: Boolean(businessId),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: payeBands = [] } = useQuery({
    queryKey: ['paye_bands', businessId, currentFiscalYear()],
    queryFn: () => repos.payroll.findPayeBands(businessId, currentFiscalYear()),
    enabled: Boolean(businessId),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />Failed to load employees.</div>;

  if (employees.length === 0) {
    return (
      <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <Users className="h-7 w-7 text-brand-500" />
        </div>
        <h2 className="text-base font-semibold text-gray-900">No employees yet</h2>
        <p className="max-w-xs text-sm text-gray-500">Add or bulk-import employees to start assigning cost centers and running payroll.</p>
        <div className="mt-2 flex gap-2">
          {canEdit && (
            <button
              onClick={onImportEmployees}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Upload className="h-4 w-4 text-brand-500" />Import CSV
            </button>
          )}
          <button onClick={onAddEmployee} className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />Add Employee
          </button>
        </div>
      </div>
    );
  }

  const filteredEmployees = employees.filter((emp: EmployeeWithOrg) => {
    if (selectedBranchId !== 'all') {
      if (selectedBranchId === 'unassigned') {
        if (emp.branch_id) return false;
      } else if (emp.branch_id !== selectedBranchId) {
        return false;
      }
    }
    if (selectedDepartmentId !== 'all') {
      if (selectedDepartmentId === 'unassigned') {
        if (emp.department_id) return false;
      } else if (emp.department_id !== selectedDepartmentId) {
        return false;
      }
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
      const empNum = (emp.employee_number || '').toLowerCase();
      const job = (emp.job_title || '').toLowerCase();
      const branchName = (emp.branch?.name || '').toLowerCase();
      const deptName = (emp.department?.name || '').toLowerCase();
      const cc = (emp.department?.cost_centre || '').toLowerCase();
      if (!fullName.includes(q) && !empNum.includes(q) && !job.includes(q) && !branchName.includes(q) && !deptName.includes(q) && !cc.includes(q)) {
        return false;
      }
    }
    return true;
  });

  const isFiltered = selectedBranchId !== 'all' || selectedDepartmentId !== 'all' || Boolean(searchTerm.trim());
  const filteredGross = filteredEmployees.reduce((sum: number, emp: EmployeeWithOrg) => sum + Number(emp.gross_salary || 0), 0);
  const filteredPaye = filteredEmployees.reduce((sum: number, emp: EmployeeWithOrg) => {
    const gross = Number(emp.gross_salary || 0);
    return sum + (emp.tax_exempt ? 0 : calculatePAYE(gross * 12, payeBands as PayeBand[]));
  }, 0);
  const filteredNet = filteredGross - filteredPaye;

  return (
    <div className="space-y-4">
      {/* Cost Center Filter & Search Bar */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-600">
              <Filter className="h-3.5 w-3.5 text-brand-500" />
              Filter Cost Centers:
            </div>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.code ? ` (${b.code})` : ''}
                </option>
              ))}
              <option value="unassigned">Unassigned Branch</option>
            </select>

            <select
              value={selectedDepartmentId}
              onChange={(e) => setSelectedDepartmentId(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All Departments / Cost Centres</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.cost_centre ? ` [CC: ${d.cost_centre}]` : ''}
                </option>
              ))}
              <option value="unassigned">Unassigned Department</option>
            </select>

            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search staff, code, title..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {isFiltered && (
              <button
                onClick={() => {
                  setSelectedBranchId('all');
                  setSelectedDepartmentId('all');
                  setSearchTerm('');
                }}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Clear Filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={onImportEmployees}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <Upload className="h-3.5 w-3.5 text-brand-600" />
                Bulk Import
              </button>
            )}
          </div>
        </div>

        {/* Filter Summary Metrics */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Staff Count: <strong className="text-gray-900">{filteredEmployees.length}</strong> (of {employees.length})</span>
            {isFiltered && <span className="rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700">Filtered View</span>}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-gray-500">Filtered Gross: </span>
              <strong className="text-gray-900">{formatMwkDetailed(filteredGross)}</strong>
            </div>
            <div>
              <span className="text-gray-500">Est. PAYE: </span>
              <strong className="text-red-600">−{formatMwkDetailed(filteredPaye)}</strong>
            </div>
            <div>
              <span className="text-gray-500">Est. Net: </span>
              <strong className="text-brand-700 font-bold">{formatMwkDetailed(filteredNet)}</strong>
            </div>
          </div>
        </div>
      </div>

      {filteredEmployees.length === 0 ? (
        <div className="flex min-h-[25vh] flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <Building2 className="h-8 w-8 text-gray-400 mb-2" />
          <h3 className="text-sm font-semibold text-gray-800">No employees match the selected filter</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm">
            Try adjusting or resetting your branch and department filters.
          </p>
          <button
            onClick={() => {
              setSelectedBranchId('all');
              setSelectedDepartmentId('all');
              setSearchTerm('');
            }}
            className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Employee</th>
                <th scope="col" className="px-4 py-3 text-left">Cost Center / Branch</th>
                <th scope="col" className="px-4 py-3 text-left">Job Title</th>
                <th scope="col" className="px-4 py-3 text-left">Type</th>
                <th scope="col" className="px-4 py-3 text-right">Gross Salary</th>
                <th scope="col" className="px-4 py-3 text-right">Est. PAYE</th>
                <th scope="col" className="px-4 py-3 text-right">Est. Net</th>
                {canEdit && <th scope="col" className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredEmployees.map((emp) => {
                const gross = Number(emp.gross_salary);
                const paye = emp.tax_exempt ? 0 : calculatePAYE(gross * 12, payeBands as PayeBand[]);
                const net = gross - paye;
                const branchName = emp.branch?.name;
                const branchCode = emp.branch?.code;
                const deptName = emp.department?.name;
                const costCentre = emp.department?.cost_centre;

                return (
                  <tr
                    key={emp.id}
                    onClick={() => canEdit && setEditingEmployee(emp)}
                    className={`transition-colors hover:bg-gray-50 ${canEdit ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-gray-500">
                        {emp.employee_number ? `#${emp.employee_number} • ` : ''}{emp.payment_method.replace(/_/g, ' ')}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {branchName || deptName ? (
                        <div>
                          {branchName && (
                            <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                              <Building2 className="h-3 w-3" />
                              {branchName}{branchCode ? ` (${branchCode})` : ''}
                            </span>
                          )}
                          {deptName && (
                            <p className="mt-0.5 text-xs text-gray-600">
                              {deptName}{costCentre ? ` • CC: ${costCentre}` : ''}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{emp.job_title ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{emp.employment_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-right">{formatMwkDetailed(gross)}</td>
                    <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(paye)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-700">{formatMwkDetailed(net)}</td>
                    {canEdit && (
                      <td className="px-3 py-3">
                        <Pencil className="h-4 w-4 text-gray-400" />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['employees'] })}
        />
      )}
    </div>
  );
}

function CostCentersTab({ businessId }: { businessId: string }) {
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('all');
  const [scope, setScope] = useState<string>('live');

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['payroll_runs', businessId],
    queryFn: () => repos.payroll.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ['employees', businessId],
    queryFn: () => repos.payroll.findEmployees(businessId),
    enabled: Boolean(businessId),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: payeBands = [] } = useQuery({
    queryKey: ['paye_bands', businessId, currentFiscalYear()],
    queryFn: () => repos.payroll.findPayeBands(businessId, currentFiscalYear()),
    enabled: Boolean(businessId),
  });

  const { data: tprConfig } = useQuery({
    queryKey: ['tax_config_pension', businessId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- base client accessor on repos.payroll
      const { data } = await (repos.payroll as any).client
        .from('tax_configurations')
        .select('*')
        .eq('business_id', businessId)
        .eq('tax_code', 'tpr_pension')
        .eq('is_active', true)
        .maybeSingle();
      return data;
    },
    enabled: Boolean(businessId),
  });

  const targetRun = scope !== 'live' ? runs.find((r) => r.id === scope) : null;

  const { data: targetRunWithLines } = useQuery({
    queryKey: ['payroll_run', 'lines', targetRun?.id],
    queryFn: () => repos.payroll.findWithLines(targetRun!.id),
    enabled: Boolean(targetRun?.id),
  });

  const employeeMap = new Map<string, EmployeeWithOrg>(employees.map((e) => [e.id, e]));

  interface CostCenterItem {
    id: string;
    employeeName: string;
    employeeNumber: string;
    branchId: string | null;
    branchName: string;
    branchCode: string;
    departmentId: string | null;
    departmentName: string;
    costCentre: string;
    grossPay: number;
    paye: number;
    pensionEmp: number;
    otherDeductions: number;
    netPay: number;
  }

  const items: CostCenterItem[] = (scope !== 'live' && targetRunWithLines)
    ? (targetRunWithLines.lines || []).map((l) => {
        const emp = employeeMap.get(l.employee_id);
        return {
          id: l.id,
          employeeName: emp ? `${emp.first_name} ${emp.last_name}` : l.employee_id,
          employeeNumber: emp?.employee_number || '',
          branchId: emp?.branch_id || null,
          branchName: emp?.branch?.name || (emp?.branch_id ? 'Branch' : 'Unassigned Branch'),
          branchCode: emp?.branch?.code || '',
          departmentId: emp?.department_id || null,
          departmentName: emp?.department?.name || (emp?.department_id ? 'Department' : 'Unassigned Cost Centre'),
          costCentre: emp?.department?.cost_centre || '',
          grossPay: Number(l.gross_pay || 0),
          paye: Number(l.paye_deduction || 0),
          pensionEmp: Number(l.pension_employee || 0),
          otherDeductions: Number(l.other_deductions || 0),
          netPay: Number(l.net_pay || 0),
        };
      })
    : employees.map((emp) => {
        const gross = Number(emp.gross_salary || 0);
        const paye = emp.tax_exempt ? 0 : calculatePAYE(gross * 12, payeBands as PayeBand[]);
        const pension = calculatePension(gross, tprConfig?.employer_rate, tprConfig?.employee_rate);
        const pensionEmp = pension.employee;
        const net = gross - paye - pensionEmp;
        return {
          id: emp.id,
          employeeName: `${emp.first_name} ${emp.last_name}`,
          employeeNumber: emp.employee_number || '',
          branchId: emp.branch_id || null,
          branchName: emp.branch?.name || (emp.branch_id ? 'Branch' : 'Unassigned Branch'),
          branchCode: emp.branch?.code || '',
          departmentId: emp.department_id || null,
          departmentName: emp.department?.name || (emp.department_id ? 'Department' : 'Unassigned Cost Centre'),
          costCentre: emp.department?.cost_centre || '',
          grossPay: gross,
          paye,
          pensionEmp,
          otherDeductions: 0,
          netPay: net,
        };
      });

  // Filter items
  const filteredItems = items.filter((item) => {
    if (selectedBranchId !== 'all') {
      if (selectedBranchId === 'unassigned') {
        if (item.branchId) return false;
      } else if (item.branchId !== selectedBranchId) {
        return false;
      }
    }
    if (selectedDepartmentId !== 'all') {
      if (selectedDepartmentId === 'unassigned') {
        if (item.departmentId) return false;
      } else if (item.departmentId !== selectedDepartmentId) {
        return false;
      }
    }
    return true;
  });

  const totalGross = filteredItems.reduce((s, i) => s + i.grossPay, 0);
  const totalPaye = filteredItems.reduce((s, i) => s + i.paye, 0);
  const totalPension = filteredItems.reduce((s, i) => s + i.pensionEmp, 0);
  const totalOther = filteredItems.reduce((s, i) => s + i.otherDeductions, 0);
  const totalDeductions = totalPaye + totalPension + totalOther;
  const totalNet = filteredItems.reduce((s, i) => s + i.netPay, 0);

  // Group by Branch
  const branchRollupMap = filteredItems.reduce((acc, item) => {
    const key = item.branchId || 'unassigned';
    if (!acc[key]) {
      acc[key] = {
        name: item.branchName,
        code: item.branchCode,
        headcount: 0,
        gross: 0,
        paye: 0,
        pension: 0,
        deductions: 0,
        net: 0,
        deptIds: new Set<string>(),
      };
    }
    acc[key].headcount += 1;
    acc[key].gross += item.grossPay;
    acc[key].paye += item.paye;
    acc[key].pension += item.pensionEmp;
    acc[key].deductions += item.paye + item.pensionEmp + item.otherDeductions;
    acc[key].net += item.netPay;
    if (item.departmentId) acc[key].deptIds.add(item.departmentId);
    return acc;
  }, {} as Record<string, {
    name: string;
    code: string;
    headcount: number;
    gross: number;
    paye: number;
    pension: number;
    deductions: number;
    net: number;
    deptIds: Set<string>;
  }>);
  const branchRollupList = Object.values(branchRollupMap).sort((a, b) => b.gross - a.gross);

  // Group by Department / Cost Centre
  const deptRollupMap = filteredItems.reduce((acc, item) => {
    const key = item.departmentId || 'unassigned';
    if (!acc[key]) {
      acc[key] = {
        name: item.departmentName,
        costCentre: item.costCentre,
        branchName: item.branchName,
        branchCode: item.branchCode,
        headcount: 0,
        gross: 0,
        paye: 0,
        pension: 0,
        deductions: 0,
        net: 0,
      };
    }
    acc[key].headcount += 1;
    acc[key].gross += item.grossPay;
    acc[key].paye += item.paye;
    acc[key].pension += item.pensionEmp;
    acc[key].deductions += item.paye + item.pensionEmp + item.otherDeductions;
    acc[key].net += item.netPay;
    return acc;
  }, {} as Record<string, {
    name: string;
    costCentre: string;
    branchName: string;
    branchCode: string;
    headcount: number;
    gross: number;
    paye: number;
    pension: number;
    deductions: number;
    net: number;
  }>);
  const deptRollupList = Object.values(deptRollupMap).sort((a, b) => b.gross - a.gross);

  const isFiltered = selectedBranchId !== 'all' || selectedDepartmentId !== 'all';

  const handleExportCsv = () => {
    const headers = [
      'Cost Centre Code',
      'Department Name',
      'Branch',
      'Branch Code',
      'Headcount',
      'Gross Pay',
      'PAYE Deductions',
      'Pension Deductions',
      'Total Deductions',
      'Net Pay',
      'Share of Payroll %',
    ];

    const rows = deptRollupList.map((d) => [
      d.costCentre || 'None',
      d.name,
      d.branchName,
      d.branchCode || '',
      d.headcount,
      d.gross.toFixed(2),
      d.paye.toFixed(2),
      d.pension.toFixed(2),
      d.deductions.toFixed(2),
      d.net.toFixed(2),
      totalGross > 0 ? ((d.gross / totalGross) * 100).toFixed(2) + '%' : '0.00%',
    ]);

    const scopeLabel = scope === 'live' ? 'active_headcount' : (targetRun?.run_number || 'run');
    downloadPayrollCsv(headers, rows, `cost_center_payroll_report_${scopeLabel}.csv`);
  };

  if (runsLoading || empLoading) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Control Header & Filters */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-brand-500" />
              <h2 className="text-base font-semibold text-gray-900">Cost Center & Branch Payroll Report</h2>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              Departmental and cost-centre allocation of employee gross wages, statutory PAYE, and net disbursement
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5 text-gray-500" />
              Export Cost Center Report (CSV)
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="mr-2 font-medium text-gray-600">Report Scope:</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="live">Active Staff Master (Current Live Allocation)</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    Run {r.run_number} ({r.payroll_period}) — Paid {r.pay_date}
                  </option>
                ))}
              </select>
            </div>

            <div className="h-4 w-px bg-gray-200 hidden sm:block" />

            <div>
              <label className="mr-2 font-medium text-gray-600">Branch:</label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.code ? ` (${b.code})` : ''}
                  </option>
                ))}
                <option value="unassigned">Unassigned Branch</option>
              </select>
            </div>

            <div>
              <label className="mr-2 font-medium text-gray-600">Department:</label>
              <select
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="all">All Departments / Cost Centres</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.cost_centre ? ` [CC: ${d.cost_centre}]` : ''}
                  </option>
                ))}
                <option value="unassigned">Unassigned Department</option>
              </select>
            </div>

            {isFiltered && (
              <button
                onClick={() => {
                  setSelectedBranchId('all');
                  setSelectedDepartmentId('all');
                }}
                className="flex items-center gap-1 font-medium text-brand-600 hover:text-brand-800"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
              </button>
            )}
          </div>

          <div className="text-gray-500">
            Headcount in Scope: <strong className="text-gray-900">{filteredItems.length}</strong>
          </div>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Building2 className="h-4 w-4 text-blue-500" />
            Units in Scope
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{branchRollupList.length} Branches</p>
          <p className="text-xs text-gray-500">{deptRollupList.length} distinct cost centres</p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Briefcase className="h-4 w-4 text-gray-500" />
            Total Gross Payroll
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{formatMwkDetailed(totalGross)}</p>
          <p className="text-xs text-gray-500">Base salary commitments</p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Total Deductions
          </div>
          <p className="mt-2 text-2xl font-bold text-red-600">−{formatMwkDetailed(totalDeductions)}</p>
          <p className="text-xs text-gray-500">PAYE ({formatMwkDetailed(totalPaye)}) + Pension ({formatMwkDetailed(totalPension)})</p>
        </div>

        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-brand-700">
            <Check className="h-4 w-4 text-brand-600" />
            Total Net Disbursement
          </div>
          <p className="mt-2 text-2xl font-bold text-brand-700">{formatMwkDetailed(totalNet)}</p>
          <p className="text-xs text-brand-600">Net salary obligations</p>
        </div>
      </div>

      {/* Table 1: Branch-Level Rollup */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-gray-800">Branch-Level Payroll Allocation</h3>
          </div>
          <span className="text-xs text-gray-500">{branchRollupList.length} branch unit(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50/50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Branch</th>
                <th scope="col" className="px-4 py-3 text-center">Cost Centres</th>
                <th scope="col" className="px-4 py-3 text-center">Headcount</th>
                <th scope="col" className="px-4 py-3 text-right">Gross Payroll</th>
                <th scope="col" className="px-4 py-3 text-right">PAYE</th>
                <th scope="col" className="px-4 py-3 text-right">Pension</th>
                <th scope="col" className="px-4 py-3 text-right">Net Payable</th>
                <th scope="col" className="px-4 py-3 text-right">Payroll Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {branchRollupList.map((b, idx) => {
                const share = totalGross > 0 ? (b.gross / totalGross) * 100 : 0;
                return (
                  <tr key={idx} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-blue-600" />
                        {b.name}{b.code ? ` (${b.code})` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{b.deptIds.size}</td>
                    <td className="px-4 py-3 text-center font-medium text-gray-800">{b.headcount}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatMwkDetailed(b.gross)}</td>
                    <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(b.paye)}</td>
                    <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(b.pension)}</td>
                    <td className="px-4 py-3 text-right font-bold text-brand-700">{formatMwkDetailed(b.net)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 font-medium">{share.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50/80 font-bold text-xs">
              <tr>
                <td className="px-4 py-3 text-gray-900">Total All Branches</td>
                <td className="px-4 py-3 text-center text-gray-700">—</td>
                <td className="px-4 py-3 text-center text-gray-900">{filteredItems.length}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatMwkDetailed(totalGross)}</td>
                <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(totalPaye)}</td>
                <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(totalPension)}</td>
                <td className="px-4 py-3 text-right text-brand-700">{formatMwkDetailed(totalNet)}</td>
                <td className="px-4 py-3 text-right text-gray-900">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Table 2: Department & Cost Centre Rollup */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-gray-800">Department & Cost Centre Rollup</h3>
          </div>
          <span className="text-xs text-gray-500">{deptRollupList.length} cost centre(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50/50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Cost Centre Code</th>
                <th scope="col" className="px-4 py-3 text-left">Department Name</th>
                <th scope="col" className="px-4 py-3 text-left">Branch</th>
                <th scope="col" className="px-4 py-3 text-center">Headcount</th>
                <th scope="col" className="px-4 py-3 text-right">Gross Pay</th>
                <th scope="col" className="px-4 py-3 text-right">Total Deductions</th>
                <th scope="col" className="px-4 py-3 text-right">Net Disbursement</th>
                <th scope="col" className="px-4 py-3 text-right">Avg Pay / Staff</th>
                <th scope="col" className="px-4 py-3 text-right">% Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deptRollupList.map((d, idx) => {
                const share = totalGross > 0 ? (d.gross / totalGross) * 100 : 0;
                const avg = d.headcount > 0 ? d.gross / d.headcount : 0;
                return (
                  <tr key={idx} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">
                      {d.costCentre ? (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700">
                          {d.costCentre}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {d.branchName}{d.branchCode ? ` (${d.branchCode})` : ''}
                    </td>
                    <td className="px-4 py-3 text-center font-medium text-gray-800">{d.headcount}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatMwkDetailed(d.gross)}</td>
                    <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(d.deductions)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-brand-700">{formatMwkDetailed(d.net)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatMwkDetailed(avg)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 font-medium">{share.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50/80 font-bold text-xs">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-gray-900">Totals</td>
                <td className="px-4 py-3 text-center text-gray-900">{filteredItems.length}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatMwkDetailed(totalGross)}</td>
                <td className="px-4 py-3 text-right text-red-600">−{formatMwkDetailed(totalDeductions)}</td>
                <td className="px-4 py-3 text-right text-brand-700">{formatMwkDetailed(totalNet)}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {filteredItems.length > 0 ? formatMwkDetailed(totalGross / filteredItems.length) : '—'}
                </td>
                <td className="px-4 py-3 text-right text-gray-900">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
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
  const [showImportEmployeeModal, setShowImportEmployeeModal] = useState(false);
  const queryClient = useQueryClient();

  if (!businessId) {
    return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-gray-500">No business selected.</p></div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Payroll</h1>
          <p className="mt-1 text-sm text-gray-500">Manage payroll, cost center allocation, and employees for {currentBusiness.business.name}</p>
        </div>
        <div className="flex gap-2">
          {tab === 'employees' && canEditEmployees && (
            <>
              <button
                onClick={() => setShowImportEmployeeModal(true)}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Upload className="h-4 w-4 text-brand-500" />Import CSV
              </button>
              <button
                onClick={() => setShowAddEmployeeModal(true)}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Plus className="h-4 w-4 text-brand-500" />Add Employee
              </button>
            </>
          )}
          <button
            onClick={() => setShowRunModal(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
          >
            <Briefcase className="h-4 w-4" />Run Payroll
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        <button
          onClick={() => setTab('runs')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'runs' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Briefcase className="h-4 w-4" />Payroll Runs
        </button>
        <button
          onClick={() => setTab('employees')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'employees' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="h-4 w-4" />Employees
        </button>
        <button
          onClick={() => setTab('cost_centers')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'cost_centers' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 className="h-4 w-4" />Cost Centers
        </button>
      </div>

      {tab === 'runs' && <PayrollRunsTab businessId={businessId} onRunPayroll={() => setShowRunModal(true)} canApprove={canApprovePayroll} />}
      {tab === 'employees' && (
        <EmployeesTab
          businessId={businessId}
          onAddEmployee={() => setShowAddEmployeeModal(true)}
          onImportEmployees={() => setShowImportEmployeeModal(true)}
          canEdit={canEditEmployees}
        />
      )}
      {tab === 'cost_centers' && <CostCentersTab businessId={businessId} />}

      {showRunModal && (
        <RunPayrollModal
          businessId={businessId}
          onClose={() => setShowRunModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['payroll_runs'] })}
        />
      )}
      {showAddEmployeeModal && (
        <AddEmployeeModal
          businessId={businessId}
          onClose={() => setShowAddEmployeeModal(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['employees'] })}
        />
      )}
      {showImportEmployeeModal && (
        <ImportEmployeesModal
          businessId={businessId}
          onClose={() => setShowImportEmployeeModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['employees'] });
          }}
        />
      )}
    </div>
  );
}
