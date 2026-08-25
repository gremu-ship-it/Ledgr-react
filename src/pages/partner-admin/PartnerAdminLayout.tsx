import { NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Building2, CreditCard, LayoutGrid, LogOut, Settings, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { secureSignOut } from '@/lib/authSession';
import { useAppStore } from '@/store/useAppStore';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';
import { isAdminPortalHost } from '@/lib/partnerDomain';
import { getHomePathForRole } from '@/hooks/usePermissions';

/** Chrome for the partner admin portal (admin.ledgr.com). */
export function PartnerAdminLayout() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const { isPlatformAdmin } = usePartnerAdminAccess();

  // On admin.ledgr.com the portal *is* the app, so there is nowhere to go
  // back to. When the portal is opened from the main app (via the user menu)
  // the user must be able to return without closing the app.
  const showBackToApp = !isAdminPortalHost() && Boolean(currentBusiness);
  const backPath = getHomePathForRole(currentBusiness?.role || null);

  const links = id
    ? [
        { to: `/partner-admin/partners/${id}`, label: 'Overview', icon: LayoutGrid, end: true },
        { to: `/partner-admin/partners/${id}/clients`, label: 'Clients', icon: Users },
        { to: `/partner-admin/partners/${id}/settings`, label: 'Branding & features', icon: Settings },
        { to: `/partner-admin/partners/${id}/billing`, label: 'Billing', icon: CreditCard },
      ]
    : [{ to: '/partner-admin', label: 'Partners', icon: Building2, end: true }];

  async function signOut() {
    await secureSignOut('local');
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Skip link for partner admin portal */}
      <a href="#partner-admin-main" className="skip-link">
        Skip to main content
      </a>
      <div id="ledgr-live-region" aria-live="polite" aria-atomic="true" className="sr-only" />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
          <NavLink to="/partner-admin" className="flex items-center gap-2" aria-label="Ledgr Partner Admin home">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white" aria-hidden="true">
              L
            </div>
            <span className="font-semibold text-slate-900">Ledgr Partner Admin</span>
          </NavLink>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
            {isPlatformAdmin ? 'Platform admin' : 'Partner admin'}
          </span>
          <div className="ms-auto flex items-center gap-3 text-sm text-slate-700">
            <span className="hidden sm:inline">{currentUser?.email}</span>
            {showBackToApp && (
              <button
                type="button"
                onClick={() => navigate(backPath)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-100 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to app
              </button>
            )}
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
        <nav
          aria-label="Partner admin sections"
          className="mx-auto flex max-w-6xl gap-1 px-4"
        >
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-current={undefined}
              className={({ isActive }) =>
                clsx(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-700 hover:text-slate-900',
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

      <main id="partner-admin-main" tabIndex={-1} aria-label="Partner admin content" className="mx-auto max-w-6xl px-6 py-8 outline-none">
        <Outlet />
      </main>
    </div>
  );
}

export default PartnerAdminLayout;
