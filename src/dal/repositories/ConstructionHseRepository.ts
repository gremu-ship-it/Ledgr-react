import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { NotFoundError, UnauthorizedError, toRepositoryError } from '../errors/RepositoryError';

type Tables = Database['public']['Tables'];

export type ConstructionHseIncidentStatus = 'reported' | 'investigating' | 'resolved' | 'closed';
export type ConstructionHseIncidentSeverity = 'near_miss' | 'minor' | 'major' | 'critical' | 'fatality';
export type ConstructionHseIncidentType = 'injury' | 'property_damage' | 'environmental' | 'near_miss' | 'other';

export type ConstructionHseIncidentRow = Omit<Tables['construction_hse_incidents']['Row'], 'status' | 'severity' | 'incident_type'> & {
  status: ConstructionHseIncidentStatus;
  severity: ConstructionHseIncidentSeverity;
  incident_type: ConstructionHseIncidentType;
};
export type ConstructionToolboxTalkRow = Tables['construction_toolbox_talks']['Row'];

export interface ConstructionHseIncidentFilters {
  projectId?: string;
  status?: ConstructionHseIncidentStatus;
  severity?: ConstructionHseIncidentSeverity;
}

export interface CreateConstructionHseIncidentInput {
  project_id: string;
  site_id?: string | null;
  incident_number: string;
  severity?: ConstructionHseIncidentSeverity;
  incident_type?: ConstructionHseIncidentType;
  title: string;
  description: string;
  incident_date: string;
  location_description?: string | null;
  persons_involved?: number;
  root_cause?: string | null;
  corrective_action?: string | null;
  evidence_reference?: string | null;
}

export interface UpdateConstructionHseIncidentInput {
  site_id?: string | null;
  severity?: ConstructionHseIncidentSeverity;
  incident_type?: ConstructionHseIncidentType;
  title?: string;
  description?: string;
  incident_date?: string;
  location_description?: string | null;
  persons_involved?: number;
  root_cause?: string | null;
  corrective_action?: string | null;
  evidence_reference?: string | null;
}

export interface ConstructionToolboxTalkFilters {
  projectId?: string;
}

export interface CreateConstructionToolboxTalkInput {
  project_id: string;
  site_id?: string | null;
  talk_date: string;
  topic: string;
  presenter: string;
  attendees_count?: number;
  summary: string;
  evidence_reference?: string | null;
}

export interface ConstructionHseDashboardStats {
  open_incidents_by_severity: Record<ConstructionHseIncidentSeverity, number>;
  toolbox_talks_this_month: number;
}

const INCIDENT_RESOURCE = 'construction_hse_incidents';
const TALK_RESOURCE = 'construction_toolbox_talks';
const INCIDENT_SEVERITIES: ConstructionHseIncidentSeverity[] = [
  'near_miss', 'minor', 'major', 'critical', 'fatality',
];
const OPEN_INCIDENT_STATUSES: ConstructionHseIncidentStatus[] = ['reported', 'investigating', 'resolved'];

