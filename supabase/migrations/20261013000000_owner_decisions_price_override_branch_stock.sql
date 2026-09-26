-- OWNER DECISIONS 2026-09-26 (A. Gremu) — schema/functions only, NO data change.
--
--  D-PRICE   "A supervisor is the one to override prices at the till, not
--            cashiers."  Supervisor = owner, admin, manager, sales_manager,
--            branch_manager (the till's own role model, usePosPermissions).
--            * A POS line price different from products.sale_price is accepted
--              only when the SELLING session is a supervisor, or the line
--              carries a live price-override token (product + price bound)
--              authorised by a supervisor who is not the requester.
--            * Discounts above the seller's cap (pos_settings
--              cashier_/manager_max_discount_percent; owner/admin 100; till
--              fallbacks 10/25 when no settings row) need a discount token
--              authorised by a supervisor whose own cap covers it — otherwise
--              a 100 % discount would bypass the price rule.
--            * Tokens: single use, expiring, consumed inside the sale
--              transaction; approver authority re-validated at consume time.
--  D-BRANCH  "POS sales should deduct from branch stock and not warehouse."
--            _ledgr_pos_stock_location: a branch sale uses ONLY that branch's
--            own location; no fallback. A branch without a location cannot
--            ring up stock-tracked sales until one is created/stocked.
--            Sales with no branch (single-shop businesses) keep the default.
--            Other flows (quick income, R07 restock, invoices, backfill) keep
--            _ledgr_stock_location unchanged.

