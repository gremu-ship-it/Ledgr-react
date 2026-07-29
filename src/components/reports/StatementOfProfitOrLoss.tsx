import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import type { StatementSection } from '@/dal/repositories/FinancialStatementRepository';
import { useLocaleFormat } from '@/i18n';
import { ReportHeader } from './ReportHeader';
import { exportReportAsPDF, exportReportAsXBRL } from '@/lib/reportExports';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { businessRowToBranding } from '@/lib/documents/types';
import type { Row } from '@/dal/types/database';

function formatAccounting(amount: number, formatCurrency: (value: number) => string): string {
  const formatted = formatCurrency(Math.abs(amount));
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

function SectionRows({
  section,
  showComparative,
  negateForDisplay,
  formatCurrency,
  totalLabel,
}: {
  section: StatementSection;
  showComparative: boolean;
  negateForDisplay?: boolean;
  formatCurrency: (value: number) => string;
  totalLabel: string;
}) {
  const sign = negateForDisplay ? -1 : 1;
  return (
    <>
      <tr>
        <td colSpan={showComparative ? 3 : 2} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {section.label}
        </td>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.code}>
          <td className="py-1 ps-4 text-sm text-gray-600">{line.name}</td>
          <td className="py-1 text-end text-sm text-gray-600">{formatAccounting(sign * line.amount, formatCurrency)}</td>
          {showComparative && (
            <td className="py-1 text-end text-sm text-gray-600">
              {line.comparativeAmount !== null ? formatAccounting(sign * line.comparativeAmount, formatCurrency) : '—'}
            </td>
          )}
        </tr>
      ))}
      <tr className="border-t border-gray-100">
        <td className="py-1.5 text-sm font-semibold text-gray-900">{totalLabel} {section.label}</td>
        <td className="py-1.5 text-end text-sm font-semibold text-gray-900">{formatAccounting(sign * section.subtotal, formatCurrency)}</td>
        {showComparative && (
          <td className="py-1.5 text-end text-sm font-semibold text-gray-500">
            {section.comparativeSubtotal !== null ? formatAccounting(sign * section.comparativeSubtotal, formatCurrency) : '—'}
          </td>
        )}
      </tr>
    </>
  );
}

