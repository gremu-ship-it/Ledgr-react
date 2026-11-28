import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { resolveNavigationTarget } from '@/config/navigation';

interface WorkspaceTabRedirectProps {
  /** Context-facing workspace URL, e.g. `/payroll`. */
  basePath: string;
  /** Canonical screen used when no recognised `?tab=` is present. */
  fallback?: string;
  /** For live workspaces such as `/pos`: render these when no tab is set. */
  children?: ReactNode;
}

/**
 * Resolves context-facing `?tab=` deep links to the canonical screen that owns
 * that tab. The sidebar advertises paths like `/banking?tab=deposits` and
 * `/payroll?tab=leave`; without this bridge the legacy aliases would drop the
 * query and always land on the first tab, leaving the selected sub-item
 * unhighlighted.
 */
export function WorkspaceTabRedirect({
  basePath,
  fallback,
  children,
}: WorkspaceTabRedirectProps) {
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get('tab');

  if (tab) {
    const candidate = `${basePath}?tab=${encodeURIComponent(tab)}`;
    const target = resolveNavigationTarget(candidate);
    if (target !== candidate) return <Navigate to={target} replace />;
  }

  if (children) return <>{children}</>;
  return fallback ? <Navigate to={fallback} replace /> : null;
}
