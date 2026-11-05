import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { partnerPortalRepository } from '@/dal/repositories/PartnerPortalRepository';
import { PLANS, normalizePlanTier } from '@/lib/billing/plans';
import type { PartnerClientUsage } from '@/types/partners';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PartnerBillingRepository } from '@/dal/repositories/PartnerBillingRepository';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';
import type { PartnerInvoice } from '@/types/partners';

const STATUS_STYLES: Record<PartnerInvoice['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-slate-100 text-slate-400 line-through',
};

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getBillingStatus(expiresAt: string | null): 'active' | 'gracePeriod' | 'overdue' {
  if (!expiresAt) return 'active';
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry) || expiry > Date.now()) return 'active';
  return Date.now() - expiry <= 7 * 24 * 60 * 60 * 1000 ? 'gracePeriod' : 'overdue';
}

function exportClientBillingCsv(clients: PartnerClientUsage[], partnerPrice: number, currency: string, t: (key: string) => string) {
  const headers = [t('partner.clientName'), t('partner.plan'), t('partner.monthlyPlanValue'), t('partner.billingModel'), t('partner.billingStatus'), t('partner.nextRenewal'), t('partner.monthlyTransactions'), t('partner.wholesaleEstimate')];
  const csvCell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = clients.map((client) => {
    const tier = normalizePlanTier(client.plan_tier);
    return [client.business_name, t(`partner.planTiers.${tier}`), PLANS[tier].priceMWK, t('partner.partnerInvoiced'), t(`partner.${getBillingStatus(client.plan_expires_at)}`), client.plan_expires_at?.slice(0, 10) ?? '', client.monthly_transaction_count, `${currency} ${partnerPrice}`];
  });
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'partner-client-billing.csv';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Partner-level billing: Ledgr invoices the bank/MFI for the number of SME
 * clients on the platform. The SMEs themselves are never charged by Ledgr.
 */
export function PartnerBillingPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const { isPlatformAdmin } = usePartnerAdminAccess();

  const { data: partner } = useQuery({
    queryKey: ['partner', id],
    queryFn: () => PartnerRepository.getById(id),
    enabled: Boolean(id),
  });

  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ['partner-usage', id],
    queryFn: () => partnerPortalRepository.getPartnerClients(id),
    enabled: Boolean(id),
  });

  const { data: clientCount = 0 } = useQuery({
    queryKey: ['partner-client-count', id],
    queryFn: () => PartnerRepository.getClientCount(id),
    enabled: Boolean(id),
  });

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['partner-invoices', id],
    queryFn: () => PartnerBillingRepository.getInvoicesForPartner(id),
    enabled: Boolean(id),
  });

  const currency = partner?.billing_currency ?? 'MWK';
  const monthly = (partner?.price_per_client ?? 0) * clientCount;
  const estimatedPlanValue = clients.reduce((total, client) => total + PLANS[normalizePlanTier(client.plan_tier)].priceMWK, 0);
  const monthlyTransactions = clients.reduce((total, client) => total + client.monthly_transaction_count, 0);
  const planBreakdown = (Object.keys(PLANS) as (keyof typeof PLANS)[])
    .map((tier) => ({ tier, count: clients.filter((client) => normalizePlanTier(client.plan_tier) === tier).length }))
    .filter((entry) => entry.count > 0);

  // Bills the month that just closed — the same period the monthly
  // generate-partner-invoices cron uses, so a manual run and the automated
  // run can't produce two invoices for the same period (the DB rejects the
  // duplicate on partner_invoices_period_key).
  const { mutate: raiseInvoice, isPending } = useMutation({
    mutationFn: async () => {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      const due = new Date(end.getTime() + 14 * 24 * 60 * 60 * 1000);
      await PartnerBillingRepository.createInvoice({
        partnerId: id,
        amount: monthly,
        currency,
        periodStart: start.toISOString().slice(0, 10),
        periodEnd: end.toISOString().slice(0, 10),
        dueDate: due.toISOString().slice(0, 10),
        clientCount,
        notes: `${clientCount} client${clientCount === 1 ? '' : 's'} @ ${money(partner?.price_per_client ?? 0, currency)} per month`,
      });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['partner-invoices', id] });
    },
    onError: (e: Error) =>
      setError(
        /duplicate key|partner_invoices_period_key/i.test(e.message)
          ? 'An invoice for last month already exists for this partner.'
          : e.message,
      ),
  });

  const { mutate: setStatus } = useMutation({
    mutationFn: ({ invoiceId, status }: { invoiceId: string; status: PartnerInvoice['status'] }) =>
      PartnerBillingRepository.updateStatus(invoiceId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['partner-invoices', id] }),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Billing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ledgr invoices {partner?.name ?? 'the partner'} directly. The partner sets its own pricing
          for its SME clients — those businesses are never billed by Ledgr.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Invoices are raised automatically on the 1st of each month for the month just ended.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Billable clients" value={String(clientCount)} />
        <Stat label="Price per client" value={money(partner?.price_per_client ?? 0, currency)} />
        <Stat label="Current monthly total" value={money(monthly, currency)} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">{t('partner.clientBillingOverview')}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{t('partner.billingEstimateDisclosure')}</p>
          </div>
          <button
            type="button"
            onClick={() => exportClientBillingCsv(clients, partner?.price_per_client ?? 0, currency, t)}
            disabled={clientsLoading || clients.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('partner.exportCsv')}
          </button>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat label={t('partner.estimatedClientPlanValue')} value={money(estimatedPlanValue, 'MWK')} />
          <Stat label={t('partner.monthlyTransactions')} value={monthlyTransactions.toLocaleString()} />
          <Stat label={t('partner.estimatedPartnerInvoice')} value={money(monthly, currency)} />
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {planBreakdown.map(({ tier, count }) => (
            <span key={tier} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
              {t(`partner.planTiers.${tier}`)}: {count}
            </span>
          ))}
          {planBreakdown.length === 0 && <span className="text-sm text-slate-400">{t('partner.noClientBillingRows')}</span>}
        </div>

        {clientsLoading ? <p className="text-sm text-slate-400">{t('partner.loading')}</p> : clients.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{t('partner.noClientBillingRows')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-2">{t('partner.clientName')}</th>
                  <th scope="col" className="py-2">{t('partner.plan')}</th>
                  <th scope="col" className="py-2">{t('partner.monthlyPlanValue')}</th>
                  <th scope="col" className="py-2">{t('partner.billingModel')}</th>
                  <th scope="col" className="py-2">{t('partner.billingStatus')}</th>
                  <th scope="col" className="py-2">{t('partner.nextRenewal')}</th>
                  <th scope="col" className="py-2">{t('partner.monthlyTransactions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((client) => {
                  const tier = normalizePlanTier(client.plan_tier);
                  const billingStatus = getBillingStatus(client.plan_expires_at);
                  return (
                    <tr key={client.business_id}>
                      <td className="py-3 font-medium text-slate-900">{client.business_name}</td>
                      <td className="py-3 text-slate-600">{t(`partner.planTiers.${tier}`)}</td>
                      <td className="py-3 text-slate-600">{money(PLANS[tier].priceMWK, 'MWK')}</td>
                      <td className="py-3 text-slate-600">{t('partner.partnerInvoiced')}</td>
                      <td className="py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${billingStatus === 'active' ? 'bg-emerald-100 text-emerald-700' : billingStatus === 'gracePeriod' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{t(`partner.${billingStatus}`)}</span></td>
                      <td className="py-3 text-slate-500">{formatDate(client.plan_expires_at)}</td>
                      <td className="py-3 text-slate-600">{client.monthly_transaction_count.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Invoices</h2>
          {isPlatformAdmin && (
            <button
              onClick={() => raiseInvoice()}
              disabled={isPending}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              title="Raises last month's invoice now, if the monthly job hasn't already"
            >
              {isPending ? 'Raising…' : 'Raise invoice manually'}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        {isLoading ? (
          <p className="text-slate-400">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No invoices yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-2">Invoice</th>
                <th scope="col" className="py-2">Period</th>
                <th scope="col" className="py-2">Clients</th>
                <th scope="col" className="py-2">Amount</th>
                <th scope="col" className="py-2">Due</th>
                <th scope="col" className="py-2">Status</th>
                {isPlatformAdmin && <th scope="col" className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-3 font-medium text-slate-900">{inv.invoice_number ?? inv.id.slice(0, 8)}</td>
                  <td className="py-3 text-slate-500">
                    {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                  </td>
                  <td className="py-3 text-slate-600">{inv.client_count}</td>
                  <td className="py-3 font-medium text-slate-900">{money(inv.amount, inv.currency)}</td>
                  <td className="py-3 text-slate-500">{formatDate(inv.due_date)}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[inv.status]}`}>
                      {inv.status}
                    </span>
                  </td>
                  {isPlatformAdmin && (
                    <td className="py-3 text-right">
                      <select
                        value={inv.status}
                        onChange={(e) =>
                          setStatus({ invoiceId: inv.id, status: e.target.value as PartnerInvoice['status'] })
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        {(['draft', 'sent', 'paid', 'overdue', 'void'] as const).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default PartnerBillingPage;
