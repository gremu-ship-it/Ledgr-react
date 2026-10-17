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
      .from('projects')
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
        .from('projects')
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
}
