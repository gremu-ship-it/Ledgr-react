import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  DollarSign,
  User,
  Shield,
  Users,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Cookie,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import type { Row } from '@/dal/types/database';
import { useCookieConsent } from '@/lib/cookieConsent';
import { DataExportButton } from '@/components/DataExportButton';
import { DeleteAccountSection } from '@/components/DeleteAccountSection';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cls(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// ── Alert ─────────────────────────────────────────────────────────────────────

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={cls(
      'flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
      type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700',
    )}>
      {type === 'success'
        ? <CheckCircle className="h-4 w-4 shrink-0" />
        : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'business' | 'financial' | 'profile' | 'security' | 'team' | 'privacy';

const TABS: { value: Tab; label: string; icon: typeof Building2 }[] = [
  { value: 'business', label: 'Business Profile', icon: Building2 },
  { value: 'financial', label: 'Financial Settings', icon: DollarSign },
  { value: 'profile', label: 'User Profile', icon: User },
  { value: 'security', label: 'Security', icon: Shield },
  { value: 'team', label: 'Team Members', icon: Users },
  { value: 'privacy', label: 'Privacy', icon: Cookie },
];

// ── Business Profile Tab ──────────────────────────────────────────────────────

function BusinessProfileTab({ business }: { business: Row<'businesses'> }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState({
    name: business.name ?? '',
    trading_name: business.trading_name ?? '',
    registration_number: business.registration_number ?? '',
    tpin: business.tpin ?? '',
    vat_number: business.vat_number ?? '',
    phone: business.phone ?? '',
    email: business.email ?? '',
    website: business.website ?? '',
    address_line1: business.address_line1 ?? '',
    address_line2: business.address_line2 ?? '',
    city: business.city ?? '',
    country: business.country ?? 'Malawi',
    brand_color: business.brand_color ?? '#1D9E75',
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Business name is required');
      await repos.business.update(business.id, {
        name: form.name,
        trading_name: form.trading_name || null,
        registration_number: form.registration_number || null,
        tpin: form.tpin || null,
        vat_number: form.vat_number || null,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        country: form.country || null,
        brand_color: form.brand_color || null,
      });
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Business profile updated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['business', business.id] });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Business Profile</h2>
        <p className="mt-0.5 text-sm text-gray-500">Update your business information and branding.</p>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business Name">
          <Input value={form.name} onChange={(v) => set('name', v)} placeholder="Gremu Consultancy" />
        </Field>
        <Field label="Trading Name (optional)">
          <Input value={form.trading_name} onChange={(v) => set('trading_name', v)} placeholder="Trading as…" />
        </Field>
        <Field label="Registration Number (optional)">
          <Input value={form.registration_number} onChange={(v) => set('registration_number', v)} placeholder="e.g. 12345/2020" />
        </Field>
        <Field label="TPIN" hint="Your MRA Taxpayer Identification Number">
          <Input value={form.tpin} onChange={(v) => set('tpin', v)} placeholder="e.g. 10000001" />
        </Field>
        <Field label="VAT Number (optional)">
          <Input value={form.vat_number} onChange={(v) => set('vat_number', v)} placeholder="e.g. M001234567" />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(v) => set('phone', v)} placeholder="+265 999 123 456" />
        </Field>
        <Field label="Email">
          <Input value={form.email} onChange={(v) => set('email', v)} type="email" placeholder="info@business.mw" />
        </Field>
        <Field label="Website (optional)">
          <Input value={form.website} onChange={(v) => set('website', v)} placeholder="https://business.mw" />
        </Field>
        <Field label="Address Line 1">
          <Input value={form.address_line1} onChange={(v) => set('address_line1', v)} placeholder="Plot 123, Area 18" />
        </Field>
        <Field label="Address Line 2 (optional)">
          <Input value={form.address_line2} onChange={(v) => set('address_line2', v)} placeholder="P.O. Box 456" />
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(v) => set('city', v)} placeholder="Lilongwe" />
        </Field>
        <Field label="Country">
          <Input value={form.country} onChange={(v) => set('country', v)} placeholder="Malawi" />
        </Field>
        <Field label="Brand Color" hint="Used for invoices and app accents">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.brand_color}
              onChange={(e) => set('brand_color', e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-lg border border-gray-300 p-1"
            />
            <Input value={form.brand_color} onChange={(v) => set('brand_color', v)} placeholder="#1D9E75" />
          </div>
        </Field>
      </div>

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">{mutation.isPending ? 'Saving…' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ── Financial Settings Tab ────────────────────────────────────────────────────

function FinancialSettingsTab({ business }: { business: Row<'businesses'> }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState({
    base_currency: business.base_currency ?? 'MWK',
    financial_year_start: business.financial_year_start ?? '01-01',
    vat_registered: business.vat_registered ?? false,
    invoice_prefix: business.invoice_prefix ?? 'INV',
    invoice_next_number: String(business.invoice_next_number ?? 1),
    expense_prefix: business.expense_prefix ?? 'EXP',
    expense_next_number: String(business.expense_next_number ?? 1),
    payroll_prefix: business.payroll_prefix ?? 'PAY',
    payroll_next_number: String(business.payroll_next_number ?? 1),
    timezone: business.timezone ?? 'Africa/Blantyre',
  });

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      await repos.business.update(business.id, {
        base_currency: form.base_currency as Row<'businesses'>['base_currency'],
        financial_year_start: form.financial_year_start,
        vat_registered: form.vat_registered,
        invoice_prefix: form.invoice_prefix || 'INV',
        invoice_next_number: parseInt(form.invoice_next_number) || 1,
        expense_prefix: form.expense_prefix || 'EXP',
        expense_next_number: parseInt(form.expense_next_number) || 1,
        payroll_prefix: form.payroll_prefix || 'PAY',
        payroll_next_number: parseInt(form.payroll_next_number) || 1,
        timezone: form.timezone,
      });
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Financial settings updated successfully.' });
      queryClient.invalidateQueries({ queryKey: ['business', business.id] });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Financial Settings</h2>
        <p className="mt-0.5 text-sm text-gray-500">Configure currency, numbering, and accounting preferences.</p>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Base Currency">
          <select
            value={form.base_currency}
            onChange={(e) => set('base_currency', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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

        <Field label="Financial Year Start" hint="Day-Month format e.g. 01-01 for January">
          <Input value={form.financial_year_start} onChange={(v) => set('financial_year_start', v)} placeholder="01-01" />
        </Field>

        <Field label="Timezone">
          <select
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="Africa/Blantyre">Africa/Blantyre (CAT, UTC+2)</option>
            <option value="Africa/Nairobi">Africa/Nairobi (EAT, UTC+3)</option>
            <option value="Africa/Johannesburg">Africa/Johannesburg (SAST, UTC+2)</option>
            <option value="UTC">UTC</option>
          </select>
        </Field>

        <Field label="VAT Registration">
          <div className="flex items-center gap-3 rounded-lg border border-gray-300 px-3 py-2">
            <input
              type="checkbox"
              id="vat_registered"
              checked={form.vat_registered}
              onChange={(e) => set('vat_registered', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <label htmlFor="vat_registered" className="text-sm text-gray-700">
              Business is VAT registered (17.5% MRA standard rate)
            </label>
          </div>
        </Field>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Document Numbering</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="mb-3 text-sm font-medium text-gray-700">Invoices</p>
            <div className="space-y-2">
              <Field label="Prefix">
                <Input value={form.invoice_prefix} onChange={(v) => set('invoice_prefix', v)} placeholder="INV" />
              </Field>
              <Field label="Next Number" hint="e.g. 7 → next invoice is INV-0007">
                <Input value={form.invoice_next_number} onChange={(v) => set('invoice_next_number', v)} type="number" placeholder="1" />
              </Field>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="mb-3 text-sm font-medium text-gray-700">Expenses</p>
            <div className="space-y-2">
              <Field label="Prefix">
                <Input value={form.expense_prefix} onChange={(v) => set('expense_prefix', v)} placeholder="EXP" />
              </Field>
              <Field label="Next Number">
                <Input value={form.expense_next_number} onChange={(v) => set('expense_next_number', v)} type="number" placeholder="1" />
              </Field>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="mb-3 text-sm font-medium text-gray-700">Payroll</p>
            <div className="space-y-2">
              <Field label="Prefix">
                <Input value={form.payroll_prefix} onChange={(v) => set('payroll_prefix', v)} placeholder="PAY" />
              </Field>
              <Field label="Next Number">
                <Input value={form.payroll_next_number} onChange={(v) => set('payroll_next_number', v)} type="number" placeholder="1" />
              </Field>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">{mutation.isPending ? 'Saving…' : 'Save Changes'}</button>
      </div>
    </div>
  );
}

// ── User Profile Tab ──────────────────────────────────────────────────────────

function UserProfileTab() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState({
    full_name: currentUser?.profile?.full_name ?? '',
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!currentUser?.id) throw new Error('Not authenticated');
      if (!form.full_name.trim()) throw new Error('Full name is required');

      const { error } = await supabase
        .from('user_profiles')
        .update({ full_name: form.full_name } as never)
        .eq('id', currentUser.id);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Profile updated successfully.' });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">User Profile</h2>
        <p className="mt-0.5 text-sm text-gray-500">Manage your personal account information.</p>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} />}

      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-500 text-xl font-bold text-white">
          {form.full_name
            ? form.full_name.trim().split(/\s+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase()
            : currentUser?.email?.slice(0, 2).toUpperCase() ?? '??'}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{form.full_name || 'Your Name'}</p>
          <p className="text-sm text-gray-500">{currentUser?.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full Name">
          <Input value={form.full_name} onChange={(v) => set('full_name', v)} placeholder="Alexander Gremu" />
        </Field>
        <Field label="Email Address" hint="Email cannot be changed here — contact support">
          <Input value={currentUser?.email ?? ''} onChange={() => {}} disabled />
        </Field>
      </div>

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
        >
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────

function SecurityTab() {
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Password strength
  const strength = (() => {
    const p = form.new_password;
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score;
  })();

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'][strength] ?? '';
  const strengthColor = ['', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-brand-400', 'bg-brand-500'][strength] ?? '';

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.current_password) throw new Error('Enter your current password');
      if (form.new_password.length < 8) throw new Error('New password must be at least 8 characters');
      if (form.new_password !== form.confirm_password) throw new Error('Passwords do not match');

      // Re-authenticate then update
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Not authenticated');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: form.current_password,
      });
      if (signInError) throw new Error('Current password is incorrect');

      const { error } = await supabase.auth.updateUser({ password: form.new_password });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Password changed successfully.' });
      setForm({ current_password: '', new_password: '', confirm_password: '' });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Security</h2>
        <p className="mt-0.5 text-sm text-gray-500">Manage your password and account security.</p>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} />}

      {/* Change Password */}
      <div className="rounded-2xl border border-gray-200 p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Change Password</h3>
        <div className="space-y-4">
          <Field label="Current Password">
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                value={form.current_password}
                onChange={(e) => set('current_password', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <Field label="New Password">
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={form.new_password}
                onChange={(e) => set('new_password', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.new_password && (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={cls(
                        'h-1.5 flex-1 rounded-full transition-colors',
                        i <= strength ? strengthColor : 'bg-gray-200',
                      )}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">{strengthLabel}</p>
              </div>
            )}
          </Field>

          <Field label="Confirm New Password">
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm_password}
                onChange={(e) => set('confirm_password', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.confirm_password && form.new_password !== form.confirm_password && (
              <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
            )}
          </Field>

          <div className="flex justify-end">
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
            >
              {mutation.isPending ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>

      {/* Session info */}
      <div className="rounded-2xl border border-gray-200 p-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Active Session</h3>
        <p className="text-sm text-gray-500">
          You are currently signed in. To sign out of all devices, use the Sign Out Everywhere option.
        </p>
        <button
          onClick={async () => {
            await supabase.auth.signOut({ scope: 'global' });
            window.location.href = '/login';
          }}
          className="mt-3 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          Sign Out Everywhere
        </button>
      </div>
    </div>
  );
}

// ── Team Members Tab ──────────────────────────────────────────────────────────

const ROLES = ['owner', 'admin', 'accountant', 'staff', 'viewer'] as const;

function TeamMembersTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'staff' as typeof ROLES[number] });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_users')
        .select('*, profile:user_profiles(full_name)')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!inviteForm.email.trim()) throw new Error('Email is required');

      // Look up user by email via auth admin (requires service role — use edge function in production)
      // For now, we show a message that invite emails need to be handled server-side
      throw new Error(
        'Team invitations require a server-side function. The invited user should register at /register and you can then assign their role in Supabase.',
      );
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('business_users')
        .update({ is_active: false } as never)
        .eq('business_id', businessId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Team member removed.' });
      queryClient.invalidateQueries({ queryKey: ['team', businessId] });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase
        .from('business_users')
        .update({ role } as never)
        .eq('business_id', businessId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Role updated.' });
      queryClient.invalidateQueries({ queryKey: ['team', businessId] });
      setTimeout(() => setAlert(null), 3000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Team Members</h2>
          <p className="mt-0.5 text-sm text-gray-500">Manage who has access to this business.</p>
        </div>
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Invite Member
        </button>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} />}

      {showInvite && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-brand-900">Invite Team Member</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <input
                type="email"
                placeholder="Email address"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <select
              value={inviteForm.role}
              onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as typeof ROLES[number] }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
            >
              Send Invite
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Member</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member: any) => (
                <tr key={member.user_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                        {(member.profile?.full_name ?? member.user_id)
                          .slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {member.profile?.full_name ?? 'Unknown User'}
                        </p>
                        <p className="text-xs text-gray-400">{member.user_id.slice(0, 8)}…</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={member.role}
                      onChange={(e) =>
                        updateRoleMutation.mutate({ userId: member.user_id, role: e.target.value })
                      }
                      disabled={member.role === 'owner'}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-sm capitalize focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-transparent disabled:border-transparent disabled:font-medium disabled:text-brand-700"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(member.created_at).toLocaleDateString('en-MW', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {member.role !== 'owner' && (
                      <button
                        onClick={() => {
                          if (confirm('Remove this team member?')) {
                            removeRoleMutation.mutate(member.user_id);
                          }
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Privacy Tab ───────────────────────────────────────────────────────────────
// Matches the pattern of the other tabs (h2 title, no outer page wrapper —
// SettingsPage already provides the bordered card container).

const DATA_CATEGORIES = [
  {
    title: 'Account information',
    items: ['Full name', 'Email address', 'Phone number (optional)', 'Preferred currency', 'Sign-in history'],
  },
  {
    title: 'Business financial data',
    items: [
      'Income, invoices, and customer contacts',
      'Expenses, bills, and supplier contacts',
      'Payroll and employee records (for businesses you own)',
      'Inventory, products, and stock movements',
      'Chart of accounts and journal entries',
      'Fixed assets and depreciation records',
    ],
  },
  {
    title: 'Usage & technical data',
    items: [
      'Login timestamps and device/browser information',
      'Audit log of actions taken within your businesses (for accountability and security)',
    ],
  },
];

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  disabledLabel,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <div className="pr-4">
        <p className="text-sm font-medium text-gray-800">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      {disabled ? (
        <span className="shrink-0 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          {disabledLabel ?? 'Always on'}
        </span>
      ) : (
        <button
          onClick={() => onChange?.(!checked)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      )}
    </div>
  );
}

function PrivacyTab() {
  const { consent, updateConsent, hasDecided } = useCookieConsent();
  const analytics = consent?.analytics ?? false;
  const marketing = consent?.marketing ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Privacy</h2>
        <p className="mt-0.5 text-sm text-gray-500">What we collect, and how it's used.</p>
      </div>

      {/* What data is collected */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Data we collect</h3>
        <div className="space-y-4">
          {DATA_CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{cat.title}</p>
              <ul className="space-y-1">
                {cat.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Cookie / tracking preferences */}
      <div className="border-t border-gray-100 pt-6">
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Cookie preferences</h3>
        <p className="mb-4 text-xs text-gray-500">
          {hasDecided
            ? `Last updated ${new Date(consent!.decidedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}.`
            : "You haven't set a preference yet — choices below default to off until saved."}
        </p>
        <div className="space-y-3">
          <ToggleRow
            title="Essential"
            description="Required for sign-in and core functionality."
            checked
            disabled
          />
          <ToggleRow
            title="Analytics"
            description="Helps us understand how Ledgr is used. No analytics tool is live yet — this controls whether one would be allowed to run if added in future."
            checked={analytics}
            onChange={(v) => updateConsent(v, marketing)}
          />
          <ToggleRow
            title="Marketing"
            description="Used for tailored offers and communications."
            checked={marketing}
            onChange={(v) => updateConsent(analytics, v)}
          />
        </div>
      </div>

      {/* Data export (Right to Portability) */}
      <div className="border-t border-gray-100 pt-6">
        <DataExportButton />
      </div>

      {/* Account deletion (Right to Erasure) */}
      <div className="border-t border-gray-100 pt-6">
        <DeleteAccountSection />
      </div>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────

export function SettingsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [activeTab, setActiveTab] = useState<Tab>('business');

  const { data: business, isLoading } = useQuery({
    queryKey: ['business', businessId],
    queryFn: () => repos.business.findById(businessId!),
    enabled: Boolean(businessId),
  });

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your business and account preferences
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar nav */}
        <aside className="w-full lg:w-56 shrink-0">
          <nav className="space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cls(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left',
                    activeTab === tab.value
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
                ))}
              </div>
            ) : (
              <>
                {activeTab === 'business' && business && (
                  <BusinessProfileTab business={business} />
                )}
                {activeTab === 'financial' && business && (
                  <FinancialSettingsTab business={business} />
                )}
                {activeTab === 'profile' && <UserProfileTab />}
                {activeTab === 'security' && <SecurityTab />}
                {activeTab === 'team' && <TeamMembersTab businessId={businessId} />}
                {activeTab === 'privacy' && <PrivacyTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
