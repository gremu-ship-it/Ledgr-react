import { currentFiscalYear } from '@/lib/fiscalYear';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, AlertCircle, CheckCircle,
  X, Percent, Calculator, CalendarClock, Archive,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto, TaxCode } from '@/dal/types/database';
import { TaxObligationsTab } from '@/components/tax/TaxObligationsTab';
import { TaxFilingHistoryTab } from '@/components/tax/TaxFilingHistoryTab';
import { useBusinessJurisdiction } from '@/hooks/useTaxObligations';
import { getJurisdictionRules, defaultVatRate } from '@/lib/taxRules';

// ── Constants ─────────────────────────────────────────────────────────────────

const TAX_CODES: { value: TaxCode; label: string }[] = [
  { value: 'vat_standard', label: 'VAT Standard' },
  { value: 'vat_zero',     label: 'VAT Zero Rated (0%)' },
  { value: 'vat_exempt',   label: 'VAT Exempt' },
  { value: 'wht_10',       label: 'WHT 10%' },
  { value: 'wht_15',       label: 'WHT 15%' },
  { value: 'wht_20',       label: 'WHT 20%' },
  { value: 'paye',         label: 'PAYE' },
  { value: 'tpr_pension',  label: 'Pension (employer / employee split)' },
  { value: 'cit',          label: 'Corporate Income Tax' },
  { value: 'fbt',          label: 'Fringe Benefits Tax' },
  { value: 'none',         label: 'None / Not Applicable' },
];

