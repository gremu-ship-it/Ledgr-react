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

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  // Build a clean, fully self-contained table for the PDF. Do NOT export the
  // on-screen DOM: it relies on Tailwind classes (text-end, font-semibold,
  // py-1, ps-4, bg-brand-50, …) that do not exist inside the standalone PDF
  // document, which is what previously produced unaligned, unstyled output.
  const buildExportHtml = (): string => {
    if (!pl) return '';
    const cols = showComparative ? 3 : 2;
    const numCell = 'padding:7px 12px; text-align:right; font-size:9.5pt; border-bottom:1px solid #f8fafc; font-variant-numeric:tabular-nums;';

    const sectionRows = (section: StatementSection, negate = false): string => {
      const sign = negate ? -1 : 1;
      // Skip entirely empty sections — professional statements omit them.
      if (section.lines.length === 0 && section.subtotal === 0) return '';
      return `
        <tr><td colspan="${cols}" style="padding:16px 12px 6px; font-size:8pt; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#94a3b8;">${escHtml(section.label)}</td></tr>
        ${section.lines.map((line) => `
          <tr>
            <td style="padding:7px 12px 7px 26px; font-size:9.5pt; color:#475569; border-bottom:1px solid #f8fafc;">${escHtml(line.name)}</td>
            <td style="${numCell} color:#334155;">${formatAccounting(sign * line.amount, formatMwk)}</td>
            ${showComparative ? `<td style="${numCell} color:#64748b;">${line.comparativeAmount !== null ? formatAccounting(sign * line.comparativeAmount, formatMwk) : '—'}</td>` : ''}
          </tr>`).join('')}
        <tr>
          <td style="padding:8px 12px 8px 12px; font-size:9.5pt; font-weight:700; color:#0f172a; border-bottom:2px solid #e2e8f0;">${t('common.total')} ${escHtml(section.label)}</td>
          <td style="${numCell} font-weight:700; color:#0f172a; border-bottom:2px solid #e2e8f0;">${formatAccounting(sign * section.subtotal, formatMwk)}</td>
          ${showComparative ? `<td style="${numCell} font-weight:700; color:#475569; border-bottom:2px solid #e2e8f0;">${section.comparativeSubtotal !== null ? formatAccounting(sign * section.comparativeSubtotal, formatMwk) : '—'}</td>` : ''}
        </tr>`;
    };

    const keyRow = (label: string, amount: number, comparative: number | null, opts?: { highlight?: boolean }): string => {
      const dark = opts?.highlight ?? false;
      const colour = dark ? '#ffffff' : amount < 0 ? '#dc2626' : '#0f172a';
      const cmpColour = dark ? '#e2e8f0' : (comparative ?? 0) < 0 ? '#dc2626' : '#475569';
      const rowStyle = dark ? 'background:#0f172a;' : 'background:#f8fafc;';
      const cell = `padding:${dark ? 12 : 10}px 12px; font-size:${dark ? 10.5 : 9.5}pt; font-weight:700;`;
      return `
        <tr style="${rowStyle}">
          <td style="${cell} color:${dark ? '#ffffff' : '#0f172a'};">${label}</td>
          <td style="${cell} text-align:right; color:${colour}; font-variant-numeric:tabular-nums;">${formatAccounting(amount, formatMwk)}</td>
          ${showComparative ? `<td style="${cell} text-align:right; color:${cmpColour}; font-variant-numeric:tabular-nums;">${comparative !== null ? formatAccounting(comparative, formatMwk) : '—'}</td>` : ''}
        </tr>
        ${dark ? '' : `<tr><td colspan="${cols}" style="padding:2px;"></td></tr>`}`;
    };

    return `
      <table style="width:100%; border-collapse:collapse; margin-top:4px; font-size:9.5pt;">
        <thead><tr style="background:#0f172a;">
          <th style="padding:10px 12px; text-align:left; font-size:8pt; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#ffffff;"></th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#ffffff;">${escHtml(periodLabel)}</th>
          ${showComparative ? `<th style="padding:10px 12px; text-align:right; font-size:8pt; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#ffffff;">${escHtml(comparativeLabel)}</th>` : ''}
        </tr></thead>
        <tbody>
          ${sectionRows(pl.revenue)}
          ${sectionRows(pl.costOfSales, true)}
          ${keyRow(t('reports.grossProfit'), pl.grossProfit, pl.comparativeGrossProfit)}
          ${sectionRows(pl.otherIncome)}
          ${sectionRows(pl.operatingExpenses, true)}
          ${sectionRows(pl.depreciationAmortisation, true)}
          ${keyRow(t('reports.operatingProfit'), pl.operatingProfit, pl.comparativeOperatingProfit)}
          ${sectionRows(pl.financeCosts, true)}
          ${keyRow(t('reports.profitBeforeTax'), pl.profitBeforeTax, pl.comparativeProfitBeforeTax)}
          ${sectionRows(pl.taxExpense, true)}
          ${keyRow(t('reports.netProfitLoss'), pl.netProfit, pl.comparativeNetProfit, { highlight: true })}
        </tbody>
      </table>
    `;
  };

  const handleExportPDF = () => {
    if (!pl) return;
    exportReportAsPDF({
      title: t('reports.statementOfProfitOrLoss'),
      subtitle: `${periodLabel} — ${brandName}`,
      dateLabel: periodLabel,
      currency: 'MWK',
      preparerName,
      notes,
      businessName: brandName,
      business: businessBranding,
      htmlContent: buildExportHtml(),
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
      business: businessBranding,
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
