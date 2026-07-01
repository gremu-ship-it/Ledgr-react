import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Receipt,
  DollarSign,
  FileText,
  Users,
  BarChart2,
  Percent,
  BookUser,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useOutstandingInvoices,
  useIncomeExpenseTrend,
  useRecentJournalEntries,
} from '@/hooks/useDashboardData';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { formatMwk } from '@/lib/formatters';
import { QuickExpenseMobile } from './QuickExpenseMobile';
import { QuickIncomeMobile } from './QuickIncomeMobile';

// ── Icon Badge (neumorphic) ─────────────────────────────────────────────
// Shared soft-UI icon container used across stat cards, quick actions,
// shortcuts, and transaction rows for a consistent "app" feel.

type IconTone = 'brand' | 'negative' | 'neutral' | 'warning' | 'info';
type IconSize = 'sm' | 'md' | 'lg';

interface ToneStyle {
  icon: string;
  raised: string;
  pressedActive: string;
}

const TONE_STYLES: Record<IconTone, ToneStyle> = {
  brand: {
    icon: 'text-brand-600',
    raised: 'shadow-[4px_4px_10px_rgba(15,118,110,0.18),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(15,118,110,0.20),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  negative: {
    icon: 'text-red-500',
    raised: 'shadow-[4px_4px_10px_rgba(244,63,94,0.16),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(244,63,94,0.18),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  neutral: {
    icon: 'text-slate-500',
    raised: 'shadow-[4px_4px_10px_rgba(100,116,139,0.15),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(100,116,139,0.17),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  warning: {
    icon: 'text-amber-500',
    raised: 'shadow-[4px_4px_10px_rgba(245,158,11,0.18),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(245,158,11,0.20),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  info: {
    icon: 'text-indigo-500',
    raised: 'shadow-[4px_4px_10px_rgba(99,102,241,0.16),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(99,102,241,0.18),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
};

const SIZE_STYLES: Record<IconSize, { box: string; icon: string }> = {
  sm: { box: 'h-9 w-9', icon: 'h-4 w-4' },
  md: { box: 'h-11 w-11', icon: 'h-5 w-5' },
  lg: { box: 'h-14 w-14', icon: 'h-6 w-6' },
};

function IconBadge({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
  interactive = false,
}: {
  icon: LucideIcon;
  tone?: IconTone;
  size?: IconSize;
  interactive?: boolean;
}) {
  const t = TONE_STYLES[tone];
  const s = SIZE_STYLES[size];
  return (
    <span
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-2xl bg-white transition-shadow duration-150',
        s.box,
        t.raised,
        interactive && t.pressedActive,
      )}
    >
      <Icon className={clsx(s.icon, t.icon)} />
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function monthOverMonthChange(
  data: { month: string; income: number; expenses: number }[] | undefined,
  key: 'income' | 'expenses',
): { pct: number; positive: boolean } | null {
  if (!data || data.length < 2) return null;
  const prev = data[data.length - 2][key];
  const curr = data[data.length - 1][key];
  if (!prev) return null;
  const pct = ((curr - prev) / prev) * 100;
  const positive = key === 'expenses' ? pct <= 0 : pct >= 0;
  return { pct: Math.abs(pct), positive };
}

// ── Stat Card ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtext,
  tone = 'neutral',
  icon,
  isLoading,
  trend,
  onClick,
}: {
  label: string;
  value: string;
  subtext?: string;
  tone?: IconTone;
  icon: LucideIcon;
  isLoading?: boolean;
  trend?: { pct: number; positive: boolean } | null;
  onClick?: () => void;
}) {
  const valueColor = {
    brand: 'text-brand-700',
    negative: 'text-red-600',
    neutral: 'text-gray-900',
    warning: 'text-amber-600',
    info: 'text-indigo-600',
  }[tone];

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-3 w-20 rounded bg-gray-100" />
          <div className="h-9 w-9 rounded-2xl bg-gray-100" />
        </div>
        <div className="h-6 w-28 rounded bg-gray-100 mb-2" />
        <div className="h-2.5 w-16 rounded bg-gray-100" />
      </div>
    );
  }

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={clsx(
        'group w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition-transform',
        onClick && 'active:scale-[0.98]',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <IconBadge icon={icon} tone={tone} size="sm" interactive={!!onClick} />
      </div>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {subtext && <p className="text-xs text-gray-400">{subtext}</p>}
        {trend && (
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              trend.positive ? 'text-brand-600' : 'text-red-500',
            )}
          >
            {trend.positive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {trend.pct.toFixed(1)}%
          </span>
        )}
        {onClick && !trend && (
          <ChevronRight className="h-3 w-3 text-gray-300 ml-auto" />
        )}
      </div>
    </Wrapper>
  );
}

