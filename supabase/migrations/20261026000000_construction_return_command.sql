-- ============================================================================
-- 20261026000000_construction_return_command.sql
--
-- Phase 1 of the construction returns design: the usable-material return command,
-- and the project-cost derivation that nets returns off.
--
--   design:   docs/architecture/CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md
--   decision: docs/audits/LEDGR_CONSTRUCTION_RETURNS_PHASE1_OWNER_DECISION_2026-10-16.md
--   plan:     docs/architecture/CONSTRUCTION_RETURNS_PHASE1_IMPLEMENTATION_PLAN_2026-10-16.md
--
-- WHAT THIS FILE ADDS
--   1. public.return_construction_materials_to_store(jsonb, uuid) — one return,
--      one inbound stock movement, one append-only register row, no journal.
--   2. public.construction_project_material_cost(uuid) re-created with the SAME
--      signature: returns are netted off quantity and cost, issue_count stays the
--      count of issue records.
--
-- SCOPE BOUNDARIES (approved and enforced here)
--   * No GL posting. gl_posting_enabled must still be false; the movement writes
--     no journal entry, exactly like the issue command.
--   * No wastage, damage, NRV, supplier return or cross-site movement: this
--     command writes to the source issue's own location and nowhere else.
--   * No approval tier. The dedicated procurement.material.return capability is
--     the whole authority check (owner decision 7).
--
-- EVERYTHING IS DERIVED, NOTHING IS TRUSTED
--   site, branch, location, project, product, unit of measure, the original unit
--   cost and the base quantity all come from the source issue row, which is locked
--   FOR UPDATE for the whole command. A payload that supplies any of them is
--   refused (22023) rather than ignored, so a forged scope value cannot even be
--   attempted silently.
--
-- WHY THE LOCK ORDER IS SAFE
--   1. capability/actor check (no lock),
--   2. advisory lock on (business, source_type, client_key) — the same fence the
--      general inventory command uses, so two identical requests serialise before
--      either reads the register,
--   3. FOR UPDATE on the source issue row — so two different partial returns
--      against the same issue cannot both pass the cumulative bound,
--   4. the shared R06 balance writer locks the destination balance row.
--   Lock order is always issue-row → balance-row, never the reverse, matching the
--   issue command's order.
--
-- IDEMPOTENCY
--   The replay check runs under the advisory lock and before any bound check, and
--   returns the committed row with idempotent:true. The movement additionally
--   carries the client_key, which activates the existing
--   stock_movements_client_key_uidx (business_id, client_key) as a real second
--   fence — it is inert for construction writes today because no other
--   construction command passes a key on its movement.
-- ============================================================================

-- ── 1. The return command ───────────────────────────────────────────────────

