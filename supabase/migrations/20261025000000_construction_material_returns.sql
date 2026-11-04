-- ============================================================================
-- 20261025000000_construction_material_returns.sql
--
-- Phase 1 of the construction returns design:
--   docs/architecture/CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md
--   owner decision: docs/audits/LEDGR_CONSTRUCTION_RETURNS_PHASE1_OWNER_DECISION_2026-10-16.md
--
-- WHAT THIS FILE ADDS
--   1. The append-only register of usable-material returns
--      (public.construction_material_returns).
--   2. The dedicated capability `procurement.material.return` in the catalogue.
--   3. Read-only RLS for members with branch scope, and the append-only guard.
--
-- WHAT THIS FILE DOES NOT DO
--   No command, no stock movement, no costing change (that is
--   20261026000000_construction_return_command.sql) and no GL posting. The
--   register is inert until the command writes to it.
--
-- WHY THE REGISTER IS REQUIRED
--   Project material cost is DERIVED by summing the append-only issue register
--   (see the comment on public.construction_material_issues). Without a register
--   of returns the derivation cannot net them off, and a movement alone would be
--   untraceable to a project.
--
-- WHY IT IS APPEND-ONLY WITH NO TOKEN
--   Mirrors construction_material_issues: a posted return is a fact. A mistake is
--   corrected by a new opposite record, never by editing or deleting this one.
--   The trigger is registered with an empty token list, so not even a command in
--   this repository may update or delete a row.
--
-- SCOPE: one table, its constraints and indexes, one catalogue row, its RLS
-- policy and trigger. No change to any existing table, policy, grant or function.
-- ============================================================================

-- ── 1. The register ─────────────────────────────────────────────────────────
-- Every scope column is DERIVED from the source issue by the command; none of
-- them is ever supplied by a client. They are stored so that the register is
-- self-describing for reporting and for the cumulative-return check, and so that
-- a future branch-scope or netting query needs no join.

create table if not exists public.construction_material_returns (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  -- The issue that put the material into the project. Required: an untraceable
  -- return is refused by the command, so the column can be NOT NULL.
  source_issue_id    uuid not null references public.construction_material_issues(id),
  site_id            uuid not null references public.construction_procurement_sites(id),
  branch_id          uuid not null references public.branches(id),
  location_id        uuid not null references public.inventory_locations(id),
  project_ref        text not null,
  product_id         uuid not null references public.products(id),
  uom                text not null,
  quantity           numeric not null,
  quantity_base      numeric not null,
  -- The source issue's recorded unit cost. Read from the issue, never supplied.
  unit_cost_base     numeric not null,
  total_cost_base    numeric not null,
  currency           text not null,
  return_date        date not null,
  -- Controlled condition vocabulary: the material is returned for re-use.
  condition          text not null,
  reason             text not null,
  evidence_reference text not null,
  received_by        text,
  stock_movement_id  uuid not null references public.stock_movements(id),
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  notes              text,
  client_key         uuid not null,
  constraint chk_cmr_quantity   check (quantity > 0 and quantity_base > 0),
  constraint chk_cmr_cost       check (unit_cost_base > 0 and total_cost_base > 0),
  constraint chk_cmr_condition  check (condition in ('usable', 'usable_with_restriction')),
  constraint chk_cmr_uom        check (length(btrim(uom)) > 0),
  constraint chk_cmr_reason     check (public._ledgr_construction_reason_present(reason)),
  constraint chk_cmr_evidence   check (public._ledgr_construction_reason_present(evidence_reference)),
  constraint chk_cmr_project    check (public._ledgr_construction_reason_present(project_ref)),
  constraint chk_cmr_unique_client unique (business_id, client_key)
);

-- The cumulative-return check reads this filter: every existing return for one
-- source issue, inside one business.
create index if not exists idx_cmr_source_issue
  on public.construction_material_returns (business_id, source_issue_id);
-- The register view lists a business's returns newest first.
create index if not exists idx_cmr_business_date
  on public.construction_material_returns (business_id, return_date desc);
-- The project-cost netting groups returns by project.
create index if not exists idx_cmr_project
  on public.construction_material_returns (business_id, project_ref);

comment on table public.construction_material_returns is
  'Append-only register of usable material returned from a construction site to the store it was issued from. Valued at the source issue''s recorded unit cost; project material cost is netted against these rows. No GL entry is written and the row is immutable: a correction is a new opposite record.';

comment on column public.construction_material_returns.quantity_base is
  'Derived from the source issue''s recorded conversion ratio (quantity * issue.quantity_base / issue.quantity), never from the mutable construction_product_uom_conversions table.';

comment on column public.construction_material_returns.condition is
  'usable | usable_with_restriction. A damaged-but-present material is outside Phase 1 and has no vocabulary here.';

