// This function can be called from other Edge Functions or database triggers
export async function fireWebhook(businessId: string, event: string, payload: any) {
  const { data: webhooks } = await supabase
    .from("webhooks")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .contains("events", [event]);

  for (const webhook of webhooks || []) {
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ledgr-Signature": await createSignature(webhook.secret, payload),
        },
        body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() }),
      });

      await supabase.from("webhook_deliveries").insert({
        webhook_id: webhook.id,
        event,
        payload,
        status_code: res.status,
        response_body: await res.text(),
        attempts: 1,
        delivered_at: new Date().toISOString(),
      });
    } catch (err) {
      // Retry logic can be added here (exponential backoff)
      console.error("Webhook failed:", err);
    }
  }
}