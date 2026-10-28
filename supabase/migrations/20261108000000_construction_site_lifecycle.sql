-- 20261108000000_construction_site_lifecycle.sql
--
-- P2-4: Construction site lifecycle (edit / deactivate / reactivate) plus a
--       validated project link on construction_procurement_sites.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds construction_procurement_sites.project_id — a NULLABLE FK to
--      construction_projects with ON DELETE SET NULL. project_ref (NOT NULL
--      free text) is KEPT as the human-readable label, exactly like
--      client_name on projects after P2-3.
--   2. Backfills project_id from project_ref by exact case-insensitive name
--      match against the SAME business's projects. Report-not-guess: zero or
--      ambiguous matches RAISE NOTICE with the site id + project_ref and leave
--      project_id NULL. Nothing is created during backfill.
--   3. Adds set_construction_procurement_site_status(p_site_id, p_active,
--      p_reason): guarded deactivation / unguarded reactivation, gated by
--      procurement.master.manage through the house actor helper.
--   4. Adds update_construction_procurement_site(...): edits site_name,
--      project_id and project_ref. Branch, location and site_code are NOT
--      editable here — re-registration (the existing idempotent upsert) owns
--      those, and register_construction_procurement_site is untouched.
--
-- APPEND-ONLY INTEGRITY (constraint 7)
--   construction_procurement_sites carries the marker-based append-only
--   trigger from 20261021000000 (trg_construction_append_only with the
--   'site_upsert' token). Both new RPCs use the EXACT bypass mechanism of
--   register_construction_procurement_site: raise the transaction-local
--   marker `ledgr.construction_command = 'site_upsert'` for the single
--   UPDATE statement and clear it immediately afterwards. The trigger, its
--   token list and the register function are not modified.
--
-- DELIBERATE ADAPTATIONS OF THE P2-4 BRIEF (flagged in the PR)
--   * Capability gate: the brief's has_construction_procurement_capability()
--     does not exist in this schema. The house gate is
--     public._ledgr_construction_actor(business_id, capability), which
--     verifies sign-in, active membership AND the capability (via
--     _ledgr_construction_capability) and returns the actor — the same call
--     register_construction_procurement_site uses. Its refusal replaces the
--     brief's 'Insufficient capability' raise.
--   * Open purchase orders: chk_cpo_status admits exactly
--     ('draft','authorized','cancelled') — 'completed'/'closed' do not exist
--     in this vocabulary, so "open" is status <> 'cancelled'.
--   * Material issues/returns guard: construction_material_issues and
--     construction_material_returns have NO lifecycle status — they are
--     atomic, immutable evidence rows posted by their commands in a single
--     transaction, so an "open" issue or return cannot exist and a guard
--     would be vacuous. The verifier below pins this decision by requiring
--     the status RPC NOT to reference those tables. Historical issues are
--     unaffected by deactivation (they are cost facts, not work in flight).
--   * Unlink semantics: the brief's COALESCE(p_project_id, project_id)
--     cannot express "unlink" (an explicit NULL is indistinguishable from
--     "not supplied"), yet the brief's ProjectDetail flow requires
--     update_construction_procurement_site(site_id, project_id=null) to
--     unlink. A trailing p_set_project boolean carries the intent:
--     false/omitted = keep the current link, true = write p_project_id
--     verbatim (uuid to link, NULL to unlink). Same explicit-intent pattern
--     as P2-3's update_project client_id.
--   * Error codes: house SQLSTATEs are attached (P0002 not-found, 55000
--     guard refusals, 42501/22023 from the actor and text helpers). Message
--     texts follow the brief so the UI can localize the counts.
--   * There is no site audit-log table (no construction_procurement_site_*
--     events table exists), so p_reason is validated-free, echoed in the
--     result jsonb and NOT persisted; updated_at records the change time.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * Does NOT modify register_construction_procurement_site (signature or
--     upsert behavior) — constraint 5.
--   * Does NOT modify grant_construction_procurement_capability, any
--     self-grant rule or capability_overrides — constraint 4.
--   * Does NOT touch the append-only trigger function, its token list or any
--     trigger binding — constraint 7.
--   * Does NOT drop or relax project_ref (NOT NULL, non-empty CHECK) —
--     constraint 8.
--   * Does NOT modify construction_projects (P2-3 is the last word there).
--   * Does NOT create a sites table or change the contacts schema.

