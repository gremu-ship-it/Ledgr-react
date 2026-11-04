-- Cash Deposits (Multi-Source to Bank)
-- A posted deposit is an asset-to-asset journal transfer; it never touches P&L.

create table if not exists public.cash_deposits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  deposit_date date not null,
  bank_account_id uuid not null references public.accounts(id),
  reference text,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'posted', 'voided')),
  journal_entry_id uuid references public.journal_entries(id),
  created_by text,
  posted_by text,
  posted_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_deposits_business_id_id_key unique (business_id, id)
);

create table if not exists public.cash_deposit_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  deposit_id uuid not null,
  line_number integer not null check (line_number > 0),
  source_account_id uuid not null references public.accounts(id),
  amount numeric(20, 4) not null check (amount > 0 and amount < 'Infinity'::numeric),
  description text,
  created_at timestamptz not null default now(),
  constraint cash_deposit_lines_parent_fk
    foreign key (business_id, deposit_id)
    references public.cash_deposits(business_id, id) on delete cascade,
  constraint cash_deposit_lines_number_key unique (deposit_id, line_number)
);

create index if not exists cash_deposits_business_date_idx
  on public.cash_deposits (business_id, deposit_date desc, created_at desc);
create index if not exists cash_deposits_business_status_idx
  on public.cash_deposits (business_id, status);
create index if not exists cash_deposit_lines_deposit_idx
  on public.cash_deposit_lines (business_id, deposit_id, line_number);

alter table public.cash_deposits enable row level security;
alter table public.cash_deposit_lines enable row level security;

create policy "cash_deposits_select_member" on public.cash_deposits
  for select to authenticated using (public.is_business_member(business_id));
create policy "cash_deposits_insert_member" on public.cash_deposits
  for insert to authenticated
  with check (public.is_business_member(business_id) and status = 'draft'
    and journal_entry_id is null and posted_by is null and posted_at is null
    and voided_at is null and void_reason is null);
create policy "cash_deposits_update_member" on public.cash_deposits
  for update to authenticated
  using (public.is_business_member(business_id) and status = 'draft')
  with check (public.is_business_member(business_id) and status = 'draft'
    and journal_entry_id is null and posted_by is null and posted_at is null
    and voided_at is null and void_reason is null);

create policy "cash_deposit_lines_select_member" on public.cash_deposit_lines
  for select to authenticated using (public.is_business_member(business_id));
create policy "cash_deposit_lines_insert_member" on public.cash_deposit_lines
  for insert to authenticated
  with check (public.is_business_member(business_id) and exists (
    select 1 from public.cash_deposits d
    where d.id = deposit_id and d.business_id = cash_deposit_lines.business_id and d.status = 'draft'
  ));
create policy "cash_deposit_lines_update_member" on public.cash_deposit_lines
  for update to authenticated
  using (public.is_business_member(business_id) and exists (
    select 1 from public.cash_deposits d
    where d.id = deposit_id and d.business_id = cash_deposit_lines.business_id and d.status = 'draft'
  ))
  with check (public.is_business_member(business_id) and exists (
    select 1 from public.cash_deposits d
    where d.id = deposit_id and d.business_id = cash_deposit_lines.business_id and d.status = 'draft'
  ));
create policy "cash_deposit_lines_delete_member" on public.cash_deposit_lines
  for delete to authenticated
  using (public.is_business_member(business_id) and exists (
    select 1 from public.cash_deposits d
    where d.id = deposit_id and d.business_id = cash_deposit_lines.business_id and d.status = 'draft'
  ));

grant select, insert, update on public.cash_deposits to authenticated;
grant select, insert, update, delete on public.cash_deposit_lines to authenticated;

