export type PlanTier = 'free' | 'growth' | 'pro' | 'enterprise';

/**
 * Discrete, gate-able capabilities. Each plan's `capabilities` list is
 * cumulative (a higher tier includes everything the tiers below it have)
 * so `hasCapability()` is a simple membership check.
 */
export type PlanCapability =
  | 'bank_reconciliation'
  | 'ai_insights'
  | 'api_access'
  | 'webhooks'
  | 'custom_branding';

export interface Plan {
  tier: PlanTier;
  name: string;
  priceMWK: number;           // Monthly price in MWK
  annualDiscount: number;     // % discount for annual billing
  transactionLimit: number | null; // null = unlimited
  features: string[];
  capabilities: PlanCapability[];
  popular?: boolean;
}

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    priceMWK: 0,
    annualDiscount: 0,
    transactionLimit: 50,
    capabilities: [],
    features: [
      'Basic dashboard & reports',
      'Income & expense tracking',
      'Up to 50 transactions/month',
      'Community support',
    ],
  },
  growth: {
    tier: 'growth',
    name: 'Growth',
    priceMWK: 100000,
    annualDiscount: 20,
    transactionLimit: 500,
    capabilities: ['bank_reconciliation'],
    features: [
      'Everything in Free',
      'Bank reconciliation',
      'Basic financial reports',
      'Up to 500 transactions/month',
      'Email support',
    ],
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    priceMWK: 200000,
    annualDiscount: 20,
    transactionLimit: 2000,
    popular: true,
    capabilities: ['bank_reconciliation', 'ai_insights', 'api_access', 'webhooks'],
    features: [
      'Everything in Growth',
      'AI Insights & forecasting',
      'Public API access',
      'Webhook integrations',
      'Up to 2,000 transactions/month',
      'Priority support',
    ],
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    priceMWK: 500000,
    annualDiscount: 25,
    transactionLimit: null,
    capabilities: ['bank_reconciliation', 'ai_insights', 'api_access', 'webhooks', 'custom_branding'],
    features: [
      'Everything in Pro',
      'Unlimited transactions',
      'Custom branding',
      'Multi-user roles & permissions',
      'Dedicated account manager',
      'SLA & compliance support',
    ],
  },
};

/** Ordered lowest → highest, used for "next tier up" style logic. */
export const PLAN_TIER_ORDER: PlanTier[] = ['free', 'growth', 'pro', 'enterprise'];

export function getPlan(tier: PlanTier): Plan {
  return PLANS[tier];
}

export function getTransactionLimit(tier: PlanTier): number | null {
  return PLANS[tier].transactionLimit;
}

export function isUnlimited(tier: PlanTier): boolean {
  return PLANS[tier].transactionLimit === null;
}

/** True if `tier`'s plan includes the given capability. */
export function hasCapability(tier: PlanTier, capability: PlanCapability): boolean {
  return PLANS[tier].capabilities.includes(capability);
}

/** The cheapest plan that unlocks `capability`, or null if none do (shouldn't happen). */
export function planRequiredFor(capability: PlanCapability): Plan | null {
  const tier = PLAN_TIER_ORDER.find((t) => PLANS[t].capabilities.includes(capability));
  return tier ? PLANS[tier] : null;
}

export function isValidPlanTier(value: unknown): value is PlanTier {
  return value === 'free' || value === 'growth' || value === 'pro' || value === 'enterprise';
}

/** Coerces any stored/unknown value to a valid PlanTier, defaulting to 'free'. */
export function normalizePlanTier(value: unknown): PlanTier {
  return isValidPlanTier(value) ? value : 'free';
}

export type BillingCycle = 'monthly' | 'annual';

/**
 * Total amount due for one billing cycle, in MWK. Mirrors the
 * `computeAmount` logic in supabase/functions/initiate-subscription-payment
 * — keep both in sync if pricing changes.
 */
export function computePriceMWK(tier: PlanTier, cycle: BillingCycle): number {
  const monthly = PLANS[tier].priceMWK;
  if (cycle === 'monthly') return monthly;
  const discount = PLANS[tier].annualDiscount;
  return Math.round(monthly * 12 * (1 - discount / 100));
}
