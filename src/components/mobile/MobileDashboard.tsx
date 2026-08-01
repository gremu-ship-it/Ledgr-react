import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  ClipboardList,
  AlertTriangle,
  Lock,
  Package,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useOutstandingInvoices,
  useIncomeExpenseTrend,
  useRecentJournalEntries,
  useMonthlyExpenseVat,
} from '@/hooks/useDashboardData';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { formatMwk, formatMwkCompact } from '@/lib/formatters';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { QuickExpenseMobile } from './QuickExpenseMobile';
import { QuickIncomeMobile } from './QuickIncomeMobile';
import { IconBadge, type IconTone } from '@/components/ui/IconBadge';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from './PullToRefreshIndicator';
import { SwipeableRow } from './SwipeableRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { CreditCard, Eye } from 'lucide-react';
import { MobileOnboardingChecklist } from '@/components/OnboardingChecklist';

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
  valueTitle,
  subtext,
  tone = 'neutral',
  icon,
  isLoading,
  trend,
  onClick,
}: {
  label: string;
  value: string;
  valueTitle?: string;
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
          <div className="h-3 w-16 rounded bg-gray-100" />
          <div className="h-9 w-9 rounded-2xl bg-gray-100" />
        </div>
        <div className="h-5 w-20 rounded bg-gray-100 mb-2" />
        <div className="h-2.5 w-14 rounded bg-gray-100" />
      </div>
    );
  }

  const Wrapper = onClick ? 'button' : 'div';

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Wrapper
      onClick={onClick as any}
      className={clsx(
        'group w-full rounded-2xl border border-white bg-white/80 p-4 text-left shadow-sm backdrop-blur-sm transition-all touch-manipulation',
        onClick && 'active:scale-[0.97] active:bg-white',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <IconBadge icon={icon} tone={tone} size="sm" interactive={!!onClick} />
        {trend && (
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight',
              trend.positive ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-500',
            )}
          >
            {trend.positive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {trend.pct.toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
      <p className={`text-lg font-black tracking-tight ${valueColor} truncate`} title={valueTitle ?? value}>
        {value}
      </p>
      {subtext && <p className="mt-1 text-[10px] font-medium text-gray-500 truncate uppercase">{subtext}</p>}
    </Wrapper>
  );
}

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
      onClick={() => {
        try {
          if ('vibrate' in navigator) navigator.vibrate(5);
        } catch {}
        onClick();
      }}
      className="group flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-2 py-3 transition-transform active:scale-95 touch-manipulation"
    >
      <IconBadge icon={icon} tone={tone} size="sm" interactive />
      <span className="text-[10px] font-semibold text-gray-700 text-center leading-tight">{label}</span>
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export function MobileDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name;

  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['monthly_income'] }),
      queryClient.invalidateQueries({ queryKey: ['monthly_expenses'] }),
      queryClient.invalidateQueries({ queryKey: ['income_expense_trend'] }),
      queryClient.invalidateQueries({ queryKey: ['recent_journal'] }),
      queryClient.invalidateQueries({ queryKey: ['outstanding_invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['reorder_alerts'] }),
    ]);
  }, [queryClient]);

  const { containerRef, pullDistance, isRefreshing, progress } = usePullToRefresh({ onRefresh, threshold: 70 });

  const income = useMonthlyIncome(businessId);
  const expenses = useMonthlyExpenses(businessId);
  const outstanding = useOutstandingInvoices(businessId);
  const trend = useIncomeExpenseTrend(businessId, 6);
  const recentEntries = useRecentJournalEntries(businessId, 5);

  const lowStock = useQuery({
    queryKey: ['reorder_alerts', businessId],
    queryFn: () => repos.inventory.findReorderAlerts(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });

  const netProfit =
    income.data !== undefined && expenses.data !== undefined ? income.data.totalAmount - expenses.data : undefined;

  const incomeTrend = monthOverMonthChange(trend.data, 'income');
  const expensesTrend = monthOverMonthChange(trend.data, 'expenses');

  const expenseVat = useMonthlyExpenseVat(businessId);
  const outputVat = income.data?.vatAmount ?? 0;
  const inputVat = expenseVat.data ?? 0;
  const netVat = outputVat - inputVat;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = currentUser?.profile?.full_name?.split(' ')[0] ?? currentUser?.email?.split('@')[0] ?? 'there';
  const { logoUrl } = useBrandTheme();
  const isProfitPositive = netProfit !== undefined && netProfit >= 0;

  return (
    <div ref={containerRef as any} className="relative flex flex-col gap-5 pb-[calc(6rem+env(safe-area-inset-bottom))] bg-[radial-gradient(120%_60%_at_0%_0%,rgba(14,124,90,0.06),transparent),radial-gradient(80%_50%_at_100%_20%,rgba(99,102,241,0.06),transparent)]">
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} progress={progress} />

      {/* Header */}
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt="Business logo" className="h-12 w-12 rounded-2xl object-cover shadow-sm ring-2 ring-white" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-lg font-black text-white shadow-lg ring-2 ring-white">
                {firstName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-black tracking-tight text-gray-900 leading-none">
              {greeting()}, <span className="text-brand-600">{firstName}</span>
            </h1>
            {businessName && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1.5 truncate">{businessName}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate('/settings?tab=appearance')}
          aria-label="Settings"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform active:scale-90 touch-manipulation"
        >
          <Settings className="h-5 w-5 text-gray-600" />
        </button>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-[1.75rem] p-5 shadow-xl shadow-brand-500/15 ring-1 ring-white/20">
        <div
          className={clsx(
            'absolute inset-0 transition-colors duration-300',
            netProfit === undefined ? 'bg-gray-100' : isProfitPositive ? 'bg-gradient-to-br from-brand-600 to-emerald-600' : 'bg-gradient-to-br from-red-600 to-rose-700',
          )}
        />
        <div className="relative z-10">
          {income.isLoading || expenses.isLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-3 w-24 rounded bg-white/20" />
              <div className="h-10 w-48 rounded bg-white/20" />
              <div className="h-4 w-32 rounded bg-white/20" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80">Current Balance</p>
                <div className="rounded-full bg-white/20 px-3 py-1">
                  <p className="text-[10px] font-bold text-white uppercase">{new Date().toLocaleDateString('en-MW', { month: 'short', year: 'numeric' })}</p>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-white tracking-tighter font-black leading-none" style={{ fontSize: 'clamp(1.75rem, 8vw, 2.5rem)' }}>
                  {netProfit !== undefined ? (isProfitPositive ? '+' : '-') : ''}
                  {formatMwkCompact(netProfit !== undefined ? Math.abs(netProfit) : 0)}
                </p>
                <p className="mt-1 text-xs font-medium text-white/75">
                  {netProfit !== undefined ? (isProfitPositive ? formatMwk(netProfit) : `-${formatMwk(Math.abs(netProfit))}`) : formatMwk(0)}
                </p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                    {isProfitPositive ? <TrendingUp className="h-4 w-4 text-white" /> : <TrendingDown className="h-4 w-4 text-white" />}
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-white/60 leading-none">Status</p>
                    <p className="text-xs font-black text-white mt-0.5">{isProfitPositive ? 'Surplus' : 'Deficit'}</p>
                  </div>
                </div>
                <button onClick={() => navigate('/reports')} className="rounded-xl bg-white/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white active:scale-95">
                  Insights
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Onboarding checklist (mobile compact) */}
      <MobileOnboardingChecklist />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Income" value={income.data ? formatMwkCompact(income.data.totalAmount) : formatMwkCompact(0)} valueTitle={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)} subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined} tone="brand" icon={TrendingUp} isLoading={income.isLoading} trend={incomeTrend} />
        <StatCard label="Expenses" value={expenses.data !== undefined ? formatMwkCompact(expenses.data) : formatMwkCompact(0)} valueTitle={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)} tone="negative" icon={Receipt} isLoading={expenses.isLoading} trend={expensesTrend} />
        <StatCard label="Outstanding" value={outstanding.data ? formatMwkCompact(outstanding.data.total) : formatMwkCompact(0)} valueTitle={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)} subtext={outstanding.data ? `${outstanding.data.count} invoices` : undefined} tone="info" icon={FileText} isLoading={outstanding.isLoading} onClick={() => navigate('/invoices')} />
        <StatCard label="VAT" value={formatMwkCompact(Math.abs(netVat))} valueTitle={formatMwk(Math.abs(netVat))} subtext={netVat >= 0 ? 'Payable to MRA' : 'Refundable'} tone="warning" icon={Percent} isLoading={expenseVat.isLoading || income.isLoading} onClick={() => navigate('/tax')} />
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-white bg-white/70 p-4 shadow-sm backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-900">Analytics</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Income vs Expenses</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-500 uppercase">6M</span>
        </div>
        <IncomeExpenseChart data={trend.data} isLoading={trend.isLoading} isError={trend.isError} compact />
      </div>

      {/* Quick Actions */}
      <div className="px-1">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Quick Actions</p>
        <div className="grid grid-cols-4 gap-2">
          <QuickActionButton icon={DollarSign} tone="brand" label="Income" onClick={() => setShowIncome(true)} />
          <QuickActionButton icon={Receipt} tone="negative" label="Expense" onClick={() => setShowExpense(true)} />
          <QuickActionButton icon={FileText} tone="info" label="Invoice" onClick={() => navigate('/income?action=invoice')} />
          <QuickActionButton icon={Users} tone="neutral" label="Payroll" onClick={() => navigate('/payroll?action=run')} />
        </div>
      </div>

      {/* Inventory */}
      <div className="grid grid-cols-1 gap-3">
        <button onClick={() => navigate('/warehouse')} className="w-full rounded-2xl border border-white bg-white/70 p-4 text-left shadow-sm backdrop-blur-sm active:scale-[0.98] touch-manipulation">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBadge icon={Package} tone={lowStock.data && lowStock.data.length > 0 ? 'warning' : 'brand'} size="sm" interactive />
              <div>
                <span className="text-xs font-black uppercase tracking-widest text-gray-900">Inventory</span>
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Stock Management</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-300" />
          </div>

          {lowStock.isLoading ? (
            <div className="h-12 animate-pulse rounded-xl bg-gray-100/50" />
          ) : lowStock.data && lowStock.data.length > 0 ? (
            <div className="rounded-xl bg-amber-50/80 p-3 ring-1 ring-amber-100">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-[11px] font-bold text-amber-800 uppercase">{lowStock.data.length} low stock alerts</p>
              </div>
              <div className="space-y-1.5">
                {lowStock.data.slice(0, 2).map((alert) => (
                  <div key={`${alert.product_id}-${alert.location_name}`} className="flex items-center justify-between">
                    <span className="truncate text-xs font-medium text-gray-700 max-w-[60%]">{alert.product_name}</span>
                    <span className="shrink-0 text-xs font-black text-gray-900">{Number(alert.quantity_available)} left</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-brand-50/60 p-3 ring-1 ring-brand-100">
              <p className="text-[11px] font-bold text-brand-700 uppercase text-center">Stock levels OK</p>
            </div>
          )}
        </button>
      </div>

      {/* Recent Transactions — with swipe */}
      <div className="px-1">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Recent</p>
          <button onClick={() => navigate('/reports')} className="text-[10px] font-black uppercase tracking-widest text-brand-600 underline underline-offset-4 touch-manipulation">
            View All
          </button>
        </div>

        {recentEntries.isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-gray-100/50" />
            ))}
          </div>
        ) : !recentEntries.data || recentEntries.data.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Start by recording income or expenses. Swipe actions will appear here."
            actionLabel="Record Income"
            onAction={() => setShowIncome(true)}
            variant="finance"
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white bg-white/70 shadow-sm divide-y divide-gray-100/50">
            {recentEntries.data.map((entry, i) => {
              const t: IconTone = entry.source_type === 'invoice' ? 'brand' : entry.source_type === 'expense' ? 'negative' : 'neutral';
              const Icon: LucideIcon = entry.source_type === 'invoice' ? DollarSign : entry.source_type === 'expense' ? Receipt : ClipboardList;
              return (
                <SwipeableRow
                  key={i}
                  actions={[
                    { label: 'View', icon: Eye, color: 'bg-gray-700', action: () => navigate('/journals') },
                    { label: 'Details', icon: CreditCard, color: 'bg-brand-500', action: () => navigate('/reports') },
                  ]}
                >
                  <div className="flex items-center justify-between px-4 py-3.5 bg-white active:bg-white/60 touch-manipulation">
                    <div className="flex items-center gap-3 min-w-0">
                      <IconBadge icon={Icon} tone={t} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-gray-900 truncate max-w-[140px]">{entry.description ?? entry.source_type ?? 'Journal'}</p>
                          {entry.isLocked && <Lock className="h-3 w-3 text-amber-500" />}
                        </div>
                        <p className="text-[10px] font-medium text-gray-500 uppercase mt-0.5">{entry.entry_date}</p>
                      </div>
                    </div>
                    <p className={clsx('text-[10px] font-bold uppercase px-2 py-1 rounded-md', entry.source_type === 'expense' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700')}>
                      {entry.source_type ?? 'entry'}
                    </p>
                  </div>
                </SwipeableRow>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-1">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Shortcuts</p>
        <div className="overflow-hidden rounded-2xl border border-white bg-white/70 shadow-sm divide-y divide-gray-100/50">
          {[
            { label: 'Invoices', icon: FileText, tone: 'info' as IconTone, path: '/invoices' },
            { label: 'Tax Center', icon: Percent, tone: 'warning' as IconTone, path: '/tax' },
            { label: 'Reports', icon: BarChart2, tone: 'brand' as IconTone, path: '/reports' },
            { label: 'Ledgr AI', icon: Sparkles, tone: 'brand' as IconTone, path: '/ai' },
          ].map((item) => (
            <button key={item.path} onClick={() => navigate(item.path)} className="flex w-full items-center justify-between px-4 py-3.5 active:bg-white/60 touch-manipulation">
              <div className="flex items-center gap-3">
                <IconBadge icon={item.icon} tone={item.tone} size="sm" interactive />
                <span className="text-xs font-bold uppercase tracking-widest text-gray-700">{item.label}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>
          ))}
        </div>
      </div>

      {businessId && (
        <>
          <QuickExpenseMobile businessId={businessId} open={showExpense} onClose={() => setShowExpense(false)} />
          <QuickIncomeMobile businessId={businessId} open={showIncome} onClose={() => setShowIncome(false)} />
        </>
      )}
    </div>
  );
}
