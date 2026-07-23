// supabase/functions/create-invite-link/index.ts
//
// Generates a shareable invitation link for a business.
// Only owners and admins can create invitation links.
// Only owners can generate invitations for owner or admin roles.
//
// Body: { business_id: string, role: string, email?: string, origin?: string }
// Returns: { success, invite_url, business_name, role, email, expires_at }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_ROLES = new Set([
  'owner',
  'admin',
  'accountant',
  'payroll_manager',
  'supervisor',
  'data_entry',
  'inventory_manager',
  'sales_clerk',
  'auditor',
  'viewer',
]);

function normalizeRole(input: string): string | null {
  const lower = (input || '').trim().toLowerCase();
  if (ALLOWED_ROLES.has(lower)) return lower;
  if (lower === 'staff') return 'accountant'; // Legacy alias
  return null;
}

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
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerId = callerData.user.id;

    let body: { business_id?: string; role?: string; email?: string; origin?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const businessId = (body.business_id || '').trim();
    const rawRole = (body.role || '').trim();
    const email = body.email ? body.email.trim().toLowerCase() : null;
    const origin = body.origin || '';

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'business_id is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const role = normalizeRole(rawRole);
    if (!role) {
      return new Response(
        JSON.stringify({
          error: `Invalid role '${rawRole}'. Allowed: ${Array.from(ALLOWED_ROLES).join(', ')}`,
        }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Verify caller membership and role
    const { data: callerMembership, error: membershipErr } = await admin
      .from('business_users')
      .select('role, is_active')
      .eq('business_id', businessId)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (membershipErr) {
      return new Response(JSON.stringify({ error: `Failed to verify membership: ${membershipErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!callerMembership) {
      return new Response(JSON.stringify({ error: 'You are not a member of this business' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerRole = (callerMembership as any).role as string;

    // 2. Only owners can assign owner or admin
    if ((role === 'owner' && callerRole !== 'owner') || (role === 'admin' && callerRole !== 'owner')) {
      return new Response(
        JSON.stringify({
          error: `Only business owners can invite users to the '${role}' role. Your role is '${callerRole}'.`,
        }),
        {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    // 3. Caller must be owner or admin to invite anyone
    if (!['owner', 'admin'].includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'Only owners and admins can create invitation links' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 4. Fetch business details
    const { data: business, error: bizErr } = await admin
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .maybeSingle();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 5. Generate a secure 32-byte hex token
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 6. Insert the invitation
    const { error: insertErr } = await admin
      .from('business_invitations')
      .insert({
        business_id: businessId,
        email: email || null,
        role,
        token,
        invited_by: callerId,
        invited_at: now.toISOString(),
        expires_at: expiresAt,
      });

    if (insertErr) {
      return new Response(JSON.stringify({ error: `Failed to insert invitation: ${insertErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 7. Construct dynamic accept URL
    const targetOrigin = origin || 'http://localhost:5173';
    const inviteUrl = `${targetOrigin}/accept-invitation?token=${token}`;

    return new Response(
      JSON.stringify({
        success: true,
        invite_url: inviteUrl,
        business_name: (business as any).name,
        role,
        email,
        expires_at: expiresAt,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('create-invite-link error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
