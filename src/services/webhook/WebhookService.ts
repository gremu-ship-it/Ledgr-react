import { supabase } from '@/lib/supabase';

export interface Webhook {
  id: string;
  business_id: string;
  url: string;
  events: string[];
  secret: string | null;
  is_active: boolean;
  created_at: string;
  last_triggered_at: string | null;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: unknown;
  status_code: number | null;
  response_body: string | null;
  attempt: number;
  created_at: string;
  delivered_at: string | null;
}

type WebhookInsert = {
  business_id: string;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
};

type UntypedSupabase = typeof supabase & {
  from: (relation: string) => {
    select: (columns?: string) => unknown;
    insert: (values: WebhookInsert) => unknown;
    update: (values: Record<string, unknown>) => unknown;
  };
};

const db = supabase as UntypedSupabase;

export class WebhookService {
  async registerWebhook(businessId: string, url: string, events: string[]): Promise<Webhook> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS.');

    const secret = crypto.randomUUID().replace(/-/g, '');

    const query = db.from('webhooks').insert({
      business_id: businessId,
      url,
      events,
      secret,
      is_active: true,
    }) as {
      select: () => { single: () => Promise<{ data: Webhook | null; error: unknown }> };
    };

    const { data, error } = await query.select().single();
    if (error) throw error;
    if (!data) throw new Error('Webhook was not created.');
    return data;
  }

  async listWebhooks(businessId: string): Promise<Webhook[]> {
    const query = db.from('webhooks').select('*') as {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          order: (column: string, options: { ascending: boolean }) => Promise<{ data: Webhook[] | null; error: unknown }>;
        };
      };
    };

    const { data, error } = await query
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    const query = db.from('webhooks').update({ is_active: false }) as {
      eq: (column: string, value: unknown) => Promise<{ error: unknown }>;
    };

    const { error } = await query.eq('id', webhookId);
    if (error) throw error;
  }

  async getDeliveries(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
    const query = db.from('webhook_deliveries').select('*') as {
      eq: (column: string, value: unknown) => {
        order: (column: string, options: { ascending: boolean }) => {
          limit: (limit: number) => Promise<{ data: WebhookDelivery[] | null; error: unknown }>;
        };
      };
    };

    const { data, error } = await query
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Dispatch via an Edge Function so delivery happens server-side, avoids
   * browser CORS issues, and keeps webhook secrets out of the client.
   */
  async triggerWebhooks(businessId: string, event: string, payload: unknown): Promise<void> {
    const { data, error } = await supabase.functions.invoke('webhook-dispatcher', {
      body: { business_id: businessId, event, payload },
    });
    if (error) throw error;
    if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  }
}

export const webhookService = new WebhookService();
