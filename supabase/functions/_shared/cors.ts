// supabase/functions/_shared/cors.ts
//
// Centralised CORS helper for Ledgr Edge Functions.
//
// Replaces the previous `Access-Control-Allow-Origin: *` pattern with an
// origin-allowlist that reads from the ALLOWED_ORIGINS environment variable
// (comma-separated). Falls back to the Supabase project's own domain when
// the variable is not set, so local development and single-domain deploys
// work without extra configuration.
//
// Usage:
//   import { corsHeaders, corsHeadersForRequest } from '../_shared/cors.ts';
//
//   // For preflight / generic responses:
//   const headers = corsHeadersForRequest(req);
//
//   // For static responses where you don't have the request:
//   const headers = corsHeaders();

/**
 * Parse the ALLOWED_ORIGINS env var into a Set of lowercase origins.
 * If not configured, returns null — callers should fall back to reflecting
 * the request Origin only if it matches the Supabase project domain.
 */
function getAllowedOrigins(): Set<string> | null {
  const raw = (() => {
    try { return Deno.env.get('ALLOWED_ORIGINS'); } catch { return undefined; }
  })();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getSupabaseProjectOrigin(): string | null {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    if (!url) return null;
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Determine the correct Access-Control-Allow-Origin value for a given
 * request. Returns the request's Origin if it's in the allowlist, the
 * Supabase project origin, or the App URL — otherwise returns null
 * (meaning the caller should deny the request or omit the header).
 */
export function resolveOrigin(req?: Request): string | null {
  const requestOrigin = req?.headers.get('Origin') || req?.headers.get('origin') || null;

  const allowed = getAllowedOrigins();

  if (allowed) {
    // Explicit allowlist configured — check if the request origin matches
    if (requestOrigin && allowed.has(requestOrigin.toLowerCase())) {
      return requestOrigin;
    }
    // Also allow requests from the Supabase project itself (e.g. SQL editor,
    // dashboard invocations) and the configured APP_URL
    const appUrl = (() => { try { return Deno.env.get('APP_URL'); } catch { return undefined; } })();
    if (requestOrigin) {
      const lower = requestOrigin.toLowerCase();
      const projectOrigin = getSupabaseProjectOrigin();
      if (projectOrigin && lower === projectOrigin.toLowerCase()) return requestOrigin;
      if (appUrl && lower === appUrl.toLowerCase().replace(/\/+$/, '')) return requestOrigin;
    }
    // No match — return the first allowed origin for non-browser clients
    // that don't send an Origin header (e.g. curl, server-to-server)
    if (!requestOrigin) {
      const first = allowed.values().next().value;
      return first ?? null;
    }
    return null;
  }

  // No explicit allowlist — fall back to reflecting the request origin if
  // it matches the Supabase project domain or the APP_URL. This keeps local
  // development and single-domain deploys working without configuration.
  if (requestOrigin) {
    const lower = requestOrigin.toLowerCase();
    const projectOrigin = getSupabaseProjectOrigin();
    if (projectOrigin && lower === projectOrigin.toLowerCase()) return requestOrigin;
    const appUrl = (() => { try { return Deno.env.get('APP_URL'); } catch { return undefined; } })();
    if (appUrl && lower === appUrl.toLowerCase().replace(/\/+$/, '')) return requestOrigin;

    // In development (localhost), allow any origin
    if (lower.startsWith('http://localhost') || lower.startsWith('http://127.0.0.1')) {
      return requestOrigin;
    }

    return null;
  }

  // No Origin header (server-to-server, curl) — return the APP_URL or
  // project origin as a safe default
  const appUrl = (() => { try { return Deno.env.get('APP_URL'); } catch { return undefined; } })();
  if (appUrl) return appUrl.replace(/\/+$/, '');
  return getSupabaseProjectOrigin();
}

/**
 * Build CORS headers for a specific request. The Vary header ensures
 * caches don't serve a response intended for a different origin.
 */
export function corsHeadersForRequest(req?: Request, extra?: Record<string, string>): Record<string, string> {
  const origin = resolveOrigin(req);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-api-key, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return { ...headers, ...extra };
}

/**
 * Build CORS headers without a request context (e.g. for error responses
// where the request object isn't readily available). Uses APP_URL as the
// fallback origin.
 */
export function corsHeaders(extra?: Record<string, string>): Record<string, string> {
  const origin = resolveOrigin();
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-api-key, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return { ...headers, ...extra };
}

/**
 * Standard preflight response using the request's origin.
 */
export function preflightResponse(req: Request): Response {
  return new Response('ok', { headers: corsHeadersForRequest(req) });
}
