export type Theme = 'light' | 'dark';

export interface UserProfile {
  full_name?: string | null;
  avatar_url?: string | null;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  profile?: UserProfile | null;
}

export interface Business {
  id: string;
  name: string;
}

export interface BusinessMembership {
  id?: string;
  role: string;
  business: Business;
}