-- ============================================================================
-- 20260925000000_phone_accounts_access.sql
--
-- Makes the phone → auth user map reachable by the Edge Functions, and gives
-- user_profiles.phone the index and the data the phone-identity paths rely on.
--
-- Why this is needed
-- ──────────────────
-- 20260924000000 created public.phone_accounts and revoked anon/authenticated,
-- but never granted anything to service_role. Current Supabase projects do NOT
-- auto-expose newly created tables to the Data API roles (the CLI's
-- `auto_expose_new_tables` is unset in supabase/config.toml, and its own comment
-- says the cloud default is now to leave new entities ungranted). On such a
-- project every PostgREST call the Edge Function makes against phone_accounts
-- fails with 42501/42P01.
--
-- invite-team-member treats those failures as a miss and carries on, so the
-- symptom is not an outage — it is the slow path: every phone invite falls back
-- to a paginated auth.admin.listUsers scan capped at 1000 users, and the map
-- never fills. Granting service_role (and only service_role) restores the
-- single indexed lookup the table exists for.
--
-- RLS stays on with no policies, so anon and authenticated still see nothing:
-- the table maps phone numbers to accounts and must not be enumerable.
--
-- The second half covers the fallback that keeps working even when this table
-- cannot be read: user_profiles.phone. invite-team-member writes it for every
-- phone account, accept-invite-link matches phone-restricted links against it,
-- and list-team-members shows it when GoTrue would not store the number on the
-- auth user. It had no index and, for accounts created before that write
-- existed, no data.
-- ============================================================================

-- 1. Service role access to the map ──────────────────────────────────────────
grant usage on schema public to service_role;

grant select, insert, update, delete on public.phone_accounts to service_role;

-- Re-assert the lockdown from 20260924000000 so a later default-privileges
-- change cannot quietly reopen the table to clients.
revoke all on public.phone_accounts from public;
revoke all on public.phone_accounts from anon;
revoke all on public.phone_accounts from authenticated;

alter table public.phone_accounts enable row level security;

-- 2. user_profiles.phone as the durable fallback ─────────────────────────────
create index if not exists idx_user_profiles_phone
  on public.user_profiles (phone)
  where phone is not null and phone <> '';

comment on column public.user_profiles.phone is
  'E.164 mobile number (+265991234567). For a member added by phone number this is their identity: invite-team-member writes it, list-team-members shows it when the number never reached auth.users, and accept-invite-link matches a phone-restricted invitation against it.';

-- Backfill accounts provisioned before invite-team-member wrote the number to
-- the profile. Only fills blanks — never overwrites a number the member set.
update public.user_profiles p
   set phone = pa.phone,
       updated_at = now()
  from public.phone_accounts pa
 where pa.user_id = p.id
   and (p.phone is null or p.phone = '');
