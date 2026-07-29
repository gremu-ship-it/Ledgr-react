import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, TrendingUp, Scale, ArrowLeftRight, Table2, Building2, Coins } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { StatementOfFinancialPosition } from '@/components/reports/StatementOfFinancialPosition';
import { StatementOfProfitOrLoss } from '@/components/reports/StatementOfProfitOrLoss';
import { CashFlowStatement } from '@/components/reports/CashFlowStatement';
import { StatementOfChangesInEquity } from '@/components/reports/StatementOfChangesInEquity';
import { BranchPerformanceReport } from '@/components/reports/BranchPerformanceReport';
import { ReportHeader } from '@/components/reports/ReportHeader';
import type { Row } from '@/dal/types/database';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { businessRowToBranding } from '@/lib/documents/types';
import { generateProfessionalReportDocument } from '@/lib/documents/documentGenerator';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function oneYearBefore(dateStr: string): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = 'trial' | 'sofp' | 'pl-ifrs' | 'cashflow-ifrs' | 'equity' | 'branches' | 'currency';

type TrialBalanceRow = Row<'v_trial_balance'>;

interface MultiCurrencyRow {
  id: string;
  created_at: string;
  description: string | null;
  amount: number;
  amount_base: number;
  currency: string;
  original_currency: string | null;
  original_amount: number | null;
  exchange_rate: number;
  rate_date: string | null;
  journal_entries: {
    entry_date: string;
    entry_number: string;
    description: string;
    status: string;
  } | Array<{
    entry_date: string;
    entry_number: string;
    description: string;
    status: string;
  }>;
}

// ── Date Filter ───────────────────────────────────────────────────────────────

interface DateRange { from: string; to: string; }

const PRESETS = [
  { label: 'This Month', from: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }, to: todayStr },
  { label: 'This Quarter', from: () => { const d = new Date(); const q = Math.floor(d.getMonth()/3); return `${d.getFullYear()}-${String(q*3+1).padStart(2,'0')}-01`; }, to: todayStr },
  { label: 'This Year', from: startOfYear, to: todayStr },
  { label: 'Last Year', from: () => `${new Date().getFullYear()-1}-01-01`, to: () => `${new Date().getFullYear()-1}-12-31` },
];