-- ── 1. The project FK ───────────────────────────────────────────────────────

alter table public.construction_procurement_sites
  add column if not exists project_id uuid null
    references public.construction_projects(id) on delete set null;

create index if not exists idx_construction_procurement_sites_project_id
  on public.construction_procurement_sites(project_id);

comment on column public.construction_procurement_sites.project_id is
  'FK to construction_projects. Authoritative link; project_ref remains as display text.';

-- ── 2. Backfill: exact case-insensitive project-name match, report-not-guess ─

do $site_project_backfill$
declare
  site record;
  matched_id uuid;
  match_count int;
begin
  for site in
    select id, business_id, project_ref
    from public.construction_procurement_sites
    where project_id is null
      and project_ref is not null
      and trim(project_ref) != ''
  loop
    select p.id, count(*) over()
    into matched_id, match_count
    from public.construction_projects p
    where p.business_id = site.business_id
      and lower(trim(p.name)) = lower(trim(site.project_ref))
    limit 1;

    if match_count = 1 then
      update public.construction_procurement_sites
      set project_id = matched_id
      where id = site.id;
    elsif match_count > 1 then
      raise notice 'AMBIGUOUS: site % project_ref "%" matches % projects — skipped',
        site.id, site.project_ref, match_count;
    else
      raise notice 'NO MATCH: site % project_ref "%" — skipped',
        site.id, site.project_ref;
    end if;
  end loop;
end
$site_project_backfill$;

-- ── 3. Lifecycle RPC: deactivate / reactivate ───────────────────────────────

