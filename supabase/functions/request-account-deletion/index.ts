// supabase/functions/request-account-deletion/index.ts
//
// Day 0 of account deletion (Right to Erasure).
//
// - Anonymizes personal fields on user_profiles immediately.
// - Sets deletion_requested_at (starts the 30-day grace period).
// - Sends a confirmation email using dedicated SMTP credentials — NOT
//   Supabase's built-in Auth SMTP, which only powers its own fixed
//   templates (signup/recovery/etc.) and has no generic "send custom
//   email" API. Requires these secrets to be set:
//     supabase secrets set SMTP_HOST=... SMTP_PORT=... SMTP_USER=... SMTP_PASS=... SMTP_FROM=...
//
// The auth.users row itself is left completely alone at this stage — the
// account remains fully usable so the person can cancel within 30 days.
// Only permanent ban happens later, in finalize-account-deletions.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.14';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SMTP_HOST = Deno.env.get('SMTP_HOST');
const SMTP_PORT = Deno.env.get('SMTP_PORT');
const SMTP_USER = Deno.env.get('SMTP_USER');
const SMTP_PASS = Deno.env.get('SMTP_PASS');
const SMTP_FROM = Deno.env.get('SMTP_FROM') ?? SMTP_USER;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendConfirmationEmail(toEmail: string) {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('SMTP secrets not configured — skipping confirmation email (deletion still proceeds).');
    return { sent: false, reason: 'SMTP not configured' };
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  try {
    await transport.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: 'Ledgr — Account deletion requested',
      text:
        `We've received your request to delete your Ledgr account.\n\n` +
        `Your personal information has been anonymized immediately. Your account ` +
        `will be permanently locked on ${deletionDate} unless you cancel before then.\n\n` +
        `To cancel, log back into Ledgr and use the "Cancel Deletion" option in ` +
        `Settings > Privacy.\n\n` +
        `Financial records for any business you own will be retained after your ` +
        `account is locked, as required by tax and accounting law — only your ` +
        `personal identifying information is removed.\n\n` +
        `If you didn't request this, log in immediately and cancel the deletion.`,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send deletion confirmation email:', err);
    return { sent: false, reason: (err as Error).message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;
    const email = userData.user.email;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Already pending? Don't reset the clock or re-anonymize.
    const { data: existing } = await admin
      .from('user_profiles')
      .select('deletion_requested_at, deletion_finalized_at')
      .eq('id', userId)
      .maybeSingle();

    if (existing?.deletion_requested_at && !existing?.deletion_finalized_at) {
      return new Response(JSON.stringify({
        error: 'Deletion already requested',
        deletion_requested_at: existing.deletion_requested_at,
      }), { status: 409, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const now = new Date().toISOString();

    const { error: updateErr } = await admin
      .from('user_profiles')
      .update({
        full_name: 'Deleted User',
        avatar_url: null,
        phone: null,
        deletion_requested_at: now,
        deletion_finalized_at: null,
      })
      .eq('id', userId);

    if (updateErr) {
      return new Response(JSON.stringify({ error: `Failed to anonymize profile: ${updateErr.message}` }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const emailResult = email ? await sendConfirmationEmail(email) : { sent: false, reason: 'no email on file' };

    return new Response(JSON.stringify({
      success: true,
      deletion_requested_at: now,
      finalize_after: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      email: emailResult,
    }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
