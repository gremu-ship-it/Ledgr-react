import { NavLink } from 'react-router-dom';
import { LayoutDashboard, DollarSign, Package, BarChart2, MoreHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import { useState } from 'react';

const BOTTOM_NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Finance', path: '/income', icon: DollarSign },
  { label: 'Inventory', path: '/products', icon: Package },
  { label: 'Reports', path: '/reports', icon: BarChart2 },
];

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);

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
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            More
          </p>
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
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-gray-200 bg-white px-2 lg:hidden">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center gap-1 rounded-xl px-4 py-2 text-xs font-medium transition-colors',
                  isActive
                    ? 'text-brand-600'
                    : 'text-gray-500 hover:text-gray-700',
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
            'flex flex-col items-center gap-1 rounded-xl px-4 py-2 text-xs font-medium transition-colors',
            moreOpen ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700',
          )}
        >
          <MoreHorizontal className={clsx('h-5 w-5', moreOpen && 'text-brand-600')} />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}