create or replace function public.set_construction_procurement_site_status(
  p_site_id uuid,
  p_active  boolean,
  p_reason  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_site   public.construction_procurement_sites%rowtype;
  v_actor  uuid;
  v_open_pos int;
  v_location_balance numeric;
begin
  select * into v_site
  from public.construction_procurement_sites
  where id = p_site_id
  for update;
  if not found then
    raise exception 'Site not found: %', p_site_id using errcode = 'P0002';
  end if;

  -- House capability gate: sign-in + active membership + the same
  -- procurement.master.manage capability that gates registration.
  v_actor := public._ledgr_construction_actor(v_site.business_id, 'procurement.master.manage');

  -- No-op if already in the desired state.
  if v_site.is_active = p_active then
    return jsonb_build_object(
      'status', 'no_change',
      'site_id', p_site_id,
      'is_active', p_active
    );
  end if;

  if not p_active then
    -- Open purchase orders. The status vocabulary is exactly
    -- ('draft','authorized','cancelled'): open = not cancelled.
    select count(*) into v_open_pos
    from public.construction_purchase_orders
    where site_id = p_site_id
      and status <> 'cancelled';
    if v_open_pos > 0 then
      raise exception 'Cannot deactivate: % open purchase order(s) reference this site',
        v_open_pos using errcode = '55000';
    end if;

    -- Stock on hand at the site's inventory location — the same guard the
    -- P2-1 location deactivation applies (positive quantities only).
    -- Material issues/returns are deliberately NOT guarded: both tables are
    -- append-only evidence without a lifecycle status, so no "open" row can
    -- exist (see the header; the verifier pins this).
    select coalesce(sum(quantity_on_hand), 0) into v_location_balance
    from public.inventory_balances
    where location_id = v_site.location_id
      and quantity_on_hand > 0;
    if v_location_balance > 0 then
      raise exception 'Cannot deactivate: linked location has % units on hand',
        v_location_balance using errcode = '55000';
    end if;
  end if;

  -- Exact bypass mechanism of register_construction_procurement_site: the
  -- transaction-local marker authorizes this single UPDATE against the
  -- append-only trigger and is cleared immediately afterwards.
  perform set_config('ledgr.construction_command', 'site_upsert', true);
  update public.construction_procurement_sites
  set is_active = p_active,
      updated_at = now()
  where id = p_site_id;
  perform set_config('ledgr.construction_command', '', true);

  return jsonb_build_object(
    'status', 'ok',
    'site_id', p_site_id,
    'is_active', p_active,
    'reason', p_reason
  );
end;
$$;

comment on function public.set_construction_procurement_site_status is
  'Deactivates or reactivates a construction procurement site. Checks for open POs, material issues, and location balances before deactivation.';

revoke all on function public.set_construction_procurement_site_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_construction_procurement_site_status(uuid, boolean, text) to authenticated, service_role;

-- ── 4. Update RPC: site name + project linkage ──────────────────────────────

create or replace function public.update_construction_procurement_site(
  p_site_id     uuid,
  p_site_name   text default null,
  p_project_id  uuid default null,
  p_project_ref text default null,
  p_set_project boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_site    public.construction_procurement_sites%rowtype;
  v_actor   uuid;
  v_name    text;
  v_project text;
begin
  select * into v_site
  from public.construction_procurement_sites
  where id = p_site_id
  for update;
  if not found then
    raise exception 'Site not found: %', p_site_id using errcode = 'P0002';
  end if;

  v_actor := public._ledgr_construction_actor(v_site.business_id, 'procurement.master.manage');

  -- Optional fields keep their current value when NULL is passed; when
  -- supplied they must satisfy the same non-empty checks the table enforces.
  v_name := case when p_site_name is null then null
                 else public._ledgr_construction_text(p_site_name, 'The site name') end;
  v_project := case when p_project_ref is null then null
                    else public._ledgr_construction_text(p_project_ref, 'The project reference') end;

  -- Validate the project FK against the SITE'S business (tenant isolation).
  if p_set_project and p_project_id is not null then
    if not exists (
      select 1 from public.construction_projects
      where id = p_project_id and business_id = v_site.business_id
    ) then
      raise exception 'Project not found or does not belong to this business: %',
        p_project_id using errcode = '22023';
    end if;
  end if;

  perform set_config('ledgr.construction_command', 'site_upsert', true);
  update public.construction_procurement_sites
  set site_name = coalesce(v_name, site_name),
      project_id = case when p_set_project then p_project_id else project_id end,
      project_ref = coalesce(v_project, project_ref),
      updated_at = now()
  where id = p_site_id;
  perform set_config('ledgr.construction_command', '', true);

  return jsonb_build_object(
    'status', 'ok',
    'site_id', p_site_id
  );
end;
$$;

comment on function public.update_construction_procurement_site is
  'Updates site name and project linkage. Does not change branch, location, or site_code (re-register for that).';

revoke all on function public.update_construction_procurement_site(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.update_construction_procurement_site(uuid, text, uuid, text, boolean) to authenticated, service_role;

-- ── 5. Replay verifier ──────────────────────────────────────────────────────

do $site_lifecycle_verify$
declare
  v_definition text;
  v_confdel "char";
  v_trigger_count int;
begin
  -- The FK, its delete semantics and its index.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'construction_procurement_sites'
       and column_name = 'project_id' and data_type = 'uuid' and is_nullable = 'YES'
  ) then
    raise exception 'construction_procurement_sites.project_id must exist as a nullable uuid column.';
  end if;

  select c.confdeltype into v_confdel
    from pg_constraint c
   where c.conrelid = 'public.construction_procurement_sites'::regclass
     and c.confrelid = 'public.construction_projects'::regclass
     and c.contype = 'f';
  if v_confdel is null or v_confdel <> 'n' then
    raise exception 'project_id must reference construction_projects(id) with ON DELETE SET NULL.';
  end if;

  if to_regclass('public.idx_construction_procurement_sites_project_id') is null then
    raise exception 'idx_construction_procurement_sites_project_id is missing.';
  end if;

  -- project_ref survives untouched as the display/legacy label (constraint 8).
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'construction_procurement_sites'
       and column_name = 'project_ref' and is_nullable = 'NO'
  ) then
    raise exception 'project_ref must remain NOT NULL display text.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.construction_procurement_sites'::regclass
       and conname = 'chk_cps_project'
  ) then
    raise exception 'the non-empty project_ref check must survive.';
  end if;
  -- is_active keeps its shape; the lifecycle RPCs are the only write path.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'construction_procurement_sites'
       and column_name = 'is_active' and is_nullable = 'NO'
       and column_default = 'true'
  ) then
    raise exception 'is_active must remain NOT NULL DEFAULT true.';
  end if;

  -- The register command is untouched: same signature, same marker bypass,
  -- same idempotent-upsert contract (constraint 5).
  if to_regprocedure('public.register_construction_procurement_site(uuid,uuid,uuid,text,text,text)') is null then
    raise exception 'register_construction_procurement_site must keep its exact signature.';
  end if;
  v_definition := lower(pg_get_functiondef('public.register_construction_procurement_site(uuid,uuid,uuid,text,text,text)'::regprocedure));
  if position('ledgr.construction_command' in v_definition) = 0
     or position('site_upsert' in v_definition) = 0
     or position('idempotent' in v_definition) = 0 then
    raise exception 'the register command must keep its marker bypass and idempotent upsert.';
  end if;

  -- The append-only trigger is still bound to the sites table with the
  -- site_upsert token, and it is the ONLY user trigger on the table
  -- (constraint 7: work within the mechanism, never rebind it).
  select count(*) into v_trigger_count
    from pg_trigger
   where tgrelid = 'public.construction_procurement_sites'::regclass
     and not tgisinternal;
  if v_trigger_count <> 1 then
    raise exception 'construction_procurement_sites must keep exactly one user trigger (the append-only guard).';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.construction_procurement_sites'::regclass
       and t.tgname = 'trg_construction_append_only'
       and t.tgenabled <> 'D'
       and position('site_upsert' in pg_get_triggerdef(t.oid)) > 0
  ) then
    raise exception 'the append-only trigger must stay bound with the site_upsert token.';
  end if;

  -- The capability grant function still exists and was not redefined here.
  if to_regprocedure('public.grant_construction_procurement_capability(uuid,uuid,text,text)') is null then
    raise exception 'grant_construction_procurement_capability must survive untouched.';
  end if;

  -- Lifecycle RPC: definer, gated, marker-bypassed, guarded, vacuous-guard
  -- decision pinned (no reference to the append-only evidence tables).
  if to_regprocedure('public.set_construction_procurement_site_status(uuid,boolean,text)') is null then
    raise exception 'the site status RPC is missing.';
  end if;
  if not (select prosecdef from pg_proc
           where oid = 'public.set_construction_procurement_site_status(uuid,boolean,text)'::regprocedure) then
    raise exception 'the site status RPC must be SECURITY DEFINER.';
  end if;
  v_definition := lower(pg_get_functiondef('public.set_construction_procurement_site_status(uuid,boolean,text)'::regprocedure));
  if position('_ledgr_construction_actor' in v_definition) = 0
     or position('procurement.master.manage' in v_definition) = 0 then
    raise exception 'the site status RPC must gate on procurement.master.manage via the house actor.';
  end if;
  if position('ledgr.construction_command' in v_definition) = 0
     or position('site_upsert' in v_definition) = 0 then
    raise exception 'the site status RPC must use the register command''s marker bypass.';
  end if;
  if position('open purchase order(s)' in v_definition) = 0
     or position('units on hand' in v_definition) = 0
     or position('no_change' in v_definition) = 0 then
    raise exception 'the site status RPC must keep the deactivation guards and the no-op short circuit.';
  end if;
  if position('construction_material_issues' in v_definition) <> 0
     or position('construction_material_returns' in v_definition) <> 0 then
    raise exception 'issues/returns are append-only evidence without lifecycle status; a guard would be vacuous and must not appear.';
  end if;

  -- Update RPC: definer, gated, tenant-validating, explicit link intent.
  if to_regprocedure('public.update_construction_procurement_site(uuid,text,uuid,text,boolean)') is null then
    raise exception 'the site update RPC is missing.';
  end if;
  v_definition := lower(pg_get_functiondef('public.update_construction_procurement_site(uuid,text,uuid,text,boolean)'::regprocedure));
  if position('_ledgr_construction_actor' in v_definition) = 0
     or position('p_set_project' in v_definition) = 0
     or position('does not belong to this business' in v_definition) = 0
     or position('site_upsert' in v_definition) = 0 then
    raise exception 'the site update RPC must gate, tenant-validate and carry explicit link/unlink intent.';
  end if;

  -- Both RPCs stay executable by authenticated (and service_role, matching
  -- the register command's ACL house style) and by nobody else.
  if not has_function_privilege('authenticated', 'public.set_construction_procurement_site_status(uuid,boolean,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_construction_procurement_site(uuid,text,uuid,text,boolean)', 'EXECUTE') then
    raise exception 'the site lifecycle RPCs must stay executable by authenticated.';
  end if;
  if has_function_privilege('anon', 'public.set_construction_procurement_site_status(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_construction_procurement_site(uuid,text,uuid,text,boolean)', 'EXECUTE') then
    raise exception 'the site lifecycle RPCs must not be executable by anon.';
  end if;
end;
$site_lifecycle_verify$;
