import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { resolveHost } from '@/lib/partnerDomain';
import {
  DEFAULT_BRANDING,
  brandingFor,
  type Partner,
  type PartnerBranding,
} from '@/types/partners';
import { PartnerContext, type PartnerContextValue } from './PartnerContext';

const CACHE_KEY = 'ledgr-partner-cache';
const CACHE_VERSION = 2;

type BrandingCache = {
  version: typeof CACHE_VERSION;
  hostKey: string;
  branding: PartnerBranding;
};

/** Only public presentation fields are cached; never the full partner row. */
function readBrandingCache(hostKey: string): PartnerBranding | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrandingCache>;
    return parsed.version === CACHE_VERSION && parsed.hostKey === hostKey && parsed.branding
      ? parsed.branding
      : null;
  } catch {
    return null;
  }
}

function writeBrandingCache(hostKey: string, partner: Partner | null) {
  try {
    if (partner) {
      const value: BrandingCache = {
        version: CACHE_VERSION,
        hostKey,
        branding: brandingFor(partner),
      };
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Resolve the white-label tenant while caching presentation data only. */
export function PartnerProvider({ children }: { children: ReactNode }) {
  const host = useMemo(() => resolveHost(), []);
  const hostKey = host.slug ?? host.customDomain ?? 'platform';
  const isTenant = Boolean(host.slug || host.customDomain);
  const [cachedBranding] = useState<PartnerBranding | null>(() =>
    isTenant ? readBrandingCache(hostKey) : null,
  );

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const { data, isLoading } = useQuery({
    queryKey: ['partner-tenant', hostKey, nonce],
    enabled: isTenant,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const partner = host.slug
        ? await PartnerRepository.getBySlug(host.slug)
        : await PartnerRepository.getByCustomDomain(host.customDomain!);
      writeBrandingCache(hostKey, partner);
      const flags = partner ? await PartnerRepository.getFeatureFlags(partner.id) : {};
      return { partner, flags };
    },
  });

  const partner = isTenant ? data?.partner ?? null : null;
  const branding = partner
    ? brandingFor(partner)
    : isTenant
      ? cachedBranding ?? DEFAULT_BRANDING
      : DEFAULT_BRANDING;
  const featureFlags = useMemo(() => (isTenant ? data?.flags ?? {} : {}), [isTenant, data]);

  const value = useMemo<PartnerContextValue>(
    () => ({
      partner,
      branding,
      featureFlags,
      loading: isTenant && isLoading,
      host,
      isFeatureEnabled: (key) => (partner ? featureFlags[key] !== false : true),
      reload,
    }),
    [partner, branding, featureFlags, isTenant, isLoading, host, reload],
  );

  return <PartnerContext.Provider value={value}>{children}</PartnerContext.Provider>;
}