/** Tenant-scoped persistence for HSE incidents and toolbox talks. */
export class ConstructionHseRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listIncidents(
    businessId: string,
    filters: ConstructionHseIncidentFilters = {},
  ): Promise<ConstructionHseIncidentRow[]> {
    let query = this.client.from('construction_hse_incidents')
      .select('*')
      .eq('business_id', businessId)
      .order('incident_date', { ascending: false });
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.severity) query = query.eq('severity', filters.severity);
    const { data, error } = await query;
    if (error) throw toRepositoryError(INCIDENT_RESOURCE, error);
    return (data ?? []) as ConstructionHseIncidentRow[];
  }

  async getIncidentById(businessId: string, incidentId: string): Promise<ConstructionHseIncidentRow> {
    const { data, error } = await this.client.from('construction_hse_incidents')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', incidentId)
      .maybeSingle();
    if (error) throw toRepositoryError(INCIDENT_RESOURCE, error);
    if (!data) throw new NotFoundError(INCIDENT_RESOURCE, incidentId);
    return data as ConstructionHseIncidentRow;
  }

  async createIncident(
    businessId: string,
    input: CreateConstructionHseIncidentInput,
  ): Promise<ConstructionHseIncidentRow> {
    const reportedBy = await this.requireActor(INCIDENT_RESOURCE);
    const { data, error } = await this.client.from('construction_hse_incidents')
      .insert({ ...input, business_id: businessId, reported_by: reportedBy })
      .select('*')
      .single();
    if (error) throw toRepositoryError(INCIDENT_RESOURCE, error);
    return data as ConstructionHseIncidentRow;
  }

  async updateIncident(
    businessId: string,
    incidentId: string,
    changes: UpdateConstructionHseIncidentInput,
  ): Promise<ConstructionHseIncidentRow> {
    const { data, error } = await this.client.from('construction_hse_incidents')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', incidentId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(INCIDENT_RESOURCE, error);
    if (!data) throw new NotFoundError(INCIDENT_RESOURCE, incidentId);
    return data as ConstructionHseIncidentRow;
  }

  async transitionIncidentStatus(incidentId: string, newStatus: ConstructionHseIncidentStatus): Promise<void> {
    const { error } = await this.client.rpc('transition_hse_incident_status', {
      p_incident_id: incidentId,
      p_new_status: newStatus,
    });
    if (error) throw toRepositoryError(INCIDENT_RESOURCE, error);
  }

  async listToolboxTalks(
    businessId: string,
    filters: ConstructionToolboxTalkFilters = {},
  ): Promise<ConstructionToolboxTalkRow[]> {
    let query = this.client.from('construction_toolbox_talks')
      .select('*')
      .eq('business_id', businessId)
      .order('talk_date', { ascending: false });
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    const { data, error } = await query;
    if (error) throw toRepositoryError(TALK_RESOURCE, error);
    return data ?? [];
  }

  async createToolboxTalk(
    businessId: string,
    input: CreateConstructionToolboxTalkInput,
  ): Promise<ConstructionToolboxTalkRow> {
    const createdBy = await this.requireActor(TALK_RESOURCE);
    const { data, error } = await this.client.from('construction_toolbox_talks')
      .insert({ ...input, business_id: businessId, created_by: createdBy })
      .select('*')
      .single();
    if (error) throw toRepositoryError(TALK_RESOURCE, error);
    return data as ConstructionToolboxTalkRow;
  }

  async getDashboardStats(
    businessId: string,
    options: { projectId?: string; asOf?: Date } = {},
  ): Promise<ConstructionHseDashboardStats> {
    let incidentsQuery = this.client.from('construction_hse_incidents')
      .select('severity, status')
      .eq('business_id', businessId)
      .in('status', OPEN_INCIDENT_STATUSES);
    if (options.projectId) incidentsQuery = incidentsQuery.eq('project_id', options.projectId);
    const { data, error } = await incidentsQuery;
    if (error) throw toRepositoryError(INCIDENT_RESOURCE, error);

    const openIncidentsBySeverity = Object.fromEntries(
      INCIDENT_SEVERITIES.map((severity) => [severity, 0]),
    ) as Record<ConstructionHseIncidentSeverity, number>;
    for (const incident of data ?? []) {
      const severity = incident.severity as ConstructionHseIncidentSeverity;
      if (INCIDENT_SEVERITIES.includes(severity)) openIncidentsBySeverity[severity] += 1;
    }

    const asOf = options.asOf ?? new Date();
    const startOfMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const startOfNextMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    let talksQuery = this.client.from('construction_toolbox_talks')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('talk_date', startOfMonth)
      .lt('talk_date', startOfNextMonth);
    if (options.projectId) talksQuery = talksQuery.eq('project_id', options.projectId);
    const { count, error: talksError } = await talksQuery;
    if (talksError) throw toRepositoryError(TALK_RESOURCE, talksError);

    return {
      open_incidents_by_severity: openIncidentsBySeverity,
      toolbox_talks_this_month: count ?? 0,
    };
  }

  private async requireActor(resource: string): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw toRepositoryError(resource, error);
    if (!data.user) throw new UnauthorizedError(resource, 'An authenticated user is required for this operation.');
    return data.user.id;
  }
}
