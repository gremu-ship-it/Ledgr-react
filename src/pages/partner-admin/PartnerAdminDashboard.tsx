import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';
import { PLATFORM_ROOT_DOMAIN, slugify } from '@/lib/partnerDomain';
import {
  PARTNER_FEATURE_LABELS,
  PARTNER_FEATURE_PRESETS,
  type CreatePartnerDto,
} from '@/types/partners';

export function PartnerAdminDashboard() {
  const { isPlatformAdmin, partners: myPartners, loading: accessLoading } = usePartnerAdminAccess();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: allPartners = [], isLoading } = useQuery({
    queryKey: ['partners', 'all'],
    queryFn: () => PartnerRepository.getAll(true),
    enabled: isPlatformAdmin,
  });

  const { data: clientCounts = {} } = useQuery({
    queryKey: ['partner-client-counts'],
    queryFn: () => PartnerRepository.getClientCounts(),
  });

  const partners = isPlatformAdmin ? allPartners : myPartners;

  const totals = useMemo(
    () => ({
      partners: partners.length,
      capacity: partners.reduce((sum, p) => sum + p.client_limit, 0),
      clients: partners.reduce((sum, p) => sum + (clientCounts[p.id] ?? 0), 0),
    }),
    [partners, clientCounts],
  );

  if (accessLoading || (isPlatformAdmin && isLoading)) {
    return <p className="text-slate-400">Loading partners…</p>;
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Partners</h1>
          <p className="mt-1 text-sm text-slate-500">
            Banks and MFIs offering Ledgr to their SME clients under their own brand.
          </p>
        </div>
        {isPlatformAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            New partner
          </button>
        )}
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Partners" value={totals.partners} />
        <StatCard label="Clients onboarded" value={totals.clients} />
        <StatCard label="Total client capacity" value={totals.capacity} />
      </div>

      {partners.length === 0 ? (
        <EmptyState onCreate={isPlatformAdmin ? () => setShowCreate(true) : undefined} />
      ) : (
        <div className="grid gap-4">
          {partners.map((p) => {
            const used = clientCounts[p.id] ?? 0;
            const pct = p.client_limit ? Math.min(100, Math.round((used / p.client_limit) * 100)) : 0;
            return (
              <Link
                key={p.id}
                to={`/partner-admin/partners/${p.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex items-center gap-4">
                  {p.logo_url ? (
                    <img src={p.logo_url} alt={p.name} className="h-11 w-11 rounded-xl object-contain" />
                  ) : (
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white"
                      style={{ backgroundColor: p.primary_colour }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-slate-900">{p.name}</h3>
                      {!p.is_active && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-slate-500">
                      {p.app_name} ·{' '}
                      {p.custom_domain ?? (p.slug ? `${p.slug}.${PLATFORM_ROOT_DOMAIN}` : 'no domain set')}
                    </p>
                  </div>
                  <div className="w-40 shrink-0 text-right">
                    <div className="text-sm font-semibold text-slate-900">
                      {used} / {p.client_limit}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: p.primary_colour }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-400">clients used</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreatePartnerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ['partners'] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <Building2 className="mx-auto h-8 w-8 text-slate-300" />
      <h3 className="mt-3 font-semibold text-slate-900">No partners yet</h3>
      <p className="mt-1 text-sm text-slate-500">
        Create a bank or MFI partner to give them a branded Ledgr tenant.
      </p>
      {onCreate && (
        <button
          onClick={onCreate}
          className="mt-5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Create partner
        </button>
      )}
    </div>
  );
}

// ── Create partner ─────────────────────────────────────────────────────────

function CreatePartnerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [appName, setAppName] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [colour, setColour] = useState('#1a3a5c');
  const [supportEmail, setSupportEmail] = useState('');
  const [clientLimit, setClientLimit] = useState(100);
  const [preset, setPreset] = useState<'lite' | 'full'>('full');
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const effectiveAppName = appName || name;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const dto: CreatePartnerDto = {
        name: name.trim(),
        slug: effectiveSlug || null,
        app_name: effectiveAppName.trim() || name.trim(),
        custom_domain: customDomain.trim().toLowerCase() || null,
        logo_url: logoUrl.trim() || null,
        primary_colour: colour,
        support_email: supportEmail.trim() || null,
        client_limit: clientLimit,
        onboarding_title: `Create your ${effectiveAppName.trim() || name.trim()} account`,
        allow_client_visibility: false,
      };
      const partner = await PartnerRepository.create(dto);
      await PartnerRepository.setFeatureFlags(partner.id, PARTNER_FEATURE_PRESETS[preset]);
      return partner;
    },
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">New partner</h2>
        <p className="mt-1 text-sm text-slate-500">
          A bank or MFI that will resell Ledgr under its own brand.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-5 space-y-4">
          <Field label="Partner name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="NBS Bank"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subdomain" hint={`${effectiveSlug || 'slug'}.${PLATFORM_ROOT_DOMAIN}`}>
              <input
                className={inputCls}
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="nbs"
              />
            </Field>
            <Field label="Custom domain" hint="Optional vanity domain">
              <input
                className={inputCls}
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="accounting.nbsmw.com"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="App name" hint="Shown in place of “Ledgr”">
              <input
                className={inputCls}
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="NBS Business"
              />
            </Field>
            <Field label="Primary colour">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-300"
                />
                <input className={inputCls} value={colour} onChange={(e) => setColour(e.target.value)} />
              </div>
            </Field>
          </div>

          <Field label="Logo URL">
            <input
              className={inputCls}
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…/logo.svg"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Support email">
              <input
                className={inputCls}
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="support@nbs.mw"
              />
            </Field>
            <Field label="Client limit">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={clientLimit}
                onChange={(e) => setClientLimit(Number(e.target.value))}
              />
            </Field>
          </div>

          <Field label="Package" hint="Which modules the partner's clients get">
            <div className="grid grid-cols-2 gap-2">
              {(['lite', 'full'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm ${
                    preset === p
                      ? 'border-slate-900 bg-slate-50 text-slate-900'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <span className="block font-semibold capitalize">{p}</span>
                  <span className="block text-xs">
                    {p === 'lite'
                      ? 'Core bookkeeping only'
                      : Object.values(PARTNER_FEATURE_LABELS).join(', ')}
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              if (!name.trim()) {
                setError('Partner name is required.');
                return;
              }
              mutate();
            }}
            disabled={isPending}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Creating…' : 'Create partner'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900';

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

export default PartnerAdminDashboard;
