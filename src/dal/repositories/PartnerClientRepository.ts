import { supabase } from '@/lib/supabase';

const db = supabase as unknown as { from: (table: string) => any };

export interface PartnerClientLink {
  partner_id: string;
  business_id: string;
  created_at: string;
}

export const PartnerClientRepository = {
  async getClientsForPartner(partnerId: string): Promise<PartnerClientLink[]> {
    const { data } = await db
      .from('partner_clients')
      .select('partner_id, business_id, created_at')
      .eq('partner_id', partnerId);
    return (data ?? []) as PartnerClientLink[];
  },

  /** The partner a business is onboarded under, if any. */
  async getPartnerIdForBusiness(businessId: string): Promise<string | null> {
    const { data } = await db
      .from('partner_clients')
      .select('partner_id')
      .eq('business_id', businessId)
      .maybeSingle();
    return data?.partner_id ?? null;
  },

  /**
   * Links a newly created business to the partner whose branded domain it
   * signed up through. Rejected by the DB trigger when the partner's client
   * limit is already reached.
   */
  async addClientToPartner(partnerId: string, businessId: string): Promise<void> {
    const { error } = await db
      .from('partner_clients')
      .upsert({ partner_id: partnerId, business_id: businessId }, { onConflict: 'partner_id,business_id' });
    if (error) throw new Error(error.message);
  },

  async removeClientFromPartner(partnerId: string, businessId: string): Promise<void> {
    const { error } = await db
      .from('partner_clients')
      .delete()
      .eq('partner_id', partnerId)
      .eq('business_id', businessId);
    if (error) throw new Error(error.message);
  },
};