function DateFilter({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-600">From</label>
        <input type="date" value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-600">To</label>
        <input type="date" value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
      </div>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => onChange({ from: p.from(), to: p.to() })}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Trial Balance ─────────────────────────────────────────────────────────────

function TrialBalanceReport({ businessId }: { businessId: string }) {
  const { business: brandBusiness, businessName: brandName, logoUrl, brandColor } = useBrandTheme();
  const { data: rows = [], isLoading } = useQuery<TrialBalanceRow[]>({
    queryKey: ['trial_balance', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_trial_balance')
        .select('*')
        .eq('business_id', businessId)
        .order('code', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TrialBalanceRow[];
    },
    enabled: Boolean(businessId),
  });

  const totalDebits = rows.reduce((s, r) => s + Number(r.total_debits ?? 0), 0);
  const totalCredits = rows.reduce((s, r) => s + Number(r.total_credits ?? 0), 0);

  const businessBranding = brandBusiness
    ? businessRowToBranding(brandBusiness as Row<'businesses'>)
    : { name: brandName || 'Business', logoUrl: logoUrl || null, brandColor: brandColor || null, baseCurrency: 'MWK' };

  const handleExportPDF = () => {
    const tableHtml = `
      <table style="width:100%; border-collapse:collapse; font-size:9.5pt;">
        <thead><tr style="background:#0f172a; color:white;">
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase; letter-spacing:0.06em;">Code</th>
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase; letter-spacing:0.06em;">Account</th>
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase; letter-spacing:0.06em;">Type</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; text-transform:uppercase; letter-spacing:0.06em;">Debits</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; text-transform:uppercase; letter-spacing:0.06em;">Credits</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; text-transform:uppercase; letter-spacing:0.06em;">Balance</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; font-family:monospace; font-size:8.5pt;">${r.code ?? ''}</td>
              <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; font-weight:600;">${r.name ?? ''}</td>
              <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; font-size:8.5pt; color:#64748b;">${r.account_type ?? ''}</td>
              <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right;">${formatMwk(Number(r.total_debits ?? 0))}</td>
              <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right;">${formatMwk(Number(r.total_credits ?? 0))}</td>
              <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:600; color:${Number(r.balance ?? 0) < 0 ? '#dc2626' : '#0f172a'};">${formatMwk(Number(r.balance ?? 0))}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f8fafc; font-weight:700; border-top:2px solid #0f172a;">
            <td colspan="3" style="padding:12px;">Totals</td>
            <td style="padding:12px; text-align:right;">${formatMwk(totalDebits)}</td>
            <td style="padding:12px; text-align:right;">${formatMwk(totalCredits)}</td>
            <td style="padding:12px; text-align:right; color:${Math.abs(totalDebits - totalCredits) > 0.01 ? '#dc2626' : '#059669'};">${Math.abs(totalDebits - totalCredits) < 0.01 ? '✓ Balanced' : formatMwk(totalDebits - totalCredits)}</td>
          </tr>
        </tfoot>
      </table>
    `;
    generateProfessionalReportDocument({
      business: businessBranding as any,
      title: 'Trial Balance',
      subtitle: 'All posted journal entries — detailed trial balance',
      dateLabel: new Date().toLocaleDateString('en-MW', { day: '2-digit', month: 'long', year: 'numeric' }),
      currency: 'MWK',
      sections: [{ html: tableHtml }],
      facts: [
        { label: 'Total Debits', value: totalDebits },
        { label: 'Total Credits', value: totalCredits },
        { label: 'Difference', value: Math.abs(totalDebits - totalCredits) },
      ],
    });
  };

  if (isLoading) return <div className="space-y-3">{[...Array(10)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>;

  if (rows.length === 0) return (
    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
      <AlertCircle className="h-8 w-8 text-gray-300" />
      <p className="text-sm text-gray-500">No posted journal entries found.</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm max-w-4xl">
      <ReportHeader
        title="Trial Balance"
        subtitle="All posted journal entries"
        onExportPDF={handleExportPDF}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Code</th>
              <th scope="col" className="px-4 py-3 text-left">Account</th>
              <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left">Type</th>
              <th scope="col" className="hidden sm:table-cell px-4 py-3 text-right">Debits</th>
              <th scope="col" className="hidden sm:table-cell px-4 py-3 text-right">Credits</th>
              <th scope="col" className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="hidden sm:table-cell px-4 py-2.5 font-mono text-xs text-gray-600">{row.code}</td>
                <td className="px-4 py-2.5 font-medium text-gray-900">{row.name}</td>
                <td className="hidden sm:table-cell px-4 py-2.5">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                    {row.account_type}
                  </span>
                </td>
                <td className="hidden sm:table-cell px-4 py-2.5 text-right text-gray-600">{formatMwk(Number(row.total_debits ?? 0))}</td>
                <td className="hidden sm:table-cell px-4 py-2.5 text-right text-gray-600">{formatMwk(Number(row.total_credits ?? 0))}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${Number(row.balance ?? 0) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatMwk(Number(row.balance ?? 0))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold text-sm">
            <tr className="border-t-2 border-gray-300">
              <td colSpan={2} className="px-4 py-3 text-gray-900">Totals</td>
              <td className="hidden sm:table-cell px-4 py-3 text-gray-900"></td>
              <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-900">{formatMwk(totalDebits)}</td>
              <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-900">{formatMwk(totalCredits)}</td>
              <td className={`px-4 py-3 text-right ${Math.abs(totalDebits - totalCredits) > 0.01 ? 'text-red-600' : 'text-brand-700'}`}>
                {Math.abs(totalDebits - totalCredits) < 0.01 ? '✓ Balanced' : formatMwk(totalDebits - totalCredits)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}


function MultiCurrencyReport({ businessId, functionalCurrency }: { businessId: string; functionalCurrency: string }) {
  const { business: brandBusiness, businessName: brandName, logoUrl, brandColor } = useBrandTheme();
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['multi_currency_report', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('journal_lines')
        .select('id, created_at, description, amount, amount_base, currency, original_currency, original_amount, exchange_rate, rate_date, journal_entries!inner(entry_date, entry_number, description, status)')
        .eq('business_id', businessId)
        .eq('journal_entries.status', 'posted')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as MultiCurrencyRow[];
    },
    enabled: Boolean(businessId),
  });

  const businessBranding = brandBusiness
    ? businessRowToBranding(brandBusiness as Row<'businesses'>)
    : { name: brandName || 'Business', logoUrl: logoUrl || null, brandColor: brandColor || null, baseCurrency: functionalCurrency };

  if (isLoading) return <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Failed to load multi-currency report.</div>;

  const handleExportPDF = () => {
    const tableHtml = `
      <table style="width:100%; min-width:760px; border-collapse:collapse; font-size:9pt;">
        <thead><tr style="background:#0f172a; color:white;">
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase;">Date</th>
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase;">Entry</th>
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase;">Description</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; text-transform:uppercase;">Txn Amount</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; text-transform:uppercase;">Functional</th>
          <th style="padding:10px 12px; text-align:right; font-size:8pt; text-transform:uppercase;">Rate</th>
          <th style="padding:10px 12px; text-align:left; font-size:8pt; text-transform:uppercase;">Rate Date</th>
        </tr></thead>
        <tbody>
          ${rows.map(row => {
            const entry = Array.isArray(row.journal_entries) ? row.journal_entries[0] : row.journal_entries;
            const txCurrency = row.original_currency ?? row.currency ?? functionalCurrency;
            const txAmount = Number(row.original_amount ?? row.amount ?? 0);
            const functionalAmount = Number(row.amount_base ?? 0);
            return `
              <tr>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9;">${entry?.entry_date ?? '—'}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; font-family:monospace; font-size:8.5pt;">${entry?.entry_number ?? '—'}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9;">${row.description ?? entry?.description ?? '—'}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:600;">${txCurrency} ${txAmount.toLocaleString('en-MW', { minimumFractionDigits: 2 })}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right; color:#0E7C5A; font-weight:600;">${functionalCurrency} ${functionalAmount.toLocaleString('en-MW', { minimumFractionDigits: 2 })}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9; text-align:right;">${Number(row.exchange_rate ?? 1).toFixed(6)}</td>
                <td style="padding:8px 12px; border-bottom:1px solid #f1f5f9;">${row.rate_date ?? entry?.entry_date ?? '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    generateProfessionalReportDocument({
      business: businessBranding as any,
      title: 'Multi-currency Transaction Report',
      subtitle: `Original transaction currency alongside functional currency (${functionalCurrency})`,
      dateLabel: new Date().toLocaleDateString('en-MW'),
      currency: functionalCurrency,
      sections: [{ html: tableHtml }],
    });
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title="Multi-currency Transaction Report"
        subtitle={`Original transaction currency alongside functional currency (${functionalCurrency})`}
        onExportPDF={handleExportPDF}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Date</th>
              <th scope="col" className="px-4 py-3 text-left">Entry</th>
              <th scope="col" className="px-4 py-3 text-left">Description</th>
              <th scope="col" className="px-4 py-3 text-right">Transaction amount</th>
              <th scope="col" className="px-4 py-3 text-right">Functional amount</th>
              <th scope="col" className="px-4 py-3 text-right">Rate used</th>
              <th scope="col" className="px-4 py-3 text-left">Rate date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => {
              const entry = Array.isArray(row.journal_entries) ? row.journal_entries[0] : row.journal_entries;
              const txCurrency = row.original_currency ?? row.currency ?? functionalCurrency;
              const txAmount = Number(row.original_amount ?? row.amount ?? 0);
              const functionalAmount = Number(row.amount_base ?? 0);
              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{entry?.entry_date ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{entry?.entry_number ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{row.description ?? entry?.description ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{txCurrency} {txAmount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right font-medium text-brand-700">{functionalCurrency} {functionalAmount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{Number(row.exchange_rate ?? 1).toFixed(6)}</td>
                  <td className="px-4 py-3 text-gray-500">{row.rate_date ?? entry?.entry_date ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [tab, setTab] = useState<Tab>('sofp');
  const [range, setRange] = useState<DateRange>({ from: startOfYear(), to: todayStr() });
  const [showComparative, setShowComparative] = useState(false);

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
          <p className="mt-1 text-sm text-gray-500">Financial reports for {currentBusiness.business.name}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        <button onClick={() => setTab('trial')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'trial' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Table2 className="h-4 w-4" />Trial Balance
        </button>
        <button onClick={() => setTab('sofp')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'sofp' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Scale className="h-4 w-4" />SOFP (IFRS)
        </button>
        <button onClick={() => setTab('pl-ifrs')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'pl-ifrs' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <TrendingUp className="h-4 w-4" />P&L (IFRS)
        </button>
        <button onClick={() => setTab('cashflow-ifrs')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'cashflow-ifrs' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <ArrowLeftRight className="h-4 w-4" />Cash Flow (IFRS)
        </button>
        <button onClick={() => setTab('equity')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'equity' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Scale className="h-4 w-4" />Changes in Equity
        </button>
        <button onClick={() => setTab('branches')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'branches' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Building2 className="h-4 w-4" />Branch Performance
        </button>
        <button onClick={() => setTab('currency')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'currency' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Coins className="h-4 w-4" />Multi-currency
        </button>
      </div>

      {/* Date filter — not shown for trial balance */}
      {tab !== 'trial' && tab !== 'currency' && <DateFilter range={range} onChange={setRange} />}

      {/* Comparative toggle — only relevant for SOFP and P&L (IFRS) tabs */}
      {(tab === 'sofp' || tab === 'pl-ifrs') && (
        <label className="mb-4 flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showComparative}
            onChange={(e) => setShowComparative(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show prior year comparison
        </label>
      )}

      {tab === 'trial' && <TrialBalanceReport businessId={businessId} />}
      {tab === 'sofp' && (
        <StatementOfFinancialPosition
          businessId={businessId}
          asOfDate={range.to}
          comparativeDate={showComparative ? oneYearBefore(range.to) : null}
          businessName={currentBusiness.business.name}
        />
      )}
      {tab === 'pl-ifrs' && (
        <StatementOfProfitOrLoss
          businessId={businessId}
          periodStart={range.from}
          periodEnd={range.to}
          comparativePeriodStart={showComparative ? oneYearBefore(range.from) : null}
          comparativePeriodEnd={showComparative ? oneYearBefore(range.to) : null}
          businessName={currentBusiness.business.name}
        />
      )}
      {tab === 'cashflow-ifrs' && (
        <CashFlowStatement
          businessId={businessId}
          periodStart={range.from}
          periodEnd={range.to}
          businessName={currentBusiness.business.name}
        />
      )}
      {tab === 'equity' && (
        <StatementOfChangesInEquity
          businessId={businessId}
          periodStart={range.from}
          periodEnd={range.to}
          businessName={currentBusiness.business.name}
        />
      )}
      {tab === 'branches' && (
        <BranchPerformanceReport
          businessId={businessId}
          periodStart={range.from}
          periodEnd={range.to}
        />
      )}
      {tab === 'currency' && (
        <MultiCurrencyReport
          businessId={businessId}
          functionalCurrency={currentBusiness.business.base_currency || 'MWK'}
        />
      )}
    </div>
  );
}
