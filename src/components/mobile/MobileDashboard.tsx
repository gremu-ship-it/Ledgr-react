import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  AlertTriangle,
  Lock,
  Package,
  Smartphone,
  Plus,
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
    <Wrapper
      onClick={onClick}
      className={clsx(
        'group w-full rounded-3xl border border-white bg-white/60 p-4 text-left shadow-sm backdrop-blur-md transition-all',
        onClick && 'active:scale-95 active:bg-white/80',
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
            {trend.positive ? (
              <TrendingUp className="h-2.5 w-2.5" />
            ) : (
              <TrendingDown className="h-2.5 w-2.5" />
            )}
            {trend.pct.toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
      <p className={`text-xl font-black tracking-tight ${valueColor} truncate`} title={valueTitle ?? value}>{value}</p>
      {subtext && <p className="mt-1 text-[10px] font-medium text-gray-400 truncate uppercase">{subtext}</p>}
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
      className="group flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-5 transition-transform active:scale-95"
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

  const lowStock = useQuery({
    queryKey: ['reorder_alerts', businessId],
    queryFn: () => repos.inventory.findReorderAlerts(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });

  const netProfit =
    income.data !== undefined && expenses.data !== undefined
      ? income.data.totalAmount - expenses.data
      : undefined;

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

  const firstName = currentUser?.profile?.full_name?.split(' ')[0]
    ?? currentUser?.email?.split('@')[0]
    ?? 'there';

  const { logoUrl } = useBrandTheme();

  return (
    <div className="relative flex flex-col gap-6 pb-24">
      {/* Futuristic Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[70%] rounded-full bg-brand-500/5 blur-[120px]" />
        <div className="absolute top-[20%] -right-[10%] h-[30%] w-[60%] rounded-full bg-indigo-500/5 blur-[100px]" />
        <div className="absolute bottom-[10%] left-[20%] h-[40%] w-[80%] rounded-full bg-brand-400/5 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-brand-600 to-indigo-600 opacity-20 blur-sm" />
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Business logo"
                className="relative h-12 w-12 shrink-0 rounded-2xl object-cover shadow-sm ring-2 ring-white"
              />
            ) : (
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500 text-lg font-black text-white shadow-lg ring-2 ring-white">
                {firstName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight text-gray-900 leading-none">
              {greeting()}, <span className="text-brand-600">{firstName}</span>
            </h1>
            {businessName && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1.5 truncate">
                {businessName}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform active:scale-90"
        >
          <Smartphone className="h-5 w-5 text-gray-400 group-hover:text-brand-600" />
        </button>
      </div>

      {/* Net Profit Hero Card — Futuristic Glassmorphism */}
      <div className="relative overflow-hidden rounded-[2.5rem] p-6 shadow-2xl shadow-brand-500/20 ring-1 ring-white/20">
        <div className={clsx(
          'absolute inset-0 transition-colors duration-500',
          netProfit === undefined
            ? 'bg-gray-100'
            : netProfit >= 0
            ? 'bg-gradient-to-br from-brand-500 via-brand-600 to-emerald-600'
            : 'bg-gradient-to-br from-red-500 via-red-600 to-rose-700',
        )} />
        
        {/* Decorative Circles */}
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-black/10 blur-2xl" />

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
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80">
                  Current Balance
                </p>
                <div className="rounded-full bg-white/20 px-3 py-1 backdrop-blur-md">
                  <p className="text-[10px] font-bold text-white uppercase">
                    {new Date().toLocaleDateString('en-MW', { month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
              
              <div className="mt-4">
                <p
                  className="text-white tracking-tighter font-black leading-none"
                  style={{ fontSize: 'clamp(2rem, 10vw, 3.5rem)' }}
                >
                  {netProfit !== undefined ? formatMwkCompact(Math.abs(netProfit)) : formatMwkCompact(0)}
                </p>
                <p className="mt-1 text-sm font-medium text-white/70">
                  {netProfit !== undefined ? formatMwk(Math.abs(netProfit)) : formatMwk(0)}
                </p>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md',
                    netProfit !== undefined && netProfit >= 0 ? 'bg-white/20' : 'bg-black/20'
                  )}>
                    {netProfit !== undefined && netProfit >= 0
                      ? <TrendingUp className="h-4 w-4 text-white" />
                      : <TrendingDown className="h-4 w-4 text-white" />}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60 leading-none">Status</p>
                    <p className="text-xs font-black text-white mt-0.5">
                      {netProfit !== undefined && netProfit >= 0 ? 'Surplus' : 'Deficit'}
                    </p>
                  </div>
                </div>
                
                <button 
                  onClick={() => navigate('/reports')}
                  className="rounded-xl bg-white/20 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white backdrop-blur-md transition-all active:scale-95 active:bg-white/30"
                >
                  View Insights
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stat Cards — 2-column grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Income"
          value={income.data ? formatMwkCompact(income.data.totalAmount) : formatMwkCompact(0)}
          valueTitle={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)}
          subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined}
          tone="brand"
          icon={TrendingUp}
          isLoading={income.isLoading}
          trend={incomeTrend}
        />
        <StatCard
          label="Expenses"
          value={expenses.data !== undefined ? formatMwkCompact(expenses.data) : formatMwkCompact(0)}
          valueTitle={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)}
          tone="negative"
          icon={Receipt}
          isLoading={expenses.isLoading}
          trend={expensesTrend}
        />
        <StatCard
          label="Outstanding"
          value={outstanding.data ? formatMwkCompact(outstanding.data.total) : formatMwkCompact(0)}
          valueTitle={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          subtext={outstanding.data ? `${outstanding.data.count} invoices` : undefined}
          tone="info"
          icon={FileText}
          isLoading={outstanding.isLoading}
          onClick={() => navigate('/invoices')}
        />
        <StatCard
          label="VAT Accrued"
          value={netVat !== undefined ? formatMwkCompact(Math.abs(netVat)) : formatMwkCompact(0)}
          valueTitle={netVat !== undefined ? formatMwk(Math.abs(netVat)) : formatMwk(0)}
          subtext={netVat !== undefined ? (netVat >= 0 ? 'Payable to MRA' : 'Refundable (input > output)') : 'Tax status'}
          tone="warning"
          icon={Percent}
          isLoading={expenseVat.isLoading || income.isLoading}
          onClick={() => navigate('/tax')}
        />
      </div>

      {/* Income vs Expenses Chart */}
      <div className="rounded-[2rem] border border-white bg-white/60 p-6 shadow-sm backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">Analytics</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Income vs Expenses</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-500 uppercase">6 Months</span>
        </div>
        <IncomeExpenseChart
          data={trend.data}
          isLoading={trend.isLoading}
          isError={trend.isError}
          compact
        />
      </div>

      {/* Quick Actions */}
      <div className="px-1">
        <p className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
          Terminal
        </p>
        <div className="grid grid-cols-4 gap-4">
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

      {/* Inventory + Mobile Money */}
      <div className="grid grid-cols-1 gap-4">
        <button
          onClick={() => navigate('/warehouse')}
          className="relative overflow-hidden w-full rounded-[2rem] border border-white bg-white/60 p-6 text-left shadow-sm backdrop-blur-md transition-all active:scale-[0.98]"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBadge icon={Package} tone={lowStock.data && lowStock.data.length > 0 ? 'warning' : 'brand'} size="sm" interactive />
              <div>
                <span className="text-sm font-black uppercase tracking-widest text-gray-900">Inventory</span>
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Stock Management</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-300" />
          </div>

          {lowStock.isLoading ? (
            <div className="h-12 animate-pulse rounded-2xl bg-gray-100/50" />
          ) : lowStock.data && lowStock.data.length > 0 ? (
            <div className="rounded-2xl bg-amber-50/50 p-3 ring-1 ring-amber-100">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-[11px] font-bold text-amber-700 uppercase">
                  {lowStock.data.length} Alerts
                </p>
              </div>
              <div className="space-y-2">
                {lowStock.data.slice(0, 2).map((alert) => (
                  <div key={`${alert.product_id}-${alert.location_name}`} className="flex items-center justify-between">
                    <span className="truncate text-xs font-medium text-gray-600">{alert.product_name}</span>
                    <span className="shrink-0 text-xs font-black text-gray-900">
                      {Number(alert.quantity_available)} left
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-brand-50/50 p-3 ring-1 ring-brand-100">
              <p className="text-xs font-bold text-brand-700 uppercase text-center italic">Optimal stock levels maintained</p>
            </div>
          )}
        </button>

        <div className="w-full rounded-[2rem] border border-dashed border-gray-200 bg-white/40 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <IconBadge icon={Smartphone} tone="neutral" size="sm" />
            <div>
              <span className="text-sm font-black uppercase tracking-widest text-gray-400">Integrations</span>
              <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">Mobile Money (Coming Soon)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="px-1">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
            Log
          </p>
          <button
            onClick={() => navigate('/reports')}
            className="text-[10px] font-black uppercase tracking-widest text-brand-600 underline underline-offset-4"
          >
            History
          </button>
        </div>

        {recentEntries.isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-3xl bg-gray-100/50" />
            ))}
          </div>
        ) : !recentEntries.data || recentEntries.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[2rem] border border-dashed border-gray-200 py-10 text-center">
            <Receipt className="mb-3 h-10 w-10 text-gray-200" />
            <p className="text-xs font-black uppercase tracking-widest text-gray-400 text-center px-6 leading-relaxed">No data detected. Start by recording a transaction.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[2rem] border border-white bg-white/60 shadow-sm backdrop-blur-md divide-y divide-gray-100/50">
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
                <div key={i} className="flex items-center justify-between px-5 py-4 transition-colors active:bg-white/40">
                  <div className="flex items-center gap-4 min-w-0">
                    <IconBadge icon={Icon} tone={t} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-black text-gray-900 truncate max-w-[140px] uppercase tracking-wide">
                          {entry.description ?? entry.source_type ?? 'Journal'}
                        </p>
                        {entry.isLocked && (
                          <Lock className="h-3 w-3 text-amber-500" />
                        )}
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{entry.entry_date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={clsx(
                      'text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg',
                      entry.source_type === 'expense' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700',
                    )}>
                      {entry.source_type ?? 'entry'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Shortcuts */}
      <div className="px-1">
        <p className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
          Navigation
        </p>
        <div className="overflow-hidden rounded-[2rem] border border-white bg-white/60 shadow-sm backdrop-blur-md divide-y divide-gray-100/50">
          {[
            { label: 'View Invoices', icon: FileText, tone: 'info' as IconTone, path: '/invoices' },
            { label: 'Tax Center', icon: Percent, tone: 'warning' as IconTone, path: '/tax' },
            { label: 'Market Intelligence', icon: BarChart2, tone: 'brand' as IconTone, path: '/reports' },
            { label: 'Neural Network', icon: Sparkles, tone: 'brand' as IconTone, path: '/ai' },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="group flex w-full items-center justify-between px-5 py-4 transition-colors active:bg-white/40"
            >
              <div className="flex items-center gap-4">
                <IconBadge icon={item.icon} tone={item.tone} size="sm" interactive />
                <span className="text-xs font-black uppercase tracking-widest text-gray-700">{item.label}</span>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300 transition-transform group-active:translate-x-1" />
            </button>
          ))}
        </div>
      </div>

      {/* Action Button Removed — Now part of BottomNav */}


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
