export type Theme = 'light' | 'dark';

import type { SupportedLanguage } from '@/i18n/types';
import type {
  CapabilityOverrides,
  OperatingModel,
  OrganisationType,
} from '@/lib/capabilities/profile';

export interface UserProfile {
  full_name?: string | null;
  avatar_url?: string | null;
  preferred_language?: SupportedLanguage | null;
  is_platform_admin?: boolean | null;
}


export interface CurrentUser {
  id: string;
  email: string | null;
  profile?: UserProfile | null;
}

export interface Business {
  id: string;
  name: string;
  base_currency?: string | null;
  plan_tier?: string | null;
  /** New profile columns are optional in the app type to hydrate old cached rows safely. */
  organisation_type?: OrganisationType | null;
  operating_models?: OperatingModel[] | null;
  capability_overrides?: CapabilityOverrides | null;
}


export interface BusinessMembership {
  id?: string;
  role: string;
  business: Business;
}