-- ═══════════════════════════ D-BRANCH ═══════════════════════════
create or replace function public._ledgr_pos_stock_location(p_business_id uuid, p_branch_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_branch_id is null then
    return public._ledgr_stock_location(p_business_id, null);
  end if;
  select id into v_id from public.inventory_locations
   where business_id = p_business_id and branch_id = p_branch_id
   order by is_default desc nulls last, created_at, id
   limit 1;
  return v_id;  -- null = this branch has no stock location (no warehouse fallback)
end;
$$;
revoke all on function public._ledgr_pos_stock_location(uuid, uuid) from public, anon, authenticated;
comment on function public._ledgr_pos_stock_location(uuid, uuid) is
  'Owner decision 2026-09-26: POS sales deduct from the selling branch''s own location only (no warehouse fallback). NULL when the branch has no location.';

-- _ledgr_complete_pos_sale: verbatim copy of 20261011000001 (latest); the ONLY
-- change is the D-BRANCH location resolution + missing-location refusal.
create or replace function public._ledgr_complete_pos_sale(
  p_business_id uuid,
  p_invoice_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_rate numeric;
  v_currency text;
  v_total numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_vat numeric;
  v_debtors uuid;
  v_revenue uuid;
  v_discount_acc uuid;
  v_vat_payable uuid;
  v_lines jsonb;
  v_sale_entry uuid;
  v_cogs_entry uuid;
  v_payment record;
  v_tender uuid;
  v_cash numeric;
  v_cost_lines jsonb := '[]'::jsonb;
  v_location uuid;
  v_line record;
  v_product record;
  v_balance record;
  v_unit_cost numeric;
  v_moved boolean;
begin
  select * into v_inv
    from public.invoices
   where id = p_invoice_id and business_id = p_business_id
   limit 1;
  if not found then
    raise exception 'Sale % was not found for this business.', p_invoice_id using errcode = 'P0001';
  end if;

  v_rate     := coalesce(v_inv.exchange_rate, 1);
  v_currency := coalesce(v_inv.original_currency, v_inv.currency);
  v_total    := coalesce(v_inv.total_amount, 0);
  v_subtotal := coalesce(v_inv.subtotal, 0);
  v_discount := coalesce(v_inv.discount_amount, 0);
  v_vat      := coalesce(v_inv.vat_amount, 0);

  -- 1. The sale entry: DR Debtors / CR Revenue (gross when discounted) /
  --    DR Discount allowed / CR VAT payable.
  select id into v_sale_entry
    from public.journal_entries
   where business_id = p_business_id
     and posting_key = 'invoice:' || p_invoice_id::text || ':sale'
   limit 1;

  if v_sale_entry is null then
    v_debtors := public._ledgr_account_by_code(p_business_id, '1131');

    v_revenue := null;
    if v_inv.revenue_account_id is not null then
      begin
        v_revenue := public._ledgr_assert_account(v_inv.revenue_account_id, p_business_id, 'revenue');
      exception when others then
        v_revenue := null;
      end;
    end if;
    if v_revenue is null then
      v_revenue := public._ledgr_account_by_code(p_business_id, '4112');
    end if;

    v_lines := jsonb_build_array(jsonb_build_object(
      'account_id', v_debtors,
      'description', 'Invoice ' || v_inv.invoice_number || ' — receivable',
      'is_debit', true,
      'amount', v_total,
      'amount_base', coalesce(v_inv.functional_amount, v_total * v_rate)
    ));

    if v_discount > 0.005 then
      begin
        v_discount_acc := public._ledgr_account_by_code(p_business_id, '4130');
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', v_revenue,
          'description', 'Invoice ' || v_inv.invoice_number || ' — revenue (gross)',
          'is_debit', false,
          'amount', v_subtotal + v_discount,
          'amount_base', (v_subtotal + v_discount) * v_rate
        ));
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', v_discount_acc,
          'description', 'Invoice ' || v_inv.invoice_number || ' — discount allowed',
          'is_debit', true,
          'amount', v_discount,
          'amount_base', v_discount * v_rate
        ));
      exception when others then
        -- 4130 genuinely missing: post net revenue, exactly as
        -- createInvoiceReceivableEntry does (and log nothing — the TS path
        -- warns, this keeps the books rather than the narration).
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', v_revenue,
          'description', 'Invoice ' || v_inv.invoice_number || ' — revenue',
          'is_debit', false,
          'amount', v_subtotal,
          'amount_base', v_subtotal * v_rate
        ));
      end;
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_revenue,
        'description', 'Invoice ' || v_inv.invoice_number || ' — revenue',
        'is_debit', false,
        'amount', v_subtotal,
        'amount_base', v_subtotal * v_rate
      ));
    end if;

    if v_vat > 0 then
      v_vat_payable := public._ledgr_account_by_code(p_business_id, '2121');
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_vat_payable,
        'description', 'Invoice ' || v_inv.invoice_number || ' — VAT',
        'is_debit', false,
        'amount', v_vat,
        'amount_base', v_vat * v_rate,
        'tax_code', 'vat_standard',
        'tax_amount', v_vat * v_rate
      ));
    end if;

    v_sale_entry := public._ledgr_post_entry_keyed(
      p_business_id,
      'invoice:' || p_invoice_id::text || ':sale',
      coalesce(v_inv.issue_date, current_date),
      'Invoice ' || v_inv.invoice_number,
      'invoice',
      p_invoice_id::text,
      v_currency, v_rate,
      v_inv.branch_id, v_inv.department_id,
      v_lines
    );

    update public.invoices set journal_entry_id = v_sale_entry where id = p_invoice_id;
  end if;

  -- 2. One settlement entry per tender, debiting the account the money landed
  --    in. Keyed by the stored payment id so a replay cannot double-post.
  v_debtors := coalesce(v_debtors, public._ledgr_account_by_code(p_business_id, '1131'));

  for v_payment in
    select * from public.invoice_payments
     where business_id = p_business_id and invoice_id = p_invoice_id
     order by created_at, id
  loop
    v_tender := v_payment.bank_account_id;
    if v_tender is null then
      v_tender := public._ledgr_account_by_code(p_business_id, '1110');
    end if;

    v_cash := coalesce(v_payment.functional_amount, v_payment.original_amount, v_payment.amount, 0);

    perform public._ledgr_post_entry_keyed(
      p_business_id,
      'invoice:' || p_invoice_id::text || ':settlement:' || v_payment.id::text,
      coalesce(v_payment.payment_date, v_inv.issue_date, current_date),
      'Receipt for Invoice ' || v_inv.invoice_number,
      'invoice',
      p_invoice_id::text,
      v_currency, v_rate,
      v_inv.branch_id, v_inv.department_id,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', v_tender,
          'description', 'Cash received — Invoice ' || v_inv.invoice_number,
          'is_debit', true,
          'amount', coalesce(v_payment.original_amount, v_payment.amount),
          'amount_base', v_cash
        ),
        jsonb_build_object(
          'account_id', v_debtors,
          'description', 'Settle debtor — Invoice ' || v_inv.invoice_number,
          'is_debit', false,
          'amount', coalesce(v_payment.original_amount, v_payment.amount),
          'amount_base', v_cash
        )
      )
    );
  end loop;

  -- 3. Stock release + COGS, derived from the invoice's own lines so the
  --    replay releases exactly what was sold. Guarded by "has this invoice
  --    already moved stock?" — movements carry no client key.
  select exists (
    select 1 from public.stock_movements
     where business_id = p_business_id and source_type = 'invoice' and source_id = p_invoice_id::text
  ) into v_moved;

  if not v_moved then
    -- OWNER DECISION 2026-09-26 (D-BRANCH): the branch's own location only.
    v_location := public._ledgr_pos_stock_location(p_business_id, v_inv.branch_id);
    if v_location is null and v_inv.branch_id is not null and exists (
         select 1 from public.invoice_lines il join public.products p on p.id = il.product_id
          where il.invoice_id = p_invoice_id and il.business_id = p_business_id
            and coalesce(p.track_inventory, true) and il.quantity > 0) then
      raise exception 'branch-location-missing: this branch has no stock location, so stock cannot be deducted from branch stock. Create a location for the branch and transfer stock to it (owner decision: no warehouse fallback).'
        using errcode = 'P0001';
    end if;

    if v_location is not null then
      for v_line in
        select il.product_id, sum(il.quantity) as quantity
          from public.invoice_lines il
         where il.business_id = p_business_id
           and il.invoice_id = p_invoice_id
           and il.product_id is not null
         group by il.product_id
      loop
        if coalesce(v_line.quantity, 0) <= 0 then
          continue;
        end if;

        select * into v_product
          from public.products
         where id = v_line.product_id
           and business_id = p_business_id
           and track_inventory = true;
        if not found then
          continue;
        end if;

        select * into v_balance
          from public.inventory_balances
         where business_id = p_business_id
           and product_id = v_product.id
           and location_id = v_location
         limit 1;
        v_unit_cost := coalesce(v_balance.average_cost, 0);

        insert into public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, source_type, source_id, reference, created_by
        ) values (
          p_business_id, v_product.id, v_location, 'sale',
          coalesce(v_inv.issue_date, current_date),
          -v_line.quantity, v_unit_cost,
          'invoice', p_invoice_id::text, v_inv.invoice_number, v_inv.created_by
        );

        v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object(
          'product_id', v_product.id,
          'quantity', v_line.quantity,
          'unit_cost', v_unit_cost
        ));
      end loop;
    end if;

    if jsonb_array_length(v_cost_lines) > 0 then
      begin
        v_cogs_entry := public._ledgr_post_cogs(
          p_business_id, p_invoice_id, v_inv.invoice_number,
          coalesce(v_inv.issue_date, current_date),
          v_inv.branch_id, v_inv.department_id, v_cost_lines
        );
        update public.journal_entries
           set posting_key = 'invoice:' || p_invoice_id::text || ':cogs'
         where id = v_cogs_entry;
      exception when others then
        -- INCIDENT CONTAINMENT 2026-09-25 (P5): a COGS failure is NO LONGER
        -- swallowed. Re-raise so post_pos_sale's single transaction rolls back
        -- entirely (invoice, lines, payments, sale/settlement journals, stock
        -- movements). The sale never reports success without its COGS entry.
        raise exception 'COGS posting failed for sale %: %. The sale was not recorded; fix the cause and retry.',
          v_inv.invoice_number, sqlerrm using errcode = 'P0001';
      end;
    end if;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_sale_entry,
    'cogs_entry_id', v_cogs_entry
  );
