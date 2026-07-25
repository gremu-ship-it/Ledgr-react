import { supabase } from '@/lib/supabase';

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
}

type WebhookQuery = {
  select: (columns?: string) => WebhookQuery;
  eq: (column: string, value: unknown) => WebhookQuery;
  contains: (column: string, value: unknown[]) => Promise<{ data: WebhookRow[] | null }>;
  insert: (values: Record<string, unknown>) => Promise<{ error: unknown }>;
};

type UntypedSupabase = typeof supabase & {
  from: (relation: string) => WebhookQuery;
};

const db = supabase as UntypedSupabase;

export async function triggerWebhook(businessId: string, event: string, payload: unknown) {
  const { data: webhooks } = await db
    .from('webhooks')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .contains('events', [event]);

  for (const webhook of (webhooks || []) as WebhookRow[]) {
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ledgr-Signature': await createSignature(webhook.secret, payload),
        },
        body: JSON.stringify({
          event,
          payload,
          timestamp: new Date().toISOString(),
        }),
      });

      await db.from('webhook_deliveries').insert({
        webhook_id: webhook.id,
        event,
        payload,
        status_code: res.status,
        response_body: await res.text(),
        attempts: 1,
        delivered_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Webhook delivery failed:', err);
    }
  }
}

async function createSignature(secret: string, payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(JSON.stringify(payload))
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
