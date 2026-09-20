// supabase/functions/invite-team-member/index.ts
//
// Adds a user to a business by email OR by phone number.
// This implements the "Team invitations require a server-side function" fix:
//
//   1. Caller must be owner or admin of the business (validated via business_users).
//   2. EMAIL path: the target must already have an account (registered at
//      /register). We look them up by email using the service-role Auth Admin
//      API. If not found we return 404 telling the admin to have them register.
//   3. PHONE path: no prior account is needed. We provision one — a phone
//      account gets a synthetic login email derived from the number
//      (265991234567@phone.ledgr.app, see _shared/phone.ts) plus a temporary
//      password, which we return once so the owner can hand it over. The member
//      then signs in with number + password; no SMS gateway is involved and
//      nothing is ever mailed to the synthetic address.
//   4. Either way we insert/reactivate a business_users row with the role, and
//      guarantee a user_profiles row (the invariant every membership-granting
//      path upholds — see grant_user_business_access, 20260728000003).
//
// Body: { business_id: string, email?: string, phone?: string, role: string,
//         full_name?: string, reset_password?: boolean }
// Returns: { success, member, message, login? }
//
// `reset_password` (phone accounts only) mints a fresh temporary password for a
// member who has forgotten theirs — there is no email inbox to reset through.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import {
  formatPhoneForDisplay,
  generateTempPassword,
  isPhoneLoginEmail,
  normalizePhone,
  phoneLoginEmail,
} from '../_shared/phone.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

let _req: Request | undefined;

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
  'purchasing_officer',
  'warehouse_worker',
  'sales_manager',
  'customer_service_rep',
  'tax_compliance_officer',
  'treasury_manager',
  'asset_manager',
  'board_member',
  'branch_manager',
  // POS roles (user_role enum values added by 20260920000000_pos_module.sql)
  'manager',
  'cashier',
  'stock_clerk',
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

async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
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
      (u) => (u.email || '').toLowerCase() === normalized,
    );
    if (found) return found;
    if (users.length < perPage) break;
    page++;
  }
  return null;
}

/**
 * Resolves the account behind a phone number.
 *
 * The local phone_accounts map is the fast path (one indexed query). It can
 * miss for an account provisioned before the map existed, or one created by
 * hand, so we fall back to the auth scan using the deterministic synthetic
 * email. Both paths are read-only; provisioning happens in the caller.
 */
async function findPhoneAccount(
  admin: SupabaseClient,
  phone: string,
  loginEmail: string,
): Promise<User | null> {
  const { data } = await admin
    .from('phone_accounts')
    .select('user_id')
    .eq('phone', phone)
    .maybeSingle();

  if (data?.user_id) {
    const { data: userData } = await admin.auth.admin.getUserById(data.user_id);
    if (userData?.user) return userData.user;
  }

  return findUserByEmail(admin, loginEmail);
}

/**
 * Membership-granting paths guarantee a user_profiles row — full_name is NOT
 * NULL and the team list joins this table, so a member without one shows up
 * blank. Mirrors grant_user_business_access (20260728000003) and the invite RPC
 * in 20260815000000.
 */
