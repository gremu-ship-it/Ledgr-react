import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';

/**
 * Gates the partner admin portal. UX-level only — the real enforcement is
 * the RLS on partners / partner_clients / partner_invoices, which scopes
 * every query to the partners the caller actually administers.
 */
export function PartnerAdminRoute() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);
  const { canAccessPortal, loading } = usePartnerAdminAccess();
  const location = useLocation();

  if (isAuthLoading || loading) {
    return <LoadingSpinner fullScreen label="Loading…" />;
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!canAccessPortal) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
