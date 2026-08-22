// supabase/functions/expire-subscriptions/index.ts
//
// Run on a schedule (see schedule_expire_subscriptions.sql — pg_cron,
// daily) to downgrade any business whose plan_expires_at has passed back
// to Free. There's no tokenized recurring billing yet, so renewal is a
// manual re-checkout in Settings > Billing before/at the expiry date;
// this function is what actually enforces "you stopped paying, you're
// back on the free tier" once that date passes.
//
// Protected by a shared secret (like finalize-account-deletions) since
// it's meant to be invoked by pg_cron / an external scheduler, not by
// end users.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { unauthorizedCronResponse } from '../_shared/cronAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const denied = unauthorizedCronResponse(req);
  if (denied) return denied;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: expired, error: findErr } = await admin
    .from('businesses')
    .select('id, plan_tier, plan_expires_at')
    .neq('plan_tier', 'free')
    .not('plan_expires_at', 'is', null)
    .lt('plan_expires_at', new Date().toISOString());

  if (findErr) {
    return new Response(JSON.stringify({ error: findErr.message }), { status: 500 });
  }

  const results: { business_id: string; success: boolean; error?: string }[] = [];

  for (const business of expired ?? []) {
    try {
      // Uses the service-role client, which bypasses the
      // enforce_plan_tier_change trigger's "only service_role may raise
      // plan_tier" check — this is a downgrade so it's allowed either way,
      // but running as service_role keeps it consistent with every other
      // automated plan_tier write in this system.
      const { error: updateErr } = await admin
        .from('businesses')
        .update({ plan_tier: 'free', plan_expires_at: null, plan_updated_at: new Date().toISOString() })
        .eq('id', business.id);
      if (updateErr) throw new Error(updateErr.message);
      results.push({ business_id: business.id, success: true });
    } catch (err) {
      results.push({ business_id: business.id, success: false, error: (err as Error).message });
    }
  }

  return new Response(JSON.stringify({
    processed: results.length,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
