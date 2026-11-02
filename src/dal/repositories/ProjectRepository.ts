import { supabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';

type Tables = Database['public']['Tables'];
type PublicFunctions = Database['public']['Functions'];
type BoqVersionRow = Tables['boq_versions']['Row'];
type BoqSectionRow = Tables['boq_sections']['Row'];
export type BoqItem = Tables['boq_items']['Row'];

export type BoqVersionSummary = BoqVersionRow;
export interface BoqSectionWithItems extends BoqSectionRow {
  items: BoqItem[];
  children: BoqSectionWithItems[];
  sectionTotal: number;
}
export interface BoqVersionWithTree extends BoqVersionSummary {
  sections: BoqSectionWithItems[];
}
export interface CreateBoqVersionInput {
  project_id: string;
  version_label?: string | null;
  currency?: string;
  notes?: string | null;
  clone_from_active?: boolean;
}
export interface UpdateBoqVersionInput {
  version_label?: string | null;
  currency?: string;
  notes?: string | null;
}
export interface CreateBoqSectionInput {
  boq_version_id: string;
  parent_section_id?: string | null;
  code: string;
  title: string;
  description?: string | null;
  sort_order?: number;
}
export interface UpdateBoqSectionInput {
  code?: string;
  title?: string;
  description?: string | null;
  sort_order?: number;
}
export interface CreateBoqItemInput {
  item_number: string;
  description: string;
  unit_of_measure?: string;
  quantity?: number;
  rate?: number;
  product_id?: string | null;
  cost_code?: string | null;
  is_provisional?: boolean;
  notes?: string | null;
  sort_order?: number;
}
export type UpdateBoqItemInput = Partial<CreateBoqItemInput>;

const boqClient = supabase as unknown as SupabaseClient<Database>;

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
  /**
   * P2-3: FK to contacts, preferred over client_name for billing. Null for
   * tender-stage projects whose client is not in the system yet — the
   * client_name display cache covers that case. The RPC write path treats
   * an explicit null on update as an unlink (the cache text survives).
   */
  client_id: string | null;
  contract_sum: number;
  retention_pct: number;
  budget: number;
  start_date: string | null;
  end_date: string | null;
}
/**
 * The `construction_projects` row (the live table was renamed from `projects`;
 * a compatibility view `projects` also exists). `status` is CHECK-constrained
 * `text` in the live schema, so the app-facing union is re-asserted here.
 * Structurally still satisfies `ProjectInput` (the command payload).
 */
export type Project = Omit<Tables['construction_projects']['Row'], 'status'> & {
  status: ProjectStatus;
};
export type ProjectCostSummary = PublicFunctions['get_project_cost_summary']['Returns'][number];
export type ProjectBoqLine = Pick<
  Tables['project_boq_lines']['Row'],
  | 'id'
  | 'project_id'
  | 'line_number'
  | 'description'
  | 'quantity'
  | 'unit'
  | 'rate'
  | 'total_value'
  | 'sort_order'
  | 'created_at'
  | 'updated_at'
>;
export interface ProjectBoqSummary {
  total_boq_value: number;
  contract_sum: number;
  variance: number;
  line_count: number;
  is_locked: boolean;
}
export type BoqLineInput = Omit<ProjectBoqLine, 'id' | 'project_id' | 'total_value' | 'created_at' | 'updated_at'> & { id: string | null; _deleted?: boolean };
export type ProjectLocation = Pick<Tables['inventory_locations']['Row'], 'id' | 'business_id' | 'name' | 'project_id'>;
export type ProjectValuationStatus = 'draft' | 'submitted' | 'invoiced';
export type ProjectValuation = Omit<
  Pick<
    Tables['project_valuations']['Row'],
    | 'id'
    | 'project_id'
    | 'valuation_number'
    | 'valuation_date'
    | 'period_start'
    | 'period_end'
    | 'gross_amount'
    | 'retention_amount'
    | 'net_amount'
    | 'previous_cumulative'
    | 'status'
    | 'invoice_id'
    | 'notes'
    | 'created_by'
    | 'created_at'
    | 'updated_at'
  >,
  'status'
> & { status: ProjectValuationStatus };
export type ProjectValuationLine = Pick<
  Tables['project_valuation_lines']['Row'],
  | 'id'
  | 'valuation_id'
  | 'boq_line_id'
  | 'cumulative_pct'
  | 'cumulative_value'
  | 'previous_cumulative_value'
  | 'period_value'
  | 'notes'
>;
export type ProjectInvoiceReference = Pick<Tables['invoices']['Row'], 'id' | 'invoice_number' | 'status'>;
/**
 * A `project_retention_ledger` row; `invoice` is the optional join the
 * valuation-history RPC attaches (extra field — not a pure table mirror).
 * `type` is CHECK-constrained text in the live schema.
 */
