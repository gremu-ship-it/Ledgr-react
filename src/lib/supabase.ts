import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { isDemoMode } from '@/lib/demo/mode';
import { getDemoClientIfLoaded } from '@/lib/demo/loader';

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
// short enough to fail visibly. Quick-save RPCs that write documents plus
// multiple journal entries can legitimately run longer on a cold Postgres,
// so write operations that take an explicit AbortSignal get a longer budget
// (see REQUEST_TIMEOUT_MS_WRITE below).
export const REQUEST_TIMEOUT_MS = 30_000;
export const REQUEST_TIMEOUT_MS_WRITE = 60_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  // Heuristic: POST/PUT/PATCH/DELETE writes get a longer timeout budget so
  // an RPC that does a multi-statement transaction on a cold DB doesn't
  // trip the abort right as it's finishing. Reads keep the tighter budget.
  const method = (init?.method ?? 'GET').toUpperCase();
  const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  const timeoutMs = isWrite ? REQUEST_TIMEOUT_MS_WRITE : REQUEST_TIMEOUT_MS;
  const timeoutReason = new DOMException(
    `Request timed out after ${timeoutMs / 1000}s`,
    'TimeoutError',
  );
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  const signal = init?.signal;
  if (signal) {
    if (signal.aborted) {
      // Propagate the caller's reason verbatim so e.g. a React Query
      // cancel shows its own message, not our timeout text.
      controller.abort((signal as AbortSignal).reason);
    } else {
      signal.addEventListener(
        'abort',
        () => controller.abort((signal as AbortSignal).reason),
        { once: true },
      );
    }
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * True when an error was caused by the user (or browser) cancelling an
 * in-flight request, or by our own request timeout, rather than a real
 * server-side failure. These cases have an important semantic property:
 * we CANNOT tell whether the server committed the write, so the caller
 * MUST surface a retry-safe message and must NOT claim "nothing was saved".
 * Quick-save RPCs use an idempotency client_key precisely so that retrying
 * in this state cannot create duplicates.
 */
export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if ((err as { name?: string }).name === 'AbortError') return true;
  if ((err as { name?: string }).name === 'TimeoutError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /signal is aborted/i.test(msg) ||
    /timed out/i.test(msg) ||
    /user aborted/i.test(msg) ||
    /The operation was aborted/i.test(msg)
  );
}

export const realSupabase = createClient<Database>(resolvedUrl, resolvedKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { fetch: fetchWithTimeout as typeof fetch },
});

/**
 * The client every module in the app talks to.
 *
 * This is a thin facade that forwards each property access to whichever
 * backend is active *right now*:
 *
 *   - demo mode (`demo@ledgr.test`) → the in-memory demo client, so the whole
 *     product is explorable with no Supabase project, no credentials and no
 *     network traffic. See `src/lib/demo/`.
 *   - otherwise → the real Supabase client above.
 *
 * Forwarding lazily (instead of re-exporting the client directly) is what
 * makes the swap possible at all: every repository captures `this.client` at
 * module load, long before a visitor can enter the demo, so the reference has
 * to stay stable while the target changes underneath it.
 *
 * The facade is transparent in production: when the demo flag is off (the
 * default, and the only possible state on a real session) every access resolves
 * to `realSupabase` and behaves exactly as before.
 */
let warnedAboutUnloadedDemo = false;

function activeClient(): SupabaseClient<Database> {
  if (isDemoMode()) {
    const demo = getDemoClientIfLoaded();
    if (demo) return demo;
    // Both entry points (enterDemoMode and the main.tsx bootstrap) await the
    // chunk before anything can query, so this is a race we should never hit.
    // Fall back rather than throw inside a Proxy getter, and say so once.
    if (!warnedAboutUnloadedDemo) {
      warnedAboutUnloadedDemo = true;
      console.warn('[supabase] Demo mode is on but the demo engine has not loaded yet — using the real client.');
    }
    return realSupabase;
  }
  return realSupabase;
}

export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const target = activeClient() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(target, prop, target);
    // Bind methods so `const { from } = supabase` keeps working.
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
  has(_target, prop) {
    return Reflect.has(activeClient() as unknown as object, prop);
  },
});