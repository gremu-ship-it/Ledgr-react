import { useEffect, useRef } from 'react';
import { useInfiniteQuery, type InfiniteData, type QueryFunctionContext } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

/**
 * Shape of one page returned by a repository listPage method.
 */
export interface KeysetPage<TRow> {
  rows: TRow[];
  nextCursor: { date: string; id: string } | null;
}

type Cursor = { date: string; id: string } | null;

interface InfiniteListOptions<TRow, TStatus extends string | undefined = string | undefined> {
  queryKey: unknown[];
  businessId: string | undefined;
  status?: TStatus;
  pageSize?: number;
  fetcher: (
    businessId: string,
    opts: { status?: TStatus; cursor?: Cursor; pageSize?: number },
  ) => Promise<KeysetPage<TRow>>;
  enabled?: boolean;
  staleTime?: number;
}

/**
 * Reusable hook for keyset-paginated infinite lists.
 *
 * Attaches an IntersectionObserver to a sentinel <div> (via sentinelRef)
 * placed below the rendered list; when that element scrolls within 300px
 * of the viewport the next page is fetched automatically.
 *
 * Why keyset (cursor) and not OFFSET/LIMIT pagination: see
 * ExpenseRepository.listPage doc-comment — keyset scans stay O(pageSize)
 * regardless of how deep the user scrolls, while offset scans have to
 * skip every prior row and degrade quadratically on large tables.
 */
export function useInfiniteKeysetList<TRow, TStatus extends string | undefined = string | undefined>(
  opts: InfiniteListOptions<TRow, TStatus>,
) {
  const pageSize = opts.pageSize ?? 50;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery<KeysetPage<TRow>, Error, InfiniteData<KeysetPage<TRow>>>({
    queryKey: [...opts.queryKey, opts.businessId, opts.status, pageSize],
    enabled: Boolean(opts.businessId) && (opts.enabled ?? true),
    staleTime: opts.staleTime ?? 60_000,
    initialPageParam: null as Cursor,
    queryFn: (ctx: QueryFunctionContext) => {
      const cursor = ctx.pageParam as Cursor | undefined;
      return opts.fetcher(opts.businessId!, {
        status: opts.status,
        cursor: cursor ?? null,
        pageSize,
      } as { status?: TStatus; cursor?: Cursor; pageSize?: number });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: false,
  });

  const rows = query.data ? query.data.pages.flatMap((p) => p.rows) : [];
  const { hasNextPage, isFetchingNextPage, isLoading, dataUpdatedAt, fetchNextPage } = query;

  // Wire the sentinel to IntersectionObserver and fetch the next page when it
  // scrolls into view. The observer callback is the only trigger: this used to
  // route through an `isAtBottom` state flag, a second effect that reacted to
  // it, and a third that cleared it once the fetch settled — two extra renders
  // per page, and two synchronous setState calls in effect bodies.
  //
  // dataUpdatedAt stays in the deps so the observer is torn down and rebuilt
  // after each page lands: IntersectionObserver only fires on a *change* in
  // intersection, so a sentinel that remains in view would otherwise never
  // ask for the page after next.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!hasNextPage || isFetchingNextPage || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) void fetchNextPage();
      },
      { rootMargin: '300px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isLoading, dataUpdatedAt, fetchNextPage]);

  return {
    rows,
    sentinelRef,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    isError: query.isError,
    error: query.error,
    refresh: () => query.refetch(),
    reset: () => queryClient.resetQueries({ queryKey: opts.queryKey }),
  };
}
