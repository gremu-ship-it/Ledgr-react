-- ============================================================================
-- 20261023000000_construction_branch_scope.sql
-- Stage A — construction read-surface branch scope (approved Option C)
--
-- WHAT THIS CHANGES
--   Only the SELECT policies of the construction read surface, and the branch
--   filtering inside the two construction read RPCs that aggregate across a
--   business. Nothing else: no table, column, grant, command, trigger or data
--   change, and no write policy change (there are none — direct DML is not
--   granted on these tables at all).
--
-- WHY
--   Every construction table was readable by any active member of the business
--   with no branch predicate, while every construction COMMAND already enforces
--   the branch through public.can_access_branch. Measured consequence before
--   this migration: a user assigned only to branch A1 could read branch A2's
--   purchase orders, their lines, the A2 goods-receipt note and the A2 site,
--   even though every action on them was refused with
--   '42501 You do not have access to that branch.' This migration makes the read
--   surface agree with the command surface.
--
-- TABLE CLASSIFICATION (verified against the replayed schema, not migration text)
--   14 unconditional branch-linked tables
--       4 carry branch_id NOT NULL themselves:
--         construction_procurement_sites, construction_purchase_orders,
--         construction_goods_receipt_notes, construction_material_issues
--      10 inherit a NOT NULL branch through a NOT NULL foreign-key chain:
--         _purchase_order_lines, _purchase_order_events, _delivery_notes,
--         _delivery_note_lines                       (-> purchase_orders.branch_id)
--         _goods_receipt_lines, _goods_receipt_holds, _receipt_inspections,
--         _receipt_line_reclassifications,
--         _receipt_bill_allocations, _receipt_cost_bases (-> receipt_notes.branch_id)
--    1 conditional table
--         construction_supplier_invoice_references -> expenses.branch_id, which is
--         NULLABLE. Rule (approved): the referenced expense must be in the same
--         business; a NULL branch parent is readable by any active member of that
--         business; a non-NULL branch parent requires branch access.
--    4 branchless tables (unchanged intent, re-asserted for a deterministic end state)
--         construction_procurement_capabilities  — global static catalogue
--         construction_procurement_grants        — grant assignments (tightened below)
--         construction_product_uom_conversions   — business master data
--         construction_receipt_posting_policies  — business policy
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * Command-side authorisation, four-eyes PO approval, the capability model,
--     the append-only guards and client_key idempotency. Every construction
--     command is SECURITY DEFINER, so its internal reads bypass these policies
--     and its own branch validation is untouched.
--   * Grants: authenticated keeps SELECT on read tables and EXECUTE on the same
--     functions; anon keeps nothing.
--   * The three read RPC signatures. Branch filtering is internal, so an
--     all-branch role (owner/admin/manager/accountant/auditor, per DEC-03)
--     still sees the whole business, and an assigned-scope role sees its branch.
--
-- Idempotent: safe to re-run; it drops only the policies it owns and recreates
-- them, and re-creates the two RPCs with create or replace (ACLs preserved).
-- Forward-only; no down migration.
-- ============================================================================

-- ── 1. The four tables that carry branch_id NOT NULL themselves ──────────────
do $direct$
declare
  t text;
