import { currentFiscalYear } from '@/lib/fiscalYear';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, AlertCircle, CheckCircle,
  X, Percent, Calculator, AlertTriangle, CalendarClock,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto, TaxCode } from '@/dal/types/database';
import {
  NO_ROW_CHANGED_MESSAGE,
  describePeriodCoverage,
  describeTaxConfigurationFailure,
  explainTaxRateResolution,
  formatRatePercent,
  resolveTaxRate,
  supportedRateFor,
  type PeriodCoverage,
  type TaxConfigurationFailure,
} from '@/lib/tax/taxConfiguration';
import {
  VAT_STANDARD_RATE_EFFECTIVE_FROM,
  VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
  VAT_STANDARD_RATE_PERCENT,
  VAT_STANDARD_RATE_PREVIOUS_PERCENT,
} from '@/lib/vat';

// ── Constants ─────────────────────────────────────────────────────────────────

const TAX_CODES: { value: TaxCode; label: string }[] = [
  { value: 'vat_standard', label: 'VAT Standard (17.5%)' },
  { value: 'vat_zero',     label: 'VAT Zero Rated (0%)' },
  { value: 'vat_exempt',   label: 'VAT Exempt' },
  { value: 'wht_10',       label: 'WHT 10%' },
  { value: 'wht_15',       label: 'WHT 15%' },
  { value: 'wht_20',       label: 'WHT 20%' },
  { value: 'paye',         label: 'PAYE' },
  { value: 'tpr_pension',  label: 'TPR Pension (10% employer / 5% employee)' },
  { value: 'cit',          label: 'Corporate Income Tax' },
  { value: 'fbt',          label: 'Fringe Benefits Tax' },
  { value: 'none',         label: 'None / Not Applicable' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Form-side mirrors of the database checks added by
 * 20261022000000_effective_dated_tax_configurations.sql. They catch the mistake
 * before the round trip; the server remains the authority, and its own wording is
 * shown when it refuses. Rates are stored as percentages (17.5, 10, 30).
 */
const RATE_RANGE_MESSAGE = 'Enter a rate between 0 and 100 as a percentage (for example 17.5).';
const EVIDENCE_REQUIRED_MESSAGE =
  'A rate above 0% must record the reference it relies on — enter the Act, gazette notice or MRA reference.';
const PERIOD_ORDER_MESSAGE = 'The end date must be after the start date. Leave it empty for an open-ended period.';

/** True when a stored configuration charges anything — the condition the evidence check uses. */
function chargesAnyRate(config: Row<'tax_configurations'>): boolean {
  return (
    Math.max(
      Number(config.rate) || 0,
      Number(config.employer_rate ?? 0) || 0,
      Number(config.employee_rate ?? 0) || 0,
    ) > 0
  );
}

/** Display-only: where a stored period sits relative to today. */
function coverageOf(config: Row<'tax_configurations'>): PeriodCoverage {
  return describePeriodCoverage(config, today());
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

/**
 * A refused write: the server's own wording is always shown, underneath the
 * documented explanation when the refusal is one the constraints describe. The
 * explanation never replaces the server message, and nothing here retries or
 * works around a refusal.
 */
function FailureNotice({ failure, onDismiss }: { failure: TaxConfigurationFailure; onDismiss?: () => void }) {
  const explanation = failure.explanation;
  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{explanation ? explanation.summary : 'The change was not saved.'}</p>
          {explanation && <p className="mt-0.5">{explanation.action}</p>}
          {failure.isAuthorityDenial && (
            <p className="mt-0.5">
              Ask a business owner or administrator to make this change for the business.
            </p>
          )}
          <p className={explanation || failure.isAuthorityDenial ? 'mt-1 text-xs text-red-700/80' : 'mt-0.5'}>
            {explanation || failure.isAuthorityDenial ? `The server said: ${failure.message}` : failure.message}
          </p>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} aria-label="Dismiss" className="text-red-500 hover:text-red-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
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
  existing, businessId, onClose, initial,
}: {
  existing?: Row<'tax_configurations'>;
  businessId: string;
  onClose: () => void;
  /** Pre-fill for a new configuration (used to adopt the supported standard rate). */
  initial?: Partial<TaxConfigForm>;
}) {
  const queryClient = useQueryClient();
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
      ...initial,
    },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [failure, setFailure] = useState<TaxConfigurationFailure | null>(null);

  const { data: postingAccounts = [] } = useQuery({
    queryKey: ['posting_accounts', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const isPension = form.tax_code === 'tpr_pension';
  /** True when this configuration charges anything — the condition the evidence check uses. */
  const chargesRate =
    Math.max(
      parseFloat(form.rate) || 0,
      parseFloat(form.employer_rate) || 0,
      parseFloat(form.employee_rate) || 0,
    ) > 0;

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
        if (isNaN(employerRate) || employerRate < 0 || employerRate > 100) throw new Error(RATE_RANGE_MESSAGE);
        if (isNaN(employeeRate) || employeeRate < 0 || employeeRate > 100) throw new Error(RATE_RANGE_MESSAGE);
      } else {
        rate = parseFloat(form.rate);
        if (isNaN(rate) || rate < 0 || rate > 100) throw new Error(RATE_RANGE_MESSAGE);
      }

      // These mirror the checks the database enforces (20261022000000). They make
      // the refusal arrive before the round trip; they do not replace it, and the
      // server's own message is what is shown if it disagrees.
      if (chargesRate && !form.mra_reference.trim()) throw new Error(EVIDENCE_REQUIRED_MESSAGE);
      if (form.effective_to && form.effective_to <= form.effective_from) throw new Error(PERIOD_ORDER_MESSAGE);

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

      // `.select('id')` is what makes a refusal visible: row level security hides
      // rows instead of raising, so an update the caller may not make reports no
      // error at all. An empty result means nothing was written, and the screen
      // says so rather than reporting success.
      if (existing) {
        const { data, error } = await repos.tax['client']
          .from('tax_configurations').update(payload as never).eq('id', existing.id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error(NO_ROW_CHANGED_MESSAGE);
      } else {
        const { data, error } = await repos.tax['client']
          .from('tax_configurations').insert(payload as never).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error(NO_ROW_CHANGED_MESSAGE);
      }
    },
    onSuccess: () => {
      setFailure(null);
      queryClient.invalidateQueries({ queryKey: ['tax_configs'] });
      queryClient.invalidateQueries({ queryKey: ['tax_configurations'] });
      setAlert({ type: 'success', message: existing ? 'Tax config updated.' : 'Tax config created.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => {
      setAlert(null);
      setFailure(describeTaxConfigurationFailure(err));
    },
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
          {failure && <FailureNotice failure={failure} onDismiss={() => setFailure(null)} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label htmlFor="tax-config-code" className="mb-1 block text-sm font-medium text-gray-700">Tax Code *</label>
              <select id="tax-config-code" value={form.tax_code} onChange={(e) => set('tax_code', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {TAX_CODES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {isPension ? (
              <>
                <div>
                  <label htmlFor="tax-config-employer-rate" className="mb-1 block text-sm font-medium text-gray-700">Employer Rate (%) *</label>
                  <input id="tax-config-employer-rate" type="number" min="0" max="100" step="0.01" value={form.employer_rate}
                    onChange={(e) => set('employer_rate', e.target.value)} placeholder="e.g. 10"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <div>
                  <label htmlFor="tax-config-employee-rate" className="mb-1 block text-sm font-medium text-gray-700">Employee Rate (%) *</label>
                  <input id="tax-config-employee-rate" type="number" min="0" max="100" step="0.01" value={form.employee_rate}
                    onChange={(e) => set('employee_rate', e.target.value)} placeholder="e.g. 5"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <p className="col-span-2 text-xs text-gray-500">
                  TPR pension uses two separate rates (employer contribution and employee deduction) instead of a single rate.
                </p>
              </>
            ) : (
              <div>
                <label htmlFor="tax-config-rate" className="mb-1 block text-sm font-medium text-gray-700">Rate (%)</label>
                <input id="tax-config-rate" type="number" min="0" max="100" step="0.01" value={form.rate}
                  onChange={(e) => set('rate', e.target.value)} placeholder="e.g. 17.5"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
            )}

            <div className="col-span-2">
              <label htmlFor="tax-config-name" className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
              <input id="tax-config-name" type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Standard VAT"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label htmlFor="tax-config-payable" className="mb-1 block text-sm font-medium text-gray-700">Tax Payable Account (Liability)</label>
              <select id="tax-config-payable" value={form.tax_payable_account_id} onChange={(e) => set('tax_payable_account_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Select a liability account…</option>
                {postingAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.code} — {acc.name} ({acc.account_type})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Account to credit when recording tax liabilities (e.g. Pension Payable, PAYE Payable, VAT Output).
              </p>
            </div>

            <div className="col-span-2">
              <label htmlFor="tax-config-receivable" className="mb-1 block text-sm font-medium text-gray-700">Tax Receivable Account (Asset, optional)</label>
              <select id="tax-config-receivable" value={form.tax_receivable_account_id} onChange={(e) => set('tax_receivable_account_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Select an asset account…</option>
                {postingAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.code} — {acc.name} ({acc.account_type})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Account to debit when recording tax receivables/input tax (e.g. VAT Receivable).
              </p>
            </div>

            <div className="col-span-2">
              <label htmlFor="tax-config-description" className="mb-1 block text-sm font-medium text-gray-700">Description (optional)</label>
              <input id="tax-config-description" type="text" value={form.description} onChange={(e) => set('description', e.target.value)}
                placeholder="e.g. Standard rate VAT per MRA regulations"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label htmlFor="tax-config-evidence" className="mb-1 block text-sm font-medium text-gray-700">
                MRA / evidence reference {chargesRate ? '*' : '(optional)'}
              </label>
              <input id="tax-config-evidence" type="text" value={form.mra_reference} onChange={(e) => set('mra_reference', e.target.value)}
                placeholder={chargesRate ? 'e.g. VAT Act Cap 42:02 as amended (2025)' : 'e.g. VAT/2024/001'}
                aria-required={chargesRate}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              <p className="mt-1 text-xs text-gray-500">
                The Act, gazette notice or MRA reference this rate relies on. Required for any rate above 0%, so a
                rate can be traced to the evidence for it.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="is_active" checked={form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
              <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
            </div>

            <div>
              <label htmlFor="tax-config-from" className="mb-1 block text-sm font-medium text-gray-700">Effective From *</label>
              <input id="tax-config-from" type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label htmlFor="tax-config-to" className="mb-1 block text-sm font-medium text-gray-700">Effective To (optional)</label>
              <input id="tax-config-to" type="date" value={form.effective_to} onChange={(e) => set('effective_to', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <p className="col-span-2 text-xs text-gray-500">
              A period cannot overlap another period of the same tax code for this business — it ends the day before
              the next one starts, and an open-ended period (no end date) is closed before its successor is added.
              The only standard VAT rate this product evidences is {formatRatePercent(VAT_STANDARD_RATE_PERCENT)} from{' '}
              {VAT_STANDARD_RATE_EFFECTIVE_FROM}; the {VAT_STANDARD_RATE_PREVIOUS_PERCENT}% it replaced has no evidenced
              start date here, so a period before that date needs the reference you are relying on.
            </p>
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
  const [failure, setFailure] = useState<TaxConfigurationFailure | null>(null);
  /** Pre-fill for a new configuration (adopting the supported standard rate). */
  const [initial, setInitial] = useState<Partial<TaxConfigForm>>();

  // The whole schedule, not just what is in force today: a rate that has not
  // started yet, or has ended, is exactly what a person has to be able to see and
  // correct when a statutory rate changes.
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['tax_configs', businessId],
    queryFn: () => repos.tax.findScheduleByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: postingAccounts = [] } = useQuery({
    queryKey: ['posting_accounts', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const accountMap = new Map(postingAccounts.map((a) => [a.id, a]));
  const unlinkedConfigs = configs.filter((c) => c.is_active && !c.tax_payable_account_id);

  // ── The standard VAT rate: what this business has recorded, and what the product evidences ──
  const asOf = today();
  const standardVat = supportedRateFor('vat_standard');
  const vatResolution = resolveTaxRate(configs, 'vat_standard', asOf);
  const vatRateDiffers =
    vatResolution.status === 'configured'
    && vatResolution.ratePercent !== VAT_STANDARD_RATE_PERCENT
    && asOf >= VAT_STANDARD_RATE_EFFECTIVE_FROM;
  // Any tax code whose stored periods overlap: the server refuses to choose, and so must the screen.
  const ambiguousCodes = [...new Set(configs.map((c) => c.tax_code))]
    .filter((code) => resolveTaxRate(configs, code, asOf).status === 'ambiguous');

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // As with the modal: an empty result means row level security hid the row
      // and nothing was deleted. Reporting success there would be a lie.
      const { data, error } = await repos.tax['client']
        .from('tax_configurations').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(NO_ROW_CHANGED_MESSAGE);
    },
    onSuccess: () => {
      setFailure(null);
      queryClient.invalidateQueries({ queryKey: ['tax_configs'] });
      queryClient.invalidateQueries({ queryKey: ['tax_configurations'] });
      setDeleting(undefined);
    },
    onError: (err: Error) => {
      setDeleting(undefined);
      setFailure(describeTaxConfigurationFailure(err));
    },
  });

  /** Adopt the evidenced standard rate exactly as the product can evidence it. */
  const adoptSupportedVatRate = () => {
    setEditing(undefined);
    setShowModal(true);
    setInitial({
      tax_code: 'vat_standard',
      name: 'VAT — Standard Rate',
      rate: String(VAT_STANDARD_RATE_PERCENT),
      mra_reference: VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
      effective_from: VAT_STANDARD_RATE_EFFECTIVE_FROM,
      effective_to: '',
      description: 'Standard-rate VAT (supported rate with its evidence reference)',
    });
  };

  return (
    <div>
      {failure && <FailureNotice failure={failure} onDismiss={() => setFailure(null)} />}

      {/*
        The standard VAT rate, stated in terms of what this business has recorded
        and what the product can evidence — the two are not the same thing, and the
        screen never lets one stand in for the other.
      */}
      {standardVat && vatResolution.status === 'supported_default' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold text-amber-900">
              No VAT rate is recorded for this business on {vatResolution.asOf}
            </p>
            <p className="mt-0.5">
              The evidenced standard rate from {vatResolution.supportedFrom} is{' '}
              <span className="font-medium">{formatRatePercent(vatResolution.ratePercent)}</span> (
              {vatResolution.evidenceReference}). Recording it as this business’s own period is what makes
              the schedule — and its evidence — auditable.
            </p>
            <button onClick={adoptSupportedVatRate}
              className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors">
              Record the standard rate ({formatRatePercent(vatResolution.ratePercent)} from {vatResolution.supportedFrom})
            </button>
          </div>
        </div>
      )}

      {vatRateDiffers && vatResolution.status === 'configured' && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">
              This business records {formatRatePercent(vatResolution.ratePercent)} for {vatResolution.asOf}
            </p>
            <p className="mt-0.5">
              The evidenced standard rate from {VAT_STANDARD_RATE_EFFECTIVE_FROM} is{' '}
              {formatRatePercent(VAT_STANDARD_RATE_PERCENT)} ({VAT_STANDARD_RATE_EVIDENCE_REFERENCE}). The stored
              period is this business’s own record, so it is not changed here — review it and correct it with the
              reference you are relying on.
            </p>
          </div>
        </div>
      )}

      {ambiguousCodes.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">Conflicting periods: {ambiguousCodes.join(', ')}</p>
            <p className="mt-0.5">{explainTaxRateResolution(resolveTaxRate(configs, ambiguousCodes[0], asOf))}</p>
          </div>
        </div>
      )}

      {unlinkedConfigs.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm border border-amber-200 text-amber-800">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900">Unlinked Tax Payable Accounts</p>
            <p className="mt-0.5 text-amber-800">
              The following tax configuration(s) are missing a linked payable account:{' '}
              <span className="font-medium">{unlinkedConfigs.map((c) => c.name).join(', ')}</span>.
              Edit the configuration to link a liability account so payroll approval and tax returns can post journal entries correctly.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button onClick={() => { setEditing(undefined); setInitial(undefined); setShowModal(true); }}
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
          <button onClick={() => { setEditing(undefined); setInitial(undefined); setShowModal(true); }}
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
                <th scope="col" className="px-4 py-3 text-left">Payable Account</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">MRA / evidence reference</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Effective From</th>
                <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Effective To</th>
                <th scope="col" className="px-4 py-3 text-center">Status</th>
                <th scope="col" className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configs.map((cfg) => {
                const acc = cfg.tax_payable_account_id ? accountMap.get(cfg.tax_payable_account_id) : null;
                return (
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
                    <td className="px-4 py-3">
                      {acc ? (
                        <span className="text-gray-900 font-medium">{acc.code} — {acc.name}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <AlertCircle className="h-3 w-3" /> Not linked
                        </span>
                      )}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-gray-500">
                      {cfg.mra_reference ?? (chargesAnyRate(cfg) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <AlertCircle className="h-3 w-3" /> Not recorded
                        </span>
                      ) : '—')}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{cfg.effective_from}</td>
                    <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{cfg.effective_to ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          cfg.is_active ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {cfg.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {cfg.is_active && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            coverageOf(cfg) === 'in_effect' ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {coverageOf(cfg) === 'in_effect' ? 'In effect' : coverageOf(cfg) === 'scheduled' ? 'Scheduled' : 'Ended'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setEditing(cfg); setShowModal(true); }}
                          aria-label={`Edit ${cfg.name} from ${cfg.effective_from}`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setDeleting(cfg)}
                          aria-label={`Delete ${cfg.name} from ${cfg.effective_from}`}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TaxConfigModal
          existing={editing}
          businessId={businessId}
          initial={editing ? undefined : initial}
          onClose={() => { setShowModal(false); setEditing(undefined); setInitial(undefined); }}
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

export function TaxPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [tab, setTab] = useState<'configs' | 'paye'>('configs');

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tax</h1>
          <p className="mt-1 text-sm text-gray-500">Manage tax configurations and PAYE bands for {currentBusiness.business.name}</p>
        </div>
      </div>

      <div className="mb-6 flex w-fit gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        <button onClick={() => setTab('configs')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'configs' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <Percent className="h-4 w-4" />Tax Configurations
        </button>
        <button onClick={() => setTab('paye')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'paye' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <Calculator className="h-4 w-4" />PAYE Bands
        </button>
      </div>

      {tab === 'configs' && <TaxConfigsTab businessId={businessId} />}
      {tab === 'paye' && <PayeBandsTab businessId={businessId} />}
    </div>
  );
}
