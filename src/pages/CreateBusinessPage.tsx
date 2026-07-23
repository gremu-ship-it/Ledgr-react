import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ChevronRight, ChevronLeft,
  Loader2, AlertCircle, CheckCircle2,
  Palette, FileText, Receipt,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { clsx } from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BusinessForm {
  // Step 1 — Basic info
  name: string;
  trading_name: string;
  registration_number: string;
  tpin: string;
  vat_registered: boolean;
  vat_number: string;

  // Step 2 — Contact & location
  email: string;
  phone: string;
  address_line1: string;
  city: string;
  country: string;

  // Step 3 — Financial settings
  base_currency: string;
  financial_year_start: string;
  timezone: string;

  // Step 4 — Branding & numbering
  brand_color: string;
  invoice_prefix: string;
  expense_prefix: string;
  payroll_prefix: string;
}

const DEFAULTS: BusinessForm = {
  name: '',
  trading_name: '',
  registration_number: '',
  tpin: '',
  vat_registered: false,
  vat_number: '',
  email: '',
  phone: '',
  address_line1: '',
  city: 'Blantyre',
  country: 'Malawi',
  base_currency: 'MWK',
  financial_year_start: '01-01',
  timezone: 'Africa/Blantyre',
  brand_color: '#0F766E',
  invoice_prefix: 'INV',
  expense_prefix: 'EXP',
  payroll_prefix: 'PAY',
};

const STEPS = [
  { id: 1, label: 'Business details', icon: Building2 },
  { id: 2, label: 'Contact & location', icon: FileText },
  { id: 3, label: 'Financial settings', icon: Receipt },
  { id: 4, label: 'Branding', icon: Palette },
];

const MALAWI_CITIES = [
  'Blantyre', 'Lilongwe', 'Mzuzu', 'Zomba', 'Karonga',
  'Kasungu', 'Mangochi', 'Salima', 'Liwonde', 'Dedza',
];

const CURRENCIES = [
  { code: 'MWK', label: 'Malawian Kwacha (MWK)' },
  { code: 'USD', label: 'US Dollar (USD)' },
  { code: 'GBP', label: 'British Pound (GBP)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'ZAR', label: 'South African Rand (ZAR)' },
  { code: 'ZMW', label: 'Zambian Kwacha (ZMW)' },
];

const FINANCIAL_YEAR_OPTIONS = [
  { value: '01-01', label: 'January (01 Jan – 31 Dec)' },
  { value: '04-01', label: 'April (01 Apr – 31 Mar)' },
  { value: '07-01', label: 'July (01 Jul – 30 Jun)' },
  { value: '10-01', label: 'October (01 Oct – 30 Sep)' },
];

const BRAND_COLORS = [
  '#0F766E', '#2563EB', '#7C3AED', '#DC2626',
  '#D97706', '#0F766E', '#0891B2', '#4F46E5',
];

// ── Field component ───────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-sub">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="block w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
    />
  );
}

// ── Step components ───────────────────────────────────────────────────────────

