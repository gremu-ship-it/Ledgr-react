import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import type { StatementSection } from '@/dal/repositories/FinancialStatementRepository';
import { useLocaleFormat } from '@/i18n';
import { ReportHeader } from './ReportHeader';
import { pushSofpBalanceWarning } from '@/lib/notifications';
import { exportReportAsPDF, exportReportAsXBRL } from '@/lib/reportExports';

function formatAccounting(amount: number, formatCurrency: (value: number) => string): string {
  const formatted = formatCurrency(Math.abs(amount));
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
  businessName?: string; // kept for backward compatibility; ReportHeader now sources name from useBrandTheme
  preparerName?: string;
}

function SectionRows({
  section,
  showComparative,
  formatCurrency,
  totalLabel,
}: {
  section: StatementSection;
  showComparative: boolean;
  formatCurrency: (value: number) => string;
  totalLabel: string;
}) {
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
          <td className="py-1 text-end text-sm text-gray-600">{formatAccounting(line.amount, formatCurrency)}</td>
          {showComparative && (
            <td className="py-1 text-end text-sm text-gray-400">
              {line.comparativeAmount !== null ? formatAccounting(line.comparativeAmount, formatCurrency) : '—'}
            </td>
          )}
        </tr>
      ))}
      <tr className="border-t border-gray-100">
        <td className="py-1.5 text-sm font-semibold text-gray-900">{totalLabel} {section.label}</td>
        <td className="py-1.5 text-end text-sm font-semibold text-gray-900">{formatAccounting(section.subtotal, formatCurrency)}</td>
        {showComparative && (
          <td className="py-1.5 text-end text-sm font-semibold text-gray-500">
            {section.comparativeSubtotal !== null ? formatAccounting(section.comparativeSubtotal, formatCurrency) : '—'}
          </td>
        )}
      </tr>
    </>
  );
}

function GrandTotalRow({
  label, amount, comparativeAmount, showComparative, highlight, formatCurrency,
}: {
  label: string;
  amount: number;
  comparativeAmount: number | null;
  showComparative: boolean;
  highlight?: boolean;
  formatCurrency: (value: number) => string;
}) {
  return (
    <tr className={highlight ? 'bg-brand-50' : 'border-t-2 border-gray-300'}>
      <td className="py-2 text-sm font-bold text-gray-900">{label}</td>
      <td className="py-2 text-end text-sm font-bold text-gray-900">{formatAccounting(amount, formatCurrency)}</td>
      {showComparative && (
        <td className="py-2 text-end text-sm font-bold text-gray-600">
          {comparativeAmount !== null ? formatAccounting(comparativeAmount, formatCurrency) : '—'}
        </td>
      )}
    </tr>
  );
}

