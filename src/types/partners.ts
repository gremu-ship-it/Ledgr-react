/** Feature keys that a partner (bank/MFI) can switch on or off for its clients. */
export const PARTNER_FEATURE_KEYS = [
  'ai_advisor',
  'payroll',
  'inventory',
  'multi_currency',
  'bank_reconciliation',
] as const;

export type PartnerFeatureKey = (typeof PARTNER_FEATURE_KEYS)[number];

export const PARTNER_FEATURE_LABELS: Record<PartnerFeatureKey, string> = {
  ai_advisor: 'AI Advisor',
  payroll: 'Payroll',
  inventory: 'Inventory',
  multi_currency: 'Multi-currency',
  bank_reconciliation: 'Bank reconciliation',
};

export const PARTNER_FEATURE_DESCRIPTIONS: Record<PartnerFeatureKey, string> = {
  ai_advisor: 'Ledgr AI insights, cash-flow advice and the chat advisor.',
  payroll: 'Employees, payslips, PAYE and pension schedules.',
  inventory: 'Products, stock levels, warehouses and transfers.',
  multi_currency: 'Foreign-currency transactions and IAS 21 revaluation.',
  bank_reconciliation: 'Statement import and automated matching.',
};

/** A lite offering (small MFI) vs a full offering (bank). */
export const PARTNER_FEATURE_PRESETS: Record<'lite' | 'full', Record<PartnerFeatureKey, boolean>> = {
  lite: {
    ai_advisor: false,
    payroll: false,
    inventory: false,
    multi_currency: false,
    bank_reconciliation: false,
  },
  full: {
    ai_advisor: true,
    payroll: true,
    inventory: true,
    multi_currency: true,
    bank_reconciliation: true,
  },
};

export interface Partner {
  id: string;
  name: string;
  /** Subdomain label — nbs => nbs.ledgr.com */
  slug: string | null;
  /** Legacy single-domain column, kept for backwards compatibility. */
  domain: string | null;
  /** Vanity domain, e.g. accounting.nbsmw.com */
  custom_domain: string | null;
  logo_url: string | null;
  primary_colour: string;
  support_email: string | null;
  support_phone: string | null;
  app_name: string;
  onboarding_title: string | null;
  onboarding_subtitle: string | null;
  client_limit: number;
  allow_client_visibility: boolean;
  is_active: boolean;
  billing_email: string | null;
  billing_contact_name: string | null;
  price_per_client: number;
  billing_currency: string;
  created_at: string;
  updated_at: string;
}

export interface PartnerFeatureFlag {
  partner_id: string;
  feature_key: string;
  enabled: boolean;
}

export interface PartnerClientUsage {
  partner_id: string;
  business_id: string;
  business_name: string;
  plan_tier: string | null;
  is_active: boolean | null;
  onboarded_at: string;
  journal_entry_count: number;
  invoice_count: number;
  user_count: number;
  last_activity_at: string | null;
}

export interface PartnerInvoice {
  id: string;
  partner_id: string;
  invoice_number: string | null;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  client_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePartnerDto {
  name: string;
  slug?: string | null;
  custom_domain?: string | null;
  logo_url?: string | null;
  primary_colour?: string;
  support_email?: string | null;
  support_phone?: string | null;
  app_name?: string;
  onboarding_title?: string | null;
  onboarding_subtitle?: string | null;
  client_limit?: number;
  allow_client_visibility?: boolean;
  billing_email?: string | null;
  billing_contact_name?: string | null;
  price_per_client?: number;
  billing_currency?: string;
  is_active?: boolean;
}

export type UpdatePartnerDto = Partial<CreatePartnerDto>;

/** Resolved branding used by the app shell / auth pages. */
export interface PartnerBranding {
  appName: string;
  logoUrl: string | null;
  primaryColour: string;
  supportEmail: string | null;
  supportPhone: string | null;
  onboardingTitle: string;
  onboardingSubtitle: string | null;
}

export const DEFAULT_BRANDING: PartnerBranding = {
  appName: 'Ledgr',
  logoUrl: null,
  primaryColour: '#0F766E',
  supportEmail: 'support@ledgr.com',
  supportPhone: null,
  onboardingTitle: 'Create your Ledgr account',
  onboardingSubtitle: null,
};

export function brandingFor(partner: Partner | null): PartnerBranding {
  if (!partner) return DEFAULT_BRANDING;
  const appName = partner.app_name || partner.name || DEFAULT_BRANDING.appName;
  return {
    appName,
    logoUrl: partner.logo_url ?? null,
    primaryColour: partner.primary_colour || DEFAULT_BRANDING.primaryColour,
    supportEmail: partner.support_email ?? DEFAULT_BRANDING.supportEmail,
    supportPhone: partner.support_phone ?? null,
    onboardingTitle: partner.onboarding_title || `Create your ${appName} account`,
    onboardingSubtitle: partner.onboarding_subtitle ?? null,
  };
}
