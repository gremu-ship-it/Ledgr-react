-- ─────────────────────────────────────────────────────────────────────────
-- White-label partner layer — hardening
-- ─────────────────────────────────────────────────────────────────────────
-- Completes the partner tables added in 20260727000002 / 20260727000003:
--   • theming + onboarding copy columns
--   • partner_admins (who may administer a partner)
--   • data-isolation controls (allow_client_visibility, default off)
--   • client-limit enforcement
--   • full RLS: anon may read *branding only* (needed to theme the login
--     page before sign-in), partner admins get read-only access to their
--     clients' businesses, platform admins get everything.

-- ── partners: extra config ──────────────────────────────────────────────
alter table public.partners
  add column if not exists slug text,
  add column if not exists custom_domain text,
  add column if not exists onboarding_title text,
  add column if not exists onboarding_subtitle text,
  add column if not exists support_phone text,
  add column if not exists allow_client_visibility boolean not null default false,
  add column if not exists billing_contact_name text,
  add column if not exists price_per_client numeric(15,2) not null default 0,
  add column if not exists billing_currency text not null default 'MWK';

comment on column public.partners.slug is
  'Subdomain label used for <slug>.ledgr.com resolution (e.g. ''nbs'').';
comment on column public.partners.custom_domain is
  'Fully-qualified vanity domain, e.g. accounting.nbsmw.com.';
comment on column public.partners.allow_client_visibility is
  'When false (default) a partner''s SME clients are fully isolated from each other. When true they may discover other businesses under the same partner.';
comment on column public.partners.onboarding_title is
  'Replaces "Create your Ledgr account" on the partner-branded sign-up page, e.g. "Create your NBS Business Account".';

-- Backfill slug from existing domain / name so old rows keep resolving.
update public.partners
   set slug = lower(regexp_replace(coalesce(split_part(domain, '.', 1), name), '[^a-zA-Z0-9]+', '-', 'g'))
 where slug is null;

create unique index if not exists partners_slug_key on public.partners (slug) where slug is not null;
create unique index if not exists partners_custom_domain_key on public.partners (lower(custom_domain)) where custom_domain is not null;

-- ── partner_admins ──────────────────────────────────────────────────────
create table if not exists public.partner_admins (
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'admin' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (partner_id, user_id)
);
create index if not exists idx_partner_admins_user on public.partner_admins(user_id);

comment on table public.partner_admins is
  'Bank/MFI staff who may administer a partner tenant. Read-only over client data — never granted insert/update/delete on client rows.';

-- ── partner_invoices: real billing shape ────────────────────────────────
alter table public.partner_invoices
  add column if not exists invoice_number text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists due_date date,
  add column if not exists client_count integer not null default 0,
  add column if not exists notes text;

alter table public.partner_invoices
  drop constraint if exists partner_invoices_status_check;
alter table public.partner_invoices
  add constraint partner_invoices_status_check
  check (status in ('draft', 'sent', 'paid', 'overdue', 'void'));

-- ── helper functions ────────────────────────────────────────────────────
create or replace function public.is_partner_admin(uid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.partner_admins pa
     where pa.user_id = uid and pa.partner_id = pid
  ) or public.is_platform_admin(uid);
$$;

