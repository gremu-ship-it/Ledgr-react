// Ledgr Facebook OAuth — Supabase Edge Function (Marketing Agent, Phase 3)
// ---------------------------------------------------------------------------
// Handles the Facebook Login OAuth flow for connecting a business's Facebook
// Page so the marketing agent can publish on its behalf.
//
//   POST  (supabase.functions.invoke, JWT)  { action: 'start', businessId }
//        → { authUrl }  (the client navigates here to begin Facebook Login)
//   POST  (JWT)  { action: 'disconnect', businessId }
//        → { ok: true }
//   GET   (browser redirect from facebook.com)  ?action=callback&code=...&state=...
//        → exchanges code → long-lived token → Page token (stored encrypted),
//          then 302-redirects back to the app.
//
// The callback is unauthenticated by design (it's an OAuth redirect target);
// the single-use, short-lived `state` binds it to the business+user that
// started the flow (CSRF protection). Tokens are AES-GCM encrypted at rest.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';
import {
  buildAuthUrl,
  defaultRedirectUri,
  exchangeCodeForToken,
  exchangeLongLivedUserToken,
  listPages,
  fbConfigured,
} from '../_shared/facebook.ts';
import { encryptSecret, encryptionConfigured } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get('SB_ENV') || 'edge',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

let _currentReq: Request | undefined;
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_currentReq), ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url, ...SECURITY_HEADERS } });
}

function appUrl(): string {
  return (Deno.env.get('APP_URL') || SUPABASE_URL).replace(/\/+$/, '');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Verify the user is an active member of the business (service-role check). */
async function isMember(userId: string, businessId: string): Promise<boolean> {
  const { data } = await admin
    .from('business_users')
    .select('user_id')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return Boolean(data);
}

async function getUserFromReq(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await authClient.auth.getUser();
  return data.user ?? null;
}

// ── POST actions (start / disconnect) ───────────────────────────────────────
async function handleStart(req: Request): Promise<Response> {
  if (!fbConfigured()) return json({ error: 'Facebook is not configured (FB_APP_ID/FB_APP_SECRET).' }, 503);
  if (!encryptionConfigured()) return json({ error: 'Token storage is not configured (SOCIAL_TOKEN_ENC_KEY).' }, 503);

  const user = await getUserFromReq(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const raw = await req.json().catch(() => null);
  const businessId = typeof raw?.businessId === 'string' ? raw.businessId : '';
  if (!businessId) return json({ error: 'businessId is required' }, 400);
  if (!(await isMember(user.id, businessId))) return json({ error: 'Forbidden' }, 403);

  const state = crypto.randomUUID();
  const { error } = await admin.from('social_oauth_states').insert({
    state,
    business_id: businessId,
    provider: 'facebook',
    user_id: user.id,
  });
  if (error) return json({ error: 'Could not start OAuth flow.' }, 500);

  return json({ authUrl: buildAuthUrl(defaultRedirectUri(), state) });
}

async function handleDisconnect(req: Request): Promise<Response> {
  const user = await getUserFromReq(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const raw = await req.json().catch(() => null);
  const businessId = typeof raw?.businessId === 'string' ? raw.businessId : '';
  if (!businessId) return json({ error: 'businessId is required' }, 400);
  if (!(await isMember(user.id, businessId))) return json({ error: 'Forbidden' }, 403);

  await admin
    .from('social_connections')
    .update({ revoked_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('provider', 'facebook')
    .is('revoked_at', null);

  return json({ ok: true });
}

// ── GET callback (browser redirect from facebook.com) ───────────────────────
async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  if (errParam) return redirect(`${appUrl()}/marketing?fb_error=${encodeURIComponent(errParam)}`);
  if (!code || !state) return redirect(`${appUrl()}/marketing?fb_error=missing_params`);

  // Validate + consume the state (single use, TTL).
  const { data: stateRow } = await admin
    .from('social_oauth_states')
    .select('business_id,user_id,created_at,used_at')
    .eq('state', state)
    .maybeSingle();

  const expired = stateRow ? Date.now() - new Date(stateRow.created_at).getTime() > STATE_TTL_MS : true;
  if (!stateRow || stateRow.used_at || expired) {
    return redirect(`${appUrl()}/marketing?fb_error=invalid_state`);
  }
  await admin.from('social_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state);

  try {
    const shortLived = await exchangeCodeForToken(code, defaultRedirectUri());
    const longLived = await exchangeLongLivedUserToken(shortLived);
    const pages = await listPages(longLived);
    if (!pages.length) return redirect(`${appUrl()}/marketing?fb_error=no_pages`);

    // Store the first Page (one Page per business in Phase 3). Encrypt the token.
    const page = pages[0];
    const tokenEnc = await encryptSecret(page.access_token);
    const { error } = await admin.from('social_connections').upsert(
      {
        business_id: stateRow.business_id,
        provider: 'facebook',
        account_id: page.id,
        account_name: page.name,
        access_token_encrypted: tokenEnc,
        scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
        connected_by: stateRow.user_id,
        revoked_at: null,
      },
      { onConflict: 'business_id,provider,account_id' },
    );
    if (error) return redirect(`${appUrl()}/marketing?fb_error=save_failed`);

    return redirect(`${appUrl()}/marketing?fb_connected=1`);
  } catch (err) {
    if (SENTRY_DSN) Sentry.captureException(err);
    const msg = err instanceof Error ? err.message : 'oauth_failed';
    return redirect(`${appUrl()}/marketing?fb_error=${encodeURIComponent(msg)}`);
  }
}

// ── Request handling ────────────────────────────────────────────────────────
serve(async (req) => {
  _currentReq = req;
  try {
    if (req.method === 'OPTIONS') return preflightResponse(req);
    if (req.method === 'GET') return handleCallback(req);
    if (req.method === 'POST') {
      const raw = await req.json().catch(() => null);
      const action = raw?.action;
      if (action === 'start') return handleStart(req);
      if (action === 'disconnect') return handleDisconnect(req);
      return json({ error: 'Unknown action' }, 400);
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
