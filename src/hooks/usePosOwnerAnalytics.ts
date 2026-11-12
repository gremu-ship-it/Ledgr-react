import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';

export type PosAnalyticsRange = 'today' | '7d' | '30d' | 'all_time';

export interface PosAnalyticsWindow {
  from: string | null;
  to: string | null;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Creates a half-open local-calendar window and serializes it for the server. */
export function getPosAnalyticsWindow(
  range: PosAnalyticsRange,
  anchor: Date = new Date(),
): PosAnalyticsWindow {
  if (range === 'all_time') return { from: null, to: null };

  const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
  const today = startOfLocalDay(anchor);
  const from = new Date(today);
  from.setDate(from.getDate() - days + 1);
  const to = new Date(today);
  to.setDate(to.getDate() + 1);

  return { from: from.toISOString(), to: to.toISOString() };
}

export function usePosOwnerAnalytics(
  businessId: string | undefined,
  branchId: string | null,
  range: PosAnalyticsRange,
) {
  const window = getPosAnalyticsWindow(range);
  return useQuery({
    queryKey: ['pos', 'owner-analytics', businessId, branchId, range, window.from, window.to],
    queryFn: () => repos.pos.getOwnerAnalytics(businessId!, branchId, window.from, window.to),
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });
}
