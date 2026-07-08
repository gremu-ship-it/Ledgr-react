import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, TrendingUp, Scale, ArrowLeftRight, Table2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, AccountType } from '@/dal/types/database';
import { StatementOfFinancialPosition } from '@/components/reports/StatementOfFinancialPosition';
import { StatementOfProfitOrLoss } from '@/components/reports/StatementOfProfitOrLoss';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = 'pl' | 'balance' | 'cashflow' | 'trial' | 'sofp' | 'pl-ifrs';

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

// ── Report Line ───────────────────────────────────────────────────────────────

function ReportLine({ label, amount, bold, indent, negative, highlight }: {
  label: string; amount: number; bold?: boolean; indent?: number;
  negative?: boolean; highlight?: boolean;
}) {
  const display = negative ? -amount : amount;
  return (
    <div className={`flex items-center justify-between py-1.5 ${highlight ? 'rounded-lg bg-brand-50 px-3 -mx-3' : ''}`}
      style={{ paddingLeft: indent ? indent * 16 : undefined }}>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'} ${display < 0 ? 'text-red-600' : ''}`}>
        {formatMwk(display)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-gray-200" />;
}

function SectionHeader({ label }: { label: string }) {
  return <p className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>;
}

// ── P&L Report ────────────────────────────────────────────────────────────────

function PLReport({ businessId, range }: { businessId: string; range: DateRange }) {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts', businessId],
    queryFn: () => repos.account.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: journalLines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['journal_lines', businessId, range],
    queryFn: async () => {
      const { data, error } = await repos.journal['client']
        .from('journal_lines')
        .select('*, journal_entries!inner(entry_date, status, business_id)')
        .eq('business_id', businessId)
        .gte('journal_entries.entry_date', range.from)
        .lte('journal_entries.entry_date', range.to)
        .eq('journal_entries.status', 'posted');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });

  const loading = isLoading || linesLoading;

  const accountMap = useMemo(() =>
    Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of journalLines as any[]) {
      const acc = accountMap[line.account_id];
      if (!acc) continue;
      const amount = Number(line.amount);
      map[line.account_id] = (map[line.account_id] ?? 0) + (line.is_debit ? amount : -amount);
    }
    return map;
  }, [journalLines, accountMap]);

  function sumByType(type: AccountType) {
    return accounts
      .filter((a) => a.account_type === type && !a.is_group)
      .reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  }

  function accountsByType(type: AccountType) {
    return accounts
      .filter((a) => a.account_type === type && !a.is_group && (balances[a.id] ?? 0) !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  const totalIncome = sumByType('income');
  const totalExpense = sumByType('expense');
  const netProfit = -totalIncome - totalExpense;

  if (loading) return <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm max-w-2xl">
      <h2 className="mb-1 text-base font-semibold text-gray-900">Profit & Loss Statement</h2>
      <p className="mb-6 text-xs text-gray-400">{range.from} to {range.to}</p>

      <SectionHeader label="Revenue" />
      {accountsByType('income').map((a) => (
        <ReportLine key={a.id} label={a.name} amount={-(balances[a.id] ?? 0)} indent={1} />
      ))}
      <Divider />
      <ReportLine label="Total Revenue" amount={-totalIncome} bold />

      <SectionHeader label="Expenses" />
      {accountsByType('expense').map((a) => (
        <ReportLine key={a.id} label={a.name} amount={balances[a.id] ?? 0} indent={1} />
      ))}
      <Divider />
      <ReportLine label="Total Expenses" amount={totalExpense} bold />

      <Divider />
      <ReportLine label="Net Profit / (Loss)" amount={netProfit} bold highlight />
    </div>
  );
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────

function BalanceSheetReport({ businessId, range }: { businessId: string; range: DateRange }) {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts', businessId],
    queryFn: () => repos.account.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: journalLines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['journal_lines_bs', businessId, range],
    queryFn: async () => {
      const { data, error } = await repos.journal['client']
        .from('journal_lines')
        .select('*, journal_entries!inner(entry_date, status, business_id)')
        .eq('business_id', businessId)
        .lte('journal_entries.entry_date', range.to)
        .eq('journal_entries.status', 'posted');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });

  const loading = isLoading || linesLoading;

  const accountMap = useMemo(() =>
    Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of journalLines as any[]) {
      const acc = accountMap[line.account_id];
      if (!acc) continue;
      const amount = Number(line.amount);
      map[line.account_id] = (map[line.account_id] ?? 0) + (line.is_debit ? amount : -amount);
    }
    // Add opening balances
    for (const acc of accounts) {
      if (acc.opening_balance && Number(acc.opening_balance) !== 0) {
        const ob = Number(acc.opening_balance);
        map[acc.id] = (map[acc.id] ?? 0) + (acc.normal_balance === 'debit' ? ob : -ob);
      }
    }
    return map;
  }, [journalLines, accountMap, accounts]);

  function accountsByType(type: AccountType) {
    return accounts
      .filter((a) => a.account_type === type && !a.is_group)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  function sumType(type: AccountType) {
    return accountsByType(type).reduce((s, a) => s + (balances[a.id] ?? 0), 0);
  }

  const totalAssets = sumType('asset');
  const totalLiabilities = -sumType('liability');
  const totalEquity = -sumType('equity');

  if (loading) return <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm max-w-2xl">
      <h2 className="mb-1 text-base font-semibold text-gray-900">Balance Sheet</h2>
      <p className="mb-6 text-xs text-gray-400">As at {range.to}</p>

      <SectionHeader label="Assets" />
      {accountsByType('asset').map((a) => (
        <ReportLine key={a.id} label={a.name} amount={balances[a.id] ?? 0} indent={1} />
      ))}
      <Divider />
      <ReportLine label="Total Assets" amount={totalAssets} bold />

      <SectionHeader label="Liabilities" />
      {accountsByType('liability').map((a) => (
        <ReportLine key={a.id} label={a.name} amount={-(balances[a.id] ?? 0)} indent={1} />
      ))}
      <Divider />
      <ReportLine label="Total Liabilities" amount={totalLiabilities} bold />

      <SectionHeader label="Equity" />
      {accountsByType('equity').map((a) => (
        <ReportLine key={a.id} label={a.name} amount={-(balances[a.id] ?? 0)} indent={1} />
      ))}
      <Divider />
      <ReportLine label="Total Equity" amount={totalEquity} bold />

      <Divider />
      <ReportLine label="Total Liabilities & Equity" amount={totalLiabilities + totalEquity} bold highlight />
    </div>
  );
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────

