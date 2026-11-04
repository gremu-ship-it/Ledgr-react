import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { LocationRepository, type DeactivateBlockCode } from '../LocationRepository';

/**
 * Client contract for the Settings → Locations repository (P2-1).
 *
 * Pins the guarantees the tab depends on and the database cannot re-check:
 * the single-default invariant (clear-then-set, business-scoped), the four
 * deactivation safety checks with their exact query shapes, deactivate's
 * defense-in-depth refusal, the mirror-guarded branch name sync, and that
 * nothing on this path ever DELETEs a row.
 */

type Resolved = { data?: unknown; error?: { message: string } | null };
type Op = 'select' | 'insert' | 'update';

interface RecordedCall {
  table: string;
  op: Op;
  filters: Array<{ method: string; column: string; value?: unknown }>;
  values?: Record<string, unknown>;
  terminal: 'list' | 'single' | 'maybeSingle';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for the PostgREST chain
type Chain = any;

function createClientMock(responder: (call: RecordedCall) => Resolved) {
  const calls: RecordedCall[] = [];
  const from = (table: string): Chain => {
    const call: RecordedCall = { table, op: 'select', filters: [], terminal: 'list' };
    calls.push(call);
    const chain: Chain = {};
    const filter =
      (method: string) =>
      (column: string, ...rest: unknown[]) => {
        call.filters.push({ method, column, value: rest.length === 1 ? rest[0] : rest });
        return chain;
      };
    chain.select = (columns?: string) => {
      call.filters.push({ method: 'select', column: columns ?? '*' });
      return chain;
    };
    for (const method of ['eq', 'neq', 'gt', 'or', 'is', 'limit']) chain[method] = filter(method);
    chain.order = filter('order');
    chain.not = (column: string, ...rest: unknown[]) => {
      call.filters.push({ method: 'not', column, value: rest });
      return chain;
    };
    chain.insert = (values: Record<string, unknown>) => {
      call.op = 'insert';
      call.values = values;
      return chain;
    };
    chain.update = (values: Record<string, unknown>) => {
      call.op = 'update';
      call.values = values;
      return chain;
    };
    chain.single = () => {
      call.terminal = 'single';
      return Promise.resolve(responder(call));
    };
    chain.maybeSingle = () => {
      call.terminal = 'maybeSingle';
      return Promise.resolve(responder(call));
    };
    chain.then = (resolve: (value: Resolved) => unknown) => resolve(responder(call));
    return chain;
  };
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    calls,
    updates: (table: string) => calls.filter((c) => c.table === table && c.op === 'update'),
    selects: (table: string) => calls.filter((c) => c.table === table && c.op === 'select'),
  };
}

const hasFilter = (call: RecordedCall, method: string, column: string, value?: unknown) =>
  call.filters.some(
    (f) => f.method === method && f.column === column && (value === undefined || f.value === value),
  );

const BIZ = 'biz-1';
const LOC = 'loc-1';

const baseLocation = {
  id: LOC,
  business_id: BIZ,
  branch_id: null,
  name: 'Main Store',
  code: null,
  is_default: false,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  location_type: 'warehouse',
  project_id: null,
};

/** Responder that answers every read with empty results and every write ok. */
const quietResponder = (call: RecordedCall): Resolved => {
  if (call.op === 'select') {
    if (call.terminal === 'maybeSingle' || call.terminal === 'single') {
      return { data: call.table === 'inventory_locations' ? baseLocation : null, error: null };
    }
    return { data: [], error: null };
  }
  return { data: null, error: null };
};

describe('LocationRepository — reads', () => {
  it('getAll includes inactive rows, embeds branch names and orders by name', async () => {
    const mock = createClientMock(() => ({ data: [], error: null }));
    const repository = new LocationRepository(mock.client);
    await repository.getAll(BIZ);
    const call = mock.selects('inventory_locations')[0];
    expect(hasFilter(call, 'select', '*, branches(name)')).toBe(true);
    expect(hasFilter(call, 'eq', 'business_id', BIZ)).toBe(true);
    expect(hasFilter(call, 'order', 'name')).toBe(true);
    // No is_active filter: the tab manages inactive locations too.
    expect(call.filters.some((f) => f.column === 'is_active')).toBe(false);
  });

  it('getById is tenant-scoped and throws when the row is not found', async () => {
    const mock = createClientMock((call) =>
      call.terminal === 'maybeSingle' ? { data: null, error: null } : quietResponder(call),
    );
    const repository = new LocationRepository(mock.client);
    await expect(repository.getById(BIZ, LOC)).rejects.toThrow();
    const call = mock.selects('inventory_locations')[0];
    expect(hasFilter(call, 'eq', 'business_id', BIZ)).toBe(true);
    expect(hasFilter(call, 'eq', 'id', LOC)).toBe(true);
  });
});

