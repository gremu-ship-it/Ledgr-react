import { NavLink, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  DollarSign,
  Package,
  BarChart2,
  MoreHorizontal,
  Plus,
  Wallet,
  Receipt,
  FileText,
  Users,
  BookOpen,
  Percent,
  Landmark,
  BookUser,
  Sparkles,
  Settings,
  Lock,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { IconBadge, type IconTone } from '@/components/ui/IconBadge';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { QuickExpenseMobile } from '@/components/mobile/QuickExpenseMobile';
import { QuickIncomeMobile } from '@/components/mobile/QuickIncomeMobile';
import { useUsage } from '@/hooks/useUsage';
import { GATED_PATHS, planMeetsMin } from '@/components/layout/navConfig';
import { usePartner } from '@/partner/PartnerContext';
import type { PartnerFeatureKey } from '@/types/partners';
import { pushUpgradeRequired } from '@/lib/notifications';

const BOTTOM_NAV_ITEMS = [
  { labelKey: 'navigation.items.dashboard', path: '/dashboard', icon: LayoutDashboard },
  { labelKey: 'navigation.sections.finance', path: '/income', icon: DollarSign },
  { labelKey: 'navigation.sections.inventory', path: '/products', icon: Package },
  { labelKey: 'navigation.items.reports', path: '/reports', icon: BarChart2 },
];

const ALL_MORE_MENU_ITEMS: {
  labelKey: string;
  path: string;
  icon: LucideIcon;
  tone: IconTone;
  partnerFeature?: PartnerFeatureKey;
}[] = [
  { labelKey: 'navigation.items.expenses', path: '/expenses', icon: Receipt, tone: 'negative' },
  { labelKey: 'navigation.items.invoices', path: '/invoices', icon: FileText, tone: 'info' },
  { labelKey: 'navigation.items.payroll', path: '/payroll', icon: Users, tone: 'neutral', partnerFeature: 'payroll' },
  { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen, tone: 'brand' },
  { labelKey: 'navigation.items.tax', path: '/tax', icon: Percent, tone: 'warning' },
  { labelKey: 'navigation.items.assets', path: '/assets', icon: Landmark, tone: 'info' },
  { labelKey: 'navigation.items.contacts', path: '/contacts', icon: BookUser, tone: 'neutral' },
  { labelKey: 'navigation.sections.ai', path: '/ai', icon: Sparkles, tone: 'brand', partnerFeature: 'ai_advisor' },
  { labelKey: 'navigation.items.settings', path: '/settings', icon: Settings, tone: 'neutral' },
  { labelKey: 'navigation.items.tools', path: '/tools', icon: BarChart2, tone: 'brand' },
];

function vibrate(ms = 10) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

export function BottomNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const { planTier } = useUsage();

  const { isFeatureEnabled } = usePartner();
  const bottomItems = BOTTOM_NAV_ITEMS.filter(
    (i) => i.path !== '/products' || isFeatureEnabled('inventory'),
  );
  const moreItems = ALL_MORE_MENU_ITEMS.filter(
    (i) => !i.partnerFeature || isFeatureEnabled(i.partnerFeature),
  );

  // Dynamic balanced split for FAB centering
  const { leftItems, rightItems } = useMemo(() => {
    const mid = Math.ceil(bottomItems.length / 2);
    return {
      leftItems: bottomItems.slice(0, mid),
      rightItems: bottomItems.slice(mid),
    };
  }, [bottomItems]);

  // Single backdrop closes both menus, and Escape closes too
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        setFabOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isAnySheetOpen = moreOpen || fabOpen;

  return (
    <>
      {/* Unified backdrop */}
      {isAnySheetOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] lg:hidden"
          onClick={() => {
            setMoreOpen(false);
            setFabOpen(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* More menu */}
      {moreOpen && (
        <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl lg:hidden">
          <p className="mb-3 text-xs font-semibold text-gray-700">{t('common.more')}</p>
          <div className="mb-2 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <span className="text-sm font-medium text-gray-700">{t('common.theme', 'Theme')}</span>
            <ThemeToggle />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {moreItems.map((item) => {
              const locked = GATED_PATHS.has(item.path) ? !planMeetsMin(planTier, 'growth') : false;
              const handleMoreClick = (e: React.MouseEvent) => {
                if (locked) {
                  e.preventDefault();
                  pushUpgradeRequired(t(item.labelKey), 'Growth', businessId);
                  setMoreOpen(false);
                  return;
                }
                vibrate(10);
                setMoreOpen(false);
              };

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={handleMoreClick}
                  className={({ isActive }) =>
                    clsx(
                      'group flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-center transition-colors active:bg-gray-50',
                      isActive && 'bg-brand-50 ring-1 ring-brand-100'
                    )
                  }
                >
                  <div className="relative">
                    <IconBadge icon={item.icon} tone={item.tone} size="sm" interactive />
                    {locked && <Lock className="absolute -right-0.5 -top-0.5 h-3 w-3 text-gray-400" />}
                  </div>
                  <span className="text-xs font-medium leading-tight text-gray-700">{t(item.labelKey)}</span>
                </NavLink>
              );
            })}
          </div>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate('/login', { replace: true });
              setMoreOpen(false);
            }}
            className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-red-700 transition-colors hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t('auth.signOut')}
          </button>
        </div>
      )}

      {/* FAB action menu */}
      {fabOpen && (
        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 lg:hidden">
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => {
                vibrate(10);
                setFabOpen(false);
                navigate('/income?action=invoice');
              }}
              className="group flex min-h-[48px] items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-3 shadow-lg active:scale-95"
            >
              <IconBadge icon={FileText} tone="info" size="sm" interactive />
              <span className="text-sm font-semibold text-gray-900">New invoice</span>
            </button>
            <button
              onClick={() => {
                vibrate(10);
                setFabOpen(false);
                navigate('/warehouse');
              }}
              className="group flex min-h-[48px] items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-3 shadow-lg active:scale-95"
            >
              <IconBadge icon={Package} tone="brand" size="sm" interactive />
              <span className="text-sm font-semibold text-gray-900">Stock movement</span>
            </button>
            <button
              onClick={() => {
                vibrate(10);
                setFabOpen(false);
                setShowIncome(true);
              }}
              className="group flex min-h-[48px] items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-3 shadow-lg active:scale-95"
            >
              <IconBadge icon={Wallet} tone="brand" size="sm" interactive />
              <span className="text-sm font-semibold text-gray-900">{t('common.recordIncome')}</span>
            </button>
            <button
              onClick={() => {
                vibrate(10);
                setFabOpen(false);
                setShowExpense(true);
              }}
              className="group flex min-h-[48px] items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-3 shadow-lg active:scale-95"
            >
              <IconBadge icon={Receipt} tone="negative" size="sm" interactive />
              <span className="text-sm font-semibold text-gray-900">{t('common.recordExpense')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav bar — safe-area aware */}
      <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-4 right-4 z-30 lg:hidden">
        <nav className="flex h-[64px] items-center justify-around rounded-[1.75rem] border border-white/30 bg-white/90 px-2 shadow-2xl backdrop-blur-xl ring-1 ring-black/5">
          {leftItems.map((item) => (
            <NavTab key={item.path} {...item} />
          ))}

          {/* FAB center button */}
          <button
            type="button"
            onClick={() => {
              vibrate(10);
              setFabOpen((v) => !v);
              if (moreOpen) setMoreOpen(false);
            }}
            aria-expanded={fabOpen}
            aria-label={fabOpen ? t('common.closeAddMenu') : t('common.openAddMenu')}
            className={clsx(
              'flex h-14 w-14 shrink-0 -translate-y-4 items-center justify-center rounded-2xl shadow-xl transition-all active:scale-90 touch-manipulation',
              fabOpen
                ? 'bg-gray-900 rotate-45'
                : 'bg-gradient-to-br from-brand-600 to-brand-700 ring-4 ring-white shadow-brand-500/30',
            )}
          >
            <Plus className="h-7 w-7 text-white" aria-hidden="true" />
          </button>

          {rightItems.map((item) => (
            <NavTab key={item.path} {...item} />
          ))}

          {/* More button */}
          <button
            type="button"
            onClick={() => {
              vibrate(10);
              setMoreOpen((v) => !v);
              if (fabOpen) setFabOpen(false);
            }}
            aria-expanded={moreOpen}
            aria-label={t('common.more')}
            className="group flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-[10px] font-bold transition-colors touch-manipulation"
          >
            {moreOpen ? (
              <IconBadge icon={MoreHorizontal} tone="brand" size="sm" interactive />
            ) : (
              <div className="flex flex-col items-center">
                <MoreHorizontal className="h-5 w-5 text-gray-700 transition-colors group-active:text-brand-600" aria-hidden="true" />
                <span className="text-gray-700 group-active:text-brand-600" aria-hidden="true">{t('common.more')}</span>
              </div>
            )}
          </button>
        </nav>
      </div>

      {businessId && (
        <>
          <QuickExpenseMobile businessId={businessId} open={showExpense} onClose={() => setShowExpense(false)} />
          <QuickIncomeMobile businessId={businessId} open={showIncome} onClose={() => setShowIncome(false)} />
        </>
      )}
    </>
  );
}

function NavTab({
  labelKey,
  icon: Icon,
  path,
}: {
  labelKey: string;
  path: string;
  icon: LucideIcon;
}) {
  const { t } = useTranslation();

  return (
    <NavLink
      to={path}
      aria-label={t(labelKey)}
      onClick={() => {
        try {
          if ('vibrate' in navigator) navigator.vibrate(5);
        } catch {
          // Haptic feedback is optional.
        }
      }}
      className="group flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-1 px-2 py-1 text-[10px] font-bold transition-colors touch-manipulation"
    >
      {({ isActive }) =>
        isActive ? (
          <>
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-brand-500/20 blur-sm" />
              <Icon className="relative h-5 w-5 text-brand-700" aria-hidden="true" />
            </div>
            <span className="text-brand-700" aria-hidden="true">{t(labelKey)}</span>
          </>
        ) : (
          <>
            <Icon className="h-5 w-5 text-gray-600 transition-colors group-active:text-brand-600" aria-hidden="true" />
            <span className="text-gray-700 group-active:text-brand-600" aria-hidden="true">{t(labelKey)}</span>
          </>
        )
      }
    </NavLink>
  );
}
