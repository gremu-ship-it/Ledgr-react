import { TrendingUp, TrendingDown, FileText, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useOutstandingInvoices,
  useIncomeExpenseTrend,
  useRecentJournalEntries,
} from '@/hooks/useDashboardData';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { CashFlowIndicator } from '@/components/dashboard/CashFlowIndicator';
import { formatMwk } from '@/lib/formatters';
import { TaxRemittancePanel } from '@/components/dashboard/TaxRemittancePanel';
import { TaxReminderModal } from '@/components/dashboard/TaxReminderModal';

export function DashboardPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business.id;
  const businessName = currentBusiness?.business.name;

  const income = useMonthlyIncome(businessId);
  const expenses = useMonthlyExpenses(businessId);
  const outstanding = useOutstandingInvoices(businessId);
  const trend = useIncomeExpenseTrend(businessId, 6);
  const recentEntries = useRecentJournalEntries(businessId, 10);

  const netProfit =
    income.data !== undefined && expenses.data !== undefined
      ? income.data.totalAmount - expenses.data
      : undefined;
  const netProfitIsLoading = income.isLoading || expenses.isLoading;
  const netProfitIsError = income.isError || expenses.isError;

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <AlertCircle className="h-7 w-7 text-brand-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">No business selected</h1>
        <p className="max-w-sm text-sm text-gray-500">
          You don't have an active business yet, or none is currently selected. Create or join a
          business to see your dashboard.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Tax reminder popup on login */}
      <TaxReminderModal />

      {/* Tax remittance panel — top priority */}
      <TaxRemittancePanel businessId={businessId} />

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          {businessName ? `Overview for ${businessName}` : 'Overview of your business'}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="mb-6">
        <QuickActions />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Income (This Month)"
          value={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)}
          subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined}
          icon={TrendingUp}
          isLoading={income.isLoading}
          isError={income.isError}
          tone="positive"
        />
        <MetricCard
          label="Total Expenses (This Month)"
          value={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)}
          icon={TrendingDown}
          isLoading={expenses.isLoading}
          isError={expenses.isError}
          tone="negative"
        />
        <MetricCard
          label="Net Profit (This Month)"
          value={netProfit !== undefined ? formatMwk(netProfit) : formatMwk(0)}
          icon={netProfit !== undefined && netProfit < 0 ? TrendingDown : TrendingUp}
          isLoading={netProfitIsLoading}
          isError={netProfitIsError}
          tone={netProfit !== undefined && netProfit < 0 ? 'negative' : 'positive'}
        />
        <MetricCard
          label="Outstanding Invoices"
          value={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          subtext={
            outstanding.data
              ? `${outstanding.data.count} unpaid or partially paid`
              : undefined
          }
          icon={FileText}
          isLoading={outstanding.isLoading}
          isError={outstanding.isError}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft lg:col-span-2">
          <h2 className="text-base font-semibold text-gray-900">Income vs Expenses</h2>
          <p className="mt-0.5 text-sm text-gray-500">Last 6 months</p>
          <div className="mt-4">
            <IncomeExpenseChart
              data={trend.data}
              isLoading={trend.isLoading}
              isError={trend.isError}
            />
          </div>
        </div>

        <CashFlowIndicator
          income={income.data?.totalAmount}
          expenses={expenses.data}
          isLoading={income.isLoading || expenses.isLoading}
          isError={income.isError || expenses.isError}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-soft">
        <h2 className="text-base font-semibold text-gray-900">Recent Transactions</h2>
        <p className="mt-0.5 text-sm text-gray-500">Last 10 journal entries</p>
        <div className="mt-4">
          <RecentTransactions
            entries={recentEntries.data}
            isLoading={recentEntries.isLoading}
            isError={recentEntries.isError}
          />
        </div>
      </div>
    </div>
  );
}