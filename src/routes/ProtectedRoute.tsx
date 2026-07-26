import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';

export function ProtectedRoute() {
  const currentUser        = useAppStore((s) => s.currentUser);
  const isAuthLoading      = useAppStore((s) => s.isAuthLoading);
  const businesses         = useAppStore((s) => s.businesses);
  const isBusinessesLoading = useAppStore((s) => s.isBusinessesLoading);
  const location           = useLocation();

  // Wait for both auth and businesses to finish loading
  if (isAuthLoading || isBusinessesLoading) {
    return <LoadingSpinner fullScreen label="Checking your session…" />;
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Only redirect to /create-business when auth AND businesses have both
  // finished loading and businesses is definitively empty
  if (
    businesses.length === 0 &&
    location.pathname !== '/create-business'
  ) {
    return <Navigate to="/create-business" replace />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const currentUser   = useAppStore((s) => s.currentUser);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);

  if (isAuthLoading) {
    return <LoadingSpinner fullScreen label="Loading…" />;
  }

  if (currentUser) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

/**
 * Gates internal admin-only tools (e.g. /admin/billing) behind
 * user_profiles.is_platform_admin. This is a UX convenience only — the
 * real enforcement is server-side (RLS policies + the
 * grant-manual-subscription Edge Function re-checking the same flag), so
 * there's no security risk even if this check were somehow bypassed.
 */
export function PlatformAdminRoute() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);
  const isPlatformAdmin = useIsPlatformAdmin();

  if (isAuthLoading) {
    return <LoadingSpinner fullScreen label="Loading…" />;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (!isPlatformAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
