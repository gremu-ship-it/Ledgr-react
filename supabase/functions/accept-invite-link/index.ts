// supabase/functions/accept-invite-link/index.ts
//
// Consumes a shareable invitation token.
// If the token is found in business_invitations:
//   - Verifies the invitation is not expired and not already accepted.
//   - If an email or phone restriction was specified, verifies the caller holds
//     it. Phone is checked first, matching create-invite-link.
//   - Checks if caller is already an active member of that business.
//   - Reactivates or inserts a business_users row with the invitation's role.
//   - Marks invitation accepted.
// If the token is not found in business_invitations, falls back to the legacy accept_invitation RPC.
//
// Body: { token: string }
// Returns: { success, business_id, role, business_name }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import { formatPhoneForDisplay, isPhoneLoginEmail, normalizePhone, phoneLoginEmail } from '../_shared/phone.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

let _req: Request | undefined;

serve(async (req) => {
  _req = req;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(_req) });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    const token = (body.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'token is required' }), {
        status: 400,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
            headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
        },
      );
    }

    // 4. Verify the restriction the owner put on this link
    /**
     * The number this caller proved they hold, when the link was restricted to
     * one. Kept so step 6 can put it on the profile even when GoTrue never
     * stored it on the auth user — the team list and any later phone-restricted
     * invite both read it from there.
     */
    let matchedPhone: string | null = null;

    if (invitation.phone) {
      // A phone account carries its number on the auth user; older accounts may
      // only have it on the profile, so check both before refusing.
      let callerPhone = normalizePhone(callerData.user.phone ?? '');
      if (!callerPhone) {
        const { data: profile } = await admin
          .from('user_profiles')
          .select('phone')
          .eq('id', callerId)
          .maybeSingle();
        callerPhone = normalizePhone(
          (profile as { phone?: string | null } | null)?.phone ?? '',
        );
      }

      // Third source, and the one that needs no query: a Ledgr-provisioned phone
      // account signs in with an address derived from its number, so that address
      // alone proves which number the caller holds. It covers accounts created
      // before the number was written to auth.users or to the profile.
      if (!callerPhone && isPhoneLoginEmail(callerEmail)) {
        callerPhone = phoneLoginEmail(invitation.phone) === callerEmail.toLowerCase()
          ? normalizePhone(invitation.phone)
          : null;
      }

      if (callerPhone !== normalizePhone(invitation.phone)) {
        // Never quote the synthetic login address back at a person: it is an
        // implementation detail, and "signed in as 265991234567@phone.ledgr.app"
        // reads like a bug rather than like a mismatched number.
        const signedInAs = callerPhone
          ? formatPhoneForDisplay(callerPhone)
          : isPhoneLoginEmail(callerEmail)
            ? 'a different number'
            : callerEmail || 'a different account';

        return new Response(
          JSON.stringify({
            error: `This invitation link is for ${formatPhoneForDisplay(invitation.phone)}, but you are signed in as ${signedInAs}.`,
            code: 'PHONE_RESTRICTION_MISMATCH',
          }),
          {
            status: 403,
            headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
          },
        );
      }

      matchedPhone = callerPhone;
    } else if (invitation.email && invitation.email.toLowerCase() !== callerEmail.toLowerCase()) {
      return new Response(
        JSON.stringify({
          error: `This invitation link is restricted to ${invitation.email}, but you are currently signed in as ${callerEmail}.`,
          code: 'EMAIL_RESTRICTION_MISMATCH',
        }),
        {
          status: 403,
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    // R01: commit the role transition only after current issuer/target authority
    // is checked under database locks. Pass the DB snapshot, never body role/org/user.
    // Existing email/phone restrictions above remain the identity boundary.
    const { data: accepted, error: authorityErr } = await admin.rpc('accept_invitation_membership', {
      p_invitation_id: invitation.id,
      p_recipient_id: callerId,
      p_expected_invitation: invitation,
    });
    if (authorityErr || !accepted) {
      const status = authorityErr?.code === '42501' ? 403
        : authorityErr?.code === 'P0002' ? 404
        : authorityErr?.code === '55000' ? 400 : 500;
      return new Response(JSON.stringify({ error: 'Invitation cannot be authorized. Ask an authorized owner or admin to reissue it.' }), {
        status, headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }
    // 6. Guarantee a profile row. user_profiles.full_name is NOT NULL and the
    //    team list joins it, so a member without one appears blank. Mirrors
    //    grant_user_business_access (20260728000003) and the invite RPC in
    //    20260815000000. ignoreDuplicates keeps an existing name untouched.
    const { data: callerAuth } = await admin.auth.admin.getUserById(callerId);
    const callerName =
      (callerAuth?.user?.user_metadata?.full_name as string | undefined) ||
      (callerAuth?.user?.user_metadata?.name as string | undefined) ||
      (callerEmail ? callerEmail.split('@')[0] : 'Team member');
    // GoTrue stores an empty string, not null, for an account created without a
    // phone field, so normalise before falling back to the matched restriction.
    const callerNumber = normalizePhone(callerAuth?.user?.phone ?? '') ?? matchedPhone;

    await admin.from('user_profiles').upsert(
      { id: callerId, full_name: callerName, ...(callerNumber ? { phone: callerNumber } : {}) },
      { onConflict: 'id', ignoreDuplicates: true },
    );

    // ignoreDuplicates skips the phone on a row that already existed, and that
    // number is the member's only identity in the team list — fill a blank
    // without ever overwriting one they set themselves.
    if (callerNumber) {
      await admin
        .from('user_profiles')
        .update({ phone: callerNumber })
        .eq('id', callerId)
        .is('phone', null);
    }

    if (accepted.already_member) {
      return new Response(JSON.stringify({
        error: `You are already an active member of this business with the role '${accepted.role}'.`,
        code: 'ALREADY_MEMBER', business_id: accepted.business_id,
      }), { status: 409, headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' } });
    }

    return new Response(
      JSON.stringify({
        success: true,
        business_id: invitation.business_id,
        role: invitation.role,
        business_name: business?.name ?? null,
      }),
      {
        status: 200,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('accept-invite-link error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
    });
  }
});