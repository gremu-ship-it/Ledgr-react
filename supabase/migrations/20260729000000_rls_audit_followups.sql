-- ============================================================================
-- Close the remaining findings from scripts/audit-role-rls.sql
--
-- Sections 1 and 1b of that audit (stale role lists / the user_has_role
-- ladder) were fixed by 20260728000008 and 20260728000009. Sections 2, 3 and 4
-- were left reported but unfixed. This migration closes them:
--
--   Section 3  business-scoped tables with RLS switched OFF   -> cross-tenant
--   Section 4  views running with owner rights                -> RLS bypassed
--   Section 2  tables with RLS on and no policy at all        -> classified,
--                                                                not silently
--                                                                "fixed"
--
-- Sections 3 and 4 are the same class of defect as the ones already fixed —
-- the database not enforcing what the application assumes — but they fail in
-- the opposite, more dangerous direction. A stale role list denies a legitimate
-- write and someone files a bug. A table with RLS disabled or a view with owner
-- rights returns other tenants' rows and nobody notices, because the only thing
-- scoping the result is a client-supplied `.eq('business_id', …)` filter that
-- any authenticated user can edit in the browser console.
--
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--  1. Puts RLS on invoice_delivery_events and recurring_invoices, the two
--     business-scoped tables the repo demonstrably ships without it
--     (20260725000001 created them and never enabled RLS).
--  2. Puts RLS on api_usage — no business_id, so the audit never flagged it,
--     but it is a bare table holding rate-limit buckets keyed by API key.
--  3. Sweeps up any OTHER business-scoped table that still has RLS disabled,
--     including ones created directly on the database and therefore invisible
--     to this repo, and gives it the standard tier policies.
--  4. Flips every remaining `v_%` view in public to security_invoker, except
--     the one view that deliberately keeps owner rights.
--  5. Ships public.audit_rls_gaps() so the checks are a query, not a document
--     someone has to remember to paste into the SQL editor.
--
-- Policies reuse the capability helpers from 20260728000008 /
-- 20260728000009 (is_business_member, can_write_business_data,
-- can_admin_business_data, can_view_payroll, can_write_payroll). No new role
-- list is introduced here — that was the original defect.
--
-- Idempotent. Touches no data.
-- ============================================================================


-- ── 0. Preconditions ─────────────────────────────────────────────────────────
-- `alter view … set (security_invoker = …)` is Postgres 15+. Supabase has been
-- on 15 since 2023, but fail with a readable message rather than a syntax
-- error if this is ever run against something older.

do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'This migration needs PostgreSQL 15+ for ALTER VIEW ... SET (security_invoker). Server is %.',
      current_setting('server_version');
  end if;

  if to_regprocedure('public.is_business_member(uuid)') is null
     or to_regprocedure('public.can_write_business_data(uuid)') is null
     or to_regprocedure('public.can_admin_business_data(uuid)') is null then
    raise exception
      'Capability helpers missing. Run 20260728000008_role_aware_master_data_rls.sql first.';
  end if;
end
$$;


-- ── 1. invoice_delivery_events — read-only to members, written by the ────────
--       service role
--
-- 20260725000001 created this table with `business_id uuid not null` and no
-- `enable row level security`. Every invoice send / open / reminder for every
-- tenant has been readable, insertable and deletable by any authenticated user
-- since. It is the delivery audit trail for invoices: who was sent what, when
-- they opened it, which dunning stage they are at.
--
-- Only the send-invoice, invoice-open and process-invoice-automation Edge
-- Functions write it, all with the service role key, which bypasses RLS. So
-- clients get read access and nothing else — the narrowest grant that keeps
-- every existing code path working. An `insert` policy would only widen the
-- surface for no caller.

alter table public.invoice_delivery_events enable row level security;

drop policy if exists invoice_delivery_events_member_read         on public.invoice_delivery_events;
drop policy if exists invoice_delivery_events_platform_admin_read on public.invoice_delivery_events;

create policy invoice_delivery_events_member_read
  on public.invoice_delivery_events
  for select using (public.is_business_member(business_id));

create policy invoice_delivery_events_platform_admin_read
  on public.invoice_delivery_events
  for select using (public.is_platform_admin(auth.uid()));

revoke all    on public.invoice_delivery_events from anon;
revoke all    on public.invoice_delivery_events from authenticated;
grant  select on public.invoice_delivery_events to   authenticated;

