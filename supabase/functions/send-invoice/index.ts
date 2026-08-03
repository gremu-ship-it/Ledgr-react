// supabase/functions/send-invoice/index.ts
//
// Sends an invoice email via SendGrid with an HTML body and optional PDF
// attachment. A signed tracking pixel URL is embedded so the invoice-open
// endpoint can verify the open event is legitimate.
//
// Security:
//   - Auth-gated: caller must present a valid Supabase JWT.
//   - Tenant-scoped: the invoice must belong to a business the caller is
//     an active member of (prevents cross-tenant sending).
//   - HTML sanitised: only safe tags/attributes are allowed through to the
//     email body (prevents phishing / HTML injection via the `html` param).
//   - Tracking pixel signed: the invoice-open endpoint validates an HMAC
//     token, so third parties cannot forge open events.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hmacSha256Hex } from '../_shared/crypto.ts';
import { sanitiseHtml } from '../_shared/sanitiseHtml.ts';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

let _req: Request | undefined;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
  });
}

// ── Email address validation ────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// ── Handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  _req = req;
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    // Verify the caller's JWT
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorised' }, 401);

    const { invoiceId, to, html, pdfBase64 } = await req.json().catch(() => ({}));
    if (!invoiceId || !to) {
      return json({ error: 'invoiceId and recipient email are required' }, 400);
    }
    if (!isValidEmail(to)) {
      return json({ error: 'Invalid recipient email address' }, 400);
    }

    const sendgridKey = Deno.env.get('SENDGRID_API_KEY');
    if (!sendgridKey) return json({ error: 'SENDGRID_API_KEY is not configured' }, 503);

    // ── Tenant check: verify the caller is an active member of the
    //    business that owns this invoice ──────────────────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: invoice, error: invErr } = await admin
      .from('invoices')
      .select('id, business_id')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle();

    if (invErr || !invoice) {
      return json({ error: 'Invoice not found' }, 404);
    }

    const { data: membership } = await admin
      .from('business_users')
      .select('id')
      .eq('business_id', invoice.business_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!membership) {
      return json({ error: 'Not authorised for this invoice' }, 403);
    }

    // ── Build signed tracking pixel URL ─────────────────────────────
    const trackSecret = Deno.env.get('INVOICE_TRACKING_SECRET') || Deno.env.get('CRON_SECRET') || '';
    const token = trackSecret
      ? await hmacSha256Hex(trackSecret, invoiceId)
      : '';
    const trackingUrl = token
      ? `${SUPABASE_URL}/functions/v1/invoice-open?invoice=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(token)}`
      : '';

    // ── Sanitise HTML body ──────────────────────────────────────────
    const safeHtml = sanitiseHtml(html || '<p>Please find your invoice attached.</p>');
    const trackingPixel = trackingUrl
      ? `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none" />`
      : '';

    // ── Send via SendGrid ───────────────────────────────────────────
    const emailBody = {
      personalizations: [{ to: [{ email: to }] }],
      from: {
        email: Deno.env.get('SENDGRID_FROM_EMAIL') || 'invoices@ledgr.app',
        name: 'Ledgr',
      },
      subject: 'Your Ledgr invoice',
      content: [{ type: 'text/html', value: `${safeHtml}${trackingPixel}` }],
      attachments: pdfBase64
        ? [{ content: pdfBase64, filename: 'invoice.pdf', type: 'application/pdf', disposition: 'attachment' }]
        : undefined,
    };

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sendgridKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(emailBody),
    });
    if (!res.ok) return json({ error: `SendGrid rejected email (${res.status})` }, 502);

    // ── Record delivery event ───────────────────────────────────────
    await admin.from('invoices').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    } as never).eq('id', invoiceId);

    await admin.from('invoice_delivery_events').insert({
      invoice_id: invoiceId,
      business_id: invoice.business_id,
      event_type: 'sent',
    } as never);

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unable to send' }, 400);
  }
});
