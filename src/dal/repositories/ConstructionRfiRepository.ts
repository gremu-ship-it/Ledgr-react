import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import type { Json } from '../types/database.generated';
import { DatabaseError, NotFoundError, toRepositoryError } from '../errors/RepositoryError';

export type ConstructionRfiRow = Database['public']['Tables']['construction_rfis']['Row'];
export type ConstructionRfiStatus = 'draft' | 'open' | 'submitted' | 'answered' | 'closed' | 'cancelled';
export type ConstructionRfiPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CreateConstructionRfiInput {
  business_id: string;
  project_id: string;
  site_id?: string | null;
  rfi_number: string;
  title: string;
  question: string;
  priority?: ConstructionRfiPriority;
  due_date?: string | null;
  /** Evidence reference or notes stored as text; this is not a Storage path. */
  evidence?: string | null;
  proposed_solution?: string | null;
  boq_item_id?: string | null;
  subcontract_id?: string | null;
  drawing_reference?: string | null;
}

export interface UpdateConstructionRfiInput {
  title?: string;
  question?: string;
  priority?: ConstructionRfiPriority;
  due_date?: string | null;
  /** Evidence reference or notes stored as text; this is not a Storage path. */
  evidence?: string | null;
  proposed_solution?: string | null;
  boq_item_id?: string | null;
  subcontract_id?: string | null;
  drawing_reference?: string | null;
}

/**
 * Construction RFI persistence. Reads use the membership-scoped RLS policy;
 * every mutation goes through a server-authorized command RPC (never direct
 * authenticated DML against construction_rfis).
 */
export class ConstructionRfiRepository {
  private readonly resource = 'construction_rfis';

  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listByBusiness(businessId: string): Promise<ConstructionRfiRow[]> {
    const { data, error } = await this.client
      .from('construction_rfis')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw toRepositoryError(this.resource, error);
    return data ?? [];
  }

  async listByProject(projectId: string): Promise<ConstructionRfiRow[]> {
    const { data, error } = await this.client
      .from('construction_rfis')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw toRepositoryError(this.resource, error);
    return data ?? [];
  }

  async getById(rfiId: string): Promise<ConstructionRfiRow> {
    const { data, error } = await this.client
      .from('construction_rfis')
      .select('*')
      .eq('id', rfiId)
      .maybeSingle();

    if (error) throw toRepositoryError(this.resource, error);
    if (!data) throw new NotFoundError(this.resource, rfiId);
    return data;
  }

  async getOverdue(projectId: string, asOf = new Date()): Promise<ConstructionRfiRow[]> {
    const asOfDate = asOf.toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('construction_rfis')
      .select('*')
      .eq('project_id', projectId)
      .lt('due_date', asOfDate)
      .in('status', ['open', 'submitted', 'answered'])
      .order('due_date', { ascending: true });

    if (error) throw toRepositoryError(this.resource, error);
    return data ?? [];
  }

  async create(input: CreateConstructionRfiInput): Promise<ConstructionRfiRow> {
    const { data, error } = await this.client.rpc('create_construction_rfi', {
      p_business_id: input.business_id,
      p_project_id: input.project_id,
      p_site_id: input.site_id ?? null,
      p_rfi_number: input.rfi_number,
      p_title: input.title,
      p_question: input.question,
      p_priority: input.priority ?? 'normal',
      p_due_date: input.due_date ?? null,
      p_evidence: input.evidence ?? null,
      p_proposed_solution: input.proposed_solution ?? null,
      p_boq_item_id: input.boq_item_id ?? null,
      p_subcontract_id: input.subcontract_id ?? null,
      p_drawing_reference: input.drawing_reference ?? null,
    });

    if (error) throw toRepositoryError(this.resource, error);
    if (!data) throw new DatabaseError(this.resource, 'The create command returned no RFI.');
    return data;
  }

  async update(rfiId: string, changes: UpdateConstructionRfiInput): Promise<ConstructionRfiRow> {
    const { data, error } = await this.client.rpc('update_construction_rfi', {
      p_rfi_id: rfiId,
      p_payload: { ...changes } as Json,
    });

    if (error) throw toRepositoryError(this.resource, error);
    if (!data) throw new NotFoundError(this.resource, rfiId);
    return data;
  }

  async transitionStatus(
    rfiId: string,
    status: ConstructionRfiStatus,
    response?: string | null,
  ): Promise<ConstructionRfiRow> {
    const { data, error } = await this.client.rpc('transition_construction_rfi', {
      p_rfi_id: rfiId,
      p_new_status: status,
      p_response: response ?? null,
    });

    if (error) throw toRepositoryError(this.resource, error);
    if (!data) throw new NotFoundError(this.resource, rfiId);
    return data;
  }

  /** @deprecated Prefer transitionStatus for the command-oriented API name. */
  async transition(
    rfiId: string,
    status: ConstructionRfiStatus,
    response?: string | null,
  ): Promise<ConstructionRfiRow> {
    return this.transitionStatus(rfiId, status, response);
  }

  async deleteDraft(rfiId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('delete_construction_rfi', {
      p_rfi_id: rfiId,
    });

    if (error) throw toRepositoryError(this.resource, error);
    return data === true;
  }
}
