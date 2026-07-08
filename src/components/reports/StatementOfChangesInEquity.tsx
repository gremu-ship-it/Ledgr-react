import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import type { EquityRollForwardLine } from '@/dal/repositories/FinancialStatementRepository';

function formatMwk(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `(${formatted})` : formatted;
}

const financialStatementRepo = new FinancialStatementRepository(repos.account.db);

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  businessName?: string;
}

function EquityRow({ row }: { row: EquityRollForwardLine }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-2 text-sm font-medium text-gray-900">{row.label}</td>
      <td className="py-2 text-right text-sm text-gray-600">{formatMwk(row.openingBalance)}</td>
      <td className="py-2 text-right text-sm text-gray-600">{row.netProfitAllocation !== 0 ? formatMwk(row.netProfitAllocation) : '—'}</td>
      <td className="py-2 text-right text-sm text-gray-600">{row.contributions !== 0 ? formatMwk(row.contributions) : '—'}</td>
      <td className="py-2 text-right text-sm text-gray-600">{row.drawingsOrDividends !== 0 ? formatMwk(row.drawingsOrDividends) : '—'}</td>
      <td className="py-2 text-right text-sm text-gray-600">{row.otherMovements !== 0 ? formatMwk(row.otherMovements) : '—'}</td>
      <td className="py-2 text-right text-sm font-semibold text-gray-900">{formatMwk(row.closingBalance)}</td>
    </tr>
  );
}

export function StatementOfChangesInEquity({ businessId, periodStart, periodEnd, businessName }: Props) {
  const { data: soce, isLoading, error } = useQuery({
    queryKey: ['changes_in_equity', businessId, periodStart, periodEnd],
    queryFn: () => financialStatementRepo.getChangesInEquity(businessId, periodStart, periodEnd),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;

  if (error || !soce) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">Could not load Statement of Changes in Equity.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {businessName && <h1 className="text-lg font-bold text-gray-900">{businessName}</h1>}
      <h2 className="mb-1 text-base font-semibold text-gray-900">Statement of Changes in Equity</h2>
      <p className="mb-6 text-xs text-gray-400">{periodStart} to {periodEnd} · Currency: MWK</p>

      {!soce.reconciles && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Total closing equity doesn't tie out to the Statement of Financial Position for this date.
            This is consistent with the known gap flagged on the SOFP tab — no period-close routine yet
            sweeps net profit into Retained Earnings.
          </span>
        </div>
      )}

      <table className="w-full min-w-[700px]">
        <thead>
          <tr className="text-xs font-medium uppercase tracking-wide text-gray-400">
            <th className="pb-2 text-left"></th>
            <th className="pb-2 text-right">Opening</th>
            <th className="pb-2 text-right">Net Profit</th>
            <th className="pb-2 text-right">Contributions</th>
            <th className="pb-2 text-right">Drawings/Div.</th>
            <th className="pb-2 text-right">Other</th>
            <th className="pb-2 text-right">Closing</th>
          </tr>
        </thead>
        <tbody>
          <EquityRow row={soce.shareCapital} />
          <EquityRow row={soce.retainedEarnings} />
          <EquityRow row={soce.reserves} />
          <tr className="border-t-2 border-gray-300 bg-brand-50">
            <td className="py-2 text-sm font-bold text-gray-900">Total Equity</td>
            <td className="py-2 text-right text-sm font-bold text-gray-900">{formatMwk(soce.totalOpeningEquity)}</td>
            <td colSpan={4}></td>
            <td className="py-2 text-right text-sm font-bold text-gray-900">{formatMwk(soce.totalClosingEquity)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