function Step1({ form, set }: { form: BusinessForm; set: (k: keyof BusinessForm, v: string | boolean) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Business name" required hint="Your registered legal business name">
        <TextInput
          required
          value={form.name}
          onChange={(v) => set('name', v)}
          placeholder="Gremu & Associates Ltd"
        />
      </Field>

      <Field label="Trading name" hint="Leave blank if same as business name">
        <TextInput
          value={form.trading_name}
          onChange={(v) => set('trading_name', v)}
          placeholder="Gremu Consulting"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company registration number" hint="MBRS registration number">
          <TextInput
            value={form.registration_number}
            onChange={(v) => set('registration_number', v)}
            placeholder="C00012345"
          />
        </Field>

        <Field label="MRA TPIN" hint="Tax Payer Identification Number">
          <TextInput
            value={form.tpin}
            onChange={(v) => set('tpin', v)}
            placeholder="12345678"
          />
        </Field>
      </div>

      <div className="rounded-xl border border-line bg-bg p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.vat_registered}
            onChange={(e) => set('vat_registered', e.target.checked)}
            className="h-4 w-4 rounded border-line text-brand-600 dark:text-brand-400 focus:ring-brand-500"
          />
          <div>
            <p className="text-sm font-medium text-sub">VAT registered</p>
            <p className="text-xs text-muted">VAT rate in Malawi is 17.5%. Tick if your business is registered with MRA for VAT.</p>
          </div>
        </label>

        {form.vat_registered && (
          <div className="mt-3">
            <Field label="VAT registration number">
              <TextInput
                value={form.vat_number}
                onChange={(v) => set('vat_number', v)}
                placeholder="VAT/M/12345"
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function Step2({ form, set }: { form: BusinessForm; set: (k: keyof BusinessForm, v: string | boolean) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business email">
          <TextInput
            type="email"
            value={form.email}
            onChange={(v) => set('email', v)}
            placeholder="info@business.mw"
          />
        </Field>

        <Field label="Phone number">
          <TextInput
            value={form.phone}
            onChange={(v) => set('phone', v)}
            placeholder="+265 999 000 000"
          />
        </Field>
      </div>

      <Field label="Street address">
        <TextInput
          value={form.address_line1}
          onChange={(v) => set('address_line1', v)}
          placeholder="Plot 15, Glyn Jones Road"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="City">
          <select
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
            className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {MALAWI_CITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="Other">Other</option>
          </select>
        </Field>

        <Field label="Country">
          <TextInput
            value={form.country}
            onChange={(v) => set('country', v)}
            placeholder="Malawi"
          />
        </Field>
      </div>
    </div>
  );
}

function Step3({ form, set }: { form: BusinessForm; set: (k: keyof BusinessForm, v: string | boolean) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Base currency" hint="Primary currency for all financial records">
        <select
          value={form.base_currency}
          onChange={(e) => set('base_currency', e.target.value)}
          className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Financial year start" hint="When your financial year begins">
        <select
          value={form.financial_year_start}
          onChange={(e) => set('financial_year_start', e.target.value)}
          className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {FINANCIAL_YEAR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Timezone">
        <select
          value={form.timezone}
          onChange={(e) => set('timezone', e.target.value)}
          className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="Africa/Blantyre">Africa/Blantyre (CAT, UTC+2)</option>
          <option value="Africa/Johannesburg">Africa/Johannesburg (SAST, UTC+2)</option>
          <option value="Africa/Nairobi">Africa/Nairobi (EAT, UTC+3)</option>
          <option value="UTC">UTC</option>
        </select>
      </Field>

      <div className="rounded-xl border border-brand-100 bg-brand-500/10 p-4">
        <p className="text-xs font-medium text-brand-700 dark:text-brand-300">MRA Tax defaults</p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-brand-600 dark:text-brand-300">
          <li>• VAT: 17.5% (standard rate)</li>
          <li>• WHT: 10% / 15% / 20% depending on payment type</li>
          <li>• PAYE: graduated bands per MRA schedule</li>
          <li>• CIT: 30% (standard) / 20% (SME)</li>
        </ul>
        <p className="mt-2 text-xs text-brand-600 dark:text-brand-400">These are configured in the Tax module after setup.</p>
      </div>
    </div>
  );
}

function Step4({ form, set }: { form: BusinessForm; set: (k: keyof BusinessForm, v: string | boolean) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Brand colour" hint="Used across invoices, reports, and the business switcher">
        <div className="mt-2 flex flex-wrap gap-2">
          {BRAND_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => set('brand_color', color)}
              className={clsx(
                'h-9 w-9 rounded-full border-2 transition-transform hover:scale-110',
                form.brand_color === color
                  ? 'border-line scale-110'
                  : 'border-transparent',
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.brand_color}
              onChange={(e) => set('brand_color', e.target.value)}
              className="h-9 w-9 cursor-pointer rounded-full border-2 border-line bg-card p-0.5"
              title="Custom colour"
            />
            <span className="text-xs text-muted">Custom</span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2">
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: form.brand_color }}
          />
          <span className="font-mono text-xs text-sub">{form.brand_color}</span>
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Invoice prefix" hint="e.g. INV-0001">
          <TextInput
            value={form.invoice_prefix}
            onChange={(v) => set('invoice_prefix', v.toUpperCase())}
            placeholder="INV"
          />
        </Field>

        <Field label="Expense prefix" hint="e.g. EXP-0001">
          <TextInput
            value={form.expense_prefix}
            onChange={(v) => set('expense_prefix', v.toUpperCase())}
            placeholder="EXP"
          />
        </Field>

        <Field label="Payroll prefix" hint="e.g. PAY-0001">
          <TextInput
            value={form.payroll_prefix}
            onChange={(v) => set('payroll_prefix', v.toUpperCase())}
            placeholder="PAY"
          />
        </Field>
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-line bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Preview</p>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: form.brand_color }}
          >
            {(form.trading_name || form.name || 'B').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">
              {form.trading_name || form.name || 'Your Business'}
            </p>
            <p className="text-xs text-muted">{form.base_currency} · {form.city}, {form.country}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CreateBusinessPage() {
  const navigate = useNavigate();
  const setBusinesses = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BusinessForm>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof BusinessForm, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validateStep(): boolean {
    if (step === 1 && !form.name.trim()) {
      setError('Business name is required.');
      return false;
    }
    if (step === 1 && form.vat_registered && !form.vat_number.trim()) {
      setError('Please enter your VAT registration number.');
      return false;
    }
    setError(null);
    return true;
  }

  function handleNext(e?: React.MouseEvent) {
    e?.preventDefault();
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, 4));
  }

  function handleBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateStep()) return;
    setError(null);
    setLoading(true);

    const { data: businessId, error: rpcError } = await (supabase as any).rpc(
      'create_business_with_owner',
      {
        p_name: form.name.trim(),
        p_trading_name: form.trading_name.trim() || null,
        p_registration_number: form.registration_number.trim() || null,
        p_tpin: form.tpin.trim() || null,
        p_vat_number: form.vat_number.trim() || null,
        p_vat_registered: form.vat_registered,
        p_base_currency: form.base_currency,
        p_financial_year_start: form.financial_year_start,
        p_timezone: form.timezone,
        p_address_line1: form.address_line1.trim() || null,
        p_city: form.city,
        p_country: form.country,
        p_phone: form.phone.trim() || null,
        p_email: form.email.trim() || null,
        p_brand_color: form.brand_color,
        p_invoice_prefix: form.invoice_prefix || 'INV',
        p_expense_prefix: form.expense_prefix || 'EXP',
        p_payroll_prefix: form.payroll_prefix || 'PAY',
      },
    );

    if (rpcError) {
      setLoading(false);
      setError(rpcError.message);
      return;
    }

    // Reload memberships into the store
    if (currentUser) {
      const { data: memberships } = await supabase
        .from('business_users')
        .select('role, business:businesses!inner(*)')
        .eq('user_id', currentUser.id)
        .eq('is_active', true)
        .eq('businesses.is_active', true)
        .is('businesses.deleted_at', null);

      if (memberships) {
        type JoinRow = {
          role: string;
          business: Record<string, unknown> | Record<string, unknown>[] | null;
        };

        const mapped = (memberships as unknown as JoinRow[])
          .map((row) => {
            const business = Array.isArray(row.business) ? row.business[0] : row.business;
            if (!business) return null;
            return { business, role: row.role };
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);

        setBusinesses(mapped as any);

        // Select the newly created business
        const newBiz = mapped.find(
          (m) => (m.business as { id: string }).id === businessId,
        );
        if (newBiz) setCurrentBusiness(newBiz as any);
      }
    }

    setLoading(false);
    navigate('/dashboard', { replace: true });
  }

  const isLastStep = step === 4;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            L
          </div>
          <h1 className="text-xl font-semibold text-ink">
            {step === 1 ? 'Set up your business' : STEPS[step - 1].label}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Step {step} of {STEPS.length}
          </p>
        </div>

        {/* Step indicators */}
        <div className="mb-6 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div className={clsx(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                step > s.id ? 'bg-brand-600 text-white' :
                step === s.id ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                'bg-surface text-muted',
              )}>
                {step > s.id ? '✓' : s.id}
              </div>
              {i < STEPS.length - 1 && (
                <div className={clsx(
                  'h-0.5 flex-1 rounded-full transition-colors',
                  step > s.id ? 'bg-brand-600' : 'bg-surface',
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-line bg-card p-6 shadow-soft">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={isLastStep ? handleSubmit : (e) => { e.preventDefault(); handleNext(); }}>
            {step === 1 && <Step1 form={form} set={set} />}
            {step === 2 && <Step2 form={form} set={set} />}
            {step === 3 && <Step3 form={form} set={set} />}
            {step === 4 && <Step4 form={form} set={set} />}

            <div className="mt-6 flex gap-3">
              {step > 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-sub transition-colors hover:bg-bg"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating business…
                  </>
                ) : isLastStep ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Create business
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Skip link for users who already have a business */}
        <p className="mt-4 text-center text-sm text-muted">
          <button
            type="button"
            onClick={() => navigate('/dashboard', { replace: true })}
            className="hover:text-sub"
          >
            Skip for now
          </button>
        </p>
      </div>
    </div>
  );
}
