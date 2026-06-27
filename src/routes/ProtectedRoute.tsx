import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { LoadingSpinner } from '@/components/LoadingSpinner';

/**
 * Wraps protected routes. Renders a full-screen loading state while the
 * initial auth check is in flight, redirects to /login (preserving the
 * intended destination) if there's no authenticated user, redirects to
 * /create-business if the user has no businesses yet, and otherwise
 * renders the matched child route via <Outlet />.
 */
export function ProtectedRoute() {
  const currentUser  = useAppStore((s) => s.currentUser);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);
  const businesses   = useAppStore((s) => s.businesses);
  const location     = useLocation();

  if (isAuthLoading) {
    return <LoadingSpinner fullScreen label="Checking your session…" />;
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated but no business yet — send to onboarding.
  // Skip this check when already on /create-business to avoid an
  // infinite redirect loop while the page is being rendered.
  if (businesses.length === 0 && location.pathname !== '/create-business') {
    return <Navigate to="/create-business" replace />;
  }

  return <Outlet />;
}

/**
 * Wraps public-only routes (login, register). If the user is already
 * authenticated, redirects them straight to the dashboard instead of
 * showing the login form again.
 */
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
