import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { BranchRepository } from '../BranchRepository';

/**
 * Branch → paired-location name sync (construction org audit §1.1.2 drift fix).
 *
 * createWithLocation() pairs a branch with a same-named location. Renaming the
 * branch must rename its MIRROR location — and only its mirror: provisioning
 * stores that merely share a branch ("Raw Materials Store" under "Main
 * Factory") must never be flattened into the branch name.
 */

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  filters: Array<{ method: string; column: string; value?: unknown }>;
  values?: Record<string, unknown>;
  terminal: 'list' | 'single' | 'maybeSingle';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for the PostgREST chain
type Chain = any;

function createClientMock(responder: (call: RecordedCall) => { data?: unknown; error?: { message: string } | null }) {
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
    for (const method of ['eq', 'neq', 'is', 'order', 'limit']) chain[method] = filter(method);
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
    chain.then = (resolve: (value: { data?: unknown; error?: { message: string } | null }) => unknown) =>
      resolve(responder(call));
    return chain;
  };
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    calls,
    updates: (table: string) => calls.filter((c) => c.table === table && c.op === 'update'),
  };
}

const hasFilter = (call: RecordedCall, method: string, column: string, value?: unknown) =>
  call.filters.some(
    (f) => f.method === method && f.column === column && (value === undefined || f.value === value),
  );

describe('BranchRepository.updateBranch — paired location name sync', () => {
  it('renames the location whose name mirrors the OLD branch name', async () => {
    const mock = createClientMock((call) => {
      if (call.table === 'branches') {
        if (call.op === 'update') {
          return { data: { id: 'br-1', name: 'Blantyre Main' }, error: null };
        }
        // pre-read of the current branch name
        return { data: { name: 'Blantyre Branch' }, error: null };
      }
      return { data: null, error: null };
    });
    const repository = new BranchRepository(mock.client);
    const updated = await repository.updateBranch('br-1', { name: 'Blantyre Main' });
    expect(updated.name).toBe('Blantyre Main');

    const locationUpdates = mock.updates('inventory_locations');
    expect(locationUpdates).toHaveLength(1);
    expect(locationUpdates[0].values).toEqual({ name: 'Blantyre Main' });
    // Scoped to this branch's mirror only: branch_id + the OLD name.
    expect(hasFilter(locationUpdates[0], 'eq', 'branch_id', 'br-1')).toBe(true);
    expect(hasFilter(locationUpdates[0], 'eq', 'name', 'Blantyre Branch')).toBe(true);
  });

  it('performs no sync when the name is unchanged or absent from the dto', async () => {
    const mock = createClientMock((call) => {
      if (call.table === 'branches' && call.op === 'update') {
        return { data: { id: 'br-1', name: 'Blantyre Branch' }, error: null };
      }
      if (call.table === 'branches') return { data: { name: 'Blantyre Branch' }, error: null };
      return { data: null, error: null };
    });
    const repository = new BranchRepository(mock.client);
    // Same name: nothing to sync.
    await repository.updateBranch('br-1', { name: 'Blantyre Branch' });
    // No name at all (e.g. toggling is_active): nothing to sync, no pre-read.
    await repository.updateBranch('br-1', { location: 'Chichiri' });
    expect(mock.updates('inventory_locations')).toHaveLength(0);
    const preReads = mock.calls.filter(
      (c) => c.table === 'branches' && c.op === 'select' && c.terminal === 'maybeSingle',
    );
    expect(preReads).toHaveLength(1); // only the same-name call pre-read
  });
});
