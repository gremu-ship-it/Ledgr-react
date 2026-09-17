import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import * as Sentry from '@sentry/react';
import { supabase } from '@/lib/supabase';
import { attemptChunkRecovery, clearChunkRecovery } from '@/lib/chunkRecovery';
import { initErrorCapture } from '@/lib/errorCapture';
import { queryClient } from '@/lib/queryClient';
import { persistOptions, clearPersistedCache } from '@/lib/queryPersister';
import './index.css';
import './i18n';
import App from './App.tsx';
import { registerLedgrServiceWorker } from '@/offline/registerServiceWorker';
import { isDemoMode } from '@/lib/demo/mode';
import { loadDemoClient } from '@/lib/demo/loader';

// Automatically recover once if Vite encounters a module preload failure
// (e.g. after a deployment invalidates old chunk filenames).
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    attemptChunkRecovery('vite_preload');
  });
  clearChunkRecovery('vite_preload');

  // Begin capturing client-side errors so the Support Agent can attach
  // sanitised diagnostics when a user reports a problem.
  initErrorCapture();

  // Register early so Workbox can precache the app shell and begin managing
  // updates. The wrapper also exposes registration lifecycle events to React.
  registerLedgrServiceWorker();
}

// --- Sentry (frontend) ------------------------------------------------------
// Anonymised error reporting: sendDefaultPii is OFF and beforeSend strips any
// accidental PII. A non-PII user id (the Supabase auth uuid) is attached on
// login so we can correlate errors per account without storing personal data.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      // Defence-in-depth: never let cookies/extra free-text leave the client.
      if (event.request?.cookies) delete event.request.cookies;
      if (event.extra) event.extra = {};
      return event;
    },
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id) {
      Sentry.setUser({ id: session.user.id });
    } else {
      Sentry.setUser(null);
    }
  });
}

function startApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <App />
        {/* Vercel Web Analytics + Speed Insights (Core Web Vitals) */}
        <Analytics />
        <SpeedInsights />
      </PersistQueryClientProvider>
    </StrictMode>,
  );

  // Wipe all locally-cached data on explicit logout so another user on a
  // shared device cannot read cached rows or form drafts belonging to the
  // previous account. Supabase RLS already blocks server-side access to
  // other tenants, but defense-in-depth says we don't leave financial data
  // sitting in the browser after sign-out.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      void clearPersistedCache();
      try {
        // Only clear ledgr-prefixed keys so we don't touch third-party
        // entries (Supabase session, analytics, etc.) that manage their
        // own lifecycle.
        const toRemove: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && k.startsWith('ledgr_')) toRemove.push(k);
        }
        for (const k of toRemove) window.sessionStorage.removeItem(k);
      } catch {
        // storage access disabled; ignore
      }
    }
  });
}

// A page load that starts already inside the demo (a refresh deep in the tour)
// needs the demo engine in memory before the first render, so the client facade
// answers from the seeded tables instead of falling back to the network.
// Everyone else renders immediately and never downloads that chunk — the seeded
// books are ~33 kB gzipped that a signed-in user has no use for.
if (isDemoMode()) {
  void loadDemoClient().then(startApp, startApp);
} else {
  startApp();
}
