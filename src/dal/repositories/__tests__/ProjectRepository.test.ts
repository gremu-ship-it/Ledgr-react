import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: mocks }));
import { ProjectRepository, ReportingRepository } from '../ProjectRepository';
import { ConstructionProcurementRepository } from '../ConstructionProcurementRepository';
const repository = new ProjectRepository();
const input = {
  name: 'Hospital',
  client_name: 'Client',
  client_id: null,
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
      p_client_id: null,
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
  it('carries the client link through the RPC write path and resolves clients (P2-3)', async () => {
    await repository.create('b1', { ...input, client_id: 'c1' });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'create_project',
      expect.objectContaining({
        p_business_id: 'b1',
        p_client_id: 'c1',
        p_client_name: 'Client',
      }),
    );
    // An explicit null is the unlink intent — forwarded, never omitted, so
    // the RPC can distinguish "unlink" from "legacy caller" by presence.
    await repository.update('p1', { ...input, client_id: null });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'update_project',
      expect.objectContaining({ p_project_id: 'p1', p_client_id: null }),
    );
    mocks.rpc.mockResolvedValueOnce({ data: 'contact-9', error: null });
    await expect(repository.resolveClient('p1')).resolves.toBe('contact-9');
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      '_ledgr_resolve_construction_client',
      { p_project_id: 'p1' },
    );
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(repository.resolveClient('p1')).resolves.toBeNull();
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
    expect(mocks.from).toHaveBeenCalledWith('construction_projects');
    expect(chain.eq).toHaveBeenCalledWith('business_id', 'b1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(chain.range).toHaveBeenCalledWith(25, 49);
  });
  it('scopes detail to business before loading site count and cost RPC', async () => {
    const project = { id: 'p1', business_id: 'b1' };
    mocks.from.mockImplementation((table: string) =>
      builder(
        table === 'construction_projects'
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
  it('checks caller capabilities before creating a valuation and maps cumulative inputs to the RPC', async () => {
    mocks.from.mockReturnValue(builder({ business_id: 'b1' }));
    mocks.rpc.mockImplementation((fn: string) => Promise.resolve({
      data: fn === 'construction_procurement_capabilities_for'
        ? ['procurement.po.manage']
        : { valuation: { id: 'v1', status: 'draft' }, lines: [], invoice: null, retention_entries: [] },
      error: null,
    }));
    const input = {
      valuation_date: '2026-10-17',
      period_start: '2026-10-01',
      period_end: '2026-10-17',
      lines: [{ boq_line_id: 'boq1', cumulative_pct: 35, notes: null }],
      notes: 'Measurement correction',
    };
    await repository.createValuation('p1', input);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'construction_procurement_capabilities_for', { p_business_id: 'b1' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'create_valuation', {
      p_project_id: 'p1',
      p_valuation_date: input.valuation_date,
      p_period_start: input.period_start,
      p_period_end: input.period_end,
      p_lines: input.lines,
      p_notes: input.notes,
    });
  });
  it('uses valuation/project lookups for draft update, submit and invoice commands', async () => {
    mocks.from.mockImplementation((table: string) => builder(
      table === 'project_valuations' ? { project_id: 'p1' } : { business_id: 'b1' },
    ));
    mocks.rpc.mockImplementation((fn: string) => Promise.resolve({
      data: fn === 'construction_procurement_capabilities_for'
        ? ['procurement.master.manage']
        : { valuation: { id: 'v1', status: 'submitted' }, lines: [], invoice: null, retention_entries: [] },
      error: null,
    }));
    const draft = { valuation_date: '2026-10-17', period_start: null, period_end: null, lines: [], notes: null };
    await repository.updateValuation('v1', draft);
    expect(mocks.rpc).toHaveBeenLastCalledWith('update_valuation', {
      p_valuation_id: 'v1', p_valuation_date: draft.valuation_date,
      p_period_start: null, p_period_end: null, p_lines: [], p_notes: null,
    });
    await repository.submitValuation('v1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_valuation', { p_valuation_id: 'v1' });
    await repository.generateInvoice('v1');
    expect(mocks.rpc).toHaveBeenLastCalledWith('generate_invoice_from_valuation', { p_valuation_id: 'v1' });
  });
  it('requires the retention-authorize capability before an invoice-backed release', async () => {
    mocks.from.mockImplementation((table: string) => builder(
      table === 'project_valuations' ? { project_id: 'p1' } : { business_id: 'b1' },
    ));
    mocks.rpc.mockImplementation((fn: string) => Promise.resolve({
      data: fn === 'construction_procurement_capabilities_for' ? ['procurement.po.manage'] : null,
      error: null,
    }));
    await expect(repository.releaseRetention('p1', 25, 'Practical completion'))
      .rejects.toThrow('Missing construction capability');
    expect(mocks.rpc).not.toHaveBeenCalledWith('release_retention', expect.anything());
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

describe('Phase D reporting RPC methods', () => {
  const repo = new ProjectRepository();
  const reportingRepo = new ReportingRepository();

  beforeEach(() => {
    mocks.from.mockReturnValue(builder({ business_id: 'b1' }));
  });

  it('calls get_project_pnl and normalizes numeric fields', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: ['procurement.view'], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            project_id: 'p1',
            project_name: 'Bridge Rehab',
            client_name: 'Roads Authority',
            status: 'active',
            contract_sum: '100000',
            budget: '80000',
            retention_pct: '10',
            boq_total: '95000',
            total_po_value: '20000',
            total_issued_value: '35000',
            total_returned_value: '5000',
            total_costs: '50000',
            total_billed: '60000',
            total_retention_withheld: '6000',
            total_retention_released: '1000',
            retention_balance: '5000',
            total_paid: '45000',
            cost_variance: '30000',
            billing_pct: '60',
            completion_pct: '62.5',
            profit_margin: '16.67',
          },
        ],
        error: null,
      });
    const pnl = await repo.getProjectPnl('p1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_project_pnl', {
      p_project_id: 'p1',
    });
    expect(pnl).toEqual({
      project_id: 'p1',
      project_name: 'Bridge Rehab',
      client_name: 'Roads Authority',
      status: 'active',
      contract_sum: 100000,
      budget: 80000,
      retention_pct: 10,
      boq_total: 95000,
      total_po_value: 20000,
      total_issued_value: 35000,
      total_returned_value: 5000,
      total_costs: 50000,
      total_billed: 60000,
      total_retention_withheld: 6000,
      total_retention_released: 1000,
      retention_balance: 5000,
      total_paid: 45000,
      cost_variance: 30000,
      billing_pct: 60,
      completion_pct: 62.5,
      profit_margin: 16.67,
    });
  });

  it('calls get_portfolio_summary after checking procurement capabilities', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: ['procurement.view'], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            total_projects: 4,
            active_projects: 2,
            total_contract_value: '500000',
            total_billed: '200000',
            total_paid: '150000',
            total_costs: '120000',
            total_retention_held: '20000',
            outstanding_receivables: '30000',
            avg_completion_pct: '45.5',
            projects_over_budget: 1,
          },
        ],
        error: null,
      });
    const summary = await reportingRepo.getPortfolioSummary('b1');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'construction_procurement_capabilities_for',
      { p_business_id: 'b1' },
    );
    expect(mocks.rpc).toHaveBeenCalledWith('get_portfolio_summary', {
      p_business_id: 'b1',
    });
    expect(summary.total_projects).toBe(4);
    expect(summary.total_contract_value).toBe(500000);
    expect(summary.avg_completion_pct).toBe(45.5);
  });

  it('calls get_project_valuation_trend and returns ordered trend points', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: ['procurement.view'], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            valuation_number: 1,
            valuation_date: '2026-09-01',
            gross_amount: '10000',
            retention_amount: '1000',
            net_amount: '9000',
            cumulative_billed: '10000',
          },
          {
            valuation_number: 2,
            valuation_date: '2026-10-01',
            gross_amount: '15000',
            retention_amount: '1500',
            net_amount: '13500',
            cumulative_billed: '25000',
          },
        ],
        error: null,
      });
    const trend = await repo.getValuationTrend('p1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_project_valuation_trend', {
      p_project_id: 'p1',
    });
    expect(trend).toHaveLength(2);
    expect(trend[1].cumulative_billed).toBe(25000);
  });

  it('calls get_retention_aging, get_dashboard_metrics, and get_cost_breakdown_by_project', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: ['procurement.view'], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            project_id: 'p1',
            project_name: 'Bridge Rehab',
            client_name: 'Client A',
            project_status: 'active',
            retention_balance: '5000',
            oldest_retention_date: '2025-09-01',
            days_held: 411,
          },
        ],
        error: null,
      });
    const aging = await repo.getRetentionAging('b1');
    expect(aging[0].days_held).toBe(411);
    expect(aging[0].retention_balance).toBe(5000);

    mocks.rpc
      .mockResolvedValueOnce({ data: ['procurement.view'], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            active_projects: 2,
            total_contract_value: '250000',
            total_billed_this_period: '100000',
            total_paid_this_period: '75000',
            total_costs_this_period: '60000',
            total_retention_held: '10000',
            outstanding_receivables: '15000',
            projects_over_budget: 0,
            avg_completion_pct: '50',
          },
        ],
        error: null,
      });
    const metrics = await repo.getDashboardMetrics('b1', 6);
    expect(mocks.rpc).toHaveBeenCalledWith('get_dashboard_metrics', {
      p_business_id: 'b1',
      p_months: 6,
    });
    expect(metrics.total_billed_this_period).toBe(100000);

    mocks.rpc
      .mockResolvedValueOnce({ data: ['procurement.view'], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            project_id: 'p1',
            project_name: 'Bridge Rehab',
            total_po_value: '20000',
            total_issued_value: '35000',
            total_returned_value: '5000',
            net_cost: '50000',
            budget: '80000',
            variance: '30000',
          },
        ],
        error: null,
      });
    const costs = await repo.getCostBreakdownByProject('b1');
    expect(costs[0].net_cost).toBe(50000);
    expect(costs[0].variance).toBe(30000);
  });

  it('rejects business reporting calls when caller has no procurement.* capabilities', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(repo.getPortfolioSummary('b1')).rejects.toThrow(
      /Construction procurement access required/,
    );
  });
});
