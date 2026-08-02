import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';
import { PLATFORM_ROOT_DOMAIN, slugify } from '@/lib/partnerDomain';
import {
  PARTNER_FEATURE_DESCRIPTIONS,
  PARTNER_FEATURE_KEYS,
  PARTNER_FEATURE_LABELS,
  PARTNER_FEATURE_PRESETS,
  type UpdatePartnerDto,
} from '@/types/partners';

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900';

export function PartnerSettingsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isPlatformAdmin } = usePartnerAdminAccess();

  const { data: partner, isLoading } = useQuery({
    queryKey: ['partner', id],
    queryFn: () => PartnerRepository.getById(id),
    enabled: Boolean(id),
  });

  const { data: savedFlags } = useQuery({
    queryKey: ['partner-flags', id],
    queryFn: () => PartnerRepository.getFeatureFlags(id),
    enabled: Boolean(id),
  });

  // Server state is the baseline; local edits are layered on top so the form
  // populates without an effect-driven setState round trip.
  const [edits, setEdits] = useState<UpdatePartnerDto>({});
  const [flagEdits, setFlagEdits] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);

  const form = useMemo<UpdatePartnerDto>(() => {
    const base: UpdatePartnerDto = partner
      ? {
          name: partner.name,
          slug: partner.slug,
          custom_domain: partner.custom_domain,
          app_name: partner.app_name,
          logo_url: partner.logo_url,
          primary_colour: partner.primary_colour,
          support_email: partner.support_email,
          support_phone: partner.support_phone,
          onboarding_title: partner.onboarding_title,
          onboarding_subtitle: partner.onboarding_subtitle,
          client_limit: partner.client_limit,
          allow_client_visibility: partner.allow_client_visibility,
          billing_email: partner.billing_email,
          billing_contact_name: partner.billing_contact_name,
          price_per_client: partner.price_per_client,
          billing_currency: partner.billing_currency,
          is_active: partner.is_active,
        }
      : {};
    return { ...base, ...edits };
  }, [partner, edits]);

  const flags = useMemo(() => {
    const base: Record<string, boolean> = {};
    PARTNER_FEATURE_KEYS.forEach((k) => {
      base[k] = savedFlags?.[k] !== false;
    });
    return { ...base, ...flagEdits };
  }, [savedFlags, flagEdits]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      await PartnerRepository.update(id, form);
      await PartnerRepository.setFeatureFlags(id, flags);
    },
    onSuccess: () => {
      setMessage('Saved.');
      setEdits({});
      setFlagEdits({});
      void queryClient.invalidateQueries({ queryKey: ['partner', id] });
      void queryClient.invalidateQueries({ queryKey: ['partner-flags', id] });
      setTimeout(() => setMessage(null), 2500);
    },
    onError: (e: Error) => setMessage(e.message),
  });

  function set<K extends keyof UpdatePartnerDto>(key: K, value: UpdatePartnerDto[K]) {
    setEdits((f) => ({ ...f, [key]: value }));
  }

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (!partner) return <p className="text-slate-500">Partner not found.</p>;

  const previewName = form.app_name || partner.app_name;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Branding & features</h1>
          <p className="mt-1 text-sm text-slate-500">
            Controls how {partner.name} clients experience the app.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-sm text-slate-500">{message}</span>}
          <button
            onClick={() => save()}
            disabled={isPending}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* ── Identity ─────────────────────────────────────────────────── */}
      <Section title="Identity" description="Logo, colour and name shown to the partner's clients.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Partner name">
            <input className={inputCls} value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="App name" hint="Replaces “Ledgr” throughout the UI">
            <input className={inputCls} value={form.app_name ?? ''} onChange={(e) => set('app_name', e.target.value)} />
          </Field>
          <Field label="Logo URL">
            <input className={inputCls} value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} />
          </Field>
          <Field label="Primary colour">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.primary_colour ?? '#0F766E'}
                onChange={(e) => set('primary_colour', e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-slate-300"
              />
              <input
                className={inputCls}
                value={form.primary_colour ?? ''}
                onChange={(e) => set('primary_colour', e.target.value)}
              />
            </div>
          </Field>
          <Field label="Support email">
            <input
              className={inputCls}
              value={form.support_email ?? ''}
              onChange={(e) => set('support_email', e.target.value)}
            />
          </Field>
          <Field label="Support phone">
            <input
              className={inputCls}
              value={form.support_phone ?? ''}
              onChange={(e) => set('support_phone', e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {form.logo_url ? (
            <img src={form.logo_url} alt="" className="h-10 w-10 rounded-lg object-contain" />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ backgroundColor: form.primary_colour ?? '#0F766E' }}
            >
              {(previewName ?? 'L').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="text-sm">
            <div className="font-semibold text-slate-900">{previewName}</div>
            <div className="text-slate-500">{form.support_email || 'no support email set'}</div>
          </div>
        </div>
      </Section>

      {/* ── Domains ──────────────────────────────────────────────────── */}
      <Section title="Domains" description="Where the branded app is served from.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subdomain" hint={`${form.slug || 'slug'}.${PLATFORM_ROOT_DOMAIN}`}>
            <input
              className={inputCls}
              value={form.slug ?? ''}
              onChange={(e) => set('slug', slugify(e.target.value))}
            />
          </Field>
          <Field label="Custom domain" hint="Point a CNAME at the Ledgr app first">
            <input
              className={inputCls}
              value={form.custom_domain ?? ''}
              onChange={(e) => set('custom_domain', e.target.value.toLowerCase())}
              placeholder="accounting.nbsmw.com"
            />
          </Field>
        </div>
      </Section>

      {/* ── Onboarding copy ──────────────────────────────────────────── */}
      <Section
        title="Onboarding"
        description="Replaces “Create your Ledgr account” on the branded sign-up page."
      >
        <div className="grid gap-4">
          <Field label="Sign-up heading">
            <input
              className={inputCls}
              value={form.onboarding_title ?? ''}
              onChange={(e) => set('onboarding_title', e.target.value)}
              placeholder={`Create your ${previewName} account`}
            />
          </Field>
          <Field label="Sign-up subheading">
            <input
              className={inputCls}
              value={form.onboarding_subtitle ?? ''}
              onChange={(e) => set('onboarding_subtitle', e.target.value)}
              placeholder={`Accounting for ${partner.name} business customers`}
            />
          </Field>
        </div>
      </Section>

      {/* ── Feature flags ────────────────────────────────────────────── */}
      <Section
        title="Modules"
        description="Switch modules off for a lite MFI offering, or leave everything on for a full bank offering."
      >
        <div className="mb-4 flex gap-2">
          {(['lite', 'full'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setFlagEdits({ ...PARTNER_FEATURE_PRESETS[preset] })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold capitalize text-slate-600 hover:border-slate-400"
            >
              Apply {preset} preset
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PARTNER_FEATURE_KEYS.map((key) => {
            const on = flags[key] !== false;
            return (
              <button
                key={key}
                onClick={() => setFlagEdits((f) => ({ ...f, [key]: !on }))}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
                  on ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                    on ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`h-4 w-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`}
                  />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">
                    {PARTNER_FEATURE_LABELS[key]}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {PARTNER_FEATURE_DESCRIPTIONS[key]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── Isolation & limits ───────────────────────────────────────── */}
      <Section
        title="Clients & isolation"
        description="How many SMEs this partner may onboard, and whether they can see one another."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client limit" hint={isPlatformAdmin ? undefined : 'Set by Ledgr'}>
            <input
              type="number"
              min={1}
              disabled={!isPlatformAdmin}
              className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}
              value={form.client_limit ?? 0}
              onChange={(e) => set('client_limit', Number(e.target.value))}
            />
          </Field>
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
            <input
              id="visibility"
              type="checkbox"
              className="mt-1"
              checked={Boolean(form.allow_client_visibility)}
              onChange={(e) => set('allow_client_visibility', e.target.checked)}
            />
            <label htmlFor="visibility" className="text-sm">
              <span className="block font-semibold text-slate-900">Let clients see each other</span>
              <span className="block text-xs text-slate-500">
                Off by default. When off, each SME's data is completely isolated; partner admins
                still get read-only visibility of every client.
              </span>
            </label>
          </div>
        </div>
      </Section>

      {/* ── Billing contact ──────────────────────────────────────────── */}
      <Section
        title="Billing"
        description="Ledgr invoices the partner, not the partner's SME clients."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Billing contact">
            <input
              className={inputCls}
              value={form.billing_contact_name ?? ''}
              onChange={(e) => set('billing_contact_name', e.target.value)}
            />
          </Field>
          <Field label="Billing email">
            <input
              className={inputCls}
              value={form.billing_email ?? ''}
              onChange={(e) => set('billing_email', e.target.value)}
            />
          </Field>
          <Field label="Price per client / month">
            <input
              type="number"
              min={0}
              disabled={!isPlatformAdmin}
              className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}
              value={form.price_per_client ?? 0}
              onChange={(e) => set('price_per_client', Number(e.target.value))}
            />
          </Field>
          <Field label="Billing currency">
            <input
              className={inputCls}
              disabled={!isPlatformAdmin}
              value={form.billing_currency ?? 'MWK'}
              onChange={(e) => set('billing_currency', e.target.value.toUpperCase())}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 mb-5 text-sm text-slate-500">{description}</p>}
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export default PartnerSettingsPage;
