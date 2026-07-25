export type Theme = 'light' | 'dark';

import type { SupportedLanguage } from '@/i18n/types';

export interface UserProfile {
  full_name?: string | null;
  avatar_url?: string | null;
  preferred_language?: SupportedLanguage | null;
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
}

export interface BusinessMembership {
  id?: string;
  role: string;
  business: Business;
}