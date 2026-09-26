/**
 * Invoice four-eyes approval (owner decision 2026-09-26, migration
 * 20261014000000). The server decides whether an invoice needs approval and
 * refuses to issue it without one; this module only reads the state and asks
 * the server to record an approval. It can never approve by itself.
 */
import { supabase } from '@/lib/supabase';

type Client = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        is: (col: string, v: null) => { maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }> };
      };
    };
  };
};
const client = supabase as unknown as Client;

export interface InvoiceApproval {
  id: string;
  approved_by: string;
  approved_at: string;
  note: string | null;
}

/** Roles the server accepts as approvers (approve_invoice). Display only. */
export const INVOICE_APPROVER_ROLES = ['owner', 'admin', 'accountant'] as const;
export function canApproveInvoices(role: string | null | undefined): boolean {
  return !!role && (INVOICE_APPROVER_ROLES as readonly string[]).includes(role);
}

export async function findLiveInvoiceApproval(invoiceId: string): Promise<InvoiceApproval | null> {
  const { data, error } = await client.from('invoice_approvals')
    .select('id, approved_by, approved_at, note').eq('invoice_id', invoiceId).is('revoked_at', null).maybeSingle();
  if (error) throw new Error(error.message || 'Could not load the approval.');
  return (data as InvoiceApproval | null) ?? null;
}

export async function approveInvoice(invoiceId: string, note?: string): Promise<void> {
  const { error } = await client.rpc('approve_invoice', { p_invoice_id: invoiceId, p_note: note ?? null });
  if (error) throw new Error(error.message || 'Could not approve the invoice.');
}
