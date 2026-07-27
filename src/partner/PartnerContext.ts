import { createContext, useContext } from 'react';
import type { HostResolution } from '@/lib/partnerDomain';
import {
  DEFAULT_BRANDING,
  type Partner,
  type PartnerBranding,
  type PartnerFeatureKey,
} from '@/types/partners';

export interface PartnerContextValue {
  /** Null when running on the plain platform domain (no white-label tenant). */
  partner: Partner | null;
  branding: PartnerBranding;
  featureFlags: Record<string, boolean>;
  /** True while the tenant is still being resolved from the host. */
  loading: boolean;
  host: HostResolution;
  /**
   * Whether a module is available. Without a partner everything is on
   * (subscription plan gating still applies); with a partner, an explicitly
   * disabled flag wins.
   */
  isFeatureEnabled: (key: PartnerFeatureKey) => boolean;
  reload: () => void;
}

export const PartnerContext = createContext<PartnerContextValue>({
  partner: null,
  branding: DEFAULT_BRANDING,
  featureFlags: {},
  loading: false,
  host: { slug: null, customDomain: null, isAdminHost: false, isPlatformHost: true },
  isFeatureEnabled: () => true,
  reload: () => {},
});

/** Current white-label tenant (resolved from the browser host). */
export function usePartner(): PartnerContextValue {
  return useContext(PartnerContext);
}

/** Convenience hook for a single module flag. */
export function usePartnerFeature(key: PartnerFeatureKey): boolean {
  return usePartner().isFeatureEnabled(key);
}
