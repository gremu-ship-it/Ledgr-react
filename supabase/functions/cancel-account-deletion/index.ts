// supabase/functions/cancel-account-deletion/index.ts
//
// Lets a user cancel their own pending deletion any time before it's
// finalized (before the 30-day mark). Only clears deletion_requested_at —
// does NOT restore the anonymized name/phone/avatar, since we don't keep
// the original values anywhere (anonymization is intentionally one-way).
// The person just re-enters their name etc. in User Profile afterward.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: existing } = await admin
      .from('user_profiles')
      .select('deletion_requested_at, deletion_finalized_at')
      .eq('id', userId)
      .maybeSingle();

    if (!existing?.deletion_requested_at) {
      return new Response(JSON.stringify({ error: 'No pending deletion to cancel' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (existing.deletion_finalized_at) {
      return new Response(JSON.stringify({
        error: 'This account has already been permanently locked and can no longer be cancelled. Contact support.',
      }), { status: 410, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const { error: updateErr } = await admin
      .from('user_profiles')
      .update({ deletion_requested_at: null })
      .eq('id', userId);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
