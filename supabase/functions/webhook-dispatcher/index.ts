import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';
import { hmacSha256Hex } from '../_shared/crypto.ts';
import { isPrivateIp } from '../_shared/urlSafety.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ALLOWED_EVENTS = new Set([
  'invoice.created', 'invoice.paid', 'expense.created', 'payroll.run',
  'tax.due_soon', 'journal_entry.created',
]);

let _req: Request | undefined;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
  });
}

async function assertMember(authHeader: string, businessId: string): Promise<Response | null> {
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerData?.user) return json({ error: 'Invalid or expired session' }, 401);

  const { data: membership } = await supabase
    .from('business_users')
    .select('id')
    .eq('business_id', businessId)
    .eq('user_id', callerData.user.id)
    .eq('is_active', true)
    .maybeSingle();

  // The current application invokes this from permitted business actions in
  // the browser, so active membership is required here. Event names are
  // separately allowlisted below; moving dispatch fully server-side is the
  // next step before arbitrary user-supplied payloads can be eliminated.
  return membership ? null : json({ error: 'Not authorized for this business' }, 403);
}

async function assertPublicWebhookDestination(endpoint: URL): Promise<void> {
  const host = endpoint.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || isPrivateIp(host)) {
    throw new Error('Webhook destination is not a public address');
  }
  const records = await Promise.all(['A', 'AAAA'].map((type) =>
    Deno.resolveDns(host, type as 'A' | 'AAAA').catch(() => [] as string[]),
  ));
  const addresses = records.flat();
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new Error('Webhook destination does not resolve exclusively to public addresses');
  }
}

async function deliverWebhooks(businessId: string, event: string, payload: unknown) {
  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .contains('events', [event]);

  let delivered = 0;
  for (const webhook of webhooks ?? []) {
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const endpoint = new URL(webhook.url);
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
          throw new Error('Webhook destination is not a permitted public HTTPS endpoint');
        }
        await assertPublicWebhookDestination(endpoint);
        const res = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'X-Ledgr-Event': event,
            'X-Ledgr-Signature': await hmacSha256Hex(webhook.secret, body),
          },
          body,
        });
        // Do not persist the recipient response: it can contain secrets from a
        // destination reached through a misconfiguration or SSRF bypass.
        await supabase.from('webhook_deliveries').insert({
          webhook_id: webhook.id,
          event,
          payload,
          status_code: res.status,
          response_body: null,
          attempt,
          delivered_at: res.ok ? new Date().toISOString() : null,
        });
        await supabase.from('webhooks').update({ last_triggered_at: new Date().toISOString() }).eq('id', webhook.id);
        if (res.ok) {
          delivered += 1;
          break;
        }
      } catch (err) {
        await supabase.from('webhook_deliveries').insert({
          webhook_id: webhook.id,
          event,
          payload,
          status_code: null,
          response_body: err instanceof Error ? err.message : String(err),
          attempt,
        });
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
    }
  }
  return { subscribed: webhooks?.length ?? 0, delivered };
}

serve(async (req) => {
  _req = req;
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const body = await req.json().catch(() => null) as { business_id?: string; event?: string; payload?: unknown } | null;
  if (!body?.business_id || !body.event) return json({ error: 'business_id and event are required' }, 400);
  if (!ALLOWED_EVENTS.has(body.event)) return json({ error: 'Unsupported webhook event' }, 400);

  const authError = await assertMember(authHeader, body.business_id);
  if (authError) return authError;

  const result = await deliverWebhooks(body.business_id, body.event, body.payload ?? {});
  return json({ ok: true, ...result });
});
