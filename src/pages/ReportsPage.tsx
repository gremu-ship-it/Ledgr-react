import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, TrendingUp, Scale, ArrowLeftRight, Table2, Building2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';
import { StatementOfFinancialPosition } from '@/components/reports/StatementOfFinancialPosition';
import { StatementOfProfitOrLoss } from '@/components/reports/StatementOfProfitOrLoss';
import { CashFlowStatement } from '@/components/reports/CashFlowStatement';
import { StatementOfChangesInEquity } from '@/components/reports/StatementOfChangesInEquity';
import { BranchPerformanceReport } from '@/components/reports/BranchPerformanceReport';
import { ReportHeader } from '@/components/reports/ReportHeader';

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

type Tab = 'trial' | 'sofp' | 'pl-ifrs' | 'cashflow-ifrs' | 'equity' | 'branches';

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
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['trial_balance', businessId],
    queryFn: async () => {
      const { data, error } = await repos.journal['client']
        .from('v_trial_balance')
        .select('*')
        .eq('business_id', businessId)
        .order('code', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row<'v_trial_balance'>[];
    },
    enabled: Boolean(businessId),
  });

  const totalDebits = rows.reduce((s, r) => s + Number(r.total_debits ?? 0), 0);
  const totalCredits = rows.reduce((s, r) => s + Number(r.total_credits ?? 0), 0);

  if (isLoading) return <div className="space-y-3">{[...Array(10)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>;

  if (rows.length === 0) return (
    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
      <AlertCircle className="h-8 w-8 text-gray-300" />
      <p className="text-sm text-gray-500">No posted journal entries found.</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm max-w-3xl">
      <ReportHeader
        title="Trial Balance"
        subtitle="All posted journal entries"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="hidden sm:table-cell px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="hidden sm:table-cell px-4 py-3 text-left">Type</th>
              <th className="hidden sm:table-cell px-4 py-3 text-right">Debits</th>
              <th className="hidden sm:table-cell px-4 py-3 text-right">Credits</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="hidden sm:table-cell px-4 py-2.5 font-mono text-xs text-gray-400">{row.code}</td>
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
      </div>

      {/* Date filter — not shown for trial balance */}
      {tab !== 'trial' && <DateFilter range={range} onChange={setRange} />}

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
    </div>
  );
}
