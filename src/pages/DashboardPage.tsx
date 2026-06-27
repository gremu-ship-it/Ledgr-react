import { TrendingUp, TrendingDown, FileText, AlertCircle, Plus, DollarSign, Receipt, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useOutstandingInvoices,
  useIncomeExpenseTrend,
  useRecentJournalEntries,
} from '@/hooks/useDashboardData';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { CashFlowIndicator } from '@/components/dashboard/CashFlowIndicator';
import { TaxRemittancePanel } from '@/components/dashboard/TaxRemittancePanel';
import { TaxReminderModal } from '@/components/dashboard/TaxReminderModal';
import { formatMwk } from '@/lib/formatters';

// ── Metric Card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ElementType;
  isLoading?: boolean;
  isError?: boolean;
  tone?: 'positive' | 'negative' | 'neutral' | 'warning';
}

function MetricCard({ label, value, subtext, icon: Icon, isLoading, isError, tone = 'neutral' }: MetricCardProps) {
  const iconBg = {
    positive: 'bg-brand-50 text-brand-500',
    negative: 'bg-red-50 text-red-500',
    neutral:  'bg-slate-50 text-slate-500',
    warning:  'bg-amber-50 text-amber-500',
  }[tone];

  const valueColor = {
    positive: 'text-brand-600',
    negative: 'text-red-600',
    neutral:  'text-slate-900',
    warning:  'text-amber-600',
  }[tone];

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-slate-100" />
        <div className="mt-2 h-3 w-20 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-5">
        <p className="text-xs text-red-500">Failed to load</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={`mt-3 text-2xl font-bold tracking-tight ${valueColor}`}>{value}</p>
      {subtext && <p className="mt-1 text-xs text-slate-400">{subtext}</p>}
    </div>
  );
}

// ── Quick Actions ─────────────────────────────────────────────────────────────

function QuickActions() {
  const navigate = useNavigate();

  const actions = [
    { label: 'New Invoice',     icon: Plus,     onClick: () => navigate('/income?action=invoice'),  color: 'bg-brand-500 hover:bg-brand-600 text-white' },
    { label: 'Record Income',   icon: DollarSign, onClick: () => navigate('/income?action=record'), color: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200' },
    { label: 'Record Expense',  icon: Receipt,  onClick: () => navigate('/expenses?action=record'), color: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200' },
    { label: 'Run Payroll',     icon: Users,    onClick: () => navigate('/payroll?action=run'),     color: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            onClick={action.onClick}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition-all ${action.color}`}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────

export function DashboardPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business.id;
  const businessName = currentBusiness?.business.name;

  const income    = useMonthlyIncome(businessId);
  const expenses  = useMonthlyExpenses(businessId);
  const outstanding = useOutstandingInvoices(businessId);
  const trend     = useIncomeExpenseTrend(businessId, 6);
  const recentEntries = useRecentJournalEntries(businessId, 10);

  const netProfit =
    income.data !== undefined && expenses.data !== undefined
      ? income.data.totalAmount - expenses.data
      : undefined;
  const netProfitIsLoading = income.isLoading || expenses.isLoading;
  const netProfitIsError   = income.isError   || expenses.isError;

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <AlertCircle className="h-7 w-7 text-brand-500" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">No business selected</h1>
        <p className="max-w-sm text-sm text-slate-500">
          You don't have an active business yet, or none is currently selected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tax reminder popup — fires once per session when tax is due */}
      <TaxReminderModal />

      {/* ── TAX REMITTANCE PANEL — top priority ── */}
      <TaxRemittancePanel businessId={businessId} />

      {/* ── Page header + Quick Actions ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {businessName ? `Overview for ${businessName}` : 'Overview of your business'}
          </p>
        </div>
        <QuickActions />
      </div>

      {/* ── KPI Metric Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Revenue This Month"
          value={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)}
          subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined}
          icon={TrendingUp}
          isLoading={income.isLoading}
          isError={income.isError}
          tone="positive"
        />
        <MetricCard
          label="Expenses This Month"
          value={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)}
          icon={TrendingDown}
          isLoading={expenses.isLoading}
          isError={expenses.isError}
          tone="negative"
        />
        <MetricCard
          label="Net Profit This Month"
          value={netProfit !== undefined ? formatMwk(netProfit) : formatMwk(0)}
          icon={netProfit !== undefined && netProfit < 0 ? TrendingDown : TrendingUp}
          isLoading={netProfitIsLoading}
          isError={netProfitIsError}
          tone={netProfit !== undefined && netProfit < 0 ? 'negative' : 'positive'}
        />
        <MetricCard
          label="Accounts Receivable"
          value={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          subtext={outstanding.data ? `${outstanding.data.count} unpaid or partially paid` : undefined}
          icon={FileText}
          isLoading={outstanding.isLoading}
          isError={outstanding.isError}
          tone={outstanding.data && outstanding.data.count > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* ── Chart + Cash Flow ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Income vs Expenses</h2>
            <span className="text-xs text-slate-400">Last 6 months</span>
          </div>
          <div className="mt-4">
            <IncomeExpenseChart
              data={trend.data}
              isLoading={trend.isLoading}
              isError={trend.isError}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <CashFlowIndicator
            income={income.data?.totalAmount}
            expenses={expenses.data}
            isLoading={income.isLoading || expenses.isLoading}
            isError={income.isError || expenses.isError}
          />
        </div>
      </div>

      {/* ── Recent Transactions ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Transactions</h2>
            <p className="mt-0.5 text-xs text-slate-400">Last 10 journal entries</p>
          </div>
        </div>
        <RecentTransactions
          entries={recentEntries.data}
          isLoading={recentEntries.isLoading}
          isError={recentEntries.isError}
        />
      </div>
    </div>
  );
}