-- ── 2. The capability ───────────────────────────────────────────────────────
-- Required BEFORE any grant can reference it: construction_procurement_grants
-- .capability is a foreign key to this catalogue, and
-- grant_construction_procurement_capability refuses an unknown code (22023).

insert into public.construction_procurement_capabilities (code, description) values
  ('procurement.material.return', 'Return usable material from a construction site to the store it was issued from, at the original issue''s recorded cost.')
on conflict (code) do update set description = excluded.description;

-- ── 3. RLS and privileges — member read, branch-scoped, no write path ────────
-- Same shape as the fifteen branch-scoped construction tables in
-- 20261023000000_construction_branch_scope.sql: revoke everything from anon and
-- authenticated, grant SELECT back, expose exactly one read policy carrying
-- can_access_branch. No INSERT/UPDATE/DELETE policy exists for authenticated, so
-- a direct PostgREST write is denied twice over: no privilege and no policy.

alter table public.construction_material_returns enable row level security;

drop policy if exists construction_material_returns_member_read on public.construction_material_returns;

revoke all on public.construction_material_returns from anon, authenticated;
grant select on public.construction_material_returns to authenticated;

create policy construction_material_returns_member_read
  on public.construction_material_returns for select to authenticated
  using (
    public.is_business_member(business_id)
    and public.can_access_branch(business_id, branch_id)
  );

-- ── 4. Append-only guard ────────────────────────────────────────────────────
-- Empty token list: no transaction-local marker authorises an UPDATE or DELETE,
-- exactly as construction_material_issues has none. A privileged out-of-band
-- writer is blocked as well as the authenticated role.

drop trigger if exists trg_construction_append_only on public.construction_material_returns;
create trigger trg_construction_append_only
  before update or delete on public.construction_material_returns
  for each row execute function public._ledgr_construction_append_only('');

-- ── 5. Self-verification ────────────────────────────────────────────────────
-- The Stage A verification block (20261023000000, section 7) enumerates a closed
-- set of fifteen tables and therefore cannot cover a table added later; this file
-- verifies its own objects. Any failure raises and rolls the whole file back, so
-- the replayed schema can never silently keep a weaker read policy.

do $verify$
declare
  v_missing text := '';
  v_qual    text;
  v_token   text;
begin
  if not exists (
    select 1 from pg_class c
     where c.oid = 'public.construction_material_returns'::regclass
       and c.relrowsecurity
  ) then
    v_missing := v_missing || 'row level security is not enabled; ';
  end if;

  select pg_get_expr(polqual, polrelid) into v_qual
    from pg_policy
   where polrelid = 'public.construction_material_returns'::regclass
     and polname = 'construction_material_returns_member_read';
  if v_qual is null then
    v_missing := v_missing || 'the member read policy is missing; ';
  elsif v_qual not like '%is_business_member%' or v_qual not like '%can_access_branch%' then
    v_missing := v_missing || 'the member read policy carries no business/branch predicate; ';
  end if;

  -- Privileges: authenticated may read, and nobody but the owner may write.
  if not coalesce(has_table_privilege('authenticated', 'public.construction_material_returns', 'select'), false) then
    v_missing := v_missing || 'authenticated cannot select; ';
  end if;
  if coalesce(has_table_privilege('authenticated', 'public.construction_material_returns', 'insert'), false)
     or coalesce(has_table_privilege('authenticated', 'public.construction_material_returns', 'update'), false)
     or coalesce(has_table_privilege('authenticated', 'public.construction_material_returns', 'delete'), false) then
    v_missing := v_missing || 'authenticated holds a write privilege; ';
  end if;
  if coalesce(has_table_privilege('anon', 'public.construction_material_returns', 'select'), false) then
    v_missing := v_missing || 'anon holds a privilege; ';
  end if;

  -- Append-only: the trigger must exist and must authorise NO token.
  select tgargs::text into v_token
    from pg_trigger
   where tgrelid = 'public.construction_material_returns'::regclass
     and tgname = 'trg_construction_append_only';
  if v_token is null then
    v_missing := v_missing || 'the append-only trigger is missing; ';
  end if;

  -- The capability the command authorises on must be in the catalogue.
  if not exists (
    select 1 from public.construction_procurement_capabilities c
     where c.code = 'procurement.material.return'
  ) then
    v_missing := v_missing || 'the material.return capability is not in the catalogue; ';
  end if;

  -- The command migration consumes this label, so prove the enum ordering held.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'stock_movement_type' and e.enumlabel = 'construction_return_in'
  ) then
    v_missing := v_missing || 'stock_movement_type has no construction_return_in label; ';
  end if;

  if v_missing <> '' then
    raise exception 'Construction material returns register not applied correctly: %', v_missing
      using errcode = '42501';
  end if;
end
$verify$;
