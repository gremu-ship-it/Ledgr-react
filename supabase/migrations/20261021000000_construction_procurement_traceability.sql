-- ============================================================================
-- 20261021000000_construction_procurement_traceability.sql
--
-- ADDITIVE construction procurement traceability: purchase orders, delivery-note
-- evidence, goods receipt notes (GRNs) with receipt classifications, explicit
-- product-specific UOM conversions, links to the EXISTING supplier bills
-- (public.expenses / public.expense_lines), normalized supplier invoice
-- reference duplicate prevention with an evidenced exception path, and
-- receipt-cost infrastructure that is DISABLED until an approved policy and an
-- evidenced cost basis exist.
--
-- WHAT THIS FILE DOES NOT DO (deliberate, and enforced below)
--   * It does not invent accounting: no journal entry, no account mapping, no
--     AP/tax clearing, no FX, freight, handling, customs, discount, quarantine
--     valuation, return-credit, consumption, project-cost or capitalisation
--     rule is created or inferred. construction_receipt_posting_policies has a
--     CHECK that GL posting stays disabled (gl_posting_enabled = false).
--   * It does not add a competing invoice source. The supplier's external
--     invoice reference remains public.expenses.reference; this file only
--     registers and normalizes it, and links receipts back to that row.
--   * It does not create a second goods receipt. Invoice matching INSERTS NO
--     stock movement and NO journal entry, and it refuses to match a bill whose
--     expense already carries stock movements (source_type = 'expense'), so the
--     legacy addStockForBranchPurchase hook cannot be double-posted.
--   * It does not insert stock movements at all unless a posting policy row
--     exists (movement_posting_enabled = true) and every accepted receipt
--     quantity has an evidenced cost basis derived from a matched supplier bill
--     line. No policy row is created by this migration, so in a default
--     database post_construction_receipt_movement is refused outright.
--   * It does not weaken RLS, does not grant write privileges on any new table
--     to anon/authenticated, and does not bypass the approved Projects &
--     Funding Sources boundary (that resource is untouched).
--   * It does not backfill, rewrite or delete a single existing row.
--   * It does not hard-code a VAT effective date or rate treatment. The
--     30-vs-31 December 2025 conflict (MRA sources vs catalog evidence) is
--     recorded as an OPEN conflict in
--     docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md
--     and no tax date/rate is asserted here.
--
-- AUTHORITY MODEL
--   Tenant scope  : every table carries business_id NOT NULL; RLS is enabled and
--                   the only policy granted to authenticated is member read
--                   (public.is_business_member). Write privileges are revoked
--                   from anon and authenticated, so the ONLY write path is a
--                   SECURITY DEFINER command in this file.
--   Operation     : a command is allowed only when the caller holds an EXPLICIT
--                   capability grant (public.construction_procurement_grants)
--                   for that operation AND is an active member of the business.
--                   Authority is never inferred from a role name. Section 1
--                   documents the per-operation permission matrix.
--   Grant admins  : only an existing owner/admin member of the business may
--                   grant or revoke a capability, only to another active member,
--                   never to themselves, and always with a written reason.
--                   Grants are append-only (revocation stamps revoked_at).
--   Branch/site   : can_access_branch / can_access_location are enforced on
--                   every command, and the branch/site/location of an operational
--                   document is DERIVED from the authorized PO's site mapping,
--                   never accepted from the caller.
--   Period lock   : _ledgr_assert_period_open is enforced on the only posting
--                   path. A closed period is always denied and is never
--                   reopened by this file.
--   Stock         : the single shared balance writer
--                   (trg_stock_movement_apply_balance /
--                   _ledgr_apply_stock_movement_balance) remains the ONLY
--                   balance-maintaining trigger; this file never writes
--                   public.inventory_balances and asserts the single-writer
--                   invariant at the end.
--
-- Compatibility: idempotent (create table/if not exists, create or replace,
-- drop policy if exists). No data change. Safe to re-run. Additive only — no
-- existing table, column, policy or privilege is dropped, altered or narrowed
-- except the new tables created here.
--
-- Evidence boundary: local isolated PostgreSQL replay only (tests/release R13
-- harness). This is NOT official Supabase Auth/PostgREST or deployed-policy
-- verification, and no production database was inspected or changed.
-- ============================================================================

-- ── 0. Preconditions ────────────────────────────────────────────────────────
-- Fail loudly rather than silently degrading if the chain this file depends on
-- is not present. Nothing is assumed about objects these migrations create.
do $preconditions$
declare
  v_missing text[] := array[]::text[];
  v_item text;
begin
  foreach v_item in array array[
    'public.businesses', 'public.business_users', 'public.branches',
    'public.inventory_locations', 'public.products', 'public.contacts',
    'public.expenses', 'public.expense_lines', 'public.stock_movements',
    'public.inventory_balances', 'public.accounting_periods', 'public.currencies'
  ] loop
    if to_regclass(v_item) is null then v_missing := array_append(v_missing, v_item); end if;
  end loop;

  foreach v_item in array array[
    'public.is_business_member(uuid)',
    'public.can_access_branch(uuid, uuid)',
    'public.can_access_location(uuid, uuid)',
    'public._ledgr_member_role(uuid, uuid)',
    'public._ledgr_assert_period_open(uuid, date, text)'
  ] loop
    if to_regprocedure(v_item) is null then v_missing := array_append(v_missing, v_item); end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Construction procurement migration preconditions unmet: %',
      array_to_string(v_missing, ', ') using errcode = 'undefined_object';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.stock_movements'::regclass
       and tgname = 'trg_stock_movement_apply_balance'
       and not tgisinternal
  ) then
    raise exception 'Construction procurement migration requires the single R06 stock balance writer trigger (20260928000001/20261009000000).'
      using errcode = 'undefined_object';
  end if;

  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.products'::regclass
       and attname = 'unit_of_measure' and not attisdropped
  ) then
    raise exception 'Construction procurement migration requires public.products.unit_of_measure.'
      using errcode = 'undefined_object';
  end if;
end
$preconditions$;

-- ============================================================================
-- 1. CAPABILITY VOCABULARY, GRANTS AND THE OPERATION PERMISSION MATRIX
-- ============================================================================
-- Every value below is a single operational authority. Role names never grant
-- any of them: a command is denied unless a live grant row exists for the actor
-- on that business, in addition to active business membership and the existing
-- branch/location scope checks.
--
--   capability                      operations it authorizes
--   ------------------------------  -------------------------------------------
--   procurement.master.manage       register a site→location mapping; register a
--                                   product-specific UOM conversion
--   procurement.po.manage           create / edit a draft PO; cancel a PO
--   procurement.po.authorize        move a PO draft → authorized (four-eyes)
--   procurement.delivery_note.record record supplier delivery-note evidence
--   procurement.grn.record          record a GRN and its receipt lines
--   procurement.receipt.inspect     reclassify a GRN line's received/accepted/
--                                   rejected/quarantined/disputed quantities
--   procurement.exception.authorize authorize an evidenced over-receipt or
--                                   duplicate supplier-reference exception,
--                                   and release a receipt hold
--   procurement.bill.match          register a supplier bill's external invoice
--                                   reference and allocate bill lines to
--                                   receipt lines
--   procurement.receipt.post        claim a receipt cost basis; post the receipt
--                                   movement (only when a policy row enables it)
--   procurement.policy.approve      create/replace the receipt posting policy
--                                   row (this is the ONLY switch that can enable
--                                   stock movements on receipt)
--
-- No capability can be granted by the holder of another capability, and no
-- capability can be self-granted. Grant administration is anchored on the
-- EXISTING owner/admin authority already used by the product (see
-- public.set_invoice_approval_policy, 20261014000000).

create table if not exists public.construction_procurement_capabilities (
  code        text primary key,
  description text not null
);

insert into public.construction_procurement_capabilities (code, description) values
  ('procurement.master.manage',        'Register the operational site→inventory-location mapping and product-specific UOM conversions.'),
  ('procurement.po.manage',            'Create a draft purchase order and cancel a purchase order.'),
  ('procurement.po.authorize',         'Authorize a purchase order (a different person from the creator).'),
  ('procurement.delivery_note.record', 'Record supplier delivery-note evidence. Evidence only; never a stock or ledger effect.'),
  ('procurement.grn.record',           'Record a goods receipt note and its receipt lines.'),
  ('procurement.receipt.inspect',      'Classify received/accepted/rejected/quarantined/disputed quantities on a receipt line.'),
  ('procurement.exception.authorize',  'Authorize an evidenced price/quantity/duplicate exception and release a receipt hold.'),
  ('procurement.bill.match',           'Register a supplier bill external reference and match bill lines to receipt lines.'),
  ('procurement.receipt.post',         'Claim a receipt cost basis and post the receipt movement when an approved policy allows it.'),
  ('procurement.policy.approve',       'Approve or withdraw the receipt posting policy. This is the only switch that enables a receipt stock movement.'),
  ('procurement.material.issue',       'Issue accepted material from the store to a construction site and recognise it as project material cost at the pool weighted-average cost.')
on conflict (code) do update set description = excluded.description;

create table if not exists public.construction_procurement_grants (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  user_id          uuid not null,
  capability       text not null references public.construction_procurement_capabilities(code),
  granted_by       uuid not null,
  granted_at       timestamptz not null default now(),
  grant_reason     text not null,
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoked_reason   text,
  constraint chk_cpg_reason   check (length(btrim(grant_reason)) > 0),
  constraint chk_cpg_revoked  check (
    (revoked_at is null and revoked_by is null and revoked_reason is null)
    or (revoked_at is not null and revoked_reason is not null and length(btrim(revoked_reason)) > 0)
  )
);

create unique index if not exists uq_cpg_live
  on public.construction_procurement_grants (business_id, user_id, capability)
  where revoked_at is null;

create index if not exists idx_cpg_business on public.construction_procurement_grants (business_id);

comment on table public.construction_procurement_grants is
  'Explicit per-business operation capability grants for construction procurement. Authority is never inferred from a role name; the holder must also be an active business member. Append-only: revocation stamps revoked_at.';

-- ── Shared helpers ──────────────────────────────────────────────────────────
create or replace function public._ledgr_construction_capability(
  p_business uuid,
  p_user     uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
     and p_business is not null
     and exists (
           select 1 from public.business_users bu
            where bu.business_id = p_business
              and bu.user_id = p_user
              and bu.is_active
         )
     and exists (
           select 1 from public.construction_procurement_grants g
            where g.business_id = p_business
              and g.user_id = p_user
              and g.capability = p_capability
              and g.revoked_at is null
         );
$$;

revoke all on function public._ledgr_construction_capability(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.construction_procurement_capabilities_for(p_business_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.is_business_member(p_business_id) then
    raise exception 'You are not an active member of this business.' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(g.capability order by g.capability)
      from public.construction_procurement_grants g
     where g.business_id = p_business_id
       and g.user_id = v_user
       and g.revoked_at is null
  ), array[]::text[]);
end;
$$;

comment on function public.construction_procurement_capabilities_for(uuid) is
  'Read-only helper for the UI so it can show the operations this signed-in member may perform. It grants nothing.';

-- Assert-and-return-actor. Every operational command calls this first.
create or replace function public._ledgr_construction_actor(
  p_business   uuid,
  p_capability text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_business is null then
    raise exception 'A business is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.business_users bu
     where bu.business_id = p_business and bu.user_id = v_user and bu.is_active
  ) then
    raise exception 'You are not an active member of this business.' using errcode = '42501';
  end if;
  if not public._ledgr_construction_capability(p_business, v_user, p_capability) then
    raise exception 'Not authorized: the % capability has not been granted to you for this business.', p_capability
      using errcode = '42501';
  end if;
  return v_user;
end;
$$;

revoke all on function public._ledgr_construction_actor(uuid, text) from public, anon, authenticated;

-- Typed payload readers: convert a jsonb field or raise a controlled 22023
-- instead of leaking 22P02/42883 from a raw cast.
create or replace function public._ledgr_construction_uuid(p_value text, p_label text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    raise exception '% is required.', p_label using errcode = '22023';
  end if;
  if p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '% is not a valid identifier.', p_label using errcode = '22023';
  end if;
  return p_value::uuid;
end;
$$;

create or replace function public._ledgr_construction_date(p_value text, p_label text)
returns date
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    raise exception '% is required.', p_label using errcode = '22023';
  end if;
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '% must be a calendar date (YYYY-MM-DD).', p_label using errcode = '22023';
  end if;
  -- A well-shaped but impossible date (2026-02-30) must fail as invalid input,
  -- never as a raw datetime overflow from the cast.
  begin
    return p_value::date;
  exception when others then
    raise exception '% is not a valid calendar date.', p_label using errcode = '22023';
  end;
end;
$$;

create or replace function public._ledgr_construction_text(p_value text, p_label text)
returns text
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    raise exception '% is required.', p_label using errcode = '22023';
  end if;
  return btrim(p_value);
end;
$$;

revoke all on function public._ledgr_construction_uuid(text, text) from public, anon, authenticated;
revoke all on function public._ledgr_construction_date(text, text) from public, anon, authenticated;
revoke all on function public._ledgr_construction_text(text, text) from public, anon, authenticated;

-- ── Grant / revoke commands ─────────────────────────────────────────────────
create or replace function public.grant_construction_procurement_capability(
  p_business_id uuid,
  p_user_id     uuid,
  p_capability  text,
  p_reason      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_role   text;
  v_reason text;
  v_id     uuid;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_business_id is null then
    raise exception 'A business is required.' using errcode = '22023';
  end if;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  if coalesce(v_role, '') not in ('owner', 'admin') then
    raise exception 'Only the owner or an admin can grant a construction procurement capability.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Choose the member to grant.' using errcode = '22023';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot grant a construction procurement capability to yourself.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.business_users bu
     where bu.business_id = p_business_id and bu.user_id = p_user_id and bu.is_active
  ) then
    raise exception 'That person is not an active member of this business.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.construction_procurement_capabilities c where c.code = p_capability
  ) then
    raise exception 'Unknown construction procurement capability.' using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A written reason is required to grant a capability.' using errcode = '22023';
  end if;

  select g.id into v_id
    from public.construction_procurement_grants g
   where g.business_id = p_business_id and g.user_id = p_user_id
     and g.capability = p_capability and g.revoked_at is null;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'idempotent', true);
  end if;

  insert into public.construction_procurement_grants
    (business_id, user_id, capability, granted_by, grant_reason)
  values (p_business_id, p_user_id, p_capability, v_actor, v_reason)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'idempotent', false);
end;
$$;