create or replace function public.save_cash_deposit_draft(
  p_business_id uuid,
  p_deposit_id uuid,
  p_deposit_date date,
  p_bank_account_id uuid,
  p_reference text,
  p_notes text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_deposit_id uuid;
  v_currency text;
  v_bank public.accounts%rowtype;
begin
  v_actor := auth.uid()::text;
  if v_actor is null then
    raise exception 'Authentication is required to save a cash deposit.' using errcode = '42501';
  end if;
  if not public.is_business_member(p_business_id) then
    raise exception 'Not authorised for this business.' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Cash deposit source lines must be provided as an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A cash deposit requires at least one source line.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where nullif(line.value->>'source_account_id', '') is null
      or nullif(line.value->>'amount', '') is null
      or (line.value->>'amount')::numeric <= 0
      or (line.value->>'amount')::numeric >= 'Infinity'::numeric
  ) then
    raise exception 'Every cash source must have an account and a positive amount.' using errcode = '22023';
  end if;

  select b.base_currency into v_currency
  from public.businesses b where b.id = p_business_id;
  if v_currency is null then
    raise exception 'Business functional currency could not be determined.' using errcode = '22023';
  end if;
  select a.* into v_bank from public.accounts a
  where a.id = p_bank_account_id and a.business_id = p_business_id
    and a.is_active = true and a.is_group = false
    and a.account_type = 'asset' and a.is_bank_account = true
    and (a.code like '111%' or a.code like '112%')
    and coalesce(a.currency, v_currency) = v_currency;
  if not found then
    raise exception 'Select an active bank asset account in the business functional currency.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    left join public.accounts a on a.id = (line.value->>'source_account_id')::uuid
      and a.business_id = p_business_id
    where a.id is null or a.is_active is not true or a.is_group is true
      or a.account_type is distinct from 'asset' or a.id = v_bank.id
      or not (a.code like '111%' or a.code like '112%')
      or a.is_bank_account is true
      or coalesce(a.currency, v_currency) <> v_currency
  ) then
    raise exception 'Every source must be a different active cash asset account in the business functional currency.' using errcode = '22023';
  end if;

  if p_deposit_id is null then
    insert into public.cash_deposits (
      business_id, deposit_date, bank_account_id, reference, notes, status, created_by
    ) values (
      p_business_id, p_deposit_date, p_bank_account_id, nullif(trim(p_reference), ''),
      nullif(trim(p_notes), ''), 'draft', v_actor
    ) returning id into v_deposit_id;
  else
    select d.id into v_deposit_id from public.cash_deposits d
    where d.id = p_deposit_id and d.business_id = p_business_id and d.status = 'draft'
    for update;
    if not found then
      raise exception 'Only draft cash deposits belonging to this business can be edited.' using errcode = '22023';
    end if;
    update public.cash_deposits set
      deposit_date = p_deposit_date,
      bank_account_id = p_bank_account_id,
      reference = nullif(trim(p_reference), ''),
      notes = nullif(trim(p_notes), ''),
      updated_at = now()
    where id = v_deposit_id and business_id = p_business_id;
    delete from public.cash_deposit_lines
    where business_id = p_business_id and deposit_id = v_deposit_id;
  end if;

  insert into public.cash_deposit_lines (
    business_id, deposit_id, line_number, source_account_id, amount, description
  )
  select p_business_id, v_deposit_id, line.ordinality::integer,
    (line.value->>'source_account_id')::uuid,
    (line.value->>'amount')::numeric,
    nullif(trim(line.value->>'description'), '')
  from jsonb_array_elements(p_lines) with ordinality as line(value, ordinality);
  return v_deposit_id;
end;
$$;

