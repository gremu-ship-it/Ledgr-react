import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConstructionChangeOrderRepository } from '../../dal/repositories/ConstructionChangeOrderRepository';
import type { Database } from '../../dal/types/database';

const draftCo = {
  id: 'co-1',
  business_id: 'business-1',
  project_id: 'project-1',
  site_id: 'site-1',
  co_number: 'CO-001',
  status: 'draft',
  title: 'Additional drainage',
  description: 'Add a drainage run on the east side.',
  reason: 'Unexpected ground water.',
  cost_impact: 1200,
  time_impact_days: 3,
  boq_section_id: 'section-1',
  subcontract_id: null,
  evidence_reference: 'Site instruction SI-17',
  rejection_reason: null,
  approved_by: null,
  approved_at: null,
  submitted_by: null,
  submitted_at: null,
  created_by: 'user-1',
  created_at: '2026-11-30T08:00:00Z',
  updated_at: '2026-11-30T08:00:00Z',
} satisfies Database['public']['Tables']['construction_change_orders']['Row'];

type MockQueryChain = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
};

describe('ConstructionChangeOrderRepository', () => {
  let mockClient: {
    from: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
    auth: { getUser: ReturnType<typeof vi.fn> };
  };
  let repository: ConstructionChangeOrderRepository;
  let queryResult: { data: unknown; error: unknown };
  let chain: MockQueryChain;

  beforeEach(() => {
    queryResult = { data: null, error: null };
    chain = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      single: vi.fn(),
      then: (resolve, reject) => Promise.resolve(queryResult).then(resolve, reject),
    };
    mockClient = {
      from: vi.fn().mockReturnValue(chain),
      rpc: vi.fn(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    };
    repository = new ConstructionChangeOrderRepository(mockClient as unknown as SupabaseClient<Database>);
  });

  it('lists business change orders with optional project and status filters', async () => {
    queryResult = { data: [draftCo], error: null };
    await expect(repository.list('business-1', { projectId: 'project-1', status: 'draft' })).resolves.toEqual([draftCo]);

    expect(mockClient.from).toHaveBeenCalledWith('construction_change_orders');
    expect(chain.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'draft');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('gets a change order scoped to both business and id', async () => {
    chain.maybeSingle.mockResolvedValue({ data: draftCo, error: null });
    await expect(repository.getById('business-1', 'co-1')).resolves.toEqual(draftCo);
    expect(chain.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(chain.eq).toHaveBeenCalledWith('id', 'co-1');
  });

  it('creates with the injected authenticated user as created_by', async () => {
    chain.single.mockResolvedValue({ data: draftCo, error: null });
    const input = {
      project_id: draftCo.project_id,
      site_id: draftCo.site_id,
      co_number: draftCo.co_number,
      title: draftCo.title,
      description: draftCo.description,
      reason: draftCo.reason,
      cost_impact: draftCo.cost_impact,
      time_impact_days: draftCo.time_impact_days,
      boq_section_id: draftCo.boq_section_id,
      subcontract_id: draftCo.subcontract_id,
      evidence_reference: draftCo.evidence_reference,
    };

    await expect(repository.create('business-1', input)).resolves.toEqual(draftCo);
    expect(mockClient.auth.getUser).toHaveBeenCalledOnce();
    expect(mockClient.from).toHaveBeenCalledWith('construction_change_orders');
    expect(chain.insert).toHaveBeenCalledWith({ ...input, business_id: 'business-1', created_by: 'user-1' });
  });

  it('updates only a draft change order', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { ...draftCo, title: 'Drainage revision' }, error: null });

    await expect(repository.update('business-1', 'co-1', { title: 'Drainage revision' }))
      .resolves.toMatchObject({ title: 'Drainage revision' });
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Drainage revision', updated_at: expect.any(String) }));
    expect(chain.eq).toHaveBeenCalledWith('status', 'draft');
  });

  it('rejects updates when the row is no longer a draft', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { ...draftCo, status: 'submitted' }, error: null });

    await expect(repository.update('business-1', 'co-1', { title: 'No longer editable' }))
      .rejects.toThrow(/only draft change orders can be edited/i);
    expect(chain.eq).toHaveBeenCalledWith('status', 'draft');
  });

  it('transitions status through the guarded RPC and forwards a rejection reason', async () => {
    mockClient.rpc.mockResolvedValue({ data: undefined, error: null });

    await expect(repository.transitionStatus('co-1', 'rejected', 'Insufficient detail')).resolves.toBeUndefined();
    expect(mockClient.rpc).toHaveBeenCalledWith('transition_construction_co', {
      p_co_id: 'co-1',
      p_new_status: 'rejected',
      p_rejection_reason: 'Insufficient detail',
    });
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('aggregates cost and time impact by status for the project', async () => {
    queryResult = { data: [
      { status: 'draft', cost_impact: 1200, time_impact_days: 3 },
      { status: 'approved', cost_impact: -200, time_impact_days: -1 },
      { status: 'approved', cost_impact: 500, time_impact_days: 2 },
    ], error: null };

    await expect(repository.getProjectSummary('business-1', 'project-1')).resolves.toEqual({
      project_id: 'project-1',
      by_status: {
        draft: { count: 1, cost_impact: 1200, time_impact_days: 3 },
        submitted: { count: 0, cost_impact: 0, time_impact_days: 0 },
        approved: { count: 2, cost_impact: 300, time_impact_days: 1 },
        rejected: { count: 0, cost_impact: 0, time_impact_days: 0 },
        cancelled: { count: 0, cost_impact: 0, time_impact_days: 0 },
      },
      total_count: 3,
      total_cost_impact: 1500,
      total_time_impact_days: 4,
    });
    expect(chain.select).toHaveBeenCalledWith('status, cost_impact, time_impact_days');
    expect(chain.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'project-1');
  });
});
