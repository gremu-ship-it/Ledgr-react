import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConstructionScheduleRepository } from '@/dal/repositories/ConstructionScheduleRepository';

function makeBuilder(result: { data: unknown; error?: unknown } = { data: [], error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  for (const method of ['select', 'eq', 'or', 'order', 'insert', 'update', 'delete']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient(options: {
  result?: { data: unknown; error?: unknown };
  rpcResult?: { data: unknown; error?: unknown };
  userId?: string | null;
} = {}) {
  const query = makeBuilder(options.result);
  const from = vi.fn(() => query);
  const rpc = vi.fn(async () => options.rpcResult ?? { data: null, error: null });
  const getUser = vi.fn(async () => ({ data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } }, error: null }));
  const repository = new ConstructionScheduleRepository({ from, rpc, auth: { getUser } } as never);
  return { repository, from, rpc, getUser, query };
}

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1', business_id: 'biz-1', project_id: 'project-1', site_id: null, parent_task_id: null,
  wbs_code: '1.1', task_name: 'Prepare site', description: null, status: 'not_started',
  planned_start: null, planned_finish: null, actual_start: null, actual_finish: null,
  progress_percent: 0, boq_section_id: null, subcontract_id: null, sort_order: 0,
  created_by: 'user-1', created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z',
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('ConstructionScheduleRepository', () => {
  it('lists project tasks in sort and WBS order, scoped to the business and project', async () => {
    const rows = [task()];
    const { repository, from, query } = makeClient({ result: { data: rows, error: null } });

    await expect(repository.listByProject('biz-1', 'project-1')).resolves.toEqual(rows);

    expect(from).toHaveBeenCalledWith('construction_schedule_tasks');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'project_id', 'project-1');
    expect(query.order).toHaveBeenNthCalledWith(1, 'sort_order', { ascending: true });
    expect(query.order).toHaveBeenNthCalledWith(2, 'wbs_code', { ascending: true });
  });

  it('gets a task using both the business and task identifiers and reports missing rows', async () => {
    const row = task();
    const found = makeClient({ result: { data: row, error: null } });
    await expect(found.repository.getById('biz-1', 'task-1')).resolves.toEqual(row);
    expect(found.query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');
    expect(found.query.eq).toHaveBeenNthCalledWith(2, 'id', 'task-1');

    const missing = makeClient({ result: { data: null, error: null } });
    await expect(missing.repository.getById('biz-1', 'missing')).rejects.toThrow(/not found/i);
  });

  it('creates tasks with the authenticated creator instead of accepting one from the caller', async () => {
    const row = task();
    const { repository, query, getUser } = makeClient({ result: { data: row, error: null } });

    await expect(repository.create('biz-1', {
      project_id: 'project-1', wbs_code: '1.1', task_name: 'Prepare site',
    })).resolves.toEqual(row);

    expect(getUser).toHaveBeenCalledOnce();
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'biz-1', created_by: 'user-1', project_id: 'project-1', wbs_code: '1.1',
    }));
  });

  it('updates task fields and the update timestamp within the tenant scope', async () => {
    const row = task({ task_name: 'Excavate foundations' });
    const { repository, query } = makeClient({ result: { data: row, error: null } });

    await expect(repository.update('biz-1', 'task-1', { task_name: 'Excavate foundations' })).resolves.toEqual(row);

    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      task_name: 'Excavate foundations', updated_at: expect.any(String),
    }));
    expect(query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'id', 'task-1');
  });

  it('deletes tasks only in the requested business and reports whether a row was deleted', async () => {
    const found = makeClient({ result: { data: { id: 'task-1' }, error: null } });
    await expect(found.repository.delete('biz-1', 'task-1')).resolves.toBe(true);
    expect(found.query.delete).toHaveBeenCalledOnce();
    expect(found.query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');

    const missing = makeClient({ result: { data: null, error: null } });
    await expect(missing.repository.delete('biz-1', 'missing')).resolves.toBe(false);
  });

  it('sends progress updates to update_task_progress and validates the integer percentage', async () => {
    const { repository, rpc } = makeClient();

    await repository.updateProgress('task-1', 65);
    expect(rpc).toHaveBeenCalledWith('update_task_progress', { p_task_id: 'task-1', p_progress: 65 });
    await expect(repository.updateProgress('task-1', 101)).rejects.toThrow('construction-scheduling-invalid-progress');
    await expect(repository.updateProgress('task-1', 12.5)).rejects.toThrow('construction-scheduling-invalid-progress');
  });

  it('lists dependencies where the task is either predecessor or successor', async () => {
    const rows = [{ id: 'dependency-1', predecessor_id: 'task-1', successor_id: 'task-2', dependency_type: 'FS' }];
    const { repository, from, query } = makeClient({ result: { data: rows, error: null } });

    await expect(repository.listDependencies('biz-1', 'task-1')).resolves.toEqual(rows);

    expect(from).toHaveBeenCalledWith('construction_task_dependencies');
    expect(query.eq).toHaveBeenCalledWith('business_id', 'biz-1');
    expect(query.or).toHaveBeenCalledWith('predecessor_id.eq.task-1,successor_id.eq.task-1');
  });

  it('creates and deletes dependencies with business-scoped writes', async () => {
    const row = { id: 'dependency-1', business_id: 'biz-1', predecessor_id: 'task-1', successor_id: 'task-2', dependency_type: 'FS', lag_days: 0 };
    const created = makeClient({ result: { data: row, error: null } });

    await expect(created.repository.createDependency('biz-1', {
      predecessor_id: 'task-1', successor_id: 'task-2', dependency_type: 'FS', lag_days: 0,
    })).resolves.toEqual(row);
    expect(created.query.insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'biz-1', predecessor_id: 'task-1' }));

    const deleted = makeClient({ result: { data: { id: 'dependency-1' }, error: null } });
    await expect(deleted.repository.deleteDependency('biz-1', 'dependency-1')).resolves.toBe(true);
    expect(deleted.query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');
    expect(deleted.query.eq).toHaveBeenNthCalledWith(2, 'id', 'dependency-1');
  });

  it('returns the WBS as parent/child nodes', async () => {
    const rows = [
      task({ id: 'task-1', wbs_code: '1', task_name: 'Construction' }),
      task({ id: 'task-2', parent_task_id: 'task-1', wbs_code: '1.1', task_name: 'Foundations' }),
      task({ id: 'task-3', parent_task_id: 'task-2', wbs_code: '1.1.1', task_name: 'Excavation' }),
    ];
    const { repository } = makeClient({ result: { data: rows, error: null } });

    const tree = await repository.getTaskTree('biz-1', 'project-1');
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('task-1');
    expect(tree[0].children[0].id).toBe('task-2');
    expect(tree[0].children[0].children[0].id).toBe('task-3');
  });

  it('keeps malformed parent cycles from producing an unrooted task tree', async () => {
    const rows = [
      task({ id: 'task-1', parent_task_id: 'task-2', wbs_code: '1' }),
      task({ id: 'task-2', parent_task_id: 'task-1', wbs_code: '1.1' }),
    ];
    const { repository } = makeClient({ result: { data: rows, error: null } });

    const tree = await repository.getTaskTree('biz-1', 'project-1');
    expect(tree).toHaveLength(2);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it('summarizes total, completed, in-progress, not-started, and on-hold tasks', async () => {
    const rows = [
      task({ id: '1', status: 'not_started' }),
      task({ id: '2', status: 'in_progress' }),
      task({ id: '3', status: 'completed' }),
      task({ id: '4', status: 'on_hold' }),
      task({ id: '5', status: 'cancelled' }),
    ];
    const { repository } = makeClient({ result: { data: rows, error: null } });

    await expect(repository.getProjectScheduleSummary('biz-1', 'project-1')).resolves.toEqual({
      total_tasks: 5, completed: 1, in_progress: 1, not_started: 1, on_hold: 1,
    });
  });
});
