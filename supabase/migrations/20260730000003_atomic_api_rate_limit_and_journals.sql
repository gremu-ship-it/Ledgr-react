-- Atomic public-API rate limiting and journal creation.

-- The earlier select/update rate counter lost increments under concurrency.
-- Deduplicate historical rows before making the bucket/window pair unique.
delete from public.api_usage older
using public.api_usage newer
where older.api_key is not null
  and older.api_key = newer.api_key
  and older.window_start = newer.window_start
  and older.ctid < newer.ctid;

create unique index if not exists api_usage_bucket_window_uidx
  on public.api_usage(api_key, window_start)
  where api_key is not null;

create or replace function public.consume_api_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_start timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_bucket is null or length(p_bucket) = 0 or p_limit < 1 then
    raise exception 'Invalid rate limit arguments' using errcode = '22023';
  end if;

  insert into public.api_usage (api_key, count, window_start)
  values (p_bucket, 1, p_window_start)
  on conflict (api_key, window_start) where api_key is not null do update
    set count = public.api_usage.count + 1
    where public.api_usage.count < p_limit
  returning count into v_count;

  return v_count is not null;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, timestamptz) to service_role;

-- Creates an entry and all of its lines in one transaction. The public API
-- validates the shape first; this RPC independently enforces tenant ownership
-- and balancing so service-role writes cannot leave partial/unbalanced data.
create or replace function public.create_api_journal_entry(
  p_business_id uuid,
  p_entry jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.journal_entries;
  v_debits numeric;
  v_credits numeric;
begin
  if jsonb_typeof(p_entry) <> 'object' or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry needs a header and at least two lines.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as l(account_id uuid, amount_base numeric, is_debit boolean)
    left join public.accounts a on a.id = l.account_id and a.business_id = p_business_id
    where l.account_id is null or l.amount_base is null or l.amount_base <= 0 or l.is_debit is null or a.id is null
  ) then
    raise exception 'Every journal line must have a business account, a positive amount_base, and debit/credit side.' using errcode = '22023';
  end if;

  select coalesce(sum(case when l.is_debit then l.amount_base else 0 end), 0),
         coalesce(sum(case when not l.is_debit then l.amount_base else 0 end), 0)
    into v_debits, v_credits
  from jsonb_to_recordset(p_lines) as l(amount_base numeric, is_debit boolean);

  if abs(v_debits - v_credits) > 0.005 then
    raise exception 'Journal entry lines do not balance in functional currency.' using errcode = '22023';
  end if;

  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, reference, currency,
    exchange_rate, branch_id, department_id, period_id, source_type, source_id, status
  )
  values (
    p_business_id,
    p_entry->>'entry_number',
    (p_entry->>'entry_date')::date,
    p_entry->>'description',
    nullif(p_entry->>'reference', ''),
    coalesce(nullif(p_entry->>'currency', ''), 'MWK'),
    coalesce((p_entry->>'exchange_rate')::numeric, 1),
    nullif(p_entry->>'branch_id', '')::uuid,
    nullif(p_entry->>'department_id', '')::uuid,
    nullif(p_entry->>'period_id', '')::uuid,
    nullif(p_entry->>'source_type', ''),
    nullif(p_entry->>'source_id', '')::uuid,
    'draft'
  ) returning * into v_entry;

  insert into public.journal_lines (
    journal_entry_id, business_id, line_number, account_id, is_debit, amount,
    amount_base, currency, exchange_rate, description, branch_id, department_id,
    tax_code, tax_amount, original_currency, original_amount, rate_date, rate_is_stale
  )
  select v_entry.id, p_business_id, l.line_number, l.account_id, l.is_debit,
         l.amount, l.amount_base, coalesce(l.currency, v_entry.currency),
         coalesce(l.exchange_rate, v_entry.exchange_rate), l.description,
         l.branch_id, l.department_id, l.tax_code, coalesce(l.tax_amount, 0),
         l.original_currency, l.original_amount, l.rate_date, coalesce(l.rate_is_stale, false)
  from jsonb_to_recordset(p_lines) as l(
    line_number integer, account_id uuid, is_debit boolean, amount numeric,
    amount_base numeric, currency text, exchange_rate numeric, description text,
    branch_id uuid, department_id uuid, tax_code public.tax_code, tax_amount numeric,
    original_currency text, original_amount numeric, rate_date date, rate_is_stale boolean
  );

  return to_jsonb(v_entry);
end;
$$;

revoke all on function public.create_api_journal_entry(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_api_journal_entry(uuid, jsonb, jsonb) to service_role;
