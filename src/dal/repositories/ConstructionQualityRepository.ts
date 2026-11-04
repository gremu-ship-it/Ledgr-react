import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { NotFoundError, UnauthorizedError, toRepositoryError } from '../errors/RepositoryError';

type Tables = Database['public']['Tables'];

export type ConstructionItpStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type ConstructionItpCheckpointStatus = 'pending' | 'passed' | 'failed' | 'waived';
export type ConstructionItpHoldType = 'hold' | 'witness' | 'review' | 'surveillance';
export type ConstructionNcrStatus = 'open' | 'investigating' | 'corrective_action' | 'closed' | 'cancelled';
export type ConstructionNcrSeverity = 'minor' | 'major' | 'critical';

export type ConstructionItpRow = Omit<Tables['construction_itps']['Row'], 'status'> & {
  status: ConstructionItpStatus;
};
export type ConstructionItpCheckpointRow = Omit<Tables['construction_itp_checkpoints']['Row'], 'status' | 'hold_type'> & {
  status: ConstructionItpCheckpointStatus;
  hold_type: ConstructionItpHoldType;
};
export type ConstructionNcrRow = Omit<Tables['construction_ncrs']['Row'], 'status' | 'severity'> & {
  status: ConstructionNcrStatus;
  severity: ConstructionNcrSeverity;
};

export interface ConstructionItpFilters {
  projectId?: string;
  status?: ConstructionItpStatus;
}

export interface CreateConstructionItpInput {
  project_id: string;
  site_id?: string | null;
  itp_number: string;
  title: string;
  scope: string;
  boq_section_id?: string | null;
  subcontract_id?: string | null;
  evidence_reference?: string | null;
}

export interface UpdateConstructionItpInput {
  site_id?: string | null;
  itp_number?: string;
  title?: string;
  scope?: string;
  boq_section_id?: string | null;
  subcontract_id?: string | null;
  evidence_reference?: string | null;
}

export interface CreateConstructionItpCheckpointInput {
  business_id: string;
  itp_id: string;
  sequence_number: number;
  activity: string;
  acceptance_criteria: string;
  hold_type?: ConstructionItpHoldType;
  notes?: string | null;
  evidence_reference?: string | null;
}

export interface UpdateConstructionItpCheckpointInput {
  sequence_number?: number;
  activity?: string;
  acceptance_criteria?: string;
  hold_type?: ConstructionItpHoldType;
  status?: ConstructionItpCheckpointStatus;
  notes?: string | null;
  evidence_reference?: string | null;
}

export interface ConstructionNcrFilters {
  projectId?: string;
  status?: ConstructionNcrStatus;
  severity?: ConstructionNcrSeverity;
}

export interface CreateConstructionNcrInput {
  project_id: string;
  site_id?: string | null;
  ncr_number: string;
  severity?: ConstructionNcrSeverity;
  title: string;
  description: string;
  root_cause?: string | null;
  corrective_action?: string | null;
  preventive_action?: string | null;
  itp_checkpoint_id?: string | null;
  subcontract_id?: string | null;
  evidence_reference?: string | null;
}

export interface UpdateConstructionNcrInput {
  site_id?: string | null;
  severity?: ConstructionNcrSeverity;
  title?: string;
  description?: string;
  root_cause?: string | null;
  corrective_action?: string | null;
  preventive_action?: string | null;
  itp_checkpoint_id?: string | null;
  subcontract_id?: string | null;
  evidence_reference?: string | null;
}

const ITP_RESOURCE = 'construction_itps';
const CHECKPOINT_RESOURCE = 'construction_itp_checkpoints';
const NCR_RESOURCE = 'construction_ncrs';

