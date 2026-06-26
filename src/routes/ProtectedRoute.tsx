import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { LoadingSpinner } from '@/components/LoadingSpinner';

/**
 * Wraps protected routes. Renders a full-screen loading state while the
 * initial auth check is in flight, redirects to /login (preserving the
 * intended destination) if there's no authenticated user, and otherwise
 * renders the matched child route via <Outlet />.
 */
export function ProtectedRoute() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);
  const location = useLocation();

  if (isAuthLoading) {
    return <LoadingSpinner fullScreen label="Checking your session…" />;
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

/**
 * Wraps public-only routes (login, register). If the user is already
 * authenticated, redirects them straight to the dashboard instead of
 * showing the login form again.
 */
export function PublicOnlyRoute() {
  const currentUser = useAppStore((s) => s.currentUser);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);

  if (isAuthLoading) {
    return <LoadingSpinner fullScreen label="Loading…" />;
  }

  if (currentUser) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
