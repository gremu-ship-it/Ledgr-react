/**
 * R09.4 page-bundle stand-in for '@/lib/supabase'.
 *
 * Mirrors the real module's public surface exactly (realSupabase, supabase,
 * isAbortError, supabaseConfigError, isSupabaseConfigured, REQUEST_TIMEOUT_MS,
 * REQUEST_TIMEOUT_MS_WRITE) but points the client at the in-origin protocol
 * stub server whose URL the gate injects as window.R094_STUB_ORIGIN before
 * the bundle executes. The client is created lazily so the injected origin
 * is always honoured even if module evaluation precedes the injection.
 * Client creation is REAL supabase-js — only the network endpoint is
 * synthetic; auth identity is scenario-controlled by the stub (labelled in
 * every affected release record).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window { R094_STUB_ORIGIN?: string; R094_ANON_KEY?: string }
}

export const isSupabaseConfigured = true;
export const supabaseConfigError = null;
export const REQUEST_TIMEOUT_MS = 30_000;
export const REQUEST_TIMEOUT_MS_WRITE = 60_000;

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'AbortError' || /aborted/i.test(e.message ?? '');
}

let client: SupabaseClient | null = null;
function stubClient(): SupabaseClient {
  if (!client) {
    const origin = window.R094_STUB_ORIGIN;
    if (!origin) throw new Error('R09.4 harness: window.R094_STUB_ORIGIN not injected');
    client = createClient(origin, window.R094_ANON_KEY ?? 'r094-anon', {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    }) as SupabaseClient;
  }
  return client;
}

export const realSupabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = stubClient() as unknown as Record<PropertyKey, unknown>;
    const v = c[prop as keyof typeof c];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = stubClient() as unknown as Record<PropertyKey, unknown>;
    const v = c[prop as keyof typeof c];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

export default supabase;