describe('LocationRepository — single-default invariant', () => {
  it('setDefault clears every other default first, then sets the target', async () => {
    const mock = createClientMock(quietResponder);
    const repository = new LocationRepository(mock.client);
    await repository.setDefault(BIZ, LOC);

    const updates = mock.updates('inventory_locations');
    expect(updates).toHaveLength(2);
    expect(updates[0].values).toEqual({ is_default: false });
    expect(hasFilter(updates[0], 'eq', 'business_id', BIZ)).toBe(true);
    expect(hasFilter(updates[0], 'eq', 'is_default', true)).toBe(true);
    expect(hasFilter(updates[0], 'neq', 'id', LOC)).toBe(true);
    expect(updates[1].values).toEqual({ is_default: true });
    expect(hasFilter(updates[1], 'eq', 'business_id', BIZ)).toBe(true);
    expect(hasFilter(updates[1], 'eq', 'id', LOC)).toBe(true);
  });

  it('create applies a requested default through setDefault AFTER the insert', async () => {
    const mock = createClientMock((call) =>
      call.op === 'insert' ? { data: { ...baseLocation, id: 'new-loc' }, error: null } : quietResponder(call),
    );
    const repository = new LocationRepository(mock.client);
    const created = await repository.create({
      business_id: BIZ,
      name: 'Zomba Yard',
      location_type: 'material_yard',
      is_default: true,
    });
    expect(created.id).toBe('new-loc');

    const insert = mock.calls.find((c) => c.op === 'insert')!;
    expect(insert.values).toMatchObject({
      business_id: BIZ,
      name: 'Zomba Yard',
      location_type: 'material_yard',
      is_active: true,
      is_default: false, // never inserted as default; setDefault moves the flag
    });
    const updates = mock.updates('inventory_locations');
    expect(updates).toHaveLength(2);
    expect(hasFilter(updates[1], 'eq', 'id', 'new-loc')).toBe(true);
  });

  it('create without is_default performs no default churn', async () => {
    const mock = createClientMock((call) =>
      call.op === 'insert' ? { data: baseLocation, error: null } : quietResponder(call),
    );
    const repository = new LocationRepository(mock.client);
    await repository.create({ business_id: BIZ, name: 'Site Office', location_type: 'site_office' });
    expect(mock.updates('inventory_locations')).toHaveLength(0);
  });
});

describe('LocationRepository — deactivation safety checks', () => {
  function blockedResponder(options: {
    balances?: Array<{ quantity_on_hand: number }>;
    workOrders?: Array<{ id: string }>;
    sites?: Array<{ id: string }>;
    otherDefaults?: Array<{ id: string }>;
    location?: Partial<typeof baseLocation>;
  }) {
    return (call: RecordedCall): Resolved => {
      const location = { ...baseLocation, ...options.location };
      if (call.op === 'update') return { data: null, error: null };
      if (call.table === 'manufacturing_work_orders') return { data: options.workOrders ?? [], error: null };
      if (call.table === 'construction_procurement_sites') return { data: options.sites ?? [], error: null };
      if (call.table === 'inventory_balances') return { data: options.balances ?? [], error: null };
      if (call.table === 'inventory_locations') {
        if (call.terminal === 'maybeSingle') return { data: location, error: null };
        // list read = the other-defaults probe
        return { data: options.otherDefaults ?? [], error: null };
      }
      return { data: [], error: null };
    };
  }

  it('sums stock on hand, counts open work orders and active sites, and guards the last default', async () => {
    const mock = createClientMock(
      blockedResponder({
        balances: [{ quantity_on_hand: 100 }, { quantity_on_hand: 50 }],
        workOrders: [{ id: 'wo-1' }, { id: 'wo-2' }],
        sites: [{ id: 'site-1' }],
        otherDefaults: [],
        location: { is_default: true },
      }),
    );
    const repository = new LocationRepository(mock.client);
    const result = await repository.canDeactivate(BIZ, LOC);

    expect(result.ok).toBe(false);
    const byCode = Object.fromEntries(result.reasons.map((r) => [r.code, r.count])) as Record<
      DeactivateBlockCode,
      number | undefined
    >;
    expect(byCode.stock_on_hand).toBe(150);
    expect(byCode.open_work_orders).toBe(2);
    expect(byCode.active_procurement_site).toBe(1);
    expect(result.reasons.map((r) => r.code)).toContain('last_default');
  });

  it('excludes terminal work-order statuses and matches either location column', async () => {
    const mock = createClientMock(blockedResponder({}));
    const repository = new LocationRepository(mock.client);
    await repository.canDeactivate(BIZ, LOC);
    const woCall = mock.selects('manufacturing_work_orders')[0];
    const notFilter = woCall.filters.find((f) => f.method === 'not');
    expect(notFilter?.column).toBe('status');
    expect(notFilter?.value).toEqual(['in', '(completed,cancelled,closed)']);
    const orFilter = woCall.filters.find((f) => f.method === 'or');
    expect(String(orFilter?.column)).toContain(`from_location_id.eq.${LOC}`);
    expect(String(orFilter?.column)).toContain(`to_location_id.eq.${LOC}`);
  });

  it('only probes the last-default rule for a location that IS the default', async () => {
    const mock = createClientMock(blockedResponder({ location: { is_default: false } }));
    const repository = new LocationRepository(mock.client);
    const result = await repository.canDeactivate(BIZ, LOC);
    expect(result.ok).toBe(true);
    // The only inventory_locations list read would be the other-defaults probe.
    const listReads = mock
      .selects('inventory_locations')
      .filter((c) => c.terminal === 'list');
    expect(listReads).toHaveLength(0);
  });

  it('deactivate refuses without writing when any check fails', async () => {
    const mock = createClientMock(blockedResponder({ balances: [{ quantity_on_hand: 7 }] }));
    const repository = new LocationRepository(mock.client);
    const result = await repository.deactivate(BIZ, LOC);
    expect(result).toEqual({
      ok: false,
      deactivated: false,
      reasons: [{ code: 'stock_on_hand', count: 7 }],
    });
    expect(mock.updates('inventory_locations')).toHaveLength(0);
  });

  it('deactivate sets is_active=false (never deletes) when the checks pass', async () => {
    const mock = createClientMock(blockedResponder({}));
    const repository = new LocationRepository(mock.client);
    const result = await repository.deactivate(BIZ, LOC);
    expect(result).toEqual({ ok: true, reasons: [], deactivated: true });
    const updates = mock.updates('inventory_locations');
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ is_active: false });
    expect(hasFilter(updates[0], 'eq', 'business_id', BIZ)).toBe(true);
    expect(hasFilter(updates[0], 'eq', 'id', LOC)).toBe(true);
    expect(mock.calls.some((c) => c.op === ('delete' as Op))).toBe(false);
  });

  it('reactivate is a plain is_active=true update', async () => {
    const mock = createClientMock(quietResponder);
    const repository = new LocationRepository(mock.client);
    await repository.reactivate(BIZ, LOC);
    const updates = mock.updates('inventory_locations');
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ is_active: true });
  });
});

