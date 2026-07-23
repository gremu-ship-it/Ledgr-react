// supabase/functions/invite-team-member/index.ts
//
// Adds a registered user to a business by email.
// This implements the "Team invitations require a server-side function" fix:
//
//   1. Caller must be owner or admin of the business (validated via business_users).
//   2. Target user must already have an account (registered at /register).
//      We look them up by email using the service-role Auth Admin API.
//      If not found, we return 404 with a clear message guiding the admin to
//      ask the user to register first.
//   3. If found and not already an active member, we insert/reactivate a
//      business_users row with the requested role.
//
// Body: { business_id: string, email: string, role: string }
// Returns: { success, member, message }

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
  'auditor',
  'viewer',
]);

// Backward compatibility: old SettingsPage used 'staff' which doesn't exist in DB enum.
const ROLE_ALIASES: Record<string, string> = {
  staff: 'accountant',
};

function normalizeRole(input: string): string | null {
  const lower = (input || '').trim().toLowerCase();
  const mapped = ROLE_ALIASES[lower] ?? lower;
  if (ALLOWED_ROLES.has(mapped)) return mapped;
  return null;
}

async function findUserByEmail(admin: any, email: string) {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 100;
  // Cap pages to avoid infinite loops on large instances (1000 users max searched).
  const maxPages = 10;

  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find(
      (u: any) => (u.email || '').toLowerCase() === normalized,
    );
    if (found) return found;
    if (users.length < perPage) break;
    page++;
  }
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

    let body: { business_id?: string; email?: string; role?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const businessId = (body.business_id || '').trim();
    const email = (body.email || '').trim();
    const rawRole = (body.role || '').trim();

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'business_id is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'A valid email is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const role = normalizeRole(rawRole);
    if (!role) {
      return new Response(
        JSON.stringify({
          error: `Invalid role '${rawRole}'. Allowed: ${Array.from(ALLOWED_ROLES).join(', ')} (staff alias allowed)`,
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

    // Verify caller membership and permission
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

    // Only owners can assign owner or admin
    if ((role === 'owner' && callerRole !== 'owner') || (role === 'admin' && callerRole !== 'owner')) {
      return new Response(
        JSON.stringify({
          error: `Only business owners can assign the '${role}' role. Your role is '${callerRole}'.`,
        }),
        {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    // All other cases: caller must be owner or admin
    if (!['owner', 'admin'].includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'Only owners and admins can add team members' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Lookup target user
    const targetUser = await findUserByEmail(admin, email);

    if (!targetUser) {
      return new Response(
        JSON.stringify({
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          message: `No account found for ${email}. Ask them to register at /register first, then try again.`,
        }),
        {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    if (targetUser.id === callerId) {
      return new Response(JSON.stringify({ error: 'You cannot add yourself' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Check existing membership
    const { data: existing, error: existingErr } = await admin
      .from('business_users')
      .select('id, is_active, role')
      .eq('business_id', businessId)
      .eq('user_id', targetUser.id)
      .maybeSingle();

    if (existingErr) {
      return new Response(JSON.stringify({ error: `Failed to check existing membership: ${existingErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();

    if (existing) {
      if ((existing as any).is_active) {
        return new Response(
          JSON.stringify({
            error: 'Already a member',
            code: 'ALREADY_MEMBER',
            message: `${email} is already an active member with role '${(existing as any).role}'.`,
          }),
          {
            status: 409,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          },
        );
      } else {
        // Reactivate
        const { error: updateErr } = await admin
          .from('business_users')
          .update({
            role,
            is_active: true,
            invited_by: callerId,
            invited_at: now,
            accepted_at: now,
            updated_at: now,
            invitation_token: null,
            invitation_expires_at: null,
          })
          .eq('id', (existing as any).id);

        if (updateErr) {
          return new Response(JSON.stringify({ error: `Failed to reactivate member: ${updateErr.message}` }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: `${email} has been re-added to the business as ${role}.`,
            member: {
              user_id: targetUser.id,
              email: targetUser.email,
              role,
              business_id: businessId,
              reactivated: true,
            },
          }),
          { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Insert new membership
    const { data: inserted, error: insertErr } = await admin
      .from('business_users')
      .insert({
        business_id: businessId,
        user_id: targetUser.id,
        role,
        is_active: true,
        invited_by: callerId,
        invited_at: now,
        accepted_at: now,
      })
      .select('id')
      .maybeSingle();

    if (insertErr) {
      return new Response(JSON.stringify({ error: `Failed to add member: ${insertErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Try to fetch profile for nicer response
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('id', targetUser.id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        success: true,
        message: `${email} has been added to the business as ${role}.`,
        member: {
          id: (inserted as any)?.id,
          user_id: targetUser.id,
          email: targetUser.email,
          full_name: (profile as any)?.full_name ?? null,
          role,
          business_id: businessId,
        },
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('invite-team-member error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
