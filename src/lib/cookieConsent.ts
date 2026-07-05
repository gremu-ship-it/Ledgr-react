// src/lib/cookieConsent.ts
//
// Shared cookie-consent state for the consent banner and the Privacy
// Settings page. Consent is stored in a first-party cookie (not
// localStorage) so it naturally expires after 1 year via max-age, rather
// than needing manual expiry-checking logic.
//
// Categories:
//   essential  — always on, not user-toggleable (session/auth, security).
//                Ledgr can't function without these (Supabase Auth relies
//                on them), so there's nothing to actually "consent" to here
//                beyond being informed.
//   analytics  — off by default. No analytics tool is wired up yet, but
//                this flag is what any future analytics integration should
//                check before loading/firing, so consent is respected from
//                day one instead of retrofitted later.
//   marketing  — off by default. Same forward-looking purpose as analytics.

import { useEffect, useState } from 'react';

export interface CookieConsent {
  essential: true; // always true, kept in the type for completeness/UI display
  analytics: boolean;
  marketing: boolean;
  decidedAt: string; // ISO timestamp of when this consent was recorded
}

const COOKIE_NAME = 'ledgr_cookie_consent';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax; Secure`;
}

export function getStoredConsent(): CookieConsent | null {
  if (typeof document === 'undefined') return null; // SSR/edge guard, harmless in a pure SPA too
  const raw = readCookie(COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CookieConsent;
    if (typeof parsed.analytics !== 'boolean' || typeof parsed.marketing !== 'boolean') return null;
    return { ...parsed, essential: true };
  } catch {
    return null;
  }
}

export function saveConsent(analytics: boolean, marketing: boolean): CookieConsent {
  const consent: CookieConsent = {
    essential: true,
    analytics,
    marketing,
    decidedAt: new Date().toISOString(),
  };
  writeCookie(COOKIE_NAME, JSON.stringify(consent), ONE_YEAR_SECONDS);
  return consent;
}

/**
 * React hook for reading/updating consent. Both the banner and the Privacy
 * Settings page use this so they always stay in sync — updating one updates
 * the other immediately via a shared custom event.
 */
const CONSENT_EVENT = 'ledgr:cookie-consent-changed';

export function useCookieConsent() {
  const [consent, setConsentState] = useState<CookieConsent | null>(() => getStoredConsent());

  useEffect(() => {
    function handleChange() {
      setConsentState(getStoredConsent());
    }
    window.addEventListener(CONSENT_EVENT, handleChange);
    return () => window.removeEventListener(CONSENT_EVENT, handleChange);
  }, []);

  function updateConsent(analytics: boolean, marketing: boolean) {
    const next = saveConsent(analytics, marketing);
    setConsentState(next);
    window.dispatchEvent(new Event(CONSENT_EVENT));
    return next;
  }

  return { consent, updateConsent, hasDecided: consent !== null };
}