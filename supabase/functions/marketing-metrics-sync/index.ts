// Ledgr Marketing Metrics Sync — Supabase Edge Function (Marketing Agent, Phase 4)
// ---------------------------------------------------------------------------
// The analytics half of the feedback loop. On a schedule, it pulls lifetime
// insights (impressions / reactions / comments) for recently-published posts and
// stores them in marketing_posts.metrics_json. The marketing-agent edge function
// then surfaces "recent post performance" in its context so recommendations can
// double down on what works.
//
//   GET/POST (cron) Authorization: Bearer <MARKETING_CRON_SECRET>
//            → { processed, synced, skipped }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';
import { getPostMetrics } from '../_shared/facebook.ts';
import { decryptSecret } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const CRON_SECRET = Deno.env.get('MARKETING_CRON_SECRET') || '';
const BATCH_LIMIT = 100;
const RECENT_DAYS = 30;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get('SB_ENV') || 'edge',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

interface PublishedPost {
  id: string;
  business_id: string;
  external_id: string;
}

async function run(): Promise<Record<string, number>> {
  const stats = { processed: 0, synced: 0, skipped: 0 };
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts, error } = await admin
    .from('marketing_posts')
    .select('id,business_id,external_id')
    .eq('status', 'published')
    .not('external_id', 'is', null)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(BATCH_LIMIT);
  if (error || !posts) return stats;

  // Cache one decrypted token per business for the run.
  const tokenCache = new Map<string, string>();

  for (const post of posts as PublishedPost[]) {
    stats.processed += 1;
    let token = tokenCache.get(post.business_id);
    if (token === undefined) {
      const { data: conn } = await admin
        .from('social_connections')
        .select('access_token_encrypted')
        .eq('business_id', post.business_id)
        .eq('provider', 'facebook')
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      token = conn?.access_token_encrypted ? await decryptSecret(conn.access_token_encrypted) : '';
      tokenCache.set(post.business_id, token);
    }
    if (!token) {
      stats.skipped += 1;
      continue;
    }
    const metrics = await getPostMetrics(post.external_id, token);
    await admin
      .from('marketing_posts')
      .update({ metrics_json: { ...metrics, synced_at: new Date().toISOString() } })
      .eq('id', post.id);
    if (metrics.impressions || metrics.reactions || metrics.comments) stats.synced += 1;
    else stats.skipped += 1;
  }
  return stats;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok');
    const auth = req.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : new URL(req.url).searchParams.get('key');
    if (!CRON_SECRET || provided !== CRON_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }
    return json(await run());
  } catch (err) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