export type ProjectRetentionEntry = Omit<
  Pick<
    Tables['project_retention_ledger']['Row'],
    | 'id'
    | 'project_id'
    | 'valuation_id'
    | 'type'
    | 'amount'
    | 'description'
    | 'invoice_id'
    | 'created_by'
    | 'created_at'
  >,
  'type'
> & {
  type: 'withheld' | 'released';
  invoice?: ProjectInvoiceReference | null;
};
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
export type ProjectRetentionSummary = PublicFunctions['get_retention_summary']['Returns'][number];
export interface ProjectRetentionReleaseResult {
  retention_entry: ProjectRetentionEntry;
  invoice: ProjectInvoiceReference;
}
export type ProjectDetail = Project & {
  site_count: number;
  cost: ProjectCostSummary;
};
export type ProjectPnl = Omit<
  PublicFunctions['get_project_pnl']['Returns'][number],
  'status'
> & { status: ProjectStatus };
export type PortfolioSummary = PublicFunctions['get_portfolio_summary']['Returns'][number];
export type ProjectValuationTrendPoint = PublicFunctions['get_project_valuation_trend']['Returns'][number];
export type RetentionAgingRow = Omit<
  PublicFunctions['get_retention_aging']['Returns'][number],
  'project_status'
> & { project_status: ProjectStatus };
/**
 * `get_dashboard_metrics` has two overloads in the live schema; the generated
 * surface renders them as a union whose `Returns` elements are identical, so
 * the indexed access below collapses to that single row shape.
 */
export type ConstructionDashboardMetrics =
  PublicFunctions['get_dashboard_metrics']['Returns'][number];
