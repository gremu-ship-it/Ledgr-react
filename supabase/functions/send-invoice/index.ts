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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

let _req: Request | undefined;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
  });
}

// ── HMAC helper (shared with invoice-open for token verification) ────────────

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── HTML sanitiser ──────────────────────────────────────────────────────────
// Allows only safe structural tags and strips everything else. This is not a
// full DOMPurify replacement but is sufficient for the controlled email body
// content Ledgr generates. Anything that could execute script (script tags,
// event handlers, javascript: URIs, iframes, objects, embeds, forms) is
// removed entirely.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'hr', 'blockquote', 'a', 'img',
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'style']),
  img: new Set(['src', 'alt', 'width', 'height', 'style']),
  td: new Set(['style', 'colspan', 'rowspan']),
  th: new Set(['style', 'colspan', 'rowspan']),
  '*': new Set(['style']),
};

function sanitiseHtml(html: string): string {
  // Remove script/style/iframe/object/embed/form tags and their content
  let clean = html.replace(/<(script|style|iframe|object|embed|form|textarea|input|button|select)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove self-closing dangerous tags
  clean = clean.replace(/<(script|style|iframe|object|embed|form|textarea|input|button|select)[^>]*\/?>/gi, '');
  // Remove event handler attributes (onclick, onerror, onload, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  // Remove javascript: and data: URIs in href/src attributes
  clean = clean.replace(/(href|src)\s*=\s*["']?\s*(javascript|data|vbscript)\s*:/gi, '$1="removed:');
  // Strip tags not in the allowlist
  clean = clean.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    // For allowed tags, strip disallowed attributes
    if (match.startsWith('</')) return `</${lower}>`;
    const attrRegex = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    const safeAttrs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = attrRegex.exec(match)) !== null) {
      const attrName = m[1].toLowerCase();
      const attrVal = m[2] ?? m[3] ?? m[4] ?? '';
      const allowed = ALLOWED_ATTRS[lower] ?? new Set<string>();
      const globalAllowed = ALLOWED_ATTRS['*'];
      if (allowed.has(attrName) || globalAllowed.has(attrName)) {
        // Block javascript: in href/src values
        if ((attrName === 'href' || attrName === 'src') && /^\s*(javascript|data|vbscript)\s*:/i.test(attrVal)) {
          continue;
        }
        safeAttrs.push(`${attrName}="${attrVal.replace(/"/g, '&quot;')}"`);
      }
    }
    const selfClosing = match.endsWith('/>');
    return `<${lower}${safeAttrs.length ? ' ' + safeAttrs.join(' ') : ''}${selfClosing ? ' /' : ''}>`;
  });
  return clean;
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
