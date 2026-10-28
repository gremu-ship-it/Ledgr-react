import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database } from '../types/database';
import type {
  CreateSubcontractInput,
  CreateSubcontractorProfileInput,
  SubcontractDetail,
  SubcontractStatus,
  SubcontractSummary,
  SubcontractorProfileWithContact,
  UpdateSubcontractInput,
  UpdateSubcontractorProfileInput,
} from '../types/construction';
import { NotFoundError, toRepositoryError } from '../errors/RepositoryError';

export interface SubcontractorProfileFilters {
  trade?: string;
  search?: string;
}

const SUBCONTRACT_SUMMARY_SELECT = `
  *,
  subcontractor_profile:subcontractor_profiles!subcontracts_subcontractor_profile_id_fkey (
    id, trade, is_active,
    contact:contacts!subcontractor_profiles_contact_id_fkey (
      id, name, contact_type, email, phone, address_line1, address_line2, city, country, tpin, vat_number
    )
  ),
  project:construction_projects!subcontracts_project_id_fkey (id, name, status)
`;

const SUBCONTRACT_DETAIL_SELECT = `
  *,
  subcontractor_profile:subcontractor_profiles!subcontracts_subcontractor_profile_id_fkey (
    *, contact:contacts!subcontractor_profiles_contact_id_fkey (*)
  ),
  project:construction_projects!subcontracts_project_id_fkey (*)
`;

export class SubcontractRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listSubcontractorProfiles(
    businessId: string,
    filters: SubcontractorProfileFilters = {},
  ): Promise<SubcontractorProfileWithContact[]> {
    let query = this.client
      .from('subcontractor_profiles')
      .select('*, contact:contacts!inner(*)')
      .eq('business_id', businessId)
      .order('preferred', { ascending: false })
      .order('updated_at', { ascending: false });
    if (filters.trade) query = query.eq('trade', filters.trade);

    const { data, error } = await query;
    if (error) throw toRepositoryError('subcontractor_profiles', error);
    const profiles = (data ?? []) as unknown as SubcontractorProfileWithContact[];
    const search = filters.search?.trim().toLocaleLowerCase();
    if (!search) return profiles;
    return profiles.filter(({ contact, trade }) =>
      `${contact.name} ${contact.email ?? ''} ${contact.phone ?? ''} ${trade}`
        .toLocaleLowerCase()
        .includes(search),
    );
  }

  async getSubcontractorProfile(
    businessId: string,
    profileId: string,
  ): Promise<SubcontractorProfileWithContact> {
    const { data, error } = await this.client
      .from('subcontractor_profiles')
      .select('*, contact:contacts!inner(*)')
      .eq('business_id', businessId)
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw toRepositoryError('subcontractor_profiles', error);
    if (!data) throw new NotFoundError('subcontractor_profiles', profileId);
    return data as unknown as SubcontractorProfileWithContact;
  }

  async createSubcontractorProfile(
    businessId: string,
    input: CreateSubcontractorProfileInput,
  ): Promise<string> {
    const { data, error } = await this.client
      .from('subcontractor_profiles')
      .insert({ business_id: businessId, ...input })
      .select('id')
      .single();
    if (error) throw toRepositoryError('subcontractor_profiles', error);
    return data.id;
  }

  async updateSubcontractorProfile(
    businessId: string,
    profileId: string,
    input: UpdateSubcontractorProfileInput,
  ): Promise<void> {
    const { data, error } = await this.client
      .from('subcontractor_profiles')
      .update(input)
      .eq('business_id', businessId)
      .eq('id', profileId)
      .select('id')
      .maybeSingle();
    if (error) throw toRepositoryError('subcontractor_profiles', error);
    if (!data) throw new NotFoundError('subcontractor_profiles', profileId);
  }

  async listSubcontracts(businessId: string, projectId?: string): Promise<SubcontractSummary[]> {
    let query = this.client
      .from('subcontracts')
      .select(SUBCONTRACT_SUMMARY_SELECT)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);
    const { data, error } = await query;
    if (error) throw toRepositoryError('subcontracts', error);
    return (data ?? []) as unknown as SubcontractSummary[];
  }

  async getSubcontract(businessId: string, subcontractId: string): Promise<SubcontractDetail> {
    const { data, error } = await this.client
      .from('subcontracts')
      .select(SUBCONTRACT_DETAIL_SELECT)
      .eq('business_id', businessId)
      .eq('id', subcontractId)
      .maybeSingle();
    if (error) throw toRepositoryError('subcontracts', error);
    if (!data) throw new NotFoundError('subcontracts', subcontractId);
    return data as unknown as SubcontractDetail;
  }

  async createSubcontract(businessId: string, input: CreateSubcontractInput): Promise<string> {
    const { data, error } = await this.client
      .from('subcontracts')
      .insert({ business_id: businessId, ...input })
      .select('id')
      .single();
    if (error) throw toRepositoryError('subcontracts', error);
    return data.id;
  }

  async updateSubcontract(
    businessId: string,
    subcontractId: string,
    input: UpdateSubcontractInput,
  ): Promise<void> {
    const { data, error } = await this.client
      .from('subcontracts')
      .update(input)
      .eq('business_id', businessId)
      .eq('id', subcontractId)
      .select('id')
      .maybeSingle();
    if (error) throw toRepositoryError('subcontracts', error);
    if (!data) throw new NotFoundError('subcontracts', subcontractId);
  }

  async updateSubcontractStatus(
    businessId: string,
    subcontractId: string,
    status: SubcontractStatus,
  ): Promise<void> {
    const { data, error } = await this.client
      .from('subcontracts')
      .update({ status })
      .eq('business_id', businessId)
      .eq('id', subcontractId)
      .select('id')
      .maybeSingle();
    if (error) throw toRepositoryError('subcontracts', error);
    if (!data) throw new NotFoundError('subcontracts', subcontractId);
  }
}

export const subcontractRepository = new SubcontractRepository(supabase);
