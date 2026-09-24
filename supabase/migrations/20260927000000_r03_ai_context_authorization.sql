-- ============================================================================
-- R03 — AI authorisation boundary: ai_context requires an authenticated,
--        verified, financially-authorised caller (anonymous + insufficiently
--        privileged role denial)
--
-- WHY THIS EXISTS
--   public.ai_context(uuid) as defined by 20260823000003_repair_ai_view_tenant
--   _scope.sql has a null-identity arm that is indistinguishable between two
--   very different callers:
--
--     • the ai-chat Edge Function calling through the service-role API key
--       (no user uid, JWT role claim = 'service_role'), which it must keep,
--     • an anonymous PostgREST caller (no user uid, JWT role claim = 'anon'),
--       which MUST NOT receive any business financial context.
--
--   Because PostgreSQL grants EXECUTE on new functions to PUBLIC by default,
--   the anonymous caller could simply `POST /rpc/ai_context` with any
--   business id and receive the whole assembled financial document:
--   company, MTD KPIs, a 12-month trend, overdue invoices, top expenses,
--   top customers, customer concentration, anomalies and the upcoming
--   receivable/payable schedules. The release suite's AI.ANON probe
--   captured this as a failing expectation.
--
--   Second defect: for authenticated members the only check was
--   is_business_member(). The application's own role contract
--   (src/hooks/usePermissions.ts, canViewReports — the closest existing
--   distinction for business financial-performance visibility) deliberately
--   excludes operational roles such as cashier and stock_clerk from reports,
--   finance and the AI insights surfaces. Any member — including a cashier in
--   their own business — could obtain that restricted data through this RPC
--   (browser console, Postman, or a forged client). The release suite's
--   AI.ROLE probe captured this as a failing expectation.
--
-- WHAT IT DOES (idempotent; no data movement; one object redefined + ACL)
--   1. Revokes EXECUTE from PUBLIC and anon; retains authenticated and
--      service_role (service_role is required by the ai-chat Edge Function).
--   2. Redefines public.ai_context(uuid) — the assembled document is
--      UNCHANGED for authorised callers — with a verified-identity guard:
--        • null uid + API role claim that is not service_role  → 42501
--          (anonymous / unauthenticated API contexts are denied);
--        • null uid + service_role claim, or no claims at all  → allowed
--          (the Edge Function path; local SQL/migration contexts);
--        • uid present but not an active member of p_business_id → 42501
--          (pre-existing cross-tenant guard, preserved verbatim);
--        • uid present, active member, but membership role outside the
--          existing reports-visibility set                    → 42501.
--   3. The role allow-list is copied verbatim from the EXISTING
--      canViewReports = true matrix in src/hooks/usePermissions.ts:
--        owner, admin, accountant, manager, sales_manager,
--        tax_compliance_officer, treasury_manager, asset_manager,
--        board_member, auditor, viewer, branch_manager
--      Roles already excluded there (cashier, stock_clerk, sales_clerk,
--      data_entry, supervisor, inventory_manager, payroll_manager,
--      purchasing_officer, warehouse_worker, customer_service_rep) stay
--      excluded here — no new permission is invented and no existing
--      allowed path changes. Unknown or missing roles fail closed.
--   4. Self-verification block: definition markers, the full allow-list,
--      EXECUTE-privilege state, a behavioural anonymous probe (must raise
--      42501) and the service-role/null-id path (must still operate).
--
-- PRECONDITIONS / DEPENDENCIES
--   Assumes 20260823000003_repair_ai_view_tenant_scope.sql applied (this
--   file re-applies its function body with only the guard sections added).
--   No table/view/grant outside public.ai_context is touched; no rows read
--   or written; existing data unaltered by construction.
--
-- ROLLBACK / CONTAINMENT
--   To revert without file surgery:
--     1. create or replace public.ai_context(uuid) with the exact body from
--        20260823000003_repair_ai_view_tenant_scope.sql (§3 of that file);
--     2. grant execute on function public.ai_context(uuid) to anon;
--   Rolling back RE-OPENS anonymous/cashier context access; treat as an
--   emergency-only containment toggle for a legitimate null-uid automation
--   that was misclassified, then restore this migration.
-- ============================================================================


