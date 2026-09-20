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
//
//      Only the synthetic email and the password are on the critical path,
//      because they are the only things sign-in needs. The `phone` field is
//      attached afterwards on a best-effort basis, so a project with no SMS
//      provider — or a number GoTrue will not store — cannot fail an invite.
//      Provisioning is also retry-safe: if the login already exists we adopt it,
//      and if it exists but has never signed in we mint a fresh password,
//      because the previous one can never have reached the member.
//   4. Either way we insert/reactivate a business_users row with the role, and
//      guarantee a user_profiles row (the invariant every membership-granting
//      path upholds — see grant_user_business_access, 20260728000003). For a
//      phone account the number goes on that profile too: it is what the team
//      list shows and what accept-invite-link matches a restricted link against.
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
 * auth-js THROWS (rather than returning an error) when handed a malformed id,
 * and a corrupt row in one of our maps must not take the whole invite down —
 * the caller simply moves on to the next lookup.
 */
async function userById(admin: SupabaseClient, userId: string): Promise<User | null> {
  if (!userId) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user ?? null;
  } catch (err) {
    console.warn('could not resolve a mapped user, falling through:', (err as Error).message);
    return null;
  }
}

/**
 * Resolves the account behind a phone number, cheapest source first.
 *
 * Three sources, in order:
 *
 *   1. phone_accounts — the purpose-built map, one indexed query. Can be
 *      unavailable (migration not applied, or not granted to service_role) so
 *      every failure here is a miss, not an error.
 *   2. user_profiles.phone — the number we write for every phone account. This
 *      table always exists and is always readable by the service role, so it is
 *      the fallback that keeps the flow working when (1) cannot be read.
 *   3. The Admin API scan for the deterministic synthetic email. Slow (up to
 *      ten pages) and capped, so it is the last resort — but it also finds
 *      accounts provisioned before either map existed.
 *
 * Read-only; provisioning happens in the caller.
 */
async function findPhoneAccount(
  admin: SupabaseClient,
  phone: string,
  loginEmail: string,
): Promise<User | null> {
  const { data: mapped } = await admin
    .from('phone_accounts')
    .select('user_id')
    .eq('phone', phone)
    .maybeSingle();

  if (mapped?.user_id) {
    const user = await userById(admin, mapped.user_id);
    if (user) return user;
  }

  const { data: profile } = await admin
    .from('user_profiles')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (profile?.id) {
    const user = await userById(admin, profile.id);
    if (user) return user;
  }

  return findUserByEmail(admin, loginEmail);
}

/** GoTrue's answer when the synthetic email is already taken. */
function isDuplicateAccountError(message: string): boolean {
  return /already registered|already exists|user_already_exists/i.test(message);
}

/**
 * GoTrue enforces the project's password policy (Auth → Password requirements)
 * on admin-created users too. generateTempPassword already satisfies the
 * strictest preset, but a longer custom minimum would still reject it — and
 * that must not strand the invite.
 */
function isWeakPasswordError(message: string): boolean {
  return /password should|weak_password|password is known to be weak|weak password/i.test(message);
}

/**
 * Puts the number on the auth user, best effort.
 *
 * Sign-in never reads it (the login is the synthetic email plus a password), so
 * a project with no SMS provider, or a number GoTrue considers invalid, must
 * not fail an invite. Keeping it in sync is still worth one call: the team list
 * and the invite-link restriction both check auth.users.phone first.
 */
async function attachPhone(admin: SupabaseClient, userId: string, phone: string): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    phone,
    phone_confirm: true,
  });
  if (error) {
    console.warn('could not store the number on the auth user (sign-in is unaffected):', error.message);
  }
}

/**
 * Membership-granting paths guarantee a user_profiles row — full_name is NOT
 * NULL and the team list joins this table, so a member without one shows up
 * blank. Mirrors grant_user_business_access (20260728000003) and the invite RPC
 * in 20260815000000.
 *
 * For a phone account the number goes on the profile as well. That is what
 * makes the member identifiable in the team list when GoTrue would not take the
 * phone field, and what accept-invite-link matches a phone-restricted link
 * against.
 */
