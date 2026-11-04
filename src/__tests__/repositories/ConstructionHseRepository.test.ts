import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConstructionHseRepository } from '@/dal/repositories/ConstructionHseRepository';

function makeBuilder(result: { data: unknown; error?: unknown; count?: number } = { data: [], error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  for (const method of ['select', 'eq', 'order', 'in', 'gte', 'lt', 'insert', 'update']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient(options: {
  from?: ReturnType<typeof vi.fn>;
  query?: ReturnType<typeof makeBuilder>;
  result?: { data: unknown; error?: unknown; count?: number };
  rpcResult?: { data: unknown; error?: unknown };
  userId?: string | null;
} = {}) {
  const query = options.query ?? makeBuilder(options.result);
  const from = options.from ?? vi.fn(() => query);
  const rpc = vi.fn(async () => options.rpcResult ?? { data: null, error: null });
  const getUser = vi.fn(async () => ({ data: { user: options.userId === null ? null : { id: options.userId ?? 'user-1' } }, error: null }));
  const repository = new ConstructionHseRepository({ from, rpc, auth: { getUser } } as never);
  return { repository, from, rpc, getUser, query };
}

beforeEach(() => vi.clearAllMocks());

describe('ConstructionHseRepository', () => {
  it('lists incidents with business, project, status, and severity filters', async () => {
    const rows = [{ id: 'incident-1', status: 'reported', severity: 'major' }];
    const { repository, from, query } = makeClient({ result: { data: rows, error: null } });

    await expect(repository.listIncidents('biz-1', {
      projectId: 'project-1', status: 'reported', severity: 'major',
    })).resolves.toEqual(rows);

    expect(from).toHaveBeenCalledWith('construction_hse_incidents');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'biz-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'project_id', 'project-1');
    expect(query.eq).toHaveBeenNthCalledWith(3, 'status', 'reported');
    expect(query.eq).toHaveBeenNthCalledWith(4, 'severity', 'major');
  });

  it('creates an incident and toolbox talk with authenticated actor metadata', async () => {
    const incidentQuery = makeBuilder({ data: { id: 'incident-1' }, error: null });
    const talkQuery = makeBuilder({ data: { id: 'talk-1' }, error: null });
    const from = vi.fn((table: string) => table === 'construction_hse_incidents' ? incidentQuery : talkQuery);
    const { repository, getUser } = makeClient({ from });

    await repository.createIncident('biz-1', {
      project_id: 'project-1', incident_number: 'HSE-01', title: 'Near miss', description: 'A load shifted',
      incident_date: '2026-11-02T10:00:00Z', severity: 'near_miss', incident_type: 'near_miss',
    });
    await repository.createToolboxTalk('biz-1', {
      project_id: 'project-1', talk_date: '2026-11-02', topic: 'Working at height', presenter: 'Site lead',
      summary: 'Harness inspection and safe access.',
    });

    expect(getUser).toHaveBeenCalledTimes(2);
    expect(incidentQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'biz-1', reported_by: 'user-1' }));
    expect(talkQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: 'biz-1', created_by: 'user-1' }));
  });

  it('routes status changes through the incident transition RPC', async () => {
    const { repository, rpc } = makeClient();

    await repository.transitionIncidentStatus('incident-1', 'investigating');

    expect(rpc).toHaveBeenCalledWith('transition_hse_incident_status', {
      p_incident_id: 'incident-1', p_new_status: 'investigating',
    });
  });

  it('calculates open-incident counts by severity and current-month talk count', async () => {
    const incidentQuery = makeBuilder({ data: [
      { status: 'reported', severity: 'near_miss' },
      { status: 'investigating', severity: 'critical' },
      { status: 'investigating', severity: 'critical' },
      { status: 'resolved', severity: 'minor' },
    ], error: null });
    const talksQuery = makeBuilder({ data: null, count: 4, error: null });
    const from = vi.fn((table: string) => table === 'construction_hse_incidents' ? incidentQuery : talksQuery);
    const { repository } = makeClient({ from });

    await expect(repository.getDashboardStats('biz-1', {
      projectId: 'project-1', asOf: new Date('2026-11-02T15:30:00Z'),
    })).resolves.toEqual({
      open_incidents_by_severity: { near_miss: 1, minor: 1, major: 0, critical: 2, fatality: 0 },
      toolbox_talks_this_month: 4,
    });
    expect(incidentQuery.in).toHaveBeenCalledWith('status', ['reported', 'investigating', 'resolved']);
    expect(talksQuery.gte).toHaveBeenCalledWith('talk_date', '2026-11-01');
    expect(talksQuery.lt).toHaveBeenCalledWith('talk_date', '2026-12-01');
  });

  it('returns toolbox talks newest first and throws when an incident is missing', async () => {
    const { repository, query } = makeClient({ result: { data: null, error: null } });

    await expect(repository.getIncidentById('biz-1', 'missing')).rejects.toThrow();
    await repository.listToolboxTalks('biz-1', { projectId: 'project-1' });
    expect(query.order).toHaveBeenCalledWith('talk_date', { ascending: false });
  });
});
