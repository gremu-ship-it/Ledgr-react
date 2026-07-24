import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT = 100; // requests per minute

export async function checkRateLimit(supabase: SupabaseClient, apiKey: string) {
  const { data } = await supabase
    .from("api_usage")
    .select("count")
    .eq("api_key", apiKey)
    .gte("window_start", new Date(Date.now() - 60 * 1000).toISOString())
    .single();

  const count = data?.count || 0;

  if (count >= RATE_LIMIT) {
    throw new Error("Rate limit exceeded (100 requests/minute)");
  }

  // Increment usage
  await supabase.from("api_usage").upsert({
    api_key: apiKey,
    count: count + 1,
    window_start: new Date().toISOString(),
  }, { onConflict: "api_key" });
}