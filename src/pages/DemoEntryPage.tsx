/**
 * `/demo/enter` — the one-click demo account.
 *
 * This is the URL the marketing site (or any external Vercel project) links
 * to. It has no form and asks for nothing: on mount it switches the app into
 * demo mode, which swaps the Supabase client for the in-memory demo client and
 * signs the visitor in as `demo@ledgr.test` on the seeded "Lilongwe Trading
 * Ltd" books, then navigates into the app.
 *
 * `?to=/invoices` deep-links somewhere specific after entry. Only same-origin
 * paths are honoured, so the parameter can never be used as an open redirect.
 *
 * If anything goes wrong (storage disabled, a seeding bug) the visitor gets a
 * readable card with the two ways forward — the static product tour at
 * `/demo` and real sign-up — instead of a blank screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { enterDemoMode } from '@/lib/demo/session';
import { DEMO_EMAIL } from '@/lib/demo/constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('DemoEntryPage');

function safeDestination(raw: string | null): string {
  if (!raw) return '/dashboard';
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch {
    /* fall through */
  }
  return '/dashboard';
}

export function DemoEntryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const destination = useMemo(() => safeDestination(searchParams.get('to')), [searchParams]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Entering the demo loads the seeded-books chunk, builds (or restores) the
    // snapshot and writes the demo identity into the app store. All async, so
    // the redirect happens in the callback and this page shows its spinner
    // until the app is ready to render behind it.
    enterDemoMode()
      .then(() => {
        if (cancelled) return;
        // replace so the browser's back button leaves the app rather than
        // re-entering (and re-seeding) the demo.
        navigate(destination, { replace: true });
      })
      .catch((err) => {
        log.error('Failed to enter demo mode', err as Error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, destination]);

  if (failed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">We couldn&apos;t start the demo</h1>
          <p className="mt-2 text-sm text-gray-600">
            The demo runs entirely in your browser, so it needs local storage enabled. Try again in a
            normal (not private) window, or take the static product tour instead.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              to="/demo"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400"
            >
              See the product tour
            </Link>
            <Link
              to="/register"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Create a free account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-gray-50 px-4">
      <LoadingSpinner size="lg" label="Opening the demo account…" />
      <p className="text-sm font-medium text-gray-700">Opening the demo account…</p>
      <p className="max-w-sm text-center text-xs text-gray-500">
        Signing you in as <span className="font-medium text-gray-700">{DEMO_EMAIL}</span> — no
        password, no sign-up. Everything you do stays in this browser.
      </p>
    </div>
  );
}
