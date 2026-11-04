-- The current standalone P&L page consumes get_trial_balance directly.
-- Preserve that RPC's ledger-complete semantics for trial balance and other
-- reports; expose a P&L-only view that subtracts both sides of linked reversals.
create or replace function public.get_profit_loss_trial_balance(
  p_business_id uuid,
  p_date_from date,
  p_date_to date,
  p_branch_id uuid default null
)
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  parent_account_id uuid,
  total_debit numeric,
  total_credit numeric,
  balance numeric,
  level integer
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'Access denied to business %', p_business_id
      using errcode = '42501';
  end if;

  if p_date_from is null or p_date_to is null or p_date_from > p_date_to then
    raise exception 'Invalid profit and loss date range'
      using errcode = '22023';
  end if;

  if p_branch_id is not null and not exists (
    select 1
      from public.branches b
     where b.id = p_branch_id
       and b.business_id = p_business_id
       and public.can_access_branch(p_business_id, p_branch_id)
  ) then
    raise exception 'Access denied to branch %', p_branch_id
      using errcode = '42501';
  end if;

  return query
  with trial_balance as (
    select *
      from public.get_trial_balance(p_business_id, p_date_from, p_date_to, p_branch_id)
  ), reversal_pair_totals as (
    select jl.account_id,
           sum(case when jl.is_debit then jl.amount_base else 0::numeric end) as debit_total,
           sum(case when not jl.is_debit then jl.amount_base else 0::numeric end) as credit_total
      from public.journal_lines jl
      join public.journal_entries je
        on je.id = jl.journal_entry_id
       and je.business_id = jl.business_id
     where jl.business_id = p_business_id
       and je.business_id = p_business_id
       and je.status::text in ('posted', 'reversed')
       and (je.status::text = 'reversed' or je.reversal_of is not null)
       and je.entry_date >= p_date_from
       and je.entry_date <= p_date_to
       and (p_branch_id is null or je.branch_id = p_branch_id)
       and public.can_access_branch(p_business_id, je.branch_id)
       and (jl.branch_id is null or public.can_access_branch(p_business_id, jl.branch_id))
     group by jl.account_id
  )
  select tb.account_id,
         tb.account_code,
         tb.account_name,
         tb.account_type,
         tb.parent_account_id,
         tb.total_debit - coalesce(rpt.debit_total, 0::numeric),
         tb.total_credit - coalesce(rpt.credit_total, 0::numeric),
         tb.balance - (coalesce(rpt.debit_total, 0::numeric) - coalesce(rpt.credit_total, 0::numeric)),
         tb.level
    from trial_balance tb
    left join reversal_pair_totals rpt on rpt.account_id = tb.account_id
   order by tb.account_code, tb.account_id;
end;
$function$;

comment on function public.get_profit_loss_trial_balance(uuid, date, date, uuid) is
  'P&L-only trial balance that excludes both the reversed original entry and its linked reversal mirror for the requested period. The ordinary get_trial_balance RPC remains unchanged.';

revoke all on function public.get_profit_loss_trial_balance(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_profit_loss_trial_balance(uuid, date, date, uuid) to authenticated;
