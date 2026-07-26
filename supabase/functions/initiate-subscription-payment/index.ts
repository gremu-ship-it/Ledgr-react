// supabase/functions/initiate-subscription-payment/index.ts
//
// Starts a real PayChangu checkout for a business to upgrade its plan.
//
//   1. Caller must be authenticated and be the `owner` of the business
//      (matches usePermissions().canManageBilling on the client).
//   2. Validates the requested plan/billing cycle against the canonical
//      price list (never trusts an amount from the client).
//   3. Creates a `pending` subscription_payments row, then calls
//      PayChangu's Standard Checkout API (POST /payment) to get a hosted
//      checkout_url.
//   4. Returns { checkout_url, tx_ref } — the client redirects the owner
//      there. Nothing on `businesses` changes yet; that only happens once
//      PayChangu confirms the payment (see paychangu-webhook /
//      verify-subscription-payment), via apply_subscription_payment().
//
// Body: { business_id: string, target_plan_tier: 'growth'|'pro'|'enterprise', billing_cycle: 'monthly'|'annual' }
// Returns: { checkout_url: string, tx_ref: string }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYCHANGU_SECRET_KEY = Deno.env.get('PAYCHANGU_SECRET_KEY');
// Where the app is hosted — used to build callback_url/return_url. Falls
// back to a placeholder so the function still deploys before this is set;
// initiation will fail loudly with a clear error if it's missing.
const APP_URL = Deno.env.get('APP_URL');

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

// Canonical price list — MUST mirror src/lib/billing/plans.ts. Duplicated
// here (rather than imported) because Edge Functions run in Deno and this
// repo doesn't yet have a shared package between the Vite app and
// supabase/functions; see generate-vat-returns/index.ts for the same
// documented tradeoff. If you change pricing in plans.ts, update this too.
const PLAN_PRICES_MWK: Record<string, number> = {
  growth: 100_000,
  pro: 200_000,
  enterprise: 500_000,
};

const ANNUAL_DISCOUNT_PCT: Record<string, number> = {
  growth: 20,
  pro: 20,
  enterprise: 25,
};

type PlanTier = 'growth' | 'pro' | 'enterprise';
type BillingCycle = 'monthly' | 'annual';

function isPlanTier(v: unknown): v is PlanTier {
  return v === 'growth' || v === 'pro' || v === 'enterprise';
}

function isBillingCycle(v: unknown): v is BillingCycle {
  return v === 'monthly' || v === 'annual';
}

function computeAmount(tier: PlanTier, cycle: BillingCycle): number {
  const monthly = PLAN_PRICES_MWK[tier];
  if (cycle === 'monthly') return monthly;
  const discount = ANNUAL_DISCOUNT_PCT[tier] ?? 0;
  const annualBeforeDiscount = monthly * 12;
  return Math.round(annualBeforeDiscount * (1 - discount / 100));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!PAYCHANGU_SECRET_KEY) {
      return json({ error: 'Payments are not configured yet. Set PAYCHANGU_SECRET_KEY.' }, 503);
    }
    if (!APP_URL) {
      return json({ error: 'Payments are not configured yet. Set APP_URL.' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: 'Invalid or expired session' }, 401);
    const callerId = callerData.user.id;
    const callerEmail = callerData.user.email ?? undefined;

    let body: { business_id?: string; target_plan_tier?: string; billing_cycle?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const businessId = (body.business_id || '').trim();
    if (!businessId) return json({ error: 'business_id is required' }, 400);
    if (!isPlanTier(body.target_plan_tier)) {
      return json({ error: "target_plan_tier must be one of: growth, pro, enterprise" }, 400);
    }
    const billingCycle: BillingCycle = isBillingCycle(body.billing_cycle) ? body.billing_cycle : 'monthly';
    const targetTier = body.target_plan_tier;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Only the business owner can manage billing (matches
    // usePermissions().canManageBilling on the client).
    const { data: membership, error: membershipErr } = await admin
      .from('business_users')
      .select('role, is_active')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (membershipErr) return json({ error: `Failed to verify membership: ${membershipErr.message}` }, 500);
    if (!membership) return json({ error: 'You are not a member of this business' }, 403);
    if (membership.role !== 'owner') {
      return json({ error: 'Only the business owner can change the subscription plan' }, 403);
    }

    const { data: business, error: businessErr } = await admin
      .from('businesses')
      .select('id, name, email, plan_tier')
      .eq('id', businessId)
      .maybeSingle();
    if (businessErr || !business) return json({ error: 'Business not found' }, 404);

    const amount = computeAmount(targetTier, billingCycle);
    const txRef = `LEDGR-${businessId.slice(0, 8)}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const periodMs = (billingCycle === 'annual' ? 365 : 31) * 24 * 60 * 60 * 1000;
    const planExpiresAt = new Date(Date.now() + periodMs).toISOString();

    // Create the pending payment row BEFORE calling out to PayChangu so
    // the webhook (which can arrive within seconds) always has a row to
    // resolve against.
    const { error: insertErr } = await admin.from('subscription_payments').insert({
      business_id: businessId,
      tx_ref: txRef,
      gateway: 'paychangu',
      target_plan_tier: targetTier,
      billing_cycle: billingCycle,
      amount,
      currency: 'MWK',
      status: 'pending',
      plan_expires_at: planExpiresAt,
      initiated_by: callerId,
    });
    if (insertErr) return json({ error: `Failed to record payment attempt: ${insertErr.message}` }, 500);

    const [firstName, ...rest] = (callerEmail || 'Ledgr Customer').split('@')[0].split(/[._-]/);

    const paychanguRes = await fetch('https://api.paychangu.com/payment', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
      },
      body: JSON.stringify({
        amount: String(amount),
        currency: 'MWK',
        email: business.email || callerEmail || undefined,
        first_name: firstName || 'Ledgr',
        last_name: rest.join(' ') || 'Customer',
        tx_ref: txRef,
        callback_url: `${SUPABASE_URL}/functions/v1/paychangu-webhook`,
        return_url: `${APP_URL}/settings?tab=billing&payment=${txRef}`,
        customization: {
          title: `Ledgr ${targetTier[0].toUpperCase()}${targetTier.slice(1)} Plan`,
          description: `${billingCycle === 'annual' ? 'Annual' : 'Monthly'} subscription for ${business.name}`,
        },
        meta: {
          business_id: businessId,
          target_plan_tier: targetTier,
          billing_cycle: billingCycle,
        },
      }),
    });

    const paychanguData = await paychanguRes.json().catch(() => null);

    if (!paychanguRes.ok || paychanguData?.status !== 'success') {
      await admin
        .from('subscription_payments')
        .update({ status: 'failed', raw_response: paychanguData ?? { error: 'No response body' } })
        .eq('tx_ref', txRef);
      return json(
        { error: paychanguData?.message || 'Failed to start payment with PayChangu' },
        502,
      );
    }

    const checkoutUrl: string | undefined = paychanguData?.data?.checkout_url;
    if (!checkoutUrl) {
      await admin
        .from('subscription_payments')
        .update({ status: 'failed', raw_response: paychanguData })
        .eq('tx_ref', txRef);
      return json({ error: 'PayChangu did not return a checkout URL' }, 502);
    }

    await admin
      .from('subscription_payments')
      .update({ checkout_url: checkoutUrl, raw_response: paychanguData })
      .eq('tx_ref', txRef);

    return json({ checkout_url: checkoutUrl, tx_ref: txRef, amount, currency: 'MWK' });
  } catch (err) {
    console.error('initiate-subscription-payment error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
