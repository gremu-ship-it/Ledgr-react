import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConstructionQualityRepository } from '@/dal/repositories/ConstructionQualityRepository';

function makeBuilder(result: { data: unknown; error?: unknown; count?: number } = { data: [], error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  for (const method of ['select', 'eq', 'order', 'in', 'insert', 'update', 'delete']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient(options: {
  result?: { data: unknown; error?: unknown; count?: number };
  rpcResult?: { data: unknown; error?: unknown };
  userId?: string | null;
} = {}) {
  const query = makeBuilder(options.result);
  const from = vi.fn(() => query);
  const rpc = vi.fn(async () => options.rpcResult ?? { data: null, error: null });
  const getUser = vi.fn(async () => ({ data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } }, error: null }));
  const repository = new ConstructionQualityRepository({ from, rpc, auth: { getUser } } as never);
  return { repository, from, rpc, getUser, query };
}

beforeEach(() => vi.clearAllMocks());

describe('ConstructionQualityRepository', () => {
  it('lists ITPs scoped to a business and applies project/status filters', async () => {
    const rows = [{ id: 'itp-1', status: 'active' }];
    const { repository, from, query } = makeClient({ result: { data: rows, error: null } });

    await expect(repository.listItps('biz-1', { projectId: 'project-1', status: 'active' })).resolves.toEqual(rows);

    expect(from).toHaveBeenCalledWith('construction_itps');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'project_id', 'project-1');
    expect(query.eq).toHaveBeenNthCalledWith(3, 'status', 'active');
  });

  it('creates an ITP with the authenticated actor instead of accepting an actor from the caller', async () => {
    const row = { id: 'itp-1', business_id: 'biz-1', created_by: 'user-1' };
    const { repository, query, getUser } = makeClient({ result: { data: row, error: null } });

    await expect(repository.createItp('biz-1', {
      project_id: 'project-1', itp_number: 'ITP-01', title: 'Concrete pour', scope: 'Foundation slab',
    })).resolves.toEqual(row);

    expect(getUser).toHaveBeenCalledOnce();
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'biz-1', project_id: 'project-1', created_by: 'user-1', itp_number: 'ITP-01',
    }));
  });

  it('marks checkpoints and records the authenticated inspector and inspection time', async () => {
    const row = { id: 'checkpoint-1', status: 'passed', inspected_by: 'user-1' };
    const { repository, query } = makeClient({ result: { data: row, error: null } });

    await expect(repository.updateCheckpoint('biz-1', 'checkpoint-1', { status: 'passed' })).resolves.toEqual(row);

    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'passed', inspected_by: 'user-1', inspected_at: expect.any(String),
    }));
    expect(query.eq).toHaveBeenCalledWith('business_id', 'biz-1');
  });

  it('calls the ITP and NCR transition RPCs using their typed status arguments', async () => {
    const { repository, rpc } = makeClient();

    await repository.transitionItpStatus('itp-1', 'active');
    await repository.transitionNcrStatus('ncr-1', 'investigating');

    expect(rpc).toHaveBeenNthCalledWith(1, 'transition_itp_status', {
      p_itp_id: 'itp-1', p_new_status: 'active',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'transition_ncr_status', {
      p_ncr_id: 'ncr-1', p_new_status: 'investigating',
    });
  });

  it('creates NCRs with the authenticated raiser and links an optional ITP checkpoint', async () => {
    const row = { id: 'ncr-1', raised_by: 'user-1', itp_checkpoint_id: 'checkpoint-1' };
    const { repository, query } = makeClient({ result: { data: row, error: null } });

    await repository.createNcr('biz-1', {
      project_id: 'project-1', ncr_number: 'NCR-01', title: 'Cracked block', description: 'Observed at inspection',
      itp_checkpoint_id: 'checkpoint-1',
    });

    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'biz-1', raised_by: 'user-1', itp_checkpoint_id: 'checkpoint-1',
    }));
  });

  it('lists checkpoints in sequence order and returns whether a delete matched a row', async () => {
    const { repository, query } = makeClient({ result: { data: { id: 'checkpoint-1' }, error: null } });

    await repository.listCheckpointsByItp('biz-1', 'itp-1');
    await expect(repository.deleteCheckpoint('biz-1', 'checkpoint-1')).resolves.toBe(true);

    expect(query.order).toHaveBeenCalledWith('sequence_number', { ascending: true });
    expect(query.delete).toHaveBeenCalledOnce();
  });
});
