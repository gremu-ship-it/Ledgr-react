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
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { businessRowToBranding } from '@/lib/documents/types';
import type { Row } from '@/dal/types/database';

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
            <td className="py-1 text-end text-sm text-gray-600">
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
  const { business: brandBusiness, businessName: brandName, logoUrl, brandColor } = useBrandTheme();

  const { data: sofp, isLoading, error } = useQuery({
    queryKey: ['sofp', businessId, asOfDate, comparativeDate],
    queryFn: () => financialStatementRepo.getSOFP(businessId, asOfDate, comparativeDate),
    enabled: Boolean(businessId && asOfDate),
  });

  // Read-only data-quality audit over exactly what this statement is built
  // from: asset register vs GL (fixed assets), bank GL vs latest locked
  // statements (reconciliation variance), and FX rate snapshots. Failures are
  // surfaced below the statement — figures still render, but flagged.
  const { data: integrity } = useQuery({
    queryKey: ['sofp-integrity', businessId, asOfDate],
    queryFn: () => financialStatementRepo.auditStatementIntegrity(businessId, asOfDate),
    enabled: Boolean(businessId && asOfDate),
  });
  // Some checks intentionally classify a variance as a warning rather than a
  // hard failure (for example asset cost can differ after revaluation). Do not
  // hide those findings: an uncapitalised register asset also presents as a
  // cost variance, and hiding it made a zero Non-Current Assets figure look
  // trustworthy.
  const integrityFindings = integrity?.checks.filter((check) => !check.ok || check.findings.length > 0) ?? [];

  const showComparative = Boolean(comparativeDate);
  const dateLabel = format.date(asOfDate, { day: 'numeric', month: 'long', year: 'numeric' });
  // getSOFP computes in the business functional currency (amount_base).
  // Previously every amount was formatted 'MWK' regardless — mislabeling the
  // statement for any business whose base currency is USD/ZAR/etc.
  const functionalCurrency = (brandBusiness as Row<'businesses'> | undefined)?.base_currency || 'MWK';
  const formatFunctional = (value: number) => format.currency(value, functionalCurrency);
  const sectionProps = { showComparative, formatCurrency: formatFunctional, totalLabel: t('common.total') };
  const totalProps = { showComparative, formatCurrency: formatFunctional };

  const businessBranding = brandBusiness
    ? businessRowToBranding(brandBusiness as Row<'businesses'>)
    : { name: brandName || 'Business', logoUrl: logoUrl || null, brandColor: brandColor || null, baseCurrency: functionalCurrency };

  useEffect(() => {
    if (sofp && !sofp.isBalanced) {
      pushSofpBalanceWarning(
        formatAccounting(sofp.netAssets, formatFunctional),
        formatAccounting(sofp.totalEquity, formatFunctional),
        businessId,
      );
    }
  }, [sofp]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildProfessionalHtml = () => {
    if (!sofp) return '';
    // Build a polished standalone table for export
    const rowsHtml = (section: StatementSection, label: string) => {
      const lines = section.lines.map((line) => `
        <tr>
          <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; font-size:9.5pt;">${line.name}</td>
          <td style="padding:8px 12px; text-align:right; border-bottom:1px solid #f1f5f9; font-size:9.5pt;">${formatAccounting(line.amount, formatFunctional)}</td>
          ${showComparative ? `<td style="padding:8px 12px; text-align:right; border-bottom:1px solid #f1f5f9; font-size:9.5pt; color:#64748b;">${line.comparativeAmount !== null ? formatAccounting(line.comparativeAmount, formatFunctional) : '—'}</td>` : ''}
        </tr>
      `).join('');
      const total = `
        <tr style="background:#f8fafc; font-weight:700;">
          <td style="padding:10px 12px;">Total ${label}</td>
          <td style="padding:10px 12px; text-align:right;">${formatAccounting(section.subtotal, formatFunctional)}</td>
          ${showComparative ? `<td style="padding:10px 12px; text-align:right; color:#475569;">${section.comparativeSubtotal !== null ? formatAccounting(section.comparativeSubtotal, formatFunctional) : '—'}</td>` : ''}
        </tr>`;
      return `
        <tr><td colspan="${showComparative ? 3 : 2}" style="padding:14px 0 4px 0; font-size:8pt; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#94a3b8;">${section.label}</td></tr>
        ${lines}
        ${total}
      `;
    };
    return `
      <table style="width:100%; border-collapse:collapse; margin-top:8px;">
        <thead><tr style="background:#0f172a; color:white;">
          <th style="padding:10px 12px; text-align:left; font-size:8pt; letter-spacing:0.06em; text-transform:uppercase;">Item</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; letter-spacing:0.06em; text-transform:uppercase;">${dateLabel}</th>
          ${showComparative && comparativeDate ? `<th style="padding:10px 12px; text-align:right; font-size:8pt; letter-spacing:0.06em; text-transform:uppercase;">${format.date(comparativeDate)}</th>` : ''}
        </tr></thead>
        <tbody>
          ${rowsHtml(sofp.currentAssets, sofp.currentAssets.label)}
          ${rowsHtml(sofp.nonCurrentAssets, sofp.nonCurrentAssets.label)}
          <tr style="background:#0f172a; color:white; font-weight:800;"><td style="padding:12px;">Total Assets</td><td style="padding:12px; text-align:right;">${formatAccounting(sofp.totalAssets, formatFunctional)}</td>${showComparative ? `<td style="padding:12px; text-align:right;">${sofp.comparativeTotalAssets !== null ? formatAccounting(sofp.comparativeTotalAssets, formatFunctional) : '—'}</td>` : ''}</tr>
          ${rowsHtml(sofp.currentLiabilities, sofp.currentLiabilities.label)}
          ${rowsHtml(sofp.nonCurrentLiabilities, sofp.nonCurrentLiabilities.label)}
          <tr style="border-top:2px solid #0f172a; font-weight:700;"><td style="padding:12px;">Total Liabilities</td><td style="padding:12px; text-align:right;">${formatAccounting(sofp.totalLiabilities, formatFunctional)}</td>${showComparative ? `<td style="padding:12px; text-align:right;">${sofp.comparativeTotalLiabilities !== null ? formatAccounting(sofp.comparativeTotalLiabilities, formatFunctional) : '—'}</td>` : ''}</tr>
          <tr style="font-weight:700;"><td style="padding:12px;">Net Assets</td><td style="padding:12px; text-align:right;">${formatAccounting(sofp.netAssets, formatFunctional)}</td>${showComparative ? `<td style="padding:12px; text-align:right;">${sofp.comparativeNetAssets !== null ? formatAccounting(sofp.comparativeNetAssets, formatFunctional) : '—'}</td>` : ''}</tr>
          ${rowsHtml(sofp.equity, sofp.equity.label)}
          <tr style="background:#0f172a; color:white; font-weight:800;"><td style="padding:12px;">Total Equity</td><td style="padding:12px; text-align:right;">${formatAccounting(sofp.totalEquity, formatFunctional)}</td>${showComparative ? `<td style="padding:12px; text-align:right;">${sofp.comparativeTotalEquity !== null ? formatAccounting(sofp.comparativeTotalEquity, formatFunctional) : '—'}</td>` : ''}</tr>
        </tbody>
      </table>
    `;
  };

  const handleExportPDF = () => {
    const htmlContent = buildProfessionalHtml() || document.querySelector('.max-w-3xl')?.outerHTML || '';
    exportReportAsPDF({
      title: t('reports.statementOfFinancialPosition'),
      subtitle: `${t('reports.asAt', { date: dateLabel })} — ${brandName}`,
      dateLabel,
      currency: functionalCurrency,
      preparerName,
      notes,
      businessName: brandName,
      business: businessBranding,
      htmlContent,
    });
  };

  const handleExportXBRL = () => {
    if (!sofp) return;
    const facts = [
      { concept: 'TotalAssets', value: sofp.totalAssets },
      { concept: 'TotalLiabilities', value: sofp.totalLiabilities },
      { concept: 'NetAssets', value: sofp.netAssets },
      { concept: 'TotalEquity', value: sofp.totalEquity },
    ];
    exportReportAsXBRL({
      title: t('reports.statementOfFinancialPosition'),
      dateLabel,
      currency: functionalCurrency,
      preparerName,
      notes,
      businessName: brandName,
      business: businessBranding,
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

  return (
    <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title={t('reports.statementOfFinancialPosition')}
        subtitle={`${t('reports.asAt', { date: dateLabel })} · ${t('reports.currencyNote', { currency: functionalCurrency })}`}
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
              netAssets: formatAccounting(sofp.netAssets, formatFunctional),
              totalEquity: formatAccounting(sofp.totalEquity, formatFunctional),
            })}
          </span>
        </div>
      )}

      {integrityFindings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            Data-quality findings ({integrity?.functionalCurrency}) — figures shown may need review
          </div>
          {integrityFindings.map((check) => (
            <details key={check.key} className="mt-1">
              <summary className="cursor-pointer font-medium">{check.summary}</summary>
              <ul className="mt-1 list-disc space-y-0.5 ps-5">
                {check.findings.map((finding, i) => (
                  <li key={i}>{finding}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      <table className="w-full">
        <thead>
          <tr>
            <th scope="col" className="pb-2 text-start text-xs font-medium uppercase tracking-wide text-gray-700">{t('reports.assets')}</th>
            <th scope="col" className="pb-2 text-end text-xs font-medium uppercase tracking-wide text-gray-700">
              {dateLabel}
            </th>
            {showComparative && (
              <th scope="col" className="pb-2 text-end text-xs font-medium uppercase tracking-wide text-gray-700">
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
