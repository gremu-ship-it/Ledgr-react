import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Read-only roster of the partner's SME clients with usage stats.
 * Partner admins can view but never edit client data — there is no write
 * policy for them on any business-scoped table.
 */
export function PartnerClientsPage() {
  const { id = '' } = useParams<{ id: string }>();

  const { data: partner } = useQuery({
    queryKey: ['partner', id],
    queryFn: () => PartnerRepository.getById(id),
    enabled: Boolean(id),
  });

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['partner-usage', id],
    queryFn: () => PartnerRepository.getClientUsage(id),
    enabled: Boolean(id),
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            {clients.length} of {partner?.client_limit ?? '—'} client places used.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
          <Eye className="h-3.5 w-3.5" />
          View only
        </span>
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading clients…</p>
      ) : clients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No clients have signed up through this partner yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3">Business</th>
                <th scope="col" className="px-5 py-3">Plan</th>
                <th scope="col" className="px-5 py-3">Users</th>
                <th scope="col" className="px-5 py-3">Invoices</th>
                <th scope="col" className="px-5 py-3">Entries</th>
                <th scope="col" className="px-5 py-3">Onboarded</th>
                <th scope="col" className="px-5 py-3">Last activity</th>
                <th scope="col" className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.business_id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{c.business_name}</td>
                  <td className="px-5 py-3 capitalize text-slate-600">{c.plan_tier ?? 'free'}</td>
                  <td className="px-5 py-3 text-slate-600">{c.user_count}</td>
                  <td className="px-5 py-3 text-slate-600">{c.invoice_count}</td>
                  <td className="px-5 py-3 text-slate-600">{c.journal_entry_count}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(c.onboarded_at)}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(c.last_activity_at)}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        c.is_active !== false
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {c.is_active !== false ? 'Active' : 'Inactive'}
                    </span>
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

export default PartnerClientsPage;