async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  fullName: string,
  phone?: string | null,
): Promise<void> {
  await admin.from('user_profiles').upsert(
    {
      id: userId,
      full_name: fullName || 'Team member',
      ...(phone ? { phone } : {}),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );

  // ignoreDuplicates means an existing row keeps its values, including an empty
  // phone from before this function wrote it. Fill the number in without ever
  // overwriting one the member set themselves.
  if (phone) {
    await admin
      .from('user_profiles')
      .update({ phone })
      .eq('id', userId)
      .is('phone', null);
  }
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
      /** True only when THIS call created the auth user. */
      let provisionedNow = false;

      if (!targetUser) {
        tempPassword = generateTempPassword();
        const metadata = {
          full_name: fullName || formatPhoneForDisplay(phone),
          phone,
          login_method: 'phone',
          invited_by: callerId,
        };

        // Sign-in needs exactly two things: the synthetic login email and a
        // password. Everything else about the account is decoration, so the
        // create call carries nothing that GoTrue can legitimately refuse for
        // reasons that have nothing to do with this invite — no phone field
        // (rejected when the project has no SMS provider, when the number is
        // already on another account, or when GoTrue dislikes the format). The
        // number is attached afterwards, best effort.
        let created = await admin.auth.admin.createUser({
          email: loginEmail,
          password: tempPassword,
          // The synthetic address is not a real inbox, so there is nothing to
          // confirm — mark it confirmed or the account cannot sign in.
          email_confirm: true,
          user_metadata: metadata,
        });

        // A project can enforce a password policy; retry with a longer one
        // rather than failing an invite over our own generated secret.
        if (created.error && isWeakPasswordError(created.error.message)) {
          console.warn('password policy rejected the temporary password, regenerating:', created.error.message);
          tempPassword = generateTempPassword(20);
          created = await admin.auth.admin.createUser({
            email: loginEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: metadata,
          });
        }

        // The login can already exist without any of our lookups finding it —
        // most often because an earlier attempt created the account and then
        // failed before granting membership. Failing here would leave the
        // number permanently un-invitable: every retry hits the same duplicate.
        if (created.error && isDuplicateAccountError(created.error.message)) {
          console.warn('login already exists, adopting it:', created.error.message);
          targetUser = await findPhoneAccount(admin, phone, loginEmail);
        }

        if (!targetUser) {
          if (created.error || !created.data?.user) {
            console.error('phone account creation failed', created.error);
            return new Response(
              JSON.stringify({
                error: `Could not create the login for ${identity}: ${created.error?.message ?? 'unknown error'}`,
                code: 'ACCOUNT_CREATION_FAILED',
              }),
              {
                status: 502,
                headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
              },
            );
          }

          targetUser = created.data.user;
          provisionedNow = true;

          await attachPhone(admin, targetUser.id, phone);

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
        }
      }

      // A phone account has no inbox, so a password reaches the member only
      // through this response. Hand one over whenever the one already set can
      // never have arrived:
      //   - the owner asked for a reset, or
      //   - the account exists but has never signed in, i.e. an earlier attempt
      //     provisioned it and failed before the password was ever shown.
      // Without this the member is "added" with a password nobody knows.
      if (
        isPhoneLoginEmail(targetUser.email) &&
        !provisionedNow &&
        (wantsPasswordReset || !targetUser.last_sign_in_at)
      ) {
        tempPassword = generateTempPassword();
        let { error: pwErr } = await admin.auth.admin.updateUserById(targetUser.id, {
          password: tempPassword,
        });
        if (pwErr && isWeakPasswordError(pwErr.message)) {
          tempPassword = generateTempPassword(20);
          ({ error: pwErr } = await admin.auth.admin.updateUserById(targetUser.id, {
            password: tempPassword,
          }));
        }
        if (pwErr) {
          return new Response(
            JSON.stringify({
              error: `Failed to reset the password: ${pwErr.message}`,
              code: 'PASSWORD_RESET_FAILED',
            }),
            {
              status: 502,
              headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
            },
          );
        }
        await admin
          .from('phone_accounts')
          .update({ temporary_password: true })
          .eq('user_id', targetUser.id);
      }

      await ensureProfile(admin, targetUser.id, fullName || formatPhoneForDisplay(phone), phone);
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

    /**
     * A phone account's address is synthetic (265991234567@phone.ledgr.app) and
     * means nothing to a reader — and worse, an owner who copies it into an
     * email thread bounces. list-team-members suppresses it for the same reason,
     * so the invite response does too: the number is the identity.
     */
    const publicEmail = isPhoneLoginEmail(targetUser.email) ? null : (targetUser.email ?? null);
    const publicPhone = targetUser.phone || phone || null;

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
        // Already a member — but if this call minted a password it now exists in
        // Auth and this response is the only place it will ever be shown. Swallowing
        // it behind a 409 would leave the member locked out with a password nobody
        // knows, so the credentials go out and the message says nothing changed.
        if (tempPassword) {
          return new Response(
            JSON.stringify({
              success: true,
              code: 'ALREADY_MEMBER',
              message: wantsPasswordReset
                ? `New password for ${identity}. They were already an active member with role '${existing.role}'.`
                : `${identity} is already an active member with role '${existing.role}'. Here are their login details.`,
              member: {
                user_id: targetUser.id,
                email: publicEmail,
                phone: publicPhone,
                role: existing.role,
                business_id: businessId,
                already_member: true,
              },
              login: { phone, temporary_password: tempPassword },
            }),
            {
              status: 200,
              headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
            },
          );
        }

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
              email: publicEmail,
              phone: publicPhone,
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
      // The most common reason this insert fails is a role the database does not
      // know yet — the POS roles arrive with 20260920000000, so an environment
      // behind on migrations rejects 'cashier' at the enum. Say that plainly
      // instead of quoting Postgres at the owner. (The account we just created is
      // not lost: the next attempt finds it by number and, because it has never
      // signed in, hands over a fresh password.)
      const roleUnsupported =
        /invalid input value for enum|enum user_role/i.test(insertErr.message) &&
        insertErr.message.includes(role);

      return new Response(
        JSON.stringify({
          error: roleUnsupported
            ? `This Ledgr database does not support the '${role}' role yet. Pick another role, or ask your administrator to run the pending database migrations.`
            : `Failed to add member: ${insertErr.message}`,
          code: roleUnsupported ? 'ROLE_NOT_SUPPORTED' : 'MEMBERSHIP_INSERT_FAILED',
        }),
        {
          status: roleUnsupported ? 422 : 500,
          headers: { ...corsHeadersForRequest(_req), 'Content-Type': 'application/json' },
        },
      );
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
          email: publicEmail,
          phone: publicPhone,
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
