import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Power, ShieldX, X } from 'lucide-react';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { PartnerAdminRepository } from '@/dal/repositories/PartnerAdminRepository';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';
import { PLATFORM_ROOT_DOMAIN } from '@/lib/partnerDomain';
import { PARTNER_FEATURE_KEYS, PARTNER_FEATURE_LABELS } from '@/types/partners';

export function PartnerOverviewPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isPlatformAdmin } = usePartnerAdminAccess();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmEndAccess, setConfirmEndAccess] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);

  const { data: partner, isLoading } = useQuery({
    queryKey: ['partner', id],
    queryFn: () => PartnerRepository.getById(id),
    enabled: Boolean(id),
  });

  const { data: flags = {} } = useQuery({
    queryKey: ['partner-flags', id],
    queryFn: () => PartnerRepository.getFeatureFlags(id),
    enabled: Boolean(id),
  });

  const { data: usage = [] } = useQuery({
    queryKey: ['partner-usage', id],
    queryFn: () => PartnerRepository.getClientUsage(id),
    enabled: Boolean(id),
  });

  const { data: adminCount = 0 } = useQuery({
    queryKey: ['partner-admins', id],
    queryFn: async () => (await PartnerAdminRepository.list(id)).length,
    enabled: Boolean(id) && isPlatformAdmin,
  });

  const { mutate: toggleActive, isPending: togglingActive } = useMutation({
    mutationFn: () => PartnerRepository.setActive(id, !partner?.is_active),
    onSuccess: () => {
      setDangerError(null);
      setConfirmDeactivate(false);
      void queryClient.invalidateQueries({ queryKey: ['partner', id] });
      void queryClient.invalidateQueries({ queryKey: ['partner-admins', id] });
    },
    onError: (e: Error) => setDangerError(e.message),
  });

  const { mutate: endAccess, isPending: endingAccess } = useMutation({
    mutationFn: () => PartnerAdminRepository.clear(id),
    onSuccess: () => {
      setDangerError(null);
      setConfirmEndAccess(false);
      void queryClient.invalidateQueries({ queryKey: ['partner-admins', id] });
    },
    onError: (e: Error) => setDangerError(e.message),
  });

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (!partner) return <p className="text-slate-500">Partner not found.</p>;

  const activeClients = usage.filter((u) => u.is_active !== false).length;
  const totalInvoices = usage.reduce((s, u) => s + u.invoice_count, 0);
  const totalEntries = usage.reduce((s, u) => s + u.journal_entry_count, 0);

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4">
        {partner.logo_url ? (
          <img src={partner.logo_url} alt={partner.name} className="h-12 w-12 rounded-xl object-contain" />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
            style={{ backgroundColor: partner.primary_colour }}
          >
            {partner.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-slate-900">
            {partner.name}
            {!partner.is_active && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                Inactive
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            {partner.app_name} ·{' '}
            <a
              href={`https://${partner.custom_domain ?? `${partner.slug}.${PLATFORM_ROOT_DOMAIN}`}`}
              className="hover:text-slate-800"
              target="_blank"
              rel="noreferrer"
            >
              {partner.custom_domain ?? `${partner.slug}.${PLATFORM_ROOT_DOMAIN}`}
            </a>
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Clients" value={`${usage.length} / ${partner.client_limit}`} />
        <Stat label="Active clients" value={activeClients} />
        <Stat label="Invoices raised" value={totalInvoices} />
        <Stat label="Journal entries" value={totalEntries} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Enabled modules</h2>
          <Link to={`/partner-admin/partners/${id}/settings`} className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Edit
          </Link>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {PARTNER_FEATURE_KEYS.map((key) => {
            const on = flags[key] !== false;
            return (
              <li key={key} className="flex items-center gap-2 text-sm">
                {on ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <X className="h-4 w-4 text-slate-300" />
                )}
                <span className={on ? 'text-slate-800' : 'text-slate-400 line-through'}>
                  {PARTNER_FEATURE_LABELS[key]}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Data isolation</h2>
        <p className="mt-2 text-sm text-slate-500">
          {partner.allow_client_visibility
            ? 'Clients under this partner can discover each other.'
            : 'Clients are fully isolated from each other (default). Partner admins have read-only visibility of all client data.'}
        </p>
      </section>

      {isPlatformAdmin && (
        <section className="rounded-2xl border border-red-200 bg-red-50/40 p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h2 className="font-semibold text-red-900">Danger zone</h2>
          </div>
          <p className="mt-1 text-sm text-red-700/80">Ledgr-only controls. Existing SME clients keep all their data and modules either way.</p>

          {dangerError && (
            <div className="mt-4 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{dangerError}</div>
          )}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {/* Deactivate / Activate */}
            <div className="rounded-xl border border-red-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-red-600" />
                <h3 className="font-semibold text-slate-900">
                  {partner.is_active ? 'Deactivate partner' : 'Reactivate partner'}
                </h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                {partner.is_active
                  ? 'Soft-suspends the partner: the branded domain stops resolving, new sign-ups stop being linked, and monthly billing stops. Existing client businesses keep working exactly as they do now.'
                  : 'Restores the branded domain, new-client linking and monthly billing for this partner.'}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  Staff can still sign in until you clear their access separately.
                </span>
                {confirmDeactivate ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setConfirmDeactivate(false)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => toggleActive()}
                      disabled={togglingActive}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {togglingActive ? 'Working…' : partner.is_active ? 'Confirm deactivate' : 'Confirm reactivate'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setDangerError(null);
                      setConfirmEndAccess(false);
                      setConfirmDeactivate(true);
                    }}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                      partner.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    {partner.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </div>
            </div>

            {/* End staff access */}
            <div className="rounded-xl border border-red-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <ShieldX className="h-4 w-4 text-red-600" />
                <h3 className="font-semibold text-slate-900">End staff access</h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Removes all {adminCount} staff membership{adminCount === 1 ? '' : 's'}, revoking their access to the
                partner admin portal. Use this to end the relationship. It can be re-added later via Settings → Team.
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  Deactivation does not remove portal access — clearing staff does.
                </span>
                {confirmEndAccess ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setConfirmEndAccess(false)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => endAccess()}
                      disabled={endingAccess}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {endingAccess ? 'Working…' : 'Confirm revoke all'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setDangerError(null);
                      setConfirmDeactivate(false);
                      setConfirmEndAccess(true);
                    }}
                    disabled={adminCount === 0}
                    className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    Revoke all staff access
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default PartnerOverviewPage;
