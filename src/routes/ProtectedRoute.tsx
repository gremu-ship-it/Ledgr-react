import { Navigate, Outlet, useLocation } from 'react-router';
import { useAppStore } from '@/store/useAppStore';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import { NoBusinessAccess } from '@/routes/NoBusinessAccess';

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

  // Authenticated but with no business the app can see. Rather than silently
  // bouncing to /create-business — which reads as a broken login to a user an
  // admin provisioned — explain the state and offer both the "create one" and
  // "ask your admin" paths. See NoBusinessAccess for the full rationale.
  if (
    businesses.length === 0 &&
    location.pathname !== '/create-business'
  ) {
    return <NoBusinessAccess />;
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