end;
$$;

revoke all on function public._ledgr_complete_pos_sale(uuid,uuid) from public;

-- pos_stock_availability: same gate as 20261011000004; resolves the POS
-- location with the D-BRANCH rule. is_fallback is now only true for a sale
-- without a branch; a branch with no location reports branch_location_missing.
create or replace function public.pos_stock_availability(p_business_id uuid, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_location public.inventory_locations%rowtype;
  v_location_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_business_id is null or not public.can_operate_pos(p_business_id) then
    raise exception 'You do not have permission to use the till for this business.' using errcode = '42501';
  end if;
  if p_branch_id is not null
     and not exists (select 1 from public.branches where id = p_branch_id and business_id = p_business_id) then
    raise exception 'You do not have access to the requested branch.' using errcode = '42501';
  end if;
  if not public.can_access_branch(p_business_id, p_branch_id) then
    raise exception 'You do not have access to the requested branch.' using errcode = '42501';
  end if;

  v_location_id := public._ledgr_pos_stock_location(p_business_id, p_branch_id);
  if v_location_id is null then
    return jsonb_build_object(
      'business_id', p_business_id, 'branch_id', p_branch_id,
      'location', null, 'is_fallback', false,
      'branch_location_missing', p_branch_id is not null,
      'balances', '[]'::jsonb);
  end if;

  select * into v_location from public.inventory_locations where id = v_location_id;
  return jsonb_build_object(
    'business_id', p_business_id,
    'branch_id', p_branch_id,
    'location', jsonb_build_object('id', v_location.id, 'name', v_location.name, 'branch_id', v_location.branch_id),
    'is_fallback', p_branch_id is null and v_location.branch_id is not null,
    'branch_location_missing', false,
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', ib.product_id, 'quantity_on_hand', ib.quantity_on_hand))
        from public.inventory_balances ib
       where ib.business_id = p_business_id and ib.location_id = v_location_id), '[]'::jsonb));
