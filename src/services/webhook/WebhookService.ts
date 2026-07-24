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
  payload: any;
  status_code: number | null;
  response_body: string | null;
  attempts: number;
  delivered_at: string | null;
}

export class WebhookService {
  async registerWebhook(businessId: string, url: string, events: string[]): Promise<Webhook> {
    const { data, error } = await supabase
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
    return data;
  }

  async listWebhooks(businessId: string): Promise<Webhook[]> {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async getDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  async deleteWebhook(id: string): Promise<void> {
    const { error } = await supabase.from('webhooks').delete().eq('id', id);
    if (error) throw error;
  }
}

export const webhookService = new WebhookService();