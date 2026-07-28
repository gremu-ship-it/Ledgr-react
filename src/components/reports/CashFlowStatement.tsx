import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ReportHeader } from './ReportHeader';
import { exportReportAsPDF, exportReportAsXBRL } from '@/lib/reportExports';
import type { Row } from '@/dal/types/database';

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  businessName?: string;
}

export function CashFlowStatement({ businessId, periodStart, periodEnd }: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');

  const { data: cashFlowData, isLoading, error } = useQuery({
    queryKey: ['cash_flow', businessId, periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cash_flow')
        .select('*')
        .eq('business_id', businessId)
        .gte('period', periodStart)
        .lte('period', periodEnd)
        .order('period', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const periodLabel = `${periodStart} – ${periodEnd}`;

  const handleExportPDF = () => {
    const htmlContent = document.querySelector('.space-y-6')?.outerHTML || '';
    exportReportAsPDF({
      title: t('reports.cash_flow.title'),
      subtitle: periodLabel,
      dateLabel: periodLabel,
      currency: 'MWK',
      notes,
      businessName: '',
      htmlContent,
    });
  };

  const handleExportXBRL = () => {
    // `period` is nullable on v_cash_flow, and an XBRL fact without a context
    // date is meaningless — drop those rows rather than emitting `null` dates.
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
      businessName: '',
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