create or replace function public.current_partner_ids(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select partner_id from public.partner_admins where user_id = uid;
$$;

-- Partner (if any) that a business belongs to.
create or replace function public.business_partner_id(bid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select partner_id from public.partner_clients where business_id = bid limit 1;
$$;

revoke all on function public.is_partner_admin(uuid, uuid) from public;
revoke all on function public.current_partner_ids(uuid) from public;
revoke all on function public.business_partner_id(uuid) from public;
grant execute on function public.is_partner_admin(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_partner_ids(uuid) to authenticated, service_role;
grant execute on function public.business_partner_id(uuid) to authenticated, service_role;

-- ── client limit enforcement ────────────────────────────────────────────
create or replace function public.enforce_partner_client_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lim int;
  used int;
begin
  select client_limit into lim from public.partners where id = new.partner_id;
  if lim is null then
    return new;
  end if;
  select count(*) into used from public.partner_clients where partner_id = new.partner_id;
  if used >= lim then
    raise exception 'Partner client limit reached (% of %)', used, lim
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_partner_client_limit on public.partner_clients;
create trigger trg_enforce_partner_client_limit
  before insert on public.partner_clients
  for each row execute function public.enforce_partner_client_limit();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.partners             enable row level security;
alter table public.partner_feature_flags enable row level security;
alter table public.partner_clients      enable row level security;
alter table public.partner_admins       enable row level security;
alter table public.partner_invoices     enable row level security;

-- Branding must be resolvable *before* sign-in (login page theming), so the
-- partners row is world-readable. It contains only public brand material —
-- no client data lives here.
drop policy if exists partners_public_read on public.partners;
create policy partners_public_read on public.partners
  for select using (true);

drop policy if exists partners_admin_write on public.partners;
create policy partners_admin_write on public.partners
  for all using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

drop policy if exists partners_partner_admin_update on public.partners;
create policy partners_partner_admin_update on public.partners
  for update using (public.is_partner_admin(auth.uid(), id))
  with check (public.is_partner_admin(auth.uid(), id));

-- Feature flags drive UI gating for signed-out/partner users too.
drop policy if exists partner_feature_flags_read on public.partner_feature_flags;
create policy partner_feature_flags_read on public.partner_feature_flags
  for select using (true);

drop policy if exists partner_feature_flags_write on public.partner_feature_flags;
create policy partner_feature_flags_write on public.partner_feature_flags
  for all using (public.is_partner_admin(auth.uid(), partner_id))
  with check (public.is_partner_admin(auth.uid(), partner_id));

-- partner_clients: partner admins see their roster; a client sees its own
-- link row, and sees sibling clients only when the partner opted in.
drop policy if exists partner_clients_read on public.partner_clients;
create policy partner_clients_read on public.partner_clients
  for select using (
    public.is_partner_admin(auth.uid(), partner_id)
    or exists (
      select 1 from public.business_users bu
       where bu.business_id = partner_clients.business_id
         and bu.user_id = auth.uid()
         and bu.is_active
    )
    or (
      exists (select 1 from public.partners p where p.id = partner_clients.partner_id and p.allow_client_visibility)
      and exists (
        select 1
          from public.partner_clients mine
          join public.business_users bu on bu.business_id = mine.business_id
         where mine.partner_id = partner_clients.partner_id
           and bu.user_id = auth.uid()
           and bu.is_active
      )
    )
  );

drop policy if exists partner_clients_write on public.partner_clients;
create policy partner_clients_write on public.partner_clients
  for all using (public.is_partner_admin(auth.uid(), partner_id))
  with check (public.is_partner_admin(auth.uid(), partner_id));

drop policy if exists partner_admins_read on public.partner_admins;
create policy partner_admins_read on public.partner_admins
  for select using (user_id = auth.uid() or public.is_partner_admin(auth.uid(), partner_id));

drop policy if exists partner_admins_write on public.partner_admins;
create policy partner_admins_write on public.partner_admins
  for all using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- Billing is partner-level: Ledgr invoices the bank. Partner admins read
-- their own invoices; only platform admins can raise/modify them.
drop policy if exists partner_invoices_read on public.partner_invoices;
create policy partner_invoices_read on public.partner_invoices
  for select using (public.is_partner_admin(auth.uid(), partner_id));

drop policy if exists partner_invoices_write on public.partner_invoices;
create policy partner_invoices_write on public.partner_invoices
  for all using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- ── Partner admins: READ-ONLY visibility of their clients' businesses ───
-- Additive SELECT policy (RLS policies OR together). No insert/update/delete
-- policy is added for partner admins anywhere, so the access is view-only.
drop policy if exists businesses_partner_admin_read on public.businesses;
create policy businesses_partner_admin_read on public.businesses
  for select using (
    exists (
      select 1 from public.partner_clients pc
       where pc.business_id = businesses.id
         and public.is_partner_admin(auth.uid(), pc.partner_id)
    )
  );

-- Cross-client discovery for SME clients of the same partner, opt-in only.
drop policy if exists businesses_partner_peer_read on public.businesses;
create policy businesses_partner_peer_read on public.businesses
  for select using (
    exists (
      select 1
        from public.partner_clients pc
        join public.partners p on p.id = pc.partner_id
       where pc.business_id = businesses.id
         and p.allow_client_visibility
         and exists (
           select 1
             from public.partner_clients mine
             join public.business_users bu on bu.business_id = mine.business_id
            where mine.partner_id = pc.partner_id
              and bu.user_id = auth.uid()
              and bu.is_active
         )
    )
  );

-- ── usage stats view (per partner client) ───────────────────────────────
create or replace view public.v_partner_client_usage as
  select
    pc.partner_id,
    b.id                as business_id,
    b.name              as business_name,
    b.plan_tier,
    b.is_active,
    pc.created_at       as onboarded_at,
    (select count(*) from public.journal_entries je where je.business_id = b.id) as journal_entry_count,
    (select count(*) from public.invoices i where i.business_id = b.id)          as invoice_count,
    (select count(*) from public.business_users bu where bu.business_id = b.id and bu.is_active) as user_count,
    (select max(je.created_at) from public.journal_entries je where je.business_id = b.id)       as last_activity_at
  from public.partner_clients pc
  join public.businesses b on b.id = pc.business_id
 where b.deleted_at is null;

comment on view public.v_partner_client_usage is
  'Read-only per-client usage roll-up for the partner admin portal. Underlying tables keep their own RLS, so a partner admin only ever sees their own clients.';

grant select on public.v_partner_client_usage to authenticated;

-- ── default feature flags for new partners ──────────────────────────────
create or replace function public.seed_partner_feature_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.partner_feature_flags (partner_id, feature_key, enabled)
  values
    (new.id, 'ai_advisor', true),
    (new.id, 'payroll', true),
    (new.id, 'inventory', true),
    (new.id, 'multi_currency', true),
    (new.id, 'bank_reconciliation', true)
  on conflict (partner_id, feature_key) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_partner_feature_flags on public.partners;
create trigger trg_seed_partner_feature_flags
  after insert on public.partners
  for each row execute function public.seed_partner_feature_flags();
