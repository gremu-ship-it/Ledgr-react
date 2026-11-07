import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, CalendarPlus, Pencil, Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { activeOnDate, asRow, asRows, employeeDisplayName, formatDate, formatMoney, numeric, text, todayDate, type Row } from './employeeUtils';

type Tab = 'overview' | 'components' | 'leave';

const statusTone: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  on_leave: 'bg-amber-50 text-amber-700',
  terminated: 'bg-gray-100 text-gray-700',
  suspended: 'bg-red-50 text-red-700',
};

function statusLabelKey(status: string): string {
  if (status === 'on_leave') return 'payroll.statusOnLeave';
  if (status === 'terminated') return 'payroll.statusTerminated';
  if (status === 'suspended') return 'payroll.statusSuspended';
  return 'payroll.statusActive';
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-gray-100 py-3 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-gray-900">{value || '—'}</dd>
    </div>
  );
}

interface EditEmployeeFormProps {
  employee: Row;
  onCancel: () => void;
  onSave: (values: Record<string, unknown>) => void;
  isSaving: boolean;
  t: (key: string) => string;
}

function EditEmployeeForm({ employee, onCancel, onSave, isSaving, t }: EditEmployeeFormProps) {
  const [form, setForm] = useState(() => ({
    first_name: text(employee.first_name),
    last_name: text(employee.last_name),
    national_id: text(employee.national_id),
    tax_id: text(employee.tax_id ?? employee.tpin),
    email: text(employee.email),
    phone: text(employee.phone),
    department: text(employee.department),
    job_title: text(employee.job_title),
    gross_salary: text(employee.gross_salary, '0'),
    contract_effective_from: todayDate(),
    employment_type: text(employee.employment_type, 'permanent'),
    pay_frequency: text(employee.pay_frequency, 'monthly'),
    status: text(employee.status, 'active'),
    termination_date: text(employee.termination_date ?? employee.end_date),
    bank_name: text(employee.bank_name),
    bank_account_number: text(employee.bank_account_number),
    payment_method: text(employee.payment_method, 'bank_transfer'),
  }));
  const field = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const salary = Number(form.gross_salary);
    if (!form.first_name.trim() || !form.last_name.trim() || !form.gross_salary.trim() || !Number.isFinite(salary) || salary < 0) return;
    onSave({
      ...form,
      gross_salary: salary,
      termination_date: form.termination_date || null,
      end_date: form.termination_date || null,
      is_active: form.status !== 'terminated',
    });
  };
  const inputClass = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        {(['first_name', 'last_name', 'national_id', 'tax_id', 'email', 'phone', 'department', 'job_title', 'bank_name', 'bank_account_number'] as const).map((key) => {
          const labels: Record<typeof key, string> = {
            first_name: t('payroll.firstName'), last_name: t('payroll.lastName'), national_id: t('payroll.nationalId'),
            tax_id: t('payroll.taxId'), email: t('payroll.email'), phone: t('payroll.phone'), department: t('payroll.department'),
            job_title: t('payroll.jobTitle'), bank_name: t('payroll.bankName'), bank_account_number: t('payroll.bankAccountNumber'),
          };
          return (
            <label key={key} className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700">{labels[key]}</span>
              <input type={key === 'email' ? 'email' : 'text'} value={form[key]} onChange={(event) => field(key, event.target.value)} className={inputClass} />
            </label>
          );
        })}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.grossSalary')}</span>
          <input type="number" min="0" step="0.01" required value={form.gross_salary} onChange={(event) => field('gross_salary', event.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.effectiveFrom')}</span>
          <input type="date" min={todayDate()} required value={form.contract_effective_from} onChange={(event) => field('contract_effective_from', event.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.employmentType')}</span>
          <select value={form.employment_type} onChange={(event) => field('employment_type', event.target.value)} className={inputClass}>
            <option value="permanent">{t('payroll.typePermanent')}</option>
            <option value="contract">{t('payroll.typeContract')}</option>
            <option value="casual">{t('payroll.typeCasual')}</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.payFrequency')}</span>
          <select value={form.pay_frequency} onChange={(event) => field('pay_frequency', event.target.value)} className={inputClass}>
            <option value="monthly">{t('payroll.frequencyMonthly')}</option>
            <option value="biweekly">{t('payroll.frequencyBiweekly')}</option>
            <option value="weekly">{t('payroll.frequencyWeekly')}</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.status')}</span>
          <select value={form.status} onChange={(event) => field('status', event.target.value)} className={inputClass}>
            <option value="active">{t('payroll.statusActive')}</option>
            <option value="on_leave">{t('payroll.statusOnLeave')}</option>
            <option value="terminated">{t('payroll.statusTerminated')}</option>
            <option value="suspended">{t('payroll.statusSuspended')}</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.terminationDate')}</span>
          <input type="date" value={form.termination_date} onChange={(event) => field('termination_date', event.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">{t('payroll.paymentMethod')}</span>
          <select value={form.payment_method} onChange={(event) => field('payment_method', event.target.value)} className={inputClass}>
            <option value="bank_transfer">{t('payroll.paymentBankTransfer')}</option>
            <option value="mobile_money">{t('payroll.paymentMobileMoney')}</option>
            <option value="cash">{t('payroll.paymentCash')}</option>
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t('payroll.cancel')}</Button>
        <Button type="submit" isLoading={isSaving}><Save className="h-4 w-4" aria-hidden="true" />{t('payroll.saveChanges')}</Button>
      </div>
    </form>
  );
}

interface OverrideDialogProps {
  components: Row[];
  currency: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (values: { componentId: string; amount: string; rate: string; from: string; to: string }) => void;
  t: (key: string) => string;
}

function OverrideDialog({ components, currency, isSaving, onClose, onSave, t }: OverrideDialogProps) {
  const [componentId, setComponentId] = useState(String(components[0]?.id ?? ''));
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [from, setFrom] = useState(todayDate());
  const [to, setTo] = useState('');
  const component = components.find((item) => String(item.id) === componentId);
  const basis = text(component?.calculation_basis, 'fixed');
  const amountEnabled = basis === 'fixed' || basis === 'overtime_multiplier';
  const rateEnabled = basis === 'percentage_of_gross';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ componentId, amount, rate, from, to });
  };
  const inputClass = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="override-dialog-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="override-dialog-title" className="text-lg font-semibold text-gray-900">{t('payroll.addPayComponentOverride')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('payroll.overrideDescription')}</p>
          </div>
          <Button variant="secondary" size="icon" onClick={onClose} aria-label={t('payroll.close')}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-gray-700">{t('payroll.payComponent')}</span>
            <select required value={componentId} onChange={(event) => setComponentId(event.target.value)} className={inputClass}>
              {components.map((item) => <option key={String(item.id)} value={String(item.id)}>{text(item.name)}</option>)}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700">{t('payroll.overrideAmount')} · {currency}</span>
              <input type="number" min="0" step="0.01" value={amount} disabled={!amountEnabled} required={amountEnabled} onChange={(event) => setAmount(event.target.value)} className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700">{t('payroll.overrideRatePercent')}</span>
              <input type="number" min="0" step="0.01" value={rate} disabled={!rateEnabled} required={rateEnabled} onChange={(event) => setRate(event.target.value)} className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700">{t('payroll.effectiveFrom')}</span>
              <input type="date" required value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700">{t('payroll.effectiveTo')}</span>
              <input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} className={inputClass} />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>{t('payroll.cancel')}</Button>
            <Button type="submit" isLoading={isSaving} disabled={!componentId}><Plus className="h-4 w-4" aria-hidden="true" />{t('payroll.addOverride')}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function OverviewTab({ employee, currency, locale, t }: { employee: Row; currency: string; locale: string; t: (key: string) => string }) {
  const contracts = asRows(employee.contracts).sort((a, b) => text(b.effective_from).localeCompare(text(a.effective_from)));
  const today = new Date();
  const currentContract = contracts.find((contract) => activeOnDate(contract, today)) ?? contracts[0];
  const status = text(employee.status, 'active');
  const salary = currentContract?.gross_salary ?? employee.gross_salary;
  const payFrequency = text(currentContract?.pay_frequency ?? employee.pay_frequency, 'monthly');
  const employmentType = text(currentContract?.contract_type ?? employee.employment_type, 'permanent');
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900">{t('payroll.personalDetails')}</h2>
        <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
          <DetailItem label={t('payroll.nationalId')} value={text(employee.national_id, '—')} />
          <DetailItem label={t('payroll.taxId')} value={text(employee.tax_id ?? employee.tpin, '—')} />
          <DetailItem label={t('payroll.email')} value={text(employee.email, '—')} />
          <DetailItem label={t('payroll.phone')} value={text(employee.phone, '—')} />
          <DetailItem label={t('payroll.bankName')} value={text(employee.bank_name, '—')} />
          <DetailItem label={t('payroll.bankAccountNumber')} value={text(employee.bank_account_number, '—')} />
          <DetailItem label={t('payroll.paymentMethod')} value={t(text(employee.payment_method) === 'mobile_money' ? 'payroll.paymentMobileMoney' : text(employee.payment_method) === 'cash' ? 'payroll.paymentCash' : 'payroll.paymentBankTransfer')} />
        </dl>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900">{t('payroll.employmentDetails')}</h2>
        <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
          <DetailItem label={t('payroll.department')} value={text(employee.department, '—')} />
          <DetailItem label={t('payroll.jobTitle')} value={text(employee.job_title, '—')} />
          <DetailItem label={t('payroll.hireDate')} value={formatDate(employee.hire_date ?? employee.start_date, locale)} />
          <DetailItem label={t('payroll.terminationDate')} value={formatDate(employee.termination_date ?? employee.end_date, locale)} />
          <DetailItem label={t('payroll.employmentType')} value={t(employmentType === 'contract' ? 'payroll.typeContract' : employmentType === 'casual' ? 'payroll.typeCasual' : 'payroll.typePermanent')} />
          <DetailItem label={t('payroll.payFrequency')} value={t(payFrequency === 'weekly' ? 'payroll.frequencyWeekly' : payFrequency === 'biweekly' ? 'payroll.frequencyBiweekly' : 'payroll.frequencyMonthly')} />
          <DetailItem label={t('payroll.grossSalary')} value={formatMoney(salary, currency, locale)} />
          <DetailItem label={t('payroll.currency')} value={currency} />
          <DetailItem label={t('payroll.status')} value={<span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[status] ?? statusTone.active}`}>{t(statusLabelKey(status))}</span>} />
        </dl>
      </section>
    </div>
  );
}

export function EmployeeDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'override' | 'accrued' | ''>('');
  const yearNow = new Date().getFullYear();
  const [leaveYear, setLeaveYear] = useState(yearNow);

  const employeeQuery = useQuery({
    queryKey: ['payroll-employee', businessId, id],
    enabled: Boolean(businessId && id),
    queryFn: () => repos.payrollFullCycle.getEmployee(businessId, id),
  });
  const componentsQuery = useQuery({
    queryKey: ['payroll-pay-components', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.payrollFullCycle.getPayComponents(businessId),
  });
  const leaveQuery = useQuery({
    queryKey: ['payroll-leave-balances', businessId, id, leaveYear],
    enabled: Boolean(businessId && id),
    queryFn: () => repos.payrollFullCycle.getLeaveBalances(businessId, id, leaveYear),
  });

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => repos.payrollFullCycle.updateEmployee(businessId, id, values),
    onSuccess: async () => {
      setEditing(false);
      setFeedback('saved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payroll-employee', businessId, id] }),
        queryClient.invalidateQueries({ queryKey: ['payroll-employees', businessId] }),
      ]);
    },
  });
  const overrideMutation = useMutation({
    mutationFn: (values: { componentId: string; amount: string; rate: string; from: string; to: string }) =>
      repos.payrollFullCycle.addPayComponentOverride(businessId, id, values.componentId, {
        override_amount: values.amount === '' ? null : Number(values.amount),
        override_rate: values.rate === '' ? null : Number(values.rate),
        effective_from: values.from,
        effective_to: values.to || null,
      }),
    onSuccess: async () => {
      setOverrideOpen(false);
      setFeedback('override');
      await queryClient.invalidateQueries({ queryKey: ['payroll-employee', businessId, id] });
    },
  });
  const accrueMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.accrueLeave(businessId, leaveYear, new Date().getMonth() + 1),
    onSuccess: async () => {
      setFeedback('accrued');
      await queryClient.invalidateQueries({ queryKey: ['payroll-leave-balances', businessId, id, leaveYear] });
    },
  });

  const employee = asRow(employeeQuery.data);
  const componentRows = Array.isArray(componentsQuery.data) ? componentsQuery.data : [];
  const overridableComponents = componentRows.filter((component) => text(component.calculation_basis) !== 'tax_table');
  const overrides = asRows(employee.components);
  const overridesByComponent = new Map<string, Row[]>();
  overrides.forEach((override) => {
    const componentId = String(override.pay_component_id ?? '');
    overridesByComponent.set(componentId, [...(overridesByComponent.get(componentId) ?? []), override]);
  });
  overridesByComponent.forEach((rows, key) => {
    overridesByComponent.set(key, rows.sort((a, b) => text(b.effective_from).localeCompare(text(a.effective_from))));
  });

  if (employeeQuery.isPending) return <main className="mx-auto max-w-7xl p-4 sm:p-6"><PageSkeleton /></main>;
  if (employeeQuery.isError || !employeeQuery.data) {
    return (
      <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <Button variant="secondary" onClick={() => navigate('/payroll/employees')}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('payroll.backToEmployees')}</Button>
        <EmptyState title={t('payroll.employeeNotFound')} description={t('payroll.employeeNotFoundDescription')} />
      </main>
    );
  }

  const fullName = employeeDisplayName(employee);
  const status = text(employee.status, 'active');
  const employeeOverrides = (componentId: string) => {
    const rows = overridesByComponent.get(componentId) ?? [];
    return rows.find((override) => activeOnDate(override)) ?? rows[0];
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('payroll.overviewTab') },
    { id: 'components', label: t('payroll.payComponentsTab') },
    { id: 'leave', label: t('payroll.leaveBalanceTab') },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="space-y-4">
        <Button variant="secondary" size="sm" onClick={() => navigate('/payroll/employees')}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('payroll.backToEmployees')}</Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{fullName || t('payroll.employee')}</h1>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[status] ?? statusTone.active}`}>{t(statusLabelKey(status))}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{t('payroll.employeeNumber')}: {text(employee.employee_number, '—')} · {text(employee.job_title, t('payroll.noJobTitle'))}</p>
          </div>
          {tab === 'overview' && !editing && (
            <Button variant="secondary" onClick={() => { setFeedback(''); setEditing(true); }}><Pencil className="h-4 w-4" aria-hidden="true" />{t('payroll.editEmployee')}</Button>
          )}
        </div>
      </header>

      {(feedback || updateMutation.isError || overrideMutation.isError || accrueMutation.isError) && (
        <p role={feedback ? 'status' : 'alert'} className={`rounded-lg p-3 text-sm ${feedback ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
          {feedback === 'saved' ? t('payroll.employeeUpdated')
            : feedback === 'override' ? t('payroll.overrideAdded')
              : feedback === 'accrued' ? t('payroll.leaveAccrualComplete')
                : updateMutation.isError ? t('payroll.employeeUpdateFailed')
                  : overrideMutation.isError ? t('payroll.overrideFailed') : t('payroll.leaveAccrualFailed')}
        </p>
      )}

      <div role="tablist" aria-label={t('payroll.employeeDetailTabs')} className="flex overflow-x-auto border-b border-gray-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => { setTab(item.id); setEditing(false); setFeedback(''); }}
            className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tab === item.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >{item.label}</button>
        ))}
      </div>

      <section role="tabpanel" className="space-y-5">
        {tab === 'overview' && (editing ? (
          <EditEmployeeForm
            key={String(employee.id)}
            employee={employee}
            t={t}
            isSaving={updateMutation.isPending}
            onCancel={() => { setEditing(false); updateMutation.reset(); }}
            onSave={(values) => { setFeedback(''); updateMutation.mutate(values); }}
          />
        ) : <OverviewTab employee={employee} currency={currency} locale={i18n.language} t={t} />)}

        {tab === 'components' && (
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 p-5">
              <div>
                <h2 className="font-semibold text-gray-900">{t('payroll.payComponentsTab')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('payroll.employeePayComponentsDescription')}</p>
              </div>
              <Button onClick={() => { setFeedback(''); setOverrideOpen(true); }} disabled={componentsQuery.isPending || overridableComponents.length === 0}>
                <Plus className="h-4 w-4" aria-hidden="true" />{t('payroll.addOverride')}
              </Button>
            </div>
            {componentsQuery.isError && <p role="alert" className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.payComponentsLoadFailed')}</p>}
            {componentsQuery.isPending ? <div className="p-5"><PageSkeleton /></div> : componentRows.length === 0 ? (
              <div className="p-4"><EmptyState title={t('payroll.noPayComponents')} description={t('payroll.noPayComponentsDescription')} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-3">{t('payroll.payComponent')}</th>
                      <th scope="col" className="px-4 py-3">{t('payroll.componentType')}</th>
                      <th scope="col" className="px-4 py-3">{t('payroll.calculationBasis')}</th>
                      <th scope="col" className="px-4 py-3">{t('payroll.defaultValue')}</th>
                      <th scope="col" className="px-4 py-3">{t('payroll.employeeOverride')}</th>
                      <th scope="col" className="px-4 py-3">{t('payroll.effectiveDates')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {componentRows.map((component) => {
                      const componentId = String(component.id ?? '');
                      const override = employeeOverrides(componentId);
                      const basis = text(component.calculation_basis, 'fixed');
                      const basisKey = basis === 'percentage_of_gross' ? 'basisPercentageOfGross'
                        : basis === 'tax_table' ? 'basisTaxTable'
                          : basis === 'overtime_multiplier' ? 'basisOvertimeMultiplier' : 'basisFixed';
                      const defaultValue = basis === 'percentage_of_gross'
                        ? `${numeric(component.default_rate)}%` : formatMoney(component.default_amount, currency, i18n.language);
                      const overrideValue = override
                        ? basis === 'percentage_of_gross' && override.override_rate != null
                          ? `${numeric(override.override_rate)}%`
                          : override.override_amount != null ? formatMoney(override.override_amount, currency, i18n.language) : '—'
                        : '—';
                      return (
                        <tr key={componentId}>
                          <td className="whitespace-nowrap px-4 py-3.5 font-medium text-gray-900">{text(component.name)}</td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{t(text(component.component_type) === 'deduction' ? 'payroll.componentTypeDeduction' : 'payroll.componentTypeEarning')}</td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{t(`payroll.${basisKey}`)}</td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{defaultValue}</td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{overrideValue}</td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">
                            {override ? `${formatDate(override.effective_from, i18n.language)} – ${formatDate(override.effective_to, i18n.language)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'leave' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  {t('payroll.leaveYear')}
                  <select value={leaveYear} onChange={(event) => setLeaveYear(Number(event.target.value))} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                    {[yearNow - 1, yearNow, yearNow + 1].map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                <p className="text-xs text-gray-500">{t('payroll.leaveAccrualScope')}</p>
              </div>
              <Button onClick={() => { setFeedback(''); accrueMutation.mutate(); }} isLoading={accrueMutation.isPending}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />{t('payroll.accrueLeave')}
              </Button>
            </div>
            {leaveQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.leaveBalanceLoadFailed')}</p>}
            {leaveQuery.isPending ? <PageSkeleton /> : (Array.isArray(leaveQuery.data) ? leaveQuery.data.length : 0) === 0 ? (
              <EmptyState title={t('payroll.noLeaveBalances')} description={t('payroll.noLeaveBalancesDescription')} variant="finance" />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(Array.isArray(leaveQuery.data) ? leaveQuery.data : []).map((balance) => {
                  const leaveType = asRow(balance.leave_type);
                  const entitled = numeric(balance.entitled_days);
                  const used = numeric(balance.used_days);
                  const remaining = entitled - used;
                  const percentage = entitled > 0 ? Math.min(100, Math.max(0, (used / entitled) * 100)) : 0;
                  return (
                    <article key={String(balance.id ?? `${balance.leave_type_id}-${balance.year}`)} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-gray-900">{text(leaveType.name, text(leaveType.code, t('payroll.leaveType')))}</h3>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{Number(balance.year ?? leaveYear)}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center justify-between text-sm"><span className="text-gray-600">{t('payroll.entitled')}</span><span className="font-medium text-gray-900">{entitled} {t('payroll.days')}</span></div>
                        <div className="flex items-center justify-between text-sm"><span className="text-gray-600">{t('payroll.used')}</span><span className="font-medium text-gray-900">{used} {t('payroll.days')}</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label={t('payroll.leaveUsedProgress', { type: text(leaveType.name, t('payroll.leaveType')) })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)}>
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${percentage}%` }} />
                        </div>
                        <div className="flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
                          <span className="font-medium text-gray-700">{t('payroll.remaining')}</span>
                          <span className="font-semibold text-gray-900">{remaining} {t('payroll.days')}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </section>

      {overrideOpen && (
        <OverrideDialog
          components={overridableComponents}
          currency={currency}
          isSaving={overrideMutation.isPending}
          onClose={() => { setOverrideOpen(false); overrideMutation.reset(); }}
          onSave={(values) => { setFeedback(''); overrideMutation.mutate(values); }}
          t={t}
        />
      )}
    </main>
  );
}