end;
$$;
comment on function public.pos_stock_availability(uuid, uuid) is
  'POS display stock for exactly the location a sale on this branch deducts from (owner decision 2026-09-26: the branch''s own location, no warehouse fallback; branch_location_missing when none). Quantities only. Gated by can_operate_pos + branch-in-business + can_access_branch. Read-only.';

-- ═══════════════════════════ D-PRICE ═══════════════════════════
create or replace function public._ledgr_is_pos_supervisor(p_business_id uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.business_users
                  where business_id = p_business_id and user_id = p_user and is_active = true
                    and role::text in ('owner','admin','manager','sales_manager','branch_manager'));
$$;
revoke all on function public._ledgr_is_pos_supervisor(uuid, uuid) from public, anon, authenticated;

-- Discount cap (percent) for a user, mirroring usePosPermissions.
create or replace function public._ledgr_pos_discount_cap(p_business_id uuid, p_user uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text;
  v_cashier numeric; v_manager numeric;
begin
  select role::text into v_role from public.business_users
   where business_id = p_business_id and user_id = p_user and is_active = true limit 1;
  if v_role in ('owner','admin') then return 100; end if;
  select cashier_max_discount_percent, manager_max_discount_percent into v_cashier, v_manager
    from public.pos_settings where business_id = p_business_id limit 1;
  if v_role in ('manager','sales_manager','branch_manager') then return coalesce(v_manager, 25); end if;
  if v_role is null then return 0; end if;
  return coalesce(v_cashier, 10);
end;
$$;
revoke all on function public._ledgr_pos_discount_cap(uuid, uuid) from public, anon, authenticated;

create table if not exists public.pos_price_overrides (
  id            uuid primary key default gen_random_uuid(),
  token         uuid not null unique default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id),
  kind          text not null check (kind in ('price','discount')),
  product_id    uuid references public.products(id),
  unit_price    numeric,
  max_discount_percent numeric,
  reason        text,
  requested_by  uuid not null,
  authorized_by uuid,
  authorized_at timestamptz,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  consumed_by   uuid,
  consumed_invoice_id uuid,
  created_at    timestamptz not null default now(),
  constraint pos_price_overrides_shape check (
    (kind = 'price' and product_id is not null and unit_price is not null and unit_price >= 0)
    or (kind = 'discount' and max_discount_percent is not null and max_discount_percent > 0 and max_discount_percent <= 100))
);
create index if not exists idx_pos_price_overrides_business on public.pos_price_overrides (business_id, created_at desc);
alter table public.pos_price_overrides enable row level security;
drop policy if exists pos_price_overrides_member_read on public.pos_price_overrides;
create policy pos_price_overrides_member_read on public.pos_price_overrides
  for select using (public.is_business_member(business_id));
