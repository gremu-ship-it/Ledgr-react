import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { PLATFORM_ROOT_DOMAIN } from '@/lib/partnerDomain';
import { PARTNER_FEATURE_KEYS, PARTNER_FEATURE_LABELS } from '@/types/partners';

export function PartnerOverviewPage() {
  const { id = '' } = useParams<{ id: string }>();

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
          <h1 className="text-2xl font-bold text-slate-900">{partner.name}</h1>
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