comment on table public.invoice_delivery_events is
  'Append-only delivery/opened/reminder audit trail per invoice. RLS: read = any active member of the owning business (plus platform admins). No client write policy — the send-invoice, invoice-open and process-invoice-automation Edge Functions write it with the service role, which bypasses RLS. Shipped without RLS by 20260725000001; enabled in 20260729000000.';


-- ── 2. recurring_invoices — writable by the canWrite tier ────────────────────
-- Same origin, same defect. Unlike the delivery log this is configuration a
-- user is expected to manage (which template, how often, auto-send yes/no), so
-- it gets the full tier set rather than read-only. No UI reads it yet; the
-- policies are written for the UI that will.
--
-- auto_send means a row here causes mail to leave the system on a schedule, so
-- hard delete stays owner/admin like every other admin-tier table.

alter table public.recurring_invoices enable row level security;

drop policy if exists recurring_invoices_member_read         on public.recurring_invoices;
drop policy if exists recurring_invoices_writer_insert       on public.recurring_invoices;
drop policy if exists recurring_invoices_writer_update       on public.recurring_invoices;
drop policy if exists recurring_invoices_admin_delete        on public.recurring_invoices;
drop policy if exists recurring_invoices_platform_admin_read on public.recurring_invoices;

create policy recurring_invoices_member_read
  on public.recurring_invoices
  for select using (public.is_business_member(business_id));

create policy recurring_invoices_writer_insert
  on public.recurring_invoices
  for insert with check (public.can_write_business_data(business_id));

create policy recurring_invoices_writer_update
  on public.recurring_invoices
  for update using      (public.can_write_business_data(business_id))
             with check (public.can_write_business_data(business_id));

create policy recurring_invoices_admin_delete
  on public.recurring_invoices
  for delete using (public.can_admin_business_data(business_id));

create policy recurring_invoices_platform_admin_read
  on public.recurring_invoices
  for select using (public.is_platform_admin(auth.uid()));

revoke all on public.recurring_invoices from anon;
grant select, insert, update, delete on public.recurring_invoices to authenticated;

comment on table public.recurring_invoices is
  'Recurring invoice schedules, consumed by the process-invoice-automation cron. RLS: read = any active member; insert/update = roles with canWrite; hard delete = owner/admin. Shipped without RLS by 20260725000001; enabled in 20260729000000.';


-- ── 3. api_usage — service role only ─────────────────────────────────────────
-- Not caught by the audit: it has no business_id, so section 3 skips it, and
-- RLS was never enabled, so section 2 skips it too. It is still a public table
-- that any authenticated user could read or write. Its rows are rate-limit
-- counters keyed by `api_key` (an API key hash, or `ip:<addr>`), so writes are
-- the real exposure: anyone could pre-fill a competitor's bucket to 100 and
-- lock their integration out for the minute, or delete their own to lift the
-- limit entirely.
--
-- The only writer is the api Edge Function, which uses the service role key.
-- RLS on with zero policies is therefore the correct end state: deny every
-- client, allow the service role. audit_rls_gaps() lists this table as
-- intentionally policy-less so it does not read as a finding later.

alter table public.api_usage enable row level security;

revoke all on public.api_usage from anon, authenticated;

comment on table public.api_usage is
  'Fixed-window rate-limit counters for the public API, keyed by api_key hash or ip:<addr>. RLS is enabled with NO policies on purpose: the api Edge Function is the only writer and uses the service role, which bypasses RLS. Any client-visible policy here would let a caller manipulate another key''s rate limit.';


-- ── 4. Sweep: every other business-scoped table with RLS still off ───────────
-- Most of this schema predates supabase/migrations/, so the repo cannot say
-- which tables have RLS. This loop asks the catalog instead and applies the
-- standard tier policies to anything business-scoped that is still open.
--
-- Deliberate limits:
--
--   • NOT NULL business_id only. If the column is nullable, rows with a NULL
--     business_id would become invisible to every client the moment RLS comes
--     on (all the tier helpers return false for NULL), which could break a
--     working feature silently. Those tables get a WARNING naming them instead
--     — a human has to decide what a NULL tenant means there.
--
--   • Payroll tables get can_view_payroll / can_write_payroll, not the general
--     tier, for the reason spelled out in 20260728000009: the generic member
--     tier would expose salaries to all 19 roles.
--
--   • Only tables where RLS is currently DISABLED are touched. A table that
--     already has RLS on has policies that someone reasoned about, and
--     overwriting them from a blind loop is how the next incident starts.
--
-- Adds no policy that the four master-data tables in 20260728000008 do not
-- already have, so a table swept up here behaves exactly like contacts.

