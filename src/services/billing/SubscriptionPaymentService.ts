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

type EdgeFunctionErrorBody = {
  error?: string;
  message?: string;
};

function getFunctionDisplayName(functionName: string): string {
  if (functionName === 'initiate-subscription-payment') return 'payments checkout service';
  if (functionName === 'verify-subscription-payment') return 'payment verification service';
  if (functionName === 'grant-manual-subscription') return 'manual subscription grant service';
  return functionName;
}

async function readEdgeFunctionError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as EdgeFunctionErrorBody;
    return parsed.error || parsed.message || fallback;
  } catch {
    return text || fallback;
  }
}

function getNetworkErrorMessage(functionName: string, error: unknown): string {
  const displayName = getFunctionDisplayName(functionName);
  const cause =
    typeof error === 'object' && error !== null && 'context' in error
      ? (error as { context?: unknown }).context
      : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;

  return [
    `Could not reach the ${displayName}.`,
    `Please make sure the Supabase Edge Function "${functionName}" is deployed and reachable, then try again.`,
    causeMessage ? `Details: ${causeMessage}` : null,
  ].filter(Boolean).join(' ');
}

async function invokeEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error, response } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    if (response) {
      const message = await readEdgeFunctionError(response, error.message);
      throw new Error(message);
    }

    throw new Error(getNetworkErrorMessage(functionName, error));
  }

  const maybeError = data as EdgeFunctionErrorBody | null;
  if (maybeError?.error) throw new Error(maybeError.error);

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
