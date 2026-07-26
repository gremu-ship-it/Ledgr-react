export type PlanTier = 'free' | 'growth' | 'pro' | 'enterprise';

export interface Plan {
  tier: PlanTier;
  name: string;
  priceMWK: number;           // Monthly price in MWK
  annualDiscount: number;     // % discount for annual billing
  transactionLimit: number | null; // null = unlimited
  features: string[];
  popular?: boolean;
}

export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    priceMWK: 0,
    annualDiscount: 0,
    transactionLimit: 100,
    features: [
      'Basic dashboard & reports',
      'Income & expense tracking',
      'Up to 100 transactions/month',
      'Community support',
    ],
  },
  growth: {
    tier: 'growth',
    name: 'Growth',
    priceMWK: 15000,
    annualDiscount: 20,
    transactionLimit: 500,
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
    priceMWK: 35000,
    annualDiscount: 20,
    transactionLimit: 2000,
    popular: true,
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
    priceMWK: 75000,
    annualDiscount: 25,
    transactionLimit: null,
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

export function getPlan(tier: PlanTier): Plan {
  return PLANS[tier];
}

export function getTransactionLimit(tier: PlanTier): number | null {
  return PLANS[tier].transactionLimit;
}

export function isUnlimited(tier: PlanTier): boolean {
  return PLANS[tier].transactionLimit === null;
}