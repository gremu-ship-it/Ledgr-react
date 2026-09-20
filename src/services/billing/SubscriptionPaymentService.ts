import { supabase } from '@/lib/supabase';
import { invokeFunction } from '@/lib/edgeFunctionErrors';
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

async function invokeEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  // Shared with every other call site: reads the function's own error body
  // instead of the SDK's constant "Edge Function returned a non-2xx status
  // code", and says something useful when the function never answered at all.
  const { data, failure } = await invokeFunction<T>(functionName, body);
  if (failure) throw new Error(failure.message);
  return data as T;
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
    return invokeEdgeFunction<InitiateCheckoutResult>('initiate-subscription-payment', {
      business_id: businessId,
      target_plan_tier: targetPlanTier,
      billing_cycle: billingCycle,
    });
  }

  async verifyPayment(txRef: string): Promise<VerifyPaymentResult> {
    return invokeEdgeFunction<VerifyPaymentResult>('verify-subscription-payment', {
      tx_ref: txRef,
    });
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
    return invokeEdgeFunction<ManualGrantResult>('grant-manual-subscription', {
      ...params,
    });
  }
}

export const subscriptionPaymentService = new SubscriptionPaymentService();
