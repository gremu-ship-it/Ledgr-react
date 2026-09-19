-- ============================================================================
-- One definition of "how many transactions has this business used this month".
--
-- Why: the plan limit is enforced in two places —
--
--   * `_ledgr_assert_usage_limit` (20260921000001), server-side, called by the
--     quick-save RPCs BEFORE they insert their document; and
--   * `UsageService.getCurrentMonthTransactionCount`, client-side, which drives
--     the usage meter, the 80%/100% warnings and the pre-write guard on the
--     till and the sync engine.
--
-- Both count documents (invoices + expenses + payroll runs dated in the
-- current month), but the client counted them with three count queries issued
-- as the signed-in user. Those queries are filtered by RLS, and `payroll_runs`
-- is NOT readable by every role (`can_view_payroll`: owner, admin, accountant,
-- payroll_manager — 20260728000009). So a manager or clerk who can write
-- invoices counted zero payroll runs, and a business sitting just under its
-- limit could be refused by the server while the meter still showed room.
--
-- This function is the single definition both sides can use: same tables, same
-- date column, same month boundary, evaluated with definer rights so RLS cannot
-- change the number. It returns NULL when the caller is not a member of the
-- business, so a signed-in user cannot read another business's usage; the
-- client falls back to its own (RLS-filtered) count in that case, and also when
-- this function does not exist yet (a deploy that ships the client first).
--
-- `stable`, not `volatile`: it only reads. `security definer` with a pinned
-- search_path, like the other helpers in this module.
-- ============================================================================

do $$
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.expenses') is null
     or to_regclass('public.payroll_runs') is null
     or to_regclass('public.business_users') is null then
    raise notice 'Core tables missing, skipping ledgr_monthly_document_count.';
    return;
  end if;

  if to_regprocedure('public.is_business_member(uuid)') is null then
    raise notice 'public.is_business_member(uuid) not found, skipping ledgr_monthly_document_count.';
    return;
  end if;

  execute $fn$
    create or replace function public.ledgr_monthly_document_count(
      p_business_id uuid
    ) returns bigint
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select case
        when not public.is_business_member(p_business_id) then null
        else (
            (select count(*) from public.invoices
              where business_id = p_business_id
                and issue_date   >= date_trunc('month', current_date)::date)
          + (select count(*) from public.expenses
              where business_id = p_business_id
                and expense_date >= date_trunc('month', current_date)::date)
          + (select count(*) from public.payroll_runs
              where business_id = p_business_id
                and pay_date     >= date_trunc('month', current_date)::date)
        )
      end;
    $body$;
  $fn$;

  execute 'comment on function public.ledgr_monthly_document_count(uuid) is '
       || quote_literal('Documents (invoices + expenses + payroll runs) dated this month, for the plan limit. Mirrors _ledgr_assert_usage_limit (migration 20260921000001); returns NULL for a non-member. See migration 20260921000002.');
end;
$$;

do $$
begin
  if to_regprocedure('public.ledgr_monthly_document_count(uuid)') is not null then
    execute 'grant execute on function public.ledgr_monthly_document_count(uuid) to authenticated';
  end if;
end;
$$;