// ── Quick Action Button ─────────────────────────────────────────────────

function QuickActionButton({
  icon,
  tone,
  label,
  onClick,
}: {
  icon: LucideIcon;
  tone: IconTone;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 transition-transform active:scale-95"
    >
      <IconBadge icon={icon} tone={tone} size="lg" interactive />
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export function MobileDashboard() {
  const navigate = useNavigate();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name;

  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);

  const income = useMonthlyIncome(businessId);
  const expenses = useMonthlyExpenses(businessId);
  const outstanding = useOutstandingInvoices(businessId);
  const trend = useIncomeExpenseTrend(businessId, 6);
  const recentEntries = useRecentJournalEntries(businessId, 5);

  const netProfit =
    income.data !== undefined && expenses.data !== undefined
      ? income.data.totalAmount - expenses.data
      : undefined;

  const incomeTrend = monthOverMonthChange(trend.data, 'income');
  const expensesTrend = monthOverMonthChange(trend.data, 'expenses');

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = currentUser?.profile?.full_name?.split(' ')[0]
    ?? currentUser?.email?.split('@')[0]
    ?? 'there';

  return (
    <div className="flex flex-col gap-5 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">{greeting()}</p>
          <h1 className="text-lg font-bold text-gray-900">{firstName} 👋</h1>
          {businessName && (
            <p className="text-xs text-gray-500 mt-0.5">{businessName}</p>
          )}
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white shadow-sm"
        >
          {firstName[0]?.toUpperCase()}
        </button>
      </div>

      {/* Net Profit Hero Card */}
      <div className={clsx(
        'rounded-2xl p-5 shadow-sm',
        netProfit === undefined
          ? 'bg-gray-100'
          : netProfit >= 0
          ? 'bg-gradient-to-br from-brand-500 to-brand-600'
          : 'bg-gradient-to-br from-red-500 to-red-600',
      )}>
        {income.isLoading || expenses.isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-3 w-24 rounded bg-white/20" />
            <div className="h-8 w-40 rounded bg-white/20" />
            <div className="h-3 w-20 rounded bg-white/20" />
          </div>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wider text-white/70">
              Net Profit This Month
            </p>
            <p className="mt-1 text-3xl font-bold text-white tracking-tight">
              {netProfit !== undefined ? formatMwk(Math.abs(netProfit)) : formatMwk(0)}
            </p>
            <div className="mt-3 flex items-center gap-1">
              {netProfit !== undefined && netProfit >= 0
                ? <TrendingUp className="h-3.5 w-3.5 text-white/70" />
                : <TrendingDown className="h-3.5 w-3.5 text-white/70" />}
              <p className="text-xs text-white/70">
                {netProfit !== undefined && netProfit >= 0 ? 'Profitable' : 'Loss'} · {new Date().toLocaleDateString('en-MW', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Stat Cards — single column */}
      <div className="grid grid-cols-1 gap-3">
        <StatCard
          label="Income"
          value={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)}
          subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined}
          tone="brand"
          icon={TrendingUp}
          isLoading={income.isLoading}
          trend={incomeTrend}
        />
        <StatCard
          label="Expenses"
          value={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)}
          tone="negative"
          icon={Receipt}
          isLoading={expenses.isLoading}
          trend={expensesTrend}
        />
        <StatCard
          label="Outstanding"
          value={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          subtext={outstanding.data ? `${outstanding.data.count} invoices` : undefined}
          tone="info"
          icon={FileText}
          isLoading={outstanding.isLoading}
          onClick={() => navigate('/invoices')}
        />
        <StatCard
          label="This Month"
          value={new Date().toLocaleDateString('en-MW', { month: 'short', year: 'numeric' })}
          subtext="Tap for reports"
          tone="neutral"
          icon={BarChart2}
          isLoading={false}
          onClick={() => navigate('/reports')}
        />
      </div>

      {/* Income vs Expenses Chart */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Income vs Expenses</h2>
          <span className="text-xs text-gray-400">6 months</span>
        </div>
        <IncomeExpenseChart
          data={trend.data}
          isLoading={trend.isLoading}
          isError={trend.isError}
        />
      </div>

      {/* Quick Actions */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Quick Actions
        </p>
        <div className="grid grid-cols-4 gap-2">
          <QuickActionButton
            icon={DollarSign}
            tone="brand"
            label="Income"
            onClick={() => setShowIncome(true)}
          />
          <QuickActionButton
            icon={Receipt}
            tone="negative"
            label="Expense"
            onClick={() => setShowExpense(true)}
          />
          <QuickActionButton
            icon={FileText}
            tone="info"
            label="Invoice"
            onClick={() => navigate('/income?action=invoice')}
          />
          <QuickActionButton
            icon={Users}
            tone="neutral"
            label="Payroll"
            onClick={() => navigate('/payroll?action=run')}
          />
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Recent Transactions
          </p>
          <button
            onClick={() => navigate('/reports')}
            className="text-xs font-medium text-brand-600"
          >
            See all
          </button>
        </div>

        {recentEntries.isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : !recentEntries.data || recentEntries.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-8 text-center">
            <Receipt className="mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm font-medium text-gray-500">No transactions yet</p>
            <p className="mt-0.5 text-xs text-gray-400">Tap + to record your first one</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 shadow-sm">
            {recentEntries.data.map((entry, i) => {
              const t: IconTone =
                entry.source_type === 'invoice' ? 'brand'
                : entry.source_type === 'expense' ? 'negative'
                : 'neutral';
              const Icon: LucideIcon =
                entry.source_type === 'invoice' ? DollarSign
                : entry.source_type === 'expense' ? Receipt
                : ClipboardList;

              return (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <IconBadge icon={Icon} tone={t} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate max-w-[140px]">
                        {entry.description ?? entry.source_type ?? 'Transaction'}
                      </p>
                      <p className="text-xs text-gray-400">{entry.entry_date}</p>
                    </div>
                  </div>
                  <p className={clsx(
                    'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                    entry.source_type === 'expense' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700',
                  )}>
                    {entry.source_type ?? 'journal'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Shortcuts */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Shortcuts
        </p>
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 shadow-sm">
          {[
            { label: 'View Invoices', icon: FileText, tone: 'info' as IconTone, path: '/invoices' },
            { label: 'Tax & Compliance', icon: Percent, tone: 'warning' as IconTone, path: '/tax' },
            { label: 'Reports', icon: BarChart2, tone: 'brand' as IconTone, path: '/reports' },
            { label: 'Contacts', icon: BookUser, tone: 'neutral' as IconTone, path: '/contacts' },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="group flex w-full items-center justify-between px-4 py-3 transition-colors active:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <IconBadge icon={item.icon} tone={item.tone} size="sm" interactive />
                <span className="text-sm font-medium text-gray-700">{item.label}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>
          ))}
        </div>
      </div>

      {/* Quick entry sheets */}
      {businessId && (
        <>
          <QuickExpenseMobile
            businessId={businessId}
            open={showExpense}
            onClose={() => setShowExpense(false)}
          />
          <QuickIncomeMobile
            businessId={businessId}
            open={showIncome}
            onClose={() => setShowIncome(false)}
          />
        </>
      )}
    </div>
  );
}