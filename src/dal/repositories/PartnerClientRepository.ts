import { supabase } from '../../lib/supabase';
import type { Partner } from '../../types/partners';

export const PartnerClientRepository = {
  async getClientsForPartner(partnerId: string) {
    const { data } = await (supabase as any)
      .from('partner_clients')
      .select('business_id, created_at')
      .eq('partner_id', partnerId);
    return data || [];
  },

  async addClientToPartner(partnerId: string, businessId: string) {
    await (supabase as any).from('partner_clients').upsert({ partner_id: partnerId, business_id: businessId });
  },

  async removeClientFromPartner(partnerId: string, businessId: string) {
    await (supabase as any).from('partner_clients').delete().eq('partner_id', partnerId).eq('business_id', businessId);
  },
};