/** Accounts a tax liability or credit can be posted to. */
function useLedgerAccounts(businessId: string) {
  return useQuery({
    queryKey: ['accounts', 'postable', businessId],
    queryFn: async () => {
      const { data, error } = await repos.account.db
        .from('accounts')
        .select('id, code, name, account_type')
        .eq('business_id', businessId)
        .eq('is_group', false)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
// ── Alert ─────────────────────────────────────────────────────────────────────

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

// ── Tax Config Modal ──────────────────────────────────────────────────────────

interface TaxConfigForm {
  tax_code: TaxCode;
  name: string;
  rate: string;
  employer_rate: string;
  employee_rate: string;
  description: string;
  mra_reference: string;
  effective_from: string;
  effective_to: string;
  is_active: boolean;
  tax_payable_account_id: string;
  tax_receivable_account_id: string;
}

function TaxConfigModal({
  existing, businessId, onClose,
}: {
  existing?: Row<'tax_configurations'>;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useLedgerAccounts(businessId);
  const [form, setForm] = useState<TaxConfigForm>(
    existing ? {
      tax_code: existing.tax_code as TaxCode,
      name: existing.name ?? '',
      rate: String(existing.rate ?? ''),
      employer_rate: existing.employer_rate != null ? String(existing.employer_rate) : '',
      employee_rate: existing.employee_rate != null ? String(existing.employee_rate) : '',
      description: existing.description ?? '',
      mra_reference: existing.mra_reference ?? '',
      effective_from: existing.effective_from ?? today(),
      effective_to: existing.effective_to ?? '',
      is_active: existing.is_active ?? true,
      tax_payable_account_id: existing.tax_payable_account_id ?? '',
      tax_receivable_account_id: existing.tax_receivable_account_id ?? '',
    } : {
      tax_code: 'vat_standard',
      name: '',
      rate: '',
      employer_rate: '',
      employee_rate: '',
      description: '',
      mra_reference: '',
      effective_from: today(),
      effective_to: '',
      is_active: true,
      tax_payable_account_id: '',
      tax_receivable_account_id: '',
    },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isPension = form.tax_code === 'tpr_pension';
  const isVat = form.tax_code.startsWith('vat');

  function set(field: keyof TaxConfigForm, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');

      let rate = 0;
      let employerRate: number | null = null;
      let employeeRate: number | null = null;

      if (isPension) {
        employerRate = parseFloat(form.employer_rate);
        employeeRate = parseFloat(form.employee_rate);
        if (isNaN(employerRate) || employerRate < 0) throw new Error('Enter a valid employer rate');
        if (isNaN(employeeRate) || employeeRate < 0) throw new Error('Enter a valid employee rate');
      } else {
        rate = parseFloat(form.rate);
        if (isNaN(rate) || rate < 0) throw new Error('Enter a valid rate');
      }

      const payload: InsertDto<'tax_configurations'> = {
        business_id: businessId,
        tax_code: form.tax_code,
        name: form.name.trim(),
        rate,
        employer_rate: employerRate,
        employee_rate: employeeRate,
        description: form.description || null,
        mra_reference: form.mra_reference || null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        is_active: form.is_active,
        tax_payable_account_id: form.tax_payable_account_id || null,
        tax_receivable_account_id: form.tax_receivable_account_id || null,
      };

      if (existing) {
        const { error } = await repos.tax['client']
          .from('tax_configurations').update(payload as never).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await repos.tax['client']
          .from('tax_configurations').insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_configs'] });
      queryClient.invalidateQueries({ queryKey: ['tax_configurations'] });
      setAlert({ type: 'success', message: existing ? 'Tax config updated.' : 'Tax config created.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{existing ? 'Edit Tax Configuration' : 'New Tax Configuration'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Tax Code *</label>
              <select value={form.tax_code} onChange={(e) => set('tax_code', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {TAX_CODES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {isPension ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Employer Rate (%) *</label>
                  <input type="number" min="0" max="100" step="0.01" value={form.employer_rate}
                    onChange={(e) => set('employer_rate', e.target.value)} placeholder="e.g. 10"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Employee Rate (%) *</label>
                  <input type="number" min="0" max="100" step="0.01" value={form.employee_rate}
                    onChange={(e) => set('employee_rate', e.target.value)} placeholder="e.g. 5"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <p className="col-span-2 text-xs text-gray-500">
                  TPR pension uses two separate rates (employer contribution and employee deduction) instead of a single rate.
                </p>
              </>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Rate (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={form.rate}
                  onChange={(e) => set('rate', e.target.value)} placeholder="e.g. 17.5"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            )}

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Standard VAT"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Description (optional)</label>
              <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)}
                placeholder="e.g. Standard rate VAT per MRA regulations"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">MRA Reference (optional)</label>
              <input type="text" value={form.mra_reference} onChange={(e) => set('mra_reference', e.target.value)}
                placeholder="e.g. VAT/2024/001"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="is_active" checked={form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
              <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Effective From *</label>
              <input type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Effective To (optional)</label>
              <input type="date" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            {/* Ledger links. Without a payable account, payroll approval and
                period-close journal posting both fail with a hard error. */}
            <div className="col-span-2 border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">Ledger accounts</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Required before this tax can be posted to the journal or paid.
              </p>
            </div>

            <div className="col-span-2">
              <label htmlFor="tc-payable" className="mb-1 block text-sm font-medium text-gray-700">
                Tax payable account {isPension || form.tax_code === 'paye' ? '*' : ''}
              </label>
              <select id="tc-payable" value={form.tax_payable_account_id}
                onChange={(e) => set('tax_payable_account_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Not linked</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {isPension
                  ? 'Usually 2132 Pension Payable.'
                  : form.tax_code === 'paye'
                  ? 'Usually 2122 PAYE Payable.'
                  : isVat
                  ? 'Usually 2121 VAT Payable (Output Tax).'
                  : 'The liability account this tax accrues to.'}
              </p>
            </div>

            {isVat && (
              <div className="col-span-2">
                <label htmlFor="tc-receivable" className="mb-1 block text-sm font-medium text-gray-700">
                  Tax receivable account
                </label>
                <select id="tc-receivable" value={form.tax_receivable_account_id}
                  onChange={(e) => set('tax_receivable_account_id', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                  <option value="">Not linked</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Usually 1135 VAT Receivable (Input Tax). Needed to clear input tax at period close.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PAYE Band Modal ───────────────────────────────────────────────────────────

interface PayeBandForm {
  fiscal_year: string;
  band_from: string;
  band_to: string;
  rate: string;
  band_label: string;
  effective_from: string;
  effective_to: string;
}

function PayeBandModal({
  existing, businessId, onClose,
}: {
  existing?: Row<'paye_bands'>;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PayeBandForm>(
    existing ? {
      fiscal_year: existing.fiscal_year ?? currentFiscalYear(),
      band_from: String(existing.band_from ?? ''),
      band_to: existing.band_to != null ? String(existing.band_to) : '',
      rate: String(existing.rate ?? ''),
      band_label: existing.band_label ?? '',
      effective_from: existing.effective_from ?? today(),
      effective_to: existing.effective_to ?? '',
    } : {
      fiscal_year: currentFiscalYear(),
      band_from: '',
      band_to: '',
      rate: '',
      band_label: '',
      effective_from: today(),
      effective_to: '',
    },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof PayeBandForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const bandFrom = parseFloat(form.band_from);
      const rate = parseFloat(form.rate);
      if (isNaN(bandFrom)) throw new Error('Band from is required');
      if (isNaN(rate) || rate < 0) throw new Error('Enter a valid rate');
      if (!form.fiscal_year.trim()) throw new Error('Fiscal year is required');

      const payload: InsertDto<'paye_bands'> = {
        business_id: businessId,
        fiscal_year: form.fiscal_year.trim(),
        band_from: bandFrom,
        band_to: form.band_to ? parseFloat(form.band_to) : null,
        rate,
        band_label: form.band_label || null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
      };

      if (existing) {
        const { error } = await repos.tax['client']
          .from('paye_bands').update(payload as never).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await repos.tax['client']
          .from('paye_bands').insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paye_bands'] });
      setAlert({ type: 'success', message: existing ? 'Band updated.' : 'Band created.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{existing ? 'Edit PAYE Band' : 'New PAYE Band'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fiscal Year *</label>
              <input type="text" value={form.fiscal_year} onChange={(e) => set('fiscal_year', e.target.value)}
                placeholder="e.g. 2024/2025"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Band Label (optional)</label>
              <input type="text" value={form.band_label} onChange={(e) => set('band_label', e.target.value)}
                placeholder="e.g. First Band"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Band From (MWK) *</label>
              <input type="number" min="0" value={form.band_from} onChange={(e) => set('band_from', e.target.value)}
                placeholder="e.g. 0"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Band To (MWK, blank = no limit)</label>
              <input type="number" min="0" value={form.band_to} onChange={(e) => set('band_to', e.target.value)}
                placeholder="Leave blank for top band"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Rate (%) *</label>
              <input type="number" min="0" max="100" step="0.01" value={form.rate}
                onChange={(e) => set('rate', e.target.value)} placeholder="e.g. 15"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Effective From *</label>
              <input type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Effective To (optional)</label>
              <input type="date" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create Band'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ label, onConfirm, onCancel, isPending }: {
  label: string; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Delete?</h3>
        <p className="mt-2 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{label}</span> will be removed permanently.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tax Configurations Tab ────────────────────────────────────────────────────

function TaxConfigsTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'tax_configurations'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'tax_configurations'> | undefined>();

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['tax_configs', businessId],
    queryFn: () => repos.tax.findActiveByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await repos.tax['client']
        .from('tax_configurations').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_configs'] });
      setDeleting(undefined);
    },
  });

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          <Plus className="h-4 w-4" />New Tax Config
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : configs.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <Percent className="h-7 w-7 text-brand-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">No tax configurations yet</h2>
          <button onClick={() => { setEditing(undefined); setShowModal(true); }}
            className="mt-1 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />New Tax Config
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Tax Code</th>
                <th scope="col" className="px-4 py-3 text-left">Name</th>
                <th scope="col" className="px-4 py-3 text-right">Rate</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">MRA Reference</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Effective From</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Effective To</th>
                <th scope="col" className="px-4 py-3 text-center">Status</th>
                <th scope="col" className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configs.map((cfg) => (
                <tr key={cfg.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      {cfg.tax_code}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{cfg.name}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {cfg.tax_code === 'tpr_pension'
                      ? `${Number(cfg.employer_rate ?? 0).toFixed(1)}% / ${Number(cfg.employee_rate ?? 0).toFixed(1)}%`
                      : `${Number(cfg.rate).toFixed(2)}%`}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{cfg.mra_reference ?? '—'}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{cfg.effective_from}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{cfg.effective_to ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      cfg.is_active ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {cfg.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => { setEditing(cfg); setShowModal(true); }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleting(cfg)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TaxConfigModal
          existing={editing}
          businessId={businessId}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          label={deleting.name}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ── PAYE Bands Tab ────────────────────────────────────────────────────────────

function PayeBandsTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear());
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'paye_bands'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'paye_bands'> | undefined>();

  const { data: bands = [], isLoading } = useQuery({
    queryKey: ['paye_bands', businessId, fiscalYear],
    queryFn: () => repos.tax.findPayeBands(businessId, fiscalYear),
    enabled: Boolean(businessId) && Boolean(fiscalYear),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await repos.tax['client']
        .from('paye_bands').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paye_bands'] });
      setDeleting(undefined);
    },
  });

  function formatMwk(n: number) {
    return `MK ${n.toLocaleString('en-MW', { minimumFractionDigits: 2 })}`;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Fiscal Year:</label>
          <input type="text" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}
            placeholder="e.g. 2024/2025"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-36" />
        </div>
        <button onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          <Plus className="h-4 w-4" />Add Band
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : bands.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <Calculator className="h-7 w-7 text-brand-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">No PAYE bands for {fiscalYear}</h2>
          <p className="max-w-xs text-sm text-gray-500">Add MRA PAYE bands for this fiscal year to enable automatic payroll tax calculation.</p>
          <button onClick={() => { setEditing(undefined); setShowModal(true); }}
            className="mt-1 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />Add Band
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Label</th>
                <th scope="col" className="px-4 py-3 text-right">From (MWK)</th>
                <th scope="col" className="px-4 py-3 text-right">To (MWK)</th>
                <th scope="col" className="px-4 py-3 text-right">Rate</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Effective From</th>
                <th scope="col" className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bands.map((band) => (
                <tr key={band.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{band.band_label ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{formatMwk(Number(band.band_from))}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {band.band_to != null ? formatMwk(Number(band.band_to)) : 'No limit'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{Number(band.rate).toFixed(1)}%</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{band.effective_from}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => { setEditing(band); setShowModal(true); }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleting(band)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <PayeBandModal
          existing={editing}
          businessId={businessId}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          label={deleting.band_label ?? `Band from MK ${deleting.band_from}`}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = 'obligations' | 'history' | 'configs' | 'paye';

const TABS: { key: TabKey; label: string; icon: typeof Percent }[] = [
  { key: 'obligations', label: 'Obligations',        icon: CalendarClock },
  { key: 'history',     label: 'Filing History',     icon: Archive },
  { key: 'configs',     label: 'Tax Configurations', icon: Percent },
  { key: 'paye',        label: 'PAYE Bands',         icon: Calculator },
];

export function TaxPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const jurisdiction = useBusinessJurisdiction();
  const [tab, setTab] = useState<TabKey>('obligations');

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  const rules = getJurisdictionRules(jurisdiction);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tax</h1>
          <p className="mt-1 text-sm text-gray-500">
            {rules.authorityName} compliance for {currentBusiness.business.name}
          </p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
          {rules.name} · {rules.authority} · VAT {defaultVatRate(jurisdiction)}%
        </span>
      </div>

      <div className="mb-6 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {tab === 'obligations' && <TaxObligationsTab businessId={businessId} />}
      {tab === 'history' && <TaxFilingHistoryTab businessId={businessId} />}
      {tab === 'configs' && <TaxConfigsTab businessId={businessId} />}
      {tab === 'paye' && <PayeBandsTab businessId={businessId} />}
    </div>
  );
}
