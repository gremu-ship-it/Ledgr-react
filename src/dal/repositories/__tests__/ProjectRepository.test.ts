import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: mocks }));
import { ProjectRepository } from '../ProjectRepository';
import { ConstructionProcurementRepository } from '../ConstructionProcurementRepository';
const repository = new ProjectRepository();
const input = {
  name: 'Hospital',
  client_name: 'Client',
  contract_sum: 1000,
  retention_pct: 10,
  budget: 800,
  start_date: null,
  end_date: null,
};
function builder(data: unknown, count = 1) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(),
  };
  for (const method of ['select', 'eq', 'order', 'range'] as const)
    chain[method].mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data, error: null });
  chain.then.mockImplementation((resolve: (result: unknown) => unknown) =>
    Promise.resolve(resolve({ data, error: null, count })),
  );
  return chain;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { id: 'p1' }, error: null });
});
describe('ProjectRepository RPC contracts', () => {
  it('maps metadata, lifecycle and location writes to RPCs without direct writes', async () => {
    await repository.create('b1', input);
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_project', {
      p_business_id: 'b1',
      p_name: 'Hospital',
      p_client_name: 'Client',
      p_contract_sum: 1000,
      p_retention_pct: 10,
      p_budget: 800,
      p_start_date: null,
      p_end_date: null,
    });
    await repository.update('p1', input);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'update_project',
      expect.objectContaining({ p_project_id: 'p1', p_name: 'Hospital' }),
    );
    await repository.transitionStatus('p1', 'active', 'Approved');
    expect(mocks.rpc).toHaveBeenLastCalledWith('transition_project_status', {
      p_project_id: 'p1',
      p_new_status: 'active',
      p_reason: 'Approved',
    });
    await repository.linkSite('l1', 'p1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('link_site_to_project', {
      p_location_id: 'l1',
      p_project_id: 'p1',
    });
    await repository.unlinkSite('l1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('unlink_site_from_project', {
      p_location_id: 'l1',
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('reads the single cost-summary result row and propagates server errors', async () => {
    const cost = {
      total_po_value: 100,
      total_issued_value: 50,
      total_returned_value: 5,
      net_cost: 95,
    };
    mocks.rpc.mockResolvedValueOnce({ data: [cost], error: null });
    expect(await repository.getCostSummary('p1')).toEqual(cost);
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_project_cost_summary', {
      p_project_id: 'p1',
    });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not authorized' },
    });
    await expect(repository.create('b1', input)).rejects.toThrow(
      'Not authorized',
    );
  });
  it('paginates and filters the list by business and status', async () => {
    const chain = builder([{ id: 'p1' }], 51);
    mocks.from.mockReturnValue(chain);
    expect(await repository.list('b1', { status: 'active', page: 1 })).toEqual({
      rows: [{ id: 'p1' }],
      count: 51,
    });
    expect(mocks.from).toHaveBeenCalledWith('projects');
    expect(chain.eq).toHaveBeenCalledWith('business_id', 'b1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(chain.range).toHaveBeenCalledWith(25, 49);
  });
  it('scopes detail to business before loading site count and cost RPC', async () => {
    const project = { id: 'p1', business_id: 'b1' };
    mocks.from.mockImplementation((table: string) =>
      builder(
        table === 'projects'
          ? project
          : [
              { id: 'l1', project_id: 'p1' },
              { id: 'l2', project_id: null },
            ],
      ),
    );
    mocks.rpc.mockResolvedValue({ data: [{ net_cost: 50 }], error: null });
    expect(await repository.getById('b1', 'p1')).toEqual({
      ...project,
      site_count: 1,
      cost: { net_cost: 50 },
    });
  });
  it('does not load costs for inaccessible or foreign project ids', async () => {
    const chain = builder(null);
    mocks.from.mockReturnValue(chain);
    expect(await repository.getById('b1', 'foreign')).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith('business_id', 'b1');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('additive procurement project dimension', () => {
  it('uses project wrappers only for tagged writes, retaining the original commands for untagged writes', async () => {
    const procurement = new ConstructionProcurementRepository();
    const po = {
      business_id: 'b1',
      site_id: 'site',
      supplier_contact_id: 'supplier',
      currency: 'MWK',
      lines: [],
    };
    await procurement.createPurchaseOrder(po, 'key');
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'create_construction_purchase_order',
      { p_payload: po, p_client_key: 'key' },
    );
    await procurement.createPurchaseOrder(po, 'key', 'p1');
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'create_project_purchase_order',
      { p_payload: po, p_client_key: 'key', p_project_id: 'p1' },
    );
    const issue = {
      business_id: 'b1',
      site_id: 'site',
      product_id: 'product',
      uom: 'BAG',
      quantity: 1,
      issue_date: '2026-10-17',
      evidence_reference: 'Signed',
    };
    await procurement.issueMaterialsToProject(issue, 'key', 'p1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('issue_project_materials', {
      p_payload: issue,
      p_client_key: 'key',
      p_project_id: 'p1',
    });
    const returned = {
      business_id: 'b1',
      source_issue_id: 'issue',
      quantity: 1,
      return_date: '2026-10-17',
      condition: 'usable' as const,
      reason: 'Surplus',
      evidence_reference: 'Signed',
    };
    await procurement.returnMaterialsToStore(returned, 'key', 'p1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('return_project_materials', {
      p_payload: returned,
      p_client_key: 'key',
      p_project_id: 'p1',
    });
  });
  it('adds a project_id filter to all three registers when provided', async () => {
    const procurement = new ConstructionProcurementRepository();
    for (const method of [
      'findPurchaseOrders',
      'findMaterialIssues',
      'findMaterialReturns',
    ] as const) {
      const chain = builder([]);
      mocks.from.mockReturnValue(chain);
      await procurement[method]('b1', 'p1');
      expect(chain.eq).toHaveBeenCalledWith('business_id', 'b1');
      expect(chain.eq).toHaveBeenCalledWith('project_id', 'p1');
    }
  });
});
