import { supabase } from '@/lib/supabase';
import type {
  CreatePartnerDto,
  Partner,
  PartnerClientUsage,
  PartnerFeatureFlag,
  UpdatePartnerDto,
} from '@/types/partners';

// The generated Database type doesn't include the white-label tables (they
// live outside the business-scoped schema), so we deliberately talk to them
// through an untyped client and map to our own hand-written interfaces.
const db = supabase as unknown as {
  from: (table: string) => any;
};

function mapPartner(row: any): Partner {
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
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

export const PartnerRepository = {
  async getById(id: string): Promise<Partner | null> {
    const { data } = await db.from('partners').select('*').eq('id', id).maybeSingle();
    return data ? mapPartner(data) : null;
  },

  /** Resolve a tenant from a subdomain label (nbs.ledgr.com → 'nbs'). */
  async getBySlug(slug: string): Promise<Partner | null> {
    const { data } = await db
      .from('partners')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return mapPartner(data);
    // Backwards compatibility with rows that only set the legacy `domain`.
    const { data: legacy } = await db
      .from('partners')
      .select('*')
      .ilike('domain', `${slug}.%`)
      .eq('is_active', true)
      .limit(1);
    return legacy?.length ? mapPartner(legacy[0]) : null;
  },

  /** Resolve a tenant from a full custom domain (accounting.nbsmw.com). */
  async getByCustomDomain(domain: string): Promise<Partner | null> {
    const host = domain.toLowerCase();
    const { data } = await db
      .from('partners')
      .select('*')
      .or(`custom_domain.eq.${host},domain.eq.${host}`)
      .eq('is_active', true)
      .limit(1);
    return data?.length ? mapPartner(data[0]) : null;
  },

  async getAll(includeInactive = false): Promise<Partner[]> {
    let query = db.from('partners').select('*').order('name');
    if (!includeInactive) query = query.eq('is_active', true);
    const { data } = await query;
    return (data ?? []).map(mapPartner);
  },

  /** Partners the signed-in user administers (bank/MFI staff). */
  async getForAdminUser(userId: string): Promise<Partner[]> {
    const { data } = await db
      .from('partner_admins')
      .select('partner:partners!inner(*)')
      .eq('user_id', userId);
    return (data ?? [])
      .map((row: any) => (Array.isArray(row.partner) ? row.partner[0] : row.partner))
      .filter(Boolean)
      .map(mapPartner);
  },

  async create(dto: CreatePartnerDto): Promise<Partner> {
    const { data, error } = await db
      .from('partners')
      .insert({
        ...dto,
        is_active: dto.is_active ?? true,
        client_limit: dto.client_limit ?? 100,
        primary_colour: dto.primary_colour ?? '#0F766E',
        app_name: dto.app_name ?? dto.name,
        allow_client_visibility: dto.allow_client_visibility ?? false,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapPartner(data);
  },

  async update(id: string, dto: UpdatePartnerDto): Promise<Partner> {
    const { data, error } = await db
      .from('partners')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapPartner(data);
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await db.from('partners').update({ is_active: isActive }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ── feature flags ─────────────────────────────────────────────────────
  async getFeatureFlags(partnerId: string): Promise<Record<string, boolean>> {
    const { data } = await db
      .from('partner_feature_flags')
      .select('feature_key, enabled')
      .eq('partner_id', partnerId);
    const flags: Record<string, boolean> = {};
    (data ?? []).forEach((f: PartnerFeatureFlag) => {
      flags[f.feature_key] = f.enabled;
    });
    return flags;
  },

  async setFeatureFlag(partnerId: string, featureKey: string, enabled: boolean): Promise<void> {
    const { error } = await db
      .from('partner_feature_flags')
      .upsert({ partner_id: partnerId, feature_key: featureKey, enabled }, { onConflict: 'partner_id,feature_key' });
    if (error) throw new Error(error.message);
  },

  async setFeatureFlags(partnerId: string, flags: Record<string, boolean>): Promise<void> {
    const rows = Object.entries(flags).map(([feature_key, enabled]) => ({
      partner_id: partnerId,
      feature_key,
      enabled,
    }));
    if (!rows.length) return;
    const { error } = await db
      .from('partner_feature_flags')
      .upsert(rows, { onConflict: 'partner_id,feature_key' });
    if (error) throw new Error(error.message);
  },

  // ── clients & usage ───────────────────────────────────────────────────
  async getClientUsage(partnerId: string): Promise<PartnerClientUsage[]> {
    const { data } = await db
      .from('v_partner_client_usage')
      .select('*')
      .eq('partner_id', partnerId)
      .order('onboarded_at', { ascending: false });
    return (data ?? []).map((r: any) => ({
      ...r,
      journal_entry_count: Number(r.journal_entry_count ?? 0),
      invoice_count: Number(r.invoice_count ?? 0),
      user_count: Number(r.user_count ?? 0),
      price_per_client: undefined,
    })) as PartnerClientUsage[];
  },

  async getClientCount(partnerId: string): Promise<number> {
    const { count } = await db
      .from('partner_clients')
      .select('business_id', { count: 'exact', head: true })
      .eq('partner_id', partnerId);
    return count ?? 0;
  },

  async getClientCounts(): Promise<Record<string, number>> {
    const { data } = await db.from('partner_clients').select('partner_id');
    const counts: Record<string, number> = {};
    (data ?? []).forEach((r: any) => {
      counts[r.partner_id] = (counts[r.partner_id] ?? 0) + 1;
    });
    return counts;
  },

  // ── partner admin staff ───────────────────────────────────────────────
  async isPartnerAdminOf(userId: string, partnerId: string): Promise<boolean> {
    const { data } = await db
      .from('partner_admins')
      .select('partner_id')
      .eq('user_id', userId)
      .eq('partner_id', partnerId)
      .maybeSingle();
    return Boolean(data);
  },
};
