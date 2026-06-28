import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Building2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

const CURRENCIES = [
  { value: 'MWK', label: 'MWK — Malawian Kwacha' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
];

export function CreateBusinessPage() {
  const navigate = useNavigate();
  const setBusinesses = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    name: '',
    trading_name: '',
    tpin: '',
    vat_number: '',
    phone: '',
    email: '',
    city: 'Lilongwe',
    country: 'Malawi',
    base_currency: 'MWK',
    vat_registered: false,
    financial_year_start: '01-01',
  });

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError('Business name is required.');
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated. Please sign in again.');

      // 1 — Create the business
      const { data: business, error: bizError } = await supabase
        .from('businesses')
        .insert({
          name: form.name.trim(),
          trading_name: form.trading_name.trim() || null,
          tpin: form.tpin.trim() || null,
          vat_number: form.vat_number.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          city: form.city.trim() || null,
          country: form.country.trim() || 'Malawi',
          base_currency: form.base_currency,
          vat_registered: form.vat_registered,
          financial_year_start: form.financial_year_start,
          timezone: 'Africa/Blantyre',
          invoice_prefix: 'INV',
          invoice_next_number: 1,
          expense_prefix: 'EXP',
          expense_next_number: 1,
          payroll_prefix: 'PAY',
          payroll_next_number: 1,
          is_active: true,
        })
        .select()
        .single();

      if (bizError) throw new Error(bizError.message);
      if (!business) throw new Error('Failed to create business.');

      // 2 — Add the current user as owner
      const { error: memberError } = await supabase
        .from('business_users')
        .insert({
          business_id: business.id,
          user_id: user.id,
          role: 'owner',
          is_active: true,
          accepted_at: new Date().toISOString(),
        });

      if (memberError) throw new Error(memberError.message);

      // 3 — Create a default Walk-in Customer contact
      await supabase
        .from('contacts')
        .insert({
          business_id: business.id,
          contact_type: 'customer',
          name: 'Walk-in Customer',
          is_active: true,
          wht_exempt: false,
        });

      // 4 — Update Zustand store so the app switches immediately
      const membership = { role: 'owner', business };
      setBusinesses([membership as any]);
      setCurrentBusiness(membership as any);

      setSuccess(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 className="h-7 w-7 text-brand-500" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Business created!</h1>
          <p className="mt-2 text-sm text-slate-500">
            Taking you to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
            L
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set up your business</h1>
          <p className="mt-1 text-sm text-slate-500">
            This takes 2 minutes. You can update everything later in Settings.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Business Identity */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand-500" />
              <h2 className="text-sm font-semibold text-slate-700">Business Identity</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Business Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Gremu Consultancy"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Trading Name <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.trading_name}
                  onChange={(e) => set('trading_name', e.target.value)}
                  placeholder="Trading as…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">TPIN</label>
                  <input
                    type="text"
                    value={form.tpin}
                    onChange={(e) => set('tpin', e.target.value)}
                    placeholder="MRA TPIN"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">VAT Number</label>
                  <input
                    type="text"
                    value={form.vat_number}
                    onChange={(e) => set('vat_number', e.target.value)}
                    placeholder="If VAT registered"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Contact Details</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="+265 999 123 456"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="info@business.mw"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  placeholder="Lilongwe"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Country</label>
                <input
                  type="text"
                  value={form.country}
                  onChange={(e) => set('country', e.target.value)}
                  placeholder="Malawi"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
          </div>

          {/* Financial */}
          <div className="border-t border-slate-100 pt-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Financial Settings</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Base Currency</label>
                <select
                  value={form.base_currency}
                  onChange={(e) => set('base_currency', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <input
                  type="checkbox"
                  id="vat_registered"
                  checked={form.vat_registered}
                  onChange={(e) => set('vat_registered', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                />
                <label htmlFor="vat_registered" className="text-sm text-slate-700">
                  Business is VAT registered (17.5% MRA standard rate)
                </label>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Creating business…' : 'Create Business & Continue'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          All fields except Business Name are optional and can be updated later in Settings.
        </p>
      </div>
    </div>
  );
}
