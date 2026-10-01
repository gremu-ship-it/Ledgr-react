export type PlanTier = 'free' | 'starter' | 'growth' | 'pro' | 'enterprise';

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
  | 'custom_branding'
  | 'inventory'
  | 'core_accounting'          // Accounts, Tax, Assets, Capital and Reports (Starter+)
  | 'accounting_organisation';   // Accounting + Organisation modules (Growth+)

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
      'Basic dashboard',
      'Finance: income, expenses, invoices & payroll',
      'Up to 50 transactions/month',
      'Community support',
    ],
  },
  starter: {
    tier: 'starter',
    name: 'Starter',
    priceMWK: 50000,
    annualDiscount: 0,
    transactionLimit: 200,
    capabilities: ['inventory', 'core_accounting'],
    features: [
      'Everything in Free',
      'Inventory: products, warehouses & stock transfers',
      'Accounts, Tax, Assets, Capital & Reports',
      'Up to 200 transactions/month',
    ],
  },
  growth: {
    tier: 'growth',
    name: 'Growth',
    priceMWK: 100000,
    annualDiscount: 20,
    transactionLimit: 500,
    capabilities: ['inventory', 'core_accounting', 'bank_reconciliation', 'accounting_organisation'],
    features: [
      'Everything in Starter',
      'Bank reconciliation',
      'Accounting & Organisation (full access)',
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
    capabilities: ['inventory', 'core_accounting', 'bank_reconciliation', 'accounting_organisation', 'ai_insights', 'api_access', 'webhooks'],
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
    capabilities: ['inventory', 'core_accounting', 'bank_reconciliation', 'accounting_organisation', 'ai_insights', 'api_access', 'webhooks', 'custom_branding'],
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
export const PLAN_TIER_ORDER: PlanTier[] = ['free', 'starter', 'growth', 'pro', 'enterprise'];

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
  return value === 'free' || value === 'starter' || value === 'growth' || value === 'pro' || value === 'enterprise';
}

/** Coerces any stored/unknown value to a valid PlanTier, defaulting to 'free'. */
export function normalizePlanTier(value: unknown): PlanTier {
  return isValidPlanTier(value) ? value : 'free';
}

/**
 * True when a paid term has lapsed.
 *
 * A null/blank `plan_expires_at` means "no end date" (Free, or a comped /
 * lifetime plan) and is never treated as expired. An unparseable value is
 * also treated as not-expired — failing open here matches the rest of the
 * billing code, which never blocks a user because a date could not be read.
 */
export function isPlanExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return false;
  return expiry <= now.getTime();
}

/**
 * The tier a business is actually entitled to right now.
 *
 * `businesses.plan_tier` alone is NOT an entitlement: it keeps its paid
 * value until the daily `expire-subscriptions` cron downgrades the row. If
 * that job is late, broken or unscheduled, every entitlement check that
 * reads `plan_tier` directly keeps serving paid features long after the
 * term ended (exactly what happened before 2026-10-01). Resolve the tier
 * through this helper wherever access or limits are decided, so the cron
 * is just row tidy-up rather than the only thing enforcing expiry.
 */
export function effectivePlanTier(
  tier: unknown,
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): PlanTier {
  const normalized = normalizePlanTier(tier);
  if (normalized === 'free') return 'free';
  return isPlanExpired(expiresAt, now) ? 'free' : normalized;
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

/**
 * End of a paid term that starts at `from`.
 *
 * Calendar arithmetic, not a fixed day count: "monthly" means the same day
 * of the next month (clamped to that month's last day, so 31 Jan → 28/29
 * Feb) and "annual" means the same date next year. The previous fixed
 * 31-day / 365-day windows meant a monthly subscription bought on the 1st
 * stayed active into the 2nd of the following month, and annual terms were
 * a day short across a leap year.
 *
 * Mirrors `computeTermEnd` in
 * supabase/functions/initiate-subscription-payment — keep both in sync.
 */
export function computeTermEnd(from: Date, cycle: BillingCycle): Date {
  const end = new Date(from.getTime());
  const day = end.getUTCDate();

  if (cycle === 'annual') {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    // 29 Feb + 1 year → 1 Mar without this clamp.
    if (end.getUTCDate() !== day) end.setUTCDate(0);
    return end;
  }

  // Move to the 1st first so that e.g. 31 Jan + 1 month doesn't roll over
  // into March, then clamp the day to the target month's length.
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDayOfTargetMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return end;
}