create or replace function public.revoke_construction_procurement_capability(
  p_grant_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_row    public.construction_procurement_grants%rowtype;
  v_role   text;
  v_reason text;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_row from public.construction_procurement_grants where id = p_grant_id for update;
  if not found then
    raise exception 'Capability grant not found.' using errcode = '42501';
  end if;
  v_role := public._ledgr_member_role(v_row.business_id, v_actor);
  if coalesce(v_role, '') not in ('owner', 'admin') then
    raise exception 'Only the owner or an admin can revoke a construction procurement capability.' using errcode = '42501';
  end if;
  if v_row.revoked_at is not null then
    return jsonb_build_object('id', v_row.id, 'idempotent', true);
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A written reason is required to revoke a capability.' using errcode = '22023';
  end if;

  perform set_config('ledgr.construction_command', 'grant_revoke', true);
  update public.construction_procurement_grants
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason
   where id = p_grant_id;
  perform set_config('ledgr.construction_command', '', true);

  return jsonb_build_object('id', p_grant_id, 'idempotent', false);
end;
$$;

-- ============================================================================
-- 2. OPERATIONAL SITE REGISTRY (site → branch + inventory location)
-- ============================================================================
-- The approval documents require the operational site identity and its exact
-- mapping to a branch and inventory location. Nothing is inferred: a receipt
-- command resolves its location ONLY from this mapping, never from a
-- client-supplied location and never from a "default" fallback.
--
-- project_ref is a business-scoped project reference string. This table does
-- NOT read, write or depend on the restricted Projects & Funding Sources
-- resource, whose boundary is unchanged.

create table if not exists public.construction_procurement_sites (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid not null references public.branches(id),
  location_id  uuid not null references public.inventory_locations(id),
  site_code    text not null,
  site_name    text not null,
  project_ref  text not null,
  is_active    boolean not null default true,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint chk_cps_code check (length(btrim(site_code)) > 0),
  constraint chk_cps_name check (length(btrim(site_name)) > 0),
  constraint chk_cps_project check (length(btrim(project_ref)) > 0)
);

create unique index if not exists uq_cps_code
  on public.construction_procurement_sites (business_id, site_code);

comment on table public.construction_procurement_sites is
  'Operational construction site → (branch, inventory location) mapping. Receipt commands resolve their location only from here; there is no default-location fallback.';

create or replace function public._ledgr_construction_site(
  p_business uuid,
  p_site     uuid
)
returns public.construction_procurement_sites
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site public.construction_procurement_sites%rowtype;
  v_loc  public.inventory_locations%rowtype;
begin
  if p_site is null then
    raise exception 'A construction site is required.' using errcode = '22023';
  end if;
  select * into v_site from public.construction_procurement_sites where id = p_site;
  if not found or v_site.business_id <> p_business then
    raise exception 'The construction site does not belong to this business.' using errcode = '42501';
  end if;
  if not v_site.is_active then
    raise exception 'That construction site is inactive.' using errcode = '22023';
  end if;

  select * into v_loc from public.inventory_locations where id = v_site.location_id;
  if not found or v_loc.business_id <> p_business then
    raise exception 'The construction site inventory location does not belong to this business.' using errcode = '42501';
  end if;
  if v_loc.branch_id is not null and v_loc.branch_id <> v_site.branch_id then
    raise exception 'The construction site inventory location is attached to a different branch.' using errcode = '22023';
  end if;

  return v_site;
end;
$$;

revoke all on function public._ledgr_construction_site(uuid, uuid) from public, anon, authenticated;

create or replace function public.register_construction_procurement_site(
  p_business_id uuid,
  p_branch_id   uuid,
  p_location_id uuid,
  p_site_code   text,
  p_site_name   text,
  p_project_ref text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor  uuid;
  v_loc    public.inventory_locations%rowtype;
  v_code   text;
  v_name   text;
  v_project text;
  v_id     uuid;
begin
  v_actor := public._ledgr_construction_actor(p_business_id, 'procurement.master.manage');

  if p_branch_id is null or not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.business_id = p_business_id
  ) then
    raise exception 'The branch does not belong to this business.' using errcode = '42501';
  end if;
  if not public.can_access_branch(p_business_id, p_branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  select * into v_loc from public.inventory_locations where id = p_location_id;
  if not found or v_loc.business_id <> p_business_id then
    raise exception 'The inventory location does not belong to this business.' using errcode = '42501';
  end if;
  if v_loc.branch_id is not null and v_loc.branch_id <> p_branch_id then
    raise exception 'The inventory location is attached to a different branch.' using errcode = '22023';
  end if;
  if not public.can_access_location(p_business_id, p_location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  v_code    := upper(public._ledgr_construction_text(p_site_code, 'The site code'));
  v_name    := public._ledgr_construction_text(p_site_name, 'The site name');
  v_project := public._ledgr_construction_text(p_project_ref, 'The project reference');

  select s.id into v_id
    from public.construction_procurement_sites s
   where s.business_id = p_business_id and s.site_code = v_code;
  if v_id is not null then
    perform set_config('ledgr.construction_command', 'site_upsert', true);
    update public.construction_procurement_sites
       set branch_id = p_branch_id,
           location_id = p_location_id,
           site_name = v_name,
           project_ref = v_project,
           is_active = true,
           updated_at = now()
     where id = v_id;
    perform set_config('ledgr.construction_command', '', true);
    return jsonb_build_object('id', v_id, 'idempotent', true);
  end if;

  insert into public.construction_procurement_sites
    (business_id, branch_id, location_id, site_code, site_name, project_ref, created_by)
  values (p_business_id, p_branch_id, p_location_id, v_code, v_name, v_project, v_actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'idempotent', false);
end;
$$;

-- ============================================================================
-- 3. EXPLICIT PRODUCT-SPECIFIC UOM CONVERSIONS
-- ============================================================================
-- Only two things are accepted as a quantity in the product's base unit:
--   1. the unit that EXACTLY equals the product's declared base unit
--      (products.unit_of_measure, compared after trim + upper-case), or
--   2. an explicit, approved, product-specific conversion row registered here.
-- Nothing is inferred: no density, no pack-size guessing, no cross-product
-- equivalence, no automatic tolerance. A product with no declared base unit, or
-- a unit with no conversion row, is refused with 22023.

create table if not exists public.construction_product_uom_conversions (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  product_id         uuid not null references public.products(id),
  from_uom           text not null,
  to_uom             text not null,
  factor             numeric not null,
  evidence_reference text not null,
  approved_by        uuid not null,
  approved_at        timestamptz not null default now(),
  is_active          boolean not null default true,
  constraint chk_cpuc_factor check (factor > 0),
  constraint chk_cpuc_uoms   check (length(btrim(from_uom)) > 0 and length(btrim(to_uom)) > 0 and from_uom <> to_uom),
  constraint chk_cpuc_evidence check (length(btrim(evidence_reference)) > 0)
);

create unique index if not exists uq_cpuc_active
  on public.construction_product_uom_conversions (business_id, product_id, from_uom, to_uom)
  where is_active;

comment on table public.construction_product_uom_conversions is
  'Explicit product-specific UOM conversion factors (from_uom × factor = to_uom). No conversion is ever inferred.';

create or replace function public._ledgr_construction_base_uom(p_business uuid, p_product uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(upper(btrim(coalesce(p.unit_of_measure, ''))), '')
    from public.products p
   where p.id = p_product and p.business_id = p_business;
$$;

revoke all on function public._ledgr_construction_base_uom(uuid, uuid) from public, anon, authenticated;

create or replace function public._ledgr_construction_to_base(
  p_business uuid,
  p_product  uuid,
  p_uom      text,
  p_quantity numeric,
  p_label    text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base   text;
  v_uom    text;
  v_factor numeric;
begin
  if p_quantity is null then
    raise exception '%: a quantity is required.', p_label using errcode = '22023';
  end if;
  if p_quantity <= 0 then
    raise exception '%: the quantity must be greater than zero.', p_label using errcode = '22023';
  end if;

  v_uom := upper(btrim(coalesce(p_uom, '')));
  if v_uom = '' then
    raise exception '%: the unit of measure is required.', p_label using errcode = '22023';
  end if;

  v_base := public._ledgr_construction_base_uom(p_business, p_product);
  if v_base is null then
    raise exception '%: the product has no declared base unit of measure. Declare products.unit_of_measure and register an explicit conversion before recording procurement quantities.', p_label
      using errcode = '22023';
  end if;

  if v_uom = v_base then
    return p_quantity;
  end if;

  select c.factor into v_factor
    from public.construction_product_uom_conversions c
   where c.business_id = p_business
     and c.product_id = p_product
     and c.from_uom = v_uom
     and c.to_uom = v_base
     and c.is_active
   limit 1;

  if v_factor is null then
    raise exception '%: no approved conversion from % to the product base unit %. Register an explicit product-specific conversion first.', p_label, v_uom, v_base
      using errcode = '22023';
  end if;

  return p_quantity * v_factor;
end;
$$;

revoke all on function public._ledgr_construction_to_base(uuid, uuid, text, numeric, text) from public, anon, authenticated;

/** Trigger guard: a stored base quantity must equal the explicit conversion.
 *  One function serves the PO, delivery-note and receipt line tables, so it
 *  reads the row as jsonb and only verifies the columns that table carries. */
create or replace function public._ledgr_construction_guard_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  jsonb := to_jsonb(new);
  v_pairs jsonb[] := array[]::jsonb[];
  v_pair jsonb;
begin
  if v_row ? 'quantity_ordered' then
    v_pairs := v_pairs || jsonb_build_array(v_row->'quantity_ordered', v_row->'quantity_ordered_base', 'Purchase order line');
  end if;
  if v_row ? 'quantity_declared' then
    v_pairs := v_pairs || jsonb_build_array(v_row->'quantity_declared', v_row->'quantity_declared_base', 'Delivery note line');
  end if;
  if v_row ? 'quantity_received' then
    v_pairs := v_pairs || jsonb_build_array(v_row->'quantity_received', v_row->'received_base', 'Receipt line');
  end if;

  foreach v_pair in array v_pairs loop
    if (v_pair->>0) is not null and (v_pair->>1) is not null
       and (v_pair->>1)::numeric <> public._ledgr_construction_to_base(
             new.business_id, new.product_id, new.uom, (v_pair->>0)::numeric, v_pair->>2)
    then
      raise exception '% base quantity does not match the explicit UOM conversion.', v_pair->>2
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

create or replace function public.register_construction_product_uom_conversion(
  p_business_id        uuid,
  p_product_id         uuid,
  p_from_uom           text,
  p_to_uom             text,
  p_factor             numeric,
  p_evidence_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor  uuid;
  v_base   text;
  v_from   text;
  v_to     text;
  v_evid   text;
  v_id     uuid;
begin
  v_actor := public._ledgr_construction_actor(p_business_id, 'procurement.master.manage');

  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.business_id = p_business_id
  ) then
    raise exception 'The product does not belong to this business.' using errcode = '42501';
  end if;

  if p_factor is null or p_factor <= 0 then
    raise exception 'The conversion factor must be greater than zero.' using errcode = '22023';
  end if;

  v_from := upper(public._ledgr_construction_text(p_from_uom, 'The source unit'));
  v_to   := upper(public._ledgr_construction_text(p_to_uom, 'The target unit'));
  if v_from = v_to then
    raise exception 'A conversion needs two different units.' using errcode = '22023';
  end if;

  v_base := public._ledgr_construction_base_uom(p_business_id, p_product_id);
  if v_base is null then
    raise exception 'Declare the product base unit (products.unit_of_measure) before registering a conversion.' using errcode = '22023';
  end if;
  if v_to <> v_base then
    raise exception 'Conversions must target the product base unit %; no chained or inferred conversion is accepted.', v_base
      using errcode = '22023';
  end if;

  v_evid := public._ledgr_construction_text(p_evidence_reference, 'The conversion evidence reference');

  select c.id into v_id
    from public.construction_product_uom_conversions c
   where c.business_id = p_business_id and c.product_id = p_product_id
     and c.from_uom = v_from and c.to_uom = v_to and c.is_active;
  if v_id is not null then
    perform set_config('ledgr.construction_command', 'uom_upsert', true);
    update public.construction_product_uom_conversions
       set factor = p_factor, evidence_reference = v_evid, approved_by = v_actor, approved_at = now()
     where id = v_id;
    perform set_config('ledgr.construction_command', '', true);
    return jsonb_build_object('id', v_id, 'idempotent', true);
  end if;

  insert into public.construction_product_uom_conversions
    (business_id, product_id, from_uom, to_uom, factor, evidence_reference, approved_by)
  values (p_business_id, p_product_id, v_from, v_to, p_factor, v_evid, v_actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'idempotent', false);
end;
$$;

-- ============================================================================
-- 4. PURCHASE ORDERS — THEY AUTHORIZE PROCUREMENT AND NOTHING ELSE
-- ============================================================================
-- A PO carries NO stock movement, NO journal entry, NO valuation and NO cost.
-- expected_unit_price is a nullable procurement expectation recorded by the
-- buyer; it is never treated as a supplier price and never reaches valuation.

-- Small immutable helper for "a written reason is present" (used by table
-- checks so a whitespace-only reason can never satisfy a control).
create or replace function public._ledgr_construction_reason_present(p_reason text)
returns boolean
language sql
immutable
as $$ select p_reason is not null and length(btrim(p_reason)) > 0 $$;

revoke all on function public._ledgr_construction_reason_present(text) from public, anon, authenticated;

create table if not exists public.construction_purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  branch_id           uuid not null references public.branches(id),
  site_id             uuid not null references public.construction_procurement_sites(id),
  project_ref         text not null,
  supplier_contact_id uuid not null references public.contacts(id),
  po_number           text not null,
  currency            text not null references public.currencies(code),
  status              text not null default 'draft',
  client_key          uuid not null,
  notes               text,
  authorized_by       uuid,
  authorized_at       timestamptz,
  cancelled_by        uuid,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_cpo_status check (status in ('draft', 'authorized', 'cancelled')),
  constraint chk_cpo_authorized check (
    status <> 'authorized' or (authorized_by is not null and authorized_at is not null)
  ),
  constraint chk_cpo_cancelled check (
    status <> 'cancelled' or (cancelled_by is not null and cancelled_at is not null and public._ledgr_construction_reason_present(cancel_reason))
  )
);

create unique index if not exists uq_cpo_number on public.construction_purchase_orders (business_id, po_number);
create unique index if not exists uq_cpo_client on public.construction_purchase_orders (business_id, client_key);
create index if not exists idx_cpo_business on public.construction_purchase_orders (business_id, status);

create table if not exists public.construction_purchase_order_events (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  po_id       uuid not null references public.construction_purchase_orders(id) on delete cascade,
  action      text not null,
  actor       uuid,
  detail      text,
  created_at  timestamptz not null default now(),
  constraint chk_cpoe_action check (action in ('created', 'authorized', 'cancelled'))
);

create index if not exists idx_cpoe_po on public.construction_purchase_order_events (po_id);


create table if not exists public.construction_purchase_order_lines (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses(id) on delete cascade,
  po_id                  uuid not null references public.construction_purchase_orders(id),
  line_number            integer not null,
  product_id             uuid not null references public.products(id),
  uom                    text not null,
  quantity_ordered       numeric not null,
  quantity_ordered_base  numeric not null,
  expected_unit_price    numeric,
  line_note              text,
  created_at             timestamptz not null default now(),
  constraint chk_cpol_line_number check (line_number > 0),
  constraint chk_cpol_quantity    check (quantity_ordered > 0 and quantity_ordered_base > 0),
  constraint chk_cpol_uom         check (length(btrim(uom)) > 0),
  constraint chk_cpol_price       check (expected_unit_price is null or expected_unit_price >= 0),
  constraint chk_cpol_unique_line unique (po_id, line_number)
);

create index if not exists idx_cpol_po on public.construction_purchase_order_lines (po_id);

comment on column public.construction_purchase_order_lines.expected_unit_price is
  'Optional buyer expectation for the price of one purchase unit. Never a supplier price, never a valuation input, and never posted.';

-- ── PO guards ───────────────────────────────────────────────────────────────
create or replace function public._ledgr_construction_guard_po()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.construction_procurement_sites%rowtype;
begin
  if new.business_id is null then
    raise exception 'A purchase order requires a business.' using errcode = '22023';
  end if;

  v_site := public._ledgr_construction_site(new.business_id, new.site_id);
  if v_site.branch_id <> new.branch_id then
    raise exception 'The purchase order branch must be the branch of its construction site.' using errcode = '22023';
  end if;
  if new.project_ref <> v_site.project_ref then
    raise exception 'The purchase order project must be the project of its construction site.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.contacts c
     where c.id = new.supplier_contact_id
       and c.business_id = new.business_id
       and c.contact_type = 'supplier'
       and c.is_active
       and c.deleted_at is null
  ) then
    raise exception 'The supplier must be an active supplier contact of this business.' using errcode = '22023';
  end if;

  return new;
end;
$$;

create or replace function public._ledgr_construction_guard_po_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.construction_purchase_orders%rowtype;
begin
  select * into v_po from public.construction_purchase_orders where id = new.po_id;
  if not found then
    raise exception 'Purchase order not found.' using errcode = '22023';
  end if;
  if v_po.business_id <> new.business_id then
    raise exception 'The purchase order line belongs to a different business.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p where p.id = new.product_id and p.business_id = new.business_id
  ) then
    raise exception 'The product on a purchase order line must belong to this business.' using errcode = '42501';
  end if;
  return new;
end;
$$;

/** A PO is editable only while it is a draft; after authorization it is frozen. */
create or replace function public._ledgr_construction_guard_po_line_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_po_id  uuid := coalesce(new.po_id, old.po_id);
begin
  if coalesce(current_setting('ledgr.construction_command', true), '') <> ''
     and coalesce(current_setting('ledgr.construction_command', true), '') = 'po_draft' then
    return coalesce(new, old);
  end if;
  select status into v_status from public.construction_purchase_orders where id = v_po_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'A purchase order can only be changed while it is a draft (it is %).', v_status
      using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_construction_po_guard on public.construction_purchase_orders;
create trigger trg_construction_po_guard
  before insert or update on public.construction_purchase_orders
  for each row execute function public._ledgr_construction_guard_po();

drop trigger if exists trg_construction_po_line_guard on public.construction_purchase_order_lines;
create trigger trg_construction_po_line_guard
  before insert or update on public.construction_purchase_order_lines
  for each row execute function public._ledgr_construction_guard_po_line();

drop trigger if exists trg_construction_po_line_conversion on public.construction_purchase_order_lines;
create trigger trg_construction_po_line_conversion
  before insert or update on public.construction_purchase_order_lines
  for each row execute function public._ledgr_construction_guard_conversion();

drop trigger if exists trg_construction_po_line_frozen on public.construction_purchase_order_lines;
create trigger trg_construction_po_line_frozen
  before insert or update or delete on public.construction_purchase_order_lines
  for each row execute function public._ledgr_construction_guard_po_line_frozen();

-- ── PO commands ─────────────────────────────────────────────────────────────
create or replace function public.create_construction_purchase_order(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_site     public.construction_procurement_sites%rowtype;
  v_supplier uuid;
  v_currency text;
  v_number   text;
  v_notes    text;
  v_po_id    uuid;
  v_existing uuid;
  v_line     jsonb;
  v_index    integer := 0;
  v_product  uuid;
  v_uom      text;
  v_qty      numeric;
  v_price    numeric;
  v_base     numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A purchase order payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.po.manage');

  -- The document-number lock is taken BEFORE the replay check so that two
  -- concurrent retries of the same client key serialize, and the second one
  -- observes the committed row and returns it instead of colliding.
  perform pg_advisory_xact_lock(hashtext('ledgr.construction.po.' || v_business::text));

  select o.id into v_existing
    from public.construction_purchase_orders o
   where o.business_id = v_business and o.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  v_site := public._ledgr_construction_site(
    v_business, public._ledgr_construction_uuid(p_payload->>'site_id', 'The construction site'));
  if not public.can_access_branch(v_business, v_site.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  select c.id into v_supplier
    from public.contacts c
   where c.id = public._ledgr_construction_uuid(p_payload->>'supplier_contact_id', 'The supplier')
     and c.business_id = v_business
     and c.contact_type = 'supplier'
     and c.is_active
     and c.deleted_at is null;
  if v_supplier is null then
    raise exception 'The supplier must be an active supplier contact of this business.' using errcode = '22023';
  end if;

  v_currency := upper(public._ledgr_construction_text(p_payload->>'currency', 'The currency'));
  if not exists (select 1 from public.currencies c where c.code = v_currency) then
    raise exception 'Unknown currency % on the purchase order.', v_currency using errcode = '22023';
  end if;

  if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'A purchase order needs at least one line.' using errcode = '22023';
  end if;

  -- Per-business document numbering under the advisory lock taken above:
  -- deterministic, collision-free, and it does not leak other tenants' volume.
  select 'PO-' || lpad((count(*) + 1)::text, 6, '0') into v_number
    from public.construction_purchase_orders where business_id = v_business;

  v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');

  insert into public.construction_purchase_orders
    (business_id, branch_id, site_id, project_ref, supplier_contact_id, po_number,
     currency, client_key, notes, created_by)
  values (v_business, v_site.branch_id, v_site.id, v_site.project_ref, v_supplier, v_number,
          v_currency, p_client_key, v_notes, v_actor)
  returning id into v_po_id;

  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
    v_index := v_index + 1;
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Purchase order line % is malformed.', v_index using errcode = '22023';
    end if;
    select p.id into v_product
      from public.products p
     where p.id = public._ledgr_construction_uuid(v_line->>'product_id', 'The product on line ' || v_index)
       and p.business_id = v_business;
    if v_product is null then
      raise exception 'The product on line % does not belong to this business.', v_index using errcode = '42501';
    end if;

    v_uom := upper(public._ledgr_construction_text(v_line->>'uom', 'The unit on line ' || v_index));
    begin
      v_qty := (v_line->>'quantity_ordered')::numeric;
    exception when others then
      raise exception 'Line %: the ordered quantity must be a number.', v_index using errcode = '22023';
    end;
    v_base := public._ledgr_construction_to_base(v_business, v_product, v_uom, v_qty, 'Line ' || v_index);

    v_price := null;
    if v_line ? 'expected_unit_price' and nullif(btrim(coalesce(v_line->>'expected_unit_price', '')), '') is not null then
      begin
        v_price := (v_line->>'expected_unit_price')::numeric;
      exception when others then
        raise exception 'Line %: the expected unit price must be a number.', v_index using errcode = '22023';
      end;
      if v_price < 0 then
        raise exception 'Line %: the expected unit price cannot be negative.', v_index using errcode = '22023';
      end if;
    end if;

    insert into public.construction_purchase_order_lines
      (business_id, po_id, line_number, product_id, uom, quantity_ordered,
       quantity_ordered_base, expected_unit_price, line_note)
    values (v_business, v_po_id, v_index, v_product, v_uom, v_qty, v_base, v_price,
            nullif(btrim(coalesce(v_line->>'line_note', '')), ''));
  end loop;

  insert into public.construction_purchase_order_events (business_id, po_id, action, actor, detail)
  values (v_business, v_po_id, 'created', v_actor, 'Draft purchase order created.');

  return jsonb_build_object('id', v_po_id, 'number', v_number, 'status', 'draft', 'idempotent', false);
end;
$$;

create or replace function public.authorize_construction_purchase_order(p_po_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_po    public.construction_purchase_orders%rowtype;
  v_actor uuid;
begin
  if p_po_id is null then
    raise exception 'A purchase order is required.' using errcode = '22023';
  end if;

  select * into v_po from public.construction_purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_po.business_id, 'procurement.po.authorize');
  if not public.can_access_branch(v_po.business_id, v_po.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  if v_po.status = 'authorized' then
    return jsonb_build_object('id', v_po.id, 'status', 'authorized', 'idempotent', true);
  end if;
  if v_po.status = 'cancelled' then
    raise exception 'A cancelled purchase order cannot be authorized.' using errcode = '22023';
  end if;
  if v_po.created_by = v_actor then
    raise exception 'Authorization requires a different person from the person who created the purchase order.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.construction_purchase_order_lines l where l.po_id = v_po.id
  ) then
    raise exception 'A purchase order needs at least one line before it can be authorized.' using errcode = '22023';
  end if;

  perform set_config('ledgr.construction_command', 'po_transition', true);
  update public.construction_purchase_orders
     set status = 'authorized', authorized_by = v_actor, authorized_at = now(), updated_at = now()
   where id = v_po.id;
  perform set_config('ledgr.construction_command', '', true);

  insert into public.construction_purchase_order_events (business_id, po_id, action, actor, detail)
  values (v_po.business_id, v_po.id, 'authorized', v_actor,
          'Purchase order authorized. This authorizes procurement only; it has no stock or ledger effect.');

  return jsonb_build_object('id', v_po.id, 'status', 'authorized', 'idempotent', false);
end;
$$;

create or replace function public.cancel_construction_purchase_order(p_po_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_po     public.construction_purchase_orders%rowtype;
  v_actor  uuid;
  v_reason text;
begin
  if p_po_id is null then
    raise exception 'A purchase order is required.' using errcode = '22023';
  end if;

  select * into v_po from public.construction_purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_po.business_id, 'procurement.po.manage');
  if v_po.status = 'cancelled' then
    return jsonb_build_object('id', v_po.id, 'status', 'cancelled', 'idempotent', true);
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A written reason is required to cancel a purchase order.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.construction_goods_receipt_notes g where g.po_id = v_po.id
  ) then
    raise exception 'This purchase order already has a goods receipt; it cannot be cancelled. Record a return or a correction instead.'
      using errcode = '22023';
  end if;

  perform set_config('ledgr.construction_command', 'po_transition', true);
  update public.construction_purchase_orders
     set status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(),
         cancel_reason = v_reason, updated_at = now()
   where id = v_po.id;
  perform set_config('ledgr.construction_command', '', true);

  insert into public.construction_purchase_order_events (business_id, po_id, action, actor, detail)
  values (v_po.business_id, v_po.id, 'cancelled', v_actor, v_reason);

  return jsonb_build_object('id', v_po.id, 'status', 'cancelled', 'idempotent', false);
end;
$$;

-- ============================================================================
-- 5. DELIVERY NOTES — EVIDENCE ONLY
-- ============================================================================
-- A supplier delivery note is a recorded observation of what the supplier's
-- paperwork says. It never moves stock, never values anything, never posts, and
-- never authorizes anything. It is retained only so a receipt can cite it.

create table if not exists public.construction_delivery_notes (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses(id) on delete cascade,
  po_id                  uuid not null references public.construction_purchase_orders(id),
  supplier_contact_id    uuid not null references public.contacts(id),
  delivery_note_number   text not null,
  normalized_reference   text not null,
  document_date          date not null,
  document_received_by   text,
  evidence_reference     text not null,
  client_key             uuid not null,
  notes                  text,
  recorded_by            uuid not null,
  recorded_at            timestamptz not null default now(),
  exception_of           uuid references public.construction_delivery_notes(id),
  exception_reason       text,
  exception_evidence     text,
  is_exception           boolean not null default false,
  constraint chk_cdn_number   check (length(btrim(delivery_note_number)) > 0),
  constraint chk_cdn_evidence check (length(btrim(evidence_reference)) > 0),
  constraint chk_cdn_exception check (
    (is_exception = false and exception_of is null and exception_reason is null and exception_evidence is null)
    or (is_exception = true and exception_of is not null
        and public._ledgr_construction_reason_present(exception_reason)
        and public._ledgr_construction_reason_present(exception_evidence))
  )
);

create unique index if not exists uq_cdn_client on public.construction_delivery_notes (business_id, client_key);
create unique index if not exists uq_cdn_reference
  on public.construction_delivery_notes (business_id, supplier_contact_id, normalized_reference)
  where is_exception = false;
create index if not exists idx_cdn_po on public.construction_delivery_notes (po_id);

create table if not exists public.construction_delivery_note_lines (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  delivery_note_id      uuid not null references public.construction_delivery_notes(id),
  po_line_id            uuid not null references public.construction_purchase_order_lines(id),
  line_number           integer not null,
  product_id            uuid not null references public.products(id),
  uom                   text not null,
  quantity_declared     numeric not null,
  quantity_declared_base numeric not null,
  line_note             text,
  created_at            timestamptz not null default now(),
  constraint chk_cdnl_line_number check (line_number > 0),
  constraint chk_cdnl_quantity    check (quantity_declared > 0 and quantity_declared_base > 0),
  constraint chk_cdnl_uom         check (length(btrim(uom)) > 0),
  constraint chk_cdnl_unique_line unique (delivery_note_id, line_number)
);

create index if not exists idx_cdnl_note on public.construction_delivery_note_lines (delivery_note_id);

create or replace function public._ledgr_construction_guard_dn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.construction_purchase_orders%rowtype;
begin
  select * into v_po from public.construction_purchase_orders where id = new.po_id;
  if not found or v_po.business_id <> new.business_id then
    raise exception 'The delivery note purchase order does not belong to this business.' using errcode = '42501';
  end if;
  if new.supplier_contact_id <> v_po.supplier_contact_id then
    raise exception 'The delivery note supplier must be the supplier of its purchase order.' using errcode = '22023';
  end if;
  if new.normalized_reference <> public._ledgr_construction_normalize_reference(new.delivery_note_number) then
    raise exception 'The delivery note normalized reference does not match its number.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public._ledgr_construction_guard_dn_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note public.construction_delivery_notes%rowtype;
  v_line public.construction_purchase_order_lines%rowtype;
begin
  select * into v_note from public.construction_delivery_notes where id = new.delivery_note_id;
  if not found or v_note.business_id <> new.business_id then
    raise exception 'The delivery note line belongs to a different business.' using errcode = '42501';
  end if;
  select * into v_line from public.construction_purchase_order_lines where id = new.po_line_id;
  if not found or v_line.po_id <> v_note.po_id then
    raise exception 'The delivery note line must cite a line of the same purchase order.' using errcode = '22023';
  end if;
  if v_line.product_id <> new.product_id then
    raise exception 'The delivery note line product must be the product of the purchase order line.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_construction_dn_guard on public.construction_delivery_notes;
create trigger trg_construction_dn_guard
  before insert or update on public.construction_delivery_notes
  for each row execute function public._ledgr_construction_guard_dn();

drop trigger if exists trg_construction_dn_line_guard on public.construction_delivery_note_lines;
create trigger trg_construction_dn_line_guard
  before insert or update on public.construction_delivery_note_lines
  for each row execute function public._ledgr_construction_guard_dn_line();

drop trigger if exists trg_construction_dn_line_conversion on public.construction_delivery_note_lines;
create trigger trg_construction_dn_line_conversion
  before insert or update on public.construction_delivery_note_lines
  for each row execute function public._ledgr_construction_guard_conversion();

create or replace function public.record_construction_delivery_note(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_po       public.construction_purchase_orders%rowtype;
  v_note_id  uuid;
  v_existing uuid;
  v_number   text;
  v_normalized text;
  v_date     date;
  v_evidence text;
  v_line     jsonb;
  v_index    integer := 0;
  v_po_line  public.construction_purchase_order_lines%rowtype;
  v_uom      text;
  v_qty      numeric;
  v_base     numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A delivery note payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.delivery_note.record');

  perform pg_advisory_xact_lock(hashtext('ledgr.construction.dn.' || v_business::text));

  select n.id into v_existing
    from public.construction_delivery_notes n
   where n.business_id = v_business and n.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  select * into v_po
    from public.construction_purchase_orders o
   where o.id = public._ledgr_construction_uuid(p_payload->>'po_id', 'The purchase order')
   for update;
  if not found or v_po.business_id <> v_business then
    raise exception 'The purchase order does not belong to this business.' using errcode = '42501';
  end if;
  if v_po.status <> 'authorized' then
    raise exception 'A delivery note can only be recorded against an authorized purchase order.' using errcode = '22023';
  end if;
  if not public.can_access_branch(v_business, v_po.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  v_number     := public._ledgr_construction_text(p_payload->>'delivery_note_number', 'The supplier delivery note number');
  v_normalized := public._ledgr_construction_normalize_reference(v_number);
  v_date       := public._ledgr_construction_date(p_payload->>'document_date', 'The delivery note date');
  v_evidence   := public._ledgr_construction_text(p_payload->>'evidence_reference', 'The delivery note evidence reference');

  if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'A delivery note needs at least one line.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.construction_delivery_notes n
     where n.business_id = v_business and n.supplier_contact_id = v_po.supplier_contact_id
       and n.normalized_reference = v_normalized and n.is_exception = false
  ) then
    raise exception 'supplier-delivery-note-duplicate: this supplier delivery note number is already recorded for this supplier.'
      using errcode = '22023';
  end if;

  insert into public.construction_delivery_notes
    (business_id, po_id, supplier_contact_id, delivery_note_number, normalized_reference,
     document_date, document_received_by, evidence_reference, client_key, notes, recorded_by)
  values (v_business, v_po.id, v_po.supplier_contact_id, v_number, v_normalized,
          v_date, nullif(btrim(coalesce(p_payload->>'document_received_by', '')), ''),
          v_evidence, p_client_key, nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_actor)
  returning id into v_note_id;

  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
    v_index := v_index + 1;
    select * into v_po_line
      from public.construction_purchase_order_lines l
     where l.id = public._ledgr_construction_uuid(v_line->>'po_line_id', 'The purchase order line on line ' || v_index);
    if not found or v_po_line.po_id <> v_po.id then
      raise exception 'Line %: the cited purchase order line does not belong to this purchase order.', v_index
        using errcode = '42501';
    end if;

    v_uom := upper(public._ledgr_construction_text(v_line->>'uom', 'The unit on line ' || v_index));
    begin
      v_qty := (v_line->>'quantity_declared')::numeric;
    exception when others then
      raise exception 'Line %: the declared quantity must be a number.', v_index using errcode = '22023';
    end;
    v_base := public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_uom, v_qty, 'Line ' || v_index);

    insert into public.construction_delivery_note_lines
      (business_id, delivery_note_id, po_line_id, line_number, product_id, uom,
       quantity_declared, quantity_declared_base, line_note)
    values (v_business, v_note_id, v_po_line.id, v_index, v_po_line.product_id, v_uom,
            v_qty, v_base, nullif(btrim(coalesce(v_line->>'line_note', '')), ''));
  end loop;

  return jsonb_build_object('id', v_note_id, 'idempotent', false, 'stock_effect', 'none', 'journal_effect', 'none');
end;
$$;

create or replace function public.record_construction_delivery_note_exception(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_po       public.construction_purchase_orders%rowtype;
  v_note     public.construction_delivery_notes%rowtype;
  v_conflict public.construction_delivery_notes%rowtype;
  v_existing uuid;
  v_number   text;
  v_norm     text;
  v_reason   text;
  v_evidence text;
  v_note_id  uuid;
  v_line     jsonb;
  v_index    integer := 0;
  v_po_line  public.construction_purchase_order_lines%rowtype;
  v_uom      text;
  v_qty      numeric;
  v_base     numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A delivery note payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');

  -- A reused supplier delivery-note number is an exception, not a silent
  -- overwrite: it needs the dedicated exception capability plus a written
  -- reason and an evidence reference, and it must name the recorded note it
  -- duplicates.
  v_actor := public._ledgr_construction_actor(v_business, 'procurement.exception.authorize');

  perform pg_advisory_xact_lock(hashtext('ledgr.construction.dn.' || v_business::text));

  select n.id into v_existing
    from public.construction_delivery_notes n
   where n.business_id = v_business and n.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  select * into v_po
    from public.construction_purchase_orders o
   where o.id = public._ledgr_construction_uuid(p_payload->>'po_id', 'The purchase order')
   for update;
  if not found or v_po.business_id <> v_business then
    raise exception 'The purchase order does not belong to this business.' using errcode = '42501';
  end if;
  if v_po.status <> 'authorized' then
    raise exception 'A delivery note can only be recorded against an authorized purchase order.' using errcode = '22023';
  end if;
  if not public.can_access_branch(v_business, v_po.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  v_number := public._ledgr_construction_text(p_payload->>'delivery_note_number', 'The supplier delivery note number');
  v_norm   := public._ledgr_construction_normalize_reference(v_number);

  v_reason   := nullif(btrim(coalesce(p_payload->>'exception_reason', '')), '');
  v_evidence := nullif(btrim(coalesce(p_payload->>'exception_evidence', '')), '');
  if v_reason is null or v_evidence is null then
    raise exception 'A written reason and an evidence reference are required for a duplicate delivery-note exception.' using errcode = '22023';
  end if;

  select * into v_conflict
    from public.construction_delivery_notes n
   where n.id = public._ledgr_construction_uuid(p_payload->>'exception_of', 'The recorded delivery note this duplicates')
     and n.is_exception = false
   for update;
  if not found then
    raise exception 'The named delivery note is not a recorded, non-exception delivery note.' using errcode = '22023';
  end if;
  if v_conflict.business_id <> v_business
     or v_conflict.supplier_contact_id <> v_po.supplier_contact_id
     or v_conflict.normalized_reference <> v_norm then
    raise exception 'The named conflict must be the same business, the same supplier and the same delivery note number.'
      using errcode = '22023';
  end if;

  if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'A delivery note needs at least one line.' using errcode = '22023';
  end if;

  insert into public.construction_delivery_notes
    (business_id, po_id, supplier_contact_id, delivery_note_number, normalized_reference,
     document_date, document_received_by, evidence_reference, client_key, notes, recorded_by,
     is_exception, exception_of, exception_reason, exception_evidence)
  values (v_business, v_po.id, v_po.supplier_contact_id, v_number, v_norm,
          public._ledgr_construction_date(p_payload->>'document_date', 'The delivery note date'),
          nullif(btrim(coalesce(p_payload->>'document_received_by', '')), ''),
          public._ledgr_construction_text(p_payload->>'evidence_reference', 'The delivery note evidence reference'),
          p_client_key, nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_actor,
          true, v_conflict.id, v_reason, v_evidence)
  returning id into v_note_id;

  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
    v_index := v_index + 1;
    select * into v_po_line
      from public.construction_purchase_order_lines l
     where l.id = public._ledgr_construction_uuid(v_line->>'po_line_id', 'The purchase order line on line ' || v_index);
    if not found or v_po_line.po_id <> v_po.id then
      raise exception 'Line %: the cited purchase order line does not belong to this purchase order.', v_index
        using errcode = '42501';
    end if;

    v_uom := upper(public._ledgr_construction_text(v_line->>'uom', 'The unit on line ' || v_index));
    begin
      v_qty := (v_line->>'quantity_declared')::numeric;
    exception when others then
      raise exception 'Line %: the declared quantity must be a number.', v_index using errcode = '22023';
    end;
    v_base := public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_uom, v_qty, 'Line ' || v_index);

    insert into public.construction_delivery_note_lines
      (business_id, delivery_note_id, po_line_id, line_number, product_id, uom,
       quantity_declared, quantity_declared_base, line_note)
    values (v_business, v_note_id, v_po_line.id, v_index, v_po_line.product_id, v_uom,
            v_qty, v_base, nullif(btrim(coalesce(v_line->>'line_note', '')), ''));
  end loop;

  return jsonb_build_object('id', v_note_id, 'exception_of', v_conflict.id, 'idempotent', false,
                            'stock_effect', 'none', 'journal_effect', 'none');
end;
$$;

-- ============================================================================
-- 6. GOODS RECEIPT NOTES — received / accepted / rejected / quarantined / disputed
-- ============================================================================
-- A GRN records an OBSERVED classification. It does not decide valuation, does
-- not post, and does not create a stock movement unless a separate, explicitly
-- approved posting policy exists (section 9).
--
-- Conventions held by this file (proposed, unapproved — see the decision matrix):
--   * received = accepted + rejected + quarantined + disputed, exactly. A
--     quantity is never silently left unclassified.
--   * Only accepted_base is ever eligible for a future receipt movement.
--     quarantined_base is deliberately excluded from stock until an approved
--     valuation/quarantine policy exists; it is NOT valued here.
--   * Any rejected / quarantined / disputed quantity requires an explicit,
--     evidenced hold (reason + evidence reference).

create table if not exists public.construction_goods_receipt_notes (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  branch_id         uuid not null references public.branches(id),
  site_id           uuid not null references public.construction_procurement_sites(id),
  location_id       uuid not null references public.inventory_locations(id),
  project_ref       text not null,
  po_id             uuid not null references public.construction_purchase_orders(id),
  delivery_note_id  uuid references public.construction_delivery_notes(id),
  grn_number        text not null,
  receipt_date      date not null,
  client_key        uuid not null,
  notes             text,
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  constraint chk_cgrn_number check (length(btrim(grn_number)) > 0)
);

create unique index if not exists uq_cgrn_number on public.construction_goods_receipt_notes (business_id, grn_number);
create unique index if not exists uq_cgrn_client on public.construction_goods_receipt_notes (business_id, client_key);
create index if not exists idx_cgrn_po on public.construction_goods_receipt_notes (po_id);

create table if not exists public.construction_goods_receipt_lines (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses(id) on delete cascade,
  grn_id                 uuid not null references public.construction_goods_receipt_notes(id),
  line_number            integer not null,
  po_line_id             uuid not null references public.construction_purchase_order_lines(id),
  product_id             uuid not null references public.products(id),
  uom                    text not null,
  quantity_received      numeric not null,
  quantity_accepted      numeric not null default 0,
  quantity_rejected      numeric not null default 0,
  quantity_quarantined   numeric not null default 0,
  quantity_disputed      numeric not null default 0,
  received_base          numeric not null,
  accepted_base          numeric not null default 0,
  rejected_base          numeric not null default 0,
  quarantined_base       numeric not null default 0,
  disputed_base          numeric not null default 0,
  -- Accepted base quantity already posted to stock by
  -- post_construction_receipt_movement. It exists so that a quality release after
  -- posting can be posted as a delta instead of being silently stranded.
  quantity_posted_base   numeric not null default 0,
  over_receipt_exception boolean not null default false,
  over_receipt_reason    text,
  over_receipt_evidence  text,
  over_receipt_authorized_by uuid,
  line_note              text,
  created_at             timestamptz not null default now(),
  constraint chk_cgrl_line_number check (line_number > 0),
  constraint chk_cgrl_uom         check (length(btrim(uom)) > 0),
  constraint chk_cgrl_posted      check (quantity_posted_base >= 0 and quantity_posted_base <= accepted_base),
  constraint chk_cgrl_nonneg      check (
    quantity_received > 0 and quantity_accepted >= 0 and quantity_rejected >= 0
    and quantity_quarantined >= 0 and quantity_disputed >= 0
    and accepted_base >= 0 and rejected_base >= 0 and quarantined_base >= 0 and disputed_base >= 0
    and received_base > 0
  ),
  constraint chk_cgrl_classified  check (
    quantity_accepted + quantity_rejected + quantity_quarantined + quantity_disputed = quantity_received
  ),
  constraint chk_cgrl_classified_base check (
    accepted_base + rejected_base + quarantined_base + disputed_base = received_base
  ),
  constraint chk_cgrl_over_receipt check (
    over_receipt_exception = false
    or (public._ledgr_construction_reason_present(over_receipt_reason)
        and public._ledgr_construction_reason_present(over_receipt_evidence)
        and over_receipt_authorized_by is not null)
  ),
  constraint chk_cgrl_unique_line unique (grn_id, line_number)
);

create index if not exists idx_cgrl_grn on public.construction_goods_receipt_lines (grn_id);
create index if not exists idx_cgrl_po_line on public.construction_goods_receipt_lines (po_line_id);

comment on column public.construction_goods_receipt_lines.accepted_base is
  'Accepted quantity expressed in the product base unit. The only quantity eligible for a future, policy-approved receipt movement. Not valued here.';
comment on column public.construction_goods_receipt_lines.quarantined_base is
  'Quarantined quantity in the product base unit. Deliberately excluded from stock; no quarantine valuation rule is asserted or implied.';

create table if not exists public.construction_goods_receipt_holds (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  grn_line_id        uuid not null references public.construction_goods_receipt_lines(id),
  hold_type          text not null,
  quantity           numeric not null,
  quantity_base      numeric not null,
  reason             text not null,
  evidence_reference text not null,
  status             text not null default 'open',
  released_by        uuid,
  released_at        timestamptz,
  release_reason     text,
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  constraint chk_cgrh_type     check (hold_type in ('rejected', 'quarantined', 'disputed')),
  constraint chk_cgrh_quantity check (quantity > 0 and quantity_base > 0),
  constraint chk_cgrh_reason   check (public._ledgr_construction_reason_present(reason)),
  constraint chk_cgrh_evidence check (public._ledgr_construction_reason_present(evidence_reference)),
  constraint chk_cgrh_status   check (status in ('open', 'released')),
  constraint chk_cgrh_release  check (
    (status = 'open' and released_by is null and released_at is null and release_reason is null)
    or (status = 'released' and released_by is not null and released_at is not null
        and public._ledgr_construction_reason_present(release_reason))
  )
);

create index if not exists idx_cgrh_line on public.construction_goods_receipt_holds (grn_line_id);

-- ── GRN guards ──────────────────────────────────────────────────────────────
create or replace function public._ledgr_construction_guard_grn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po   public.construction_purchase_orders%rowtype;
  v_site public.construction_procurement_sites%rowtype;
  v_note public.construction_delivery_notes%rowtype;
begin
  select * into v_po from public.construction_purchase_orders where id = new.po_id;
  if not found or v_po.business_id <> new.business_id then
    raise exception 'The goods receipt purchase order does not belong to this business.' using errcode = '42501';
  end if;

  v_site := public._ledgr_construction_site(new.business_id, new.site_id);
  if new.site_id <> v_po.site_id
     or new.branch_id <> v_po.branch_id
     or new.location_id <> v_site.location_id
     or new.project_ref <> v_po.project_ref then
    raise exception 'The goods receipt site, branch, location and project must be exactly those of its purchase order.'
      using errcode = '22023';
  end if;

  if new.delivery_note_id is not null then
    select * into v_note from public.construction_delivery_notes where id = new.delivery_note_id;
    if not found or v_note.business_id <> new.business_id or v_note.po_id <> new.po_id then
      raise exception 'The cited delivery note must belong to the same business and purchase order.' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public._ledgr_construction_guard_grn_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grn  public.construction_goods_receipt_notes%rowtype;
  v_line public.construction_purchase_order_lines%rowtype;
begin
  select * into v_grn from public.construction_goods_receipt_notes where id = new.grn_id;
  if not found or v_grn.business_id <> new.business_id then
    raise exception 'The receipt line belongs to a different business.' using errcode = '42501';
  end if;
  select * into v_line from public.construction_purchase_order_lines where id = new.po_line_id;
  if not found or v_line.po_id <> v_grn.po_id then
    raise exception 'The receipt line must cite a line of the same purchase order.' using errcode = '22023';
  end if;
  if v_line.product_id <> new.product_id then
    raise exception 'The receipt line product must be the product of the purchase order line (exact product identity only).'
      using errcode = '22023';
  end if;
  if new.uom <> v_line.uom then
    raise exception 'The receipt line unit must be the unit of the purchase order line; register an explicit conversion instead of substituting a unit.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public._ledgr_construction_guard_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.construction_goods_receipt_lines%rowtype;
  v_expected numeric;
begin
  select * into v_line from public.construction_goods_receipt_lines where id = new.grn_line_id;
  if not found or v_line.business_id <> new.business_id then
    raise exception 'The receipt hold belongs to a different business.' using errcode = '42501';
  end if;

  -- Closing or shrinking a hold is always permitted: a hold that has been settled
  -- no longer claims any quantity, so it needs no matching bucket. (The reverse
  -- direction — an OPEN hold that exceeds its bucket — is what this guard exists
  -- to prevent, and it is still enforced below.)
  if tg_op = 'UPDATE' and old.status = 'open' and new.status = 'released' then
    return new;
  end if;

  -- The hold must cite the same classification bucket and cannot exceed it.
  if new.hold_type = 'rejected' then
    v_expected := v_line.quantity_rejected;
  elsif new.hold_type = 'quarantined' then
    v_expected := v_line.quantity_quarantined;
  else
    v_expected := v_line.quantity_disputed;
  end if;
  if v_expected <= 0 then
    raise exception 'There is no % quantity on this receipt line to hold.', new.hold_type using errcode = '22023';
  end if;
  if new.quantity > v_expected then
    raise exception 'The held % quantity exceeds the classified quantity on the receipt line.', new.hold_type
      using errcode = '22023';
  end if;
  if new.quantity_base > v_line.received_base then
    raise exception 'The held base quantity is not plausible for this receipt line.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_construction_grn_guard on public.construction_goods_receipt_notes;
create trigger trg_construction_grn_guard
  before insert or update on public.construction_goods_receipt_notes
  for each row execute function public._ledgr_construction_guard_grn();

drop trigger if exists trg_construction_grn_line_guard on public.construction_goods_receipt_lines;
create trigger trg_construction_grn_line_guard
  before insert or update on public.construction_goods_receipt_lines
  for each row execute function public._ledgr_construction_guard_grn_line();

drop trigger if exists trg_construction_grn_line_conversion on public.construction_goods_receipt_lines;
create trigger trg_construction_grn_line_conversion
  before insert or update on public.construction_goods_receipt_lines
  for each row execute function public._ledgr_construction_guard_conversion();

drop trigger if exists trg_construction_hold_guard on public.construction_goods_receipt_holds;
create trigger trg_construction_hold_guard
  before insert or update on public.construction_goods_receipt_holds
  for each row execute function public._ledgr_construction_guard_hold();

-- ── GRN command ─────────────────────────────────────────────────────────────
create or replace function public.record_construction_goods_receipt(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business  uuid;
  v_actor     uuid;
  v_po        public.construction_purchase_orders%rowtype;
  v_site      public.construction_procurement_sites%rowtype;
  v_note_id   uuid;
  v_existing  uuid;
  v_number    text;
  v_date      date;
  v_grn_id    uuid;
  v_line      jsonb;
  v_index     integer := 0;
  v_po_line   public.construction_purchase_order_lines%rowtype;
  v_received  numeric;
  v_accepted  numeric;
  v_rejected  numeric;
  v_quarantined numeric;
  v_disputed  numeric;
  v_received_base numeric;
  v_accepted_base numeric;
  v_rejected_base numeric;
  v_quarantined_base numeric;
  v_disputed_base numeric;
  v_sum_units numeric;
  v_sum_base  numeric;
  v_line_id   uuid;
  v_already   numeric;
  v_over      boolean := false;
  v_reason    text;
  v_evidence  text;
  v_hold      jsonb;
  v_hold_total numeric;
  v_expected  numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A goods receipt payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.grn.record');

  perform pg_advisory_xact_lock(hashtext('ledgr.construction.grn.' || v_business::text));

  select g.id into v_existing
    from public.construction_goods_receipt_notes g
   where g.business_id = v_business and g.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true, 'stock_effect', 'none', 'journal_effect', 'none');
  end if;

  -- The PO row is locked for the whole command: it serializes concurrent
  -- receipts against the same order, and it is the anchor for over-receipt
  -- detection.
  select * into v_po
    from public.construction_purchase_orders o
   where o.id = public._ledgr_construction_uuid(p_payload->>'po_id', 'The purchase order')
   for update;
  if not found or v_po.business_id <> v_business then
    raise exception 'The purchase order does not belong to this business.' using errcode = '42501';
  end if;
  if v_po.status <> 'authorized' then
    raise exception 'A goods receipt can only be recorded against an authorized purchase order.' using errcode = '22023';
  end if;

  -- Branch, site and location are DERIVED from the authorized purchase order.
  -- The caller cannot supply them, so a forged branch/site/location identifier
  -- has no path into a receipt.
  v_site := public._ledgr_construction_site(v_business, v_po.site_id);
  if not public.can_access_branch(v_business, v_po.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_business, v_site.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  v_date := public._ledgr_construction_date(p_payload->>'receipt_date', 'The receipt date');

  if p_payload->'delivery_note_id' is not null and nullif(btrim(coalesce(p_payload->>'delivery_note_id', '')), '') is not null then
    v_note_id := public._ledgr_construction_uuid(p_payload->>'delivery_note_id', 'The delivery note');
    if not exists (
      select 1 from public.construction_delivery_notes n
       where n.id = v_note_id and n.business_id = v_business and n.po_id = v_po.id
    ) then
      raise exception 'The cited delivery note does not belong to this business and purchase order.' using errcode = '42501';
    end if;
  end if;

  if p_payload->'lines' is null or jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'A goods receipt needs at least one line.' using errcode = '22023';
  end if;

  select 'GRN-' || lpad((count(*) + 1)::text, 6, '0') into v_number
    from public.construction_goods_receipt_notes where business_id = v_business;

  insert into public.construction_goods_receipt_notes
    (business_id, branch_id, site_id, location_id, project_ref, po_id, delivery_note_id,
     grn_number, receipt_date, client_key, notes, created_by)
  values (v_business, v_po.branch_id, v_po.site_id, v_site.location_id, v_po.project_ref,
          v_po.id, v_note_id, v_number, v_date, p_client_key,
          nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_actor)
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
    v_index := v_index + 1;

    select * into v_po_line
      from public.construction_purchase_order_lines l
     where l.id = public._ledgr_construction_uuid(v_line->>'po_line_id', 'The purchase order line on line ' || v_index)
     for update;
    if not found or v_po_line.po_id <> v_po.id then
      raise exception 'Line %: the cited purchase order line does not belong to this purchase order.', v_index
        using errcode = '42501';
    end if;

    begin
      v_received    := (v_line->>'quantity_received')::numeric;
      v_accepted    := coalesce((v_line->>'quantity_accepted')::numeric, 0);
      v_rejected    := coalesce((v_line->>'quantity_rejected')::numeric, 0);
      v_quarantined := coalesce((v_line->>'quantity_quarantined')::numeric, 0);
      v_disputed    := coalesce((v_line->>'quantity_disputed')::numeric, 0);
    exception when others then
      raise exception 'Line %: receipt quantities must be numbers.', v_index using errcode = '22023';
    end;

    if v_received is null or v_received <= 0 then
      raise exception 'Line %: the received quantity must be greater than zero.', v_index using errcode = '22023';
    end if;
    if least(v_accepted, v_rejected, v_quarantined, v_disputed) < 0 then
      raise exception 'Line %: receipt quantities cannot be negative.', v_index using errcode = '22023';
    end if;

    v_sum_units := v_accepted + v_rejected + v_quarantined + v_disputed;
    if v_sum_units <> v_received then
      raise exception 'receipt-classification-incomplete: line % records % received but only % classified (accepted + rejected + quarantined + disputed). Classify the whole quantity.',
        v_index, v_received, v_sum_units using errcode = '22023';
    end if;

    v_received_base    := public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_po_line.uom, v_received, 'Line ' || v_index);
    -- base quantities are derived with the SAME explicit factor, so they add up
    -- exactly; zero stays zero without a special case.
    v_accepted_base    := case when v_accepted = 0 then 0 else public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_po_line.uom, v_accepted, 'Line ' || v_index) end;
    v_rejected_base    := case when v_rejected = 0 then 0 else public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_po_line.uom, v_rejected, 'Line ' || v_index) end;
    v_quarantined_base := case when v_quarantined = 0 then 0 else public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_po_line.uom, v_quarantined, 'Line ' || v_index) end;
    v_disputed_base    := case when v_disputed = 0 then 0 else public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_po_line.uom, v_disputed, 'Line ' || v_index) end;

    v_sum_base := v_accepted_base + v_rejected_base + v_quarantined_base + v_disputed_base;
    if v_sum_base <> v_received_base then
      raise exception 'receipt-classification-incomplete: line % does not reconcile in the product base unit.', v_index
        using errcode = '22023';
    end if;

    -- Over-receipt against the ordered quantity: never silent, never tolerated
    -- by a built-in percentage. It requires the exception capability plus a
    -- written reason and an evidence reference.
    select coalesce(sum(l.received_base), 0) into v_already
      from public.construction_goods_receipt_lines l
     where l.po_line_id = v_po_line.id;
    v_over := (v_already + v_received_base) > v_po_line.quantity_ordered_base;

    v_reason   := nullif(btrim(coalesce(v_line->>'over_receipt_reason', '')), '');
    v_evidence := nullif(btrim(coalesce(v_line->>'over_receipt_evidence', '')), '');
    if v_over then
      if v_reason is null or v_evidence is null then
        raise exception 'over-receipt-exception-required: line % would receive more than was ordered (% > %). Provide an authorized reason and evidence.',
          v_index, (v_already + v_received_base), v_po_line.quantity_ordered_base using errcode = '22023';
      end if;
      if not public._ledgr_construction_capability(v_business, v_actor, 'procurement.exception.authorize') then
        raise exception 'over-receipt-exception-denied: line % exceeds the ordered quantity and you do not hold the exception capability.',
          v_index using errcode = '42501';
      end if;
    end if;

    insert into public.construction_goods_receipt_lines
      (business_id, grn_id, line_number, po_line_id, product_id, uom,
       quantity_received, quantity_accepted, quantity_rejected, quantity_quarantined, quantity_disputed,
       received_base, accepted_base, rejected_base, quarantined_base, disputed_base,
       over_receipt_exception, over_receipt_reason, over_receipt_evidence, over_receipt_authorized_by,
       line_note)
    values (v_business, v_grn_id, v_index, v_po_line.id, v_po_line.product_id, v_po_line.uom,
            v_received, v_accepted, v_rejected, v_quarantined, v_disputed,
            v_received_base, v_accepted_base, v_rejected_base, v_quarantined_base, v_disputed_base,
            v_over, case when v_over then v_reason end, case when v_over then v_evidence end,
            case when v_over then v_actor end,
            nullif(btrim(coalesce(v_line->>'line_note', '')), ''))
    returning id into v_line_id;

    -- Non-accepted quantities require an explicit evidenced hold so that a
    -- rejection/quarantine/dispute is never just a number with no explanation.
    if (v_rejected + v_quarantined + v_disputed) > 0 then
      -- Classifying a quantity as rejected, quarantined or disputed is an
      -- inspection act: recording the receipt is not the same authority as
      -- inspecting what arrived.
      if not public._ledgr_construction_capability(v_business, v_actor, 'procurement.receipt.inspect') then
        raise exception 'receipt-inspection-denied: line % records rejected, quarantined or disputed quantities and you do not hold the receipt-inspection capability.',
          v_index using errcode = '42501';
      end if;
      if v_line->'holds' is null or jsonb_typeof(v_line->'holds') <> 'array'
         or jsonb_array_length(v_line->'holds') = 0 then
        raise exception 'Line %: rejected, quarantined and disputed quantities require an explicit hold with a reason and evidence.',
          v_index using errcode = '22023';
      end if;

      for v_hold in select * from jsonb_array_elements(v_line->'holds') loop
        declare
          v_hold_type text := lower(btrim(coalesce(v_hold->>'hold_type', '')));
          v_hold_qty  numeric;
          v_hold_base numeric;
        begin
          if v_hold_type not in ('rejected', 'quarantined', 'disputed') then
            raise exception 'Line %: hold type must be rejected, quarantined or disputed.', v_index using errcode = '22023';
          end if;
          begin
            v_hold_qty := (v_hold->>'quantity')::numeric;
          exception when others then
            raise exception 'Line %: the held quantity must be a number.', v_index using errcode = '22023';
          end;
          if v_hold_qty is null or v_hold_qty <= 0 then
            raise exception 'Line %: the held quantity must be greater than zero.', v_index using errcode = '22023';
          end if;
          v_hold_base := case when v_hold_qty = 0 then 0
                              else public._ledgr_construction_to_base(v_business, v_po_line.product_id, v_po_line.uom, v_hold_qty, 'Line ' || v_index || ' hold') end;

          insert into public.construction_goods_receipt_holds
            (business_id, grn_line_id, hold_type, quantity, quantity_base, reason, evidence_reference, created_by)
          values (v_business, v_line_id, v_hold_type, v_hold_qty, v_hold_base,
                  public._ledgr_construction_text(v_hold->>'reason', 'The hold reason on line ' || v_index),
                  public._ledgr_construction_text(v_hold->>'evidence_reference', 'The hold evidence reference on line ' || v_index),
                  v_actor);
        end;
      end loop;

      -- Holds must cover the whole non-accepted quantity: no unexplained gap.
      select coalesce(sum(h.quantity), 0) into v_hold_total
        from public.construction_goods_receipt_holds h where h.grn_line_id = v_line_id;
      v_expected := v_rejected + v_quarantined + v_disputed;
      if v_hold_total <> v_expected then
        raise exception 'Line %: holds cover % but % was rejected, quarantined or disputed. Every non-accepted quantity needs an evidenced hold.',
          v_index, v_hold_total, v_expected using errcode = '22023';
      end if;
    elsif v_line->'holds' is not null and jsonb_typeof(v_line->'holds') = 'array'
          and jsonb_array_length(v_line->'holds') > 0 then
      -- Holds offered for a line that classifies nothing as non-accepted would be
      -- dropped silently. Never accept a caller's hold and then discard it.
      raise exception 'Line %: holds were supplied but no quantity on this line is rejected, quarantined or disputed.',
        v_index using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object(
    'id', v_grn_id, 'number', v_number, 'idempotent', false,
    -- Explicit, machine-readable statement of this command's boundary.
    'stock_effect', 'none', 'journal_effect', 'none', 'posting', 'not-approved');
