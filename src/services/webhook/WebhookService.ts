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
  payload: any;
  status_code: number | null;
  response_body: string | null;
  attempt: number;
  created_at: string;
  delivered_at: string | null;
}

export class WebhookService {
  // Register a new webhook
  async registerWebhook(businessId: string, url: string, events: string[]): Promise<Webhook> {
    const secret = crypto.randomUUID();

    const { data, error } = await supabase
      .from('webhooks')
      .insert({
        business_id: businessId,
        url,
        events,
        secret,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // List active webhooks
  async listWebhooks(businessId: string): Promise<Webhook[]> {
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Delete (deactivate) a webhook
  async deleteWebhook(webhookId: string): Promise<void> {
    const { error } = await supabase
      .from('webhooks')
      .update({ is_active: false })
      .eq('id', webhookId);

    if (error) throw error;
  }

  // Log a webhook delivery attempt
  async logDelivery(
    webhookId: string,
    event: string,
    payload: any,
    statusCode: number | null,
    responseBody: string | null,
    attempt: number
  ): Promise<void> {
    await supabase.from('webhook_deliveries').insert({
      webhook_id: webhookId,
      event,
      payload,
      status_code: statusCode,
      response_body: responseBody,
      attempt,
      delivered_at: statusCode && statusCode < 400 ? new Date().toISOString() : null,
    });
  }

  // Get delivery history for a webhook
  async getDeliveries(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // Trigger webhooks for an event (with retry logic)
  async triggerWebhooks(businessId: string, event: string, payload: any) {
    const webhooks = await this.listWebhooks(businessId);
    const relevant = webhooks.filter(w => w.events.includes(event));

    for (const webhook of relevant) {
      await this.deliverWithRetry(webhook, event, payload);
    }
  }

  // Deliver with exponential backoff (3 retries)
  private async deliverWithRetry(webhook: Webhook, event: string, payload: any, attempt = 1): Promise<void> {
    const maxAttempts = 3;
    const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ledgr-Event': event,
          'X-Ledgr-Signature': this.generateSignature(webhook.secret || '', payload),
        },
        body: JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          data: payload,
        }),
      });

      const responseText = await response.text();

      await this.logDelivery(
        webhook.id,
        event,
        payload,
        response.status,
        responseText,
        attempt
      );

      if (!response.ok && attempt < maxAttempts) {
        setTimeout(() => {
          this.deliverWithRetry(webhook, event, payload, attempt + 1);
        }, backoffMs);
      }
    } catch (err: any) {
      await this.logDelivery(webhook.id, event, payload, null, err.message, attempt);

      if (attempt < maxAttempts) {
        setTimeout(() => {
          this.deliverWithRetry(webhook, event, payload, attempt + 1);
        }, backoffMs);
      }
    }
  }

  private generateSignature(secret: string, payload: any): string {
    // Simple HMAC simulation (in production use crypto.subtle or a library)
    return btoa(secret + JSON.stringify(payload)).slice(0, 32);
  }
}

export const webhookService = new WebhookService();