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
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { IconBadge, type IconTone } from '@/components/ui/IconBadge';
import { QuickExpenseMobile } from '@/components/mobile/QuickExpenseMobile';
import { QuickIncomeMobile } from '@/components/mobile/QuickIncomeMobile';

const BOTTOM_NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Finance', path: '/income', icon: DollarSign },
  { label: 'Inventory', path: '/products', icon: Package },
  { label: 'Reports', path: '/reports', icon: BarChart2 },
];

const MORE_MENU_ITEMS: { label: string; path: string; icon: LucideIcon; tone: IconTone }[] = [
  { label: 'Expenses', path: '/expenses', icon: Receipt, tone: 'negative' },
  { label: 'Invoices', path: '/invoices', icon: FileText, tone: 'info' },
  { label: 'Payroll', path: '/payroll', icon: Users, tone: 'neutral' },
  { label: 'Accounts', path: '/accounts', icon: BookOpen, tone: 'brand' },
  { label: 'Tax', path: '/tax', icon: Percent, tone: 'warning' },
  { label: 'Assets', path: '/assets', icon: Landmark, tone: 'info' },
  { label: 'Contacts', path: '/contacts', icon: BookUser, tone: 'neutral' },
  { label: 'AI', path: '/ai', icon: Sparkles, tone: 'brand' },
  { label: 'Settings', path: '/settings', icon: Settings, tone: 'neutral' },
];

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

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
        <div className="fixed bottom-20 left-4 right-4 z-50 rounded-2xl border border-line bg-card p-4 shadow-card dark:shadow-card-dark lg:hidden">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">More</p>
          <div className="grid grid-cols-3 gap-2">
            {MORE_MENU_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMoreOpen(false)}
                className="group flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition-colors hover:bg-brand-500/8 active:bg-brand-500/8"
              >
                <IconBadge icon={item.icon} tone={item.tone} size="sm" interactive />
                <span className="text-xs font-medium text-sub">{item.label}</span>
              </NavLink>
            ))}
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
              className="group flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-lg border border-line transition-colors hover:bg-brand-500/8"
            >
              <IconBadge icon={Wallet} tone="brand" size="sm" interactive />
              <span className="text-sm font-semibold text-ink">Record Income</span>
            </button>
            <button
              onClick={() => { setFabOpen(false); setShowExpense(true); }}
              className="group flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-lg border border-line transition-colors hover:bg-brand-500/8"
            >
              <IconBadge icon={Receipt} tone="negative" size="sm" interactive />
              <span className="text-sm font-semibold text-ink">Record Expense</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <div className="fixed bottom-6 left-6 right-6 z-30 lg:hidden">
        <nav className="flex h-16 items-center justify-around rounded-3xl border border-white/20 bg-card/90 px-2 shadow-2xl backdrop-blur-xl ring-1 ring-black/5">
          {/* First 2 nav items */}
          {BOTTOM_NAV_ITEMS.slice(0, 2).map((item) => (
            <NavTab key={item.path} {...item} />
          ))}

          {/* FAB center button */}
          <button
            onClick={() => setFabOpen((v) => !v)}
            className={clsx(
              'flex h-14 w-14 -translate-y-4 items-center justify-center rounded-2xl shadow-xl transition-all active:scale-90',
              fabOpen 
                ? 'bg-ink rotate-45' 
                : 'bg-brand-600 ring-4 ring-card shadow-brand-500/30',
            )}
          >
            <Plus className="h-7 w-7 text-white" />
          </button>

          {/* Last 2 nav items */}
          {BOTTOM_NAV_ITEMS.slice(2).map((item) => (
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
                <span className="text-gray-400 group-active:text-brand-500">More</span>
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
  label,
  icon: Icon,
  path,
}: {
  label: string;
  path: string;
  icon: LucideIcon;
}) {
  return (
    <NavLink to={path} className="group flex flex-col items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
      {({ isActive }) =>
        isActive ? (
          <>
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-brand-500/20 blur-sm" />
              <Icon className="relative h-5 w-5 text-brand-600" />
            </div>
            <span className="text-brand-600 dark:text-brand-400">{label}</span>
          </>
        ) : (
          <>
            <Icon className="h-5 w-5 text-muted transition-colors group-active:text-brand-500" />
            <span className="text-muted group-active:text-brand-500">{label}</span>
          </>
        )
      }
    </NavLink>
  );
}