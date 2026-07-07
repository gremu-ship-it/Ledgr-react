// supabase/functions/finalize-account-deletions/index.ts
//
// Day 30 of account deletion. Run on a schedule (see the pg_cron setup in
// schedule_finalize_deletions.sql) — not meant to be called by end users
// directly, so it's protected by a shared secret instead of a user JWT.
//
// For every user_profiles row where deletion_requested_at is more than 30
// days old and deletion_finalized_at is still null:
//   - Permanently bans the auth.users row from logging in again
//     (ban_duration set far into the future — there's no "forever" value,
//     so ~100 years is the practical equivalent).
//   - Sets deletion_finalized_at.
//
// The auth.users row and every FK referencing it (business_users,
// journal_entries.created_by, audit_log, etc.) are left completely
// untouched — only login ability is revoked. Financial records the person
// was involved in stay intact with their now-anonymized identity attached,
// satisfying legal retention requirements.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET'); // set via `supabase secrets set CRON_SECRET=...`

const PERMANENT_BAN_DURATION = '876000h'; // ~100 years

serve(async (req) => {
  const providedSecret = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: due, error: dueErr } = await admin
    .from('user_profiles')
    .select('id')
    .lte('deletion_requested_at', cutoff)
    .is('deletion_finalized_at', null)
    .not('deletion_requested_at', 'is', null);

  if (dueErr) {
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500 });
  }

  const results: { user_id: string; success: boolean; error?: string }[] = [];

  for (const row of due ?? []) {
    try {
      const { error: banErr } = await admin.auth.admin.updateUserById(row.id, {
        ban_duration: PERMANENT_BAN_DURATION,
      });
      if (banErr) throw new Error(banErr.message);

      const { error: finalizeErr } = await admin
        .from('user_profiles')
        .update({ deletion_finalized_at: new Date().toISOString() })
        .eq('id', row.id);
      if (finalizeErr) throw new Error(finalizeErr.message);

      results.push({ user_id: row.id, success: true });
    } catch (err) {
      results.push({ user_id: row.id, success: false, error: (err as Error).message });
    }
  }

  return new Response(JSON.stringify({
    processed: results.length,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
