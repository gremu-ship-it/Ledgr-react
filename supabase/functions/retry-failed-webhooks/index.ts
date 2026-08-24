// retry-failed-webhooks — Phase 10.4 dead-letter retry.
//
// Scheduled daily (cron job added by migration 20260820000000). Re-dispatches
// webhook deliveries that exhausted their 3 attempts within the last 7 days
// and were never delivered, by re-invoking webhook-dispatcher with the stored
// payload. Idempotent: webhook-dispatcher records a fresh delivery row each
// run; a delivery only counts as done when the endpoint returns 2xx.
//
// Guarded by x-cron-secret (same pattern as the other scheduled functions).
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { readConfiguredSecret, unauthorizedCronResponse } from '../_shared/cronAuth.ts';

const CRON_ENV = ['CRON_SECRET', 'INVOICE_CRON_SECRET'];

serve(async (req) => {
  try {
    const denied = unauthorizedCronResponse(req, CRON_ENV);
    if (denied) return denied;

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // Undelivered, exhausted attempts, within the last 7 days.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: deliveries, error } = await db
      .from('webhook_deliveries')
      .select('id, webhook_id, event, payload')
      .is('delivered_at', null)
      .gte('attempt', 3)
      .gte('created_at', since)
      .limit(200);

    if (error) throw error;

    const cronSecret = readConfiguredSecret(CRON_ENV) ?? '';
    let redispatched = 0;
    for (const d of deliveries ?? []) {
      const { data: webhook } = await db
        .from('webhooks')
        .select('business_id, is_active')
        .eq('id', d.webhook_id)
        .maybeSingle();
      // Skip webhooks that have since been deactivated or removed.
      if (!webhook || !webhook.is_active) continue;

      const { error: invokeError } = await db.functions.invoke('webhook-dispatcher', {
        body: {
          business_id: webhook.business_id,
          event: d.event,
          payload: d.payload,
        },
        headers: { 'x-cron-secret': cronSecret },
      });
      if (invokeError) {
        console.error(`retry-failed-webhooks: redispatch of delivery ${d.id} failed: ${invokeError.message}`);
        continue;
      }
      redispatched += 1;
    }

    return new Response(JSON.stringify({ redispatched }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
