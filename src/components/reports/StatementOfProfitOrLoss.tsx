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

const financialStatementRepo = new FinancialStatementRepository(repos.account.db);

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  comparativePeriodStart?: string | null;
  comparativePeriodEnd?: string | null;
  businessName?: string;
  preparerName?: string;
}

function SectionRows({ section, showComparative, negateForDisplay }: {
  section: StatementSection; showComparative: boolean; negateForDisplay?: boolean;
}) {
  const sign = negateForDisplay ? -1 : 1;
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
          <td className="py-1 text-right text-sm text-sub">{formatMwk(sign * line.amount)}</td>
          {showComparative && (
            <td className="py-1 text-right text-sm text-muted">
              {line.comparativeAmount !== null ? formatMwk(sign * line.comparativeAmount) : '—'}
            </td>
          )}
        </tr>
      ))}
      <tr className="border-t border-line">
        <td className="py-1.5 text-sm font-semibold text-ink">Total {section.label}</td>
        <td className="py-1.5 text-right text-sm font-semibold text-ink">{formatMwk(sign * section.subtotal)}</td>
        {showComparative && (
          <td className="py-1.5 text-right text-sm font-semibold text-muted">
            {section.comparativeSubtotal !== null ? formatMwk(sign * section.comparativeSubtotal) : '—'}
          </td>
        )}
      </tr>
    </>
  );
}

function SubtotalRow({
  label, amount, comparativeAmount, showComparative, highlight,
}: {
  label: string; amount: number; comparativeAmount: number | null; showComparative: boolean; highlight?: boolean;
}) {
  return (
    <tr className={highlight ? 'bg-brand-500/10' : 'border-t border-line'}>
      <td className="py-2 text-sm font-bold text-ink">{label}</td>
      <td className={`py-2 text-right text-sm font-bold ${amount < 0 ? 'text-danger' : 'text-ink'}`}>
        {formatMwk(amount)}
      </td>
      {showComparative && (
        <td className={`py-2 text-right text-sm font-bold ${(comparativeAmount ?? 0) < 0 ? 'text-danger' : 'text-sub'}`}>
          {comparativeAmount !== null ? formatMwk(comparativeAmount) : '—'}
        </td>
      )}
    </tr>
  );
}

export function StatementOfProfitOrLoss({
  businessId, periodStart, periodEnd,
  comparativePeriodStart = null, comparativePeriodEnd = null,
  businessName, preparerName,
}: Props) {
  const { data: pl, isLoading, error } = useQuery({
    queryKey: ['profit_or_loss', businessId, periodStart, periodEnd, comparativePeriodStart, comparativePeriodEnd],
    queryFn: () => financialStatementRepo.getProfitOrLoss(
      businessId, periodStart, periodEnd, comparativePeriodStart, comparativePeriodEnd,
    ),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const showComparative = Boolean(comparativePeriodStart && comparativePeriodEnd);

  const periodLabel = useMemo(() => {
    const from = new Date(periodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const to = new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${from} to ${to}`;
  }, [periodStart, periodEnd]);

  const comparativeLabel = useMemo(() => {
    if (!comparativePeriodStart || !comparativePeriodEnd) return '';
    const from = new Date(comparativePeriodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const to = new Date(comparativePeriodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${from} to ${to}`;
  }, [comparativePeriodStart, comparativePeriodEnd]);

  if (isLoading) {
    return <div className="space-y-3">{[...Array(12)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface" />)}</div>;
  }

  if (error || !pl) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm text-muted">Could not load Statement of Profit or Loss.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-6 shadow-sm max-w-3xl">
      <div className="mb-6 border-b border-line pb-4">
        {businessName && <h1 className="text-lg font-bold text-ink">{businessName}</h1>}
        <h2 className="text-base font-semibold text-ink">Statement of Profit or Loss</h2>
        <p className="text-xs text-muted">For the period {periodLabel} · Currency: MWK</p>
        {preparerName && <p className="text-xs text-muted">Prepared by: {preparerName}</p>}
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted"></th>
            <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted">{periodLabel}</th>
            {showComparative && (
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted">{comparativeLabel}</th>
            )}
          </tr>
        </thead>
        <tbody>
          <SectionRows section={pl.revenue} showComparative={showComparative} />
          <SectionRows section={pl.costOfSales} showComparative={showComparative} negateForDisplay />

          <SubtotalRow
            label="Gross Profit"
            amount={pl.grossProfit}
            comparativeAmount={pl.comparativeGrossProfit}
            showComparative={showComparative}
          />

          <tr><td colSpan={3} className="pt-4" /></tr>

          <SectionRows section={pl.otherIncome} showComparative={showComparative} />
          <SectionRows section={pl.operatingExpenses} showComparative={showComparative} negateForDisplay />
          <SectionRows section={pl.depreciationAmortisation} showComparative={showComparative} negateForDisplay />

          <SubtotalRow
            label="Operating Profit"
            amount={pl.operatingProfit}
            comparativeAmount={pl.comparativeOperatingProfit}
            showComparative={showComparative}
          />

          <tr><td colSpan={3} className="pt-4" /></tr>

          <SectionRows section={pl.financeCosts} showComparative={showComparative} negateForDisplay />

          <SubtotalRow
            label="Profit Before Tax"
            amount={pl.profitBeforeTax}
            comparativeAmount={pl.comparativeProfitBeforeTax}
            showComparative={showComparative}
          />

          <tr><td colSpan={3} className="pt-4" /></tr>

          <SectionRows section={pl.taxExpense} showComparative={showComparative} negateForDisplay />

          <SubtotalRow
            label="Net Profit / (Loss)"
            amount={pl.netProfit}
            comparativeAmount={pl.comparativeNetProfit}
            showComparative={showComparative}
            highlight
          />
        </tbody>
      </table>
    </div>
  );
}