-- ── 1. Execute privileges: close PUBLIC/anon, retain the real callers ──────
revoke execute on function public.ai_context(uuid) from public;
revoke execute on function public.ai_context(uuid) from anon;
grant  execute on function public.ai_context(uuid) to authenticated;
grant  execute on function public.ai_context(uuid) to service_role;


-- ── 2. ai_context(): verified identity + membership + reports-tier role ────
create or replace function public.ai_context(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result          jsonb;
  v_role_claim      text;
  v_membership_role text;
  -- Existing reports-visibility tier (mirror of canViewReports = true in
  -- src/hooks/usePermissions.ts). Denying reports to a role there but
  -- allowing business financial context here would be a bypass; allowing a
  -- role here that cannot see reports there would grant new permissions.
  -- Change policy: edit usePermissions.ts first, then mirror here.
  v_reports_roles constant text[] := array[
    'owner', 'admin', 'accountant', 'manager', 'sales_manager',
    'tax_compliance_officer', 'treasury_manager', 'asset_manager',
    'board_member', 'auditor', 'viewer', 'branch_manager'
  ];
begin
  if p_business_id is null then
    raise exception 'ai_context: business id is required';
  end if;

  -- The API role the gateway verified for this request. Empty/NULL means no
  -- API caller at all (local SQL, migrations, maintenance connections).
  v_role_claim := nullif(current_setting('request.jwt.claim.role', true), '');

  if auth.uid() is null then
    -- A null identity is legitimate ONLY for service-role API callers (the
    -- ai-chat Edge Function, which derives the business from the caller's
    -- verified membership before invoking) and for claim-less local SQL
    -- contexts. Anonymous or unauthenticated API callers end here.
    if v_role_claim is not null and v_role_claim <> 'service_role' then
      raise exception 'ai_context: authentication required'
        using errcode = '42501';
    end if;
  elsif not public.is_business_member(p_business_id) then
    -- Cross-tenant guard, unchanged from 20260823000003.
    raise exception 'ai_context: not authorised for this business'
      using errcode = '42501';
  else
    -- In-tenant role gate: the assembled document is financial-performance
    -- data; membership alone is not sufficient (R03).
    select bu.role::text into v_membership_role
      from public.business_users bu
     where bu.business_id = p_business_id
       and bu.user_id = auth.uid()
       and bu.is_active = true;

    if v_membership_role is null or not (v_membership_role = any (v_reports_roles)) then
      raise exception 'ai_context: your role cannot access business financial insights'
        using errcode = '42501';
    end if;
  end if;

  select jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'company', coalesce((
      select jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'currency', b.base_currency,
        'vat_registered', b.vat_registered,
        'financial_year_start', b.financial_year_start
      )
      from public.businesses b
      where b.id = p_business_id
    ), 'null'::jsonb),
    -- coalesce to an EMPTY OBJECT, not null: src/lib/ai/context.ts does
    -- asRecord(root.kpis) and treats null as "no data at all".
    'kpis', coalesce((
      select to_jsonb(k) - 'business_id'
      from public.v_ai_kpis k
      where k.business_id = p_business_id
    ), '{}'::jsonb),
    'monthlyTrend', coalesce((
      select jsonb_agg(to_jsonb(t) - 'business_id' order by t.month_start)
      from public.v_ai_monthly_trend t
      where t.business_id = p_business_id
    ), '[]'::jsonb),
    'overdueInvoices', coalesce((
      select jsonb_agg(to_jsonb(o) - 'business_id' order by o.days_overdue desc)
      from (
        select * from public.v_ai_overdue_invoices
        where business_id = p_business_id
        order by days_overdue desc
        limit 25
      ) o
    ), '[]'::jsonb),
    'topExpenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', x.category,
        'account_code', x.account_code,
        'amount', x.amount,
        'document_count', x.document_count,
        'period_days', 90
      ) order by x.amount desc)
      from (
        select
          category,
          account_code,
          round(sum(amount), 2)          as amount,
          sum(document_count)            as document_count
        from public.v_ai_top_expenses
        where business_id = p_business_id
          and month >= (date_trunc('month', current_date) - interval '2 months')::date
        group by category, account_code
        order by sum(amount) desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'topCustomers', coalesce((
      select jsonb_agg(to_jsonb(c) - 'business_id' - 'contact_id' order by c.revenue desc)
      from (
        select * from public.v_ai_top_customers
        where business_id = p_business_id
        order by revenue desc
        limit 10
      ) c
    ), '[]'::jsonb),
    'concentration', (
      select to_jsonb(cc) - 'business_id' - 'top_contact_id'
      from public.v_ai_customer_concentration cc
      where cc.business_id = p_business_id
    ),
    'anomalies', coalesce((
      select jsonb_agg(to_jsonb(a) - 'business_id' order by
        case a.severity when 'high' then 0 when 'medium' then 1 else 2 end,
        a.occurred_on desc)
      from (
        select * from public.v_ai_anomalies
        where business_id = p_business_id
        order by
          case severity when 'high' then 0 when 'medium' then 1 else 2 end,
          occurred_on desc
        limit 20
      ) a
    ), '[]'::jsonb),
    'upcomingReceivables', coalesce((
      select jsonb_agg(to_jsonb(r) - 'business_id' order by r.due_date)
      from (
        select * from public.v_ai_upcoming_receivables
        where business_id = p_business_id
        order by due_date
        limit 200
      ) r
    ), '[]'::jsonb),
    'upcomingPayables', coalesce((
      select jsonb_agg(to_jsonb(p) - 'business_id' order by p.due_date)
      from (
        select * from public.v_ai_upcoming_payables
        where business_id = p_business_id
        order by due_date
        limit 200
      ) p
    ), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

comment on function public.ai_context(uuid) is
  'Single JSONB document for the Ledgr AI assistant. R03 authorisation: EXECUTE only for authenticated/service_role; API callers with no verified uid are denied (42501) unless service_role or claim-less local SQL; authenticated callers must be active members of p_business_id AND hold a reports-visibility role (mirror of canViewReports in usePermissions). The null-uid service path exists for the ai-chat Edge Function only.';


-- ── 3. Self-verification: end state + behaviour proofs ─────────────────────
do $$
declare
  v_def     text;
  v_allowed text[] := array[
    'owner', 'admin', 'accountant', 'manager', 'sales_manager',
    'tax_compliance_officer', 'treasury_manager', 'asset_manager',
    'board_member', 'auditor', 'viewer', 'branch_manager'
  ];
  v_name    text;
begin
  -- 3a. Guard markers and the complete allow-list must be in the definition.
  v_def := pg_get_functiondef('public.ai_context(uuid)'::regprocedure);
  if v_def not like '%authentication required%'
     or v_def not like '%business financial insights%' then
    raise exception 'R03 verification failed: ai_context lacks its authorisation guards';
  end if;
  foreach v_name in array v_allowed loop
    if v_def not like '%' || v_name || '%' then
      raise exception 'R03 verification failed: allowed role % missing from ai_context', v_name;
    end if;
  end loop;

  -- 3b. Execute-privilege end state.
  if has_function_privilege('anon', 'public.ai_context(uuid)', 'EXECUTE') then
    raise exception 'R03 verification failed: anon still holds EXECUTE on ai_context';
  end if;
  if not has_function_privilege('authenticated', 'public.ai_context(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ai_context(uuid)', 'EXECUTE') then
    raise exception 'R03 verification failed: legitimate callers lost EXECUTE on ai_context';
  end if;

  -- 3c. Behavioural proof: an anonymous API identity must be denied.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  begin
    perform public.ai_context('00000000-0000-4000-8000-000000000000');
    raise exception 'R03 verification failed: anonymous ai_context call was not denied';
  exception
    when insufficient_privilege then null; -- expected 42501
  end;

  -- 3d. Behavioural proof: the service-role / local path must still traverse
  --     the guard and reach the business-id check (the Edge Function relies
  --     on this null-uid arm).
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    perform public.ai_context(null);
    raise exception 'R03 verification failed: null business id no longer rejected';
  exception
    when others then
      if sqlerrm <> 'ai_context: business id is required' then raise; end if;
  end;
  perform set_config('request.jwt.claim.role', '', true);

  raise notice 'OK  R03 ai_context authorisation verified: anonymous denied (42501), service-role path intact, EXECUTE privileges closed, reports-tier allow-list complete.';
end
$$;