do $$
declare
  r               record;
  is_payroll      boolean;
  swept           text[] := '{}';
  skipped_nullable text[] := '{}';
  payroll_tables  constant text[] := array[
    'employees', 'employee_allowances', 'employee_deductions',
    'payroll_runs', 'payroll_employee_lines'
  ];
begin
  for r in
    select
      c.relname                          as table_name,
      col.is_nullable = 'NO'             as business_id_required
    from pg_class c
    join pg_namespace n  on n.oid = c.relnamespace
    join information_schema.columns col
      on col.table_schema = 'public'
     and col.table_name   = c.relname
     and col.column_name  = 'business_id'
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by c.relname
  loop
    if not r.business_id_required then
      skipped_nullable := skipped_nullable || r.table_name;
      continue;
    end if;

    is_payroll := r.table_name = any(payroll_tables);

    execute format('alter table public.%I enable row level security', r.table_name);

    -- Read.
    execute format('drop policy if exists %I on public.%I', r.table_name || '_member_read', r.table_name);
    execute format(
      'create policy %I on public.%I for select using (%s(business_id))',
      r.table_name || '_member_read',
      r.table_name,
      case when is_payroll then 'public.can_view_payroll' else 'public.is_business_member' end
    );

    -- Insert.
    execute format('drop policy if exists %I on public.%I', r.table_name || '_writer_insert', r.table_name);
    execute format(
      'create policy %I on public.%I for insert with check (%s(business_id))',
      r.table_name || '_writer_insert',
      r.table_name,
      case when is_payroll then 'public.can_write_payroll' else 'public.can_write_business_data' end
    );

    -- Update. WITH CHECK repeats the predicate so a row cannot be moved into a
    -- business the caller cannot write to. All specifiers are positional here
    -- because the predicate appears twice — mixing %I with %1$s would silently
    -- renumber the arguments.
    execute format('drop policy if exists %I on public.%I', r.table_name || '_writer_update', r.table_name);
    execute format(
      'create policy %1$I on public.%2$I for update using (%3$s(business_id)) with check (%3$s(business_id))',
      r.table_name || '_writer_update',
      r.table_name,
      case when is_payroll then 'public.can_write_payroll' else 'public.can_write_business_data' end
    );

    -- Hard delete stays owner/admin everywhere.
    execute format('drop policy if exists %I on public.%I', r.table_name || '_admin_delete', r.table_name);
    execute format(
      'create policy %I on public.%I for delete using (public.can_admin_business_data(business_id))',
      r.table_name || '_admin_delete',
      r.table_name
    );

    -- Platform staff keep read access for support.
    execute format('drop policy if exists %I on public.%I', r.table_name || '_platform_admin_read', r.table_name);
    execute format(
      'create policy %I on public.%I for select using (public.is_platform_admin(auth.uid()))',
      r.table_name || '_platform_admin_read',
      r.table_name
    );

    execute format('revoke all on public.%I from anon', r.table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.table_name);

    swept := swept || r.table_name;
  end loop;

  if cardinality(swept) > 0 then
    raise notice 'RLS enabled with tier policies on: %', array_to_string(swept, ', ');
  else
    raise notice 'No business-scoped tables were left with RLS disabled.';
  end if;

  if cardinality(skipped_nullable) > 0 then
    raise warning
      'Left alone (business_id is NULLABLE, so enabling RLS would hide NULL-tenant rows from all clients): %. Decide what a NULL business_id means on each, then enable RLS explicitly.',
      array_to_string(skipped_nullable, ', ');
  end if;
end
$$;


