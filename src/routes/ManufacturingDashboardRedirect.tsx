import { Navigate } from 'react-router';

/** Keeps old dashboard bookmarks working while using the canonical route. */
export function ManufacturingDashboardRedirect() {
  return <Navigate to="/manufacturing" replace />;
}
