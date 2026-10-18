import { supabase } from '@/lib/supabase';

export const PROJECT_STATUSES = [
  'tender',
  'active',
  'practical_completion',
  'defect_liability',
  'closed',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export interface ProjectInput {
  name: string;
  client_name: string;
  contract_sum: number;
  retention_pct: number;
  budget: number;
  start_date: string | null;
  end_date: string | null;
}
export interface Project extends ProjectInput {
  id: string;
  business_id: string;
  status: ProjectStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  boq_locked_at: string | null;
}
export interface ProjectCostSummary {
  total_po_value: number;
  total_issued_value: number;
  total_returned_value: number;
  net_cost: number;
}
export interface ProjectBoqLine {
  id: string;
  project_id: string;
  line_number: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  total_value: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export interface ProjectBoqSummary {
  total_boq_value: number;
  contract_sum: number;
  variance: number;
  line_count: number;
  is_locked: boolean;
}
export type BoqLineInput = Omit<ProjectBoqLine, 'id' | 'project_id' | 'total_value' | 'created_at' | 'updated_at'> & { id: string | null; _deleted?: boolean };
export interface ProjectLocation {
  id: string;
  business_id: string;
  name: string;
  project_id: string | null;
}
export type ProjectValuationStatus = 'draft' | 'submitted' | 'invoiced';
export interface ProjectValuation {
  id: string;
  project_id: string;
  valuation_number: number;
  valuation_date: string;
  period_start: string | null;
  period_end: string | null;
  gross_amount: number;
  retention_amount: number;
  net_amount: number;
  previous_cumulative: number;
  status: ProjectValuationStatus;
  invoice_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface ProjectValuationLine {
  id: string;
  valuation_id: string;
  boq_line_id: string;
  cumulative_pct: number;
  cumulative_value: number;
  previous_cumulative_value: number;
  period_value: number;
  notes: string | null;
}
export interface ProjectInvoiceReference {
  id: string;
  invoice_number: string;
  status: string;
}
export interface ProjectRetentionEntry {
  id: string;
  project_id: string;
  valuation_id: string | null;
  type: 'withheld' | 'released';
  amount: number;
  description: string | null;
  invoice_id: string | null;
  created_by: string;
  created_at: string;
  invoice?: ProjectInvoiceReference | null;
}
export interface ProjectValuationDocument {
  valuation: ProjectValuation;
  lines: ProjectValuationLine[];
  invoice: ProjectInvoiceReference | null;
  retention_entries: ProjectRetentionEntry[];
}
export interface ProjectValuationHistory {
  valuations: ProjectValuationDocument[];
  retention_entries: ProjectRetentionEntry[];
}
export interface ProjectValuationInput {
  valuation_date: string;
  period_start: string | null;
  period_end: string | null;
  lines: Array<{
    boq_line_id: string;
    cumulative_pct: number;
    notes?: string | null;
  }>;
  notes: string | null;
}
export interface ProjectRetentionSummary {
  total_withheld: number;
  total_released: number;
  balance_held: number;
  retention_pct: number;
  can_release: boolean;
}
export interface ProjectRetentionReleaseResult {
  retention_entry: ProjectRetentionEntry;
  invoice: ProjectInvoiceReference;
}
export type ProjectDetail = Project & {
  site_count: number;
  cost: ProjectCostSummary;
};
export interface ProjectPnl {
  project_name: string;
  client_name: string;
  status: ProjectStatus;
  contract_sum: number;
  budget: number;
  retention_pct: number;
  boq_total: number;
  total_po_value?: number;
  total_issued_value?: number;
  total_returned_value?: number;
  total_costs: number;
  total_billed: number;
  total_retention_withheld: number;
  total_retention_released: number;
  retention_balance: number;
  total_paid: number;
  cost_variance: number;
  billing_pct: number;
  completion_pct: number;
  profit_margin: number;
}
export interface PortfolioSummary {
  total_projects: number;
  active_projects: number;
  total_contract_value: number;
  total_billed: number;
  total_paid: number;
  total_costs: number;
  total_retention_held: number;
  outstanding_receivables: number;
  avg_completion_pct: number;
  projects_over_budget: number;
}
export interface ProjectValuationTrendPoint {
  valuation_number: number;
  valuation_date: string;
  gross_amount: number;
  retention_amount: number;
  net_amount: number;
  cumulative_billed: number;
}
export interface RetentionAgingRow {
  project_id: string;
  project_name: string;
  client_name: string;
  project_status: ProjectStatus;
  retention_balance: number;
  oldest_retention_date: string;
  days_held: number;
}
export interface ConstructionDashboardMetrics {
  active_projects: number;
  total_contract_value: number;
  total_billed_this_period: number;
  total_paid_this_period: number;
  total_costs_this_period: number;
  total_retention_held: number;
  outstanding_receivables: number;
  projects_over_budget: number;
  avg_completion_pct: number;
}
export interface ProjectCostBreakdownRow {
  project_id: string;
  project_name: string;
  total_po_value: number;
  total_issued_value: number;
  total_returned_value: number;
  net_cost: number;
  budget: number;
  variance: number;
}
interface Result<T> {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
}
interface Query extends PromiseLike<Result<unknown[]>> {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Promise<Result<unknown>>;
}
interface Client {
  from(table: string): {
    select(columns: string, options?: { count: 'exact' }): Query;
  };
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
}
const client = supabase as unknown as Client;
function unwrap<T>(result: Result<unknown>): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
const args = (input: ProjectInput) =>
  Object.fromEntries(
    Object.entries(input).map(([key, value]) => [`p_${key}`, value]),
  );

/** Thin RPC adapter: actor/grant checks and lifecycle are server-side commands. */
export class ProjectRepository {
  async list(
    businessId: string,
    filters: { status?: ProjectStatus; page?: number } = {},
  ) {
    const page = Math.max(0, filters.page ?? 0);
    let query = client
      .from('construction_projects')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId);
    if (filters.status) query = query.eq('status', filters.status);
    const result = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * 25, page * 25 + 24);
    return { rows: unwrap<Project[]>(result) ?? [], count: result.count ?? 0 };
  }
  async getById(businessId: string, projectId: string) {
    const project = unwrap<Project | null>(
      await client
        .from('construction_projects')
        .select('*')
        .eq('business_id', businessId)
        .eq('id', projectId)
        .maybeSingle(),
    );
    if (!project) return null;
    const [locations, cost] = await Promise.all([
      this.locations(businessId),
      this.getCostSummary(projectId),
    ]);
    return {
      ...project,
      site_count: locations.filter((site) => site.project_id === projectId)
        .length,
      cost,
    };
  }
  async locations(businessId: string): Promise<ProjectLocation[]> {
    return (
      unwrap<ProjectLocation[]>(
        await client
          .from('inventory_locations')
          .select('id,business_id,name,project_id')
          .eq('business_id', businessId)
          .order('name'),
      ) ?? []
    );
  }
  async create(businessId: string, input: ProjectInput): Promise<Project> {
    return unwrap<Project>(
      await client.rpc('create_project', {
        p_business_id: businessId,
        ...args(input),
      }),
    );
  }
  async update(projectId: string, input: ProjectInput): Promise<Project> {
    return unwrap<Project>(
      await client.rpc('update_project', {
        p_project_id: projectId,
        ...args(input),
      }),
    );
  }
  async transitionStatus(
    projectId: string,
    status: ProjectStatus,
    reason: string,
  ): Promise<Project> {
    return unwrap<Project>(
      await client.rpc('transition_project_status', {
        p_project_id: projectId,
        p_new_status: status,
        p_reason: reason || null,
      }),
    );
  }
  async linkSite(
    locationId: string,
    projectId: string,
  ): Promise<ProjectLocation> {
    return unwrap<ProjectLocation>(
      await client.rpc('link_site_to_project', {
        p_location_id: locationId,
        p_project_id: projectId,
      }),
    );
  }
  async unlinkSite(locationId: string): Promise<ProjectLocation> {
    return unwrap<ProjectLocation>(
      await client.rpc('unlink_site_from_project', {
        p_location_id: locationId,
      }),
    );
  }
  async getCostSummary(projectId: string): Promise<ProjectCostSummary> {
    const rows = unwrap<ProjectCostSummary[]>(
      await client.rpc('get_project_cost_summary', { p_project_id: projectId }),
    );
    return rows[0];
  }
  async getBoqLines(projectId: string): Promise<ProjectBoqLine[]> {
    return unwrap<ProjectBoqLine[]>(await client.from('project_boq_lines').select('*').eq('project_id', projectId).order('sort_order', { ascending: true })) ?? [];
  }
  async getBoqSummary(projectId: string): Promise<ProjectBoqSummary> {
    const rows = unwrap<ProjectBoqSummary[]>(await client.rpc('get_boq_summary', { p_project_id: projectId }));
    return Array.isArray(rows) ? rows[0] : rows as ProjectBoqSummary;
  }
  async createBoqLine(projectId: string, line: Omit<BoqLineInput, 'id' | '_deleted'>): Promise<ProjectBoqLine> {
    return unwrap<ProjectBoqLine>(await client.rpc('create_boq_line', { p_project_id: projectId, p_line_number: line.line_number, p_description: line.description, p_quantity: line.quantity, p_unit: line.unit, p_rate: line.rate, p_sort_order: line.sort_order }));
  }
  async updateBoqLine(lineId: string, line: Omit<BoqLineInput, 'id' | '_deleted'>): Promise<ProjectBoqLine> {
    return unwrap<ProjectBoqLine>(await client.rpc('update_boq_line', { p_line_id: lineId, p_line_number: line.line_number, p_description: line.description, p_quantity: line.quantity, p_unit: line.unit, p_rate: line.rate, p_sort_order: line.sort_order }));
  }
  async deleteBoqLine(lineId: string): Promise<void> {
    unwrap(await client.rpc('delete_boq_line', { p_line_id: lineId }));
  }
  async reorderBoqLines(projectId: string, lineIds: string[]): Promise<ProjectBoqLine[]> {
    return unwrap<ProjectBoqLine[]>(await client.rpc('reorder_boq_lines', { p_project_id: projectId, p_line_ids: lineIds })) ?? [];
  }
  async bulkUpsertBoqLines(projectId: string, lines: BoqLineInput[]): Promise<ProjectBoqLine[]> {
    return unwrap<ProjectBoqLine[]>(await client.rpc('bulk_upsert_boq_lines', { p_project_id: projectId, p_lines: lines })) ?? [];
  }

  private async projectBusinessId(projectId: string): Promise<string> {
    const project = unwrap<{ business_id: string } | null>(
      await client.from('construction_projects').select('business_id').eq('id', projectId).maybeSingle(),
    );
    if (!project?.business_id) throw new Error('Project not found or not accessible.');
    return project.business_id;
  }

  private async valuationProjectId(valuationId: string): Promise<string> {
    const valuation = unwrap<{ project_id: string } | null>(
      await client.from('project_valuations').select('project_id').eq('id', valuationId).maybeSingle(),
    );
    if (!valuation?.project_id) throw new Error('Valuation not found or not accessible.');
    return valuation.project_id;
  }

  /** UI preflight only; every command RPC repeats the grant check server-side. */
  private async requireProjectCapabilities(projectId: string, required: string[] = []): Promise<void> {
    const businessId = await this.projectBusinessId(projectId);
    await this.requireBusinessCapabilities(businessId, required);
  }

  private async requireBusinessCapabilities(businessId: string, required: string[] = []): Promise<void> {
    const capabilities = unwrap<string[]>(
      await client.rpc('construction_procurement_capabilities_for', { p_business_id: businessId }),
    ) ?? [];
    const allowed = required.length === 0
      ? capabilities.length > 0
      : required.some((capability) => capabilities.includes(capability));
    if (!allowed) {
      throw new Error(required.length
        ? `Missing construction capability: ${required.join(' or ')}.`
        : 'Construction procurement access required.');
    }
  }

  async createValuation(projectId: string, input: ProjectValuationInput): Promise<ProjectValuationDocument> {
    await this.requireProjectCapabilities(projectId, [
      'procurement.po.manage',
      'procurement.master.manage',
    ]);
    return unwrap<ProjectValuationDocument>(await client.rpc('create_valuation', {
      p_project_id: projectId,
      p_valuation_date: input.valuation_date,
      p_period_start: input.period_start,
      p_period_end: input.period_end,
      p_lines: input.lines,
      p_notes: input.notes,
    }));
  }

  async updateValuation(valuationId: string, input: ProjectValuationInput): Promise<ProjectValuationDocument> {
    const projectId = await this.valuationProjectId(valuationId);
    await this.requireProjectCapabilities(projectId, [
      'procurement.po.manage',
      'procurement.master.manage',
    ]);
    return unwrap<ProjectValuationDocument>(await client.rpc('update_valuation', {
      p_valuation_id: valuationId,
      p_valuation_date: input.valuation_date,
      p_period_start: input.period_start,
      p_period_end: input.period_end,
      p_lines: input.lines,
      p_notes: input.notes,
    }));
  }

  async submitValuation(valuationId: string): Promise<ProjectValuationDocument> {
    const projectId = await this.valuationProjectId(valuationId);
    await this.requireProjectCapabilities(projectId, ['procurement.master.manage']);
    return unwrap<ProjectValuationDocument>(await client.rpc('submit_valuation', {
      p_valuation_id: valuationId,
    }));
  }

  async generateInvoice(valuationId: string): Promise<ProjectValuationDocument> {
    const projectId = await this.valuationProjectId(valuationId);
    await this.requireProjectCapabilities(projectId, ['procurement.master.manage']);
    return unwrap<ProjectValuationDocument>(await client.rpc('generate_invoice_from_valuation', {
      p_valuation_id: valuationId,
    }));
  }

  async releaseRetention(
    projectId: string,
    amount: number,
    description: string,
  ): Promise<ProjectRetentionReleaseResult> {
    await this.requireProjectCapabilities(projectId, ['procurement.exception.authorize']);
    return unwrap<ProjectRetentionReleaseResult>(await client.rpc('release_retention', {
      p_project_id: projectId,
      p_amount: amount,
      p_description: description,
    }));
  }

  async getValuationHistory(projectId: string): Promise<ProjectValuationHistory> {
    await this.requireProjectCapabilities(projectId);
    return unwrap<ProjectValuationHistory>(await client.rpc('get_valuation_history', {
      p_project_id: projectId,
    }));
  }

  async getRetentionSummary(projectId: string): Promise<ProjectRetentionSummary> {
    await this.requireProjectCapabilities(projectId);
    const result = unwrap<ProjectRetentionSummary | ProjectRetentionSummary[]>(
      await client.rpc('get_retention_summary', { p_project_id: projectId }),
    );
    return Array.isArray(result) ? result[0] : result as ProjectRetentionSummary;
  }

  async getProjectPnl(projectId: string): Promise<ProjectPnl> {
    await this.requireProjectCapabilities(projectId);
    const result = unwrap<ProjectPnl | ProjectPnl[]>(
      await client.rpc('get_project_pnl', { p_project_id: projectId }),
    );
    const row = Array.isArray(result) ? result[0] : (result as ProjectPnl);
    if (!row) throw new Error('Project P&L not found.');
    return {
      ...row,
      contract_sum: Number(row.contract_sum ?? 0),
      budget: Number(row.budget ?? 0),
      retention_pct: Number(row.retention_pct ?? 0),
      boq_total: Number(row.boq_total ?? 0),
      total_po_value: Number(row.total_po_value ?? 0),
      total_issued_value: Number(row.total_issued_value ?? 0),
      total_returned_value: Number(row.total_returned_value ?? 0),
      total_costs: Number(row.total_costs ?? 0),
      total_billed: Number(row.total_billed ?? 0),
      total_retention_withheld: Number(row.total_retention_withheld ?? 0),
      total_retention_released: Number(row.total_retention_released ?? 0),
      retention_balance: Number(row.retention_balance ?? 0),
      total_paid: Number(row.total_paid ?? 0),
      cost_variance: Number(row.cost_variance ?? 0),
      billing_pct: Number(row.billing_pct ?? 0),
      completion_pct: Number(row.completion_pct ?? 0),
      profit_margin: Number(row.profit_margin ?? 0),
    };
  }

  async getPortfolioSummary(businessId: string): Promise<PortfolioSummary> {
    await this.requireBusinessCapabilities(businessId);
    const result = unwrap<PortfolioSummary | PortfolioSummary[]>(
      await client.rpc('get_portfolio_summary', { p_business_id: businessId }),
    );
    const row = Array.isArray(result) ? result[0] : (result as PortfolioSummary);
    return {
      total_projects: Number(row?.total_projects ?? 0),
      active_projects: Number(row?.active_projects ?? 0),
      total_contract_value: Number(row?.total_contract_value ?? 0),
      total_billed: Number(row?.total_billed ?? 0),
      total_paid: Number(row?.total_paid ?? 0),
      total_costs: Number(row?.total_costs ?? 0),
      total_retention_held: Number(row?.total_retention_held ?? 0),
      outstanding_receivables: Number(row?.outstanding_receivables ?? 0),
      avg_completion_pct: Number(row?.avg_completion_pct ?? 0),
      projects_over_budget: Number(row?.projects_over_budget ?? 0),
    };
  }

  async getValuationTrend(projectId: string): Promise<ProjectValuationTrendPoint[]> {
    await this.requireProjectCapabilities(projectId);
    const result = unwrap<ProjectValuationTrendPoint[]>(
      await client.rpc('get_project_valuation_trend', { p_project_id: projectId }),
    );
    return (result ?? []).map((row) => ({
      ...row,
      valuation_number: Number(row.valuation_number ?? 0),
      gross_amount: Number(row.gross_amount ?? 0),
      retention_amount: Number(row.retention_amount ?? 0),
      net_amount: Number(row.net_amount ?? 0),
      cumulative_billed: Number(row.cumulative_billed ?? 0),
    }));
  }

  async getRetentionAging(businessId: string): Promise<RetentionAgingRow[]> {
    await this.requireBusinessCapabilities(businessId);
    const result = unwrap<RetentionAgingRow[]>(
      await client.rpc('get_retention_aging', { p_business_id: businessId }),
    );
    return (result ?? []).map((row) => ({
      ...row,
      retention_balance: Number(row.retention_balance ?? 0),
      days_held: Number(row.days_held ?? 0),
    }));
  }

  async getDashboardMetrics(
    businessId: string,
    months?: number | null,
  ): Promise<ConstructionDashboardMetrics> {
    await this.requireBusinessCapabilities(businessId);
    const args: Record<string, unknown> = { p_business_id: businessId };
    if (months !== undefined) {
      args.p_months = months;
    }
    const result = unwrap<ConstructionDashboardMetrics | ConstructionDashboardMetrics[]>(
      await client.rpc('get_dashboard_metrics', args),
    );
    const row = Array.isArray(result) ? result[0] : (result as ConstructionDashboardMetrics);
    return {
      active_projects: Number(row?.active_projects ?? 0),
      total_contract_value: Number(row?.total_contract_value ?? 0),
      total_billed_this_period: Number(row?.total_billed_this_period ?? 0),
      total_paid_this_period: Number(row?.total_paid_this_period ?? 0),
      total_costs_this_period: Number(row?.total_costs_this_period ?? 0),
      total_retention_held: Number(row?.total_retention_held ?? 0),
      outstanding_receivables: Number(row?.outstanding_receivables ?? 0),
      projects_over_budget: Number(row?.projects_over_budget ?? 0),
      avg_completion_pct: Number(row?.avg_completion_pct ?? 0),
    };
  }

  async getCostBreakdownByProject(businessId: string): Promise<ProjectCostBreakdownRow[]> {
    await this.requireBusinessCapabilities(businessId);
    const result = unwrap<ProjectCostBreakdownRow[]>(
      await client.rpc('get_cost_breakdown_by_project', { p_business_id: businessId }),
    );
    return (result ?? []).map((row) => ({
      ...row,
      total_po_value: Number(row.total_po_value ?? 0),
      total_issued_value: Number(row.total_issued_value ?? 0),
      total_returned_value: Number(row.total_returned_value ?? 0),
      net_cost: Number(row.net_cost ?? 0),
      budget: Number(row.budget ?? 0),
      variance: Number(row.variance ?? 0),
    }));
  }
}

export class ReportingRepository extends ProjectRepository {}

