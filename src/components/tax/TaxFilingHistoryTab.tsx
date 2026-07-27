import { useState, useMemo } from 'react';
import { Archive, Download, Search } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useTaxFilingHistory, type TaxObligation } from '@/hooks/useTaxObligations';
import { TaxReturnDetailModal } from './TaxReturnDetailModal';
import { formatCurrencyAmount } from '@/lib/currency';
import { formatDueDate } from '@/lib/taxDates';

export function TaxFilingHistoryTab({ businessId }: { businessId: string }) {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const business = currentBusiness?.business;
  const currency = business?.base_currency ?? 'MWK';

  const { history, isLoading } = useTaxFilingHistory(businessId);
  const [search, setSearch] = useState('');
  const [taxFilter, setTaxFilter] = useState<string>('all');
  const [viewing, setViewing] = useState<TaxObligation | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((h) => {
      if (taxFilter !== 'all' && h.taxReturn.tax_code !== taxFilter) return false;
      if (!q) return true;
      return (
        h.label.toLowerCase().includes(q) ||
        h.periodDisplay.toLowerCase().includes(q) ||
        (h.taxReturn.filed_ref ?? '').toLowerCase().includes(q)
      );
    });
  }, [history, search, taxFilter]);

  const taxCodes = useMemo(
    () => Array.from(new Set(history.map((h) => h.taxReturn.tax_code))),
    [history],
  );

  function exportCsv() {
    const rows = [
      ['Tax', 'Period', 'Due date', 'Filed on', 'Filing reference', `Amount (${currency})`, `Paid (${currency})`, 'Status'],
      ...filtered.map((h) => [
        h.label,
        h.periodDisplay,
        h.taxReturn.due_date,
        h.taxReturn.filed_at?.slice(0, 10) ?? '',
        h.taxReturn.filed_ref ?? '',
        Number(h.taxReturn.amount_due).toFixed(2),
        Number(h.taxReturn.amount_paid).toFixed(2),
        h.taxReturn.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tax-filing-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search period or reference…"
              aria-label="Search filing history"
              className="w-64 rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <select
            value={taxFilter}
            onChange={(e) => setTaxFilter(e.target.value)}
            aria-label="Filter by tax type"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All taxes</option>
            {taxCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {filtered.length > 0 && (
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <Archive className="h-7 w-7 text-gray-400" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">
            {history.length === 0 ? 'No filing history yet' : 'No matching returns'}
          </h2>
          <p className="max-w-sm text-sm text-gray-500">
            {history.length === 0
              ? 'Returns move here once they are fully paid.'
              : 'Try a different search or filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Tax</th>
                <th scope="col" className="px-4 py-3 text-left">Period</th>
                <th scope="col" className="hidden px-4 py-3 text-left sm:table-cell">Due date</th>
                <th scope="col" className="hidden px-4 py-3 text-left md:table-cell">Filed</th>
                <th scope="col" className="hidden px-4 py-3 text-left lg:table-cell">Reference</th>
                <th scope="col" className="px-4 py-3 text-right">Amount</th>
                <th scope="col" className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h) => (
                <tr
                  key={h.taxReturn.id}
                  onClick={() => setViewing(h)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{h.label}</td>
                  <td className="px-4 py-3 text-gray-700">{h.periodDisplay}</td>
                  <td className="hidden px-4 py-3 text-gray-500 sm:table-cell">
                    {formatDueDate(h.taxReturn.due_date)}
                  </td>
                  <td className="hidden px-4 py-3 text-gray-500 md:table-cell">
                    {h.taxReturn.filed_at ? formatDueDate(h.taxReturn.filed_at.slice(0, 10)) : '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-gray-500 lg:table-cell">
                    {h.taxReturn.filed_ref ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatCurrencyAmount(Number(h.taxReturn.amount_due), currency)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      h.taxReturn.status === 'paid'
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {h.taxReturn.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <TaxReturnDetailModal
          obligation={viewing}
          jurisdiction={
            (business?.country ?? '').toUpperCase().startsWith('Z') ? 'ZM' : 'MW'
          }
          currency={currency}
          businessName={business?.name ?? ''}
          tpin={business?.tpin}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
