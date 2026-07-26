import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import type { EquityRollForwardLine } from '@/dal/repositories/FinancialStatementRepository';
import { useLocaleFormat } from '@/i18n';
import { ReportHeader } from './ReportHeader';
import { exportReportAsPDF, exportReportAsXBRL } from '@/lib/reportExports';

function formatAccounting(amount: number, formatCurrency: (value: number) => string): string {
  const formatted = formatCurrency(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
}

const financialStatementRepo = new FinancialStatementRepository(repos.account.db);

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  businessName?: string;
}

function EquityRow({ row, formatCurrency }: { row: EquityRollForwardLine; formatCurrency: (value: number) => string }) {
  const amount = (value: number) => (value !== 0 ? formatAccounting(value, formatCurrency) : '—');

  return (
    <tr className="border-t border-gray-100">
      <td className="py-2 text-sm font-medium text-gray-900">{row.label}</td>
      <td className="py-2 text-end text-sm text-gray-600">{formatAccounting(row.openingBalance, formatCurrency)}</td>
      <td className="py-2 text-end text-sm text-gray-600">{amount(row.netProfitAllocation)}</td>
      <td className="py-2 text-end text-sm text-gray-600">{amount(row.contributions)}</td>
      <td className="py-2 text-end text-sm text-gray-600">{amount(row.drawingsOrDividends)}</td>
      <td className="py-2 text-end text-sm text-gray-600">{amount(row.otherMovements)}</td>
      <td className="py-2 text-end text-sm font-semibold text-gray-900">{formatAccounting(row.closingBalance, formatCurrency)}</td>
    </tr>
  );
}

export function StatementOfChangesInEquity({ businessId, periodStart, periodEnd }: Props) {
  const { t } = useTranslation();
  const format = useLocaleFormat();
  const [notes, setNotes] = useState('');

  const { data: soce, isLoading, error } = useQuery({
    queryKey: ['changes_in_equity', businessId, periodStart, periodEnd],
    queryFn: () => financialStatementRepo.getChangesInEquity(businessId, periodStart, periodEnd),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const formatMwk = (value: number) => format.currency(value, 'MWK');
  const periodLabel = t('reports.period', { start: format.date(periodStart), end: format.date(periodEnd) });

  const handleExportPDF = () => {
    const htmlContent = document.querySelector('.overflow-x-auto')?.outerHTML || '';
    exportReportAsPDF({
      title: t('reports.statementOfChangesInEquity'),
      subtitle: periodLabel,
      dateLabel: periodLabel,
      currency: 'MWK',
      notes,
      businessName: '',
      htmlContent,
    });
  };

  const handleExportXBRL = () => {
    exportReportAsXBRL({
      title: t('reports.statementOfChangesInEquity'),
      dateLabel: periodLabel,
      currency: 'MWK',
      notes,
      businessName: '',
      htmlContent: '',
      facts: [
        { concept: 'ShareCapital', value: soce.shareCapital.closingBalance },
        { concept: 'RetainedEarnings', value: soce.retainedEarnings.closingBalance },
        { concept: 'TotalEquity', value: soce.totalClosingEquity },
      ],
    });
  };

  if (isLoading) return <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;

  if (error || !soce) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">{t('reports.couldNotLoadEquity')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title={t('reports.statementOfChangesInEquity')}
        subtitle={`${periodLabel} · ${t('reports.currencyNote', { currency: 'MWK' })}`}
        notes={notes}
        onNotesChange={setNotes}
        onExportPDF={handleExportPDF}
        onExportXBRL={handleExportXBRL}
      />

      {!soce.reconciles && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{t('reports.equityReconciliationWarning')}</span>
        </div>
      )}

      <table className="w-full min-w-[700px]">
        <thead>
          <tr className="text-xs font-medium uppercase tracking-wide text-gray-400">
            <th className="pb-2 text-start"></th>
            <th className="pb-2 text-end">{t('reports.opening')}</th>
            <th className="pb-2 text-end">{t('reports.netProfit')}</th>
            <th className="pb-2 text-end">{t('reports.contributions')}</th>
            <th className="pb-2 text-end">{t('reports.drawingsDividends')}</th>
            <th className="pb-2 text-end">{t('reports.other')}</th>
            <th className="pb-2 text-end">{t('reports.closing')}</th>
          </tr>
        </thead>
        <tbody>
          <EquityRow row={soce.shareCapital} formatCurrency={formatMwk} />
          <EquityRow row={soce.retainedEarnings} formatCurrency={formatMwk} />
          <EquityRow row={soce.reserves} formatCurrency={formatMwk} />
          <tr className="border-t-2 border-gray-300 bg-brand-50">
            <td className="py-2 text-sm font-bold text-gray-900">{t('reports.totalEquity')}</td>
            <td className="py-2 text-end text-sm font-bold text-gray-900">{formatAccounting(soce.totalOpeningEquity, formatMwk)}</td>
            <td colSpan={4}></td>
            <td className="py-2 text-end text-sm font-bold text-gray-900">{formatAccounting(soce.totalClosingEquity, formatMwk)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
