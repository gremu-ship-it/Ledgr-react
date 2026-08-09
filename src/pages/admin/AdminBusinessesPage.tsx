import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Search, Users } from 'lucide-react';
import { BusinessAdminRepository, type BusinessDirectoryEntry } from '@/dal/repositories/BusinessAdminRepository';

function formatDate(value: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function planBadge(tier: string): string {
  if (tier === 'free') return 'bg-slate-100 text-slate-600';
  if (tier === 'growth') return 'bg-emerald-100 text-emerald-700';
  if (tier === 'pro') return 'bg-blue-100 text-blue-700';
  return 'bg-indigo-100 text-indigo-700'; // enterprise
}

/**
 * Platform-admin directory of every registered business and its owner(s).
 * Reachable at /admin/businesses, gated by PlatformAdminRoute, and backed by
 * the list_all_businesses() SECURITY DEFINER RPC so owners can be resolved
 * even though the client can't read auth.users cross-tenant.
 */
export function AdminBusinessesPage() {
  const [query, setQuery] = useState('');

  const { data: businesses = [], isLoading, error } = useQuery({
    queryKey: ['admin', 'businesses'],
    queryFn: () => BusinessAdminRepository.listAll(),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return businesses;
    return businesses.filter(
      (b: BusinessDirectoryEntry) =>
        b.business_name.toLowerCase().includes(q) ||
        (b.trading_name ?? '').toLowerCase().includes(q) ||
        b.email?.toLowerCase().includes(q) ||
        b.owner_emails.toLowerCase().includes(q) ||
        b.owner_names.toLowerCase().includes(q),
    );
  }, [businesses, query]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Businesses</h1>
          <p className="mt-1 text-sm text-slate-500">
            All registered businesses and their owners. {businesses.length} business{businesses.length === 1 ? '' : 'es'} total.
          </p>
        </div>
        <label className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or owner…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-slate-900"
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
          {error.message}
        </div>
      ) : isLoading ? (
        <p className="text-slate-400">Loading businesses…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">No businesses match your search.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3">Business</th>
                <th scope="col" className="px-5 py-3">Owner(s)</th>
                <th scope="col" className="px-5 py-3">Plan</th>
                <th scope="col" className="px-5 py-3">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((b: BusinessDirectoryEntry) => (
                <tr key={b.business_id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{b.business_name}</div>
                    <div className="text-xs text-slate-500">{b.email || (b.trading_name ? `Trading as ${b.trading_name}` : '—')}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-slate-800">{b.owner_names || 'No owner found'}</span>
                    </div>
                    {b.owner_emails && <div className="mt-0.5 text-xs text-slate-500">{b.owner_emails}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${planBadge(b.plan_tier)}`}>
                      {b.plan_tier}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminBusinessesPage;