-- ── 5. Views: stop running with owner rights ─────────────────────────────────
-- A view without security_invoker executes as its owner (postgres), so RLS on
-- the tables it reads does not apply. v_cash_flow (20260726000000) and
-- v_inventory_ledger_variance (20260728000007) were already fixed one at a
-- time; the reporting views that predate this migrations folder —
-- v_trial_balance, v_ar_ageing, v_asset_register, v_reorder_alerts — were not,
-- and each is read by a repository that scopes it with a caller-supplied
-- `.eq('business_id', …)`:
--
--   IncomeRepository.findTrialBalance      -> v_trial_balance
--   ContactRepository.getArAgeing          -> v_ar_ageing
--   AssetRepository.findAssetRegister      -> v_asset_register
--   InventoryRepository.findReorderAlerts  -> v_reorder_alerts
--
-- Swap the UUID in that filter and you get another tenant's trial balance,
-- debtor ageing, asset register or stock position. This is the same leak that
-- 20260727000008 found in v_partner_client_usage.
--
-- Invoker rights are the right fix for all four: every base table they read
-- (accounts, journal_lines, journal_entries, invoices, contacts, fixed_assets,
-- inventory_balances, products, inventory_locations) is already readable by any
-- active member through the tier policies, and the repositories above query
-- those same tables directly elsewhere. So the numbers a caller sees for their
-- own business are unchanged; other tenants' rows disappear.
--
-- Done as a catalog sweep rather than a list, because the point of the audit
-- finding is that the repo does not know every view that exists. ALTER VIEW
-- only sets the reloption — it never touches the view body, so a view defined
-- outside migrations keeps its definition.
--
-- ORDER MATTERS: this section must run AFTER section 4.
-- security_invoker only isolates a view to the extent its base tables have RLS.
-- Flipping v_trial_balance while `accounts` still had RLS disabled would look
-- like a fix and change nothing. Section 4 turns RLS on for every
-- business-scoped table first, so by the time these views become
-- invoker-rights there is a policy underneath them to enforce. Verified both
-- ways against a real Postgres: with the base tables unprotected the
-- cross-tenant read still succeeds after the flip.
--
-- THE ONE EXCEPTION
-- -----------------
-- v_partner_client_usage must KEEP owner rights: it counts journal_entries and
-- invoices for businesses a partner admin deliberately cannot read, so under
-- invoker rights the counts would silently become 0 instead of erroring. Its
-- tenant check lives inside the view body (is_partner_admin, see
-- 20260727000008). Anything added to this list needs the same treatment —
-- an in-body guard — or it is simply a leak.

do $$
declare
  v                 record;
  flipped           text[] := '{}';
  intentional_owner constant text[] := array['v_partner_client_usage'];
begin
  for v in
    select c.relname as view_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and coalesce(
            (select option_value
               from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker'),
            'false'
          ) <> 'true'
      and not (c.relname = any(intentional_owner))
    order by c.relname
  loop
    -- Only the reloption is changed. Existing grants are left exactly as they
    -- are: a blanket `grant select ... to authenticated` here would widen
    -- access to any view that was deliberately not granted, which is the
    -- opposite of the point. anon is revoked because a signed-out caller has
    -- no business reading a reporting view, and under invoker rights it would
    -- see nothing anyway.
    execute format('alter view public.%I set (security_invoker = true)', v.view_name);
    execute format('revoke all on public.%I from anon', v.view_name);
    flipped := flipped || v.view_name;
  end loop;

  if cardinality(flipped) > 0 then
    raise notice 'security_invoker enabled on: %', array_to_string(flipped, ', ');
  else
    raise notice 'No owner-rights views remained.';
  end if;
end
$$;

comment on view public.v_trial_balance is
  'Per-account debit/credit totals and balance. security_invoker = true, so RLS on accounts / journal_lines / journal_entries applies and a caller only ever sees their own businesses. The business_id filter in IncomeRepository.findTrialBalance is a convenience, not the security boundary.';

comment on view public.v_ar_ageing is
  'Outstanding sales invoices bucketed by days overdue. security_invoker = true, so RLS on invoices / contacts applies — the business_id filter in ContactRepository.getArAgeing is not the security boundary.';

comment on view public.v_asset_register is
  'Fixed asset register with net book value. security_invoker = true, so RLS on fixed_assets and its lookups applies — the business_id filter in AssetRepository.findAssetRegister is not the security boundary.';

comment on view public.v_reorder_alerts is
  'Products at or below reorder level with estimated reorder cost. security_invoker = true, so RLS on inventory_balances / products / inventory_locations applies — the business_id filter in InventoryRepository.findReorderAlerts is not the security boundary.';


-- ── 6. Make the audit a query instead of a ritual ────────────────────────────
-- scripts/audit-role-rls.sql only helps if someone remembers to paste it in.
-- This returns the same three structural findings as one result set, with the
-- known-intentional cases classified rather than reported, so a non-empty
-- 'review'/'critical' result is always something to act on.
--
--   select * from public.audit_rls_gaps() where severity <> 'ok';
--
-- Reads only catalog tables. Service role / SQL editor only — it enumerates
-- the security posture of the whole schema, which is not something to hand to
-- an application session.

create or replace function public.audit_rls_gaps()
returns table (
  category    text,
  object_name text,
  detail      text,
  severity    text
)
language sql
stable
set search_path = public
as $$
  with intentionally_policyless as (
    -- RLS on, no policy, by design: written only by Edge Functions holding the
    -- service role key, which bypasses RLS. A client-visible policy on any of
    -- these would widen access, not restore it.
    select unnest(array[
      'subscription_reminders_sent',
      'api_usage'
    ]) as table_name
  ),
  intentional_owner_views as (
    -- Owner rights on purpose; tenant check is inside the view body.
    select unnest(array['v_partner_client_usage']) as view_name
  ),
  findings as (

    -- 1. RLS enabled, zero policies: denies every non-superuser.
    select
      'rls_enabled_no_policy'::text as f_category,
      c.relname::text               as f_object,
      case
        when i.table_name is not null
          then 'Service-role only by design — no client policy expected.'
        else 'RLS on with no policy: every client read and write is denied silently.'
      end                           as f_detail,
      case when i.table_name is not null then 'ok' else 'review' end as f_severity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join intentionally_policyless i on i.table_name = c.relname
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )

    union all

    -- 2. business_id present, RLS off: cross-tenant read AND write.
    select
      'business_table_rls_disabled'::text,
      c.relname::text,
      'Has business_id but RLS is disabled — any authenticated user can read and write every tenant''s rows.',
      'critical'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name   = c.relname
          and col.column_name  = 'business_id'
      )

    union all

    -- 3. Views with owner rights: RLS on the base tables does not apply.
    select
      'view_owner_rights'::text,
      c.relname::text,
      case
        when o.view_name is not null
          then 'Owner rights on purpose — tenant check is in the view body (is_partner_admin).'
        else 'No security_invoker: runs as owner, so RLS on the underlying tables is bypassed. Only safe if the view body enforces the tenant check itself.'
      end,
      case when o.view_name is not null then 'ok' else 'review' end
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join intentional_owner_views o on o.view_name = c.relname
    where n.nspname = 'public'
      and c.relkind = 'v'
      and coalesce(
            (select option_value
               from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker'),
            'false'
          ) <> 'true'
  )

  -- Columns are aliased f_* inside the CTE and renamed here: a `language sql`
  -- function's RETURNS TABLE names are in scope in its own body, so a bare
  -- `category` would be an ambiguous reference against the OUT parameter.
  -- Ordering also has to happen outside the UNION, which may only be ordered
  -- by an output name or ordinal, not by an expression over one.
  select
    f_category  as category,
    f_object    as object_name,
    f_detail    as detail,
    f_severity  as severity
  from findings
  order by
    case f_severity when 'critical' then 0 when 'review' then 1 else 2 end,
    f_category,
    f_object;
