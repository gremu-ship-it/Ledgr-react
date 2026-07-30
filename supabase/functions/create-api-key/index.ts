import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

let _req: Request | undefined;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
  });
}

async function sha256(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `ledgr_sk_${secret}`;
}

serve(async (req) => {
  _req = req;
    if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: 'Invalid or expired session' }, 401);

    const { business_id, name } = await req.json().catch(() => ({}));
    if (!business_id || !name?.trim()) {
      return json({ error: 'business_id and name are required' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: membership, error: membershipErr } = await admin
      .from('business_users')
      .select('role')
      .eq('business_id', business_id)
      .eq('user_id', callerData.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (membershipErr) return json({ error: membershipErr.message }, 500);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return json({ error: 'Only business owners/admins can create API keys' }, 403);
    }

    const rawKey = generateApiKey();
    const keyHash = await sha256(rawKey);
    const keyPrefix = `${rawKey.slice(0, 18)}…`;

    const { data: record, error } = await admin
      .from('api_keys')
      .insert({
        business_id,
        name: name.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: callerData.user.id,
      })
      .select('id, business_id, name, key_prefix, last_used_at, created_at, revoked_at')
      .single();

    if (error) return json({ error: error.message }, 400);

    return json({ key: rawKey, record });
  } catch (err) {
    console.error('create-api-key error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});