begin
  foreach t in array array[
    'construction_procurement_sites',
    'construction_purchase_orders',
    'construction_goods_receipt_notes',
    'construction_material_issues'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (public.is_business_member(business_id) '
      '       and public.can_access_branch(business_id, branch_id))',
      t || '_member_read', t);
  end loop;
end
$direct$;

-- ── 2. One-hop inherited branch (parent is a branch-carrying table) ──────────
do $onehop$
declare
  t        text;
  v_parent text;
begin
  -- purchase order children -> construction_purchase_orders.branch_id
  foreach t in array array[
    'construction_purchase_order_lines',
    'construction_purchase_order_events',
    'construction_delivery_notes'
  ] loop
    v_parent := 'construction_purchase_orders';
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (public.is_business_member(business_id) '
      '       and exists (select 1 from public.%I p '
      '                    where p.id = public.%I.po_id '
      '                      and p.business_id = public.%I.business_id '
      '                      and public.can_access_branch(p.business_id, p.branch_id)))',
      t || '_member_read', t, v_parent, t, t);
  end loop;

  -- goods receipt notes are themselves branch-carrying, but their lines are not
  execute format('drop policy if exists %I on public.%I',
    'construction_goods_receipt_lines_member_read', 'construction_goods_receipt_lines');
  execute format(
    'create policy %I on public.%I for select to authenticated '
    'using (public.is_business_member(business_id) '
    '       and exists (select 1 from public.construction_goods_receipt_notes g '
    '                    where g.id = public.construction_goods_receipt_lines.grn_id '
    '                      and g.business_id = public.construction_goods_receipt_lines.business_id '
    '                      and public.can_access_branch(g.business_id, g.branch_id)))',
    'construction_goods_receipt_lines_member_read', 'construction_goods_receipt_lines');
end
$onehop$;

-- ── 3. Two-hop inherited branch (child -> line -> branch-carrying parent) ────
do $twohop$
declare
  t text;
begin
  foreach t in array array[
    'construction_goods_receipt_holds',
    'construction_receipt_inspections',
    'construction_receipt_line_reclassifications',
    'construction_receipt_bill_allocations',
    'construction_receipt_cost_bases'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (public.is_business_member(business_id) '
      '       and exists (select 1 '
      '                     from public.construction_goods_receipt_lines l '
      '                     join public.construction_goods_receipt_notes g on g.id = l.grn_id '
      '                    where l.id = public.%I.grn_line_id '
      '                      and l.business_id = public.%I.business_id '
      '                      and public.can_access_branch(g.business_id, g.branch_id)))',
      t || '_member_read', t, t, t);
  end loop;

  -- delivery note lines -> delivery note -> purchase order
  execute format('drop policy if exists %I on public.%I',
    'construction_delivery_note_lines_member_read', 'construction_delivery_note_lines');
  execute format(
    'create policy %I on public.%I for select to authenticated '
    'using (public.is_business_member(business_id) '
    '       and exists (select 1 '
    '                     from public.construction_delivery_notes d '
    '                     join public.construction_purchase_orders p on p.id = d.po_id '
    '                    where d.id = public.construction_delivery_note_lines.delivery_note_id '
    '                      and d.business_id = public.construction_delivery_note_lines.business_id '
    '                      and public.can_access_branch(p.business_id, p.branch_id)))',
    'construction_delivery_note_lines_member_read', 'construction_delivery_note_lines');
end
$twohop$;

-- ── 4. The conditional table: supplier invoice references ───────────────────
-- expenses.branch_id is nullable, so the parent cannot supply an unconditional
-- branch. The row is visible only when the referenced expense exists IN THE SAME
-- BUSINESS (fail closed if it does not), and then:
--   * NULL branch on the parent  -> any active member of that business may read it
--     (a bill with no branch is business-level, not another branch's document);
--   * a branch on the parent     -> can_access_branch decides, exactly as the
--     expense's own SELECT policy does.
-- The parent lookup goes through a SECURITY DEFINER helper rather than an inline
-- subquery, for the same reason can_access_location exists: a policy expression is
-- evaluated with the INVOKING role's privileges, and `authenticated` deliberately
-- holds no SELECT grant on public.expenses (there is no direct client read path for
-- it). An inline subquery therefore fails the whole read with 'permission denied for
-- table expenses' — found by CPB.SIR.*, not in review. The helper resolves the parent
-- branch without widening any grant, and shares can_access_branch's fail-closed
-- behaviour (b_user.branch_id must equal the requested branch for assigned-scope
-- roles, so a foreign or missing expense resolves to false).
create or replace function public.construction_supplier_reference_visible(
  p_business_id uuid,
  p_expense_id  uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.expenses e
     where e.id = p_expense_id
       and e.business_id = p_business_id
       and (
         e.branch_id is null
         or public.can_access_branch(e.business_id, e.branch_id)
       )
  );
$$;

comment on function public.construction_supplier_reference_visible(uuid, uuid) is
  'Branch rule for construction supplier invoice references: same-business parent required (fail closed otherwise); a NULL-branch parent bill is business-level, a branched one follows can_access_branch. SECURITY DEFINER so the caller needs no grant on expenses. Stage A 2026-10-16.';

revoke all on function public.construction_supplier_reference_visible(uuid, uuid) from public, anon;
grant execute on function public.construction_supplier_reference_visible(uuid, uuid) to authenticated, service_role;

drop policy if exists construction_supplier_invoice_references_member_read
  on public.construction_supplier_invoice_references;
create policy construction_supplier_invoice_references_member_read
  on public.construction_supplier_invoice_references for select to authenticated
  using (
    public.is_business_member(business_id)
    and public.construction_supplier_reference_visible(business_id, expense_id)
  );

-- ── 5. The four branchless tables ───────────────────────────────────────────
-- (a) Static capability vocabulary: no business_id column exists, so there is no
--     tenant to scope it by. It contains capability codes and descriptions only.
--     Kept readable by any signed-in caller, which is what the catalogue is for;
--     re-asserted here so the end state does not depend on migration history.
drop policy if exists construction_procurement_capabilities_read
  on public.construction_procurement_capabilities;
create policy construction_procurement_capabilities_read
  on public.construction_procurement_capabilities for select to authenticated
  using (true);

-- (b) Grant assignments ARE tenant data and were readable by every active member,
--     i.e. any member could enumerate who holds procurement.po.authorize. Now a
--     member sees their own grant rows, and only a capability administrator
--     (owner/admin, the same rule the grant/revoke commands enforce) sees all of
--     them. The administration workflow is unchanged: it goes through the
--     commands, and the setup screen reads the caller's own capabilities through
--     construction_procurement_capabilities_for.
drop policy if exists construction_procurement_grants_member_read
  on public.construction_procurement_grants;
create policy construction_procurement_grants_member_read
  on public.construction_procurement_grants for select to authenticated
  using (
    public.is_business_member(business_id)
    and (
      user_id = auth.uid()
      or public.can_admin_business_data(business_id)
    )
  );

-- (c) Business master data and (d) the posting policy are business properties with
--     no branch dimension. Kept business-scoped; re-asserted for determinism.
do $branchless$
declare
  t text;
begin
  foreach t in array array[
    'construction_product_uom_conversions',
    'construction_receipt_posting_policies'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (public.is_business_member(business_id))',
      t || '_member_read', t);
  end loop;
end
$branchless$;

-- ── 6. Branch-aware read RPCs ───────────────────────────────────────────────
-- Signatures are preserved. The filter is internal and uses the row's own branch,
-- so an all-branch role (DEC-03: owner, admin, manager, accountant, auditor) still
-- aggregates the whole business while an assigned-scope role sees only branches it
-- can reach. Cross-branch aggregation therefore requires explicit all-branch
-- authority, and nothing has to be passed in by the caller.
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
    select i.project_ref,
           count(*)::bigint,
           sum(i.quantity_base),
           sum(i.total_cost_base),
           min(i.currency),
           min(i.issue_date),
           max(i.issue_date)
      from public.construction_material_issues i
     where i.business_id = p_business_id
       -- Branch scope: material issues carry branch_id NOT NULL.
       and public.can_access_branch(i.business_id, i.branch_id)
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
    -- Business-level count of grants in force. A count of assignments, not the
    -- assignments themselves; the rows are governed by the grants policy above.
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
           and public.can_access_branch(g.business_id, g.branch_id)
         order by g.grn_number, l.line_number) x), '[]'::jsonb),
    -- Receipts with an accepted quantity that is not yet in stock.
    'awaiting_posting', coalesce((
      select jsonb_agg(x) from (
        select g.grn_number, l.line_number, l.accepted_base, l.quantity_posted_base
          from public.construction_goods_receipt_lines l
          join public.construction_goods_receipt_notes g on g.id = l.grn_id
         where l.business_id = p_business_id
           and l.accepted_base > l.quantity_posted_base
           and public.can_access_branch(g.business_id, g.branch_id)
         order by g.grn_number, l.line_number) x), '[]'::jsonb),
    -- Quality holds still open, with their age in days. Branch comes from the
    -- receipt note two hops away, so the join is explicit rather than implied.
    'open_holds', coalesce((
      select jsonb_agg(x) from (
        select h.hold_type, h.quantity, h.quantity_base, h.reason, h.evidence_reference,
               (current_date - h.created_at::date) as age_days
          from public.construction_goods_receipt_holds h
          join public.construction_goods_receipt_lines l on l.id = h.grn_line_id
          join public.construction_goods_receipt_notes g on g.id = l.grn_id
         where h.business_id = p_business_id and h.status = 'open'
           and public.can_access_branch(g.business_id, g.branch_id)
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
           and public.can_access_branch(g.business_id, g.branch_id)
         order by g.receipt_date) x), '[]'::jsonb),
    -- Bills that cannot be matched to a receipt because they already moved stock
    -- through the legacy purchase hook. expenses.branch_id is nullable, so the
    -- same rule as the supplier-invoice-reference policy applies: a bill with no
    -- branch is business-level, a billed branch requires branch access.
    'blocked_bills', coalesce((
      select jsonb_agg(x) from (
        select e.expense_number, e.reference,
               (select count(*) from public.stock_movements m
                 where m.business_id = e.business_id and m.source_type = 'expense' and m.source_id::text = e.id::text) as legacy_movements
          from public.expenses e
         where e.business_id = p_business_id and e.expense_type = 'bill' and e.deleted_at is null
           and (e.branch_id is null or public.can_access_branch(e.business_id, e.branch_id))
           and exists (select 1 from public.stock_movements m
                        where m.business_id = e.business_id and m.source_type = 'expense' and m.source_id::text = e.id::text)
         order by e.expense_number) x), '[]'::jsonb)
  );
