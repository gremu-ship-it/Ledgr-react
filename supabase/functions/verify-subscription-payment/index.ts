// supabase/functions/verify-subscription-payment/index.ts
//
// Called by the client immediately after PayChangu redirects the owner
// back to return_url?tx_ref=...&status=... . Webhooks are the source of
// truth for activation, but they can take a few seconds, so this gives
// the UI an immediate, equally-verified answer instead of showing
// "pending" until a background job catches up.
//
// This re-queries PayChangu itself (never trusts the redirect's own
// `status` query param, which is just for UX) and reuses the same
// idempotent apply_subscription_payment() the webhook uses, so calling
// this AND having the webhook fire later for the same tx_ref is safe.
//
// Body: { tx_ref: string }
// Returns: { status: 'success'|'failed'|'pending', plan_tier?: string }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYCHANGU_SECRET_KEY = Deno.env.get('PAYCHANGU_SECRET_KEY');

let _req: Request | undefined;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  _req = req;
    if (req.method === 'OPTIONS') return preflightResponse(req);
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

    let body: { tx_ref?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const txRef = (body.tx_ref || '').trim();
    if (!txRef) return json({ error: 'tx_ref is required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: payment, error: paymentErr } = await admin
      .from('subscription_payments')
      .select('tx_ref, status, business_id, target_plan_tier, initiated_by')
      .eq('tx_ref', txRef)
      .maybeSingle();

    if (paymentErr) return json({ error: paymentErr.message }, 500);
    if (!payment) return json({ error: 'Unknown payment reference' }, 404);

    // Only the person who started this checkout (or another member of the
    // same business) may poll its status.
    const { data: membership } = await admin
      .from('business_users')
      .select('user_id')
      .eq('business_id', payment.business_id)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();
    if (!membership) return json({ error: 'Not authorized to view this payment' }, 403);

    if (payment.status !== 'pending') {
      return json({ status: payment.status, plan_tier: payment.status === 'success' ? payment.target_plan_tier : undefined });
    }

    if (!PAYCHANGU_SECRET_KEY) {
      return json({ status: 'pending', message: 'Payments are not fully configured yet.' });
    }

    const verifyRes = await fetch(`https://api.paychangu.com/verify-payment/${encodeURIComponent(txRef)}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
      },
    });
    const verifyData = await verifyRes.json().catch(() => null);
    const gatewayStatus = verifyData?.data?.status as string | undefined;

    if (gatewayStatus !== 'success' && gatewayStatus !== 'failed') {
      // Still pending on PayChangu's side too.
      return json({ status: 'pending' });
    }

    const { data: resolved, error: applyErr } = await admin.rpc('apply_subscription_payment', {
      p_tx_ref: txRef,
      p_status: gatewayStatus,
      p_gateway_reference: verifyData?.data?.reference ?? null,
      p_raw_response: { verify: verifyData, source: 'client_post_redirect' },
    });

    if (applyErr) return json({ error: applyErr.message }, 500);

    return json({
      status: resolved.status,
      plan_tier: resolved.status === 'success' ? resolved.target_plan_tier : undefined,
    });
  } catch (err) {
    console.error('verify-subscription-payment error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
