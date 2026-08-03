// Ledgr Marketing Scheduler — Supabase Edge Function (Marketing Agent, Phase 4)
// ---------------------------------------------------------------------------
// The autopilot runner. Invoked on a schedule (pg_cron/pg_net, Vercel cron, or
// any external cron) with a shared CRON_SECRET. It publishes APPROVED drafts
// whose scheduled_for time has passed — but only for businesses that have opted
// into autopilot, and never beyond their per-day cap. Nothing is posted that the
// user has not explicitly approved (status 'approved').
//
// Guardrails: autopilot opt-in, per-day rate cap, AI-content disclosure, and a
// MARKETING_DRY_RUN mode that logs what would post without posting.
//
//   GET/POST  (cron)  Authorization: Bearer <CRON_SECRET>
//            → { processed, published, skipped, failed, dryRun }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';
import { postToPageFeed } from '../_shared/facebook.ts';
import { decryptSecret } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const CRON_SECRET = Deno.env.get('MARKETING_CRON_SECRET') || '';
const DRY_RUN = (Deno.env.get('MARKETING_DRY_RUN') || '').toLowerCase() === '1' ||
  (Deno.env.get('MARKETING_DRY_RUN') || '').toLowerCase() === 'true';
const AI_DISCLOSURE_SUFFIX = '\n\n— created with AI assistance via Ledgr';
const BATCH_LIMIT = 50;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get('SB_ENV') || 'edge',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

interface DuePost {
  id: string;
  business_id: string;
  channel: string;
  content_json: Record<string, unknown>;
}

interface Settings {
  autopilot_enabled: boolean;
  max_posts_per_day: number;
  ai_disclosure: boolean;
}

async function getSettings(businessId: string): Promise<Settings> {
  const { data } = await admin
    .from('marketing_settings')
    .select('autopilot_enabled,max_posts_per_day,ai_disclosure')
    .eq('business_id', businessId)
    .maybeSingle();
  return {
    autopilot_enabled: data?.autopilot_enabled ?? false,
    max_posts_per_day: data?.max_posts_per_day ?? 1,
    ai_disclosure: data?.ai_disclosure ?? true,
  };
}

async function publishedToday(businessId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count } = await admin
    .from('marketing_posts')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'published')
    .gte('published_at', start.toISOString());
  return count ?? 0;
}

async function getConnection(businessId: string) {
  const { data } = await admin
    .from('social_connections')
    .select('account_id,access_token_encrypted')
    .eq('business_id', businessId)
    .eq('provider', 'facebook')
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();
  return data as { account_id: string; access_token_encrypted: string } | null;
}

async function run(): Promise<Record<string, number | boolean>> {
  const now = new Date().toISOString();
  const stats = { processed: 0, published: 0, skipped: 0, failed: 0, dryRun: DRY_RUN };

  const { data: due, error } = await admin
    .from('marketing_posts')
    .select('id,business_id,channel,content_json')
    .eq('status', 'approved')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error || !due) return stats;

  for (const post of due as DuePost[]) {
    stats.processed += 1;
    const settings = await getSettings(post.business_id);
    if (!settings.autopilot_enabled) {
      stats.skipped += 1;
      continue;
    }
    if ((await publishedToday(post.business_id)) >= settings.max_posts_per_day) {
      stats.skipped += 1; // guardrail: per-day cap reached
      continue;
    }
    const conn = await getConnection(post.business_id);
    if (!conn) {
      stats.skipped += 1; // no connected page
      continue;
    }

    const cj = (post.content_json ?? {}) as { text?: string };
    let message = typeof cj.text === 'string' ? cj.text : '';
    if (settings.ai_disclosure) message += AI_DISCLOSURE_SUFFIX;

    if (DRY_RUN) {
      stats.skipped += 1; // dry-run: would post
      continue;
    }

    await admin.from('marketing_posts').update({ status: 'publishing' }).eq('id', post.id);
    try {
      const token = await decryptSecret(conn.access_token_encrypted);
      if (!token) throw new Error('Stored token could not be decrypted');
      const externalId = await postToPageFeed(conn.account_id, token, message);
      await admin
        .from('marketing_posts')
        .update({
          status: 'published',
          external_id: externalId,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', post.id);
      stats.published += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'publish_failed';
      await admin.from('marketing_posts').update({ status: 'failed', error: msg }).eq('id', post.id);
      stats.failed += 1;
    }
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
    // Shared-secret auth so only the cron can trigger the runner.
    const auth = req.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : new URL(req.url).searchParams.get('key');
    if (!CRON_SECRET || provided !== CRON_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const result = await run();
    return json(result);
  } catch (err) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
