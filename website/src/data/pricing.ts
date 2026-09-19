/**
 * Pricing data — mirrors src/lib/billing/plans.ts in the app.
 * Keep in sync when plans change (eventual goal: share one source across the
 * monorepo via a packages/ folder — see STRUCTURE.md §4 "Pricing").
 */
export interface Plan {
  tier: 'free' | 'starter' | 'growth' | 'pro' | 'enterprise';
  name: string;
  /** Monthly price in MWK. */
  priceMWK: number;
  /** % discount when billed annually. */
  annualDiscount: number;
  /** null = unlimited. */
  transactionLimit: number | null;
  features: string[];
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    tier: 'free',
    name: 'Free',
    priceMWK: 0,
    annualDiscount: 0,
    transactionLimit: 50,
    features: [
      'Basic dashboard',
      'Finance: income, expenses, invoices & payroll',
      'Up to 50 transactions/month',
      'Community support',
    ],
  },
  {
    tier: 'starter',
    name: 'Starter',
    priceMWK: 50_000,
    annualDiscount: 0,
    transactionLimit: 200,
    features: [
      'Everything in Free',
      'Inventory: products, warehouses & stock transfers',
      'Accounts, Tax, Assets, Capital & Reports',
      'Up to 200 transactions/month',
    ],
  },
  {
    tier: 'growth',
    name: 'Growth',
    priceMWK: 100_000,
    annualDiscount: 20,
    transactionLimit: 500,
    features: [
      'Everything in Starter',
      'Bank reconciliation',
      'Accounting & Organisation (full access)',
      'Basic financial reports',
      'Up to 500 transactions/month',
      'Email support',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    priceMWK: 200_000,
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
  {
    tier: 'enterprise',
    name: 'Enterprise',
    priceMWK: 500_000,
    annualDiscount: 25,
    transactionLimit: null,
    features: [
      'Everything in Pro',
      'Unlimited transactions',
      'Custom onboarding',
      'Dedicated support',
    ],
  },
];

export function formatMWK(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW')}`;
}
