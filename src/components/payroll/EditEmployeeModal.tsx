import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, X, CheckCircle, AlertCircle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type { Row, UpdateDto } from '@/dal/types/database';

interface Alert { type: 'success' | 'error'; message: string; }

function AlertBox({ alert }: { alert: Alert }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
      {alert.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {alert.message}
    </div>
  );
}

interface EditEmployeeModalProps {
  employee: Row<'employees'>;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditEmployeeModal({ employee, onClose, onSuccess }: EditEmployeeModalProps) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [form, setForm] = useState({
    first_name: employee.first_name,
    last_name: employee.last_name,
    employee_number: employee.employee_number,
    job_title: employee.job_title ?? '',
    employment_type: employee.employment_type,
    pay_frequency: employee.pay_frequency,
    gross_salary: String(employee.gross_salary),
    payment_method: employee.payment_method,
    bank_name: employee.bank_name ?? '',
    bank_account_number: employee.bank_account_number ?? '',
    mobile_money_type: employee.mobile_money_type ?? '',
    mobile_money_number: employee.mobile_money_number ?? '',
    national_id: employee.national_id ?? '',
    tpin: employee.tpin ?? '',
    is_active: employee.is_active,
  });

  const salaryChanged = parseFloat(form.gross_salary) !== Number(employee.gross_salary);

  function set<K extends keyof typeof form>(field: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.first_name.trim()) throw new Error('First name is required');
      if (!form.last_name.trim()) throw new Error('Last name is required');
      if (!form.employee_number.trim()) throw new Error('Employee number is required');
      const salary = parseFloat(form.gross_salary);
      if (isNaN(salary) || salary < 0) throw new Error('Enter a valid gross salary');

      const dto: UpdateDto<'employees'> = {
        first_name: form.first_name,
        last_name: form.last_name,
        employee_number: form.employee_number,
        job_title: form.job_title || null,
        employment_type: form.employment_type,
        pay_frequency: form.pay_frequency,
        gross_salary: salary,
        payment_method: form.payment_method as never,
        bank_name: form.bank_name || null,
        bank_account_number: form.bank_account_number || null,
        mobile_money_type: form.mobile_money_type || null,
        mobile_money_number: form.mobile_money_number || null,
        national_id: form.national_id || null,
        tpin: form.tpin || null,
        is_active: form.is_active,
      } as never;

      return repos.payroll.updateEmployee(employee.id, dto);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Employee updated successfully.' });
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
            <h2 className="text-base font-semibold text-gray-900">Edit Employee</h2>
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
              <input type="text" value={form.employee_number} onChange={(e) => set('employee_number', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Job Title</label>
              <input type="text" value={form.job_title} onChange={(e) => set('job_title', e.target.value)}
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
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Gross Monthly Salary (MWK)
                {salaryChanged && (
                  <span className="ml-1.5 text-xs font-normal text-amber-600">
                    was {Number(employee.gross_salary).toLocaleString('en-MW', { minimumFractionDigits: 2 })}
                  </span>
                )}
              </label>
              <input type="number" min="0" step="0.01" value={form.gross_salary} onChange={(e) => set('gross_salary', e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${salaryChanged ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500' : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500'}`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Payment Method</label>
              <select value={form.payment_method} onChange={(e) =>
                 set('payment_method', e.target.value as typeof form.payment_method)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="bank_transfer">Bank Transfer</option>
                <option value="airtel_money">Airtel Money</option>
                <option value="tnm_mpamba">TNM Mpamba</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                Active
              </label>
            </div>
          </div>

          {form.payment_method === 'bank_transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Bank Name</label>
                <input type="text" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Account Number</label>
                <input type="text" value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          {(
            form.payment_method === 'airtel_money' ||
            form.payment_method === 'tnm_mpamba'
          ) && (
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
                <input type="text" value={form.mobile_money_number} onChange={(e) => set('mobile_money_number', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">National ID</label>
              <input type="text" value={form.national_id} onChange={(e) => set('national_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">TPIN</label>
              <input type="text" value={form.tpin} onChange={(e) => set('tpin', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          {salaryChanged && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              This salary change will be recorded in the audit log automatically.
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}