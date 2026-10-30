import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { Business } from '@/types';

export interface BusinessProfile extends Omit<Business, 'operating_models'> {
  operating_models: string[];
}

/**
 * Returns the active business profile from the session store, exposing
 * `profile.operating_models` as `string[]`.
 */
export function useBusinessProfile(): { profile: BusinessProfile | null } {
  const business = useAppStore((s) => s.currentBusiness?.business ?? null);

  const profile = useMemo<BusinessProfile | null>(() => {
    if (!business) return null;
    return {
      ...business,
      operating_models: business.operating_models ? [...business.operating_models] : [],
    };
  }, [business]);

  return { profile };
}
