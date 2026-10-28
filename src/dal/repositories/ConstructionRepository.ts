import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import type {
  ConstructionProject,
  ConstructionProjectInput,
  ConstructionSite,
  ConstructionSiteInput,
} from '../types/construction';
import { supabase } from '@/lib/supabase';
import { toRepositoryError } from '../errors/RepositoryError';

export interface ConstructionLocationOption {
  id: string;
  name: string;
  branch_id: string | null;
}

export class ConstructionRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listProjects(businessId: string): Promise<ConstructionProject[]> {
    const { data, error } = await this.client
      .from('construction_projects')
      .select('*')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: false });
    if (error) throw toRepositoryError('construction_projects', error);
    return (data ?? []) as ConstructionProject[];
  }

  async getProject(businessId: string, projectId: string): Promise<ConstructionProject | null> {
    const { data, error } = await this.client
      .from('construction_projects')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw toRepositoryError('construction_projects', error);
    return data as ConstructionProject | null;
  }

  async createProject(
    businessId: string,
    input: ConstructionProjectInput,
  ): Promise<ConstructionProject> {
    const { data, error } = await this.client.rpc('create_project' as never, {
      p_business_id: businessId,
      p_name: input.name.trim(),
      p_client_name: input.client_name.trim(),
      p_contract_sum: input.contract_sum,
      p_retention_pct: input.retention_pct,
      p_budget: input.budget,
      p_start_date: input.start_date,
      p_end_date: input.end_date,
      p_client_id: input.client_id ?? null,
    } as never);
    if (error) throw toRepositoryError('construction_projects', error);
    // The existing command derives created_by from the authenticated actor.
    return data as unknown as ConstructionProject;
  }

  async updateProject(
    projectId: string,
    input: ConstructionProjectInput,
  ): Promise<ConstructionProject> {
    const { data, error } = await this.client.rpc('update_project' as never, {
      p_project_id: projectId,
      p_name: input.name.trim(),
      p_client_name: input.client_name.trim(),
      p_contract_sum: input.contract_sum,
      p_retention_pct: input.retention_pct,
      p_budget: input.budget,
      p_start_date: input.start_date,
      p_end_date: input.end_date,
      p_client_id: input.client_id ?? null,
    } as never);
    if (error) throw toRepositoryError('construction_projects', error);
    return data as unknown as ConstructionProject;
  }

  async transitionProjectStatus(
    projectId: string,
    status: ConstructionProject['status'],
    reason?: string,
  ): Promise<ConstructionProject> {
    const { data, error } = await this.client.rpc('set_construction_project_status' as never, {
      p_project_id: projectId,
      p_new_status: status,
      p_reason: reason?.trim() || null,
    } as never);
    if (error) throw toRepositoryError('construction_projects', error);
    return data as unknown as ConstructionProject;
  }

  async listSites(businessId: string, projectId: string): Promise<ConstructionSite[]> {
    const { data, error } = await this.client
      .from('construction_sites')
      .select('*')
      .eq('business_id', businessId)
      .eq('project_id', projectId)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('construction_sites', error);
    return data ?? [];
  }

  async listLocations(businessId: string): Promise<ConstructionLocationOption[]> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('id,name,branch_id')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('inventory_locations', error);
    return data ?? [];
  }

  async createSite(
    businessId: string,
    projectId: string,
    input: ConstructionSiteInput,
  ): Promise<ConstructionSite> {
    const { data, error } = await this.client
      .from('construction_sites')
      .insert({
        business_id: businessId,
        project_id: projectId,
        name: input.name.trim(),
        location_id: input.location_id,
        address: input.address?.trim() || null,
      })
      .select('*')
      .single();
    if (error) throw toRepositoryError('construction_sites', error);
    return data;
  }

  async updateSite(siteId: string, input: ConstructionSiteInput): Promise<ConstructionSite> {
    const { data, error } = await this.client
      .from('construction_sites')
      .update({
        name: input.name.trim(),
        location_id: input.location_id,
        address: input.address?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', siteId)
      .select('*')
      .single();
    if (error) throw toRepositoryError('construction_sites', error);
    return data;
  }

  async deleteSite(siteId: string): Promise<void> {
    const { error } = await this.client.from('construction_sites').delete().eq('id', siteId);
    if (error) throw toRepositoryError('construction_sites', error);
  }
}

export const constructionRepository = new ConstructionRepository(supabase);
