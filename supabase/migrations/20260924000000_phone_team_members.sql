-- ============================================================================
-- 20260924000000_phone_team_members.sql
--
-- Team members can be added by phone number instead of email.
--
-- Two pieces of state are needed:
--
--   1. business_invitations.phone — a shareable invite link restricted to a
--      phone number, mirroring the existing (optional) email restriction. The
--      owner sends the link over WhatsApp/SMS from their own phone; Ledgr pays
--      for nothing and needs no SMS gateway.
--
--   2. phone_accounts — the phone → auth user mapping for accounts provisioned
--      by an owner. Supabase's Admin API has no getUserByEmail/getUserByPhone,
--      only a paginated listUsers scan (see findUserByEmail in the
--      invite-team-member function), so an indexed local map turns "is this
--      number already a member?" into one query instead of up to ten API calls.
--
-- Sign-in itself needs no new state: a phone account's login email is derived
-- from the number (265991234567@phone.ledgr.app) by src/lib/phone.ts and
-- supabase/functions/_shared/phone.ts, so the login screen can call the
-- existing signInWithPassword. Nothing is ever mailed to that address.
-- ============================================================================

-- 1. Phone restriction on shareable invites ──────────────────────────────────
alter table public.business_invitations
  add column if not exists phone text;

comment on column public.business_invitations.phone is
  'Optional E.164 number the invite is restricted to (+265991234567). Mirrors the email column: when set, only the account holding this number may accept. Null means anyone with the link.';

create index if not exists idx_business_invitations_phone
  on public.business_invitations (phone);

-- 2. Phone → auth user map for owner-provisioned accounts ─────────────────────
create table if not exists public.phone_accounts (
  phone        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  business_id  uuid references public.businesses(id) on delete set null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  -- True while the account still carries the owner-generated password, i.e.
  -- until the member changes it. Lets the UI prompt for a change on first
  -- sign-in without storing anything about the password itself.
  temporary_password boolean not null default true
);

comment on table public.phone_accounts is
  'Phone numbers Ledgr provisioned an auth user for, and the user they belong to. Service-role only: RLS is on with no policies, so no client role can read or write it. Keeps "does this number already have an account?" to one indexed lookup instead of scanning auth.admin.listUsers.';

comment on column public.phone_accounts.phone is
  'Normalized E.164, e.g. +265991234567. Produced by normalizePhone() in supabase/functions/_shared/phone.ts.';

alter table public.phone_accounts enable row level security;

-- Deliberately no policies. The service role bypasses RLS; authenticated and
-- anon callers therefore see nothing, which is the point — this table maps
-- phone numbers to accounts and must not be enumerable.
revoke all on public.phone_accounts from public;
revoke all on public.phone_accounts from anon;
revoke all on public.phone_accounts from authenticated;

-- 3. user_profiles.phone already exists (20250101000000_base_schema.sql:477)
--    and is what the team list shows; the invite function fills it in, so no
--    change is needed here.
