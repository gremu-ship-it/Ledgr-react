import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "./middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/v1", "");
  const method = req.method;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ledgr_sk_")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const apiKey = authHeader.replace("Bearer ", "");

  try {
    await checkRateLimit(supabase, apiKey);

    const { data: keyRecord } = await supabase
      .from("api_keys")
      .select("business_id")
      .eq("key_hash", await hashKey(apiKey))
      .is("revoked_at", null)
      .single();

    if (!keyRecord) throw new Error("Invalid API key");
    const businessId = keyRecord.business_id;

    // === INVOICES ===
    if (path === "/invoices" && method === "GET") {
      const { data } = await supabase.from("invoices").select("*").eq("business_id", businessId);
      return jsonResponse(data);
    }

    if (path === "/invoices" && method === "POST") {
      const body = await req.json();
      const { data, error } = await supabase.from("invoices").insert({ ...body, business_id: businessId }).select().single();
      if (error) throw error;
      return jsonResponse(data, 201);
    }

    // === EXPENSES ===
    if (path === "/expenses" && method === "GET") {
      const { data } = await supabase.from("expenses").select("*").eq("business_id", businessId);
      return jsonResponse(data);
    }

    if (path === "/expenses" && method === "POST") {
      const body = await req.json();
      const { data, error } = await supabase.from("expenses").insert({ ...body, business_id: businessId }).select().single();
      if (error) throw error;
      return jsonResponse(data, 201);
    }

    // === JOURNAL ENTRIES ===
    if (path === "/journal-entries" && method === "GET") {
      const { data } = await supabase.from("journal_entries").select("*").eq("business_id", businessId);
      return jsonResponse(data);
    }

    if (path === "/journal-entries" && method === "POST") {
      const body = await req.json();
      const { data, error } = await supabase.from("journal_entries").insert({ ...body, business_id: businessId }).select().single();
      if (error) throw error;
      return jsonResponse(data, 201);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}