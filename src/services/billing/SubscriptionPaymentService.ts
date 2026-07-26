import { supabase } from '@/lib/supabase';
import type { PlanTier } from '@/lib/billing/plans';

export type BillingCycle = 'monthly' | 'annual';

export interface SubscriptionPayment {
  id: string;
  business_id: string;
  tx_ref: string;
  gateway: string;
  gateway_reference: string | null;
  target_plan_tier: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  checkout_url: string | null;
  plan_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InitiateCheckoutResult {
  checkout_url: string;
  tx_ref: string;
  amount: number;
  currency: string;
}

export interface VerifyPaymentResult {
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  plan_tier?: PlanTier;
  message?: string;
}

export type ManualPaymentMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'other';

export interface ManualGrantParams {
  business_id: string;
  target_plan_tier: Exclude<PlanTier, 'free'>;
  duration_days: number;
  amount: number;
  payment_method: ManualPaymentMethod;
  reference?: string;
  notes?: string;
}

export interface ManualGrantResult {
  success: true;
  plan_tier: PlanTier;
  plan_expires_at: string;
  business_name: string;
}

/**
 * Client-side wrapper around the payment-related Edge Functions.
 * The real work (talking to PayChangu, writing to businesses.plan_tier)
 * only ever happens server-side using the service role key — this class
 * never touches those tables directly.
 */
export class SubscriptionPaymentService {
  async initiateCheckout(
    businessId: string,
    targetPlanTier: Exclude<PlanTier, 'free'>,
    billingCycle: BillingCycle,
  ): Promise<InitiateCheckoutResult> {
    const { data, error } = await supabase.functions.invoke('initiate-subscription-payment', {
      body: { business_id: businessId, target_plan_tier: targetPlanTier, billing_cycle: billingCycle },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data as InitiateCheckoutResult;
  }

  async verifyPayment(txRef: string): Promise<VerifyPaymentResult> {
    const { data, error } = await supabase.functions.invoke('verify-subscription-payment', {
      body: { tx_ref: txRef },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data as VerifyPaymentResult;
  }

  async listPayments(businessId: string): Promise<SubscriptionPayment[]> {
    const { data, error } = await supabase
      .from('subscription_payments')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SubscriptionPayment[];
  }

  /**
   * Platform-admin only: activates a plan for a business that paid outside
   * PayChangu (cash, bank transfer, etc.). Enforced server-side by
   * grant-manual-subscription — this call will fail for non-admins
   * regardless of what the client shows.
   */
  async grantManualSubscription(params: ManualGrantParams): Promise<ManualGrantResult> {
    const { data, error } = await supabase.functions.invoke('grant-manual-subscription', {
      body: params,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data as ManualGrantResult;
  }
}

export const subscriptionPaymentService = new SubscriptionPaymentService();