/** Tenant-scoped persistence for ITPs, inspection checkpoints and NCRs. */
export class ConstructionQualityRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listItps(businessId: string, filters: ConstructionItpFilters = {}): Promise<ConstructionItpRow[]> {
    let query = this.client.from('construction_itps')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error } = await query;
    if (error) throw toRepositoryError(ITP_RESOURCE, error);
    return (data ?? []) as ConstructionItpRow[];
  }

  async getItpById(businessId: string, itpId: string): Promise<ConstructionItpRow> {
    const { data, error } = await this.client.from('construction_itps')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', itpId)
      .maybeSingle();
    if (error) throw toRepositoryError(ITP_RESOURCE, error);
    if (!data) throw new NotFoundError(ITP_RESOURCE, itpId);
    return data as ConstructionItpRow;
  }

  async createItp(businessId: string, input: CreateConstructionItpInput): Promise<ConstructionItpRow> {
    const createdBy = await this.requireActor(ITP_RESOURCE);
    const { data, error } = await this.client.from('construction_itps')
      .insert({ ...input, business_id: businessId, created_by: createdBy })
      .select('*')
      .single();
    if (error) throw toRepositoryError(ITP_RESOURCE, error);
    return data as ConstructionItpRow;
  }

  async updateItp(
    businessId: string,
    itpId: string,
    changes: UpdateConstructionItpInput,
  ): Promise<ConstructionItpRow> {
    const { data, error } = await this.client.from('construction_itps')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', itpId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(ITP_RESOURCE, error);
    if (!data) throw new NotFoundError(ITP_RESOURCE, itpId);
    return data as ConstructionItpRow;
  }

  async transitionItpStatus(itpId: string, newStatus: ConstructionItpStatus): Promise<void> {
    const { error } = await this.client.rpc('transition_itp_status', {
      p_itp_id: itpId,
      p_new_status: newStatus,
    });
    if (error) throw toRepositoryError(ITP_RESOURCE, error);
  }

  async listCheckpointsByItp(businessId: string, itpId: string): Promise<ConstructionItpCheckpointRow[]> {
    const { data, error } = await this.client.from('construction_itp_checkpoints')
      .select('*')
      .eq('business_id', businessId)
      .eq('itp_id', itpId)
      .order('sequence_number', { ascending: true });
    if (error) throw toRepositoryError(CHECKPOINT_RESOURCE, error);
    return (data ?? []) as ConstructionItpCheckpointRow[];
  }

  async createCheckpoint(
    input: CreateConstructionItpCheckpointInput,
  ): Promise<ConstructionItpCheckpointRow> {
    const { data, error } = await this.client.from('construction_itp_checkpoints')
      .insert(input)
      .select('*')
      .single();
    if (error) throw toRepositoryError(CHECKPOINT_RESOURCE, error);
    return data as ConstructionItpCheckpointRow;
  }

  async updateCheckpoint(
    businessId: string,
    checkpointId: string,
    changes: UpdateConstructionItpCheckpointInput,
  ): Promise<ConstructionItpCheckpointRow> {
    const updates: Tables['construction_itp_checkpoints']['Update'] = { ...changes };
    if (changes.status !== undefined) {
      if (changes.status === 'pending') {
        updates.inspected_by = null;
        updates.inspected_at = null;
      } else {
        updates.inspected_by = await this.requireActor(CHECKPOINT_RESOURCE);
        updates.inspected_at = new Date().toISOString();
      }
    }
    const { data, error } = await this.client.from('construction_itp_checkpoints')
      .update(updates)
      .eq('business_id', businessId)
      .eq('id', checkpointId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(CHECKPOINT_RESOURCE, error);
    if (!data) throw new NotFoundError(CHECKPOINT_RESOURCE, checkpointId);
    return data as ConstructionItpCheckpointRow;
  }

  async deleteCheckpoint(businessId: string, checkpointId: string): Promise<boolean> {
    const { data, error } = await this.client.from('construction_itp_checkpoints')
      .delete()
      .eq('business_id', businessId)
      .eq('id', checkpointId)
      .select('id')
      .maybeSingle();
    if (error) throw toRepositoryError(CHECKPOINT_RESOURCE, error);
    return data !== null;
  }

  async listNcrs(businessId: string, filters: ConstructionNcrFilters = {}): Promise<ConstructionNcrRow[]> {
    let query = this.client.from('construction_ncrs')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.severity) query = query.eq('severity', filters.severity);
    const { data, error } = await query;
    if (error) throw toRepositoryError(NCR_RESOURCE, error);
    return (data ?? []) as ConstructionNcrRow[];
  }

  async getNcrById(businessId: string, ncrId: string): Promise<ConstructionNcrRow> {
    const { data, error } = await this.client.from('construction_ncrs')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', ncrId)
      .maybeSingle();
    if (error) throw toRepositoryError(NCR_RESOURCE, error);
    if (!data) throw new NotFoundError(NCR_RESOURCE, ncrId);
    return data as ConstructionNcrRow;
  }

  async createNcr(businessId: string, input: CreateConstructionNcrInput): Promise<ConstructionNcrRow> {
    const raisedBy = await this.requireActor(NCR_RESOURCE);
    const { data, error } = await this.client.from('construction_ncrs')
      .insert({ ...input, business_id: businessId, raised_by: raisedBy })
      .select('*')
      .single();
    if (error) throw toRepositoryError(NCR_RESOURCE, error);
    return data as ConstructionNcrRow;
  }

  async updateNcr(
    businessId: string,
    ncrId: string,
    changes: UpdateConstructionNcrInput,
  ): Promise<ConstructionNcrRow> {
    const { data, error } = await this.client.from('construction_ncrs')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', ncrId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(NCR_RESOURCE, error);
    if (!data) throw new NotFoundError(NCR_RESOURCE, ncrId);
    return data as ConstructionNcrRow;
  }

  async transitionNcrStatus(ncrId: string, newStatus: ConstructionNcrStatus): Promise<void> {
    const { error } = await this.client.rpc('transition_ncr_status', {
      p_ncr_id: ncrId,
      p_new_status: newStatus,
    });
    if (error) throw toRepositoryError(NCR_RESOURCE, error);
  }

  private async requireActor(resource: string): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw toRepositoryError(resource, error);
    if (!data.user) throw new UnauthorizedError(resource, 'An authenticated user is required for this operation.');
    return data.user.id;
  }
}
