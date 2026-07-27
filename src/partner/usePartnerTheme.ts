import { useEffect } from 'react';
import { applyBrandColors } from '@/lib/brandColors';
import { usePartner } from './PartnerContext';

/**
 * Applies the partner's primary colour to the global brand scale and swaps
 * the document title / favicon so a bank tenant never sees Ledgr branding.
 *
 * Business-level branding (useBrandTheme) still wins inside the app shell —
 * this is the fallback identity for auth pages and any chrome outside a
 * selected business.
 */
export function usePartnerTheme(enabled = true) {
  const { partner, branding } = usePartner();

  useEffect(() => {
    if (!enabled || !partner) return;
    applyBrandColors(branding.primaryColour);
    document.title = branding.appName;

    if (branding.logoUrl) {
      const link =
        (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null) ??
        (() => {
          const el = document.createElement('link');
          el.rel = 'icon';
          document.head.appendChild(el);
          return el;
        })();
      link.href = branding.logoUrl;
    }
  }, [enabled, partner, branding.primaryColour, branding.appName, branding.logoUrl]);

  return branding;
}