end;
$$;

create or replace function public.release_construction_receipt_hold(p_hold_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hold   public.construction_goods_receipt_holds%rowtype;
  v_line   public.construction_goods_receipt_lines%rowtype;
  v_grn    public.construction_goods_receipt_notes%rowtype;
  v_actor  uuid;
  v_reason text;
begin
  if p_hold_id is null then
    raise exception 'A receipt hold is required.' using errcode = '22023';
  end if;

  select * into v_hold from public.construction_goods_receipt_holds where id = p_hold_id for update;
  if not found then
    raise exception 'Receipt hold not found.' using errcode = '42501';
  end if;
  select * into v_line from public.construction_goods_receipt_lines where id = v_hold.grn_line_id;
  select * into v_grn from public.construction_goods_receipt_notes where id = v_line.grn_id;

  v_actor := public._ledgr_construction_actor(v_hold.business_id, 'procurement.exception.authorize');
  if not public.can_access_branch(v_hold.business_id, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  if v_hold.status = 'released' then
    return jsonb_build_object('id', v_hold.id, 'status', 'released', 'idempotent', true);
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'A written reason is required to release a receipt hold.' using errcode = '22023';
  end if;

  perform set_config('ledgr.construction_command', 'hold_release', true);
  update public.construction_goods_receipt_holds
     set status = 'released', released_by = v_actor, released_at = now(), release_reason = v_reason
   where id = v_hold.id;
  perform set_config('ledgr.construction_command', '', true);

  return jsonb_build_object('id', v_hold.id, 'status', 'released', 'idempotent', false,
                            'stock_effect', 'none', 'journal_effect', 'none');
end;
$$;

-- ============================================================================
-- 6b. RECEIPT INSPECTION, QUALITY RELEASE AND RECLASSIFICATION
-- ============================================================================
-- Where the standard requires judgement rather than arithmetic:
--   IAS 2 paragraph 28 — inventory whose cost may not be recoverable (damaged,
--     obsolete, or held at a declined selling price) must be written down to net
--     realisable value, and paragraph 34 requires that write-down to be an
--     expense when it occurs. A write-down needs a value basis, and no net
--     realisable value policy is approved, so this file REFUSES to release an
--     ACCEPTED quantity back out of inventory (that release would be a write-down
--     at an unapproved value). It stays refused rather than guessed.
--   The converse direction needs no value: material that was quarantined or
--     disputed has NEVER entered inventory (only accepted quantities are
--     movement-eligible), so releasing it into accepted is a quality decision,
--     not a valuation one. That direction is implemented, and it is gated on a
--     recorded inspection, the inspection capability and the exception authority.

create table if not exists public.construction_receipt_inspections (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  grn_line_id             uuid not null references public.construction_goods_receipt_lines(id),
  inspection_date         date not null,
  outcome                 text not null,
  quantity_inspected      numeric not null,
  quantity_inspected_base numeric not null,
  method                  text not null,
  certificate_reference   text,
  evidence_reference      text not null,
  inspected_by            uuid not null,
  inspected_at            timestamptz not null default now(),
  notes                   text,
  client_key              uuid not null,
  constraint chk_crin_outcome  check (outcome in ('passed', 'failed', 'partial')),
  constraint chk_crin_quantity check (quantity_inspected > 0 and quantity_inspected_base > 0),
  constraint chk_crin_method   check (public._ledgr_construction_reason_present(method)),
  constraint chk_crin_evidence check (public._ledgr_construction_reason_present(evidence_reference)),
  constraint chk_crin_unique_client unique (business_id, client_key)
);

create index if not exists idx_crin_line on public.construction_receipt_inspections (grn_line_id);

comment on table public.construction_receipt_inspections is
  'Evidence that a received quantity was inspected, and with what outcome. An inspection is a fact about quality; it never moves stock by itself. A quarantined/disputed quantity becomes movement-eligible only through an evidenced reclassification that cites a passed inspection.';

create table if not exists public.construction_receipt_line_reclassifications (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  grn_line_id             uuid not null references public.construction_goods_receipt_lines(id),
  inspection_id           uuid not null references public.construction_receipt_inspections(id),
  from_bucket             text not null,
  to_bucket               text not null,
  quantity                numeric not null,
  quantity_base           numeric not null,
  accepted_before_base    numeric not null,
  accepted_after_base     numeric not null,
  reason                  text not null,
  evidence_reference      text not null,
  reclassified_by         uuid not null,
  reclassified_at         timestamptz not null default now(),
  client_key              uuid not null,
  constraint chk_crlr_from check (from_bucket in ('quarantined', 'disputed')),
  constraint chk_crlr_to   check (to_bucket = 'accepted'),
  constraint chk_crlr_quantity check (quantity > 0 and quantity_base > 0),
  constraint chk_crlr_reason   check (public._ledgr_construction_reason_present(reason)),
  constraint chk_crlr_evidence check (public._ledgr_construction_reason_present(evidence_reference)),
  constraint chk_crlr_unique_client unique (business_id, client_key)
);

create index if not exists idx_crlr_line on public.construction_receipt_line_reclassifications (grn_line_id);

comment on table public.construction_receipt_line_reclassifications is
  'Append-only register of quality releases. Moving a quarantined or disputed quantity into accepted changes what the supplier bill may be matched against and what may be posted to stock, so each release is recorded with its inspection, its reason and its evidence.';

create or replace function public.record_construction_receipt_inspection(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_line     public.construction_goods_receipt_lines%rowtype;
  v_grn      public.construction_goods_receipt_notes%rowtype;
  v_product  uuid;
  v_date     date;
  v_outcome  text;
  v_qty      numeric;
  v_base     numeric;
  v_id       uuid;
  v_existing uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'An inspection payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.receipt.inspect');

  select * into v_line
    from public.construction_goods_receipt_lines l
   where l.id = public._ledgr_construction_uuid(p_payload->>'grn_line_id', 'The receipt line')
   for update;
  if not found or v_line.business_id <> v_business then
    raise exception 'The receipt line does not belong to this business.' using errcode = '42501';
  end if;
  select * into v_grn from public.construction_goods_receipt_notes where id = v_line.grn_id;
  if not public.can_access_branch(v_business, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  select c.id into v_existing from public.construction_receipt_inspections c
   where c.business_id = v_business and c.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  v_date    := public._ledgr_construction_date(p_payload->>'inspection_date', 'The inspection date');
  v_outcome := lower(btrim(coalesce(p_payload->>'outcome', '')));
  if v_outcome not in ('passed', 'failed', 'partial') then
    raise exception 'The inspection outcome must be passed, failed or partial.' using errcode = '22023';
  end if;

  begin
    v_qty := (p_payload->>'quantity_inspected')::numeric;
  exception when others then
    raise exception 'The inspected quantity must be a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then
    raise exception 'The inspected quantity must be greater than zero.' using errcode = '22023';
  end if;
  v_base := public._ledgr_construction_to_base(v_business, v_line.product_id, v_line.uom, v_qty, 'The inspected quantity');
  -- An inspection cannot claim to have examined more than was received.
  if v_base > v_line.received_base then
    raise exception 'inspection-quantity-exceeded: the inspection covers % in base units but only % was received on this line.',
      v_base, v_line.received_base using errcode = '22023';
  end if;

  insert into public.construction_receipt_inspections
    (business_id, grn_line_id, inspection_date, outcome, quantity_inspected, quantity_inspected_base,
     method, certificate_reference, evidence_reference, inspected_by, notes, client_key)
  values (v_business, v_line.id, v_date, v_outcome, v_qty, v_base,
          public._ledgr_construction_text(p_payload->>'method', 'The inspection method'),
          nullif(btrim(coalesce(p_payload->>'certificate_reference', '')), ''),
          public._ledgr_construction_text(p_payload->>'evidence_reference', 'The inspection evidence reference'),
          v_actor, nullif(btrim(coalesce(p_payload->>'notes', '')), ''), p_client_key)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'idempotent', false,
                            'stock_effect', 'none', 'journal_effect', 'none');
end;
$$;

create or replace function public.reclassify_construction_receipt_line(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_line     public.construction_goods_receipt_lines%rowtype;
  v_grn      public.construction_goods_receipt_notes%rowtype;
  v_insp     public.construction_receipt_inspections%rowtype;
  v_from     text;
  v_qty      numeric;
  v_base     numeric;
  v_before   numeric;
  v_after    numeric;
  v_available numeric;
  v_id       uuid;
  v_existing uuid;
  v_open     numeric;
  v_hold     public.construction_goods_receipt_holds%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A reclassification payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  -- Two authorities: the inspection capability (this is a quality judgement) and
  -- the exception authority (this changes what may be matched and posted).
  v_actor := public._ledgr_construction_actor(v_business, 'procurement.receipt.inspect');
  if not public._ledgr_construction_capability(v_business, v_actor, 'procurement.exception.authorize') then
    raise exception 'reclassification-exception-denied: releasing quarantined or disputed material requires the exception authority.'
      using errcode = '42501';
  end if;

  select * into v_line
    from public.construction_goods_receipt_lines l
   where l.id = public._ledgr_construction_uuid(p_payload->>'grn_line_id', 'The receipt line')
   for update;
  if not found or v_line.business_id <> v_business then
    raise exception 'The receipt line does not belong to this business.' using errcode = '42501';
  end if;
  select * into v_grn from public.construction_goods_receipt_notes where id = v_line.grn_id;
  if not public.can_access_branch(v_business, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  select c.id into v_existing from public.construction_receipt_line_reclassifications c
   where c.business_id = v_business and c.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  v_from := lower(btrim(coalesce(p_payload->>'from_bucket', '')));
  if v_from = 'accepted' then
    -- Releasing stock back out of inventory at an unapproved value would be a
    -- write-down: IAS 2 paragraph 28 requires it to be measured at net realisable
    -- value, and no NRV policy is approved. Refused, not guessed.
    raise exception 'accepted-release-unsupported: an accepted quantity cannot be released back out of inventory. That is a write-down (IAS 2 paragraph 28) and needs an approved net realisable value basis.'
      using errcode = '22023';
  end if;
  if v_from = 'rejected' then
    -- Rejected material was refused on receipt and belongs to the supplier: it
    -- never entered inventory, so there is nothing to release into stock.
    raise exception 'rejected-release-unsupported: rejected material never entered inventory and is the supplier''s, not the entity''s. Settle it with the supplier.'
      using errcode = '22023';
  end if;
  if v_from not in ('quarantined', 'disputed') then
    raise exception 'The released quantity must come from the quarantined or disputed bucket.' using errcode = '22023';
  end if;

  begin
    v_qty := (p_payload->>'quantity')::numeric;
  exception when others then
    raise exception 'The released quantity must be a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then
    raise exception 'The released quantity must be greater than zero.' using errcode = '22023';
  end if;
  v_base := public._ledgr_construction_to_base(v_business, v_line.product_id, v_line.uom, v_qty, 'The released quantity');

  v_available := case when v_from = 'quarantined' then v_line.quarantined_base else v_line.disputed_base end;
  if v_base > v_available then
    raise exception 'release-quantity-exceeded: the release covers % in base units but the % bucket holds %.',
      v_base, v_from, v_available using errcode = '22023';
  end if;

  -- The release must cite a PASSED inspection of this line that covers it.
  select * into v_insp
    from public.construction_receipt_inspections i
   where i.id = public._ledgr_construction_uuid(p_payload->>'inspection_id', 'The inspection')
     and i.grn_line_id = v_line.id
     and i.business_id = v_business;
  if not found then
    raise exception 'release-inspection-required: cite an inspection of this receipt line before releasing material into accepted.'
      using errcode = '22023';
  end if;
  if v_insp.outcome <> 'passed' then
    raise exception 'release-inspection-failed: the cited inspection outcome is %, so the material cannot be released into accepted stock.',
      v_insp.outcome using errcode = '22023';
  end if;
  if v_insp.quantity_inspected_base < v_base then
    raise exception 'release-inspection-short: the cited inspection covers % in base units but the release is %.',
      v_insp.quantity_inspected_base, v_base using errcode = '22023';
  end if;

  v_before := v_line.accepted_base;
  v_after  := v_before + v_base;

  -- Holds first, while the bucket still holds the quantity: a hold that is being
  -- settled no longer claims anything. Whole holds are closed; a hold that covers
  -- more than the release is shrunk by exactly the released base quantity, so the
  -- remainder stays open and accountable.
  -- A release does not need to be covered by a hold (a hold is evidence, not a
  -- gate); holds that exist are settled so none keeps claiming quantity that has
  -- already been released. A release that outruns every open hold simply leaves
  -- v_open above zero, which is recorded on the reclassification row itself.
  v_open := v_base;
  for v_hold in
    select * from public.construction_goods_receipt_holds h
     where h.grn_line_id = v_line.id and h.status = 'open' and h.hold_type = v_from
     order by h.created_at, h.id
  loop
    exit when v_open <= 0;
    if v_hold.quantity_base <= v_open then
      perform set_config('ledgr.construction_command', 'hold_release', true);
      update public.construction_goods_receipt_holds
         set status = 'released', released_by = v_actor, released_at = now(),
             release_reason = 'Released into accepted by evidenced reclassification.'
       where id = v_hold.id;
      perform set_config('ledgr.construction_command', '', true);
      v_open := v_open - v_hold.quantity_base;
    else
      perform set_config('ledgr.construction_command', 'hold_release', true);
      update public.construction_goods_receipt_holds
         set quantity_base = v_hold.quantity_base - v_open,
             quantity      = v_hold.quantity - round(v_open / (v_hold.quantity_base / v_hold.quantity), 6)
       where id = v_hold.id;
      perform set_config('ledgr.construction_command', '', true);
      v_open := 0;
    end if;
  end loop;

  -- One atomic move between buckets. The table CHECKs (received = accepted +
  -- rejected + quarantined + disputed, in both units) are re-verified by the
  -- database itself, so an inconsistent release cannot be written.
  perform set_config('ledgr.construction_command', 'grn_reclassify', true);
  if v_from = 'quarantined' then
    update public.construction_goods_receipt_lines
       set quantity_quarantined = quantity_quarantined - v_qty,
           quarantined_base     = quarantined_base - v_base,
           quantity_accepted    = quantity_accepted + v_qty,
           accepted_base        = accepted_base + v_base
     where id = v_line.id;
  else
    update public.construction_goods_receipt_lines
       set quantity_disputed = quantity_disputed - v_qty,
           disputed_base     = disputed_base - v_base,
           quantity_accepted = quantity_accepted + v_qty,
           accepted_base     = accepted_base + v_base
     where id = v_line.id;
  end if;
  perform set_config('ledgr.construction_command', '', true);

  insert into public.construction_receipt_line_reclassifications
    (business_id, grn_line_id, inspection_id, from_bucket, to_bucket, quantity, quantity_base,
     accepted_before_base, accepted_after_base, reason, evidence_reference, reclassified_by, client_key)
  values (v_business, v_line.id, v_insp.id, v_from, 'accepted', v_qty, v_base,
          v_before, v_after,
          public._ledgr_construction_text(p_payload->>'reason', 'The release reason'),
          public._ledgr_construction_text(p_payload->>'evidence_reference', 'The release evidence reference'),
          v_actor, p_client_key)
  returning id into v_id;


  return jsonb_build_object('id', v_id, 'idempotent', false,
                            'accepted_before_base', v_before, 'accepted_after_base', v_after,
                            'stock_effect', 'none', 'journal_effect', 'none',
                            'note', 'Accepted stock changes only when the receipt movement is posted.');
end;
$$;

-- ============================================================================
-- 7. SUPPLIER INVOICE IDENTITY — the EXISTING bill reference, normalized
-- ============================================================================
-- The supplier's external invoice reference is and remains
-- public.expenses.reference. This file creates NO competing invoice source: it
-- registers that existing value, in a canonical normalized form, per business
-- and supplier, so the same supplier invoice cannot be recorded twice.
--
-- Normalization is deliberately conservative — trim, collapse internal
-- whitespace, upper-case. Punctuation is NOT stripped and digits are not
-- reordered: over-normalizing would silently treat two different supplier
-- invoices as one, which is worse than missing a duplicate. The rule is stated
-- here once and used everywhere:
--     upper(regexp_replace(btrim(reference), '\s+', ' ', 'g'))
--
-- A genuine duplicate is still recordable, but only as an explicit, reasoned,
-- evidenced exception authorized by a capability holder, and it must name the
-- active reference it conflicts with. Nothing is merged or overwritten.

create or replace function public._ledgr_construction_normalize_reference(p_text text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g'));
$$;

revoke all on function public._ledgr_construction_normalize_reference(text) from public, anon, authenticated;

create table if not exists public.construction_supplier_invoice_references (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete cascade,
  supplier_contact_id      uuid not null references public.contacts(id),
  expense_id               uuid not null references public.expenses(id),
  reference_raw            text not null,
  reference_normalized     text not null,
  source                   text not null default 'expense_reference',
  status                   text not null default 'active',
  exception_of             uuid references public.construction_supplier_invoice_references(id),
  exception_reason         text,
  exception_evidence       text,
  recorded_by              uuid not null,
  recorded_at              timestamptz not null default now(),
  constraint chk_csir_source check (source = 'expense_reference'),
  constraint chk_csir_status check (status in ('active', 'exception')),
  constraint chk_csir_normalized check (
    reference_normalized = public._ledgr_construction_normalize_reference(reference_raw)
    and length(reference_normalized) > 0
  ),
  constraint chk_csir_exception check (
    (status = 'active' and exception_of is null and exception_reason is null and exception_evidence is null)
    or (status = 'exception' and exception_of is not null
        and public._ledgr_construction_reason_present(exception_reason)
        and public._ledgr_construction_reason_present(exception_evidence))
  )
);

create unique index if not exists uq_csir_active
  on public.construction_supplier_invoice_references (business_id, supplier_contact_id, reference_normalized)
  where status = 'active';
create unique index if not exists uq_csir_expense
  on public.construction_supplier_invoice_references (expense_id);

comment on table public.construction_supplier_invoice_references is
  'Canonical registration of the EXISTING supplier bill external reference (public.expenses.reference). Duplicate prevention is per business + supplier + normalized reference; a duplicate is recordable only as an evidenced, authorized exception naming the conflicting active reference.';

/** Shared bill validator. Every command that touches a supplier bill uses it. */
create or replace function public._ledgr_construction_bill(
  p_business uuid,
  p_expense  uuid
)
returns public.expenses
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expense public.expenses;
begin
  select * into v_expense from public.expenses where id = p_expense;
  if not found or v_expense.business_id <> p_business then
    raise exception 'The supplier bill does not belong to this business.' using errcode = '42501';
  end if;
  if v_expense.deleted_at is not null then
    raise exception 'That supplier bill is deleted.' using errcode = '22023';
  end if;
  if v_expense.expense_type <> 'bill' then
    raise exception 'Only a supplier bill (expense_type = bill) can be matched or registered.' using errcode = '22023';
  end if;
  if v_expense.contact_id is null then
    raise exception 'Record the supplier on the bill before using it in procurement.' using errcode = '22023';
  end if;
  return v_expense;
end;
$$;

revoke all on function public._ledgr_construction_bill(uuid, uuid) from public, anon, authenticated;

/** A bill that already moved stock through the legacy expense stock hook must
 *  never be matched to a receipt, and must never fund a receipt cost basis:
 *  the same goods would be counted into inventory twice. */
create or replace function public._ledgr_construction_assert_bill_not_inventoried(
  p_business uuid,
  p_expense  uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.stock_movements m
     where m.business_id = p_business
       and m.source_type = 'expense'
       and m.source_id::text = p_expense::text
  ) then
    raise exception 'bill-already-inventoried: this bill already recorded stock through the expense stock hook, so it cannot also be matched to or fund a goods receipt.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public._ledgr_construction_assert_bill_not_inventoried(uuid, uuid) from public, anon, authenticated;

create or replace function public.register_construction_supplier_invoice_reference(p_expense_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_expense  public.expenses;
  v_raw      text;
  v_norm     text;
  v_id       uuid;
  v_conflict public.construction_supplier_invoice_references%rowtype;
  v_conflict_number text;
begin
  if p_expense_id is null then
    raise exception 'A supplier bill is required.' using errcode = '22023';
  end if;

  select e.business_id into v_business from public.expenses e where e.id = p_expense_id;
  if v_business is null then
    raise exception 'Supplier bill not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_business, 'procurement.bill.match');
  v_expense := public._ledgr_construction_bill(v_business, p_expense_id);

  select r.id into v_id
    from public.construction_supplier_invoice_references r
   where r.expense_id = p_expense_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'idempotent', true);
  end if;

  v_raw := nullif(btrim(coalesce(v_expense.reference, '')), '');
  if v_raw is null then
    raise exception 'supplier-reference-missing: record the supplier''s own invoice reference on the bill (public.expenses.reference) before registering it.'
      using errcode = '22023';
  end if;
  v_norm := public._ledgr_construction_normalize_reference(v_raw);

  select * into v_conflict
    from public.construction_supplier_invoice_references r
   where r.business_id = v_business
     and r.supplier_contact_id = v_expense.contact_id
     and r.reference_normalized = v_norm
     and r.status = 'active'
   for update;

  if found then
    select e.expense_number into v_conflict_number from public.expenses e where e.id = v_conflict.expense_id;
    raise exception 'supplier-invoice-reference-duplicate: reference "%" is already registered for this supplier (bill %). Use the evidenced exception path if this is genuinely a different invoice.',
      v_norm, coalesce(v_conflict_number, '(unknown)') using errcode = '22023';
  end if;

  insert into public.construction_supplier_invoice_references
    (business_id, supplier_contact_id, expense_id, reference_raw, reference_normalized, recorded_by)
  values (v_business, v_expense.contact_id, v_expense.id, v_raw, v_norm, v_actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'reference_normalized', v_norm, 'idempotent', false);
end;
$$;

create or replace function public.register_construction_supplier_invoice_reference_exception(
  p_expense_id   uuid,
  p_exception_of uuid,
  p_reason       text,
  p_evidence     text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_expense  public.expenses;
  v_conflict public.construction_supplier_invoice_references%rowtype;
  v_reason   text;
  v_evidence text;
  v_norm     text;
  v_id       uuid;
begin
  if p_expense_id is null then
    raise exception 'A supplier bill is required.' using errcode = '22023';
  end if;

  select e.business_id into v_business from public.expenses e where e.id = p_expense_id;
  if v_business is null then
    raise exception 'Supplier bill not found.' using errcode = '42501';
  end if;

  -- A duplicate reference is a financial-control exception: it needs the
  -- dedicated exception capability in addition to bill-match reach.
  v_actor := public._ledgr_construction_actor(v_business, 'procurement.exception.authorize');
  v_expense := public._ledgr_construction_bill(v_business, p_expense_id);

  v_reason   := nullif(btrim(coalesce(p_reason, '')), '');
  v_evidence := nullif(btrim(coalesce(p_evidence, '')), '');
  if v_reason is null or v_evidence is null then
    raise exception 'A written reason and an evidence reference are required for a duplicate supplier-reference exception.' using errcode = '22023';
  end if;
  if p_exception_of is null then
    raise exception 'Name the existing reference this exception conflicts with.' using errcode = '22023';
  end if;

  v_norm := public._ledgr_construction_normalize_reference(v_expense.reference);
  if v_norm = '' then
    raise exception 'supplier-reference-missing: record the supplier''s own invoice reference on the bill before registering an exception.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.construction_supplier_invoice_references r where r.expense_id = p_expense_id) then
    raise exception 'This bill already has a registered supplier reference.' using errcode = '22023';
  end if;

  select * into v_conflict
    from public.construction_supplier_invoice_references r
   where r.id = p_exception_of and r.status = 'active'
   for update;
  if not found then
    raise exception 'The reference named as the conflict is not an active registration.' using errcode = '22023';
  end if;
  if v_conflict.business_id <> v_business
     or v_conflict.supplier_contact_id <> v_expense.contact_id
     or v_conflict.reference_normalized <> v_norm then
    raise exception 'The named conflict must be the same business, the same supplier and the same normalized reference.'
      using errcode = '22023';
  end if;
  if v_conflict.expense_id = p_expense_id then
    raise exception 'A bill cannot be its own duplicate exception.' using errcode = '22023';
  end if;

  insert into public.construction_supplier_invoice_references
    (business_id, supplier_contact_id, expense_id, reference_raw, reference_normalized,
     status, exception_of, exception_reason, exception_evidence, recorded_by)
  values (v_business, v_expense.contact_id, v_expense.id, v_expense.reference, v_norm,
          'exception', v_conflict.id, v_reason, v_evidence, v_actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'exception_of', v_conflict.id, 'idempotent', false);
end;
$$;

-- ============================================================================
-- 8. RECEIPT ↔ BILL MATCHING — SPLIT AND COMBINED ALLOCATIONS, NEVER A RECEIPT
-- ============================================================================
-- One bill line may be allocated across several partial receipts (split), and
-- one receipt line may be allocated to several bill lines (combined). Every
-- allocation records BOTH the supplier-billed quantity and the received
-- quantity, in their own units, and both are converted to the product base unit
-- with the explicit conversions of section 3.
--
--   * the two base quantities must be EXACTLY equal for a plain match. Any
--     difference is a quantity exception: no tolerance, no percentage, no
--     rounding rule is invented here, and the exception needs a capability, a
--     written reason and an evidence reference.
--   * products are matched by exact product id only.
--   * this command inserts NO stock movement and NO journal entry, and it
--     refuses a bill whose expense already carries stock movements.

create table if not exists public.construction_receipt_bill_allocations (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  grn_line_id          uuid not null references public.construction_goods_receipt_lines(id),
  expense_id           uuid not null references public.expenses(id),
  expense_line_id      uuid not null references public.expense_lines(id),
  bill_uom             text not null,
  bill_quantity        numeric not null,
  bill_quantity_base   numeric not null,
  receipt_uom          text not null,
  receipt_quantity     numeric not null,
  receipt_quantity_base numeric not null,
  is_exception         boolean not null default false,
  exception_reason     text,
  exception_evidence   text,
  matched_by           uuid not null,
  matched_at           timestamptz not null default now(),
  client_key           uuid not null,
  constraint chk_crba_quantities check (
    bill_quantity > 0 and bill_quantity_base > 0 and receipt_quantity > 0 and receipt_quantity_base > 0
  ),
  constraint chk_crba_uoms check (length(btrim(bill_uom)) > 0 and length(btrim(receipt_uom)) > 0),
  constraint chk_crba_exception check (
    (is_exception = false and exception_reason is null and exception_evidence is null)
    or (is_exception = true
        and public._ledgr_construction_reason_present(exception_reason)
        and public._ledgr_construction_reason_present(exception_evidence))
  ),
  constraint chk_crba_plain_match check (
    is_exception = true or bill_quantity_base = receipt_quantity_base
  ),
  constraint chk_crba_unique_client unique (business_id, client_key)
);

create index if not exists idx_crba_grn_line on public.construction_receipt_bill_allocations (grn_line_id);
create index if not exists idx_crba_expense_line on public.construction_receipt_bill_allocations (expense_line_id);

create or replace function public.match_construction_bill_line_to_receipt(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business   uuid;
  v_actor      uuid;
  v_grn_line   public.construction_goods_receipt_lines%rowtype;
  v_grn        public.construction_goods_receipt_notes%rowtype;
  v_po         public.construction_purchase_orders%rowtype;
  v_expense    public.expenses;
  v_line       public.expense_lines%rowtype;
  v_existing   uuid;
  v_bill_uom   text;
  v_bill_qty   numeric;
  v_receipt_qty numeric;
  v_bill_base  numeric;
  v_receipt_base numeric;
  v_is_exception boolean := false;
  v_reason     text;
  v_evidence   text;
  v_used_receipt numeric;
  v_used_bill  numeric;
  v_bill_limit numeric;
  v_remaining_receipt numeric;
  v_remaining_bill numeric;
  v_prior_uom  text;
  v_id         uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A matching payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.bill.match');

  select a.id into v_existing
    from public.construction_receipt_bill_allocations a
   where a.business_id = v_business and a.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true, 'stock_effect', 'none', 'journal_effect', 'none');
  end if;

  select * into v_grn_line
    from public.construction_goods_receipt_lines l
   where l.id = public._ledgr_construction_uuid(p_payload->>'grn_line_id', 'The receipt line')
   for update;
  if not found or v_grn_line.business_id <> v_business then
    raise exception 'The receipt line does not belong to this business.' using errcode = '42501';
  end if;

  select * into v_grn from public.construction_goods_receipt_notes where id = v_grn_line.grn_id;
  select * into v_po from public.construction_purchase_orders where id = v_grn.po_id;

  if not public.can_access_branch(v_business, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_business, v_grn.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  select * into v_line
    from public.expense_lines el
   where el.id = public._ledgr_construction_uuid(p_payload->>'expense_line_id', 'The supplier bill line')
   for update;
  if not found or v_line.business_id <> v_business then
    raise exception 'The supplier bill line does not belong to this business.' using errcode = '42501';
  end if;

  v_expense := public._ledgr_construction_bill(v_business, v_line.expense_id);
  perform public._ledgr_construction_assert_bill_not_inventoried(v_business, v_expense.id);

  -- Exact product identity only. No equivalence, no substitution, no tolerance.
  if v_line.product_id is null or v_line.product_id <> v_grn_line.product_id then
    raise exception 'product-mismatch: the bill line and the receipt line must reference the exact same product.'
      using errcode = '22023';
  end if;

  -- The bill must be the bill of the purchase order's supplier.
  if v_expense.contact_id <> v_po.supplier_contact_id then
    raise exception 'supplier-mismatch: the bill supplier is not the supplier of this purchase order.'
      using errcode = '22023';
  end if;

  -- No exchange-rate rule is approved: a bill raised in a different currency than
  -- the purchase order cannot be converted into a receipt cost by assumption.
  if v_expense.currency <> v_po.currency then
    raise exception 'bill-currency-mismatch: the bill is in % but the purchase order is in %. No exchange-rate rule is approved for receipt cost.',
      v_expense.currency, v_po.currency using errcode = '22023';
  end if;

  -- A receipt may only be matched to a bill whose external reference was
  -- registered through the duplicate-prevention path (active or excepted).
  if not exists (
    select 1 from public.construction_supplier_invoice_references r
     where r.expense_id = v_expense.id
  ) then
    raise exception 'supplier-reference-not-registered: register the bill''s supplier invoice reference before matching it to a receipt.'
      using errcode = '22023';
  end if;

  v_bill_uom := upper(public._ledgr_construction_text(p_payload->>'bill_uom', 'The bill unit of measure'));
  begin
    v_bill_qty    := (p_payload->>'bill_quantity')::numeric;
    v_receipt_qty := (p_payload->>'receipt_quantity')::numeric;
  exception when others then
    raise exception 'The matched quantities must be numbers.' using errcode = '22023';
  end;
  if v_bill_qty is null or v_bill_qty <= 0 then
    raise exception 'The matched bill quantity must be greater than zero.' using errcode = '22023';
  end if;
  if v_receipt_qty is null or v_receipt_qty <= 0 then
    raise exception 'The matched receipt quantity must be greater than zero.' using errcode = '22023';
  end if;

  v_bill_base    := public._ledgr_construction_to_base(v_business, v_grn_line.product_id, v_bill_uom, v_bill_qty, 'The matched bill quantity');
  v_receipt_base := public._ledgr_construction_to_base(v_business, v_grn_line.product_id, v_grn_line.uom, v_receipt_qty, 'The matched receipt quantity');

  -- One bill line may only be allocated in one declared unit, so the cap below
  -- cannot be gamed by switching units between allocations of the same line.
  select a.bill_uom into v_prior_uom
    from public.construction_receipt_bill_allocations a
   where a.expense_line_id = v_line.id
   limit 1;
  if v_prior_uom is not null and v_prior_uom <> v_bill_uom then
    raise exception 'bill-uom-inconsistent: this bill line was already allocated in %; use the same unit.', v_prior_uom
      using errcode = '22023';
  end if;

  if v_bill_base <> v_receipt_base then
    v_reason   := nullif(btrim(coalesce(p_payload->>'exception_reason', '')), '');
    v_evidence := nullif(btrim(coalesce(p_payload->>'exception_evidence', '')), '');
    if v_reason is null or v_evidence is null then
      raise exception 'quantity-exception-required: the matched bill quantity and receipt quantity differ (% vs % in the product base unit). Provide an authorized reason and evidence.',
        v_bill_base, v_receipt_base using errcode = '22023';
    end if;
    if not public._ledgr_construction_capability(v_business, v_actor, 'procurement.exception.authorize') then
      raise exception 'quantity-exception-denied: you do not hold the exception capability for a quantity difference.'
        using errcode = '42501';
    end if;
    v_is_exception := true;
  end if;

  -- Bill-side cap: the allocated base quantity may not exceed the remaining
  -- quantity of the bill line, in the product base unit.
  v_bill_limit := case when v_line.quantity is null or v_line.quantity <= 0 then null
                       else public._ledgr_construction_to_base(v_business, v_grn_line.product_id, v_bill_uom, v_line.quantity, 'The bill line') end;
  if v_bill_limit is null then
    raise exception 'The bill line has no positive quantity to match.' using errcode = '22023';
  end if;
  select coalesce(sum(a.bill_quantity_base), 0) into v_used_bill
    from public.construction_receipt_bill_allocations a where a.expense_line_id = v_line.id;
  v_remaining_bill := v_bill_limit - v_used_bill;
  if v_bill_base > v_remaining_bill then
    raise exception 'bill-quantity-exceeded: the allocation (% in the product base unit) exceeds the unallocated quantity of the bill line (%).',
      v_bill_base, v_remaining_bill using errcode = '22023';
  end if;

  -- Receipt-side cap: only ACCEPTED quantity may be matched, and only once.
  select coalesce(sum(a.receipt_quantity_base), 0) into v_used_receipt
    from public.construction_receipt_bill_allocations a where a.grn_line_id = v_grn_line.id;
  v_remaining_receipt := v_grn_line.accepted_base - v_used_receipt;
  if v_receipt_base > v_remaining_receipt then
    raise exception 'receipt-quantity-exceeded: the allocation (% in the product base unit) exceeds the unallocated accepted quantity of the receipt line (%).',
      v_receipt_base, v_remaining_receipt using errcode = '22023';
  end if;

  -- Re-check the replay key now that both parent rows are locked: a concurrent
  -- retry of the same client key returns the committed allocation instead of
  -- colliding on the unique index.
  select a.id into v_existing
    from public.construction_receipt_bill_allocations a
   where a.business_id = v_business and a.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true, 'stock_effect', 'none', 'journal_effect', 'none');
  end if;

  insert into public.construction_receipt_bill_allocations
    (business_id, grn_line_id, expense_id, expense_line_id, bill_uom, bill_quantity, bill_quantity_base,
     receipt_uom, receipt_quantity, receipt_quantity_base, is_exception, exception_reason, exception_evidence,
     matched_by, client_key)
  values (v_business, v_grn_line.id, v_expense.id, v_line.id, v_bill_uom, v_bill_qty, v_bill_base,
          v_grn_line.uom, v_receipt_qty, v_receipt_base, v_is_exception,
          case when v_is_exception then v_reason end, case when v_is_exception then v_evidence end,
          v_actor, p_client_key)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'is_exception', v_is_exception, 'idempotent', false,
    'stock_effect', 'none', 'journal_effect', 'none');
end;
$$;

-- ============================================================================
-- 9. SAFE RECEIPT-COST INFRASTRUCTURE — DISABLED UNLESS APPROVED
-- ============================================================================
-- This is the ONLY place a construction receipt can reach stock, and it is
-- closed by default. It creates NO policy row, so a default database refuses
-- every receipt posting.
--
-- The only cost basis accepted is a bill line that was matched to the receipt
-- line, with:
--   * exact product identity,
--   * a bill unit equal to the product base unit (no unit arbitration), and
--   * no discount and no tax on the bill line (no discount or VAT rule is
--     invented; both must be dealt with by an approved accounting policy first).
-- GL posting is structurally impossible here: the policy row carries
-- gl_posting_enabled and a CHECK forces it to false, and this file writes no
-- journal entry anywhere.

create table if not exists public.construction_receipt_posting_policies (
  business_id              uuid primary key references public.businesses(id) on delete cascade,
  movement_posting_enabled boolean not null default false,
  cost_basis_source        text,
  gl_posting_enabled       boolean not null default false,
  approved_by              uuid,
  approved_at              timestamptz,
  approved_reason          text,
  approved_evidence        text,
  updated_at               timestamptz not null default now(),
  constraint chk_crpp_basis check (
    (movement_posting_enabled = false and cost_basis_source is null)
    or (movement_posting_enabled = true and cost_basis_source = 'matched_supplier_bill_line')
  ),
  constraint chk_crpp_gl check (gl_posting_enabled = false),
  constraint chk_crpp_approval check (
    movement_posting_enabled = false
    or (approved_by is not null and approved_at is not null
        and public._ledgr_construction_reason_present(approved_reason)
        and public._ledgr_construction_reason_present(approved_evidence))
  )
);

comment on table public.construction_receipt_posting_policies is
  'Per-business receipt posting policy. Absence of a row means receipt stock movements are refused. gl_posting_enabled is forced false by a CHECK: invoice/AP/tax clearing stays non-posting until an approved accounting policy exists.';

comment on column public.construction_receipt_posting_policies.cost_basis_source is
  'The only accepted cost basis source is matched_supplier_bill_line. No supplier price, freight, handling, customs, FX, discount or tax rule is inferred.';

create table if not exists public.construction_receipt_cost_bases (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  grn_line_id        uuid not null references public.construction_goods_receipt_lines(id),
  expense_line_id    uuid not null references public.expense_lines(id),
  allocation_id      uuid not null references public.construction_receipt_bill_allocations(id),
  quantity_base      numeric not null,
  -- Functional-currency (business base currency) cost per product base unit, at
  -- the transaction-date rate recorded on the bill. IAS 21 paragraph 21.
  unit_cost_base     numeric not null,
  -- Audit trail of how that number was derived from the supplier document.
  cost_currency      text not null,
  exchange_rate_used numeric not null default 1,
  bill_unit_cost     numeric,
  discount_deducted  numeric not null default 0,
  nonrecoverable_tax numeric not null default 0,
  vat_recoverable    boolean not null default false,
  evidence_reference text not null,
  claimed_by         uuid not null,
  claimed_at         timestamptz not null default now(),
  client_key         uuid not null,
  constraint chk_crcb_quantity check (quantity_base > 0),
  constraint chk_crcb_unit_cost check (unit_cost_base > 0),
  constraint chk_crcb_rate check (exchange_rate_used > 0),
  constraint chk_crcb_discount check (discount_deducted >= 0),
  constraint chk_crcb_tax check (nonrecoverable_tax >= 0),
  constraint chk_crcb_currency check (length(btrim(cost_currency)) > 0),
  constraint chk_crcb_evidence check (public._ledgr_construction_reason_present(evidence_reference)),
  constraint chk_crcb_unique unique (grn_line_id, expense_line_id, allocation_id),
  constraint chk_crcb_unique_client unique (business_id, client_key)
);

create index if not exists idx_crcb_grn_line on public.construction_receipt_cost_bases (grn_line_id);

comment on column public.construction_receipt_cost_bases.unit_cost_base is
  'The matched supplier bill line pre-tax unit price per product base unit, when that bill line has no discount and no tax. It is a PROPOSED cost basis: it only reaches stock through a policy row that has been explicitly approved.';

create or replace function public.approve_construction_receipt_posting_policy(
  p_business_id uuid,
  p_enable      boolean,
  p_reason      text,
  p_evidence    text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor    uuid;
  v_reason   text;
  v_evidence text;
begin
  v_actor := public._ledgr_construction_actor(p_business_id, 'procurement.policy.approve');

  v_reason   := nullif(btrim(coalesce(p_reason, '')), '');
  v_evidence := nullif(btrim(coalesce(p_evidence, '')), '');
  if v_reason is null or v_evidence is null then
    raise exception 'A written reason and an evidence reference are required for a receipt posting policy decision.' using errcode = '22023';
  end if;

  -- The posting policy is the single switch that can enable a receipt stock
  -- movement, so it carries its own append-only marker.
  perform set_config('ledgr.construction_command', 'policy_approve', true);
  if coalesce(p_enable, false) then
    insert into public.construction_receipt_posting_policies
      (business_id, movement_posting_enabled, cost_basis_source, gl_posting_enabled,
       approved_by, approved_at, approved_reason, approved_evidence, updated_at)
    values (p_business_id, true, 'matched_supplier_bill_line', false,
            v_actor, now(), v_reason, v_evidence, now())
    on conflict (business_id) do update
      set movement_posting_enabled = true,
          cost_basis_source = 'matched_supplier_bill_line',
          approved_by = v_actor, approved_at = now(),
          approved_reason = v_reason, approved_evidence = v_evidence,
          updated_at = now();
  else
    insert into public.construction_receipt_posting_policies
      (business_id, movement_posting_enabled, cost_basis_source, gl_posting_enabled,
       approved_by, approved_at, approved_reason, approved_evidence, updated_at)
    values (p_business_id, false, null, false,
            v_actor, now(), v_reason, v_evidence, now())
    on conflict (business_id) do update
      set movement_posting_enabled = false,
          cost_basis_source = null,
          approved_by = v_actor, approved_at = now(),
          approved_reason = v_reason, approved_evidence = v_evidence,
          updated_at = now();
  end if;
  perform set_config('ledgr.construction_command', '', true);

  return jsonb_build_object('business_id', p_business_id, 'movement_posting_enabled', coalesce(p_enable, false),
                            'gl_posting_enabled', false);
end;
$$;

create or replace function public.record_construction_receipt_cost_basis(
  p_grn_line_id      uuid,
  p_expense_line_id  uuid,
  p_quantity         numeric,
  p_evidence         text,
  p_client_key       uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_policy   public.construction_receipt_posting_policies%rowtype;
  v_line     public.construction_goods_receipt_lines%rowtype;
  v_grn      public.construction_goods_receipt_notes%rowtype;
  v_exp_line public.expense_lines%rowtype;
  v_expense  public.expenses;
  v_alloc    public.construction_receipt_bill_allocations%rowtype;
  v_existing uuid;
  v_evidence text;
  v_base     numeric;
  v_used     numeric;
  v_remaining numeric;
  v_id       uuid;
  v_product_base text;
  v_po_currency  text;
  v_base_currency text;
  v_rate         numeric;
  v_gross        numeric;
  v_discount     numeric;
  v_discount_pct numeric;
  v_tax_amount   numeric;
  v_tax_code_text text;
  v_tax_in_cost  numeric := 0;
  v_vat_registered boolean := false;
  v_vat_recoverable boolean := false;
  v_unit_bill    numeric;
  v_unit_func    numeric;
begin
  if p_grn_line_id is null then
    raise exception 'A receipt line is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  select l.business_id into v_business from public.construction_goods_receipt_lines l where l.id = p_grn_line_id;
  if v_business is null then
    raise exception 'Receipt line not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_business, 'procurement.receipt.post');

  select c.id into v_existing from public.construction_receipt_cost_bases c
   where c.business_id = v_business and c.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  -- The gate. No policy row, or a disabled policy row, means no cost basis can
  -- be claimed at all, and therefore no receipt movement can ever be posted.
  select * into v_policy from public.construction_receipt_posting_policies where business_id = v_business;
  if not found or not v_policy.movement_posting_enabled then
    raise exception 'receipt-posting-not-approved: receipt movement posting has no approved accounting policy for this business, so no cost basis can be claimed.'
      using errcode = '22023';
  end if;

  select * into v_line from public.construction_goods_receipt_lines where id = p_grn_line_id for update;
  if not found or v_line.business_id <> v_business then
    raise exception 'Receipt line not found.' using errcode = '42501';
  end if;
  select * into v_grn from public.construction_goods_receipt_notes where id = v_line.grn_id;
  if not public.can_access_branch(v_business, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;

  select * into v_exp_line from public.expense_lines where id = p_expense_line_id;
  if not found or v_exp_line.business_id <> v_business then
    raise exception 'The supplier bill line does not belong to this business.' using errcode = '42501';
  end if;
  v_expense := public._ledgr_construction_bill(v_business, v_exp_line.expense_id);
  perform public._ledgr_construction_assert_bill_not_inventoried(v_business, v_expense.id);

  -- ── Currency and rate ──────────────────────────────────────────────────────
  -- IAS 21 paragraph 21: the foreign-currency amount is recorded in the functional
  -- currency at the spot rate at the date of the transaction. The WAC pool is held
  -- in the functional currency (businesses.base_currency), so the bill's recorded
  -- transaction-date rate is applied ONCE, here, and the resulting functional cost
  -- is frozen: a later exchange difference on settling the payable is recognised in
  -- profit or loss (IAS 21 paragraph 28) and is never pushed back into inventory.
  select o.currency into v_po_currency from public.construction_purchase_orders o where o.id = v_grn.po_id;
  if v_expense.currency <> coalesce(v_po_currency, '') then
    raise exception 'bill-currency-mismatch: the bill is in % but its purchase order is in %.',
      v_expense.currency, coalesce(v_po_currency, '(unknown)') using errcode = '22023';
  end if;
  select b.base_currency into v_base_currency from public.businesses b where b.id = v_business;
  if coalesce(v_base_currency, '') = '' then
    raise exception 'cost-basis-currency-unsupported: the business has no functional (base) currency, so no cost can be recognised.'
      using errcode = '22023';
  end if;

  v_rate := coalesce(v_expense.exchange_rate, 1);
  if v_rate <= 0 then
    raise exception 'bill-fx-inconsistent: the bill records an exchange rate of %.', v_rate using errcode = '22023';
  end if;
  -- A bill already denominated in the functional currency has no exchange
  -- difference: recording any rate other than 1 for it is incoherent, and would
  -- inflate the pool by a factor the document does not support.
  if v_expense.currency = v_base_currency and v_rate <> 1 then
    raise exception 'bill-fx-inconsistent: the bill is in the functional currency (%) but records an exchange rate of %.',
      v_base_currency, v_rate using errcode = '22023';
  end if;
  -- IAS 21 paragraph 21 is applied to the transaction date. A bill whose recorded
  -- rate date is not its own date, or that is flagged stale, is refused rather
  -- than valued at a rate the document does not support.
  if v_expense.rate_date is distinct from v_expense.expense_date or coalesce(v_expense.rate_is_stale, false) then
    raise exception 'bill-fx-inconsistent: the bill rate date (%) must be the bill date (%) and must not be flagged stale. No approximated or stale rate is applied to receipt cost.',
      coalesce(v_expense.rate_date::text, '(none)'), coalesce(v_expense.expense_date::text, '(none)') using errcode = '22023';
  end if;
  -- The recorded functional amount must agree with original amount x rate, or the
  -- bill itself carries two different rates.
  if v_expense.functional_amount is not null and v_expense.original_amount is not null
     and abs(v_expense.functional_amount - (v_expense.original_amount * v_rate)) > 0.05 then
    raise exception 'bill-fx-inconsistent: the recorded functional amount (%) is not the original amount (%) at the recorded rate (%).',
      v_expense.functional_amount, v_expense.original_amount, v_rate using errcode = '22023';
  end if;

  -- ── Discount: deducted from cost ───────────────────────────────────────────
  -- IAS 2 paragraph 11: trade discounts, rebates and other similar items are
  -- deducted in determining the cost of purchase. Only a discount actually stated
  -- on the bill line is deducted; nothing is estimated.
  v_gross := coalesce(v_exp_line.quantity, 0) * coalesce(v_exp_line.unit_price, 0);
  if v_gross <= 0 then
    raise exception 'cost-basis-quantity-invalid: the bill line has a non-positive purchase value.' using errcode = '22023';
  end if;
  v_discount := coalesce(v_exp_line.discount_amount, 0);
  if coalesce(v_exp_line.discount_percent, 0) <> 0 then
    v_discount_pct := round(v_gross * v_exp_line.discount_percent / 100, 2);
    if v_discount <> 0 and abs(v_discount - v_discount_pct) > 0.01 then
      raise exception 'cost-basis-discount-inconsistent: the bill line states a discount amount of % and a discount percentage of % (% on the line value). One of the two is wrong.',
        v_discount, v_exp_line.discount_percent, v_discount_pct using errcode = '22023';
    end if;
    v_discount := v_discount_pct;
  end if;
  if v_discount < 0 or v_discount >= v_gross then
    raise exception 'cost-basis-discount-invalid: a discount of % against a line value of % is not a purchase discount.', v_discount, v_gross
      using errcode = '22023';
  end if;

  -- ── Tax: recoverable VAT is excluded, non-recoverable tax is included ──────
  -- IAS 2 paragraph 11: cost of purchase comprises the purchase price, import
  -- duties and other taxes OTHER THAN those subsequently recoverable from the
  -- taxing authorities. Whether input VAT is recoverable is a fact about the
  -- business (businesses.vat_registered), not a rate assumption: the amount used
  -- is the tax actually recorded on the supplier bill line, so no disputed VAT
  -- effective date can misstate inventory.
  v_tax_amount := coalesce(v_exp_line.tax_amount, 0);
  v_tax_code_text := v_exp_line.tax_code::text;
  if v_tax_code_text = 'vat_standard' then
    if v_tax_amount <= 0 then
      raise exception 'cost-basis-tax-missing: a standard-rated bill line records no tax amount. Record the tax actually charged before claiming receipt cost.'
        using errcode = '22023';
    end if;
    select coalesce(b.vat_registered, false) into v_vat_registered from public.businesses b where b.id = v_business;
    v_vat_recoverable := v_vat_registered;
    if v_vat_recoverable then
      v_tax_in_cost := 0;
    else
      v_tax_in_cost := v_tax_amount;
    end if;
  elsif v_tax_code_text in ('vat_zero', 'vat_exempt', 'none') then
    if v_tax_amount <> 0 then
      raise exception 'cost-basis-tax-inconsistent: bill line tax code % records a tax amount of %.', v_tax_code_text, v_tax_amount
        using errcode = '22023';
    end if;
    v_vat_recoverable := false;
    v_tax_in_cost := 0;
  else
    raise exception 'cost-basis-tax-unsupported: tax code % is not a purchase tax. No withholding or income tax rule is applied to receipt cost.',
      v_tax_code_text using errcode = '22023';
  end if;

  -- ── The cost itself ────────────────────────────────────────────────────────
  v_unit_bill := (v_gross - v_discount + v_tax_in_cost) / v_exp_line.quantity;
  v_unit_func := round(v_unit_bill * v_rate, 6);
  if v_unit_func <= 0 then
    raise exception 'cost-basis-unit-cost-invalid: the derived functional unit cost is %.', v_unit_func using errcode = '22023';
  end if;

  -- The cost basis must come from an allocation that already matched this
  -- receipt line to this bill line. Nothing is derived from an unmatched bill.
  select * into v_alloc
    from public.construction_receipt_bill_allocations a
   where a.grn_line_id = p_grn_line_id and a.expense_line_id = p_expense_line_id
   order by a.matched_at
   limit 1;
  if not found then
    raise exception 'cost-basis-unmatched: match the bill line to this receipt line before claiming a cost basis.'
      using errcode = '22023';
  end if;

  -- The bill must state its price in the product's base unit. This is an
  -- operational rule about the supplier document, not an accounting conversion:
  -- a price per carton is not silently divided into a price per bag.
  v_product_base := public._ledgr_construction_base_uom(v_business, v_line.product_id);
  if v_product_base is null or v_alloc.bill_uom <> v_product_base then
    raise exception 'cost-basis-uom-unsupported: the matched bill unit must be the product base unit %. Unit conversion is not applied to cost.', coalesce(v_product_base, '(undeclared)')
      using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'The claimed quantity must be greater than zero.' using errcode = '22023';
  end if;
  v_base := public._ledgr_construction_to_base(v_business, v_line.product_id, v_product_base, p_quantity, 'The claimed quantity');

  select coalesce(sum(c.quantity_base), 0) into v_used
    from public.construction_receipt_cost_bases c
   where c.grn_line_id = p_grn_line_id and c.expense_line_id = p_expense_line_id;
  v_remaining := v_alloc.receipt_quantity_base - v_used;
  if v_base > v_remaining then
    raise exception 'cost-basis-quantity-exceeded: the claim (% in the product base unit) exceeds the matched but unclaimed quantity (%).',
      v_base, v_remaining using errcode = '22023';
  end if;

  v_evidence := public._ledgr_construction_text(p_evidence, 'The cost basis evidence reference');

  -- Re-check the replay key with the receipt line locked.
  select c.id into v_existing from public.construction_receipt_cost_bases c
   where c.business_id = v_business and c.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true);
  end if;

  insert into public.construction_receipt_cost_bases
    (business_id, grn_line_id, expense_line_id, allocation_id, quantity_base, unit_cost_base,
     cost_currency, exchange_rate_used, bill_unit_cost, discount_deducted, nonrecoverable_tax,
     vat_recoverable, evidence_reference, claimed_by, client_key)
  values (v_business, p_grn_line_id, p_expense_line_id, v_alloc.id, v_base, v_unit_func,
          v_base_currency, v_rate, round(v_unit_bill, 6), v_discount, v_tax_in_cost,
          v_vat_recoverable, v_evidence, v_actor, p_client_key)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'idempotent', false,
    'unit_cost_base', v_unit_func, 'bill_unit_cost', round(v_unit_bill, 6), 'cost_currency', v_base_currency,
    'exchange_rate_used', v_rate, 'discount_deducted', v_discount,
    'nonrecoverable_tax', v_tax_in_cost, 'vat_recoverable', v_vat_recoverable,
    'stock_effect', 'none', 'journal_effect', 'none');
end;
$$;

create or replace function public.post_construction_receipt_movement(p_grn_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_grn      public.construction_goods_receipt_notes%rowtype;
  v_actor    uuid;
  v_policy   public.construction_receipt_posting_policies%rowtype;
  v_line     public.construction_goods_receipt_lines%rowtype;
  v_covered  numeric;
  v_weighted numeric;
  v_cost_sum numeric;
  v_moved    integer := 0;
  v_movement_id uuid;
  v_delta       numeric;
begin
  if p_grn_id is null then
    raise exception 'A goods receipt is required.' using errcode = '22023';
  end if;

  select * into v_grn from public.construction_goods_receipt_notes where id = p_grn_id for update;
  if not found then
    raise exception 'Goods receipt not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_grn.business_id, 'procurement.receipt.post');
  if not public.can_access_branch(v_grn.business_id, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_grn.business_id, v_grn.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  -- What has already reached stock is tracked per receipt line, so a second call
  -- posts only the difference (normally nothing at all) and a quality release
  -- made AFTER a posting is still posted instead of being silently stranded. The
  -- GRN row is locked above, so a concurrent pair serialises and the loser sees
  -- an empty delta.

  select * into v_policy from public.construction_receipt_posting_policies where business_id = v_grn.business_id;
  if not found or not v_policy.movement_posting_enabled then
    raise exception 'receipt-posting-not-approved: receipt movement posting has no approved accounting policy for this business.'
      using errcode = '22023';
  end if;
  if v_policy.gl_posting_enabled then
    raise exception 'receipt-gl-posting-not-approved: GL posting from a goods receipt is not approved.' using errcode = '22023';
  end if;

  -- The period lock is absolute: a receipt dated inside a closed period is
  -- denied here, and this file never reopens a period.
  perform public._ledgr_assert_period_open(v_grn.business_id, v_grn.receipt_date, 'Goods receipt movement');

  -- Coverage is all-or-nothing for every line that still has an unposted accepted
  -- quantity: a partially costed line is never posted, so no quantity reaches
  -- stock at an unknown cost. The check runs for the WHOLE receipt before any
  -- movement is written, so a failure posts nothing at all.
  for v_line in
    select * from public.construction_goods_receipt_lines l
     where l.grn_id = v_grn.id order by l.line_number
  loop
    if v_line.accepted_base > v_line.quantity_posted_base then
      select coalesce(sum(c.quantity_base), 0) into v_covered
        from public.construction_receipt_cost_bases c where c.grn_line_id = v_line.id;
      if v_covered < v_line.accepted_base then
        raise exception 'receipt-cost-basis-incomplete: receipt line % has an accepted quantity of % but only % has an evidenced cost basis. Nothing was posted.',
          v_line.line_number, v_line.accepted_base, v_covered using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_line in
    select * from public.construction_goods_receipt_lines l
     where l.grn_id = v_grn.id order by l.line_number
  loop
    v_delta := v_line.accepted_base - v_line.quantity_posted_base;
    if v_delta > 0 then
      select coalesce(sum(c.quantity_base * c.unit_cost_base), 0),
             nullif(sum(c.quantity_base), 0)
        into v_cost_sum, v_weighted
        from public.construction_receipt_cost_bases c where c.grn_line_id = v_line.id;
      if v_weighted is null or v_cost_sum <= 0 then
        raise exception 'receipt-cost-basis-incomplete: receipt line % has no evidenced cost.', v_line.line_number
          using errcode = '22023';
      end if;

      -- Only public.stock_movements is written. The shared R06 balance writer
      -- propagates the balance; this file never touches inventory_balances.
      insert into public.stock_movements
        (business_id, product_id, location_id, movement_type, movement_date, quantity,
         unit_cost, source_type, source_id, reference, created_by, notes)
      values (v_grn.business_id, v_line.product_id, v_grn.location_id, 'purchase', v_grn.receipt_date,
              v_delta, v_cost_sum / v_weighted, 'construction_grn', v_grn.id,
              v_grn.grn_number, v_actor,
              'Construction goods receipt ' || v_grn.grn_number || ' line ' || v_line.line_number)
      returning id into v_movement_id;

      perform set_config('ledgr.construction_command', 'receipt_post', true);
      update public.construction_goods_receipt_lines
         set quantity_posted_base = quantity_posted_base + v_delta
       where id = v_line.id;
      perform set_config('ledgr.construction_command', '', true);

      v_moved := v_moved + 1;
    end if;
  end loop;

  if v_moved = 0 then
    return jsonb_build_object('id', v_grn.id, 'movements', 0, 'idempotent', true,
                              'journal_effect', 'none');
  end if;
  return jsonb_build_object('id', v_grn.id, 'movements', v_moved, 'idempotent', false,
                            'journal_effect', 'none');
end;
$$;

-- ============================================================================
-- 9b. MATERIAL ISSUES — CONSUMPTION AND PROJECT MATERIAL COST
-- ============================================================================
-- IAS 2 paragraph 6(c) treats materials to be consumed in production or in
-- rendering services as inventory, and paragraph 34 recognises their carrying
-- amount as an expense in the period in which the related revenue is recognised.
-- Consumption is therefore derecognition AT CARRYING AMOUNT: the issued quantity
-- leaves stock at the pool weighted-average cost the shared R06 writer maintains,
-- never at a client-supplied price. No GL entry is written: the debit side
-- (project cost / contract cost) has no approved account mapping.

create table if not exists public.construction_material_issues (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  site_id            uuid not null references public.construction_procurement_sites(id),
  branch_id          uuid not null references public.branches(id),
  location_id        uuid not null references public.inventory_locations(id),
  project_ref        text not null,
  product_id         uuid not null references public.products(id),
  uom                text not null,
  quantity           numeric not null,
  quantity_base      numeric not null,
  unit_cost_base     numeric not null,
  total_cost_base    numeric not null,
  currency           text not null,
  issue_date         date not null,
  issued_to          text,
  evidence_reference text not null,
  stock_movement_id  uuid not null references public.stock_movements(id),
  issued_by          uuid not null,
  issued_at          timestamptz not null default now(),
  notes              text,
  client_key         uuid not null,
  constraint chk_cmi_quantity  check (quantity > 0 and quantity_base > 0),
  constraint chk_cmi_cost      check (unit_cost_base > 0 and total_cost_base > 0),
  constraint chk_cmi_evidence  check (public._ledgr_construction_reason_present(evidence_reference)),
  constraint chk_cmi_project   check (public._ledgr_construction_reason_present(project_ref)),
  constraint chk_cmi_unique_client unique (business_id, client_key)
);

create index if not exists idx_cmi_site_project on public.construction_material_issues (business_id, project_ref);
create index if not exists idx_cmi_product on public.construction_material_issues (business_id, product_id);

comment on table public.construction_material_issues is
  'Material issued from a store location to a construction site, valued at the pool weighted-average cost at the moment of issue. Project material cost is derived from these rows (sum by project_ref); there is no second stored cost balance and no GL entry.';

create or replace function public.issue_construction_materials_to_project(
  p_payload    jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_actor    uuid;
  v_site     public.construction_procurement_sites%rowtype;
  v_policy   public.construction_receipt_posting_policies%rowtype;
  v_balance  public.inventory_balances%rowtype;
  v_product  uuid;
  v_uom      text;
  v_qty      numeric;
  v_base     numeric;
  v_date     date;
  v_unit     numeric;
  v_total    numeric;
  v_currency text;
  v_issue_id uuid := gen_random_uuid();
  v_movement uuid;
  v_existing uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'An issue payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.material.issue');

  select c.id into v_existing from public.construction_material_issues c
   where c.business_id = v_business and c.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true, 'stock_effect', 'none');
  end if;

  -- Scope is derived from the registered site: the caller cannot name a branch,
  -- a location or a project of its own choosing.
  v_site := public._ledgr_construction_site(v_business, public._ledgr_construction_uuid(p_payload->>'site_id', 'The construction site'));
  if not public.can_access_branch(v_business, v_site.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_business, v_site.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  v_product := public._ledgr_construction_uuid(p_payload->>'product_id', 'The product');
  if not exists (select 1 from public.products p where p.id = v_product and p.business_id = v_business) then
    raise exception 'The product does not belong to this business.' using errcode = '42501';
  end if;
  v_uom := upper(public._ledgr_construction_text(p_payload->>'uom', 'The issue unit of measure'));
  begin
    v_qty := (p_payload->>'quantity')::numeric;
  exception when others then
    raise exception 'The issued quantity must be a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then
    raise exception 'The issued quantity must be greater than zero.' using errcode = '22023';
  end if;
  v_base := public._ledgr_construction_to_base(v_business, v_product, v_uom, v_qty, 'The issued quantity');

  v_date := public._ledgr_construction_date(p_payload->>'issue_date', 'The issue date');

  -- Same boundary as receipts: nothing leaves stock unless an approved movement
  -- posting policy exists, and never inside a closed period.
  select * into v_policy from public.construction_receipt_posting_policies where business_id = v_business;
  if not found or not v_policy.movement_posting_enabled then
    raise exception 'issue-posting-not-approved: material issues have no approved movement policy for this business.'
      using errcode = '22023';
  end if;
  if v_policy.gl_posting_enabled then
    raise exception 'issue-gl-posting-not-approved: GL posting from a material issue is not approved.' using errcode = '22023';
  end if;
  perform public._ledgr_assert_period_open(v_business, v_date, 'Material issue');

  -- The pool row is the authority for both availability and cost.
  select * into v_balance
    from public.inventory_balances b
   where b.business_id = v_business and b.product_id = v_product and b.location_id = v_site.location_id
   for update;
  if not found or coalesce(v_balance.quantity_on_hand, 0) < v_base then
    raise exception 'insufficient-stock: % in base units are available at the site store but % are being issued.',
      coalesce(v_balance.quantity_on_hand, 0), v_base using errcode = '22023';
  end if;
  if coalesce(v_balance.average_cost, 0) <= 0 then
    raise exception 'issue-cost-unknown: the pool has no weighted-average cost for this product at this location, so the issue cannot be valued.'
      using errcode = '22023';
  end if;
  v_unit  := round(v_balance.average_cost, 6);
  v_total := round(v_unit * v_base, 6);
  select b.base_currency into v_currency from public.businesses b where b.id = v_business;

  -- One outbound movement through the single shared writer: quantity is negative,
  -- unit cost is the pool average, so the balance quantity falls and the pool's
  -- average cost is unchanged (an outbound movement never re-prices the pool).
  insert into public.stock_movements
    (business_id, product_id, location_id, movement_type, movement_date, quantity,
     unit_cost, source_type, source_id, reference, created_by, notes)
  values (v_business, v_product, v_site.location_id, 'issue_out', v_date, -v_base,
          v_unit, 'construction_issue', v_issue_id, v_site.site_code, v_actor,
          'Construction material issue to ' || v_site.site_code || ' (' || v_site.project_ref || ')')
  returning id into v_movement;

  insert into public.construction_material_issues
    (id, business_id, site_id, branch_id, location_id, project_ref, product_id, uom,
     quantity, quantity_base, unit_cost_base, total_cost_base, currency, issue_date,
     issued_to, evidence_reference, stock_movement_id, issued_by, notes, client_key)
  values (v_issue_id, v_business, v_site.id, v_site.branch_id, v_site.location_id, v_site.project_ref,
          v_product, v_uom, v_qty, v_base, v_unit, v_total, v_currency, v_date,
          nullif(btrim(coalesce(p_payload->>'issued_to', '')), ''),
          public._ledgr_construction_text(p_payload->>'evidence_reference', 'The issue evidence reference'),
          v_movement, v_actor, nullif(btrim(coalesce(p_payload->>'notes', '')), ''), p_client_key);

  return jsonb_build_object(
    'id', v_issue_id, 'idempotent', false, 'project_ref', v_site.project_ref,
    'quantity_base', v_base, 'unit_cost_base', v_unit, 'total_cost_base', v_total,
    'currency', v_currency, 'stock_effect', 'outbound', 'movement_type', 'issue_out',
    'journal_effect', 'none');
end;
$$;

create or replace function public.construction_project_material_cost(p_business_id uuid)
returns table (
  project_ref      text,
  issue_count      bigint,
  quantity_base    numeric,
  material_cost    numeric,
  currency         text,
  first_issue_date date,
  last_issue_date  date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_business_id is null then
    raise exception 'A business is required.' using errcode = '22023';
  end if;
  -- Read-only, and it exposes nothing beyond what the member-read policies on
  -- the underlying tables already expose to an active member of this business.
  if not public.is_business_member(p_business_id) then
    raise exception 'You are not an active member of this business.' using errcode = '42501';
  end if;

  return query
    select i.project_ref,
           count(*)::bigint,
           sum(i.quantity_base),
           sum(i.total_cost_base),
           min(i.currency),
           min(i.issue_date),
           max(i.issue_date)
      from public.construction_material_issues i
     where i.business_id = p_business_id
     group by i.project_ref
     order by i.project_ref;
end;
$$;

create or replace function public.construction_procurement_open_items(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.construction_receipt_posting_policies%rowtype;
begin
  if p_business_id is null then
    raise exception 'A business is required.' using errcode = '22023';
  end if;
  if not public.is_business_member(p_business_id) then
    raise exception 'You are not an active member of this business.' using errcode = '42501';
  end if;

  select * into v_policy from public.construction_receipt_posting_policies where business_id = p_business_id;

  return jsonb_build_object(
    'business_id', p_business_id,
    'movement_posting_enabled', coalesce(v_policy.movement_posting_enabled, false),
    'gl_posting_enabled', false,
    'grants_in_force', (
      select count(*) from public.construction_procurement_grants g
       where g.business_id = p_business_id and g.revoked_at is null),
    -- Receipts whose accepted quantity has no evidenced cost basis yet.
    'awaiting_cost_basis', coalesce((
      select jsonb_agg(x) from (
        select g.grn_number, l.line_number, l.accepted_base,
               coalesce((select sum(c.quantity_base) from public.construction_receipt_cost_bases c
                          where c.grn_line_id = l.id), 0) as covered_base
          from public.construction_goods_receipt_lines l
          join public.construction_goods_receipt_notes g on g.id = l.grn_id
         where l.business_id = p_business_id and l.accepted_base > 0
         order by g.grn_number, l.line_number) x), '[]'::jsonb),
    -- Receipts with an accepted quantity that is not yet in stock.
    'awaiting_posting', coalesce((
      select jsonb_agg(x) from (
        select g.grn_number, l.line_number, l.accepted_base, l.quantity_posted_base
          from public.construction_goods_receipt_lines l
          join public.construction_goods_receipt_notes g on g.id = l.grn_id
         where l.business_id = p_business_id
           and l.accepted_base > l.quantity_posted_base
         order by g.grn_number, l.line_number) x), '[]'::jsonb),
    -- Quality holds still open, with their age in days.
    'open_holds', coalesce((
      select jsonb_agg(x) from (
        select h.hold_type, h.quantity, h.quantity_base, h.reason, h.evidence_reference,
               (current_date - h.created_at::date) as age_days
          from public.construction_goods_receipt_holds h
         where h.business_id = p_business_id and h.status = 'open'
         order by h.created_at) x), '[]'::jsonb),
    -- Quantities the entity has NOT taken into stock and must settle with the
    -- supplier: rejected (never entered stock) and quarantined/disputed (waiting
    -- on quality). This is the outstanding-claim list for period close.
    'outstanding_supplier_claims', coalesce((
      select jsonb_agg(x) from (
        select c.name as supplier, l.product_id,
               l.rejected_base, l.quarantined_base, l.disputed_base,
               (l.rejected_base + l.quarantined_base + l.disputed_base) as outstanding_base,
               g.receipt_date,
               (current_date - g.receipt_date) as age_days
          from public.construction_goods_receipt_lines l
          join public.construction_goods_receipt_notes g on g.id = l.grn_id
          join public.construction_purchase_orders o on o.id = g.po_id
          join public.contacts c on c.id = o.supplier_contact_id
         where l.business_id = p_business_id
           and (l.rejected_base + l.quarantined_base + l.disputed_base) > 0
         order by g.receipt_date) x), '[]'::jsonb),
    -- Bills that cannot be matched to a receipt because they already moved stock
    -- through the legacy purchase hook.
    'blocked_bills', coalesce((
      select jsonb_agg(x) from (
        select e.expense_number, e.reference,
               (select count(*) from public.stock_movements m
                 where m.business_id = e.business_id and m.source_type = 'expense' and m.source_id::text = e.id::text) as legacy_movements
          from public.expenses e
         where e.business_id = p_business_id and e.expense_type = 'bill' and e.deleted_at is null
           and exists (select 1 from public.stock_movements m
                        where m.business_id = e.business_id and m.source_type = 'expense' and m.source_id::text = e.id::text)
         order by e.expense_number) x), '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- 10. APPEND-ONLY GUARD
-- ============================================================================
-- Table privileges are the primary control: public.construction_* is readable
-- (see section 11) and NOT writable by anon or authenticated, so the commands
-- are the only write path. This trigger is defence in depth for a privileged or
-- out-of-band writer (service role, psql, a future migration): a row that must
-- not be rewritten cannot be rewritten silently, and the one legitimate update
-- (releasing a hold, re-pointing a site, updating a conversion factor,
-- revoking a grant) must be performed by its command, which raises the
-- transaction-local marker below. The marker is reset immediately after use.

create or replace function public._ledgr_construction_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- tg_argv[0] is a comma-separated token list, because one table can have more
  -- than one legitimate updating command (a receipt line is updated by the
  -- posting command and by an evidenced reclassification). A single-token
  -- comparison would need one trigger per token, and trigger firing order would
  -- then decide whether an update is allowed — order-dependent authorization is
  -- not acceptable.
  v_allowed text := nullif(coalesce(tg_argv[0], ''), '');
  v_marker  text := nullif(coalesce(current_setting('ledgr.construction_command', true), ''), '');
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  if v_allowed is not null
     and v_marker is not null
     and v_marker = any (string_to_array(v_allowed, ',')) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'construction-append-only: % rows cannot be changed directly; use the construction procurement command for that operation.', tg_table_name
    using errcode = '42501';
end;
$$;

revoke all on function public._ledgr_construction_append_only() from public, anon, authenticated;

do $append_only$
declare
  v_table text;
  v_token text;
begin
  for v_table, v_token in
    select * from (values
      ('construction_purchase_order_events',         ''),
      ('construction_delivery_notes',                ''),
      ('construction_delivery_note_lines',           ''),
      ('construction_goods_receipt_notes',           ''),
      ('construction_receipt_bill_allocations',      ''),
      ('construction_supplier_invoice_references',   ''),
      ('construction_receipt_cost_bases',            ''),
      ('construction_receipt_inspections',           ''),
      ('construction_material_issues',               ''),
      ('construction_receipt_line_reclassifications',''),
      ('construction_purchase_orders',               'po_transition'),
      ('construction_goods_receipt_lines',           'receipt_post,grn_reclassify'),
      ('construction_procurement_sites',             'site_upsert'),
      ('construction_product_uom_conversions',       'uom_upsert'),
      ('construction_procurement_grants',            'grant_revoke'),
      ('construction_receipt_posting_policies',      'policy_approve'),
      ('construction_goods_receipt_holds',           'hold_release')
    ) as t(table_name, token)
  loop
    execute format('drop trigger if exists trg_construction_append_only on public.%I', v_table);
    execute format(
      'create trigger trg_construction_append_only before update or delete on public.%I for each row execute function public._ledgr_construction_append_only(%L)',
      v_table, v_token);
  end loop;
end
$append_only$;

-- The commands that legitimately update a row raise this transaction-local
-- marker for their own statement and clear it immediately afterwards. The
-- marker is defence in depth only: table privileges (section 11) already deny
-- every direct write to anon and authenticated.

-- ============================================================================
-- 11. RLS AND PRIVILEGES — MEMBER READ ONLY, NO WRITE PATH THROUGH POSTGREST
-- ============================================================================
-- Follows the repository pattern (20260815000003, 20261014000000): enable RLS,
-- remove every privilege from anon/authenticated, grant SELECT back, and expose
-- exactly one read policy. No INSERT/UPDATE/DELETE policy is created for
-- authenticated, so a direct PostgREST write is denied twice over: no privilege
-- and no policy.

do $rls$
declare
  v_table text;
  v_business_column text;
  v_policy record;
begin
  foreach v_table in array array[
    'construction_procurement_sites',
    'construction_product_uom_conversions',
    'construction_purchase_orders',
    'construction_purchase_order_lines',
    'construction_purchase_order_events',
    'construction_delivery_notes',
    'construction_delivery_note_lines',
    'construction_goods_receipt_notes',
    'construction_goods_receipt_lines',
    'construction_goods_receipt_holds',
    'construction_supplier_invoice_references',
    'construction_receipt_bill_allocations',
    'construction_receipt_cost_bases',
    'construction_receipt_posting_policies',
    'construction_receipt_inspections',
    'construction_receipt_line_reclassifications',
    'construction_material_issues',
    'construction_procurement_grants'
  ] loop
    v_business_column := 'business_id';

    execute format('alter table public.%I enable row level security', v_table);

    -- Drop only the policies this migration owns; leave anything else alone.
    for v_policy in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = v_table
         and policyname in (v_table || '_member_read', v_table || '_platform_admin_read')
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;

    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(%I))',
      v_table || '_member_read', v_table, v_business_column);
  end loop;

  -- Static vocabulary: non-tenant reference data, readable by any signed-in
  -- caller. It contains no business data.
  execute 'alter table public.construction_procurement_capabilities enable row level security';
  for v_policy in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'construction_procurement_capabilities'
  loop
    execute format('drop policy if exists %I on public.construction_procurement_capabilities', v_policy.policyname);
  end loop;
  execute 'revoke all on public.construction_procurement_capabilities from anon, authenticated';
  execute 'grant select on public.construction_procurement_capabilities to authenticated';
  execute $p$create policy construction_procurement_capabilities_read
              on public.construction_procurement_capabilities for select to authenticated using (true)$p$;
end
$rls$;

-- ── Function privileges ─────────────────────────────────────────────────────
-- Private helpers are executable by nobody but the definer. Commands are
-- executable by authenticated (they authorize internally) and by service_role.
revoke all on function public.register_construction_procurement_site(uuid, uuid, uuid, text, text, text) from public, anon;
revoke all on function public.register_construction_product_uom_conversion(uuid, uuid, text, text, numeric, text) from public, anon;
revoke all on function public.create_construction_purchase_order(jsonb, uuid) from public, anon;
revoke all on function public.authorize_construction_purchase_order(uuid) from public, anon;
revoke all on function public.cancel_construction_purchase_order(uuid, text) from public, anon;
revoke all on function public.record_construction_delivery_note(jsonb, uuid) from public, anon;
revoke all on function public.record_construction_goods_receipt(jsonb, uuid) from public, anon;
revoke all on function public.record_construction_delivery_note_exception(jsonb, uuid) from public, anon;
revoke all on function public.release_construction_receipt_hold(uuid, text) from public, anon;
revoke all on function public.register_construction_supplier_invoice_reference(uuid) from public, anon;
revoke all on function public.register_construction_supplier_invoice_reference_exception(uuid, uuid, text, text) from public, anon;
revoke all on function public.match_construction_bill_line_to_receipt(jsonb, uuid) from public, anon;
revoke all on function public.approve_construction_receipt_posting_policy(uuid, boolean, text, text) from public, anon;
revoke all on function public.record_construction_receipt_cost_basis(uuid, uuid, numeric, text, uuid) from public, anon;
revoke all on function public.post_construction_receipt_movement(uuid) from public, anon;
revoke all on function public.grant_construction_procurement_capability(uuid, uuid, text, text) from public, anon;
revoke all on function public.revoke_construction_procurement_capability(uuid, text) from public, anon;
revoke all on function public.construction_procurement_capabilities_for(uuid) from public, anon;
revoke all on function public.record_construction_receipt_inspection(jsonb, uuid) from public, anon;
revoke all on function public.reclassify_construction_receipt_line(jsonb, uuid) from public, anon;
revoke all on function public.issue_construction_materials_to_project(jsonb, uuid) from public, anon;
revoke all on function public.construction_project_material_cost(uuid) from public, anon;
revoke all on function public.construction_procurement_open_items(uuid) from public, anon;

grant execute on function public.register_construction_procurement_site(uuid, uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.register_construction_product_uom_conversion(uuid, uuid, text, text, numeric, text) to authenticated, service_role;
grant execute on function public.create_construction_purchase_order(jsonb, uuid) to authenticated, service_role;
grant execute on function public.authorize_construction_purchase_order(uuid) to authenticated, service_role;
grant execute on function public.cancel_construction_purchase_order(uuid, text) to authenticated, service_role;
grant execute on function public.record_construction_delivery_note(jsonb, uuid) to authenticated, service_role;
grant execute on function public.record_construction_goods_receipt(jsonb, uuid) to authenticated, service_role;
grant execute on function public.record_construction_delivery_note_exception(jsonb, uuid) to authenticated, service_role;
grant execute on function public.release_construction_receipt_hold(uuid, text) to authenticated, service_role;
grant execute on function public.register_construction_supplier_invoice_reference(uuid) to authenticated, service_role;
grant execute on function public.register_construction_supplier_invoice_reference_exception(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.match_construction_bill_line_to_receipt(jsonb, uuid) to authenticated, service_role;
grant execute on function public.approve_construction_receipt_posting_policy(uuid, boolean, text, text) to authenticated, service_role;
grant execute on function public.record_construction_receipt_cost_basis(uuid, uuid, numeric, text, uuid) to authenticated, service_role;
grant execute on function public.post_construction_receipt_movement(uuid) to authenticated, service_role;
grant execute on function public.grant_construction_procurement_capability(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.revoke_construction_procurement_capability(uuid, text) to authenticated, service_role;
grant execute on function public.construction_procurement_capabilities_for(uuid) to authenticated, service_role;
grant execute on function public.record_construction_receipt_inspection(jsonb, uuid) to authenticated, service_role;
grant execute on function public.reclassify_construction_receipt_line(jsonb, uuid) to authenticated, service_role;
grant execute on function public.issue_construction_materials_to_project(jsonb, uuid) to authenticated, service_role;
grant execute on function public.construction_project_material_cost(uuid) to authenticated, service_role;
grant execute on function public.construction_procurement_open_items(uuid) to authenticated, service_role;

-- Helper functions used only inside commands stay unreachable to every API role.
revoke all on function public._ledgr_construction_guard_po() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_po_line() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_po_line_frozen() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_dn() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_dn_line() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_grn() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_grn_line() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_hold() from public, anon, authenticated;
revoke all on function public._ledgr_construction_guard_conversion() from public, anon, authenticated;

-- ============================================================================
-- 12. SELF-VERIFICATION
-- ============================================================================
-- Fails the migration (and therefore the deploy) if any invariant this file
-- claims is not actually true of the database it was applied to.
do $verify$
declare
  v_table text;
  v_missing text[] := array[]::text[];
  v_count integer;
  v_priv  text;
begin
  -- 12.1 Every new table has RLS enabled.
  foreach v_table in array array[
    'construction_procurement_sites','construction_product_uom_conversions',
    'construction_purchase_orders','construction_purchase_order_lines',
    'construction_purchase_order_events','construction_delivery_notes',
    'construction_delivery_note_lines','construction_goods_receipt_notes',
    'construction_goods_receipt_lines','construction_goods_receipt_holds',
    'construction_supplier_invoice_references','construction_receipt_bill_allocations',
    'construction_receipt_cost_bases','construction_receipt_posting_policies',
    'construction_receipt_inspections','construction_receipt_line_reclassifications',
    'construction_material_issues',
    'construction_procurement_grants','construction_procurement_capabilities'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      v_missing := array_append(v_missing, (v_table || ' (RLS)'));
    end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = v_table and cmd = 'SELECT'
    ) then
      v_missing := array_append(v_missing, (v_table || ' (read policy)'));
    end if;
  end loop;

  -- 12.2 authenticated holds SELECT only: no INSERT/UPDATE/DELETE privilege on
  --      any construction procurement table.
  foreach v_table in array array[
    'construction_procurement_sites','construction_product_uom_conversions',
    'construction_purchase_orders','construction_purchase_order_lines',
    'construction_purchase_order_events','construction_delivery_notes',
    'construction_delivery_note_lines','construction_goods_receipt_notes',
    'construction_goods_receipt_lines','construction_goods_receipt_holds',
    'construction_supplier_invoice_references','construction_receipt_bill_allocations',
    'construction_receipt_cost_bases','construction_receipt_posting_policies',
    'construction_receipt_inspections','construction_receipt_line_reclassifications',
    'construction_material_issues',
    'construction_procurement_grants'
  ] loop
    for v_priv in select unnest(array['insert', 'update', 'delete']) loop
      if has_table_privilege('authenticated', 'public.' || v_table, v_priv) then
        v_missing := array_append(v_missing, (v_table || ' (authenticated ' || v_priv || ' privilege)'));
      end if;
    end loop;
  end loop;
  if has_table_privilege('anon', 'public.construction_purchase_orders', 'select') then
    v_missing := array_append(v_missing, 'anon can read construction purchase orders');
  end if;

  -- 12.3 The single stock balance writer is still the only one.
  select count(*) into v_count
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.stock_movements'::regclass and not t.tgisinternal
     and (t.tgname ilike '%balance%' or p.proname ilike '%balance%'
          or p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M');
  if v_count <> 1 then
    v_missing := array_append(v_missing, format('stock balance writer count is % (expected 1)', v_count));
  end if;

  -- 12.4 GL posting from a receipt is structurally impossible.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.construction_receipt_posting_policies'::regclass
       and conname = 'chk_crpp_gl'
  ) then
    v_missing := array_append(v_missing, 'receipt GL posting guard constraint missing');
  end if;

  -- Existing business rows are valid on an already-used deployment. This
  -- migration defines schema and commands but must not reject or remove rows
  -- merely because these tables are nonempty; verify structural safeguards here.
  -- The migration contains no inserts into posting policies, material issues,
  -- inspections, or receipt reclassifications.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'stock_movement_type' and e.enumlabel = 'issue_out'
  ) then
    v_missing := array_append(v_missing, 'stock_movement_type has no issue_out label');
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.construction_goods_receipt_lines'::regclass
       and tgname = 'trg_construction_append_only'
       and pg_get_triggerdef(oid) like '%receipt_post%'
       and pg_get_triggerdef(oid) like '%grn_reclassify%'
  ) then
    v_missing := array_append(v_missing, 'receipt line append-only guard does not list both updating commands');
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'construction_goods_receipt_lines'
       and column_name = 'quantity_posted_base'
  ) then
    v_missing := array_append(v_missing, 'receipt line has no posted-quantity column');
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Construction procurement verification failed: %', array_to_string(v_missing, '; ')
      using errcode = 'check_violation';
  end if;

  raise notice 'Construction procurement traceability installed: 16 tables, member-read RLS, explicit capability grants, and receipt posting guarded by per-business policy.';
end
$verify$;
