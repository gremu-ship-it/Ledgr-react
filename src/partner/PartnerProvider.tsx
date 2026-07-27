import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import { resolveHost } from '@/lib/partnerDomain';
import { brandingFor, type Partner } from '@/types/partners';
import { PartnerContext, type PartnerContextValue } from './PartnerContext';

const CACHE_KEY = 'ledgr-partner-cache';

/** Cached tenant so branded pages don't flash the default Ledgr theme. */
function readCache(hostKey: string): Partner | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hostKey: string; partner: Partner };
    return parsed.hostKey === hostKey ? parsed.partner : null;
  } catch {
    return null;
  }
}

function writeCache(hostKey: string, partner: Partner | null) {
  try {
    if (partner) window.localStorage.setItem(CACHE_KEY, JSON.stringify({ hostKey, partner }));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Resolves the white-label tenant for the current host (nbs.ledgr.com or a
 * custom domain like accounting.nbsmw.com) and exposes its branding and
 * feature flags to the whole app.
 */
export function PartnerProvider({ children }: { children: ReactNode }) {
  const host = useMemo(() => resolveHost(), []);
  const hostKey = host.slug ?? host.customDomain ?? 'platform';
  const isTenant = Boolean(host.slug || host.customDomain);

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const { data, isLoading } = useQuery({
    queryKey: ['partner-tenant', hostKey, nonce],
    enabled: isTenant,
    staleTime: 5 * 60_000,
    initialData: isTenant
      ? () => {
          const cached = readCache(hostKey);
          return cached ? { partner: cached, flags: {} as Record<string, boolean> } : undefined;
        }
      : undefined,
    queryFn: async () => {
      const partner = host.slug
        ? await PartnerRepository.getBySlug(host.slug)
        : await PartnerRepository.getByCustomDomain(host.customDomain!);
      writeCache(hostKey, partner);
      const flags = partner ? await PartnerRepository.getFeatureFlags(partner.id) : {};
      return { partner, flags };
    },
  });

  const partner = isTenant ? data?.partner ?? null : null;
  const featureFlags = useMemo(() => (isTenant ? data?.flags ?? {} : {}), [isTenant, data]);

  const value = useMemo<PartnerContextValue>(
    () => ({
      partner,
      branding: brandingFor(partner),
      featureFlags,
      loading: isTenant && isLoading,
      host,
      // Unknown/unseeded key defaults to enabled so a partner never loses a
      // module just because its flag row hasn't been written yet.
      isFeatureEnabled: (key) => (partner ? featureFlags[key] !== false : true),
      reload,
    }),
    [partner, featureFlags, isTenant, isLoading, host, reload],
  );

  return <PartnerContext.Provider value={value}>{children}</PartnerContext.Provider>;
}