$$;

comment on function public.audit_rls_gaps() is
  'Structural RLS audit: policy-less tables, business-scoped tables with RLS disabled, and owner-rights views. Known-intentional cases are returned with severity ''ok''. Run `select * from public.audit_rls_gaps() where severity <> ''ok''` — a non-empty result is a finding. Service role only. The prose version, with the reasoning, is scripts/audit-role-rls.sql.';

revoke all on function public.audit_rls_gaps() from public;
grant execute on function public.audit_rls_gaps() to service_role;


-- ── 7. Verify ────────────────────────────────────────────────────────────────
-- Hard-fails on the two tables this file names explicitly, so a partial run
-- cannot look like a success. Remaining findings elsewhere are raised as
-- warnings, not exceptions: this migration runs against databases whose prior
-- state the repo cannot see, and aborting on a nullable-business_id table
-- somebody has to think about would just block the fixes above from landing.

do $$
declare
  t          text;
  n_policies integer;
  rls_on     boolean;
  gap        record;
  n_findings integer := 0;
begin
  foreach t in array array['invoice_delivery_events', 'recurring_invoices'] loop
    select c.relrowsecurity into rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t;

    if not coalesce(rls_on, false) then
      raise exception 'RLS is still disabled on public.% after this migration.', t;
    end if;

    select count(*) into n_policies
    from pg_policies
    where schemaname = 'public' and tablename = t;

    if n_policies = 0 then
      raise exception 'public.% has RLS on but no policies — that denies all client access.', t;
    end if;
  end loop;

  for gap in select * from public.audit_rls_gaps() where severity <> 'ok' loop
    n_findings := n_findings + 1;
    raise warning 'RLS audit [%] %: %', gap.severity, gap.object_name, gap.detail;
  end loop;

  if n_findings = 0 then
    raise notice 'audit_rls_gaps(): clean.';
  else
    raise warning
      'audit_rls_gaps() still reports % finding(s) — see the warnings above. Re-run: select * from public.audit_rls_gaps() where severity <> ''ok'';',
      n_findings;
  end if;
end
$$;