create or replace function public.return_construction_materials_to_store(
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
  v_issue    public.construction_material_issues%rowtype;
  v_policy   public.construction_receipt_posting_policies%rowtype;
  v_qty      numeric;
  v_base     numeric;
  v_ratio    numeric;
  v_returned numeric;
  v_date     date;
  v_condition text;
  v_total    numeric;
  v_return_id uuid := gen_random_uuid();
  v_movement uuid;
  v_existing uuid;
  v_forbidden text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A return payload is required.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required for this command.' using errcode = '22023';
  end if;

  v_business := public._ledgr_construction_uuid(p_payload->>'business_id', 'The business');
  v_actor    := public._ledgr_construction_actor(v_business, 'procurement.material.return');

  -- Serialise on the request identity before reading the register. hashtextextended
  -- is the fence used by record_inventory_journal_movement; the construction
  -- document commands use a business-scoped lock instead. This command is keyed, so
  -- a duplicate request blocks here until the first commits and is then replayed.
  perform pg_advisory_xact_lock(
    hashtextextended(v_business::text || '|construction_return|' || p_client_key::text, 0));

  select r.id into v_existing from public.construction_material_returns r
   where r.business_id = v_business and r.client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'idempotent', true,
                              'stock_effect', 'none', 'journal_effect', 'none');
  end if;

  -- Derived scope is not merely ignored when supplied: it is refused, so a caller
  -- cannot believe it chose a site, a location, a cost or a project.
  foreach v_forbidden in array array['site_id', 'branch_id', 'location_id', 'project_ref',
                                     'product_id', 'uom', 'unit_cost_base', 'total_cost_base',
                                     'currency'] loop
    if p_payload ? v_forbidden then
      raise exception 'derived-field-not-accepted: % is derived from the source issue and must not be supplied.', v_forbidden
        using errcode = '22023';
    end if;
  end loop;

  -- A return must name the issue it came from. Material that cannot be traced is
  -- refused outright rather than absorbed at an invented cost (design section 9.6).
  if nullif(btrim(coalesce(p_payload->>'source_issue_id', '')), '') is null then
    raise exception 'traceable-to-issue-required: a return must name the material issue the quantity came from.'
      using errcode = '22023';
  end if;

  -- The source issue is the authority for scope, product, unit, quantity ratio and
  -- the original unit cost. Locked FOR UPDATE so the cumulative bound below cannot
  -- be raced by a concurrent partial return against the same issue.
  select * into v_issue
    from public.construction_material_issues i
   where i.id = public._ledgr_construction_uuid(p_payload->>'source_issue_id', 'The source issue')
     and i.business_id = v_business
   for update;
  if not found then
    raise exception 'The source issue does not belong to this business.' using errcode = '42501';
  end if;

  if not public.can_access_branch(v_business, v_issue.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_business, v_issue.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  -- Quantity in the issue's own unit of measure. Any other unit would need a
  -- conversion that may have changed since the issue, so it is refused outright.
  if p_payload ? 'quantity_uom'
     and upper(btrim(coalesce(p_payload->>'quantity_uom', ''))) <> upper(btrim(v_issue.uom)) then
    raise exception 'uom-mismatch: a return must be expressed in the issue''s unit of measure (%).', v_issue.uom
      using errcode = '22023';
  end if;
  begin
    v_qty := (p_payload->>'quantity')::numeric;
  exception when others then
    raise exception 'The returned quantity must be a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then
    raise exception 'The returned quantity must be greater than zero.' using errcode = '22023';
  end if;

  -- Base quantity from the issue's RECORDED conversion ratio. The mutable,
  -- non-effective-dated conversion table is deliberately not consulted: the factor
  -- may have changed since the issue, and the relief must match what was charged.
  if v_issue.quantity <= 0 or v_issue.quantity_base <= 0 then
    raise exception 'issue-quantity-unknown: the source issue has no usable recorded quantity.' using errcode = '22023';
  end if;
  v_ratio := v_issue.quantity_base / v_issue.quantity;
  v_base  := round(v_qty * v_ratio, 6);
  if v_base <= 0 then
    raise exception 'The returned base quantity is not greater than zero.' using errcode = '22023';
  end if;

  -- Cumulative bound: everything previously returned for this issue, plus this
  -- return, may never exceed what was issued.
  select coalesce(sum(r.quantity_base), 0) into v_returned
    from public.construction_material_returns r
   where r.business_id = v_business and r.source_issue_id = v_issue.id;
  if v_returned + v_base > v_issue.quantity_base + 0.000001 then
    -- plpgsql RAISE takes bare % placeholders only: a printf precision such as
    -- '%.6f' is emitted literally (it would read '2.000000.6f'), so the six-decimal
    -- text is built with to_char instead.
    raise exception 'over-return: % base units were issued to this project and % base units have already been returned, so only % remain returnable.',
      to_char(v_issue.quantity_base, 'FM9999999999999990.000000'),
      to_char(v_returned, 'FM9999999999999990.000000'),
      to_char(v_issue.quantity_base - v_returned, 'FM9999999999999990.000000')
      using errcode = '22023';
  end if;

  -- Same boundary as the issue command: an approved movement policy must exist, and
  -- GL posting must still be disabled.
  select * into v_policy from public.construction_receipt_posting_policies where business_id = v_business;
  if not found or not v_policy.movement_posting_enabled then
    raise exception 'return-posting-not-approved: material returns have no approved movement policy for this business.'
      using errcode = '22023';
  end if;
  if v_policy.gl_posting_enabled then
    raise exception 'return-gl-posting-not-approved: GL posting from a material return is not approved.' using errcode = '22023';
  end if;

  v_date := public._ledgr_construction_date(p_payload->>'return_date', 'The return date');
  if v_date < v_issue.issue_date then
    raise exception 'return-date-before-issue: the return (%) cannot precede the issue (%).', v_date, v_issue.issue_date
      using errcode = '22023';
  end if;
  perform public._ledgr_assert_period_open(v_business, v_date, 'Material return');

  v_condition := lower(btrim(coalesce(p_payload->>'condition', '')));
  if v_condition not in ('usable', 'usable_with_restriction') then
    raise exception 'return-condition-invalid: the material condition must be usable or usable_with_restriction.'
      using errcode = '22023';
  end if;

  v_total := round(v_issue.unit_cost_base * v_base, 6);

  -- One inbound movement through the single shared writer. quantity is positive and
  -- unit_cost is the ORIGINAL issue cost, so the pool's weighted average re-prices
  -- by design (owner decision 2). No journal entry is written.
  insert into public.stock_movements
    (business_id, product_id, location_id, movement_type, movement_date, quantity,
     unit_cost, source_type, source_id, reference, created_by, notes, client_key)
  values (v_business, v_issue.product_id, v_issue.location_id, 'construction_return_in', v_date, v_base,
          v_issue.unit_cost_base, 'construction_return', v_return_id, v_issue.project_ref,
          v_actor,
          'Usable material returned to store from ' || v_issue.project_ref || ' (issue ' || v_issue.id || ')',
          p_client_key)
  returning id into v_movement;

  insert into public.construction_material_returns
    (id, business_id, source_issue_id, site_id, branch_id, location_id, project_ref, product_id, uom,
     quantity, quantity_base, unit_cost_base, total_cost_base, currency, return_date, condition,
     reason, evidence_reference, received_by, stock_movement_id, created_by, notes, client_key)
  values (v_return_id, v_business, v_issue.id, v_issue.site_id, v_issue.branch_id, v_issue.location_id,
          v_issue.project_ref, v_issue.product_id, v_issue.uom, v_qty, v_base, v_issue.unit_cost_base,
          v_total, v_issue.currency, v_date, v_condition,
          public._ledgr_construction_text(p_payload->>'reason', 'The return reason'),
          public._ledgr_construction_text(p_payload->>'evidence_reference', 'The return evidence reference'),
          nullif(btrim(coalesce(p_payload->>'received_by', '')), ''),
          v_movement, v_actor, nullif(btrim(coalesce(p_payload->>'notes', '')), ''), p_client_key);

  return jsonb_build_object(
    'id', v_return_id, 'idempotent', false, 'source_issue_id', v_issue.id,
    'project_ref', v_issue.project_ref, 'quantity', v_qty, 'quantity_base', v_base,
    'unit_cost_base', v_issue.unit_cost_base, 'total_cost_base', v_total,
    'currency', v_issue.currency, 'stock_movement_id', v_movement,
    'stock_effect', 'inbound', 'journal_effect', 'none');
end;
$$;

comment on function public.return_construction_materials_to_store(jsonb, uuid) is
  'Phase 1 usable-material return: records material going back to the store it was issued from, at the source issue''s recorded unit cost, and nets it off that project''s derived material cost. Exactly one construction_return_in stock movement, one append-only register row and no journal entry. Scope, product, unit cost and base quantity are all derived from the locked source issue; a payload that supplies them is refused.';

-- ── 2. Project material cost nets returns off — SAME signature ──────────────
-- The parameter list and the returned column list are unchanged, so no caller,
-- generated type or PostgREST shape changes. issue_count stays the count of ISSUE
-- records (it is not a combined document count). quantity_base and material_cost
-- become issued-minus-returned, and the branch predicate is applied to BOTH arms
-- so a return cannot reveal a project the caller cannot otherwise reach.
--
-- Rounding: each arm sums the stored values (already rounded at write time by the
-- issue and return commands), and the difference is rounded to the same 6 places the
-- register stores, so a full return of a single issue nets to exactly zero cost.

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
  if not public.is_business_member(p_business_id) then
    raise exception 'You are not an active member of this business.' using errcode = '42501';
  end if;

  return query
    with issued as (
      select i.project_ref,
             count(*)::bigint                    as issue_count,
             coalesce(sum(i.quantity_base), 0)   as quantity_base,
             coalesce(sum(i.total_cost_base), 0) as material_cost,
             min(i.currency)                     as currency,
             min(i.issue_date)                   as first_issue_date,
             max(i.issue_date)                   as last_issue_date
        from public.construction_material_issues i
       where i.business_id = p_business_id
         -- Branch scope: material issues carry branch_id NOT NULL.
         and public.can_access_branch(i.business_id, i.branch_id)
       group by i.project_ref
    ),
    returned as (
      select r.project_ref,
             coalesce(sum(r.quantity_base), 0)   as quantity_base,
             coalesce(sum(r.total_cost_base), 0) as material_cost
        from public.construction_material_returns r
       where r.business_id = p_business_id
         -- Same branch scope on the return arm.
         and public.can_access_branch(r.business_id, r.branch_id)
       group by r.project_ref
    )
    select i.project_ref,
           i.issue_count,
           round(i.quantity_base - coalesce(r.quantity_base, 0), 6),
           round(i.material_cost - coalesce(r.material_cost, 0), 6),
           i.currency,
           i.first_issue_date,
           i.last_issue_date
      from issued i
      left join returned r on r.project_ref = i.project_ref
     order by i.project_ref;
end;
$$;

comment on function public.construction_project_material_cost(uuid) is
  'Project material cost derived from the append-only issue register, net of usable-material returns recorded in construction_material_returns. issue_count is the count of issue records only. Signature unchanged by the Phase 1 returns work.';

-- ── 3. Privileges ───────────────────────────────────────────────────────────
-- The command authorises internally (auth.uid + active membership + the
-- procurement.material.return capability), so authenticated may execute it; the
-- private helpers stay unreachable. service_role keeps the operator path.

revoke all on function public.return_construction_materials_to_store(jsonb, uuid) from public, anon;
grant execute on function public.return_construction_materials_to_store(jsonb, uuid) to authenticated, service_role;

revoke all on function public.construction_project_material_cost(uuid) from public, anon;
grant execute on function public.construction_project_material_cost(uuid) to authenticated, service_role;

-- ── 4. Self-verification ────────────────────────────────────────────────────
-- Fail the migration rather than ship a command that is unreachable, a derivation
-- that lost its netting, or a signature that drifted.

do $verify$
declare
  v_missing text := '';
  v_args    text;
begin
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.return_construction_materials_to_store(jsonb, uuid)'::regprocedure
       and p.prosecdef
       and pg_get_function_result(p.oid) = 'jsonb'
  ) then
    v_missing := v_missing || 'the return command is missing or is not security definer; ';
  end if;

  if not coalesce(has_function_privilege('authenticated',
        'public.return_construction_materials_to_store(jsonb, uuid)', 'execute'), false) then
    v_missing := v_missing || 'authenticated cannot execute the return command; ';
  end if;
  if coalesce(has_function_privilege('anon',
        'public.return_construction_materials_to_store(jsonb, uuid)', 'execute'), false) then
    v_missing := v_missing || 'anon can execute the return command; ';
  end if;

  -- The project-cost function must keep its exact signature: one uuid argument and
  -- the seven documented output columns in order.
  select pg_get_function_arguments(p.oid) into v_args
    from pg_proc p where p.oid = 'public.construction_project_material_cost(uuid)'::regprocedure;
  if v_args is null or v_args <> 'p_business_id uuid' then
    v_missing := v_missing || format('construction_project_material_cost changed signature (%s); ', coalesce(v_args, 'missing'));
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.construction_project_material_cost(uuid)'::regprocedure
       and pg_get_functiondef(p.oid) like '%issue_count%'
       and pg_get_functiondef(p.oid) like '%material_cost%'
       and pg_get_functiondef(p.oid) like '%construction_material_returns%'
       and pg_get_functiondef(p.oid) like '%can_access_branch%'
  ) then
    v_missing := v_missing || 'the project-cost derivation lost its return netting or its branch scope; ';
  end if;

  if coalesce(has_function_privilege('anon',
        'public.construction_project_material_cost(uuid)', 'execute'), false) then
    v_missing := v_missing || 'anon can execute the project-cost derivation; ';
  end if;

  if v_missing <> '' then
    raise exception 'Construction return command not applied correctly: %', v_missing
      using errcode = '42501';
  end if;
end
$verify$;
