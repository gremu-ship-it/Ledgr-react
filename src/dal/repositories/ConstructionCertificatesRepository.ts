import { supabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

type Tables = Database['public']['Tables'];
type PublicFunctions = Database['public']['Functions'];
type Client = SupabaseClient<Database>;

export type PaymentCertificateStatus = 'draft' | 'issued' | 'paid' | 'partially_paid' | 'cancelled';
export type PaymentCertificate = Omit<Tables['payment_certificates']['Row'], 'status'> & {
  status: PaymentCertificateStatus;
};

export interface CreatePaymentCertificateInput {
  valuationId: string;
  retentionPercentage: number;
  advanceRecovery: number;
  penaltyDeductions: number;
  otherDeductions: number;
}

export class ConstructionCertificatesRepository {
  private readonly db: Client;

  constructor(db: Client = supabase) {
    this.db = db;
  }

  async list(businessId: string, projectId: string): Promise<PaymentCertificate[]> {
    const { data, error } = await this.db
      .from('payment_certificates')
      .select('*')
      .eq('business_id', businessId)
      .eq('project_id', projectId)
      .order('certificate_number', { ascending: true });
    if (error) throw error;
    return (data ?? []) as PaymentCertificate[];
  }

  async create(input: CreatePaymentCertificateInput): Promise<string> {
    const result = await this.db.rpc('create_certificate_from_valuation', {
      p_valuation_id: input.valuationId,
      p_retention_percentage: input.retentionPercentage,
      p_advance_recovery: input.advanceRecovery,
      p_penalty_deductions: input.penaltyDeductions,
      p_other_deductions: input.otherDeductions,
    } satisfies PublicFunctions['create_certificate_from_valuation']['Args']);
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Payment certificate was not created.');
    return result.data;
  }

  async issue(certificateId: string, paymentDueDate: string | null): Promise<string> {
    const result = await this.db.rpc('issue_payment_certificate', {
      p_certificate_id: certificateId,
      p_payment_due_date: paymentDueDate,
    } satisfies PublicFunctions['issue_payment_certificate']['Args']);
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Payment certificate was not issued.');
    return result.data;
  }

  async recordPayment(certificateId: string, amount: number, paidDate: string): Promise<string> {
    const result = await this.db.rpc('record_payment_certificate_payment', {
      p_certificate_id: certificateId,
      p_amount: amount,
      p_paid_date: paidDate,
    } satisfies PublicFunctions['record_payment_certificate_payment']['Args']);
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Payment was not recorded.');
    return result.data;
  }

  async cancel(certificateId: string): Promise<string> {
    const result = await this.db.rpc('cancel_payment_certificate', {
      p_certificate_id: certificateId,
    } satisfies PublicFunctions['cancel_payment_certificate']['Args']);
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Payment certificate was not cancelled.');
    return result.data;
  }
}

export const constructionCertificatesRepository = new ConstructionCertificatesRepository();
