// supabase/functions/accept-invite-link/index.ts
//
// Consumes a shareable invitation token.
// If the token is found in business_invitations:
//   - Verifies the invitation is not expired and not already accepted.
//   - If an email restriction was specified, verifies it matches the caller's email.
//   - Checks if caller is already an active member of that business.
//   - Reactivates or inserts a business_users row with the invitation's role.
//   - Marks invitation accepted.
// If the token is not found in business_invitations, falls back to the legacy accept_invitation RPC.
//
// Body: { token: string }
// Returns: { success, business_id, role, business_name }

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
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const callerId = callerData.user.id;
    const callerEmail = callerData.user.email || '';

    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const token = (body.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'token is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Look up invitation
    const { data: invitation, error: inviteErr } = await admin
      .from('business_invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (inviteErr) {
      return new Response(JSON.stringify({ error: `Database error: ${inviteErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── FALLBACK TO LEGACY RPC ───────────────────────────────────────────────
    if (!invitation) {
      console.log(`Token ${token} not found in business_invitations. Trying legacy RPC accept_invitation...`);
      const { data: rpcData, error: rpcError } = await callerClient.rpc('accept_invitation', {
        p_token: token,
      });

      if (rpcError) {
        return new Response(
          JSON.stringify({
            error: `Invitation not found or failed: ${rpcError.message}`,
            code: 'INVITATION_NOT_FOUND',
          }),
          {
            status: 404,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          business_id: rpcData.business_id,
          role: rpcData.role,
          business_name: rpcData.business_name,
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    // ── NEW INVITATION FLOW ──────────────────────────────────────────────────
    // 2. Check if already accepted
    if (invitation.accepted_at) {
      return new Response(
        JSON.stringify({
          error: 'This invitation has already been accepted.',
          code: 'INVITATION_ALREADY_ACCEPTED',
        }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    // 3. Check expiry
    const expiresAt = new Date(invitation.expires_at);
    const now = new Date();
    if (expiresAt < now) {
      return new Response(
        JSON.stringify({
          error: 'This invitation link has expired (7-day validity). Ask the business owner to create a new one.',
          code: 'INVITATION_EXPIRED',
        }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    // 4. Verify email restriction
    if (invitation.email && invitation.email.toLowerCase() !== callerEmail.toLowerCase()) {
      return new Response(
        JSON.stringify({
          error: `This invitation link is restricted to ${invitation.email}, but you are currently signed in as ${callerEmail}.`,
          code: 'EMAIL_RESTRICTION_MISMATCH',
        }),
        {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    // 5. Fetch business name
    const { data: business, error: bizErr } = await admin
      .from('businesses')
      .select('name')
      .eq('id', invitation.business_id)
      .maybeSingle();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business associated with invitation not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 6. Check existing membership
    const { data: existing, error: existingErr } = await admin
      .from('business_users')
      .select('id, is_active, role')
      .eq('business_id', invitation.business_id)
      .eq('user_id', callerId)
      .maybeSingle();

    if (existingErr) {
      return new Response(JSON.stringify({ error: `Membership check failed: ${existingErr.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const nowStr = now.toISOString();

    if (existing) {
      if (existing.is_active) {
        return new Response(
          JSON.stringify({
            error: `You are already an active member of this business with the role '${existing.role}'.`,
            code: 'ALREADY_MEMBER',
            business_id: invitation.business_id,
          }),
          {
            status: 409,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          },
        );
      } else {
        // Reactivate inactive membership
        const { error: updateErr } = await admin
          .from('business_users')
          .update({
            role: invitation.role,
            is_active: true,
            accepted_at: nowStr,
            updated_at: nowStr,
            invited_by: invitation.invited_by,
            invited_at: invitation.invited_at,
          })
          .eq('id', existing.id);

        if (updateErr) {
          return new Response(JSON.stringify({ error: `Failed to reactivate membership: ${updateErr.message}` }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
      }
    } else {
      // Create new membership
      const { error: insertErr } = await admin
        .from('business_users')
        .insert({
          business_id: invitation.business_id,
          user_id: callerId,
          role: invitation.role,
          is_active: true,
          invited_by: invitation.invited_by,
          invited_at: invitation.invited_at,
          accepted_at: nowStr,
        });

      if (insertErr) {
        return new Response(JSON.stringify({ error: `Failed to create membership: ${insertErr.message}` }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // 7. Mark invitation accepted
    const { error: acceptErr } = await admin
      .from('business_invitations')
      .update({
        accepted_at: nowStr,
        accepted_by: callerId,
      })
      .eq('id', invitation.id);

    if (acceptErr) {
      // Log error, but don't fail request since membership was already written
      console.error('Failed to mark invitation as accepted:', acceptErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        business_id: invitation.business_id,
        role: invitation.role,
        business_name: (business as any).name,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('accept-invite-link error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