async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  fullName: string,
): Promise<void> {
  await admin.from('user_profiles').upsert(
    { id: userId, full_name: fullName || 'Team member' },
    { onConflict: 'id', ignoreDuplicates: true },
  );
}

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

    let body: {
      business_id?: string;
      email?: string;
      phone?: string;
      role?: string;
      full_name?: string;
      reset_password?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    const businessId = (body.business_id || '').trim();
    const rawPhone = (body.phone || '').trim();
    const rawRole = (body.role || '').trim();
    const fullName = (body.full_name || '').trim();
    const wantsPasswordReset = body.reset_password === true;

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'business_id is required' }), {
        status: 400,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    // One identity per invite. Phone takes precedence if a client ever sends
    // both; the form only sends one.
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      return new Response(
        JSON.stringify({
          error: 'A valid phone number is required (e.g. 0991234567 or +265991234567)',
        }),
        {
          status: 400,
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
        },
      );
    }
    const email = phone ? '' : (body.email || '').trim();
    if (!phone && (!email || !email.includes('@'))) {
      return new Response(JSON.stringify({ error: 'A valid email or phone number is required' }), {
        status: 400,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }
    /** What we call the member in messages: their number, or their address. */
    const identity = phone ? formatPhoneForDisplay(phone) : email;
    const role = normalizeRole(rawRole);
    if (!role) {
      return new Response(
        JSON.stringify({
          error: `Invalid role '${rawRole}'. Allowed: ${Array.from(ALLOWED_ROLES).join(', ')} (staff alias allowed)`,
        }),
        {
          status: 400,
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    if (!callerMembership) {
      return new Response(JSON.stringify({ error: 'You are not a member of this business' }), {
        status: 403,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    const callerRole = callerMembership.role;

    // Only owners can assign owner or admin
    if ((role === 'owner' && callerRole !== 'owner') || (role === 'admin' && callerRole !== 'owner')) {
      return new Response(
        JSON.stringify({
          error: `Only business owners can assign the '${role}' role. Your role is '${callerRole}'.`,
        }),
        {
          status: 403,
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
        },
      );
    }

    // All other cases: caller must be owner or admin
    if (!['owner', 'admin'].includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'Only owners and admins can add team members' }), {
        status: 403,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    // ── Resolve (or provision) the target account ───────────────────────────
    let targetUser: User | null;
    /** Set only when we generated a password this call — returned once, never stored. */
    let tempPassword: string | null = null;

    if (phone) {
      const loginEmail = phoneLoginEmail(phone);
      if (!loginEmail) {
        return new Response(JSON.stringify({ error: 'Could not derive a login for that number' }), {
          status: 400,
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
        });
      }

      targetUser = await findPhoneAccount(admin, phone, loginEmail);

      if (!targetUser) {
        tempPassword = generateTempPassword();
        const metadata = {
          full_name: fullName || formatPhoneForDisplay(phone),
          phone,
          login_method: 'phone',
          invited_by: callerId,
        };

        // Storing the number on the auth user needs the Phone provider enabled
        // in the project. Sign-in does NOT depend on it — the synthetic email
        // plus the phone_accounts map are enough — so if GoTrue refuses the
        // phone field we retry without it rather than failing the invite.
        let created = await admin.auth.admin.createUser({
          email: loginEmail,
          phone,
          password: tempPassword,
          // The synthetic address is not a real inbox, so there is nothing to
          // confirm — mark it confirmed or the account cannot sign in.
          email_confirm: true,
          phone_confirm: true,
          user_metadata: metadata,
        });

        if (created.error && /phone|sms|provider/i.test(created.error.message)) {
          console.warn('createUser rejected the phone field, retrying without it:', created.error.message);
          created = await admin.auth.admin.createUser({
            email: loginEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: metadata,
          });
        }

        if (created.error || !created.data?.user) {
          console.error('phone account creation failed', created.error);
          return new Response(
            JSON.stringify({
              error: `Failed to create the account: ${created.error?.message ?? 'unknown error'}`,
            }),
            {
              status: 500,
              headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
            },
          );
        }

        targetUser = created.data.user;

        // Map the number so the next invite is one query, not a user scan.
        const { error: mapErr } = await admin.from('phone_accounts').upsert(
          {
            phone,
            user_id: targetUser.id,
            business_id: businessId,
            created_by: callerId,
            temporary_password: true,
          },
          { onConflict: 'phone' },
        );
        if (mapErr) {
          // The account exists and is usable; the map is an optimisation, so a
          // failure here must not fail the invite.
          console.error('phone_accounts upsert failed', mapErr);
        }
      } else if (wantsPasswordReset && isPhoneLoginEmail(targetUser.email)) {
        // Forgotten password on a phone account: no inbox to reset through, so
        // the owner mints a new temporary one.
        tempPassword = generateTempPassword();
        const { error: pwErr } = await admin.auth.admin.updateUserById(targetUser.id, {
          password: tempPassword,
        });
        if (pwErr) {
          return new Response(
            JSON.stringify({ error: `Failed to reset the password: ${pwErr.message}` }),
            {
              status: 500,
              headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
            },
          );
        }
        await admin
          .from('phone_accounts')
          .update({ temporary_password: true })
          .eq('user_id', targetUser.id);
      }

      await ensureProfile(admin, targetUser.id, fullName || formatPhoneForDisplay(phone));
    } else {
      targetUser = await findUserByEmail(admin, email);

      if (!targetUser) {
        return new Response(
          JSON.stringify({
            error: 'User not found',
            code: 'USER_NOT_FOUND',
            message: `No account found for ${email}. Ask them to register at /register first, then try again.`,
          }),
          {
            status: 404,
            headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
          },
        );
      }

      await ensureProfile(
        admin,
        targetUser.id,
        fullName ||
          (targetUser.user_metadata?.full_name as string | undefined) ||
          email.split('@')[0],
      );
    }

    if (targetUser.id === callerId) {
      return new Response(JSON.stringify({ error: 'You cannot add yourself' }), {
        status: 400,
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();

    if (existing) {
      if (existing.is_active) {
        return new Response(
          JSON.stringify({
            error: 'Already a member',
            code: 'ALREADY_MEMBER',
            message: `${identity} is already an active member with role '${existing.role}'.`,
          }),
          {
            status: 409,
            headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
          .eq('id', existing.id);

        if (updateErr) {
          return new Response(JSON.stringify({ error: `Failed to reactivate member: ${updateErr.message}` }), {
            status: 500,
            headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: `${identity} has been re-added to the business as ${role}.`,
            member: {
              user_id: targetUser.id,
              email: targetUser.email,
              phone: targetUser.phone ?? phone ?? null,
              role,
              business_id: businessId,
              reactivated: true,
            },
            // Returned once. There is no email inbox behind a phone account, so
            // this is the only chance the owner gets to pass it on.
            ...(tempPassword
              ? { login: { phone, temporary_password: tempPassword } }
              : {}),
          }),
          { status: 200, headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' } },
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
        headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
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
        message: `${identity} has been added to the business as ${role}.`,
        member: {
          id: inserted?.id,
          user_id: targetUser.id,
          email: targetUser.email,
          phone: targetUser.phone ?? phone ?? null,
          full_name: profile?.full_name ?? null,
          role,
          business_id: businessId,
        },
        // Returned once — see the note on the reactivation branch above.
        ...(tempPassword ? { login: { phone, temporary_password: tempPassword } } : {}),
      }),
      { status: 200, headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('invite-team-member error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
    });
  }
});
