import { useQuery } from '@tanstack/react-query';
import { AlertCircle, PackageOpen } from 'lucide-react';
import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { ReportHeader } from './ReportHeader';
import { generateProfessionalReportDocument } from '@/lib/documents/documentGenerator';
import { businessRowToBranding } from '@/lib/documents/types';
import { buildRevenueBreakdown, type RevenueInvoice, type RevenueInvoiceLine } from '@/lib/revenueBreakdown';
import type { Row } from '@/dal/types/database';

const REVENUE_INVOICE_TYPES = ['invoice', 'credit_note', 'debit_note'];

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
}

interface BreakdownData {
  invoices: RevenueInvoice[];
  lines: RevenueInvoiceLine[];
  productNames: Map<string, string>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

/** Revenue earned from invoice lines, grouped by the product or service sold. */
export function RevenueBreakdownReport({ businessId, periodStart, periodEnd }: Props) {
  const { business: brandBusiness, businessName, logoUrl, brandColor } = useBrandTheme();
  const functionalCurrency = (brandBusiness as Row<'businesses'> | undefined)?.base_currency || 'MWK';
  const formatCurrency = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: functionalCurrency, minimumFractionDigits: 2,
  }).format(value);

  const { data, isLoading, isError } = useQuery<BreakdownData>({
    queryKey: ['revenue-breakdown', businessId, periodStart, periodEnd],
    enabled: Boolean(businessId && periodStart && periodEnd),
    queryFn: async () => {
      const { data: invoiceRows, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, invoice_type, exchange_rate')
        .eq('business_id', businessId)
        .in('invoice_type', REVENUE_INVOICE_TYPES)
        .neq('status', 'void')
        .gte('issue_date', periodStart)
        .lte('issue_date', periodEnd)
        .is('deleted_at', null);
      if (invoiceError) throw invoiceError;

      const invoices = (invoiceRows ?? []) as RevenueInvoice[];
      if (invoices.length === 0) return { invoices, lines: [], productNames: new Map() };

      const { data: lineRows, error: lineError } = await supabase
        .from('invoice_lines')
        .select('invoice_id, product_id, description, quantity, line_subtotal, line_total, tax_amount')
        .eq('business_id', businessId)
        .in('invoice_id', invoices.map((invoice) => invoice.id));
      if (lineError) throw lineError;

      const lines = (lineRows ?? []) as RevenueInvoiceLine[];
      const productIds = [...new Set(lines.map((line) => line.product_id).filter((id): id is string => Boolean(id)))];
      const productNames = new Map<string, string>();
      if (productIds.length > 0) {
        const { data: products, error: productError } = await supabase
          .from('products')
          .select('id, name')
          .eq('business_id', businessId)
          .in('id', productIds)
          .is('deleted_at', null);
        if (productError) throw productError;
        for (const product of products ?? []) productNames.set(product.id, product.name);
      }

      return { invoices, lines, productNames };
    },
  });

  const rows = useMemo(
    () => data ? buildRevenueBreakdown(data.invoices, data.lines, data.productNames) : [],
    [data],
  );
  const totalRevenue = rows.reduce((total, row) => total + row.amount, 0);
  const periodLabel = `${new Date(`${periodStart}T00:00:00`).toLocaleDateString()} – ${new Date(`${periodEnd}T00:00:00`).toLocaleDateString()}`;
  const businessBranding = brandBusiness
    ? businessRowToBranding(brandBusiness as Row<'businesses'>)
    : { name: businessName || 'Business', logoUrl: logoUrl || null, brandColor: brandColor || null, baseCurrency: functionalCurrency };

  const handleExport = () => {
    const rowsHtml = rows.map((row) => `
      <tr>
        <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9;">${escapeHtml(row.name)}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right;">${row.invoiceCount}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:600;">${formatCurrency(row.amount)}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right;">${totalRevenue ? `${((row.amount / totalRevenue) * 100).toFixed(1)}%` : '—'}</td>
      </tr>`).join('');
    generateProfessionalReportDocument({
      business: businessBranding,
      title: 'Revenue by Product & Service',
      subtitle: `Invoice-based net revenue — ${periodLabel}`,
      dateLabel: periodLabel,
      currency: functionalCurrency,
      sections: [{ html: `<table style="width:100%; border-collapse:collapse; font-size:9.5pt;"><thead><tr style="background:#0f172a;color:white;"><th style="padding:10px 12px;text-align:left;">Product / Service</th><th style="padding:10px 12px;text-align:right;">Invoices</th><th style="padding:10px 12px;text-align:right;">Net revenue</th><th style="padding:10px 12px;text-align:right;">Share</th></tr></thead><tbody>${rowsHtml}</tbody><tfoot><tr style="background:#f8fafc;font-weight:700;"><td colspan="2" style="padding:10px 12px;">Total net revenue</td><td style="padding:10px 12px;text-align:right;">${formatCurrency(totalRevenue)}</td><td style="padding:10px 12px;text-align:right;">100.0%</td></tr></tfoot></table>` }],
    });
  };

  if (isLoading) return <div className="space-y-3">{[...Array(6)].map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Could not load the revenue breakdown.</div>;

  return (
    <div className="max-w-4xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title="Revenue by Product & Service"
        subtitle={`Invoice-based net revenue for ${periodLabel}. VAT is excluded.`}
        onExportPDF={handleExport}
      />
      {rows.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
          <PackageOpen className="h-8 w-8 text-gray-300" />
          <p className="text-sm font-medium text-gray-600">No product or service revenue in this period.</p>
          <p className="max-w-md text-xs text-gray-500">Create income invoices with a product/service or description to see which offerings generate revenue.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-brand-50 px-4 py-3"><p className="text-xs font-medium text-gray-500">Net revenue</p><p className="mt-1 text-xl font-semibold text-brand-800">{formatCurrency(totalRevenue)}</p></div>
            <div className="rounded-xl bg-gray-50 px-4 py-3"><p className="text-xs font-medium text-gray-500">Products & services sold</p><p className="mt-1 text-xl font-semibold text-gray-900">{rows.length}</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3 text-left">Product / service</th><th className="px-4 py-3 text-right">Invoices</th><th className="px-4 py-3 text-right">Net revenue</th><th className="px-4 py-3 text-right">Share</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row.key}><td className="px-4 py-3 font-medium text-gray-800">{row.name}</td><td className="px-4 py-3 text-right text-gray-600">{row.invoiceCount}</td><td className={`px-4 py-3 text-right font-semibold ${row.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(row.amount)}</td><td className="px-4 py-3 text-right text-gray-600">{totalRevenue ? `${((row.amount / totalRevenue) * 100).toFixed(1)}%` : '—'}</td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50"><td colSpan={2} className="px-4 py-3 font-bold text-gray-900">Total net revenue</td><td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(totalRevenue)}</td><td className="px-4 py-3 text-right font-bold text-gray-900">100.0%</td></tr></tfoot>
            </table>
          </div>
          <p className="mt-4 flex gap-2 text-xs text-gray-500"><AlertCircle className="h-4 w-4 shrink-0" />This analysis includes invoices, debit notes and credit notes. Revenue posted directly through manual journals remains in the P&amp;L but cannot be allocated to a product or service.</p>
        </>
      )}
    </div>
  );
}