end;
$$;

-- construction_procurement_capabilities_for is re-asserted unchanged, deliberately.
-- It returns ONLY the calling user's own live grants (`g.user_id = auth.uid()`), so
-- there is no other branch's row in its result to filter and no cross-branch
-- aggregate to authorise. Re-asserting it here keeps the documented end state
-- complete without inventing a filter that would change no output.
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

-- ── 7. Self-verification ────────────────────────────────────────────────────
-- If any of the fifteen policies does not end up carrying the branch predicate the
-- migration raises and the whole transaction rolls back, so the replayed schema can
-- never silently keep the old organisation-wide read.
do $verify$
declare
  t        text;
  v_qual   text;
  v_missing text := '';
begin
  foreach t in array array[
    'construction_procurement_sites',
    'construction_purchase_orders',
    'construction_goods_receipt_notes',
    'construction_material_issues',
    'construction_purchase_order_lines',
    'construction_purchase_order_events',
    'construction_delivery_notes',
    'construction_delivery_note_lines',
    'construction_goods_receipt_lines',
    'construction_goods_receipt_holds',
    'construction_receipt_inspections',
    'construction_receipt_line_reclassifications',
    'construction_receipt_bill_allocations',
    'construction_receipt_cost_bases',
    'construction_supplier_invoice_references'
  ] loop
    select pg_get_expr(polqual, polrelid) into v_qual
      from pg_policy
      where polrelid = format('public.%I', t)::regclass
        and polname = t || '_member_read';
    -- The fourteen branch-linked tables state the predicate directly; the
    -- conditional table delegates to the SECURITY DEFINER helper that resolves the
    -- parent bill's branch. Either evidence is acceptable; nothing else is.
    if v_qual is null
       or (v_qual not like '%can_access_branch%'
           and v_qual not like '%construction_supplier_reference_visible%') then
      v_missing := v_missing || t || ' ';
    end if;
  end loop;
  if v_missing <> '' then
    raise exception 'Construction branch scope not applied to: %', v_missing using errcode = '42501';
  end if;

  -- The catalogue must stay globally readable, and the two business-scoped
  -- branchless tables must not have gained a branch predicate.
  foreach t in array array['construction_product_uom_conversions', 'construction_receipt_posting_policies'] loop
    select pg_get_expr(polqual, polrelid) into v_qual
      from pg_policy where polrelid = format('public.%I', t)::regclass and polname = t || '_member_read';
    if v_qual is null or v_qual like '%can_access_branch%' then
      raise exception 'Branchless table % must stay business-scoped', t using errcode = '42501';
    end if;
  end loop;
end
$verify$;

comment on policy construction_supplier_invoice_references_member_read
  on public.construction_supplier_invoice_references is
  'Same-business membership plus the parent expense branch when the expense has one; a NULL-branch expense is business-level and readable by any active member. Approved Stage A rule 2026-10-16.';

comment on policy construction_procurement_grants_member_read
  on public.construction_procurement_grants is
  'A member sees their own grant rows; a capability administrator (owner/admin) sees all. Tenant isolation via is_business_member. Stage A 2026-10-16.';
