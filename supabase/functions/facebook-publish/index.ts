// Ledgr Facebook Publish — Supabase Edge Function (Marketing Agent, Phase 3)
// ---------------------------------------------------------------------------
// Publishes an approved draft to the business's connected Facebook Page.
// Approve-first by design: the user must explicitly click "Publish" — there is
// no autonomous posting here (that is Phase 4).
//
//   POST  (supabase.functions.invoke, JWT)
//        { businessId, postId?, text?, channel? }
//        → { ok, externalId, postId }
//
// Loads the encrypted Page token from social_connections, decrypts it
// server-side, posts to /{page-id}/feed, and records the result on
// marketing_posts (status published / failed). The token never reaches the
// browser.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';
import { postToPageFeed } from '../_shared/facebook.ts';
import { decryptSecret } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const MAX_MESSAGE = 5000;

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
  'Cache-Control': 'no-store',
};

let _currentReq: Request | undefined;
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_currentReq), ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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

interface Connection {
  id: string;
  account_id: string;
  account_name: string;
  access_token_encrypted: string;
}

async function loadConnection(businessId: string): Promise<Connection | null> {
  const { data } = await admin
    .from('social_connections')
    .select('id,account_id,account_name,access_token_encrypted')
    .eq('business_id', businessId)
    .eq('provider', 'facebook')
    .is('revoked_at', null)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Connection | null) ?? null;
}

serve(async (req) => {
  _currentReq = req;
  try {
    if (req.method === 'OPTIONS') return preflightResponse(req);
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    // Auth.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await authClient.auth.getUser();
    const user = authData.user;
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (SENTRY_DSN) Sentry.setUser({ id: user.id });

    const raw = await req.json().catch(() => null);
    const businessId = typeof raw?.businessId === 'string' ? raw.businessId : '';
    if (!businessId) return json({ error: 'businessId is required' }, 400);
    if (!(await isMember(user.id, businessId))) return json({ error: 'Forbidden' }, 403);

    const postId = typeof raw?.postId === 'string' ? raw.postId : '';
    const channel = typeof raw?.channel === 'string' ? raw.channel : 'facebook';

    // Resolve the message: prefer an existing draft row, else the inline text.
    let message = '';
    if (postId) {
      const { data: post } = await admin
        .from('marketing_posts')
        .select('content_json,status,business_id')
        .eq('id', postId)
        .maybeSingle();
      if (!post || post.business_id !== businessId) return json({ error: 'Draft not found' }, 404);
      const cj = (post.content_json ?? null) as { text?: string } | null;
      message = typeof cj?.text === 'string' ? cj.text : '';
    } else if (typeof raw?.text === 'string') {
      message = raw.text;
    }
    message = message.slice(0, MAX_MESSAGE).trim();
    if (!message) return json({ error: 'Nothing to publish (empty message).' }, 400);

    // Require a connection.
    const conn = await loadConnection(businessId);
    if (!conn) return json({ error: 'No Facebook Page is connected for this business.' }, 409);

    const token = await decryptSecret(conn.access_token_encrypted);
    if (!token) return json({ error: 'Stored Facebook token could not be read. Please reconnect the Page.' }, 500);

    // Ensure a draft row exists to record the outcome.
    let rowId = postId;
    if (!rowId) {
      const { data: inserted, error } = await admin
        .from('marketing_posts')
        .insert({
          business_id: businessId,
          kind: 'post',
          channel,
          status: 'publishing',
          content_json: { text: message },
        })
        .select('id')
        .single();
      if (error || !inserted) return json({ error: 'Could not create a post record.' }, 500);
      rowId = inserted.id;
    } else {
      await admin.from('marketing_posts').update({ status: 'publishing', error: null }).eq('id', rowId);
    }

    // Publish.
    try {
      const externalId = await postToPageFeed(conn.account_id, token, message);
      await admin
        .from('marketing_posts')
        .update({
          status: 'published',
          external_id: externalId,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', rowId);
      return json({ ok: true, externalId, postId: rowId, pageName: conn.account_name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'publish_failed';
      await admin.from('marketing_posts').update({ status: 'failed', error: msg }).eq('id', rowId);
      return json({ error: msg }, 502);
    }
  } catch (err) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