function CashFlowReport({ businessId, range }: { businessId: string; range: DateRange }) {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', businessId],
    queryFn: () => repos.account.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: journalLines = [], isLoading } = useQuery({
    queryKey: ['journal_lines_cf', businessId, range],
    queryFn: async () => {
      const { data, error } = await repos.journal['client']
        .from('journal_lines')
        .select('*, journal_entries!inner(entry_date, status, business_id, source_type)')
        .eq('business_id', businessId)
        .gte('journal_entries.entry_date', range.from)
        .lte('journal_entries.entry_date', range.to)
        .eq('journal_entries.status', 'posted');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });

  const accountMap = useMemo(() =>
    Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const { operating, investing, financing } = useMemo(() => {
    let operating = 0, investing = 0, financing = 0;
    for (const line of journalLines as any[]) {
      const acc = accountMap[line.account_id];
      if (!acc || !acc.is_bank_account) continue;
      const amount = Number(line.amount) * (line.is_debit ? 1 : -1);
      const src = line.journal_entries?.source_type ?? '';
      if (src === 'invoice' || src === 'expense' || src === 'payroll') operating += amount;
      else if (src === 'asset') investing += amount;
      else financing += amount;
    }
    return { operating, investing, financing };
  }, [journalLines, accountMap]);

  const netCashFlow = operating + investing + financing;

  if (isLoading) return <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm max-w-2xl">
      <h2 className="mb-1 text-base font-semibold text-gray-900">Cash Flow Summary</h2>
      <p className="mb-6 text-xs text-gray-400">{range.from} to {range.to}</p>

      <SectionHeader label="Operating Activities" />
      <ReportLine label="Net cash from operations" amount={operating} indent={1} />
      <Divider />
      <ReportLine label="Total Operating" amount={operating} bold />

      <SectionHeader label="Investing Activities" />
      <ReportLine label="Net cash from investing" amount={investing} indent={1} />
      <Divider />
      <ReportLine label="Total Investing" amount={investing} bold />

      <SectionHeader label="Financing Activities" />
      <ReportLine label="Net cash from financing" amount={financing} indent={1} />
      <Divider />
      <ReportLine label="Total Financing" amount={financing} bold />

      <Divider />
      <ReportLine label="Net Cash Movement" amount={netCashFlow} bold highlight />

      <p className="mt-4 text-xs text-gray-400">
        Cash flow is derived from posted journal entries on bank accounts, classified by source type.
      </p>
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-900">Trial Balance</h2>
        <p className="text-xs text-gray-400">All posted journal entries</p>
      </div>
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
  const [tab, setTab] = useState<Tab>('pl');
  const [range, setRange] = useState<DateRange>({ from: startOfYear(), to: todayStr() });

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
        <button onClick={() => setTab('pl')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'pl' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <TrendingUp className="h-4 w-4" />P&L
        </button>
        <button onClick={() => setTab('balance')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'balance' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Scale className="h-4 w-4" />Balance Sheet
        </button>
        <button onClick={() => setTab('cashflow')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'cashflow' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <ArrowLeftRight className="h-4 w-4" />Cash Flow
        </button>
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
      </div>

      {/* Date filter — not shown for trial balance */}
      {tab !== 'trial' && <DateFilter range={range} onChange={setRange} />}

      {tab === 'pl'       && <PLReport businessId={businessId} range={range} />}
      {tab === 'balance'  && <BalanceSheetReport businessId={businessId} range={range} />}
      {tab === 'cashflow' && <CashFlowReport businessId={businessId} range={range} />}
      {tab === 'trial'    && <TrialBalanceReport businessId={businessId} />}
      {tab === 'sofp'    && <StatementOfFinancialPosition businessId={businessId} asOfDate={range.to} businessName={currentBusiness.business.name} />}
      {tab === 'pl-ifrs' && <StatementOfProfitOrLoss businessId={businessId} periodStart={range.from} periodEnd={range.to} businessName={currentBusiness.business.name} />}
    </div>
  );
}
