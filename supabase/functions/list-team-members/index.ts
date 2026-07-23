// supabase/functions/list-team-members/index.ts
// Returns team members for a business with email + profile, bypassing RLS
// limitation that anonymous users cannot join auth.users.
//
// Body: { business_id }
// Requires caller to be a member (any role) of the business.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerId = callerData.user.id;

    const body = await req.json().catch(() => ({}));
    const businessId = (body.business_id || '').trim();
    if (!businessId) {
      return new Response(JSON.stringify({ error: 'business_id required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Verify caller membership
    const { data: callerMembership } = await admin
      .from('business_users')
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (!callerMembership) {
      return new Response(JSON.stringify({ error: 'Not a member of this business' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Fetch business_users
    const { data: members, error: membersErr } = await admin
      .from('business_users')
      .select('id, user_id, role, is_active, invited_at, accepted_at, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true });

    if (membersErr) {
      return new Response(JSON.stringify({ error: membersErr.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const userIds = (members ?? []).map((m: any) => m.user_id);
    if (userIds.length === 0) {
      return new Response(JSON.stringify({ members: [] }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Fetch profiles
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('id, full_name, avatar_url')
      .in('id', userIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // Fetch emails via Auth Admin — batch lookup by listing? We'll paginate and filter to needed ids for efficiency.
    // For small teams (< 20) it's cheap to list up to 100 users and match.
    // For larger, we list pages until we found all ids or hit limit.
    const emailMap = new Map<string, string>();
    let page = 1;
    const perPage = 100;
    const needed = new Set(userIds);
    let attempts = 0;
    while (needed.size > 0 && attempts < 10) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = data?.users ?? [];
      for (const u of users) {
        if (needed.has(u.id)) {
          emailMap.set(u.id, u.email ?? '');
          needed.delete(u.id);
        }
      }
      if (users.length < perPage) break;
      page++;
      attempts++;
    }

    // Build enriched members
    const enriched = (members ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      is_active: m.is_active,
      invited_at: m.invited_at,
      accepted_at: m.accepted_at,
      created_at: m.created_at,
      email: emailMap.get(m.user_id) ?? null,
      full_name: profileMap.get(m.user_id)?.full_name ?? null,
      avatar_url: profileMap.get(m.user_id)?.avatar_url ?? null,
    }));

    return new Response(JSON.stringify({ members: enriched }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
