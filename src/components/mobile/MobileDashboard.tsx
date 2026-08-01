import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Receipt,
  DollarSign,
  FileText,
  Users,
  Percent,
  AlertTriangle,
  Lock,
  Package,
  Settings,
  ChevronDown,
  Eye,
  EyeOff,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useOutstandingInvoices,
  useMonthlyExpenseVat,
} from '@/hooks/useDashboardData';
import { formatMwk, formatMwkCompact } from '@/lib/formatters';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { QuickExpenseMobile } from './QuickExpenseMobile';
import { QuickIncomeMobile } from './QuickIncomeMobile';
import { IconBadge, type IconTone } from '@/components/ui/IconBadge';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from './PullToRefreshIndicator';
import { MobileOnboardingChecklist } from '@/components/OnboardingChecklist';
import { isItemLocked, visibleSectionsFor } from '@/components/layout/navConfig';
import { usePartner } from '@/partner/PartnerContext';
import { useUsage } from '@/hooks/useUsage';

// ── Stat Card ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  valueTitle,
  subtext,
  tone = 'neutral',
  icon,
  isLoading,
  onClick,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  subtext?: string;
  tone?: IconTone;
  icon: LucideIcon;
  isLoading?: boolean;
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

  const className = clsx(
    'group w-full rounded-2xl border border-white bg-white/80 p-4 text-left shadow-sm backdrop-blur-sm transition-all touch-manipulation',
    onClick && 'active:scale-[0.97] active:bg-white',
  );
  const content = <>
    <div className="mb-3 flex items-center justify-between">
      <IconBadge icon={icon} tone={tone} size="sm" interactive={Boolean(onClick)} />
    </div>
    <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
    <p className={`truncate text-lg font-black tracking-tight ${valueColor}`} title={valueTitle ?? value}>
      {value}
    </p>
    {subtext && <p className="mt-1 truncate text-[10px] font-medium uppercase text-gray-500">{subtext}</p>}
  </>;

  return onClick ? <button type="button" onClick={onClick} className={className}>{content}</button> : <div className={className}>{content}</div>;
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
        } catch {
          // Haptic feedback is optional.
        }
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

type MobileActionId = 'income' | 'expense' | 'invoice' | 'payroll' | 'stock' | 'contacts';
const DEFAULT_MOBILE_ACTIONS: MobileActionId[] = ['income', 'expense', 'invoice', 'payroll'];

function getMobilePreferences(): { quickActionIds: MobileActionId[]; pinnedPaths: string[] } {
  if (typeof window === 'undefined') return { quickActionIds: DEFAULT_MOBILE_ACTIONS, pinnedPaths: [] };
  try {
    const saved = localStorage.getItem('ledgr-mobile-dashboard-preferences');
    const preferences = saved ? JSON.parse(saved) as { quickActionIds?: MobileActionId[]; pinnedPaths?: string[] } : null;
    return { quickActionIds: preferences?.quickActionIds?.slice(0, 4) || DEFAULT_MOBILE_ACTIONS, pinnedPaths: preferences?.pinnedPaths || [] };
  } catch {
    return { quickActionIds: DEFAULT_MOBILE_ACTIONS, pinnedPaths: [] };
  }
}

