import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { text, todayDate } from './employeeUtils';

interface EmployeeForm {
  first_name: string;
  last_name: string;
  national_id: string;
  tax_id: string;
  email: string;
  phone: string;
  department: string;
  job_title: string;
  hire_date: string;
  termination_date: string;
  employment_type: 'permanent' | 'contract' | 'casual';
  pay_frequency: 'monthly' | 'biweekly' | 'weekly';
  gross_salary: string;
  status: 'active' | 'on_leave' | 'terminated' | 'suspended';
  bank_name: string;
  bank_account_number: string;
  payment_method: 'bank_transfer' | 'mobile_money' | 'cash';
}

const initialForm: EmployeeForm = {
  first_name: '', last_name: '', national_id: '', tax_id: '', email: '', phone: '',
  department: '', job_title: '', hire_date: todayDate(), termination_date: '',
  employment_type: 'permanent', pay_frequency: 'monthly', gross_salary: '', status: 'active',
  bank_name: '', bank_account_number: '', payment_method: 'bank_transfer',
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  min?: string;
  step?: string;
  autoComplete?: string;
}

function TextField({ label, value, onChange, required, type = 'text', min, step, autoComplete }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}{required && <span className="ml-1 text-red-600" aria-hidden="true">*</span>}</span>
      <input
        type={type}
        value={value}
        required={required}
        min={min}
        step={step}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

function SelectField({ label, value, onChange, children }: SelectFieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
        {children}
      </select>
    </label>
  );
}

export function EmployeeNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [form, setForm] = useState<EmployeeForm>(initialForm);
  const [validationError, setValidationError] = useState('');
  const update = <K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const createMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.createEmployee(businessId, {
      ...form,
      gross_salary: Number(form.gross_salary),
      currency,
      is_active: form.status !== 'terminated',
      start_date: form.hire_date,
      hire_date: form.hire_date,
      termination_date: form.termination_date || null,
    }),
    onSuccess: async (employee) => {
      await queryClient.invalidateQueries({ queryKey: ['payroll-employees', businessId] });
      const id = text(employee.id);
      if (id) navigate(`/payroll/employees/${encodeURIComponent(id)}`, { replace: true });
      else navigate('/payroll/employees', { replace: true });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');
    const salary = Number(form.gross_salary);
    if (!form.hire_date || !form.gross_salary.trim() || !Number.isFinite(salary) || salary < 0) {
      setValidationError(t('payroll.employeeRequiredFields'));
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setValidationError(t('payroll.employeeEmailInvalid'));
      return;
    }
    if (form.termination_date && form.termination_date < form.hire_date) {
      setValidationError(t('payroll.employeeDateRangeInvalid'));
      return;
    }
    createMutation.mutate();
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex items-start gap-3">
        <Button variant="secondary" size="icon" onClick={() => navigate('/payroll/employees')} aria-label={t('payroll.backToEmployees')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('payroll.addEmployee')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('payroll.newEmployeeDescription')}</p>
        </div>
      </header>

      {(validationError || createMutation.isError) && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {validationError || t('payroll.employeeSaveFailed')}
        </p>
      )}

      <form onSubmit={submit} className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-gray-100 pb-3">
            <h2 className="font-semibold text-gray-900">{t('payroll.personalDetails')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('payroll.personalDetailsDescription')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('payroll.firstName')} value={form.first_name} required autoComplete="given-name" onChange={(value) => update('first_name', value)} />
            <TextField label={t('payroll.lastName')} value={form.last_name} required autoComplete="family-name" onChange={(value) => update('last_name', value)} />
            <TextField label={t('payroll.nationalId')} value={form.national_id} onChange={(value) => update('national_id', value)} />
            <TextField label={t('payroll.taxId')} value={form.tax_id} onChange={(value) => update('tax_id', value)} />
            <TextField label={t('payroll.email')} value={form.email} type="email" autoComplete="email" onChange={(value) => update('email', value)} />
            <TextField label={t('payroll.phone')} value={form.phone} type="tel" autoComplete="tel" onChange={(value) => update('phone', value)} />
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-gray-100 pb-3">
            <h2 className="font-semibold text-gray-900">{t('payroll.employmentDetails')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('payroll.employmentDetailsDescription')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('payroll.department')} value={form.department} onChange={(value) => update('department', value)} />
            <TextField label={t('payroll.jobTitle')} value={form.job_title} onChange={(value) => update('job_title', value)} />
            <TextField label={t('payroll.hireDate')} value={form.hire_date} required type="date" onChange={(value) => update('hire_date', value)} />
            <TextField label={t('payroll.terminationDate')} value={form.termination_date} type="date" onChange={(value) => update('termination_date', value)} />
            <SelectField label={t('payroll.employmentType')} value={form.employment_type} onChange={(value) => update('employment_type', value as EmployeeForm['employment_type'])}>
              <option value="permanent">{t('payroll.typePermanent')}</option>
              <option value="contract">{t('payroll.typeContract')}</option>
              <option value="casual">{t('payroll.typeCasual')}</option>
            </SelectField>
            <SelectField label={t('payroll.payFrequency')} value={form.pay_frequency} onChange={(value) => update('pay_frequency', value as EmployeeForm['pay_frequency'])}>
              <option value="monthly">{t('payroll.frequencyMonthly')}</option>
              <option value="biweekly">{t('payroll.frequencyBiweekly')}</option>
              <option value="weekly">{t('payroll.frequencyWeekly')}</option>
            </SelectField>
            <SelectField label={t('payroll.status')} value={form.status} onChange={(value) => update('status', value as EmployeeForm['status'])}>
              <option value="active">{t('payroll.statusActive')}</option>
              <option value="on_leave">{t('payroll.statusOnLeave')}</option>
              <option value="terminated">{t('payroll.statusTerminated')}</option>
              <option value="suspended">{t('payroll.statusSuspended')}</option>
            </SelectField>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-gray-100 pb-3">
            <h2 className="font-semibold text-gray-900">{t('payroll.compensationDetails')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('payroll.compensationDetailsDescription')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('payroll.grossSalary')} value={form.gross_salary} required type="number" min="0" step="0.01" onChange={(value) => update('gross_salary', value)} />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-gray-700">{t('payroll.currency')}</span>
              <input value={currency} readOnly aria-readonly="true" className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700" />
              <span className="block text-xs text-gray-500">{t('payroll.functionalCurrencyOnly')}</span>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-gray-100 pb-3">
            <h2 className="font-semibold text-gray-900">{t('payroll.bankDetails')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('payroll.bankDetailsDescription')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('payroll.bankName')} value={form.bank_name} autoComplete="organization" onChange={(value) => update('bank_name', value)} />
            <TextField label={t('payroll.bankAccountNumber')} value={form.bank_account_number} autoComplete="off" onChange={(value) => update('bank_account_number', value)} />
            <SelectField label={t('payroll.paymentMethod')} value={form.payment_method} onChange={(value) => update('payment_method', value as EmployeeForm['payment_method'])}>
              <option value="bank_transfer">{t('payroll.paymentBankTransfer')}</option>
              <option value="mobile_money">{t('payroll.paymentMobileMoney')}</option>
              <option value="cash">{t('payroll.paymentCash')}</option>
            </SelectField>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => navigate('/payroll/employees')}>{t('payroll.cancel')}</Button>
          <Button type="submit" isLoading={createMutation.isPending} disabled={!businessId}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {t('payroll.saveEmployee')}
          </Button>
        </div>
      </form>
    </main>
  );
}
