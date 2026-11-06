import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { DatabaseError, NotFoundError, UnauthorizedError, ValidationError, toRepositoryError } from '../errors/RepositoryError';

export type ConstructionChangeOrderRow = Database['public']['Tables']['construction_change_orders']['Row'];
export type ConstructionChangeOrderStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface CreateConstructionChangeOrderInput {
  project_id: string;
  site_id?: string | null;
  co_number: string;
  title: string;
  description: string;
  reason: string;
  cost_impact?: number;
  time_impact_days?: number;
  boq_section_id?: string | null;
  subcontract_id?: string | null;
  evidence_reference?: string | null;
}

export interface UpdateConstructionChangeOrderInput {
  project_id?: string;
  site_id?: string | null;
  co_number?: string;
  title?: string;
  description?: string;
  reason?: string;
  cost_impact?: number;
  time_impact_days?: number;
  boq_section_id?: string | null;
  subcontract_id?: string | null;
  evidence_reference?: string | null;
}

export interface ConstructionChangeOrderListFilters {
  projectId?: string;
  status?: ConstructionChangeOrderStatus;
}

export interface ConstructionChangeOrderStatusSummary {
  count: number;
  cost_impact: number;
  time_impact_days: number;
}

export interface ConstructionChangeOrderProjectSummary {
  project_id: string;
  by_status: Record<ConstructionChangeOrderStatus, ConstructionChangeOrderStatusSummary>;
  total_count: number;
  total_cost_impact: number;
  total_time_impact_days: number;
}

const STATUSES: ConstructionChangeOrderStatus[] = ['draft', 'submitted', 'approved', 'rejected', 'cancelled'];
const RESOURCE = 'construction_change_orders';

/** Tenant-scoped persistence for construction change orders. */
export class ConstructionChangeOrderRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async list(
    businessId: string,
    filters: ConstructionChangeOrderListFilters = {},
  ): Promise<ConstructionChangeOrderRow[]> {
    let query = this.client.from('construction_change_orders')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw toRepositoryError(RESOURCE, error);
    return data ?? [];
  }

  /** Small dashboard projection for change orders awaiting approval. */
  async listSubmittedForApproval(
    businessId: string,
    limit = 5,
  ): Promise<Pick<ConstructionChangeOrderRow, 'id' | 'co_number' | 'title'>[]> {
    const { data, error } = await this.client.from('construction_change_orders')
      .select('id, co_number, title')
      .eq('business_id', businessId)
      .eq('status', 'submitted')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw toRepositoryError(RESOURCE, error);
    return data ?? [];
  }

  async getById(businessId: string, coId: string): Promise<ConstructionChangeOrderRow> {
    const { data, error } = await this.client.from('construction_change_orders')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', coId)
      .maybeSingle();
    if (error) throw toRepositoryError(RESOURCE, error);
    if (!data) throw new NotFoundError(RESOURCE, coId);
    return data;
  }

  async create(
    businessId: string,
    input: CreateConstructionChangeOrderInput,
  ): Promise<ConstructionChangeOrderRow> {
    const { data: authData, error: authError } = await this.client.auth.getUser();
    if (authError) throw toRepositoryError(RESOURCE, authError);
    if (!authData.user) throw new UnauthorizedError(RESOURCE, 'An authenticated user is required to create a change order.');

    const { data, error } = await this.client.from('construction_change_orders')
      .insert({
        ...input,
        business_id: businessId,
        created_by: authData.user.id,
      })
      .select('*')
      .single();
    if (error) throw toRepositoryError(RESOURCE, error);
    return data;
  }

  async update(
    businessId: string,
    coId: string,
    updates: UpdateConstructionChangeOrderInput,
  ): Promise<ConstructionChangeOrderRow> {
    const { data, error } = await this.client.from('construction_change_orders')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', coId)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(RESOURCE, error);
    if (data) return data;

    const current = await this.getById(businessId, coId);
    if (current.status !== 'draft') {
      throw new ValidationError(RESOURCE, 'Only draft change orders can be edited.');
    }
    throw new DatabaseError(RESOURCE, 'The draft changed while it was being updated. Refresh and try again.');
  }

  async transitionStatus(
    coId: string,
    newStatus: ConstructionChangeOrderStatus,
    rejectionReason?: string | null,
  ): Promise<void> {
    const { error } = await this.client.rpc('transition_construction_co', {
      p_co_id: coId,
      p_new_status: newStatus,
      p_rejection_reason: rejectionReason ?? null,
    });
    if (error) throw toRepositoryError(RESOURCE, error);
  }

  async getProjectSummary(
    businessId: string,
    projectId: string,
  ): Promise<ConstructionChangeOrderProjectSummary> {
    const { data, error } = await this.client.from('construction_change_orders')
      .select('status, cost_impact, time_impact_days')
      .eq('business_id', businessId)
      .eq('project_id', projectId);
    if (error) throw toRepositoryError(RESOURCE, error);

    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, {
      count: 0,
      cost_impact: 0,
      time_impact_days: 0,
    }])) as Record<ConstructionChangeOrderStatus, ConstructionChangeOrderStatusSummary>;
    let totalCostImpact = 0;
    let totalTimeImpactDays = 0;
    let totalCount = 0;

    for (const row of data ?? []) {
      const status = row.status as ConstructionChangeOrderStatus;
      if (!STATUSES.includes(status)) continue;
      const costImpact = Number(row.cost_impact ?? 0);
      const timeImpactDays = Number(row.time_impact_days ?? 0);
      byStatus[status].count += 1;
      byStatus[status].cost_impact += costImpact;
      byStatus[status].time_impact_days += timeImpactDays;
      totalCount += 1;
      totalCostImpact += costImpact;
      totalTimeImpactDays += timeImpactDays;
    }

    return {
      project_id: projectId,
      by_status: byStatus,
      total_count: totalCount,
      total_cost_impact: totalCostImpact,
      total_time_impact_days: totalTimeImpactDays,
    };
  }
}