create or replace function public.post_cash_deposit(p_deposit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.cash_deposits%rowtype;
  v_business_id uuid;
  v_actor text;
  v_bank public.accounts%rowtype;
  v_currency text;
  v_total numeric(20, 4);
  v_line_count integer;
  v_journal_id uuid;
  v_entry_number text;
begin
  v_actor := auth.uid()::text;
  if v_actor is null then
    raise exception 'Authentication is required to post a cash deposit.' using errcode = '42501';
  end if;

  select d.* into v_deposit
  from public.cash_deposits d
  where d.id = p_deposit_id
  for update;
  if not found then raise exception 'Cash deposit not found.' using errcode = 'P0002'; end if;
  v_business_id := v_deposit.business_id;
  if not public.is_business_member(v_business_id) then
    raise exception 'Not authorised for this business.' using errcode = '42501';
  end if;

  if v_deposit.status = 'posted' and v_deposit.journal_entry_id is not null then
    return v_deposit.journal_entry_id;
  end if;
  if v_deposit.status <> 'draft' then
    raise exception 'Only draft cash deposits can be posted.' using errcode = '22023';
  end if;

  select b.base_currency into v_currency
  from public.businesses b where b.id = v_business_id;
  if v_currency is null then
    raise exception 'Business functional currency could not be determined.' using errcode = '22023';
  end if;

  select a.* into v_bank
  from public.accounts a
  where a.id = v_deposit.bank_account_id
    and a.business_id = v_business_id
    and a.is_active = true
    and a.is_group = false
    and a.account_type = 'asset'
    and a.is_bank_account = true
    and (a.code like '111%' or a.code like '112%')
    and coalesce(a.currency, v_currency) = v_currency;
  if not found then
    raise exception 'Select an active bank asset account belonging to this business.' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(l.amount), 0)
    into v_line_count, v_total
  from public.cash_deposit_lines l
  where l.business_id = v_business_id and l.deposit_id = p_deposit_id;
  if v_line_count = 0 or v_total <= 0 then
    raise exception 'Add at least one positive cash source line.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.cash_deposit_lines l
    left join public.accounts a on a.id = l.source_account_id
      and a.business_id = v_business_id
    where l.business_id = v_business_id and l.deposit_id = p_deposit_id
      and (a.id is null or a.is_active is not true or a.is_group is true
        or a.account_type is distinct from 'asset' or a.id = v_bank.id
        or not (a.code like '111%' or a.code like '112%')
        or a.is_bank_account is true
        or coalesce(a.currency, v_currency) <> v_currency)
  ) then
    raise exception 'Every source must be a different active cash asset account in the same currency as the bank account.' using errcode = '22023';
  end if;

  v_entry_number := public.next_journal_entry_number(v_business_id);
  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id,
    currency, exchange_rate, status, created_by, posted_by, posted_at
  ) values (
    v_business_id, v_entry_number, v_deposit.deposit_date,
    coalesce(nullif(trim(v_deposit.reference), ''), 'Cash deposit') || ' — cash deposit',
    'cash_deposit', p_deposit_id::text,
    v_currency, 1, 'posted', v_actor, v_actor, now()
  ) returning id into v_journal_id;

  insert into public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description,
    is_debit, amount, amount_base, currency, exchange_rate, rate_is_stale,
    reconciled, tax_amount
  ) values (
    v_business_id, v_journal_id, 1, v_bank.id,
    coalesce(nullif(trim(v_deposit.reference), ''), 'Cash deposit') || ' — bank deposit',
    true, v_total, v_total, v_currency, 1, false, false, 0
  );

  insert into public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description,
    is_debit, amount, amount_base, currency, exchange_rate, rate_is_stale,
    reconciled, tax_amount
  )
  select v_business_id, v_journal_id, l.line_number + 1, l.source_account_id,
    coalesce(nullif(trim(l.description), ''), 'Cash source transfer'),
    false, l.amount, l.amount, v_currency, 1, false, false, 0
  from public.cash_deposit_lines l
  where l.business_id = v_business_id and l.deposit_id = p_deposit_id
  order by l.line_number;

  update public.cash_deposits
  set status = 'posted', journal_entry_id = v_journal_id,
      posted_by = v_actor, posted_at = now(), updated_at = now()
  where id = p_deposit_id and business_id = v_business_id;
  return v_journal_id;
