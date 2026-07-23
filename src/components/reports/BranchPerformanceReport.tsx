import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ChevronDown,
  Table2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { repos } from '@/lib/repositories';
import type { AccountSubtype, Row } from '@/dal/types/database';

const UNASSIGNED_BRANCH_ID = '__unassigned__';
const TOLERANCE = 0.01;
const EMPTY_BRANCH_PERFORMANCE_ROWS: BranchPerformanceRow[] = [];

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompactMwk(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `MK ${(amount / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `MK ${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `MK ${(amount / 1_000).toFixed(1)}K`;
  return `MK ${amount.toFixed(0)}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function periodLabel(periodStart: string, periodEnd: string): string {
  const from = new Date(periodStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const to = new Date(periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${from} to ${to}`;
}

type AccountRef = Pick<Row<'accounts'>, 'id' | 'code' | 'name' | 'account_subtype' | 'normal_balance'>;
type BranchRef = Pick<Row<'branches'>, 'id' | 'name' | 'code' | 'location' | 'is_active'>;

type JournalLineForBranchReport = {
  branch_id: string | null;
  is_debit: boolean;
  amount_base: number;
  accounts: AccountRef | null;
  journal_entries: {
    branch_id: string | null;
    entry_date: string;
    status: string;
  } | null;
};

type AccountBreakdown = {
  key: string;
  code: string;
  name: string;
  subtype: AccountSubtype;
  amount: number;
};

type BranchPerformanceRow = {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  location: string | null;
  isActive: boolean;
  revenue: number;
  otherIncome: number;
  costOfSales: number;
  operatingExpenses: number;
  depreciationAmortisation: number;
  financeCosts: number;
  taxExpense: number;
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
  grossMargin: number | null;
  netMargin: number | null;
  accountBreakdown: AccountBreakdown[];
};

const P_AND_L_SUBTYPES = new Set<AccountSubtype>([
  'revenue',
  'other_income',
  'cost_of_sales',
  'operating_expense',
  'depreciation_amortisation',
  'finance_cost',
  'tax_expense',
]);

const SUBTYPE_LABELS: Record<AccountSubtype, string> = {
  current_asset: 'Current Assets',
  non_current_asset: 'Non-Current Assets',
  fixed_asset: 'Fixed Assets',
  current_liability: 'Current Liabilities',
  non_current_liability: 'Non-Current Liabilities',
  share_capital: 'Share Capital',
  retained_earnings: 'Retained Earnings',
  reserves: 'Reserves',
  revenue: 'Revenue',
  other_income: 'Other Income',
  cost_of_sales: 'Cost of Sales',
  operating_expense: 'Operating Expenses',
  finance_cost: 'Finance Costs',
  tax_expense: 'Tax Expense',
  depreciation_amortisation: 'Depreciation & Amortisation',
};

function emptyBranchRow(branch: BranchRef): BranchPerformanceRow {
  return {
    branchId: branch.id,
    branchName: branch.name,
    branchCode: branch.code,
    location: branch.location,
    isActive: branch.is_active,
    revenue: 0,
    otherIncome: 0,
    costOfSales: 0,
    operatingExpenses: 0,
    depreciationAmortisation: 0,
    financeCosts: 0,
    taxExpense: 0,
    grossProfit: 0,
    operatingProfit: 0,
    netProfit: 0,
    grossMargin: null,
    netMargin: null,
    accountBreakdown: [],
  };
}

function finalizeBranchRow(row: BranchPerformanceRow): BranchPerformanceRow {
  const grossProfit = row.revenue - row.costOfSales;
  const operatingProfit = grossProfit + row.otherIncome - row.operatingExpenses - row.depreciationAmortisation;
  const netProfit = operatingProfit - row.financeCosts - row.taxExpense;
  const totalIncome = row.revenue + row.otherIncome;

  return {
    ...row,
    grossProfit,
    operatingProfit,
    netProfit,
    grossMargin: Math.abs(row.revenue) > TOLERANCE ? (grossProfit / row.revenue) * 100 : null,
    netMargin: Math.abs(totalIncome) > TOLERANCE ? (netProfit / totalIncome) * 100 : null,
    accountBreakdown: row.accountBreakdown
      .filter((line) => Math.abs(line.amount) > TOLERANCE)
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function addAmountToRow(row: BranchPerformanceRow, subtype: AccountSubtype, amount: number): void {
  switch (subtype) {
    case 'revenue':
      row.revenue += amount;
      break;
    case 'other_income':
      row.otherIncome += amount;
      break;
    case 'cost_of_sales':
      row.costOfSales += amount;
      break;
    case 'operating_expense':
      row.operatingExpenses += amount;
      break;
    case 'depreciation_amortisation':
      row.depreciationAmortisation += amount;
      break;
    case 'finance_cost':
      row.financeCosts += amount;
      break;
    case 'tax_expense':
      row.taxExpense += amount;
      break;
    default:
      break;
  }
}

function buildBranchPerformance(
  branches: BranchRef[],
  lines: JournalLineForBranchReport[],
): BranchPerformanceRow[] {
  const rowMap = new Map<string, BranchPerformanceRow>();

  for (const branch of branches) {
    rowMap.set(branch.id, emptyBranchRow(branch));
  }

  const unassignedBranch: BranchRef = {
    id: UNASSIGNED_BRANCH_ID,
    name: 'Unassigned transactions',
    code: null,
    location: 'No branch selected on journal entry',
    is_active: true,
  };

  const ensureRow = (branchId: string): BranchPerformanceRow => {
    const existing = rowMap.get(branchId);
    if (existing) return existing;

    const branch = branchId === UNASSIGNED_BRANCH_ID
      ? unassignedBranch
      : { id: branchId, name: 'Unknown branch', code: null, location: null, is_active: false };
    const row = emptyBranchRow(branch);
    rowMap.set(branchId, row);
    return row;
  };

  for (const line of lines) {
    const account = line.accounts;
    const subtype = account?.account_subtype;
    if (!account || !subtype || !P_AND_L_SUBTYPES.has(subtype)) continue;

    const branchId = line.branch_id ?? line.journal_entries?.branch_id ?? UNASSIGNED_BRANCH_ID;
    const row = ensureRow(branchId);
    const signedAmount = line.is_debit ? Number(line.amount_base) : -Number(line.amount_base);
    const naturalAmount = account.normal_balance === 'debit' ? signedAmount : -signedAmount;

    addAmountToRow(row, subtype, naturalAmount);

    const breakdownKey = `${account.id}:${subtype}`;
    const existing = row.accountBreakdown.find((item) => item.key === breakdownKey);
    if (existing) {
      existing.amount += naturalAmount;
    } else {
      row.accountBreakdown.push({
        key: breakdownKey,
        code: account.code,
        name: account.name,
        subtype,
        amount: naturalAmount,
      });
    }
  }

  return Array.from(rowMap.values())
    .map(finalizeBranchRow)
    .filter((row) => row.branchId !== UNASSIGNED_BRANCH_ID || row.accountBreakdown.length > 0)
    .sort((a, b) => {
      if (a.branchId === UNASSIGNED_BRANCH_ID) return 1;
      if (b.branchId === UNASSIGNED_BRANCH_ID) return -1;
      return b.netProfit - a.netProfit;
    });
}

function SummaryCard({
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  helper: string;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const Icon = tone === 'bad' ? TrendingDown : tone === 'good' ? TrendingUp : BarChart3;
  const colour = tone === 'bad' ? 'text-red-600 bg-red-50' : tone === 'good' ? 'text-emerald-600 bg-emerald-50' : 'text-brand-600 bg-brand-50';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${colour}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={`mt-3 text-xl font-bold ${tone === 'bad' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-500">{helper}</p>
    </div>
  );
}

function BranchPerformanceTable({ rows, selectedBranchId, onSelect }: {
  rows: BranchPerformanceRow[];
  selectedBranchId: string;
  onSelect: (branchId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-900">Branch comparison</h2>
        <p className="text-xs text-gray-400">Revenue, costs and profitability by branch</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Branch</th>
              <th className="px-4 py-3 text-right">Revenue</th>
              <th className="hidden md:table-cell px-4 py-3 text-right">Cost of Sales</th>
              <th className="px-4 py-3 text-right">Gross Profit</th>
              <th className="hidden lg:table-cell px-4 py-3 text-right">Expenses</th>
              <th className="px-4 py-3 text-right">Net Profit</th>
              <th className="hidden sm:table-cell px-4 py-3 text-right">Net Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => {
              const isSelected = row.branchId === selectedBranchId;
              const totalExpenses = row.operatingExpenses + row.depreciationAmortisation + row.financeCosts + row.taxExpense;
              return (
                <tr
                  key={row.branchId}
                  onClick={() => onSelect(row.branchId)}
                  className={`cursor-pointer transition-colors ${isSelected ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{row.branchName}</p>
                        <p className="text-xs text-gray-400">
                          {row.branchCode ? `${row.branchCode} · ` : ''}{row.location ?? 'No location'}
                          {!row.isActive && ' · inactive'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{formatMwk(row.revenue)}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-right text-gray-600">{formatMwk(row.costOfSales)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${row.grossProfit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {formatMwk(row.grossProfit)}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-3 text-right text-gray-600">{formatMwk(totalExpenses)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.netProfit < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {formatMwk(row.netProfit)}
                  </td>
                  <td className={`hidden sm:table-cell px-4 py-3 text-right font-medium ${(row.netMargin ?? 0) < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {formatPercent(row.netMargin)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectedBranchDetails({ row }: { row: BranchPerformanceRow }) {
  const grouped = row.accountBreakdown.reduce<Record<string, AccountBreakdown[]>>((acc, line) => {
    const label = SUBTYPE_LABELS[line.subtype];
    acc[label] = acc[label] ?? [];
    acc[label].push(line);
    return acc;
  }, {});

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{row.branchName} performance detail</h2>
          <p className="mt-1 text-xs text-gray-400">Account-level profit or loss lines assigned to this branch.</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-right">
          <p className="text-xs text-gray-400">Net Profit</p>
          <p className={`text-sm font-bold ${row.netProfit < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatMwk(row.netProfit)}</p>
        </div>
      </div>

      {row.accountBreakdown.length === 0 ? (
        <div className="flex min-h-[18vh] flex-col items-center justify-center gap-2 text-center">
          <Table2 className="h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No P&amp;L activity was posted to this branch in the selected period.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([label, lines]) => (
            <div key={label}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
              <div className="overflow-hidden rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {lines.map((line) => (
                      <tr key={line.key}>
                        <td className="px-3 py-2 font-mono text-xs text-gray-400">{line.code}</td>
                        <td className="px-3 py-2 text-gray-700">{line.name}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{formatMwk(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BranchPerformanceReport({
  businessId,
  periodStart,
  periodEnd,
}: {
  businessId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['branch_performance', businessId, periodStart, periodEnd],
    queryFn: async () => {
      const [branches, linesResult] = await Promise.all([
        repos.branch.findByBusiness(businessId),
        repos.journal.db
          .from('journal_lines')
          .select(`
            branch_id,
            is_debit,
            amount_base,
            accounts!inner(id, code, name, account_subtype, normal_balance),
            journal_entries!inner(branch_id, entry_date, status, business_id)
          `)
          .eq('business_id', businessId)
          .eq('journal_entries.business_id', businessId)
          .gte('journal_entries.entry_date', periodStart)
          .lte('journal_entries.entry_date', periodEnd)
          .in('journal_entries.status', ['posted', 'reversed']),
      ]);

      if (linesResult.error) throw new Error(linesResult.error.message);

      return {
        branches: branches as BranchRef[],
        rows: buildBranchPerformance(
          branches as BranchRef[],
          (linesResult.data ?? []) as unknown as JournalLineForBranchReport[],
        ),
      };
    },
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const rows = data?.rows ?? EMPTY_BRANCH_PERFORMANCE_ROWS;
  const selectedRow = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.find((row) => row.branchId === selectedBranchId) ?? rows[0];
  }, [rows, selectedBranchId]);

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      grossProfit: acc.grossProfit + row.grossProfit,
      netProfit: acc.netProfit + row.netProfit,
    }),
    { revenue: 0, grossProfit: 0, netProfit: 0 },
  ), [rows]);

  const bestBranch = rows
    .filter((row) => row.branchId !== UNASSIGNED_BRANCH_ID && row.accountBreakdown.length > 0)
    .sort((a, b) => b.netProfit - a.netProfit)[0] ?? null;

  const chartData = rows.map((row) => ({
    name: row.branchCode ?? row.branchName,
    Revenue: row.revenue,
    'Gross Profit': row.grossProfit,
    'Net Profit': row.netProfit,
  }));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">Could not load branch performance report.</p>
      </div>
    );
  }

  if (!data || data.branches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <Building2 className="mx-auto h-10 w-10 text-gray-300" />
        <h2 className="mt-3 text-base font-semibold text-gray-900">No branches set up yet</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          Create branches first, then assign income and expenses to a branch to monitor performance by selling point or cost centre.
        </p>
      </div>
    );
  }

  if (rows.length === 0 || rows.every((row) => row.accountBreakdown.length === 0)) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <BarChart3 className="mx-auto h-10 w-10 text-gray-300" />
        <h2 className="mt-3 text-base font-semibold text-gray-900">No branch activity for this period</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
          Branch reports use posted journal entries from income and expense transactions that have a branch selected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total branch revenue" value={formatMwk(totals.revenue)} helper={periodLabel(periodStart, periodEnd)} />
        <SummaryCard label="Gross profit" value={formatMwk(totals.grossProfit)} helper={`${formatPercent(totals.revenue ? (totals.grossProfit / totals.revenue) * 100 : null)} gross margin`} tone={totals.grossProfit < 0 ? 'bad' : 'good'} />
        <SummaryCard label="Net profit" value={formatMwk(totals.netProfit)} helper="Across all reported branches" tone={totals.netProfit < 0 ? 'bad' : 'good'} />
        <SummaryCard label="Top branch" value={bestBranch?.branchName ?? '—'} helper={bestBranch ? `${formatMwk(bestBranch.netProfit)} net profit` : 'No profitable branch yet'} tone="neutral" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Performance chart</h2>
            <p className="text-xs text-gray-400">Compare revenue, gross profit and net profit side by side.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600">
            <ChevronDown className="h-4 w-4 text-gray-400" />
            Sorted by net profit
          </div>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={formatCompactMwk} />
              <Tooltip formatter={(value) => formatMwk(Number(value))} />
              <Legend />
              <Bar dataKey="Revenue" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Gross Profit" fill="#10b981" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Net Profit" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <BranchPerformanceTable
        rows={rows}
        selectedBranchId={selectedRow?.branchId ?? ''}
        onSelect={setSelectedBranchId}
      />

      {selectedRow && <SelectedBranchDetails row={selectedRow} />}
    </div>
  );
}
