import { supabase } from '@/lib/supabase';
import type { PartnerStaff, PartnerClientActivity, PartnerClientUsage, PartnerFirm, UpdatePartnerDto } from '@/types/partners';
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