export type ProjectCostBreakdownRow = PublicFunctions['get_cost_breakdown_by_project']['Returns'][number];
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
  /**
   * P2-3: resolve the project's billing contact the same way valuation
   * invoicing does server-side — client_id FK first, frozen name bridge as
   * fallback (which also backfills the FK on success). Exposed for client
   * preflight/diagnostics; the invoice path itself calls it inside
   * generate_invoice_from_valuation.
   */
  async resolveClient(projectId: string): Promise<string | null> {
    return (
      unwrap<string | null>(
        await client.rpc('_ledgr_resolve_construction_client', {
          p_project_id: projectId,
        }),
      ) ?? null
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

  // Versioned construction BOQ operations. These tables are separate from
  // manufacturing BOMs; the database triggers enforce project scope, draft
  // immutability, totals, actor capabilities, and activation compatibility.
  async listBoqVersions(businessId: string, projectId: string): Promise<BoqVersionSummary[]> {
    const { data, error } = await boqClient.from('boq_versions').select('*')
      .eq('business_id', businessId).eq('project_id', projectId)
      .order('version_number', { ascending: false });
    if (error) throw new Error('construction.boq.errors.loadFailed');
    return data ?? [];
  }

  async getBoqVersion(businessId: string, versionId: string): Promise<BoqVersionWithTree> {
    const { data: version, error: versionError } = await boqClient.from('boq_versions').select('*')
      .eq('business_id', businessId).eq('id', versionId).maybeSingle();
    if (versionError) throw new Error('construction.boq.errors.loadFailed');
    if (!version) throw new Error('construction.boq.errors.versionNotFound');
    const [sectionResult, itemResult] = await Promise.all([
      boqClient.from('boq_sections').select('*').eq('business_id', businessId)
        .eq('boq_version_id', versionId).order('sort_order').order('code'),
      boqClient.from('boq_items').select('*').eq('business_id', businessId)
        .eq('boq_version_id', versionId).order('sort_order').order('item_number'),
    ]);
    if (sectionResult.error || itemResult.error) throw new Error('construction.boq.errors.loadFailed');

    const nodes = new Map<string, BoqSectionWithItems>();
    for (const section of sectionResult.data ?? []) {
      nodes.set(section.id, { ...section, items: [], children: [], sectionTotal: 0 });
    }
    for (const item of itemResult.data ?? []) {
      nodes.get(item.section_id)?.items.push(item);
    }
    const roots: BoqSectionWithItems[] = [];
    for (const section of nodes.values()) {
      if (section.parent_section_id) nodes.get(section.parent_section_id)?.children.push(section);
      else roots.push(section);
    }
    const orderTree = (sections: BoqSectionWithItems[]): number => {
      sections.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
      let total = 0;
      for (const section of sections) {
        section.items.sort((a, b) => a.sort_order - b.sort_order || a.item_number.localeCompare(b.item_number));
        const childTotal = orderTree(section.children);
        section.sectionTotal = section.items.reduce((sum, item) => sum + Number(item.amount), 0) + childTotal;
        total += section.sectionTotal;
      }
      return total;
    };
    orderTree(roots);
    return { ...version, sections: roots };
  }

  async createBoqVersion(businessId: string, input: CreateBoqVersionInput): Promise<string> {
    const { data: latest, error: latestError } = await boqClient.from('boq_versions')
      .select('version_number').eq('business_id', businessId).eq('project_id', input.project_id)
      .order('version_number', { ascending: false }).limit(1).maybeSingle();
    if (latestError) throw new Error('construction.boq.errors.saveFailed');
    const versionNumber = (latest?.version_number ?? 0) + 1;
    const { data: created, error } = await boqClient.from('boq_versions').insert({
      business_id: businessId,
      project_id: input.project_id,
      version_number: versionNumber,
      version_label: input.version_label?.trim() || null,
      currency: input.currency || 'MWK',
      notes: input.notes?.trim() || null,
      status: 'draft',
    }).select('id').single();
    if (error) throw new Error('construction.boq.errors.saveFailed');
    const versionId = created.id;
    if (!input.clone_from_active) return versionId;

    try {
      const versions = await this.listBoqVersions(businessId, input.project_id);
      const active = versions.find((version) => version.status === 'active');
      if (!active) return versionId;
      const source = await this.getBoqVersion(businessId, active.id);
      const orderedSections: BoqSectionWithItems[] = [];
      const visit = (sections: BoqSectionWithItems[]) => {
        for (const section of sections) { orderedSections.push(section); visit(section.children); }
      };
      visit(source.sections);
      const sectionIds = new Map<string, string>();
      for (const section of orderedSections) {
        const { data: clonedSection, error: sectionError } = await boqClient.from('boq_sections').insert({
          boq_version_id: versionId,
          business_id: businessId,
          parent_section_id: section.parent_section_id ? sectionIds.get(section.parent_section_id) ?? null : null,
          code: section.code,
          title: section.title,
          description: section.description,
          sort_order: section.sort_order,
        }).select('id').single();
        if (sectionError) throw new Error('construction.boq.errors.cloneFailed');
        sectionIds.set(section.id, clonedSection.id);
      }
      const clonedItems = orderedSections.flatMap((section) => section.items.map((item) => ({
        boq_version_id: versionId,
        business_id: businessId,
        section_id: sectionIds.get(section.id)!,
        item_number: item.item_number,
        description: item.description,
        unit_of_measure: item.unit_of_measure,
        quantity: item.quantity,
        rate: item.rate,
        product_id: item.product_id,
        cost_code: item.cost_code,
        is_provisional: item.is_provisional,
        notes: item.notes,
        sort_order: item.sort_order,
      })));
      if (clonedItems.length) {
        const { error: itemError } = await boqClient.from('boq_items').insert(clonedItems);
        if (itemError) throw new Error('construction.boq.errors.cloneFailed');
      }
      return versionId;
    } catch (error) {
      await boqClient.from('boq_versions').delete().eq('business_id', businessId).eq('id', versionId);
      throw error;
    }
  }

  async updateBoqVersion(businessId: string, versionId: string, input: UpdateBoqVersionInput): Promise<void> {
    const payload: UpdateBoqVersionInput = { ...input };
    if (input.version_label !== undefined) payload.version_label = input.version_label?.trim() || null;
    if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
    const { data, error } = await boqClient.from('boq_versions').update(payload)
      .eq('business_id', businessId).eq('id', versionId).eq('status', 'draft').select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.saveFailed');
    if (!data) throw new Error('construction.boq.errors.draftOnly');
  }

  async deleteBoqVersion(businessId: string, versionId: string): Promise<void> {
    const { data, error } = await boqClient.from('boq_versions').delete()
      .eq('business_id', businessId).eq('id', versionId).eq('status', 'draft').select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.deleteFailed');
    if (!data) throw new Error('construction.boq.errors.draftOnly');
  }

  async activateBoqVersion(businessId: string, versionId: string): Promise<void> {
    const { data, error } = await boqClient.from('boq_versions').update({ status: 'active' })
      .eq('business_id', businessId).eq('id', versionId).eq('status', 'draft')
      .select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.activateFailed');
    if (!data) throw new Error('construction.boq.errors.draftOnly');
  }

  async createSection(businessId: string, input: CreateBoqSectionInput): Promise<string> {
    const { data, error } = await boqClient.from('boq_sections').insert({
      business_id: businessId,
      boq_version_id: input.boq_version_id,
      parent_section_id: input.parent_section_id ?? null,
      code: input.code.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      sort_order: input.sort_order ?? 0,
    }).select('id').single();
    if (error) throw new Error('construction.boq.errors.saveFailed');
    return data.id;
  }

  async updateSection(businessId: string, sectionId: string, input: UpdateBoqSectionInput): Promise<void> {
    const payload: UpdateBoqSectionInput = { ...input };
    if (input.code !== undefined) payload.code = input.code.trim();
    if (input.title !== undefined) payload.title = input.title.trim();
    if (input.description !== undefined) payload.description = input.description?.trim() || null;
    const { data, error } = await boqClient.from('boq_sections').update(payload)
      .eq('business_id', businessId).eq('id', sectionId).select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.saveFailed');
    if (!data) throw new Error('construction.boq.errors.sectionNotFound');
  }

  async deleteSection(businessId: string, sectionId: string): Promise<void> {
    const { data, error } = await boqClient.from('boq_sections').delete()
      .eq('business_id', businessId).eq('id', sectionId).select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.deleteFailed');
    if (!data) throw new Error('construction.boq.errors.sectionNotFound');
  }

  async reorderSections(businessId: string, versionId: string, sectionIds: string[]): Promise<void> {
    const { data: current, error } = await boqClient.from('boq_sections').select('id')
      .eq('business_id', businessId).eq('boq_version_id', versionId);
    if (error) throw new Error('construction.boq.errors.saveFailed');
    const expected = new Set((current ?? []).map((section) => section.id));
    if (new Set(sectionIds).size !== sectionIds.length || expected.size !== sectionIds.length || sectionIds.some((id) => !expected.has(id))) {
      throw new Error('construction.boq.errors.reorderMismatch');
    }
    for (const [sortOrder, sectionId] of sectionIds.entries()) {
      const { error: updateError } = await boqClient.from('boq_sections').update({ sort_order: sortOrder })
        .eq('business_id', businessId).eq('boq_version_id', versionId).eq('id', sectionId);
      if (updateError) throw new Error('construction.boq.errors.saveFailed');
    }
  }

  async reorderItems(businessId: string, versionId: string, sectionId: string, itemIds: string[]): Promise<void> {
    const { data: current, error } = await boqClient.from('boq_items').select('id')
      .eq('business_id', businessId).eq('boq_version_id', versionId).eq('section_id', sectionId);
    if (error) throw new Error('construction.boq.errors.saveFailed');
    const expected = new Set((current ?? []).map((item) => item.id));
    if (new Set(itemIds).size !== itemIds.length || expected.size !== itemIds.length || itemIds.some((id) => !expected.has(id))) {
      throw new Error('construction.boq.errors.reorderMismatch');
    }
    for (const [sortOrder, itemId] of itemIds.entries()) {
      const { error: updateError } = await boqClient.from('boq_items').update({ sort_order: sortOrder })
        .eq('business_id', businessId).eq('boq_version_id', versionId).eq('section_id', sectionId).eq('id', itemId);
      if (updateError) throw new Error('construction.boq.errors.saveFailed');
    }
  }

  async createItem(businessId: string, versionId: string, sectionId: string, input: CreateBoqItemInput): Promise<string> {
    const { data, error } = await boqClient.from('boq_items').insert({
      ...input,
      business_id: businessId,
      boq_version_id: versionId,
      section_id: sectionId,
      item_number: input.item_number.trim(),
      description: input.description.trim(),
    }).select('id').single();
    if (error) throw new Error('construction.boq.errors.saveFailed');
    return data.id;
  }

  async updateItem(businessId: string, itemId: string, input: UpdateBoqItemInput): Promise<void> {
    const payload = { ...input, item_number: input.item_number?.trim(), description: input.description?.trim() };
    const { data, error } = await boqClient.from('boq_items').update(payload)
      .eq('business_id', businessId).eq('id', itemId).select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.saveFailed');
    if (!data) throw new Error('construction.boq.errors.itemNotFound');
  }

  async deleteItem(businessId: string, itemId: string): Promise<void> {
    const { data, error } = await boqClient.from('boq_items').delete()
      .eq('business_id', businessId).eq('id', itemId).select('id').maybeSingle();
    if (error) throw new Error('construction.boq.errors.deleteFailed');
    if (!data) throw new Error('construction.boq.errors.itemNotFound');
  }

  async bulkImportItems(businessId: string, versionId: string, sectionId: string, items: CreateBoqItemInput[]): Promise<number> {
    if (!items.length) return 0;
    const rows = items.map((item) => ({
      ...item,
      business_id: businessId,
      boq_version_id: versionId,
      section_id: sectionId,
      item_number: item.item_number.trim(),
      description: item.description.trim(),
    }));
    const { data, error } = await boqClient.from('boq_items').insert(rows).select('id');
    if (error) throw new Error('construction.boq.errors.importFailed');
    return data?.length ?? 0;
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