revoke all on public.pos_price_overrides from anon, authenticated;
grant select on public.pos_price_overrides to authenticated;
comment on table public.pos_price_overrides is
  'Owner decision 2026-09-26: supervisor-authorised POS price / over-cap discount overrides. Minted by request_pos_price_override, authorised by authorize_pos_price_override (supervisor, not the requester), consumed once by post_pos_sale. Writes only through those functions.';

create or replace function public.request_pos_price_override(
  p_business_id uuid, p_kind text, p_product_id uuid default null,
  p_unit_price numeric default null, p_max_discount_percent numeric default null,
  p_reason text default null, p_ttl_minutes integer default 15
) returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.pos_price_overrides%rowtype;
begin
  if v_user is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_business_id is null or not public.can_operate_pos(p_business_id) then
    raise exception 'You do not have permission to use the till for this business.' using errcode = '42501';
  end if;
  if p_kind not in ('price','discount') then
    raise exception 'Unknown override kind %.', p_kind using errcode = '22023';
  end if;
  if p_kind = 'price' and (p_unit_price is null or p_unit_price < 0 or not exists (
       select 1 from public.products where id = p_product_id and business_id = p_business_id)) then
    raise exception 'A price override needs a product of this business and a non-negative price.' using errcode = '22023';
  end if;
  if p_kind = 'discount' and (p_max_discount_percent is null or p_max_discount_percent <= 0 or p_max_discount_percent > 100) then
    raise exception 'A discount override needs a percentage between 0 and 100.' using errcode = '22023';
  end if;
  insert into public.pos_price_overrides (business_id, kind, product_id, unit_price, max_discount_percent,
      reason, requested_by, expires_at)
  values (p_business_id, p_kind, case when p_kind = 'price' then p_product_id end,
      case when p_kind = 'price' then round(p_unit_price, 2) end,
      case when p_kind = 'discount' then p_max_discount_percent end,
      nullif(btrim(coalesce(p_reason, '')), ''), v_user,
      now() + (greatest(1, least(coalesce(p_ttl_minutes, 15), 240)) || ' minutes')::interval)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'kind', v_row.kind,
    'product_id', v_row.product_id, 'unit_price', v_row.unit_price,
    'max_discount_percent', v_row.max_discount_percent, 'expires_at', v_row.expires_at, 'status', 'requested');
end;
$$;