function SubtotalRow({
  label,
  amount,
  comparativeAmount,
  showComparative,
  highlight,
  formatCurrency,
}: {
  label: string;
  amount: number;
  comparativeAmount: number | null;
  showComparative: boolean;
  highlight?: boolean;
  formatCurrency: (value: number) => string;
}) {
  return (
    <tr className={highlight ? 'bg-brand-50' : 'border-t border-gray-200'}>
      <td className="py-2 text-sm font-bold text-gray-900">{label}</td>
      <td className={`py-2 text-end text-sm font-bold ${amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
        {formatAccounting(amount, formatCurrency)}
      </td>
      {showComparative && (
        <td className={`py-2 text-end text-sm font-bold ${(comparativeAmount ?? 0) < 0 ? 'text-red-500' : 'text-gray-600'}`}>
          {comparativeAmount !== null ? formatAccounting(comparativeAmount, formatCurrency) : '—'}
        </td>
      )}
    </tr>
  );
}

export function StatementOfProfitOrLoss({
  businessId, periodStart, periodEnd,
  comparativePeriodStart = null, comparativePeriodEnd = null,
  preparerName,
}: Props) {
  const { t } = useTranslation();
  const format = useLocaleFormat();
  const [notes, setNotes] = useState('');
  const { business: brandBusiness, businessName: brandName, logoUrl, brandColor } = useBrandTheme();

  const { data: pl, isLoading, error } = useQuery({
    queryKey: ['profit_or_loss', businessId, periodStart, periodEnd, comparativePeriodStart, comparativePeriodEnd],
    queryFn: () => financialStatementRepo.getProfitOrLoss(
      businessId, periodStart, periodEnd, comparativePeriodStart, comparativePeriodEnd,
    ),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const showComparative = Boolean(comparativePeriodStart && comparativePeriodEnd);
  const formatMwk = (value: number) => format.currency(value, 'MWK');
  const periodLabel = t('reports.period', { start: format.date(periodStart), end: format.date(periodEnd) });
  const comparativeLabel = comparativePeriodStart && comparativePeriodEnd
    ? t('reports.period', { start: format.date(comparativePeriodStart), end: format.date(comparativePeriodEnd) })
    : '';
  const sectionProps = { showComparative, formatCurrency: formatMwk, totalLabel: t('common.total') };
  const subtotalProps = { showComparative, formatCurrency: formatMwk };

  const businessBranding = brandBusiness
    ? businessRowToBranding(brandBusiness as Row<'businesses'>)
    : { name: brandName || 'Business', logoUrl: logoUrl || null, brandColor: brandColor || null, baseCurrency: 'MWK' };

  const handleExportPDF = () => {
    const htmlContent = document.querySelector('.max-w-3xl')?.innerHTML || document.querySelector('.max-w-3xl')?.outerHTML || '';
    exportReportAsPDF({
      title: t('reports.statementOfProfitOrLoss'),
      subtitle: `${periodLabel} — ${brandName}`,
      dateLabel: periodLabel,
      currency: 'MWK',
      preparerName,
      notes,
      businessName: brandName,
      business: businessBranding as any,
      htmlContent,
    });
  };

  const handleExportXBRL = () => {
    if (!pl) return;
    const facts = [
      { concept: 'Revenue', value: pl.revenue.subtotal },
      { concept: 'GrossProfit', value: pl.grossProfit },
      { concept: 'OperatingProfit', value: pl.operatingProfit },
      { concept: 'ProfitBeforeTax', value: pl.profitBeforeTax },
      { concept: 'NetProfit', value: pl.netProfit },
    ];
    exportReportAsXBRL({
      title: t('reports.statementOfProfitOrLoss'),
      dateLabel: periodLabel,
      currency: 'MWK',
      preparerName,
      notes,
      businessName: brandName,
      business: businessBranding as any,
      htmlContent: '',
      facts,
    });
  };

  if (isLoading) {
    return <div className="space-y-3">{[...Array(12)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;
  }

  if (error || !pl) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">{t('reports.couldNotLoadProfitOrLoss')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title={t('reports.statementOfProfitOrLoss')}
        subtitle={`${t('reports.forPeriod', { period: periodLabel })} · ${t('reports.currencyNote', { currency: 'MWK' })}`}
        preparerName={preparerName}
        notes={notes}
        onNotesChange={setNotes}
        onExportPDF={handleExportPDF}
        onExportXBRL={handleExportXBRL}
      />

      <table className="w-full">
        <thead>
          <tr>
            <th scope="col" className="pb-2 text-start text-xs font-medium uppercase tracking-wide text-gray-700"></th>
            <th scope="col" className="pb-2 text-end text-xs font-medium uppercase tracking-wide text-gray-700">{periodLabel}</th>
            {showComparative && (
              <th scope="col" className="pb-2 text-end text-xs font-medium uppercase tracking-wide text-gray-700">{comparativeLabel}</th>
            )}
          </tr>
        </thead>
        <tbody>
          <SectionRows section={pl.revenue} {...sectionProps} />
          <SectionRows section={pl.costOfSales} negateForDisplay {...sectionProps} />

          <SubtotalRow label={t('reports.grossProfit')} amount={pl.grossProfit} comparativeAmount={pl.comparativeGrossProfit} {...subtotalProps} />

          <tr><td colSpan={3} className="pt-4" /></tr>

          <SectionRows section={pl.otherIncome} {...sectionProps} />
          <SectionRows section={pl.operatingExpenses} negateForDisplay {...sectionProps} />
          <SectionRows section={pl.depreciationAmortisation} negateForDisplay {...sectionProps} />

          <SubtotalRow label={t('reports.operatingProfit')} amount={pl.operatingProfit} comparativeAmount={pl.comparativeOperatingProfit} {...subtotalProps} />

          <tr><td colSpan={3} className="pt-4" /></tr>

          <SectionRows section={pl.financeCosts} negateForDisplay {...sectionProps} />

          <SubtotalRow label={t('reports.profitBeforeTax')} amount={pl.profitBeforeTax} comparativeAmount={pl.comparativeProfitBeforeTax} {...subtotalProps} />

          <tr><td colSpan={3} className="pt-4" /></tr>

          <SectionRows section={pl.taxExpense} negateForDisplay {...sectionProps} />

          <SubtotalRow label={t('reports.netProfitLoss')} amount={pl.netProfit} comparativeAmount={pl.comparativeNetProfit} highlight {...subtotalProps} />
        </tbody>
      </table>
    </div>
  );
}
