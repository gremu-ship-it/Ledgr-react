import { supabase } from '@/lib/supabase';
import type { PartnerStaff, PartnerStaffAssignment, PartnerClientActivity, PartnerClientUsage, PartnerFirm, UpdatePartnerDto } from '@/types/partners';
import type { Business } from '@/types';
import type { Database } from '@/dal/types/database';
import type { Row } from '@/dal/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PartnerPortalClient = SupabaseClient<Database>;

function mapPartner(row: Row<'partners'>): PartnerFirm {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug ?? null,
    domain: row.domain ?? null,
    custom_domain: row.custom_domain ?? null,
    logo_url: row.logo_url ?? null,
    primary_colour: row.primary_colour ?? '#0F766E',
    support_email: row.support_email ?? null,
    support_phone: row.support_phone ?? null,
    app_name: row.app_name ?? 'Ledgr',
    onboarding_title: row.onboarding_title ?? null,
    onboarding_subtitle: row.onboarding_subtitle ?? null,
    client_limit: row.client_limit ?? 100,
    allow_client_visibility: row.allow_client_visibility ?? false,
    is_active: row.is_active ?? true,
    billing_email: row.billing_email ?? null,
    billing_contact_name: row.billing_contact_name ?? null,
    price_per_client: Number(row.price_per_client ?? 0),
    billing_currency: row.billing_currency ?? 'MWK',
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? row.created_at ?? '',
  };
}

function mapClient(row: Row<'v_partner_client_usage'>): PartnerClientUsage {
  const status = row.status;
  return {
    partner_id: row.partner_id,
    business_id: row.business_id,
    business_name: row.business_name,
    plan_tier: row.plan_tier ?? null,
    is_active: row.is_active ?? null,
    status: status === 'onboarding' || status === 'suspended' || status === 'archived' ? status : 'active',
    notes: row.notes ?? null,
    onboarded_at: row.onboarded_at ?? '',
    journal_entry_count: Number(row.journal_entry_count ?? 0),
    invoice_count: Number(row.invoice_count ?? 0),
    pay_run_count: Number(row.pay_run_count ?? 0),
    total_activity_count: Number(row.total_activity_count ?? 0),
    user_count: Number(row.user_count ?? 0),
    last_activity_at: row.last_activity_at ?? null,
    plan_expires_at: row.plan_expires_at ?? null,
    monthly_transaction_count: Number(row.monthly_transaction_count ?? 0),
  };
}

export class PartnerPortalRepository {
  private readonly client: PartnerPortalClient;

  constructor(client: PartnerPortalClient = supabase) {
    this.client = client;
  }

