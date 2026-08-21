import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Whether the Supabase client was configured with real credentials.
 * Used by the UI to show a helpful configuration error instead of a blank
 * white screen when env vars are missing (audit A-01 defense-in-depth).
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabaseConfigError = !isSupabaseConfigured
  ? new Error(
      'Missing Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
        'Check your .env file locally, or set them in Vercel Project → Settings → Environment Variables ' +
        'and GitHub → Settings → Secrets and variables → Actions (see DEPLOYMENT.md).',
    )
  : null;

if (!isSupabaseConfigured) {
  // Defense-in-depth: log loudly but do NOT throw at module scope.
  // Throwing here blanks the entire app before React can mount (production
  // incident 2026-08-16). The build-time guard (scripts/check-env.mjs) already
  // fails production builds without secrets; this runtime fallback ensures
  // preview / mis-configured builds show a readable error page instead of white.
  console.error(
    '[supabase] Missing environment variables: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. ' +
      'Using placeholder client — requests will fail. ' +
      'Set them in .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) or in Vercel / GitHub env.',
  );
}

// Use placeholder values when env is missing so the bundle can still be built
// and the app can render a helpful error. Real deployments always have these
// set via --build-env (deploy.yml) or Vercel dashboard; placeholders are never
// used in production when the guard is respected.
const resolvedUrl = supabaseUrl || 'https://placeholder.supabase.co';
const resolvedKey = supabaseAnonKey || 'placeholder-anon-key';

// Phase 10.4: bound every Supabase HTTP request so a hung network cannot
// hang the UI indefinitely. 30s is generous for normal queries and still
// short enough to fail visibly.
const REQUEST_TIMEOUT_MS = 30_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = init?.signal;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient<Database>(resolvedUrl, resolvedKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { fetch: fetchWithTimeout as typeof fetch },
});