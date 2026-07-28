// supabase/functions/grant-manual-subscription/index.ts
//
// Lets a platform admin (user_profiles.is_platform_admin = true) manually
// activate a paid plan for a business that paid outside PayChangu — cash,
// bank transfer, mobile money sent directly, etc. — before/without using
// the gateway integration.
//
// This reuses the exact same audit trail and activation path as a real
// PayChangu payment: it writes a `subscription_payments` row (gateway:
// 'manual', already 'success') and calls the same apply_subscription_payment()
// function that the webhook uses, so Settings > Billing's payment history
// and the plan activation logic don't need to know the difference.
//
// Body: {
//   business_id: string,
//   target_plan_tier: 'growth'|'pro'|'enterprise',
//   duration_days: number,       // how many days of access to grant from today
//   amount: number,              // what was actually paid, for the record
//   payment_method: 'cash'|'bank_transfer'|'mobile_money'|'other',
//   reference?: string,          // e.g. bank reference / receipt number
//   notes?: string,              // free text, e.g. "Paid via NBM, ref #1234"
// }
// Returns: { success: true, plan_tier, plan_expires_at }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { withCors } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

type PlanTier = 'growth' | 'pro' | 'enterprise';
function isPlanTier(v: unknown): v is PlanTier {
  return v === 'growth' || v === 'pro' || v === 'enterprise';
}

const PAYMENT_METHODS = new Set(['cash', 'bank_transfer', 'mobile_money', 'other']);

serve(withCors(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: 'Invalid or expired session' }, 401);
    const callerId = callerData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Gate: caller must be a flagged platform admin. This is intentionally
    // NOT the same check as "owner of the business" — this endpoint can act
    // on ANY business, which is exactly why it's locked down harder.
    const { data: profile, error: profileErr } = await admin
      .from('user_profiles')
      .select('is_platform_admin')
      .eq('id', callerId)
      .maybeSingle();
    if (profileErr) return json({ error: `Failed to verify admin status: ${profileErr.message}` }, 500);
    if (!profile?.is_platform_admin) {
      return json({ error: 'Platform admin access required' }, 403);
    }

    let body: {
      business_id?: string;
      target_plan_tier?: string;
      duration_days?: number;
      amount?: number;
      payment_method?: string;
      reference?: string;
      notes?: string;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const businessId = (body.business_id || '').trim();
    if (!businessId) return json({ error: 'business_id is required' }, 400);
    if (!isPlanTier(body.target_plan_tier)) {
      return json({ error: 'target_plan_tier must be one of: growth, pro, enterprise' }, 400);
    }
    const durationDays = Number(body.duration_days);
    if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > 3660) {
      return json({ error: 'duration_days must be a positive number (max ~10 years)' }, 400);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return json({ error: 'amount must be a non-negative number' }, 400);
    }
    const paymentMethod = (body.payment_method || '').trim();
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return json({ error: `payment_method must be one of: ${Array.from(PAYMENT_METHODS).join(', ')}` }, 400);
    }

    const { data: business, error: businessErr } = await admin
      .from('businesses')
      .select('id, name')
      .eq('id', businessId)
      .maybeSingle();
    if (businessErr || !business) return json({ error: 'Business not found' }, 404);

    const targetTier = body.target_plan_tier;
    const planExpiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const txRef = `MANUAL-${businessId.slice(0, 8)}-${Date.now()}`;

    const notesParts = [
      `Manually granted by platform admin.`,
      `Payment method: ${paymentMethod}.`,
      body.reference ? `Reference: ${body.reference}.` : null,
      body.notes ? `Notes: ${body.notes}` : null,
    ].filter(Boolean);

    // Insert the payment record as already-successful, then activate via
    // the same idempotent function real PayChangu payments use — this
    // keeps exactly one code path responsible for "how a payment becomes
    // an active plan", whether the money came through the gateway or not.
    const { error: insertErr } = await admin.from('subscription_payments').insert({
      business_id: businessId,
      tx_ref: txRef,
      gateway: 'manual',
      gateway_reference: body.reference || null,
      target_plan_tier: targetTier,
      billing_cycle: 'custom',
      amount,
      currency: 'MWK',
      status: 'pending', // apply_subscription_payment transitions this to 'success' below
      plan_expires_at: planExpiresAt,
      initiated_by: callerId,
      raw_response: { manual_grant: true, granted_by: callerId, notes: notesParts.join(' ') },
    });
    if (insertErr) return json({ error: `Failed to record manual grant: ${insertErr.message}` }, 500);

    const { data: resolved, error: applyErr } = await admin.rpc('apply_subscription_payment', {
      p_tx_ref: txRef,
      p_status: 'success',
      p_gateway_reference: body.reference || null,
      p_raw_response: { manual_grant: true, granted_by: callerId, notes: notesParts.join(' ') },
    });
    if (applyErr) return json({ error: applyErr.message }, 500);

    return json({
      success: true,
      plan_tier: resolved.target_plan_tier,
      plan_expires_at: resolved.plan_expires_at,
      business_name: business.name,
    });
  } catch (err) {
    console.error('grant-manual-subscription error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
}));
