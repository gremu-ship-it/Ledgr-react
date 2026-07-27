import { supabase } from '../../lib/supabase';

export interface PartnerInvoice {
  id: string;
  partner_id: string;
  amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  currency: string;
  created_at: string;
}

export const PartnerBillingRepository = {
  async getInvoicesForPartner(partnerId: string): Promise<PartnerInvoice[]> {
    const { data } = await (supabase as any).from('partner_invoices').select('*').eq('partner_id', partnerId).order('created_at', { ascending: false });
    return (data || []) as PartnerInvoice[];
  },
  async createInvoice(partnerId: string, amount: number, currency = 'MWK'): Promise<PartnerInvoice> {
    const { data } = await (supabase as any).from('partner_invoices').insert({ partner_id: partnerId, amount, currency, status: 'draft' }).select().single();
    return data as PartnerInvoice;
  },
};
