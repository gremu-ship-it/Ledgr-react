import { supabase } from '@/lib/supabase';

/**
 * Client-side webhook trigger shim. Actual delivery is performed by the
 * webhook-dispatcher Edge Function so third-party endpoints do not need CORS
 * and webhook signing secrets never leave Supabase.
 */
export async function triggerWebhook(businessId: string, event: string, payload: unknown) {
  const { data, error } = await supabase.functions.invoke('webhook-dispatcher', {
    body: { business_id: businessId, event, payload },
  });

  if (error) throw error;
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
}