  async getPartnerProfile(partnerId: string): Promise<PartnerFirm | null> {
    const { data, error } = await this.client.from('partners').select('*').eq('id', partnerId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapPartner(data) : null;
  }

  async updatePartnerBranding(
    partnerId: string,
    branding: Pick<UpdatePartnerDto, 'name' | 'app_name' | 'logo_url' | 'primary_colour' | 'support_email' | 'support_phone' | 'onboarding_title' | 'onboarding_subtitle' | 'allow_client_visibility'>,
  ): Promise<PartnerFirm> {
    const { data, error } = await this.client
      .from('partners')
      .update({ ...branding, updated_at: new Date().toISOString() })
      .eq('id', partnerId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapPartner(data);
  }

  async getPartnerClients(partnerId: string): Promise<PartnerClientUsage[]> {
    const { data, error } = await this.client
      .from('v_partner_client_usage')
      .select('*')
      .eq('partner_id', partnerId)
      .order('onboarded_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapClient);
  }

  /**
   * Attach an existing business after the client has requested partner support.
   * The database partner-client RLS policy remains the authorization boundary;
   * this method cannot modify any client-business data.
   */
  async addPartnerClient(partnerId: string, clientBusinessId: string, notes?: string): Promise<void> {
    const { error } = await this.client.from('partner_clients').upsert(
      {
        partner_id: partnerId,
        business_id: clientBusinessId,
        status: 'onboarding',
        notes: notes?.trim() || null,
        onboarded_at: new Date().toISOString(),
      },
      { onConflict: 'partner_id,business_id', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  }

  async updatePartnerClientStatus(
    partnerId: string,
    clientBusinessId: string,
    status: PartnerClientUsage['status'],
  ): Promise<void> {
    const { error } = await this.client
      .from('partner_clients')
      .update({ status })
      .eq('partner_id', partnerId)
      .eq('business_id', clientBusinessId);
    if (error) throw new Error(error.message);
  }

  /** Fetch a client Business only after RLS confirms partner-admin or assignment access. */
  async getClientBusiness(partnerId: string, businessId: string): Promise<Business> {
    const { data: authorized, error: authorizationError } = await this.client.rpc('can_current_user_access_partner_client', {
      p_partner_id: partnerId,
      p_business_id: businessId,
    });
    if (authorizationError) throw new Error(authorizationError.message);
    if (!authorized) throw new Error('Partner client assignment is required.');

    const { data, error } = await this.client
      .from('businesses')
      .select('id, name, base_currency, plan_tier')
      .eq('id', businessId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Client access was not found or has been revoked.');

    // Check the explicit partner-client authorization too: business RLS and the
    // partner link jointly gate context switching, never the local app state.
    const { data: link, error: linkError } = await this.client
      .from('partner_clients')
      .select('business_id')
      .eq('partner_id', partnerId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (linkError) throw new Error(linkError.message);
    if (!link) throw new Error('Client access was not found or has been revoked.');

    return {
      id: data.id,
      name: data.name,
      base_currency: data.base_currency,
      plan_tier: data.plan_tier,
    };
  }

  async getCurrentStaffRole(partnerId: string, userId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('partner_admins')
      .select('role')
      .eq('partner_id', partnerId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.role ?? null;
  }

  async getPartnerAssignments(partnerId: string): Promise<PartnerStaffAssignment[]> {
    const { data, error } = await this.client
      .from('partner_staff_assignments')
      .select('partner_id, staff_user_id, business_id, assigned_by, created_at')
      .eq('partner_id', partnerId);
    if (error) throw new Error(error.message);
    return (data ?? []) as PartnerStaffAssignment[];
  }

  async setClientAssignment(partnerId: string, businessId: string, staffUserId: string, assigned: boolean): Promise<void> {
    const query = this.client.from('partner_staff_assignments');
    const { error } = assigned
      ? await query.insert({ partner_id: partnerId, business_id: businessId, staff_user_id: staffUserId })
      : await query.delete().eq('partner_id', partnerId).eq('business_id', businessId).eq('staff_user_id', staffUserId);
    if (error) throw new Error(error.message);
  }

  async getPartnerStaff(partnerId: string): Promise<PartnerStaff[]> {
    const { data, error } = await this.client.rpc('list_partner_admins' as never, {
      p_partner_id: partnerId,
    } as never);
    if (error) throw new Error(error.message);
    return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
      user_id: String(row.out_user_id ?? ''),
      email: String(row.out_email ?? ''),
      name: String(row.out_name ?? ''),
      role: row.out_role === 'viewer' ? 'viewer' : 'admin',
      created_at: String(row.out_created_at ?? ''),
    }));
  }

  async getClientActivity(partnerId: string, limit = 20): Promise<PartnerClientActivity[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const { data, error } = await this.client
      .from('v_partner_client_activity')
      .select('*')
      .eq('partner_id', partnerId)
      .order('event_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      partner_id: row.partner_id,
      business_id: row.business_id,
      business_name: row.business_name,
      event_id: row.event_id,
      event_type: row.event_type as PartnerClientActivity['event_type'],
      title: row.title,
      event_at: row.event_at,
      status: row.status,
    }));
  }
}

export const partnerPortalRepository = new PartnerPortalRepository();
