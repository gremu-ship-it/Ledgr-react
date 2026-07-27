import { useState, useEffect, useCallback } from 'react';
import { PartnerRepository } from '../dal/repositories/PartnerRepository';
import type { Partner } from '../types/partners';

export function usePartner() {
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});

  const loadPartnerByDomain = useCallback(async (domain?: string) => {
    setLoading(true);
    try {
      const hostname = domain || window.location.hostname;
      // Try exact domain match first
      let p = await PartnerRepository.getByDomain(hostname);
      // Fallback to subdomain pattern: *.ledgr.com -> ledgr or partner domain
      if (!p && hostname.includes('.')) {
        const subdomain = hostname.split('.')[0];
        const { data } = await (await import('../lib/supabase')).supabase
          .from('partners')
          .select('*')
          .ilike('domain', `%${subdomain}%`)
          .limit(1);
        if (data && data.length > 0) p = data[0] as Partner;
      }
      if (p) {
        setPartner(p);
        const flags = await PartnerRepository.getFeatureFlags(p.id);
        setFeatureFlags(flags);
      } else {
        setPartner(null);
        setFeatureFlags({});
      }
    } catch {
      setPartner(null);
      setFeatureFlags({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartnerByDomain();
  }, [loadPartnerByDomain]);

  return { partner, loading, featureFlags, reload: () => loadPartnerByDomain() };
}
