import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Building2, CreditCard, LayoutGrid, LogOut, Settings, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';

/** Chrome for the partner admin portal (admin.ledgr.com). */
export function PartnerAdminLayout() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const { isPlatformAdmin } = usePartnerAdminAccess();

  const links = id
    ? [
        { to: `/partner-admin/partners/${id}`, label: 'Overview', icon: LayoutGrid, end: true },
        { to: `/partner-admin/partners/${id}/clients`, label: 'Clients', icon: Users },
        { to: `/partner-admin/partners/${id}/settings`, label: 'Branding & features', icon: Settings },
        { to: `/partner-admin/partners/${id}/billing`, label: 'Billing', icon: CreditCard },
      ]
    : [{ to: '/partner-admin', label: 'Partners', icon: Building2, end: true }];

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
          <NavLink to="/partner-admin" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              L
            </div>
            <span className="font-semibold text-slate-900">Ledgr Partner Admin</span>
          </NavLink>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {isPlatformAdmin ? 'Platform admin' : 'Partner admin'}
          </span>
          <div className="ms-auto flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden sm:inline">{currentUser?.email}</span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default PartnerAdminLayout;
