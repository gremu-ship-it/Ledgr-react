/**
 * Shared thenable Supabase query-chain stub for repository/service tests.
 *
 * Unlike the per-file `tableStub` proxies (which return every fixture row
 * regardless of the query), `filterableTableStub` honours the filter, sort
 * and pagination calls the DAL actually issues — eq, is(null), in, gte, lte,
 * order, limit — including dotted join paths such as
 * `journal_entries.entry_date`. That lets golden tests exercise
 * date-windowed balance computations against one mini-ledger fixture instead
 * of a fixture per period.
 *
 * Chain state that is simulated:
 *   - eq / is / in / gte / lte   -> row filtering
 *   - order(col, { ascending })  -> sorting (numeric-aware)
 *   - limit(n)                   -> pagination
 *   - maybeSingle / single       -> first matching row (or null)
 *   - insert(rows)               -> captured in `inserted`, and echoed back
 *                                   through a following select/single chain
 *
 * Anything else (select, update, ...) is a chain pass-through.
 */

type StubRow = Record<string, unknown>;

type Filter = {
  op: 'eq' | 'is' | 'in' | 'gte' | 'lte';
  column: string;
  value: unknown;
};

export interface StubbedTable {
  /** The chainable, thenable query object to return from client.from(). */
  query: unknown;
  /** Every row passed to insert() on chains for this stub, in call order. */
  inserted: StubRow[];
}

function valueAt(row: StubRow, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value !== null && typeof value === 'object') {
      return (value as StubRow)[key];
    }
    return undefined;
  }, row);
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function createChain(rows: StubRow[], inserted: StubRow[]): unknown {
  const filters: Filter[] = [];
  let orderBy: { column: string; ascending: boolean } | null = null;
  let limitCount: number | null = null;
  let pendingInsert: StubRow[] | null = null;

  const selected = (): StubRow[] => {
    if (pendingInsert) return pendingInsert;
    let result = rows.filter((row) =>
      filters.every((filter) => {
        const value = valueAt(row, filter.column);
        switch (filter.op) {
          case 'eq':
            return value === filter.value;
          case 'is':
            return filter.value === null ? value == null : value === filter.value;
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(value);
          case 'gte':
            return compareValues(value, filter.value) >= 0;
          case 'lte':
            return compareValues(value, filter.value) <= 0;
          default:
            return true;
        }
      }),
    );
    if (orderBy) {
      const { column, ascending } = orderBy;
      result = [...result].sort((a, b) => {
        const cmp = compareValues(valueAt(a, column), valueAt(b, column));
        return ascending ? cmp : -cmp;
      });
    }
    if (limitCount !== null) result = result.slice(0, limitCount);
    return result;
  };

  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: { data: StubRow[]; error: null }) => unknown) =>
            onFulfilled({ data: selected(), error: null });
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve({ data: selected()[0] ?? null, error: null });
        }
        if (prop === 'in' || prop === 'gte' || prop === 'lte' || prop === 'eq' || prop === 'is') {
          return (column: string, value: unknown) => {
            filters.push({ op: prop as Filter['op'], column, value });
            return proxy;
          };
        }
        if (prop === 'order') {
          return (column: string, options?: { ascending?: boolean }) => {
            orderBy = { column, ascending: options?.ascending ?? true };
            return proxy;
          };
        }
        if (prop === 'limit') {
          return (count: number) => {
            limitCount = count;
            return proxy;
          };
        }
        if (prop === 'insert') {
          return (payload: StubRow | StubRow[]) => {
            const payloadRows = Array.isArray(payload) ? payload : [payload];
            inserted.push(...payloadRows);
            pendingInsert = payloadRows;
            return proxy;
          };
        }
        // select / update / delete / range / ... — chain pass-through.
        return () => proxy;
      },
    },
  );

  return proxy;
}

export function filterableTableStub(rows: StubRow[]): StubbedTable {
  const inserted: StubRow[] = [];
  return { query: createChain(rows, inserted), inserted };
}

export interface StubbedClient {
  client: { from: (table: string) => unknown };
  /**
   * Per-table insert capture. `inserts.journal_lines`, `inserts.exchange_rates`,
   * etc. appear after the code under test calls that table at least once.
   */
  inserts: Record<string, StubRow[]>;
}

/**
 * Builds a minimal SupabaseClient replacement whose `from(table)` dispatches
 * to per-table filterable stubs backed by the seeded rows. Each `from()`
 * call yields a FRESH query chain (filters do not leak between queries on
 * the same table) but all chains share the seed rows and the insert capture.
 */
export function stubSupabaseClient(seeds: Record<string, StubRow[]>): StubbedClient {
  const inserts: Record<string, StubRow[]> = {};
  const rowsByTable = new Map<string, StubRow[]>();
  const client = {
    from: (table: string) => {
      if (!rowsByTable.has(table)) rowsByTable.set(table, [...(seeds[table] ?? [])]);
      if (!inserts[table]) inserts[table] = [];
      return createChain(rowsByTable.get(table) as StubRow[], inserts[table]);
    },
  };
  return { client, inserts };
}
