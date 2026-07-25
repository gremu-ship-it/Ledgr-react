import { supabase } from '@/lib/supabase';

export interface Webhook {
  id: string;
  business_id: string;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: unknown;
  status_code: number | null;
  response_body: string | null;
  attempts: number;
  delivered_at: string | null;
}

type QueryResult<T> = Promise<{ data: T | null; error: unknown }>;
type UntypedQuery = {
  select: (columns?: string) => UntypedQuery;
  insert: (values: Record<string, unknown>) => UntypedQuery;
  delete: () => UntypedQuery;
  eq: (column: string, value: unknown) => UntypedQuery;
  order: (column: string, options: { ascending: boolean }) => UntypedQuery;
  limit: (count: number) => QueryResult<WebhookDelivery[]>;
  single: () => QueryResult<Webhook>;
  then: Promise<{ data: unknown; error: unknown }>['then'];
};

type UntypedSupabase = typeof supabase & {
  from: (relation: string) => UntypedQuery;
};

const db = supabase as UntypedSupabase;

export class WebhookService {
  async registerWebhook(businessId: string, url: string, events: string[]): Promise<Webhook> {
    const { data, error } = await db
      .from('webhooks')
      .insert({
        business_id: businessId,
        url,
        events,
        secret: crypto.randomUUID(),
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    if (!data) throw new Error('Failed to create webhook');
    return data;
  }

  async listWebhooks(businessId: string): Promise<Webhook[]> {
    const { data, error } = await db
      .from('webhooks')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false }) as { data: Webhook[] | null; error: unknown };
    if (error) throw error;
    return data || [];
  }

  async getDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
    const { data, error } = await db
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  async deleteWebhook(id: string): Promise<void> {
    const { error } = await db.from('webhooks').delete().eq('id', id) as { error: unknown };
    if (error) throw error;
  }
}

export const webhookService = new WebhookService();