end;
$$;

create or replace function public.void_cash_deposit(p_deposit_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.cash_deposits%rowtype;
  v_original public.journal_entries%rowtype;
  v_actor text;
  v_reversal_id uuid;
  v_business_id uuid;
begin
  v_actor := auth.uid()::text;
  if v_actor is null then
    raise exception 'Authentication is required to void a cash deposit.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required to void a posted cash deposit.' using errcode = '22023';
  end if;

  select d.* into v_deposit
  from public.cash_deposits d
  where d.id = p_deposit_id
  for update;
  if not found then raise exception 'Cash deposit not found.' using errcode = 'P0002'; end if;
  v_business_id := v_deposit.business_id;
  if not public.is_business_member(v_business_id) then
    raise exception 'Not authorised for this business.' using errcode = '42501';
  end if;
  if v_deposit.status <> 'posted' or v_deposit.journal_entry_id is null then
    raise exception 'Only posted cash deposits can be voided.' using errcode = '22023';
  end if;

  select je.* into v_original
  from public.journal_entries je
  where je.id = v_deposit.journal_entry_id and je.business_id = v_business_id
  for update;
  if not found or v_original.status <> 'posted' or v_original.reversed_by is not null then
    raise exception 'The cash deposit journal entry is not available for reversal.' using errcode = '22023';
  end if;

  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id,
    currency, exchange_rate, status, created_by, posted_by, posted_at, reversal_of
  ) values (
    v_business_id, public.next_journal_entry_number(v_business_id), current_date,
    'Reversal of ' || v_original.entry_number || ': ' || v_original.description,
    'reversal', v_original.source_id, v_original.currency, v_original.exchange_rate,
    'posted', v_actor, v_actor, now(), v_original.id
  ) returning id into v_reversal_id;

  insert into public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description,
    is_debit, amount, amount_base, currency, exchange_rate, rate_is_stale,
    reconciled, tax_amount
  )
  select jl.business_id, v_reversal_id, jl.line_number, jl.account_id,
    'Reversal of: ' || coalesce(jl.description, v_original.description),
    not jl.is_debit, jl.amount, jl.amount_base, jl.currency, jl.exchange_rate,
    jl.rate_is_stale, false, jl.tax_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_original.id and jl.business_id = v_business_id
  order by jl.line_number;

  if not exists (select 1 from public.journal_lines where journal_entry_id = v_reversal_id) then
    raise exception 'The cash deposit journal entry has no lines to reverse.' using errcode = '22023';
  end if;
  update public.journal_entries set status = 'reversed', reversed_by = v_reversal_id
  where id = v_original.id and business_id = v_business_id;
  update public.cash_deposits
  set status = 'voided', voided_at = now(), void_reason = trim(p_reason), updated_at = now()
  where id = p_deposit_id and business_id = v_business_id;
  return v_reversal_id;
end;
$$;

revoke all on function public.save_cash_deposit_draft(uuid, uuid, date, uuid, text, text, jsonb) from public, anon;
revoke all on function public.post_cash_deposit(uuid) from public, anon;
revoke all on function public.void_cash_deposit(uuid, text) from public, anon;
grant execute on function public.save_cash_deposit_draft(uuid, uuid, date, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.post_cash_deposit(uuid) to authenticated, service_role;
grant execute on function public.void_cash_deposit(uuid, text) to authenticated, service_role;

comment on function public.save_cash_deposit_draft(uuid, uuid, date, uuid, text, text, jsonb) is
  'Atomically creates or edits a draft cash deposit and replaces its source lines after tenant, account and amount validation.';
comment on function public.post_cash_deposit(uuid) is
  'Atomically posts a cash deposit as a balanced asset-to-asset transfer; no P&L accounts are touched.';
comment on function public.void_cash_deposit(uuid, text) is
  'Atomically reverses a posted cash deposit and marks its source record voided.';
