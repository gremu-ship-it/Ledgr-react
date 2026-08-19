/**
 * Phase 10.2e — fetch every row of a PostgREST query past the default
 * 1000-row cap.
 *
 * PostgREST (Supabase) silently truncates a response at `db-max-rows`
 * (default 1000) unless the client requests a `.range()`. Any report or
 * balance query over journal_lines/journal_entries can exceed that for a
 * busy business, and the truncated rows were silently dropped — the root
 * cause of the production incident where an IFRS holding company's
 * Non-Current Assets read 0.00 while the data was present (its fixed-asset
 * capitalisation lines sat beyond the first 1000 journal lines).
 *
 * Usage: build the query WITHOUT `.range()`/`.order()`, pass the builder
 * here, and receive the complete row set.
 *
 *   const rows = await fetchAllRows(
 *     supabase.from('journal_lines')
 *       .select('...')
 *       .eq('business_id', id)
 *       .in('journal_entries.status', ['posted', 'reversed']),
 *   );
 *
 * The helper orders by `id` for a stable cursor and pages in `pageSize`
 * windows until a short page is returned. A safety cap prevents an infinite
 * loop if a page ever returns a full window forever.
 */

interface PageableQuery {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
  order: (column: string, opts?: { ascending?: boolean }) => PageableQuery;
}

export async function fetchAllRows<T>(
  query: unknown,
  options: { pageSize?: number; orderBy?: string; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  const orderBy = options.orderBy ?? 'id';
  const maxRows = options.maxRows ?? 1_000_000;
  const q = query as PageableQuery;

  // Phase 10.2f — apply ORDER BY to the base query BEFORE the first fetch.
  // If page 1 were fetched unordered and pages 2+ ordered (by random UUIDs),
  // the windows would not partition the data: rows would be skipped and
  // others double-counted (production symptom: 1331/1343 capitalisation
  // lines missing from Non-Current Assets).
  const ordered = q.order(orderBy, { ascending: true });

  const first = await ordered.range(0, pageSize - 1);
  if (first.error) throw first.error;
  const rows = [...((first.data ?? []) as T[])];
  if (first.data === null || first.data.length < pageSize) return rows;

  let from = pageSize;
  let last = first.data.length;
  while (last >= pageSize && from < maxRows) {
    const page = await ordered.range(from, from + pageSize - 1);
    if (page.error) throw page.error;
    const data = (page.data ?? []) as T[];
    rows.push(...data);
    last = data.length;
    from += pageSize;
  }
  return rows;
}