export function StatementOfFinancialPosition({
  businessId, asOfDate, comparativeDate = null, preparerName,
}: Props) {
  const { t } = useTranslation();
  const format = useLocaleFormat();
  const [notes, setNotes] = useState('');

  const { data: sofp, isLoading, error } = useQuery({
    queryKey: ['sofp', businessId, asOfDate, comparativeDate],
    queryFn: () => financialStatementRepo.getSOFP(businessId, asOfDate, comparativeDate),
    enabled: Boolean(businessId && asOfDate),
  });

  const showComparative = Boolean(comparativeDate);
  const dateLabel = format.date(asOfDate, { day: 'numeric', month: 'long', year: 'numeric' });
  const formatMwk = (value: number) => format.currency(value, 'MWK');
  const sectionProps = { showComparative, formatCurrency: formatMwk, totalLabel: t('common.total') };
  const totalProps = { showComparative, formatCurrency: formatMwk };

  // Professional PDF export handler
  const handleExportPDF = () => {
    const htmlContent = document.querySelector('.max-w-3xl')?.outerHTML || '';
    exportReportAsPDF({
      title: t('reports.statementOfFinancialPosition'),
      subtitle: `${t('reports.asAt', { date: dateLabel })}`,
      dateLabel,
      currency: 'MWK',
      preparerName,
      notes,
      businessName: '', // ReportHeader handles branding
      htmlContent,
    });
  };

  // XBRL export handler
  const handleExportXBRL = () => {
    const facts = [
      { concept: 'TotalAssets', value: sofp.totalAssets },
      { concept: 'TotalLiabilities', value: sofp.totalLiabilities },
      { concept: 'NetAssets', value: sofp.netAssets },
      { concept: 'TotalEquity', value: sofp.totalEquity },
    ];
    exportReportAsXBRL({
      title: t('reports.statementOfFinancialPosition'),
      dateLabel,
      currency: 'MWK',
      preparerName,
      notes,
      businessName: '',
      htmlContent: '',
      facts,
    });
  };

  if (isLoading) {
    return <div className="space-y-3">{[...Array(10)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;
  }

  if (error || !sofp) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">{t('reports.couldNotLoadSofp')}</p>
      </div>
    );
  }

  // Push the SOFP imbalance warning to the notification bell (only once per render when unbalanced)
  if (!sofp.isBalanced) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      pushSofpBalanceWarning(
        formatAccounting(sofp.netAssets, formatMwk),
        formatAccounting(sofp.totalEquity, formatMwk)
      );
    }, [sofp.netAssets, sofp.totalEquity]);
  }

  return (
    <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title={t('reports.statementOfFinancialPosition')}
        subtitle={`${t('reports.asAt', { date: dateLabel })} · ${t('reports.currencyNote', { currency: 'MWK' })}`}
        preparerName={preparerName}
        notes={notes}
        onNotesChange={setNotes}
        onExportPDF={handleExportPDF}
        onExportXBRL={handleExportXBRL}
      />

      {!sofp.isBalanced && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {t('reports.sofpBalanceWarning', {
              netAssets: formatAccounting(sofp.netAssets, formatMwk),
              totalEquity: formatAccounting(sofp.totalEquity, formatMwk),
            })}
          </span>
        </div>
      )}

      <table className="w-full">
        <thead>
          <tr>
            <th className="pb-2 text-start text-xs font-medium uppercase tracking-wide text-gray-400">{t('reports.assets')}</th>
            <th className="pb-2 text-end text-xs font-medium uppercase tracking-wide text-gray-400">
              {dateLabel}
            </th>
            {showComparative && (
              <th className="pb-2 text-end text-xs font-medium uppercase tracking-wide text-gray-400">
                {comparativeDate ? format.date(comparativeDate, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <SectionRows section={sofp.currentAssets} {...sectionProps} />
          <SectionRows section={sofp.nonCurrentAssets} {...sectionProps} />
          <GrandTotalRow label={t('reports.totalAssets')} amount={sofp.totalAssets} comparativeAmount={sofp.comparativeTotalAssets} highlight {...totalProps} />

          <tr><td colSpan={3} className="pt-6" /></tr>

          <SectionRows section={sofp.currentLiabilities} {...sectionProps} />
          <SectionRows section={sofp.nonCurrentLiabilities} {...sectionProps} />
          <GrandTotalRow label={t('reports.totalLiabilities')} amount={sofp.totalLiabilities} comparativeAmount={sofp.comparativeTotalLiabilities} {...totalProps} />

          <GrandTotalRow label={t('reports.netAssets')} amount={sofp.netAssets} comparativeAmount={sofp.comparativeNetAssets} {...totalProps} />

          <tr><td colSpan={3} className="pt-6" /></tr>

          <SectionRows section={sofp.equity} {...sectionProps} />
          <GrandTotalRow label={t('reports.totalEquity')} amount={sofp.totalEquity} comparativeAmount={sofp.comparativeTotalEquity} highlight {...totalProps} />
        </tbody>
      </table>
    </div>
  );
}
