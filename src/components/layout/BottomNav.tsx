import { NavLink } from 'react-router-dom';
import { LayoutDashboard, DollarSign, Package, BarChart2, MoreHorizontal, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { QuickExpenseMobile } from '@/components/mobile/QuickExpenseMobile';
import { QuickIncomeMobile } from '@/components/mobile/QuickIncomeMobile';

const BOTTOM_NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Finance', path: '/income', icon: DollarSign },
  { label: 'Inventory', path: '/products', icon: Package },
  { label: 'Reports', path: '/reports', icon: BarChart2 },
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

      {/* More menu */}
      {moreOpen && (
        <div className="fixed bottom-20 left-4 right-4 z-50 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl lg:hidden">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">More</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Expenses', path: '/expenses' },
              { label: 'Invoices', path: '/invoices' },
              { label: 'Payroll', path: '/payroll' },
              { label: 'Accounts', path: '/accounts' },
              { label: 'Tax', path: '/tax' },
              { label: 'Assets', path: '/assets' },
              { label: 'Contacts', path: '/contacts' },
              { label: 'AI', path: '/ai' },
              { label: 'Settings', path: '/settings' },
            ].map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'rounded-xl px-3 py-2.5 text-center text-sm font-medium transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100',
                  )
                }
              >
                {item.label}
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
              className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-lg border border-gray-100"
            >
              <span className="text-lg">💵</span>
              <span className="text-sm font-semibold text-gray-900">Record Income</span>
            </button>
            <button
              onClick={() => { setFabOpen(false); setShowExpense(true); }}
              className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-lg border border-gray-100"
            >
              <span className="text-lg">🧾</span>
              <span className="text-sm font-semibold text-gray-900">Record Expense</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-between border-t border-gray-200 bg-white px-1 lg:hidden">
        {/* First 2 nav items */}
        {BOTTOM_NAV_ITEMS.slice(0, 2).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors',
                  isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('h-5 w-5', isActive && 'text-brand-600')} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}

        {/* FAB center button */}
        <button
          onClick={() => setFabOpen((v) => !v)}
          className={clsx(
            'flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all active:scale-95',
            fabOpen ? 'bg-gray-800 rotate-45' : 'bg-brand-500',
          )}
        >
          <Plus className="h-6 w-6 text-white" />
        </button>

        {/* Last 2 nav items */}
        {BOTTOM_NAV_ITEMS.slice(2).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors',
                  isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('h-5 w-5', isActive && 'text-brand-600')} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}

        {/* More button */}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={clsx(
            'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors',
            moreOpen ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <MoreHorizontal className={clsx('h-5 w-5', moreOpen && 'text-brand-600')} />
          <span>More</span>
        </button>
      </nav>

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