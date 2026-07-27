import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
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

  const { data: cashFlowData, isLoading } = useQuery({
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
    const facts = (cashFlowData ?? []).flatMap((row: any) => ([
      { concept: 'OperatingCashFlow', value: Number(row.operating || 0), date: row.period },
      { concept: 'InvestingCashFlow', value: Number(row.investing || 0), date: row.period },
      { concept: 'FinancingCashFlow', value: Number(row.financing || 0), date: row.period },
    ]));
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