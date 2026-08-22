// supabase/functions/send-renewal-reminders/index.ts
//
// Run daily (see schedule_send_renewal_reminders.sql — pg_cron) to warn
// business owners before their paid plan lapses back to Free.
//
// For every business with plan_tier != 'free' and a plan_expires_at that
// falls exactly 7, 3, or 1 day(s) from now (date-only comparison, so this
// is safe to run once a day at any fixed time), sends a reminder email to
// the business owner via SendGrid — the same provider send-invoice
// already uses — and de-dupes via subscription_reminders_sent so a
// re-run on the same day (or a slightly-off cron trigger) doesn't spam
// the owner twice for the same (business, expiry, threshold).
//
// In-app bell notifications for the same reminder are handled client-side
// (see src/hooks/useRenewalReminder.ts) since the notification bell is a
// local (per-device) Zustand store, not a server-pushed feed — email is
// the channel that reaches the owner even when they're not logged in,
// which is the one this cron job needs to guarantee.
//
// Protected by a shared secret (same pattern as finalize-account-deletions
// / expire-subscriptions) since it's meant to be invoked by pg_cron, not
// end users.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { unauthorizedCronResponse } from '../_shared/cronAuth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDGRID_FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'billing@ledgr.app';
const APP_URL = Deno.env.get('APP_URL') || '';

const THRESHOLDS_DAYS = [7, 3, 1] as const;

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

async function sendReminderEmail(to: string, businessName: string, planName: string, daysLeft: number, expiresAt: string) {
  if (!SENDGRID_API_KEY) {
    console.warn('send-renewal-reminders: SENDGRID_API_KEY not set — skipping email, in-app reminder still applies.');
    return { skipped: true };
  }

  const urgency = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
  const subject = daysLeft === 1
    ? `Your Ledgr ${planName} plan expires tomorrow`
    : `Your Ledgr ${planName} plan renews soon (${daysLeft} days left)`;

  const billingUrl = APP_URL ? `${APP_URL}/settings?tab=billing` : '#';

  const html = `
    <p>Hi ${businessName} team,</p>
    <p>Your Ledgr <strong>${planName}</strong> subscription is set to expire ${urgency}, on
    <strong>${new Date(expiresAt).toLocaleDateString('en-MW', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>.</p>
    <p>To keep uninterrupted access to ${planName} features (and avoid being moved back to the Free plan's lower
    transaction limit), please renew before then.</p>
    <p><a href="${billingUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Renew your plan</a></p>
    <p style="color:#6b7280;font-size:12px;">If you've already renewed, you can ignore this message.</p>
  `;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM_EMAIL, name: 'Ledgr Billing' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!res.ok) {
    throw new Error(`SendGrid rejected reminder email (${res.status})`);
  }
  return { sent: true };
}

Deno.serve(async (req) => {
  const denied = unauthorizedCronResponse(req);
  if (denied) return denied;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const today = new Date();
  const targetDates = THRESHOLDS_DAYS.map((days) => ({
    days,
    dateStr: dateOnly(new Date(today.getTime() + days * 24 * 60 * 60 * 1000).toISOString()),
  }));

  const { data: businesses, error: findErr } = await admin
    .from('businesses')
    .select('id, name, plan_tier, plan_expires_at')
    .neq('plan_tier', 'free')
    .not('plan_expires_at', 'is', null);

  if (findErr) {
    return new Response(JSON.stringify({ error: findErr.message }), { status: 500 });
  }

  const results: { business_id: string; days_before?: number; success: boolean; detail?: string }[] = [];

  for (const business of businesses ?? []) {
    if (!business.plan_expires_at) continue;
    const expiryDateStr = dateOnly(business.plan_expires_at);
    const match = targetDates.find((t) => t.dateStr === expiryDateStr);
    if (!match) continue; // not at a reminder threshold today

    try {
      // Find the owner to email. Prefer the business's own contact email
      // if set; otherwise fall back to the owner's account email.
      const { data: bizRow } = await admin.from('businesses').select('email').eq('id', business.id).maybeSingle();
      let recipientEmail: string | null = bizRow?.email || null;

      if (!recipientEmail) {
        const { data: ownerRow } = await admin
          .from('business_users')
          .select('user_id')
          .eq('business_id', business.id)
          .eq('role', 'owner')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (ownerRow?.user_id) {
          const { data: authUser } = await admin.auth.admin.getUserById(ownerRow.user_id);
          recipientEmail = authUser?.user?.email ?? null;
        }
      }

      if (!recipientEmail) {
        results.push({ business_id: business.id, days_before: match.days, success: false, detail: 'No recipient email found' });
        continue;
      }

      // De-dupe: unique on (business_id, plan_expires_at, days_before).
      const { error: dedupeErr } = await admin.from('subscription_reminders_sent').insert({
        business_id: business.id,
        plan_expires_at: business.plan_expires_at,
        days_before: match.days,
      });
      if (dedupeErr) {
        // Unique violation (23505) means we've already sent this one — skip silently.
        if ((dedupeErr as { code?: string }).code === '23505') {
          results.push({ business_id: business.id, days_before: match.days, success: true, detail: 'Already sent' });
          continue;
        }
        throw new Error(dedupeErr.message);
      }

      const planName = business.plan_tier.charAt(0).toUpperCase() + business.plan_tier.slice(1);
      await sendReminderEmail(recipientEmail, business.name, planName, match.days, business.plan_expires_at);

      results.push({ business_id: business.id, days_before: match.days, success: true });
    } catch (err) {
      results.push({ business_id: business.id, days_before: match.days, success: false, detail: (err as Error).message });
    }
  }

  return new Response(JSON.stringify({
    processed: results.length,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
