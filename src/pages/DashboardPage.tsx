import { useNavigate } from 'react-router-dom';
import { AlertCircle, Plus, DollarSign, Receipt, Users, FileText } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useMonthlyExpenseVat,
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
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileDashboard } from '@/components/mobile/MobileDashboard';

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  trendUp?: boolean;
  featured?: boolean;
  isLoading?: boolean;
  isError?: boolean;
}

function KpiCard({ label, value, sub, trendUp = true, featured = false, isLoading, isError }: KpiCardProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 h-3 w-24 rounded bg-gray-100" />
        <div className="mb-2 h-7 w-32 rounded bg-gray-100" />
        <div className="h-3 w-20 rounded bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-red-100 bg-red-50 p-5">
        <p className="text-xs text-red-500">Failed to load</p>
      </div>
    );
  }

  if (featured) {
    return (
      <div
        className="relative overflow-hidden rounded-2xl p-5"
        style={{ background: 'linear-gradient(135deg, #065c42, #0a7c5a)' }}
      >
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/70">{label}</p>
        <p className="mb-2 text-3xl font-extrabold text-white">{value}</p>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
            trendUp ? 'bg-white/20 text-white' : 'bg-red-400/30 text-white'
          }`}>
            {trendUp ? '▲' : '▼'} {trendUp ? 'Profitable' : 'Loss'}
          </span>
          {sub && <span className="text-sm text-white/80">{sub}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mb-2 text-2xl font-extrabold text-gray-900">{value}</p>
      {sub && <p className="text-sm text-gray-400">{sub}</p>}
    </div>
  );
}

// ── Quick Actions ─────────────────────────────────────────────────────────────

function QuickActions() {
  const navigate = useNavigate();

  const actions = [
    { label: 'New Invoice',    icon: Plus,       onClick: () => navigate('/income?action=invoice'),  color: 'bg-brand-500 hover:bg-brand-600 text-white' },
    { label: 'Record Income',  icon: DollarSign, onClick: () => navigate('/income?action=record'),   color: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200' },
    { label: 'Record Expense', icon: Receipt,    onClick: () => navigate('/expenses?action=record'), color: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200' },
    { label: 'Run Payroll',    icon: Users,      onClick: () => navigate('/payroll?action=run'),     color: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200' },
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
  const businessId      = currentBusiness?.business.id;
  const businessName    = currentBusiness?.business.name;
  const isMobile        = useIsMobile();

  const income        = useMonthlyIncome(businessId);
  const expenses      = useMonthlyExpenses(businessId);
  const expenseVat    = useMonthlyExpenseVat(businessId);
  const outstanding   = useOutstandingInvoices(businessId);
  const trend         = useIncomeExpenseTrend(businessId, 6);
  const recentEntries = useRecentJournalEntries(businessId, 10);

  const netProfit =
    income.data !== undefined && expenses.data !== undefined
      ? income.data.totalAmount - expenses.data
      : undefined;
  const netIsLoading = income.isLoading || expenses.isLoading;
  const netIsError   = income.isError   || expenses.isError;

  // Net VAT payable/accrued = output VAT collected on sales - input VAT paid
  // on purchases, using the *actual* vat_amount recorded on each invoice and
  // expense — not a flat rate assumption. A business that is fully zero-rated
  // or tax-exempt will correctly show MK 0 here, since no vat_amount was ever
  // recorded on its transactions.
  const outputVat  = income.data?.vatAmount ?? 0;
  const inputVat   = expenseVat.data ?? 0;
  const netVat     = outputVat - inputVat;
  const vatIsLoading = income.isLoading || expenseVat.isLoading;
  const vatIsError   = income.isError   || expenseVat.isError;

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <AlertCircle className="h-7 w-7 text-brand-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">No business selected</h1>
        <p className="max-w-sm text-sm text-gray-500">
          You don't have an active business yet, or none is currently selected.
        </p>
      </div>
    );
  }

  if (isMobile) return <MobileDashboard />;

  return (
    <div className="space-y-6">
      {/* Tax reminder — fires once per session when tax is due */}
      <TaxReminderModal />

      {/* Tax remittance panel */}
      <TaxRemittancePanel businessId={businessId} />

      {/* Page header + Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Financial Overview</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {businessName ? `Real-time insights for ${businessName}` : 'Real-time insights'} · MWK
          </p>
        </div>
        <QuickActions />
      </div>

      {/* KPI Cards — 5 cards, first one featured */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Net Profit"
          value={netProfit !== undefined ? formatMwk(netProfit) : formatMwk(0)}
          sub="This month"
          trendUp={netProfit === undefined || netProfit >= 0}
          featured
          isLoading={netIsLoading}
          isError={netIsError}
        />
        <KpiCard
          label="Total Income"
          value={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)}
          sub={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined}
          trendUp
          isLoading={income.isLoading}
          isError={income.isError}
        />
        <KpiCard
          label="Total Expenses"
          value={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)}
          sub="This month"
          trendUp={false}
          isLoading={expenses.isLoading}
          isError={expenses.isError}
        />
        <KpiCard
          label="Accounts Receivable"
          value={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          sub={outstanding.data ? `${outstanding.data.count} unpaid invoices` : '0 invoices'}
          trendUp={false}
          isLoading={outstanding.isLoading}
          isError={outstanding.isError}
        />
        <KpiCard
          label="VAT Accrued"
          value={formatMwk(Math.abs(netVat))}
          sub={netVat >= 0 ? 'Payable to MRA' : 'Refundable (input > output)'}
          trendUp={netVat >= 0}
          isLoading={vatIsLoading}
          isError={vatIsError}
        />
      </div>

      {/* Charts row — Income/Expense chart (2/3) + Cash Flow (1/3) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">Income vs Expenses</h2>
              <p className="text-xs text-gray-400">Monthly cash flow (MWK) · Last 6 months</p>
            </div>
          </div>
          <IncomeExpenseChart
            data={trend.data}
            isLoading={trend.isLoading}
            isError={trend.isError}
          />
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

      {/* Recent Transactions — full width with search + pagination */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Recent Transactions</h2>
            <p className="mt-0.5 text-xs text-gray-400">Last 10 journal entries</p>
          </div>
          <FileText className="h-4 w-4 text-gray-300" />
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
