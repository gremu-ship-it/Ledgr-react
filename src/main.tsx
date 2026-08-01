import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import * as Sentry from '@sentry/react';
import { supabase } from '@/lib/supabase';
import { attemptChunkRecovery, clearChunkRecovery } from '@/lib/chunkRecovery';
import { initErrorCapture } from '@/lib/errorCapture';
import { queryClient } from '@/lib/queryClient';
import './index.css';
import './i18n';
import App from './App.tsx';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* Vercel Web Analytics + Speed Insights (Core Web Vitals) */}
      <Analytics />
      <SpeedInsights />
    </QueryClientProvider>
  </StrictMode>,
);