describe('LocationRepository — mirror-guarded branch name sync', () => {
  interface SyncState {
    locationName: string;
    branchName: string;
  }

  function syncMock(state: SyncState) {
    return createClientMock((call) => {
      if (call.table === 'branches') {
        if (call.op === 'update') {
          state.branchName = String(call.values?.name);
          return { data: null, error: null };
        }
        return { data: { id: 'br-1', name: state.branchName }, error: null };
      }
      if (call.table === 'inventory_locations') {
        if (call.op === 'update') {
          state.locationName = String(call.values?.name ?? state.locationName);
          return { data: null, error: null };
        }
        return {
          data: { ...baseLocation, name: state.locationName, branch_id: 'br-1' },
          error: null,
        };
      }
      return { data: [], error: null };
    });
  }

  it('renames the branch when the location is its name mirror', async () => {
    const state = { locationName: 'Blantyre Branch', branchName: 'Blantyre Branch' };
    const mock = syncMock(state);
    const repository = new LocationRepository(mock.client);
    await repository.updateLocation(BIZ, LOC, { name: 'Blantyre Main' });
    expect(state.branchName).toBe('Blantyre Main');
    expect(state.locationName).toBe('Blantyre Main');
    const branchUpdate = mock.updates('branches')[0];
    expect(branchUpdate.values).toEqual({ name: 'Blantyre Main' });
    expect(hasFilter(branchUpdate, 'eq', 'id', 'br-1')).toBe(true);
  });

  it('leaves the branch alone when the names do not mirror (provisioning stores)', async () => {
    const state = { locationName: 'Raw Materials Store', branchName: 'Main Factory' };
    const mock = syncMock(state);
    const repository = new LocationRepository(mock.client);
    await repository.updateLocation(BIZ, LOC, { name: 'Bulk Store' });
    expect(state.branchName).toBe('Main Factory');
    expect(state.locationName).toBe('Bulk Store');
    expect(mock.updates('branches')).toHaveLength(0);
  });

  it('never touches branches when the name is unchanged', async () => {
    const state = { locationName: 'Main Store', branchName: 'Main Site' };
    const mock = syncMock(state);
    const repository = new LocationRepository(mock.client);
    await repository.updateLocation(BIZ, LOC, { code: 'MAIN-1' });
    expect(mock.selects('branches')).toHaveLength(0);
    expect(mock.updates('branches')).toHaveLength(0);
  });

  it('routes is_default=true through the single-default invariant', async () => {
    const state = { locationName: 'Main Store', branchName: 'Main Site' };
    const mock = syncMock(state);
    const repository = new LocationRepository(mock.client);
    await repository.updateLocation(BIZ, LOC, { is_default: true });
    const updates = mock.updates('inventory_locations');
    // fields update skipped (no scalar fields), clear-others + set-target ran
    expect(updates).toHaveLength(2);
    expect(updates[0].values).toEqual({ is_default: false });
    expect(updates[1].values).toEqual({ is_default: true });
  });
});

describe('LocationRepository — error propagation', () => {
  it('surfaces database errors through the repository error boundary', async () => {
    const mock = createClientMock((call) =>
      call.op === 'select'
        ? { data: null, error: { message: 'permission denied' } }
        : { data: null, error: null },
    );
    const repository = new LocationRepository(mock.client);
    await expect(repository.getAll(BIZ)).rejects.toThrow('permission denied');
  });
});
