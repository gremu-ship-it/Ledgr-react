import { useState } from 'react';
import { Cookie, X } from 'lucide-react';
import { useCookieConsent } from '@/lib/cookieConsent';

/**
 * Shows once on first visit (until the person decides, or 1 year passes —
 * whichever comes first, since consent is stored in a cookie with a 1-year
 * max-age). Mount this once near the root of the app, e.g. alongside
 * <InstallPrompt /> in App.tsx, so it's available on every route.
 */
export function CookieConsentBanner() {
  const { hasDecided, updateConsent } = useCookieConsent();
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  if (hasDecided) return null;

  function acceptAll() {
    updateConsent(true, true);
  }

  function rejectNonEssential() {
    updateConsent(false, false);
  }

  function saveCustom() {
    updateConsent(analytics, marketing);
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-card p-4 shadow-2xl sm:p-5">
      <div className="mx-auto max-w-4xl">
        {!customizing ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10">
                <Cookie className="h-4 w-4 text-brand-600 dark:text-brand-300" />
              </div>
              <p className="text-sm text-sub">
                We use essential cookies to keep you signed in and Ledgr running.
                With your permission, we'd also like to use analytics and marketing
                cookies to improve the product. You can change this anytime in{' '}
                <span className="font-medium text-ink">Settings → Privacy</span>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              <button
                onClick={() => setCustomizing(true)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors"
              >
                Customize
              </button>
              <button
                onClick={rejectNonEssential}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors"
              >
                Reject non-essential
              </button>
              <button
                onClick={acceptAll}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                Accept all
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Cookie preferences</h3>
              <button onClick={() => setCustomizing(false)} className="text-muted hover:text-sub">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">Essential</p>
                  <p className="text-xs text-muted">Required for sign-in and core functionality. Always on.</p>
                </div>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
                  Always on
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">Analytics</p>
                  <p className="text-xs text-muted">Helps us understand how Ledgr is used, so we can improve it.</p>
                </div>
                <button
                  onClick={() => setAnalytics((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${analytics ? 'bg-brand-600' : 'bg-surface'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${analytics ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">Marketing</p>
                  <p className="text-xs text-muted">Used for tailored offers and communications.</p>
                </div>
                <button
                  onClick={() => setMarketing((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${marketing ? 'bg-brand-600' : 'bg-surface'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${marketing ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveCustom}
                className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                Save preferences
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