export function MobileDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const { isFeatureEnabled } = usePartner();
  const { planTier } = useUsage();
  const currentUser = useAppStore((s) => s.currentUser);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name;
  const workspaceSections = visibleSectionsFor(isFeatureEnabled, currentBusiness?.role)
    .filter((section) => section.labelKey !== 'navigation.sections.overview');

  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [preferences] = useState(getMobilePreferences);
  const [quickActionIds, setQuickActionIds] = useState<MobileActionId[]>(preferences.quickActionIds);
  const [showActionEditor, setShowActionEditor] = useState(false);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(preferences.pinnedPaths);

  useEffect(() => {
    localStorage.setItem('ledgr-mobile-dashboard-preferences', JSON.stringify({ quickActionIds, pinnedPaths }));
  }, [quickActionIds, pinnedPaths]);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['monthly_income'] }),
      queryClient.invalidateQueries({ queryKey: ['monthly_expenses'] }),
      queryClient.invalidateQueries({ queryKey: ['outstanding_invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['reorder_alerts'] }),
    ]);
  }, [queryClient]);

  const { containerRef, pullDistance, isRefreshing, progress } = usePullToRefresh({ onRefresh, threshold: 70 });

  const income = useMonthlyIncome(businessId);
  const expenses = useMonthlyExpenses(businessId);
  const outstanding = useOutstandingInvoices(businessId);

  const lowStock = useQuery({
    queryKey: ['reorder_alerts', businessId],
    queryFn: () => repos.inventory.findReorderAlerts(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });

  const netProfit =
    income.data !== undefined && expenses.data !== undefined ? income.data.totalAmount - expenses.data : undefined;

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
  const mobileActions: Record<MobileActionId, { label: string; icon: LucideIcon; tone: IconTone; run: () => void }> = {
    income: { label: 'Income', icon: DollarSign, tone: 'brand', run: () => setShowIncome(true) },
    expense: { label: 'Expense', icon: Receipt, tone: 'negative', run: () => setShowExpense(true) },
    invoice: { label: 'Invoice', icon: FileText, tone: 'info', run: () => navigate('/income?action=invoice') },
    payroll: { label: 'Payroll', icon: Users, tone: 'neutral', run: () => navigate('/payroll?action=run') },
    stock: { label: 'Stock', icon: Package, tone: 'brand', run: () => navigate('/warehouse') },
    contacts: { label: 'Contacts', icon: Users, tone: 'info', run: () => navigate('/contacts') },
  };

  return (
    <div ref={containerRef} className="relative flex flex-col gap-5 pb-[calc(6rem+env(safe-area-inset-bottom))] bg-[radial-gradient(120%_60%_at_0%_0%,rgba(14,124,90,0.06),transparent),radial-gradient(80%_50%_at_100%_20%,rgba(99,102,241,0.06),transparent)]">
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('ledgr:open-command-palette'))}
            aria-label="Search Ledgr"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform active:scale-90 touch-manipulation"
          >
            <Search className="h-5 w-5 text-gray-600" />
          </button>
          <button
          onClick={() => navigate('/settings?tab=appearance')}
          aria-label="Settings"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform active:scale-90 touch-manipulation"
        >
          <Settings className="h-5 w-5 text-gray-600" />
          </button>
        </div>
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
                <button
                  type="button"
                  onClick={() => setBalanceVisible((visible) => !visible)}
                  className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold text-white uppercase"
                  aria-label={balanceVisible ? 'Hide balance' : 'Show balance'}
                >
                  {balanceVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {balanceVisible ? 'Hide' : 'Show'}
                </button>
                <div className="hidden rounded-full bg-white/20 px-3 py-1">
                  <p className="text-[10px] font-bold text-white uppercase">{new Date().toLocaleDateString('en-MW', { month: 'short', year: 'numeric' })}</p>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-white tracking-tighter font-black leading-none" style={{ fontSize: 'clamp(1.75rem, 8vw, 2.5rem)' }}>
                  {netProfit !== undefined ? (isProfitPositive ? '+' : '-') : ''}
                  {balanceVisible ? formatMwkCompact(netProfit !== undefined ? Math.abs(netProfit) : 0) : '••••••'}
                </p>
                <p className="mt-1 text-xs font-medium text-white/75">
                  {balanceVisible ? (netProfit !== undefined ? (isProfitPositive ? formatMwk(netProfit) : `-${formatMwk(Math.abs(netProfit))}`) : formatMwk(0)) : 'Balance hidden'}
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

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Income" value={income.data ? formatMwkCompact(income.data.totalAmount) : formatMwkCompact(0)} valueTitle={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)} subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined} tone="brand" icon={TrendingUp} isLoading={income.isLoading} onClick={() => navigate('/income')} />
        <StatCard label="Expenses" value={expenses.data !== undefined ? formatMwkCompact(expenses.data) : formatMwkCompact(0)} valueTitle={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)} tone="negative" icon={Receipt} isLoading={expenses.isLoading} onClick={() => navigate('/expenses')} />
        <StatCard label="Outstanding" value={outstanding.data ? formatMwkCompact(outstanding.data.total) : formatMwkCompact(0)} valueTitle={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)} subtext={outstanding.data ? `${outstanding.data.count} invoices` : undefined} tone="info" icon={FileText} isLoading={outstanding.isLoading} onClick={() => navigate('/invoices')} />
        <StatCard label="VAT" value={formatMwkCompact(Math.abs(netVat))} valueTitle={formatMwk(Math.abs(netVat))} subtext={netVat >= 0 ? 'Payable to MRA' : 'Refundable'} tone="warning" icon={Percent} isLoading={expenseVat.isLoading || income.isLoading} onClick={() => navigate('/tax')} />
      </div>

      {/* Personal quick actions */}
      <section className="px-1" aria-labelledby="quick-actions-title">
        <div className="mb-3 flex items-center justify-between">
          <p id="quick-actions-title" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Quick actions</p>
          <button type="button" onClick={() => setShowActionEditor((open) => !open)} className="text-[10px] font-black uppercase tracking-widest text-brand-700">{showActionEditor ? 'Done' : 'Customize'}</button>
        </div>
        {showActionEditor && (
          <div className="mb-3 rounded-2xl bg-brand-50 p-3">
            <p className="mb-2 text-xs font-medium text-brand-900">Choose up to four. Remove an action and add it again to move it to the end.</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(mobileActions) as MobileActionId[]).map((id) => {
                const selected = quickActionIds.includes(id);
                return <button key={id} type="button" onClick={() => setQuickActionIds((ids) => selected ? ids.filter((item) => item !== id) : ids.length < 4 ? [...ids, id] : ids)} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold', selected ? 'bg-brand-700 text-white' : 'bg-white text-gray-700')} aria-pressed={selected}>{mobileActions[id].label}</button>;
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-4 gap-2">
          {quickActionIds.map((id) => <QuickActionButton key={id} {...mobileActions[id]} onClick={mobileActions[id].run} />)}
        </div>
      </section>

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

      {/* All desktop workspaces stay reachable on mobile without crowding the home screen. */}
      <section className="px-1" aria-labelledby="mobile-workspaces">
        <div className="mb-3">
          <p id="mobile-workspaces" className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">All workspaces</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">Open any Ledgr tool when you need it.</p>
            <button type="button" onClick={() => setPinnedPaths((paths) => paths.length ? [] : workspaceSections.flatMap((section) => section.items).slice(0, 4).map((item) => item.path))} className="shrink-0 text-[10px] font-black uppercase tracking-widest text-brand-700">{pinnedPaths.length ? 'Clear pins' : 'Pin essentials'}</button>
          </div>
        </div>
        {pinnedPaths.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {workspaceSections.flatMap((section) => section.items).filter((item) => pinnedPaths.includes(item.path)).map((item) => {
              const Icon = item.icon;
              return <button key={item.path} type="button" onClick={() => navigate(item.path)} className="flex min-h-[56px] items-center gap-2 rounded-xl bg-brand-50 px-3 text-left text-xs font-bold text-brand-900"><Icon className="h-4 w-4" />{t(item.labelKey)}</button>;
            })}
          </div>
        )}
        <div className="space-y-2">
          {workspaceSections.map((section) => (
            <details key={section.labelKey} className="group overflow-hidden rounded-2xl border border-white bg-white/75 shadow-sm backdrop-blur-sm">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 touch-manipulation">
                <span className="text-xs font-black uppercase tracking-widest text-gray-800">{t(section.labelKey)}</span>
                <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid grid-cols-2 gap-2 border-t border-gray-100 p-2">
                {section.items.map((item) => {
                  const locked = isItemLocked(item, planTier, section.minPlan);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => navigate(locked ? '/settings?tab=billing' : item.path)}
                      className={clsx(
                        'flex min-h-[76px] items-center gap-2 rounded-xl p-3 text-left transition-colors active:scale-[0.98]',
                        locked ? 'bg-gray-50 text-gray-500' : 'bg-white hover:bg-brand-50 active:bg-brand-50',
                      )}
                    >
                      <div className="relative">
                        <IconBadge icon={Icon} tone="brand" size="sm" interactive={!locked} />
                        {locked && <Lock className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white p-0.5 text-gray-500" aria-label="Upgrade required" />}
                      </div>
                      <span className="line-clamp-2 text-xs font-bold leading-tight">{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      {businessId && (
        <>
          <QuickExpenseMobile businessId={businessId} open={showExpense} onClose={() => setShowExpense(false)} />
          <QuickIncomeMobile businessId={businessId} open={showIncome} onClose={() => setShowIncome(false)} />
        </>
      )}
    </div>
  );
}
