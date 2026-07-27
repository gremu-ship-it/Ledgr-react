import { NavLink } from 'react-router-dom';
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
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { IconBadge, type IconTone } from '@/components/ui/IconBadge';
import { QuickExpenseMobile } from '@/components/mobile/QuickExpenseMobile';
import { QuickIncomeMobile } from '@/components/mobile/QuickIncomeMobile';
import { useUsage } from '@/hooks/useUsage';
import { GATED_PATHS, planMeetsMin } from '@/components/layout/navConfig';
import { pushUpgradeRequired } from '@/lib/notifications';

const BOTTOM_NAV_ITEMS = [
  { labelKey: 'navigation.items.dashboard', path: '/dashboard', icon: LayoutDashboard },
  { labelKey: 'navigation.sections.finance', path: '/income', icon: DollarSign },
  { labelKey: 'navigation.sections.inventory', path: '/products', icon: Package },
  { labelKey: 'navigation.items.reports', path: '/reports', icon: BarChart2 },
];

const ALL_MORE_MENU_ITEMS: { labelKey: string; path: string; icon: LucideIcon; tone: IconTone }[] = [
  { labelKey: 'navigation.items.expenses', path: '/expenses', icon: Receipt, tone: 'negative' },
  { labelKey: 'navigation.items.invoices', path: '/invoices', icon: FileText, tone: 'info' },
  { labelKey: 'navigation.items.payroll', path: '/payroll', icon: Users, tone: 'neutral' },
  { labelKey: 'navigation.items.accounts', path: '/accounts', icon: BookOpen, tone: 'brand' },
  { labelKey: 'navigation.items.tax', path: '/tax', icon: Percent, tone: 'warning' },
  { labelKey: 'navigation.items.assets', path: '/assets', icon: Landmark, tone: 'info' },
  { labelKey: 'navigation.items.contacts', path: '/contacts', icon: BookUser, tone: 'neutral' },
  { labelKey: 'navigation.sections.ai', path: '/ai', icon: Sparkles, tone: 'brand' },
  { labelKey: 'navigation.items.settings', path: '/settings', icon: Settings, tone: 'neutral' },
];

export function BottomNav() {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const { planTier } = useUsage();

  // Always show all nav items. Free users see Accounting/Organisation items but get upgrade prompt on click.
  const bottomItems = BOTTOM_NAV_ITEMS;
  const moreItems = ALL_MORE_MENU_ITEMS;

  return (
    <>
      {/* Backdrop for "More" menu */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More menu — icon tiles, matching app-wide badge treatment */}
      {moreOpen && (
        <div className="fixed bottom-20 left-4 right-4 z-50 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl lg:hidden">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('common.more')}</p>
          <div className="grid grid-cols-3 gap-2">
            {moreItems.map((item) => {
              // Reconstruct enough for isItemLocked (minPlan / requiresCapability not present on these items)
              const locked = GATED_PATHS.has(item.path) ? !planMeetsMin(planTier, 'growth') : false;
              // Note: GATED_PATHS is still exported from navConfig for compatibility with other code
              const handleMoreClick = (e: React.MouseEvent) => {
                if (locked) {
                  e.preventDefault();
                  pushUpgradeRequired(t(item.labelKey), 'Growth', businessId);
                  setMoreOpen(false);
                  return;
                }
                setMoreOpen(false);
              };

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={handleMoreClick}
                  className="group flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition-colors active:bg-gray-50"
                >
                  <div className="relative">
                    <IconBadge icon={item.icon} tone={item.tone} size="sm" interactive />
                    {locked && (
                      <Lock className="absolute -right-0.5 -top-0.5 h-3 w-3 text-gray-400" />
                    )}
                  </div>
                  <span className="text-xs font-medium text-gray-600">{t(item.labelKey)}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      )}

      {/* FAB backdrop */}
      {fabOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setFabOpen(false)}
        />
      )}

      {/* FAB action menu */}
      {fabOpen && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 lg:hidden">
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => { setFabOpen(false); setShowIncome(true); }}
              className="group flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-lg border border-gray-100"
            >
              <IconBadge icon={Wallet} tone="brand" size="sm" interactive />
              <span className="text-sm font-semibold text-gray-900">{t('common.recordIncome')}</span>
            </button>
            <button
              onClick={() => { setFabOpen(false); setShowExpense(true); }}
              className="group flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-lg border border-gray-100"
            >
              <IconBadge icon={Receipt} tone="negative" size="sm" interactive />
              <span className="text-sm font-semibold text-gray-900">{t('common.recordExpense')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <div className="fixed bottom-6 left-6 right-6 z-30 lg:hidden">
        <nav className="flex h-16 items-center justify-around rounded-3xl border border-white/20 bg-white/80 px-2 shadow-2xl backdrop-blur-xl ring-1 ring-black/5">
          {/* First 2 nav items */}
          {bottomItems.slice(0, 2).map((item) => (
            <NavTab key={item.path} {...item} />
          ))}

          {/* FAB center button */}
          <button
            onClick={() => setFabOpen((v) => !v)}
            className={clsx(
              'flex h-14 w-14 -translate-y-4 items-center justify-center rounded-2xl shadow-xl transition-all active:scale-90',
              fabOpen 
                ? 'bg-gray-900 rotate-45' 
                : 'bg-gradient-to-br from-brand-400 to-brand-600 ring-4 ring-white shadow-brand-500/30',
            )}
          >
            <Plus className="h-7 w-7 text-white" />
          </button>

          {/* Last 2 nav items */}
          {bottomItems.slice(2).map((item) => (
            <NavTab key={item.path} {...item} />
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="group flex flex-col items-center gap-1 rounded-xl px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors"
          >
            {moreOpen ? (
              <IconBadge icon={MoreHorizontal} tone="brand" size="sm" interactive />
            ) : (
              <div className="flex flex-col items-center">
                <MoreHorizontal className="h-5 w-5 text-gray-400 transition-colors group-active:text-brand-500" />
                <span className="text-gray-400 group-active:text-brand-500">{t('common.more')}</span>
              </div>
            )}
          </button>
        </nav>
      </div>

      {/* Mobile quick entry sheets */}
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
    <NavLink to={path} className="group flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
      {({ isActive }) =>
        isActive ? (
          <>
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-brand-500/20 blur-sm" />
              <Icon className="relative h-5 w-5 text-brand-600" />
            </div>
            <span className="text-brand-600">{t(labelKey)}</span>
          </>
        ) : (
          <>
            <Icon className="h-5 w-5 text-gray-400 transition-colors group-active:text-brand-500" />
            <span className="text-gray-400 group-active:text-brand-500">{t(labelKey)}</span>
          </>
        )
      }
    </NavLink>
  );
}