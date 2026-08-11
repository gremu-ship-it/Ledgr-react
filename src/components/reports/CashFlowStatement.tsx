import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ReportHeader } from './ReportHeader';
import { exportReportAsPDF, exportReportAsXBRL } from '@/lib/reportExports';
import type { Row } from '@/dal/types/database';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { businessRowToBranding } from '@/lib/documents/types';

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  businessName?: string;
}

export function CashFlowStatement({ businessId, periodStart, periodEnd }: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const { business: brandBusiness, businessName: brandName, logoUrl, brandColor } = useBrandTheme();

  const periodStartMonth = periodStart.slice(0, 7);
  const periodEndMonth = periodEnd.slice(0, 7);

  const { data: cashFlowData, isLoading, error } = useQuery({
    queryKey: ['cash_flow', businessId, periodStartMonth, periodEndMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cash_flow')
        .select('*')
        .eq('business_id', businessId)
        .gte('period', periodStartMonth)
        .lte('period', periodEndMonth)
        .order('period', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const periodLabel = `${periodStart} – ${periodEnd}`;
  const businessBranding = brandBusiness
    ? businessRowToBranding(brandBusiness as Row<'businesses'>)
    : { name: brandName || 'Business', logoUrl: logoUrl || null, brandColor: brandColor || null, baseCurrency: 'MWK' };

  // Build a clean, fully self-contained table for the PDF. Do NOT export the
  // on-screen DOM: it relies on Tailwind classes that do not exist inside the
  // standalone PDF document, which produced unaligned, unformatted output
  // (amounts were also printed raw, without any currency formatting).
  const buildExportHtml = (): string => {
    const rowsData = cashFlowData ?? [];
    const fmt = (value: number | null): string => {
      const n = Number(value ?? 0);
      const abs = `MWK ${Math.abs(n).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return n < 0 ? `(${abs})` : abs;
    };
    const numCell = 'padding:8px 12px; text-align:right; font-size:9.5pt; border-bottom:1px solid #f1f5f9; font-variant-numeric:tabular-nums; color:#334155;';
    const thStyle = 'padding:10px 12px; text-align:right; font-size:8pt; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#ffffff;';

    const totals = rowsData.reduce(
      (acc, row) => ({
        operating: acc.operating + Number(row.operating ?? 0),
        investing: acc.investing + Number(row.investing ?? 0),
        financing: acc.financing + Number(row.financing ?? 0),
        net_change: acc.net_change + Number(row.net_change ?? 0),
      }),
      { operating: 0, investing: 0, financing: 0, net_change: 0 },
    );

    return `
      <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:9.5pt;">
        <thead><tr style="background:#0f172a;">
          <th style="${thStyle.replace('text-align:right', 'text-align:left')}">Period</th>
          <th style="${thStyle}">Operating</th>
          <th style="${thStyle}">Investing</th>
          <th style="${thStyle}">Financing</th>
          <th style="${thStyle}">Net Change</th>
        </tr></thead>
        <tbody>
          ${rowsData.map((row) => `
            <tr>
              <td style="padding:8px 12px; font-size:9.5pt; border-bottom:1px solid #f1f5f9; font-weight:600; color:#0f172a;">${row.period ?? ''}</td>
              <td style="${numCell}">${fmt(row.operating)}</td>
              <td style="${numCell}">${fmt(row.investing)}</td>
              <td style="${numCell}">${fmt(row.financing)}</td>
              <td style="${numCell} font-weight:700; color:#0f172a;">${fmt(row.net_change)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f8fafc;">
            <td style="padding:10px 12px; font-size:9.5pt; font-weight:700; color:#0f172a; border-top:2px solid #0f172a;">Total</td>
            <td style="padding:10px 12px; text-align:right; font-size:9.5pt; font-weight:700; color:#0f172a; border-top:2px solid #0f172a; font-variant-numeric:tabular-nums;">${fmt(totals.operating)}</td>
            <td style="padding:10px 12px; text-align:right; font-size:9.5pt; font-weight:700; color:#0f172a; border-top:2px solid #0f172a; font-variant-numeric:tabular-nums;">${fmt(totals.investing)}</td>
            <td style="padding:10px 12px; text-align:right; font-size:9.5pt; font-weight:700; color:#0f172a; border-top:2px solid #0f172a; font-variant-numeric:tabular-nums;">${fmt(totals.financing)}</td>
            <td style="padding:10px 12px; text-align:right; font-size:9.5pt; font-weight:700; color:#0f172a; border-top:2px solid #0f172a; font-variant-numeric:tabular-nums;">${fmt(totals.net_change)}</td>
          </tr>
        </tfoot>
      </table>`;
  };

  const handleExportPDF = () => {
    if (!cashFlowData || cashFlowData.length === 0) return;
    exportReportAsPDF({
      title: t('reports.cash_flow.title'),
      subtitle: `${periodLabel} — ${brandName}`,
      dateLabel: periodLabel,
      currency: 'MWK',
      notes,
      businessName: brandName,
      business: businessBranding,
      htmlContent: buildExportHtml(),
    });
  };

  const handleExportXBRL = () => {
    const facts = (cashFlowData ?? []).flatMap((row) => (
      row.period === null ? [] : [
        { concept: 'OperatingCashFlow', value: Number(row.operating || 0), date: row.period },
        { concept: 'InvestingCashFlow', value: Number(row.investing || 0), date: row.period },
        { concept: 'FinancingCashFlow', value: Number(row.financing || 0), date: row.period },
      ]
    ));
    exportReportAsXBRL({
      title: t('reports.cash_flow.title'),
      dateLabel: periodLabel,
      currency: 'MWK',
      notes,
      businessName: brandName,
      business: businessBranding,
      htmlContent: '',
      facts,
    });
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading cash flow statement...</div>;
  }

  if (error) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">Failed to load cash flow statement. Please try again.</p>
      </div>
    );
  }

  if (!cashFlowData || cashFlowData.length === 0) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-gray-300" />
        <p className="text-sm text-gray-500">No cash flow data found for the selected period.</p>
        <p className="text-xs text-gray-400">Ensure journal entries are posted and include cash accounts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ReportHeader
        title={t('reports.cash_flow.title')}
        subtitle={periodLabel}
        notes={notes}
        onNotesChange={setNotes}
        onExportPDF={handleExportPDF}
        onExportXBRL={handleExportXBRL}
      />

      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-3 text-left">Period</th>
              <th scope="col" className="py-3 text-right">Operating</th>
              <th scope="col" className="py-3 text-right">Investing</th>
              <th scope="col" className="py-3 text-right">Financing</th>
              <th scope="col" className="py-3 text-right">Net Change</th>
            </tr>
          </thead>
          <tbody>
            {cashFlowData?.map((row: Row<'v_cash_flow'>, index: number) => (
              <tr key={index} className="border-b">
                <td className="py-3">{row.period}</td>
                <td className="py-3 text-right">{row.operating}</td>
                <td className="py-3 text-right">{row.investing}</td>
                <td className="py-3 text-right">{row.financing}</td>
                <td className="py-3 text-right font-medium">{row.net_change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}