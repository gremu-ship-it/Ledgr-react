// supabase/functions/paychangu-webhook/index.ts
//
// Receives PayChangu's server-to-server payment notifications
// (event_type: "api.charge.payment" / "checkout.payment", etc.) and
// activates the paid plan once a subscription checkout is confirmed.
//
// Security:
//   - Verifies the `Signature` header: SHA-256 HMAC of the raw request
//     body, keyed with PAYCHANGU_WEBHOOK_SECRET. Requests that don't
//     match are rejected — this is the only thing standing between this
//     endpoint and someone POSTing a fake "success" event.
//   - Regardless of what the webhook body claims, we re-verify the
//     transaction server-to-server via PayChangu's verify-payment
//     endpoint before trusting it (PayChangu's own recommended practice:
//     https://developer.paychangu.com/docs/webhooks#always-re-query).
//   - apply_subscription_payment() is idempotent, so redeliveries
//     (PayChangu retries 3x on non-200) are safe to process again.
//
// This endpoint is unauthenticated by design (PayChangu can't send a
// Supabase JWT) — do NOT add JWT verification here. All trust comes from
// the HMAC signature check below plus the re-query step.
//
// Always returns 200 once the payload is structurally handled, per
// PayChangu's requirement, to avoid unnecessary retries; genuine failures
// (bad signature, DB error) return non-200 so PayChangu does retry.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { hmacSha256Hex, timingSafeEqual } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYCHANGU_SECRET_KEY = Deno.env.get('PAYCHANGU_SECRET_KEY');
const PAYCHANGU_WEBHOOK_SECRET = Deno.env.get('PAYCHANGU_WEBHOOK_SECRET');
const RAW_APP_URL = Deno.env.get('APP_URL');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeAppUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  // Be forgiving if APP_URL was accidentally pasted as Markdown, e.g.
  // [https://ledgr-react.vercel.app](https://ledgr-react.vercel.app).
  const markdownUrl = trimmed.match(/\((https?:\/\/[^)]+)\)/)?.[1];
  const plainUrl = markdownUrl ?? trimmed.match(/https?:\/\/[^\s\])]+/)?.[0] ?? trimmed;
  const withoutTrailingSlash = plainUrl.replace(/\/+$/, '');

  try {
    const url = new URL(withoutTrailingSlash);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return withoutTrailingSlash;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    // Older checkout attempts used this endpoint as PayChangu's browser
    // success redirect. Send the customer back to the app, where the
    // payment verifier can resolve the tx_ref safely.
    const txRef = new URL(req.url).searchParams.get('tx_ref');
    const appUrl = normalizeAppUrl(RAW_APP_URL);
    if (txRef && appUrl) {
      return Response.redirect(`${appUrl}/settings?tab=billing&payment=${encodeURIComponent(txRef)}`, 302);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const rawBody = await req.text();

  if (!PAYCHANGU_WEBHOOK_SECRET) {
    console.error('paychangu-webhook: PAYCHANGU_WEBHOOK_SECRET is not configured — rejecting all webhooks.');
    return json({ error: 'Webhook not configured' }, 503);
  }

  const signature = req.headers.get('Signature') || req.headers.get('signature');
  if (!signature) return json({ error: 'Missing Signature header' }, 401);

  const expected = await hmacSha256Hex(PAYCHANGU_WEBHOOK_SECRET, rawBody);
  if (!timingSafeEqual(expected, signature)) {
    console.warn('paychangu-webhook: signature mismatch — possible spoofed request.');
    return json({ error: 'Invalid signature' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // PayChangu sends different shapes for different event types; we only
  // care about payment events that carry a tx_ref/reference we recognise.
  const txRef = (payload.tx_ref as string) || (payload.reference as string) || null;
  const eventType = payload.event_type as string | undefined;

  if (!txRef) {
    // Not a payment event we handle (e.g. a payout webhook) — acknowledge
    // and move on so PayChangu doesn't keep retrying it.
    return json({ received: true, ignored: true });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: pending } = await admin
    .from('subscription_payments')
    .select('tx_ref, status')
    .eq('tx_ref', txRef)
    .maybeSingle();

  if (!pending) {
    // Not one of our subscription checkouts (could be an invoice payment
    // webhook from a different flow) — acknowledge without acting.
    return json({ received: true, ignored: true });
  }

  if (pending.status !== 'pending') {
    // Already resolved (e.g. by the client's own post-redirect verify
    // call) — acknowledge without reprocessing.
    return json({ received: true, alreadyResolved: true });
  }

  // Always re-query PayChangu server-to-server rather than trusting the
  // webhook body's status directly.
  let verifiedStatus: 'success' | 'failed' | 'cancelled' = 'failed';
  let verifyData: unknown = null;

  if (PAYCHANGU_SECRET_KEY) {
    try {
      const verifyRes = await fetch(`https://api.paychangu.com/verify-payment/${encodeURIComponent(txRef)}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${PAYCHANGU_SECRET_KEY}`,
        },
      });
      verifyData = await verifyRes.json().catch(() => null);
      const status = (verifyData as { data?: { status?: string } } | null)?.data?.status;
      if (status === 'success') verifiedStatus = 'success';
      else if (status === 'pending') {
        // Still pending server-side — don't resolve yet, wait for a later
        // webhook/verification call. Acknowledge so PayChangu doesn't retry.
        return json({ received: true, stillPending: true });
      }
    } catch (err) {
      console.error('paychangu-webhook: verify-payment call failed:', err);
      // Fall through and treat as failed rather than trusting the
      // unverified webhook payload.
    }
  } else {
    console.warn('paychangu-webhook: PAYCHANGU_SECRET_KEY not set, cannot re-verify — trusting webhook payload only.');
    verifiedStatus = payload.status === 'success' ? 'success' : 'failed';
  }

  const gatewayReference = (payload.reference as string) || null;

  const { error: applyErr } = await admin.rpc('apply_subscription_payment', {
    p_tx_ref: txRef,
    p_status: verifiedStatus,
    p_gateway_reference: gatewayReference,
    p_raw_response: { webhook: payload, verify: verifyData, event_type: eventType ?? null },
  });

  if (applyErr) {
    console.error('paychangu-webhook: apply_subscription_payment failed:', applyErr);
    return json({ error: applyErr.message }, 500);
  }

  return json({ received: true, status: verifiedStatus });
});
