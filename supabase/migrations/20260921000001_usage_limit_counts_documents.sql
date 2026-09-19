-- ============================================================================
-- The plan's monthly limit counts TRANSACTIONS, not journal entries.
--
-- `_ledgr_assert_usage_limit` (20260911000001, restated in 20260919000000)
-- counted rows in public.journal_entries for the month. One till sale does not
-- write one journal entry — a paid sale writes a sale entry and an auto-receipt
-- (and a stocked sale adds a COGS entry), so a 200-transaction Starter plan ran
-- out after roughly 70 real sales, and the pricing page's "200 transactions"
-- meant something the product never actually sold.
--
-- A transaction is now one document: an invoice, an expense or a payroll run.
-- This matches `UsageService.getCurrentMonthTransactionCount` in
-- src/lib/billing/UsageService.ts, so both guards agree on the number.
--
-- The callers (save_quick_sale / save_quick_expense) already assert this BEFORE
-- inserting their own document, so the count never includes the row being
-- written — which is what keeps the limit exact rather than off by one.
--
-- Also restates the plan table with Starter (20260919000000) so this
-- function's replacement does not silently drop that tier.
-- ============================================================================

do $$
begin
  if to_regclass('public.journal_entries') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.expenses') is null
     or to_regclass('public.payroll_runs') is null then
    raise notice 'Core tables missing, skipping the usage-limit function update.';
    return;
  end if;

  execute $fn$
    create or replace function public._ledgr_assert_usage_limit(
      p_business_id uuid
    ) returns void
    language plpgsql
    volatile
    security definer
    set search_path = public
    as $body$
    declare
      v_limit integer;
      v_usage bigint := 0;
      v_month_start date := date_trunc('month', current_date)::date;
    begin
      select case coalesce(b.plan_tier, 'free')
               when 'free' then 50
               when 'starter' then 200
               when 'growth' then 500
               when 'pro' then 2000
               when 'enterprise' then null
               else 50                       -- normalizePlanTier: unknown -> free
             end
        into v_limit
        from public.businesses b
       where b.id = p_business_id;

      if v_limit is null then
        return;                              -- unlimited
      end if;

      -- One transaction = one document (invoice / expense / payroll run).
      select
          (select count(*) from public.invoices
            where business_id = p_business_id and issue_date   >= v_month_start)
        + (select count(*) from public.expenses
            where business_id = p_business_id and expense_date >= v_month_start)
        + (select count(*) from public.payroll_runs
            where business_id = p_business_id and pay_date     >= v_month_start)
        into v_usage;

      if v_usage >= v_limit then
        raise exception 'Monthly transaction limit reached (%). Please upgrade your plan.', v_limit
          using errcode = 'P0001';
      end if;
    end;
    $body$;
  $fn$;

  execute 'comment on function public._ledgr_assert_usage_limit(uuid) is '
       || quote_literal('Asserts the business is under its monthly transaction allowance. A transaction is one document (invoice, expense or payroll run) — see migration 20260921000001.');
end;
$$;
