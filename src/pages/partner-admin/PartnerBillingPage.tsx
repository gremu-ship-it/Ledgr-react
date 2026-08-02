import { useState } from 'react';
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

/**
 * Partner-level billing: Ledgr invoices the bank/MFI for the number of SME
 * clients on the platform. The SMEs themselves are never charged by Ledgr.
 */
export function PartnerBillingPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { isPlatformAdmin } = usePartnerAdminAccess();

  const { data: partner } = useQuery({
    queryKey: ['partner', id],
    queryFn: () => PartnerRepository.getById(id),
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
