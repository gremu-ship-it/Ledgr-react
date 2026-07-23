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
    <tr className="border-t border-line">
      <td className="py-2 text-sm font-medium text-ink">{row.label}</td>
      <td className="py-2 text-right text-sm text-sub">{formatMwk(row.openingBalance)}</td>
      <td className="py-2 text-right text-sm text-sub">{row.netProfitAllocation !== 0 ? formatMwk(row.netProfitAllocation) : '—'}</td>
      <td className="py-2 text-right text-sm text-sub">{row.contributions !== 0 ? formatMwk(row.contributions) : '—'}</td>
      <td className="py-2 text-right text-sm text-sub">{row.drawingsOrDividends !== 0 ? formatMwk(row.drawingsOrDividends) : '—'}</td>
      <td className="py-2 text-right text-sm text-sub">{row.otherMovements !== 0 ? formatMwk(row.otherMovements) : '—'}</td>
      <td className="py-2 text-right text-sm font-semibold text-ink">{formatMwk(row.closingBalance)}</td>
    </tr>
  );
}

export function StatementOfChangesInEquity({ businessId, periodStart, periodEnd, businessName }: Props) {
  const { data: soce, isLoading, error } = useQuery({
    queryKey: ['changes_in_equity', businessId, periodStart, periodEnd],
    queryFn: () => financialStatementRepo.getChangesInEquity(businessId, periodStart, periodEnd),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface" />)}</div>;

  if (error || !soce) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm text-muted">Could not load Statement of Changes in Equity.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card p-6 shadow-sm">
      {businessName && <h1 className="text-lg font-bold text-ink">{businessName}</h1>}
      <h2 className="mb-1 text-base font-semibold text-ink">Statement of Changes in Equity</h2>
      <p className="mb-6 text-xs text-muted">{periodStart} to {periodEnd} · Currency: MWK</p>

      {!soce.reconciles && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-warning/12 p-3 text-xs text-warning">
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
          <tr className="text-xs font-medium uppercase tracking-wide text-muted">
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
          <tr className="border-t-2 border-line bg-brand-500/10">
            <td className="py-2 text-sm font-bold text-ink">Total Equity</td>
            <td className="py-2 text-right text-sm font-bold text-ink">{formatMwk(soce.totalOpeningEquity)}</td>
            <td colSpan={4}></td>
            <td className="py-2 text-right text-sm font-bold text-ink">{formatMwk(soce.totalClosingEquity)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
