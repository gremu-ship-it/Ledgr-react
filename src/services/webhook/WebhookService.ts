import { supabase } from '@/lib/supabase';

export interface Webhook {
  id: string;
  business_id: string;
  url: string;
  events: string[];
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

// Signing secrets are intentionally never returned to the browser. The Edge
// Function generates/uses them with the service role when delivering events.
const WEBHOOK_COLUMNS = 'id, business_id, url, events, is_active, created_at, last_triggered_at';
const DELIVERY_COLUMNS = 'id, webhook_id, event, payload, status_code, response_body, attempt, created_at, delivered_at';

export class WebhookService {
  async registerWebhook(businessId: string, url: string, events: string[]): Promise<Webhook> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('Webhook URL must be an HTTPS URL without embedded credentials.');
    }

    // The database default generates the signing secret. Do not create or
    // return it in browser code.
    const { data, error } = await supabase
      .from('webhooks')
      .insert({
        business_id: businessId,
        url,
        events,
        is_active: true,
      })
      .select(WEBHOOK_COLUMNS)
      .single();

    if (error) throw error;
    if (!data) throw new Error('Webhook was not created.');
    return data;
  }

  async listWebhooks(businessId: string): Promise<Webhook[]> {
    const { data, error } = await supabase
      .from('webhooks')
      .select(WEBHOOK_COLUMNS)
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    const { error } = await supabase
      .from('webhooks')
      .update({ is_active: false })
      .eq('id', webhookId);
    if (error) throw error;
  }

  async getDeliveries(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select(DELIVERY_COLUMNS)
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
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
