import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, AlertCircle, Building2, CheckCircle2,
  Users, Package, DollarSign, ArrowRight,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import type { InsertDto } from '@/dal/types/database';

// ── Field / Input helpers ─────────────────────────────────────────────────────

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = 'text', required,
}: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
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

// ── Steps ─────────────────────────────────────────────────────────────────────

type Step = 'details' | 'financial' | 'customer' | 'product' | 'transaction';

const STEPS: { value: Step; label: string; icon: React.ReactNode }[] = [
  { value: 'details',     label: 'Business',    icon: <Building2 className="h-3.5 w-3.5" /> },
  { value: 'financial',  label: 'Finance',     icon: <DollarSign className="h-3.5 w-3.5" /> },
  { value: 'customer',   label: 'Customer',    icon: <Users className="h-3.5 w-3.5" /> },
  { value: 'product',    label: 'Product',     icon: <Package className="h-3.5 w-3.5" /> },
  { value: 'transaction', label: 'First Sale', icon: <DollarSign className="h-3.5 w-3.5" /> },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function CreateBusinessPage() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const setBusinesses = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);

  const [step, setStep] = useState<Step>('details');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Created business id — set after step 2
  const [businessId, setBusinessId] = useState<string | null>(null);

  // Step 1 — details
  const [name, setName] = useState('');
  const [tradingName, setTradingName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Malawi');

  // Step 2 — financial
  const [currency, setCurrency] = useState('MWK');
  const [fyStart, setFyStart] = useState('01-01');
  const [vatRegistered, setVatRegistered] = useState(false);
  const [timezone, setTimezone] = useState('Africa/Blantyre');

  // Step 3 — customer
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Step 4 — product
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productType, setProductType] = useState<'product' | 'service'>('service');

  // Step 5 — transaction
  const [txAmount, setTxAmount] = useState('');
  const [txDescription, setTxDescription] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));

  const stepIndex = STEPS.findIndex((s) => s.value === step);
  const canSkip = stepIndex >= 2; // can skip from step 3 onwards

  function goToDashboard() {
    navigate('/dashboard', { replace: true });
  }

  async function createBusiness(): Promise<string> {
    if (!currentUser?.id) throw new Error('Not authenticated');

    const newBusiness = await repos.business.create({
      name: name.trim(),
      trading_name: tradingName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      city: city.trim() || null,
      country: country.trim() || null,
      base_currency: currency as 'MWK' | 'USD' | 'EUR' | 'GBP' | 'ZAR' | 'ZMW' | 'TZS' | 'KES' | 'UGX',
      financial_year_start: fyStart,
      vat_registered: vatRegistered,
      timezone,
      is_active: true,
      invoice_next_number: 1,
      expense_next_number: 1,
      payroll_next_number: 1,
    } as never);

    const { error: buError } = await supabase
      .from('business_users')
      .insert({
        business_id: newBusiness.id,
        user_id: currentUser.id,
        role: 'owner',
        is_active: true,
      } as never);

    if (buError) throw new Error(buError.message);

    // Also create a Walk-in Customer contact by default
    try {
      await repos.contact.create({
        business_id: newBusiness.id,
        name: 'Walk-in Customer',
        contact_type: 'customer',
        is_active: true,
      } as never);
    } catch {
      // non-critical
    }

    const memberships = await repos.business.findMembershipsWithRole(currentUser.id);
    setBusinesses(memberships);
    const created = memberships.find((m) => m.business.id === newBusiness.id);
    if (created) setCurrentBusiness(created);

    return newBusiness.id;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // ── Step 1: validate and advance ──
    if (step === 'details') {
      if (!name.trim()) { setError('Business name is required.'); return; }
      setStep('financial');
      return;
    }

    // ── Step 2: create business and advance ──
    if (step === 'financial') {
      setLoading(true);
      try {
        const id = await createBusiness();
        setBusinessId(id);
        setStep('customer');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Step 3: save customer (optional) and advance ──
    if (step === 'customer') {
      if (customerName.trim() && businessId) {
        setLoading(true);
        try {
          await repos.contact.create({
            business_id: businessId,
            name: customerName.trim(),
            phone: customerPhone.trim() || null,
            email: customerEmail.trim() || null,
            contact_type: 'customer',
            is_active: true,
          } as never);
        } catch (err) {
          console.warn('Customer creation failed (non-critical):', err);
        } finally {
          setLoading(false);
        }
      }
      setStep('product');
      return;
    }

    // ── Step 4: save product (optional) and advance ──
    if (step === 'product') {
      if (productName.trim() && businessId) {
        setLoading(true);
        try {
          await repos.inventory.createProduct({
            business_id: businessId,
            name: productName.trim(),
            product_type: productType,
            sale_price: parseFloat(productPrice) || 0,
            purchase_price: 0,
            track_inventory: productType === 'product',
            is_active: true,
          } as never);
        } catch (err) {
          console.warn('Product creation failed (non-critical):', err);
        } finally {
          setLoading(false);
        }
      }
      setStep('transaction');
      return;
    }

    // ── Step 5: record first transaction (optional) and go to dashboard ──
    if (step === 'transaction') {
      const amount = parseFloat(txAmount);
      if (txAmount && !isNaN(amount) && amount > 0 && businessId) {
        setLoading(true);
        try {
          const contacts = await repos.contact.findByBusiness(businessId, 'customer');
          const walkIn = contacts.find((c) => c.name === 'Walk-in Customer') ?? contacts[0];

          if (walkIn) {
            const invoiceNumber = await repos.business.reserveNextInvoiceNumber(businessId);
            await repos.invoice.createWithLines(
              {
                business_id: businessId,
                invoice_number: invoiceNumber,
                invoice_type: 'invoice',
                status: 'paid',
                contact_id: walkIn.id,
                issue_date: txDate,
                due_date: txDate,
                currency: 'MWK',
                exchange_rate: 1,
                subtotal: amount,
                discount_amount: 0,
                discount_percent: 0,
                taxable_amount: amount,
                vat_amount: 0,
                wht_amount: 0,
                total_amount: amount,
                amount_paid: amount,
                notes: txDescription.trim() || 'First sale',
                created_by: null,
              } as InsertDto<'invoices'>,
              [{
                line_number: 1,
                description: txDescription.trim() || 'First sale',
                quantity: 1,
                unit_price: amount,
                discount_percent: 0,
                tax_code: 'none',
                tax_rate: 0,
                tax_amount: 0,
                line_total: amount,
              } as Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>],
            );
          }
        } catch (err) {
          console.warn('Transaction creation failed (non-critical):', err);
        } finally {
          setLoading(false);
        }
      }
      goToDashboard();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
            L
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            {stepIndex < 2 ? 'Set up your business' : 'Almost there!'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {stepIndex < 2
              ? 'Just a few details to get your Ledgr account ready.'
              : 'Add a few more details to hit the ground running — or skip and do it later.'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.value} className="flex flex-1 items-center gap-1">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                i < stepIndex
                  ? 'bg-brand-500 text-white'
                  : i === stepIndex
                  ? 'bg-brand-500 text-white ring-4 ring-brand-100'
                  : 'bg-gray-200 text-gray-400'
              }`}>
                {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : s.icon}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 transition-colors ${
                  i < stepIndex ? 'bg-brand-500' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Step label */}
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">
          Step {stepIndex + 1} of {STEPS.length} — {STEPS[stepIndex].label}
        </p>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Step 1: Business Details ── */}
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

          {/* ── Step 2: Financial Settings ── */}
          {step === 'financial' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1">
                <DollarSign className="h-4 w-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-700">Financial Settings</span>
              </div>
              <Field label="Base Currency">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
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
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                  <option value="Africa/Blantyre">Africa/Blantyre (CAT, UTC+2)</option>
                  <option value="Africa/Nairobi">Africa/Nairobi (EAT, UTC+3)</option>
                  <option value="Africa/Johannesburg">Africa/Johannesburg (SAST, UTC+2)</option>
                  <option value="UTC">UTC</option>
                </select>
              </Field>
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                <input type="checkbox" id="vat_registered" checked={vatRegistered}
                  onChange={(e) => setVatRegistered(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                <label htmlFor="vat_registered" className="text-sm text-gray-700">
                  My business is VAT registered{' '}
                  <span className="text-gray-400">(17.5% MRA standard rate)</span>
                </label>
              </div>
            </div>
          )}

          {/* ── Step 3: First Customer ── */}
          {step === 'customer' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1">
                <Users className="h-4 w-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-700">Add your first customer</span>
              </div>
              <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
                💡 A <strong>Walk-in Customer</strong> contact has already been created for quick cash sales. Add a named customer if you invoice specific clients.
              </div>
              <Field label="Customer Name">
                <Input value={customerName} onChange={setCustomerName} placeholder="e.g. ABC Company Ltd" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <Input value={customerPhone} onChange={setCustomerPhone} placeholder="+265 999 000 000" type="tel" />
                </Field>
                <Field label="Email">
                  <Input value={customerEmail} onChange={setCustomerEmail} placeholder="client@company.mw" type="email" />
                </Field>
              </div>
            </div>
          )}

          {/* ── Step 4: First Product ── */}
          {step === 'product' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1">
                <Package className="h-4 w-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-700">Add your first product or service</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setProductType('service')}
                  className={`rounded-xl border-2 p-3 text-sm font-medium transition-colors ${
                    productType === 'service'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  🔧 Service
                </button>
                <button
                  type="button"
                  onClick={() => setProductType('product')}
                  className={`rounded-xl border-2 p-3 text-sm font-medium transition-colors ${
                    productType === 'product'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  📦 Product
                </button>
              </div>
              <Field label="Name">
                <Input
                  value={productName}
                  onChange={setProductName}
                  placeholder={productType === 'service' ? 'e.g. Consulting Services' : 'e.g. Cement Bag 50kg'}
                />
              </Field>
              <Field label="Sale Price (MWK)" hint="How much you charge customers">
                <Input value={productPrice} onChange={setProductPrice} placeholder="0.00" type="number" />
              </Field>
            </div>
          )}

          {/* ── Step 5: First Transaction ── */}
          {step === 'transaction' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1">
                <DollarSign className="h-4 w-4 text-brand-500" />
                <span className="text-sm font-semibold text-gray-700">Record your first sale</span>
              </div>
              <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
                💡 This will appear on your dashboard immediately so you can see Ledgr in action.
              </div>
              <Field label="Amount (MWK)">
                <Input value={txAmount} onChange={setTxAmount} placeholder="e.g. 50000" type="number" />
              </Field>
              <Field label="Description">
                <Input value={txDescription} onChange={setTxDescription} placeholder="e.g. Consulting fee — July" />
              </Field>
              <Field label="Date">
                <Input value={txDate} onChange={setTxDate} type="date" />
              </Field>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <div className="flex items-center gap-3">
              {/* Back button */}
              {stepIndex > 0 && stepIndex < 2 && (
                <button
                  type="button"
                  onClick={() => { setError(null); setStep(STEPS[stepIndex - 1].value); }}
                  className="text-sm font-medium text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
              )}

              {/* Skip setup button — available from step 3 onwards */}
              {canSkip && (
                <button
                  type="button"
                  onClick={goToDashboard}
                  className="text-sm font-medium text-gray-400 hover:text-gray-600"
                >
                  Skip setup →
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Skip this step — available from step 3 onwards */}
              {canSkip && step !== 'transaction' && (
                <button
                  type="button"
                  onClick={() => setStep(STEPS[stepIndex + 1].value)}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Skip <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {step === 'details' && 'Continue →'}
                {step === 'financial' && (loading ? 'Creating…' : 'Create Business →')}
                {step === 'customer' && (loading ? 'Saving…' : 'Save & Continue →')}
                {step === 'product' && (loading ? 'Saving…' : 'Save & Continue →')}
                {step === 'transaction' && (loading ? 'Saving…' : 'Finish Setup ✓')}
              </button>
            </div>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          You can update all of these details later in Settings.
        </p>
      </div>
    </div>
  );
}