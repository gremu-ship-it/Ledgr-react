import { QueryClient } from '@tanstack/react-query';
import { createLogger } from '@/lib/logger';
import { pushError } from '@/lib/notifications';

const log = createLogger('QueryClient');

/**
 * React Query defaults tuned for a finance app on slow / high-RTT links
 * (Lilongwe → EU Supabase ≈ 250-600 ms round trips in practice).
 *
 *  - staleTime: 60s keeps things feeling snappy while still picking up new
 *    data within a minute (use invalidateAfterExpense/invalidateAfterIncome
 *    force-refresh after writes so the user never sees stale post-save).
 *  - gcTime: 5 minutes (down from React Query's default of 5 min — kept but
 *    explicitly stated) evicts inactive queries to stop memory growing
 *    unbounded as users navigate between tabs.
 *  - retry: 1 on queries (transient network blip retry), 0 on mutations
 *    (mutations have their own idempotent retry where it matters, e.g. the
 *    quick-save RPC path).
 *  - refetchOnWindowFocus: false — refocusing the tab (common when users
 *    switch between Ledgr and mobile-money apps) should not hammer the
 *    backend with parallel refetches for every mounted list.
 *  - refetchOnReconnect: true — but we rely on the offline sync queue for
 *    writes; reads just get one refetch when the link comes back.
 *  - networkMode: 'online' so queries don't queue up when offline and
 *    dump onto the network the instant we come back.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      networkMode: 'online',
    },
    mutations: {
      retry: 0,
      onError: (error, variables) => {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        log.error('Mutation failed (unhandled)', error as Error, {
          variables: JSON.stringify(variables).slice(0, 200),
        });
        pushError('Operation failed', message);
      },
    },
  },
});
