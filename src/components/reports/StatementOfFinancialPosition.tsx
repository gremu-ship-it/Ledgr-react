import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import type { StatementSection } from '@/dal/repositories/FinancialStatementRepository';

function formatMwk(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `(${formatted})` : formatted;
}

// Single shared instance — repository holds no per-call state, matches the
// pattern of other repos being constructed once in repos.ts. Uses the public
// `db` getter BaseRepository exposes rather than reaching into a private
// field. Not added to repos.ts yet since this is Phase 1; fold in once
// Phase 2/3 land (cash flow, changes in equity, XBRL export all need it too).
const financialStatementRepo = new FinancialStatementRepository(repos.account.db);

interface Props {
  businessId: string;
  asOfDate: string;
  comparativeDate?: string | null;
  businessName?: string;
  preparerName?: string;
}

function SectionRows({ section, showComparative }: { section: StatementSection; showComparative: boolean }) {
  return (
    <>
      <tr>
        <td colSpan={showComparative ? 3 : 2} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {section.label}
        </td>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.code}>
          <td className="py-1 pl-4 text-sm text-sub">{line.name}</td>
          <td className="py-1 text-right text-sm text-sub">{formatMwk(line.amount)}</td>
          {showComparative && (
            <td className="py-1 text-right text-sm text-muted">
              {line.comparativeAmount !== null ? formatMwk(line.comparativeAmount) : '—'}
            </td>
          )}
        </tr>
      ))}
      <tr className="border-t border-line">
        <td className="py-1.5 text-sm font-semibold text-ink">Total {section.label}</td>
        <td className="py-1.5 text-right text-sm font-semibold text-ink">{formatMwk(section.subtotal)}</td>
        {showComparative && (
          <td className="py-1.5 text-right text-sm font-semibold text-muted">
            {section.comparativeSubtotal !== null ? formatMwk(section.comparativeSubtotal) : '—'}
          </td>
        )}
      </tr>
    </>
  );
}

function GrandTotalRow({
  label, amount, comparativeAmount, showComparative, highlight,
}: {
  label: string; amount: number; comparativeAmount: number | null; showComparative: boolean; highlight?: boolean;
}) {
  return (
    <tr className={highlight ? 'bg-brand-500/10' : 'border-t-2 border-line'}>
      <td className="py-2 text-sm font-bold text-ink">{label}</td>
      <td className="py-2 text-right text-sm font-bold text-ink">{formatMwk(amount)}</td>
      {showComparative && (
        <td className="py-2 text-right text-sm font-bold text-sub">
          {comparativeAmount !== null ? formatMwk(comparativeAmount) : '—'}
        </td>
      )}
    </tr>
  );
}

export function StatementOfFinancialPosition({
  businessId, asOfDate, comparativeDate = null, businessName, preparerName,
}: Props) {
  const { data: sofp, isLoading, error } = useQuery({
    queryKey: ['sofp', businessId, asOfDate, comparativeDate],
    queryFn: () => financialStatementRepo.getSOFP(businessId, asOfDate, comparativeDate),
    enabled: Boolean(businessId && asOfDate),
  });

  const showComparative = Boolean(comparativeDate);

  const dateLabel = useMemo(() => new Date(asOfDate).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  }), [asOfDate]);

  if (isLoading) {
    return <div className="space-y-3">{[...Array(10)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface" />)}</div>;
  }

  if (error || !sofp) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm text-muted">Could not load Statement of Financial Position.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-6 shadow-sm max-w-3xl">
      <div className="mb-6 border-b border-line pb-4">
        {businessName && <h1 className="text-lg font-bold text-ink">{businessName}</h1>}
        <h2 className="text-base font-semibold text-ink">Statement of Financial Position</h2>
        <p className="text-xs text-muted">As at {dateLabel} · Currency: MWK</p>
        {preparerName && <p className="text-xs text-muted">Prepared by: {preparerName}</p>}
      </div>

      {!sofp.isBalanced && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-warning/12 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Net Assets ({formatMwk(sofp.netAssets)}) does not equal Total Equity ({formatMwk(sofp.totalEquity)}).
            This usually means the current year's profit or loss hasn't been closed to Retained Earnings
            (account 3130) yet — run a period close, or check for unposted entries.
          </span>
        </div>
      )}

      <table className="w-full">
        <thead>
          <tr>
            <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Assets</th>
            <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted">
              {dateLabel}
            </th>
            {showComparative && (
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted">
                {comparativeDate ? new Date(comparativeDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <SectionRows section={sofp.currentAssets} showComparative={showComparative} />
          <SectionRows section={sofp.nonCurrentAssets} showComparative={showComparative} />
          <GrandTotalRow
            label="Total Assets"
            amount={sofp.totalAssets}
            comparativeAmount={sofp.comparativeTotalAssets}
            showComparative={showComparative}
            highlight
          />

          <tr><td colSpan={3} className="pt-6" /></tr>

          <SectionRows section={sofp.currentLiabilities} showComparative={showComparative} />
          <SectionRows section={sofp.nonCurrentLiabilities} showComparative={showComparative} />
          <GrandTotalRow
            label="Total Liabilities"
            amount={sofp.totalLiabilities}
            comparativeAmount={sofp.comparativeTotalLiabilities}
            showComparative={showComparative}
          />

          <GrandTotalRow
            label="Net Assets"
            amount={sofp.netAssets}
            comparativeAmount={sofp.comparativeNetAssets}
            showComparative={showComparative}
          />

          <tr><td colSpan={3} className="pt-6" /></tr>

          <SectionRows section={sofp.equity} showComparative={showComparative} />
          <GrandTotalRow
            label="Total Equity"
            amount={sofp.totalEquity}
            comparativeAmount={sofp.comparativeTotalEquity}
            showComparative={showComparative}
            highlight
          />
        </tbody>
      </table>
    </div>
  );
}