create or replace function public.authorize_pos_price_override(p_token uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.pos_price_overrides%rowtype;
begin
  if v_user is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v_row from public.pos_price_overrides where token = p_token for update;
  if not found then raise exception 'Unknown override token.' using errcode = '22023'; end if;
  if not public._ledgr_is_pos_supervisor(v_row.business_id, v_user) then
    raise exception 'Only a supervisor (owner, admin or manager) may authorise a till override.' using errcode = '42501';
  end if;
  if v_row.requested_by = v_user then
    raise exception 'The requester cannot authorise their own override.' using errcode = '22023';
  end if;
  if v_row.kind = 'discount' and v_row.max_discount_percent > public._ledgr_pos_discount_cap(v_row.business_id, v_user) then
    raise exception 'This discount (% percent) is above your own approval limit.', v_row.max_discount_percent using errcode = '42501';
  end if;
  if v_row.authorized_at is not null then raise exception 'This override has already been authorised.' using errcode = '22023'; end if;
  if v_row.consumed_at is not null then raise exception 'This override has already been used.' using errcode = '22023'; end if;
  if v_row.expires_at <= now() then raise exception 'This override has expired.' using errcode = '22023'; end if;
  update public.pos_price_overrides set authorized_by = v_user, authorized_at = now() where id = v_row.id;
  return jsonb_build_object('token', v_row.token, 'kind', v_row.kind, 'product_id', v_row.product_id,
    'unit_price', v_row.unit_price, 'max_discount_percent', v_row.max_discount_percent,
    'authorized_by', v_user, 'status', 'authorized');
end;
$$;
revoke all on function public.request_pos_price_override(uuid,text,uuid,numeric,numeric,text,integer) from public, anon;
revoke all on function public.authorize_pos_price_override(uuid) from public, anon;
grant execute on function public.request_pos_price_override(uuid,text,uuid,numeric,numeric,text,integer) to authenticated;
grant execute on function public.authorize_pos_price_override(uuid) to authenticated;

-- Consume one live, authorised token matching the need. Returns true if found.
create or replace function public._ledgr_consume_price_override(
  p_business_id uuid, p_tokens uuid[], p_kind text, p_product_id uuid, p_unit_price numeric, p_percent numeric
) returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.pos_price_overrides%rowtype;
begin
  if p_tokens is null or cardinality(p_tokens) = 0 then return false; end if;
  select * into v_row from public.pos_price_overrides o
   where o.token = any(p_tokens) and o.business_id = p_business_id and o.kind = p_kind
     and o.authorized_at is not null and o.consumed_at is null and o.expires_at > now()
     and public._ledgr_is_pos_supervisor(o.business_id, o.authorized_by)
     and (p_kind <> 'price' or (o.product_id = p_product_id and abs(o.unit_price - p_unit_price) <= 0.005))
     and (p_kind <> 'discount' or (o.max_discount_percent + 0.005 >= p_percent
                                   and public._ledgr_pos_discount_cap(o.business_id, o.authorized_by) + 0.005 >= p_percent))
   order by o.created_at
   limit 1
   for update skip locked;
  if not found then return false; end if;
  update public.pos_price_overrides set consumed_at = now(), consumed_by = auth.uid() where id = v_row.id;
  return true;
end;
$$;
revoke all on function public._ledgr_consume_price_override(uuid,uuid[],text,uuid,numeric,numeric) from public, anon, authenticated;

create or replace function public._ledgr_assert_pos_price_authority(
  p_business_id uuid, p_invoice jsonb, p_lines jsonb, p_tokens uuid[]
) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_supervisor boolean;
  v_cap numeric;
  v_l jsonb; v_n int := 0;
  v_catalogue numeric; v_q numeric; v_p numeric; v_d numeric;
  v_gross numeric := 0; v_max_pct numeric := 0; v_total_disc numeric;
begin
  if v_user is null then
    return;  -- service-role/offline-operator paths are authorised elsewhere
  end if;
  v_supervisor := public._ledgr_is_pos_supervisor(p_business_id, v_user);
  v_cap := public._ledgr_pos_discount_cap(p_business_id, v_user);

  for v_l in select value from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_q := (v_l->>'quantity')::numeric; v_p := (v_l->>'unit_price')::numeric;
    v_d := coalesce((v_l->>'discount_amount')::numeric, 0);
    v_gross := v_gross + v_q * v_p;
    if v_q * v_p > 0 then v_max_pct := greatest(v_max_pct, v_d / (v_q * v_p) * 100); end if;
    if nullif(v_l->>'product_id', '') is not null then
      select sale_price into v_catalogue from public.products
       where id = (v_l->>'product_id')::uuid and business_id = p_business_id;
      if v_catalogue is not null and abs(v_p - v_catalogue) > 0.005 and not v_supervisor
         and not public._ledgr_consume_price_override(p_business_id, p_tokens, 'price', (v_l->>'product_id')::uuid, v_p, null) then
        raise exception 'price-override-required: line % is priced % but the catalogue price is %. A supervisor must authorise a price override.', v_n, v_p, v_catalogue
          using errcode = '22023';
      end if;
    end if;
  end loop;

  v_total_disc := coalesce((p_invoice->>'discount_amount')::numeric, 0);
  if v_gross > 0 then v_max_pct := greatest(v_max_pct, v_total_disc / v_gross * 100); end if;
  if v_max_pct > v_cap + 0.005
     and not public._ledgr_consume_price_override(p_business_id, p_tokens, 'discount', null, null, v_max_pct) then
    raise exception 'discount-override-required: a discount of % percent is above your limit of % percent. A supervisor must authorise it.', round(v_max_pct, 2), v_cap
      using errcode = '22023';
  end if;
end;
$$;
revoke all on function public._ledgr_assert_pos_price_authority(uuid,jsonb,jsonb,uuid[]) from public, anon, authenticated;

-- _ledgr_assert_pos_sale_amounts (called by post_pos_sale after step 3b): the
-- 20261012000000 body verbatim, now VOLATILE, plus the D-PRICE authority call.
create or replace function public._ledgr_assert_pos_sale_amounts(
  p_business_id uuid, p_invoice jsonb, p_lines jsonb
) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  c_tol constant numeric := 0.01;
  v_l jsonb; v_n int := 0;
  v_q numeric; v_p numeric; v_d numeric; v_lt numeric;
  v_gross numeric := 0; v_line_disc numeric := 0; v_sum_lt numeric := 0;
  v_total numeric := (p_invoice->>'total_amount')::numeric;
  v_disc numeric := coalesce((p_invoice->>'discount_amount')::numeric, 0);
  v_vat numeric := coalesce((p_invoice->>'vat_amount')::numeric, 0);
  v_sub numeric;
  v_reg boolean; v_rate numeric; v_expected_vat numeric;
  v_tokens uuid[];
begin
  v_sub := coalesce((p_invoice->>'subtotal')::numeric, v_total - v_vat);
  for v_l in select value from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_q := (v_l->>'quantity')::numeric;
    v_p := (v_l->>'unit_price')::numeric;
    v_d := coalesce((v_l->>'discount_amount')::numeric, 0);
    v_lt := (v_l->>'line_total')::numeric;
    if v_q is null or v_q <= 0 or v_p is null or v_p < 0 or v_lt is null then
      raise exception 'POS sale line %: quantity must be positive, unit price non-negative and a line total present (H-2).', v_n
        using errcode = '22023';
    end if;
    if v_d < 0 or v_d > v_q * v_p + c_tol then
      raise exception 'POS sale line %: discount % is outside 0..% (H-2).', v_n, v_d, round(v_q * v_p, 2)
        using errcode = '22023';
    end if;
    if abs(v_q * v_p - v_d - v_lt) > c_tol then
      raise exception 'POS sale line %: line total % does not equal quantity × price − discount (%) (H-2).', v_n, v_lt, round(v_q * v_p - v_d, 2)
        using errcode = '22023';
    end if;
    v_gross := v_gross + v_q * v_p;
    v_line_disc := v_line_disc + v_d;
    v_sum_lt := v_sum_lt + v_lt;
  end loop;

  if v_disc < v_line_disc - c_tol or v_disc > v_gross + c_tol then
    raise exception 'POS sale discount % is inconsistent with its lines (line discounts %, gross %) (H-2).', v_disc, round(v_line_disc, 2), round(v_gross, 2)
      using errcode = '22023';
  end if;
  if v_total > v_sum_lt + c_tol or abs(v_gross - v_disc - v_total) > c_tol then
    raise exception 'POS sale total % does not equal gross % − discount % (H-2).', v_total, round(v_gross, 2), v_disc
      using errcode = '22023';
  end if;

  select vat_registered into v_reg from public.businesses where id = p_business_id;
  v_rate := case when coalesce(v_reg, false) then 17.5 else 0 end;  -- src/lib/vat.ts VAT_STANDARD_RATE
  v_expected_vat := round(v_total - v_total / (1 + v_rate / 100), 2);
  if abs(v_vat - v_expected_vat) > c_tol then
    raise exception 'POS sale VAT % does not match the business VAT status (expected %) (H-2).', v_vat, v_expected_vat
      using errcode = '22023';
  end if;
  if abs(v_sub + v_vat - v_total) > c_tol then
    raise exception 'POS sale subtotal % + VAT % does not equal total % (H-2).', v_sub, v_vat, v_total
      using errcode = '22023';
  end if;

  -- OWNER DECISION 2026-09-26 (D-PRICE): price / discount authority.
  select coalesce(array_agg(t), '{}') into v_tokens from (
    select nullif(l->>'price_override_token', '')::uuid t from jsonb_array_elements(p_lines) l
    union all select nullif(p_invoice->>'discount_override_token', '')::uuid) x where t is not null;
  perform public._ledgr_assert_pos_price_authority(p_business_id, p_invoice, p_lines, v_tokens);
end;
$$;
revoke all on function public._ledgr_assert_pos_sale_amounts(uuid, jsonb, jsonb) from public, anon, authenticated;
