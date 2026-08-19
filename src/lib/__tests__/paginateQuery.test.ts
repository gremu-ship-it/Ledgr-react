import { describe, it, expect } from 'vitest';
import { fetchAllRows } from '@/lib/paginateQuery';

/** Minimal PostgREST-builder-like stub: returns pages in order, a short page ends. */
function makeQuery(pages: unknown[][]) {
  let call = 0;
  const builder = {
    range: async () => {
      const data = pages[Math.min(call, pages.length - 1)] ?? [];
      call += 1;
      return { data, error: null };
    },
    order: () => builder,
  };
  return builder;
}

describe('fetchAllRows (Phase 10.2e)', () => {
  it('returns everything when a single page holds all rows', async () => {
    const rows = await fetchAllRows(makeQuery([[{ id: 1 }, { id: 2 }]]));
    expect(rows).toHaveLength(2);
  });

  it('pages past the 1000-row cap without losing rows', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const secondPage = [{ id: 1000 }, { id: 1001 }];
    const rows = await fetchAllRows(makeQuery([firstPage, secondPage]));
    expect(rows).toHaveLength(1002);
    expect(rows[1000]).toEqual({ id: 1000 });
    expect(rows[1001]).toEqual({ id: 1001 });
  });

  it('continues across many full pages', async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => ({ id: i }))];
    pages.push(Array.from({ length: 1000 }, (_, i) => ({ id: 1000 + i })));
    pages.push([{ id: 2000 }]);
    const rows = await fetchAllRows(makeQuery(pages));
    expect(rows).toHaveLength(2001);
    expect(rows[2000]).toEqual({ id: 2000 });
  });

  it('propagates an error from the query', async () => {
    const builder = {
      range: async () => ({ data: null, error: new Error('boom') }),
      order: () => builder,
    };
    await expect(fetchAllRows(builder)).rejects.toThrow('boom');
  });

  it('honours a custom page size', async () => {
    const pages = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }],
    ];
    const rows = await fetchAllRows(makeQuery(pages), { pageSize: 2 });
    expect(rows).toHaveLength(3);
  });
});
