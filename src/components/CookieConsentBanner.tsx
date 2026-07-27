import { useState, useId } from 'react';
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
  const headingId = useId();
  const analyticsId = useId();
  const marketingId = useId();

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
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white p-4 shadow-2xl sm:p-5"
      role="region"
      aria-label="Cookie consent"
    >
      <div className="mx-auto max-w-4xl">
        {!customizing ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50">
                <Cookie className="h-4 w-4 text-brand-700" aria-hidden="true" />
              </div>
              <p className="text-sm text-gray-700">
                We use essential cookies to keep you signed in and Ledgr running.
                With your permission, we'd also like to use analytics and marketing
                cookies to improve the product. You can change this anytime in{' '}
                <span className="font-medium text-gray-900">Settings → Privacy</span>.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setCustomizing(true)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Customize
              </button>
              <button
                type="button"
                onClick={rejectNonEssential}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Reject non-essential
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                Accept all
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4" aria-labelledby={headingId}>
            <div className="flex items-center justify-between">
              <h3 id={headingId} className="text-sm font-semibold text-gray-900">Cookie preferences</h3>
              <button
                type="button"
                onClick={() => setCustomizing(false)}
                aria-label="Close cookie preferences"
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">Essential</p>
                  <p className="text-xs text-gray-600">Required for sign-in and core functionality. Always on.</p>
                </div>
                <span
                  className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                  role="status"
                  aria-label="Essential cookies are always on"
                >
                  Always on
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <div>
                  <label htmlFor={analyticsId} className="text-sm font-medium text-gray-900 cursor-pointer">Analytics</label>
                  <p className="text-xs text-gray-600">Helps us understand how Ledgr is used, so we can improve it.</p>
                </div>
                <button
                  id={analyticsId}
                  type="button"
                  role="switch"
                  aria-checked={analytics}
                  onClick={() => setAnalytics((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${analytics ? 'bg-brand-600' : 'bg-gray-300'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${analytics ? 'translate-x-5' : 'translate-x-0.5'}`}
                  />
                  <span className="sr-only">{analytics ? 'Disable analytics cookies' : 'Enable analytics cookies'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                <div>
                  <label htmlFor={marketingId} className="text-sm font-medium text-gray-900 cursor-pointer">Marketing</label>
                  <p className="text-xs text-gray-600">Used for tailored offers and communications.</p>
                </div>
                <button
                  id={marketingId}
                  type="button"
                  role="switch"
                  aria-checked={marketing}
                  onClick={() => setMarketing((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${marketing ? 'bg-brand-600' : 'bg-gray-300'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${marketing ? 'translate-x-5' : 'translate-x-0.5'}`}
                  />
                  <span className="sr-only">{marketing ? 'Disable marketing cookies' : 'Enable marketing cookies'}</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
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
