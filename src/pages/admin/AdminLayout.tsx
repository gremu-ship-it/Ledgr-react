import { NavLink, Outlet, useNavigate } from 'react-router';
import { ArrowLeft, Building2, DollarSign, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { getHomePathForRole } from '@/hooks/usePermissions';

/**
 * Chrome for the internal platform-admin tools (/admin/*).
 *
 * These pages deliberately render outside AppLayout — they are cross-tenant,
 * so showing the business sidebar/business switcher around them would be
 * misleading. But rendering them completely bare left users stranded: once you
 * opened Businesses or Billing there was no link, tab or button back to the
 * app, so the only way out was to close and reopen the app. This layout keeps
 * the tools separate while always offering an obvious way back.
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const backPath = getHomePathForRole(currentBusiness?.role || null);

  const links = [
    { to: '/admin/businesses', label: 'Businesses', icon: Building2 },
    { to: '/admin/billing', label: 'Billing', icon: DollarSign },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#admin-main" className="skip-link">
        Skip to main content
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Back to app</span>
            <span className="sr-only sm:hidden">Back to app</span>
          </button>

          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-900" aria-hidden="true" />
            <span className="font-semibold text-slate-900">Platform admin</span>
          </div>

          {currentUser?.email && (
            <span className="ms-auto hidden text-sm text-slate-500 sm:inline">
              {currentUser.email}
            </span>
          )}
        </div>

        <nav aria-label="Platform admin sections" className="mx-auto flex max-w-6xl gap-1 px-2 sm:px-4">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                  {isActive && <span className="sr-only"> (current page)</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="admin-main" tabIndex={-1} aria-label="Platform admin content" className="outline-none">
        <Outlet />
      </main>
    </div>
  );
}

export default AdminLayout;
