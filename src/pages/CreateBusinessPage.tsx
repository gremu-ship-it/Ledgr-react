import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Building2, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { ensureChartOfAccounts } from '@/services/seedChartOfAccounts';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', required }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
    />
  );
}

type Step = 'details' | 'financial';

const STEPS: { value: Step; label: string }[] = [
  { value: 'details',   label: 'Business Details'  },
  { value: 'financial', label: 'Financial Settings' },
];

export function CreateBusinessPage() {
  const navigate           = useNavigate();
  const currentUser        = useAppStore((s) => s.currentUser);
  const setBusinesses      = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);

  const [step, setStep]       = useState<Step>('details');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Step 1 — details
  const [name, setName]               = useState('');
  const [tradingName, setTradingName] = useState('');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState('');
  const [city, setCity]               = useState('');
  const [country, setCountry]         = useState('Malawi');

  // Step 2 — financial
  const [currency, setCurrency]           = useState('MWK');
  const [fyStart, setFyStart]             = useState('01-01');
  const [vatRegistered, setVatRegistered] = useState(false);
  const [timezone, setTimezone]           = useState('Africa/Blantyre');
  const [coaTemplate, setCoaTemplate]     = useState<'gaap' | 'ifrs'>('gaap');

  const stepIndex = STEPS.findIndex((s) => s.value === step);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentUser?.id) return;

    if (step === 'details') {
      if (!name.trim()) { setError('Business name is required.'); return; }
      setError(null);
      setStep('financial');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Create the business via SECURITY DEFINER RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: businessId, error: rpcErr } = await (supabase.rpc as any)(
        'create_business_for_user',
        {
          p_name:           name.trim(),
          p_trading_name:   tradingName.trim() || null,
          p_phone:          phone.trim() || null,
          p_email:          email.trim() || null,
          p_city:           city.trim() || null,
          p_country:        country.trim() || null,
          p_currency:       currency,
          p_fy_start:       fyStart,
          p_vat_registered: vatRegistered,
          p_timezone:       timezone,
        },
      );

      if (rpcErr) throw new Error(rpcErr.message);
      if (!businessId) throw new Error('Failed to create business.');

      // Seed Chart of Accounts for the new business.
      // Non-fatal — if it fails the user can repair from Settings later.
      try {
        await ensureChartOfAccounts(supabase, businessId, coaTemplate);
      } catch (seedErr) {
        console.warn('COA seed failed for new business:', businessId, seedErr);
      }

      // Refresh memberships and navigate
      const memberships = await repos.business.findMembershipsWithRole(currentUser.id);
      setBusinesses(memberships);

      const created = memberships.find((m) => m.business.id === businessId);
      if (created) setCurrentBusiness(created);

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
            L
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Set up your business</h1>
          <p className="mt-1 text-sm text-gray-500">Just a few details to get your Ledgr account ready.</p>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.value} className="flex flex-1 items-center gap-2">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                i <= stepIndex ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-400'
              }`}>
                {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm font-medium ${i <= stepIndex ? 'text-gray-900' : 'text-gray-400'}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 transition-colors ${i < stepIndex ? 'bg-brand-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-soft">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Step 1: Business Details ────────────────────────────────── */}
          {step === 'details' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1">
                <Building2 className="h-4 w-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-700">Business Details</span>
              </div>
              <Field label="Business Name" hint="The registered or trading name of your business">
                <Input value={name} onChange={setName} placeholder="Gremu Consultancy Ltd" required />
              </Field>
              <Field label="Trading Name" hint="Optional — if different from the registered name">
                <Input value={tradingName} onChange={setTradingName} placeholder="Gremu Consulting" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <Input value={phone} onChange={setPhone} placeholder="+265 999 123 456" type="tel" />
                </Field>
                <Field label="Email">
                  <Input value={email} onChange={setEmail} placeholder="info@business.mw" type="email" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City">
                  <Input value={city} onChange={setCity} placeholder="Lilongwe" />
                </Field>
                <Field label="Country">
                  <Input value={country} onChange={setCountry} placeholder="Malawi" />
                </Field>
              </div>
            </div>
          )}

          {/* ── Step 2: Financial Settings ──────────────────────────────── */}
          {step === 'financial' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1">
                <span className="text-sm font-semibold text-gray-700">Financial Settings</span>
              </div>

              <Field label="Base Currency">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="MWK">MWK — Malawian Kwacha</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="GBP">GBP — British Pound</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="ZAR">ZAR — South African Rand</option>
                  <option value="KES">KES — Kenyan Shilling</option>
                  <option value="TZS">TZS — Tanzanian Shilling</option>
                  <option value="ZMW">ZMW — Zambian Kwacha</option>
                </select>
              </Field>

              <Field label="Financial Year Start" hint="Day-Month format, e.g. 01-01 for 1 January">
                <Input value={fyStart} onChange={setFyStart} placeholder="01-01" />
              </Field>

              <Field label="Timezone">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="Africa/Blantyre">Africa/Blantyre (CAT, UTC+2)</option>
                  <option value="Africa/Nairobi">Africa/Nairobi (EAT, UTC+3)</option>
                  <option value="Africa/Johannesburg">Africa/Johannesburg (SAST, UTC+2)</option>
                  <option value="UTC">UTC</option>
                </select>
              </Field>

              {/* NEW: COA template selector */}
              <Field
                label="Accounting Standard"
                hint="Sets the Chart of Accounts template for this business. Can be changed later."
              >
                <div className="flex gap-2">
                  {([
                    { value: 'gaap', label: 'Local GAAP / MRA', desc: 'Recommended for most Malawian businesses' },
                    { value: 'ifrs', label: 'IFRS',             desc: 'For businesses reporting under IFRS (adds lease accounts etc.)' },
                  ] as const).map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setCoaTemplate(t.value)}
                      className={`flex-1 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        coaTemplate === t.value
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block font-semibold">{t.label}</span>
                      <span className="block text-xs opacity-70">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                <input
                  type="checkbox"
                  id="vat_registered"
                  checked={vatRegistered}
                  onChange={(e) => setVatRegistered(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                <label htmlFor="vat_registered" className="text-sm text-gray-700">
                  My business is VAT registered{' '}
                  <span className="text-gray-400">(17.5% MRA standard rate)</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            {step === 'financial' ? (
              <button
                type="button"
                onClick={() => { setError(null); setStep('details'); }}
                className="text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                ← Back
              </button>
            ) : <span />}

            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {step === 'details' ? 'Continue →' : loading ? 'Creating…' : 'Create Business'}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          You can update all of these details later in Settings.
        </p>
      </div>
    </div>
  );
}
