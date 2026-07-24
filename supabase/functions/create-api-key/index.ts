import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

serve(async (req) => {
  try {
    const { business_id, name } = await req.json();

    if (!business_id || !name) {
      return new Response(
        JSON.stringify({ error: "business_id and name are required" }),
        { status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Generate a secure API key
    const rawKey = `ledgr_sk_${crypto.randomUUID().replace(/-/g, "")}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const keyPrefix = rawKey.slice(0, 16);

    const { data: record, error } = await supabase
      .from("api_keys")
      .insert({
        business_id,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
      })
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }

    return new Response(
      JSON.stringify({
        key: rawKey,           // Only returned once
        record,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
});