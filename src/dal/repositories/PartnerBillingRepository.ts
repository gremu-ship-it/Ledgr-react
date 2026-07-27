import { supabase } from '@/lib/supabase';
import type { Row } from '@/dal/types/database';
import type { PartnerInvoice } from '@/types/partners';

function mapInvoice(row: Row<'partner_invoices'>): PartnerInvoice {
  return {
    id: row.id,
    partner_id: row.partner_id ?? '',
    invoice_number: row.invoice_number ?? null,
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? 'MWK',
    status: (row.status ?? 'draft') as PartnerInvoice['status'],
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
    due_date: row.due_date ?? null,
    client_count: Number(row.client_count ?? 0),
    notes: row.notes ?? null,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? row.created_at ?? '',
  };
}

export interface CreatePartnerInvoiceInput {
  partnerId: string;
  amount: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  clientCount?: number;
  notes?: string;
}

/**
 * Billing sits at the partner level: Ledgr invoices the bank/MFI, and the
 * bank resells to its SME clients. Individual client businesses are never
 * charged directly when they belong to a partner.
 */
export const PartnerBillingRepository = {
  async getInvoicesForPartner(partnerId: string): Promise<PartnerInvoice[]> {
    const { data, error } = await supabase
      .from('partner_invoices')
      .select('*')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapInvoice);
  },

  async createInvoice(input: CreatePartnerInvoiceInput): Promise<PartnerInvoice> {
    const { data, error } = await supabase
      .from('partner_invoices')
      .insert({
        partner_id: input.partnerId,
        amount: input.amount,
        currency: input.currency ?? 'MWK',
        status: 'draft',
        period_start: input.periodStart ?? null,
        period_end: input.periodEnd ?? null,
        due_date: input.dueDate ?? null,
        client_count: input.clientCount ?? 0,
        notes: input.notes ?? null,
        invoice_number: `PINV-${Date.now().toString(36).toUpperCase()}`,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return mapInvoice(data);
  },

  async updateStatus(id: string, status: PartnerInvoice['status']): Promise<void> {
    const { error } = await supabase
      .from('partner_invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },
};
