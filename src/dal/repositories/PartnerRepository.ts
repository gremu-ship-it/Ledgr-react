import { supabase } from '../../lib/supabase';
import type { Partner, PartnerFeatureFlag, CreatePartnerDto, UpdatePartnerDto } from '../../types/partners';

export const PartnerRepository = {
  async getById(id: string): Promise<Partner | null> {
    const { data } = await (supabase as any)
      .from('partners')
      .select('*')
      .eq('id', id)
      .single();
    return data as Partner | null;
  },

  async getByDomain(domain: string): Promise<Partner | null> {
    const { data } = await (supabase as any)
      .from('partners')
      .select('*')
      .eq('domain', domain)
      .single();
    return data as Partner | null;
  },

  async getAll(): Promise<Partner[]> {
    const { data } = await (supabase as any)
      .from('partners')
      .select('*')
      .eq('is_active', true)
      .order('name');
    return (data || []) as Partner[];
  },

  async create(dto: CreatePartnerDto): Promise<Partner> {
    const { data } = await (supabase as any)
      .from('partners')
      .insert({
        ...dto,
        is_active: dto.is_active ?? true,
        client_limit: dto.client_limit ?? 100,
        primary_colour: dto.primary_colour ?? '#1a3a5c',
        app_name: dto.app_name ?? 'Ledgr',
      })
      .select()
      .single();
    return data as Partner;
  },

  async update(id: string, dto: UpdatePartnerDto): Promise<Partner> {
    const { data } = await (supabase as any)
      .from('partners')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    return data as Partner;
  },

  async getFeatureFlags(partnerId: string): Promise<Record<string, boolean>> {
    const { data } = await (supabase as any)
      .from('partner_feature_flags')
      .select('feature_key, enabled')
      .eq('partner_id', partnerId);
    const flags: Record<string, boolean> = {};
    (data || []).forEach((f: PartnerFeatureFlag) => {
      flags[f.feature_key] = f.enabled;
    });
    return flags;
  },

  async setFeatureFlag(partnerId: string, featureKey: string, enabled: boolean): Promise<void> {
    await (supabase as any).from('partner_feature_flags').upsert({
      partner_id: partnerId,
      feature_key: featureKey,
      enabled,
    });
  },
};
