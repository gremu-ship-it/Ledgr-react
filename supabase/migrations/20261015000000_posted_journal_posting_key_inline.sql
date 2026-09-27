-- ============================================================================
-- 20261015000000_posted_journal_posting_key_inline.sql
--
-- Customer report (2026-09-27): Warehouse → Receive Stock failed with
--
--   Database error in stock_movements: Cannot modify posted journal entry
--   JNL-20260927-000403. Create a reversal instead.
--
-- Root cause. Production enforces posted-journal immutability with an
-- out-of-band guard (the rule this repository itself documents in
-- JournalRepository.post: "A posted entry is IMMUTABLE. To correct a posted
-- entry, create a new reversal entry." — see also
-- docs/audits/LEDGR_DECISION_ARCHITECTURE_GATE_2026-09-22.md GAP-2). The
-- keyed posting helpers violated it: they INSERT journal entries that are
-- already status='posted' and then UPDATE the row to stamp
-- journal_entries.posting_key:
--
--   _ledgr_post_entry_keyed     (20260923000000) — stamps every keyed entry;
--     reached from record_inventory_journal_movement (stock receipts /
--     adjustments — the failing path above), post_pos_sale,
--     _ledgr_complete_pos_sale, record_invoice_payment /
--     record_expense_payment, R07 void/refund, ledgr_repair
--   _ledgr_complete_pos_sale    — 'invoice:<id>:cogs' stamp (POS sales)
--   record_sale_stock_and_cogs  — 'invoice:<id>:cogs' stamp (invoice stock
--     release: Income page, mobile quick income, offline sync)
--   ledgr_repair.apply_2026_09 — 'invoice:<id>:cogs' stamp (2026-09 repair)
--
-- The stamp UPDATE tripped the guard, so the receipt's single server
-- transaction (H-3) rolled back — stock movement AND GRNI journal both lost,
-- nothing partial persisted — and every retry burned a fresh JNL number from
-- the sequence. Same defect class for POS sales and tracked-product invoices.
--
-- Fix: write posting_key with the INSERT that creates the entry. The posting
-- path never UPDATEs a posted journal entry again:
--
--   1. _ledgr_post_entry gains a 12-arg overload (p_posting_key) that stamps
--      the key on the header row. The historical 11-arg shape stays and
--      delegates with NULL — save_quick_sale / save_quick_expense keep their
--      unkeyed entries, byte-for-byte as before.
--   2. _ledgr_post_entry_keyed posts through the keyed overload instead of
--      INSERT-then-UPDATE. Resume-or-post semantics are unchanged: the
--      (business_id, posting_key) partial unique index (20260921000000)
--      still deduplicates races and a replay still returns the committed
--      entry untouched.
--   3. _ledgr_post_cogs gains an 8-arg overload (p_posting_key); the three
--      callers that stamped 'invoice:<id>:cogs' with an UPDATE now pass the
--      key down and their UPDATE statements are gone.
--
-- No other behaviour changes: keys, descriptions, entry numbers, idempotency
-- and rollback guarantees are exactly the previous ones. Environments WITHOUT
-- the immutability guard converge on the same shape, so staging and
-- production stop drifting (docs/database/schema-drift-reconciliation.md).
--
-- Bodies below are the latest definitions from the migration chain
-- (20260911000002 / 20261013000000 / 20261011000005 / 20261013000001) with
-- only the key-stamping mechanism changed. Idempotent (create or replace).
-- ============================================================================

-- ── 1. _ledgr_post_entry: keyed overload stamps posting_key in the INSERT ──
create or replace function public._ledgr_post_entry(
  p_business_id uuid,
  p_entry_number text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id text,
  p_currency text,
  p_exchange_rate numeric,
  p_branch_id uuid,
  p_department_id uuid,
  p_lines jsonb,    -- [{account_id, description, is_debit, amount, amount_base, tax_code, tax_amount}]
  p_posting_key text -- deterministic posting key (20260921000000), or null for an unkeyed entry
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_line_no integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry requires at least two lines.' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'is_debit')::boolean then
      v_debits := v_debits + (v_line->>'amount_base')::numeric;
    else
      v_credits := v_credits + (v_line->>'amount_base')::numeric;
    end if;
  end loop;

  if abs(v_debits - v_credits) > 0.005 then
    raise exception 'Journal entry does not balance in functional currency: debits % ≠ credits %.',
      round(v_debits::numeric, 2), round(v_credits::numeric, 2)
      using errcode = 'P0001';
  end if;

  -- posting_key is written with the header row: the entry is created already
  -- posted, and a posted entry is immutable (see JournalRepository.post —
  -- "A posted entry is IMMUTABLE. To correct a posted entry, create a new
  -- reversal entry."), so it must never be stamped with a follow-up UPDATE.
  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id,
    currency, exchange_rate, status, posted_at, posted_by, branch_id, department_id,
    posting_key
  ) values (
    p_business_id, p_entry_number, p_entry_date, p_description, p_source_type,
    nullif(p_source_id, '')::uuid,
    p_currency, p_exchange_rate, 'posted', now(), null, p_branch_id, p_department_id,
    nullif(p_posting_key, '')
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    insert into public.journal_lines (
      journal_entry_id, business_id, line_number, account_id, description,
      is_debit, amount, amount_base, currency, exchange_rate,
      tax_code, tax_amount, reconciled
    ) values (
      v_entry_id, p_business_id, v_line_no,
      public._ledgr_assert_account((v_line->>'account_id')::uuid, p_business_id, 'journal'),
      coalesce(v_line->>'description', p_description),
      (v_line->>'is_debit')::boolean,
      (v_line->>'amount')::numeric,
      (v_line->>'amount_base')::numeric,
      p_currency, p_exchange_rate,
      coalesce(v_line->>'tax_code', 'none')::public.tax_code,
      coalesce((v_line->>'tax_amount')::numeric, 0),
      false
    );
  end loop;

  return v_entry_id;
end;
$$;

-- The historical 11-arg shape every existing caller uses (save_quick_sale,
-- save_quick_expense, ledgr_repair, …): unchanged behaviour — an unkeyed
-- entry — now via the overload above so the insert logic stays single-source.
create or replace function public._ledgr_post_entry(
  p_business_id uuid,
  p_entry_number text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id text,
  p_currency text,
  p_exchange_rate numeric,
  p_branch_id uuid,
  p_department_id uuid,
  p_lines jsonb     -- [{account_id, description, is_debit, amount, amount_base, tax_code, tax_amount}]
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return public._ledgr_post_entry(
    p_business_id,
    p_entry_number,
    p_entry_date, p_description, p_source_type, p_source_id,
    p_currency, p_exchange_rate, p_branch_id, p_department_id, p_lines,
    null::text
  );
end;
$$;

revoke all on function public._ledgr_post_entry(uuid, text, date, text, text, text, text, numeric, uuid, uuid, jsonb) from public, anon;
revoke all on function public._ledgr_post_entry(uuid, text, date, text, text, text, text, numeric, uuid, uuid, jsonb, text) from public, anon;
comment on function public._ledgr_post_entry(uuid, text, date, text, text, text, text, numeric, uuid, uuid, jsonb, text) is
  '12-arg keyed overload (20261015000000): journal entry + lines + immediate posting with posting_key written on the header INSERT — a posted entry is immutable, so the key is never stamped with a follow-up UPDATE. 11-arg shape delegates here with a null key.';

-- ── 2. _ledgr_post_entry_keyed: post-or-resume, no UPDATE of the entry ──────
create or replace function public._ledgr_post_entry_keyed(
  p_business_id uuid,
  p_posting_key text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id text,
  p_currency text,
  p_exchange_rate numeric,
  p_branch_id uuid,
  p_department_id uuid,
  p_lines jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.journal_entries
   where business_id = p_business_id
     and posting_key = p_posting_key
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- 20261015000000: post with the key in the INSERT. The previous shape
  -- inserted the entry already posted and then ran
  -- `update journal_entries set posting_key = …` — a modification of a
  -- posted entry, which the production immutability guard rejects
  -- (2026-09-27 warehouse receipt failure).
  return public._ledgr_post_entry(
    p_business_id,
    public.next_journal_entry_number(p_business_id),
    p_entry_date, p_description, p_source_type, p_source_id,
    p_currency, p_exchange_rate, p_branch_id, p_department_id, p_lines,
    p_posting_key
  );
end;
$$;

revoke all on function public._ledgr_post_entry_keyed(uuid,text,date,text,text,text,text,numeric,uuid,uuid,jsonb) from public;
comment on function public._ledgr_post_entry_keyed(uuid,text,date,text,text,text,text,numeric,uuid,uuid,jsonb) is
  'Post a journal entry under a deterministic posting_key, or return the entry that key already produced (resume-or-post). 20261015000000: the key is written with the INSERT via the 12-arg _ledgr_post_entry — posted entries are never UPDATEd. Relies on the (business_id, posting_key) unique index from 20260921000000 to deduplicate races.';

-- ── 3. _ledgr_post_cogs: keyed overload passes the key to the INSERT ────────
-- COGS posting for a sale (mirrors postCogsForSale: per-product inventory and
-- COGS accounts, zero-cost lines skipped, nothing posted below tolerance).
-- Returns the entry id, or null when no cost was recognised. p_posting_key
-- (20261015000000) is written with the INSERT — callers no longer stamp it
-- with an UPDATE on the posted entry.
create or replace function public._ledgr_post_cogs(
  p_business_id uuid,
  p_invoice_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_branch_id uuid,
  p_department_id uuid,
  p_cost_lines jsonb,  -- [{product_id, quantity, unit_cost}]
  p_posting_key text   -- deterministic posting key, or null for an unkeyed entry
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business_currency text;
  v_line jsonb;
  v_product record;
  v_cost numeric;
  v_total numeric := 0;
  v_inv_account uuid;
  v_cogs_account uuid;
  v_lines jsonb := '[]'::jsonb;
begin
  if p_cost_lines is null or jsonb_typeof(p_cost_lines) <> 'array' then
    return null;
  end if;

  select coalesce(base_currency, 'MWK') into v_business_currency
    from public.businesses where id = p_business_id;

  for v_line in select * from jsonb_array_elements(p_cost_lines) loop
    select * into v_product
      from public.products
     where id = (v_line->>'product_id')::uuid
       and business_id = p_business_id
       and track_inventory = true;
    continue when not found;

    v_cost := round(((v_line->>'quantity')::numeric * (v_line->>'unit_cost')::numeric)::numeric, 2);
    continue when v_cost < 0.005;

    -- product account overrides, else chart defaults (1141 / 5100)
    v_inv_account := v_product.inventory_account_id;
    if v_inv_account is not null then
      begin
        v_inv_account := public._ledgr_assert_account(v_inv_account, p_business_id, 'inventory');
      exception when others then v_inv_account := null;
      end;
    end if;
    if v_inv_account is null then
      v_inv_account := public._ledgr_account_by_code(p_business_id, '1141');
    end if;

    v_cogs_account := v_product.cogs_account_id;
    if v_cogs_account is not null then
      begin
        v_cogs_account := public._ledgr_assert_account(v_cogs_account, p_business_id, 'cost of sales');
      exception when others then v_cogs_account := null;
      end;
    end if;
    if v_cogs_account is null then
      v_cogs_account := public._ledgr_account_by_code(p_business_id, '5100');
    end if;

    v_total := v_total + v_cost;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', v_cogs_account, 'is_debit', true,
        'amount', v_cost, 'amount_base', v_cost,
        'description', 'Cost of sales — Invoice ' || p_invoice_number),
      jsonb_build_object('account_id', v_inv_account, 'is_debit', false,
        'amount', v_cost, 'amount_base', v_cost,
        'description', 'Stock released — Invoice ' || p_invoice_number)
    );
  end loop;

  if v_total < 0.005 then
    return null;
  end if;

  return public._ledgr_post_entry(
    p_business_id,
    'JNL-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-COGS',
    p_issue_date,
    'Cost of goods sold — Invoice ' || p_invoice_number,
    'inventory_cogs',
    p_invoice_id::text,
    v_business_currency,
    1,
    p_branch_id, p_department_id,
    v_lines,
    p_posting_key
  );
end;
$$;

-- Historical 7-arg shape (save_quick_sale and the 2026-10-07 quick-sale
-- body): unchanged behaviour — an unkeyed COGS entry — via the overload.
create or replace function public._ledgr_post_cogs(
  p_business_id uuid,
  p_invoice_id uuid,
  p_invoice_number text,
  p_issue_date date,
  p_branch_id uuid,
  p_department_id uuid,
  p_cost_lines jsonb   -- [{product_id, quantity, unit_cost}]
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return public._ledgr_post_cogs(
    p_business_id, p_invoice_id, p_invoice_number, p_issue_date,
    p_branch_id, p_department_id, p_cost_lines,
    null::text
  );
end;
$$;

revoke all on function public._ledgr_post_cogs(uuid, uuid, text, date, uuid, uuid, jsonb) from public, anon;
revoke all on function public._ledgr_post_cogs(uuid, uuid, text, date, uuid, uuid, jsonb, text) from public, anon;

-- ── 4. _ledgr_complete_pos_sale: keyed COGS, no posting_key UPDATE ──────────
-- Body = 20261013000000 (owner decisions D-PRICE / D-BRANCH) with only the
-- COGS key-stamp moved into the insert.
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
     where business_id = p_business_id and source_type = 'invoice' and source_id::text = p_invoice_id::text
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
          'invoice', p_invoice_id, v_inv.invoice_number, v_inv.created_by
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
          v_inv.branch_id, v_inv.department_id, v_cost_lines,
          'invoice:' || p_invoice_id::text || ':cogs'
        );
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

-- ── 5. record_sale_stock_and_cogs: keyed COGS, no posting_key UPDATE ────────
-- Body = 20261011000005 (H-1 hardening) with only the COGS key-stamp moved
-- into the insert.
create or replace function public.record_sale_stock_and_cogs(
  p_invoice_id uuid,
  p_lines jsonb          -- [{product_id, quantity}]
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_location uuid;
  v_line record;
  v_product public.products%rowtype;
  v_unit_cost numeric;
  v_cost_lines jsonb := '[]'::jsonb;
  v_cogs_entry uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_invoice_id is null then
    raise exception 'Invoice id is required.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Malformed stock lines payload.' using errcode = '22023';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found or you lack permission to release its stock.' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
       public.can_write_sales_data(v_inv.business_id)
       and public.can_access_branch(v_inv.business_id, v_inv.branch_id)) then
    raise exception 'Invoice not found or you lack permission to release its stock.' using errcode = '42501';
  end if;
  if v_inv.status::text in ('draft', 'void', 'credit_note') or coalesce(v_inv.invoice_type, '') = 'credit_note' then
    raise exception 'Stock is not released for a % invoice.', v_inv.status using errcode = '23514';
  end if;

  -- Idempotency: the invoice row lock serialises concurrent attempts.
  if exists (select 1 from public.stock_movements
              where business_id = v_inv.business_id and source_type = 'invoice'
                and source_id::text = v_inv.id::text) then
    select id into v_cogs_entry from public.journal_entries
     where business_id = v_inv.business_id and posting_key = 'invoice:' || v_inv.id::text || ':cogs';
    return jsonb_build_object('idempotent', true, 'cogs_entry_id', v_cogs_entry,
      'cogs_missing', v_cogs_entry is null, 'cost_lines', '[]'::jsonb);
  end if;

  v_location := public._ledgr_stock_location(v_inv.business_id, v_inv.branch_id);
  if v_location is null then
    return jsonb_build_object('idempotent', false, 'no_location', true, 'cogs_entry_id', null, 'cost_lines', '[]'::jsonb);
  end if;

  for v_line in
    select (l->>'product_id')::uuid as product_id, sum((l->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_lines) l
     where nullif(l->>'product_id', '') is not null
     group by 1
  loop
    if coalesce(v_line.quantity, 0) <= 0 then continue; end if;
    select * into v_product from public.products
     where id = v_line.product_id and business_id = v_inv.business_id;
    if not found then
      raise exception 'Product % does not belong to this business.', v_line.product_id using errcode = '42501';
    end if;
    if not coalesce(v_product.track_inventory, false) then continue; end if;

    -- Average cost BEFORE the movement (the balance trigger re-averages on insert).
    select coalesce(average_cost, 0) into v_unit_cost from public.inventory_balances
     where business_id = v_inv.business_id and product_id = v_product.id and location_id = v_location;
    v_unit_cost := coalesce(v_unit_cost, 0);

    insert into public.stock_movements (
      business_id, product_id, location_id, movement_type, movement_date,
      quantity, unit_cost, source_type, source_id, reference, created_by
    ) values (
      v_inv.business_id, v_product.id, v_location, 'sale',
      coalesce(v_inv.issue_date, current_date), -v_line.quantity, v_unit_cost,
      'invoice', v_inv.id, v_inv.invoice_number, v_inv.created_by
    );
    v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'quantity', v_line.quantity, 'unit_cost', v_unit_cost));
  end loop;

  if jsonb_array_length(v_cost_lines) > 0 then
    begin
      v_cogs_entry := public._ledgr_post_cogs(
        v_inv.business_id, v_inv.id, v_inv.invoice_number,
        coalesce(v_inv.issue_date, current_date),
        v_inv.branch_id, v_inv.department_id, v_cost_lines,
        'invoice:' || v_inv.id::text || ':cogs');
    exception when others then
      raise exception 'COGS posting failed for invoice %: %. Stock was not released; fix the cause and retry.',
        v_inv.invoice_number, sqlerrm using errcode = 'P0001';
    end;
  end if;

  return jsonb_build_object('idempotent', false, 'cogs_entry_id', v_cogs_entry,
    'cogs_missing', false, 'cost_lines', v_cost_lines);
end;
$$;

revoke all on function public.record_sale_stock_and_cogs(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_stock_and_cogs(uuid, jsonb) to authenticated, service_role;

-- ── 6. ledgr_repair.apply_2026_09: keyed COGS, no posting_key UPDATE ────────
-- Body = 20261013000001 with only the D2 COGS key-stamp moved into the
-- insert, so the operator repair cannot trip the immutability guard either.
create or replace function ledgr_repair.apply_2026_09(
  p_evidence_ref text, p_expected_plan_hash text, p_business uuid default null
) returns jsonb
language plpgsql volatile set search_path = public
as $$
declare
  v_hash text;
  v_run uuid;
  r record;
  v_inv public.invoices%rowtype;
  v_entry uuid;
  v_lines jsonb;
  v_n1 int := 0; v_n2 int := 0; v_n3 int := 0;
  v_sub numeric; v_gl numeric; v_var numeric; v_proj numeric;
  v_inv_acct uuid; v_adj_acct uuid; v_ccy text;
begin
  if p_evidence_ref is null or length(btrim(p_evidence_ref)) < 8 then
    raise exception 'Refused: an evidence reference (P0 evidence-preservation snapshot/export id) is required before any repair.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ledgr_repair_2026_09', 0));
  v_hash := ledgr_repair.plan_hash_2026_09(p_business);
  if p_expected_plan_hash is null or v_hash <> p_expected_plan_hash then
    raise exception 'Refused: the plan changed since it was reviewed (expected %, now %). Re-run sizing and review again.',
      coalesce(p_expected_plan_hash, '<none>'), v_hash using errcode = '22023';
  end if;

  insert into ledgr_repair.runs (evidence_ref, plan_hash, business_id)
  values (btrim(p_evidence_ref), v_hash, p_business) returning run_id into v_run;

  drop table if exists pg_temp._plan;
  create temporary table _plan on commit drop as select * from ledgr_repair.plan_2026_09(p_business);

  -- D1: compensating movements (balance via the R06 trigger).
  for r in select * from _plan where category = 'D1_INVALID_SALE_MOVEMENT' order by business_id, object_ref, product_id loop
    insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, notes)
    values (r.business_id, r.product_id, r.location_id, 'adjustment_in', current_date,
        r.quantity, coalesce((r.detail->>'unit_cost')::numeric, 0), 'repair_2026_09', r.object_ref::uuid,
        'Repair 2026-09: reverse invalid sale release on ' || coalesce(r.detail->>'invoice_status', '') || ' invoice ' || coalesce(r.detail->>'invoice_number', r.object_ref),
        'evidence ' || btrim(p_evidence_ref) || ' · run ' || v_run);
    insert into ledgr_repair.repair_log (run_id, business_id, category, object_ref, detail)
    values (v_run, r.business_id, r.category, r.object_ref, to_jsonb(r));
    v_n1 := v_n1 + 1;
  end loop;

  -- D2: missing COGS, one keyed entry per invoice.
  for r in select business_id, object_ref,
                  jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity,
                            'unit_cost', round(amount / nullif(quantity, 0), 6))) cost_lines,
                  sum(amount) total
             from _plan where category = 'D2_MISSING_COGS'
            group by business_id, object_ref order by business_id, object_ref loop
    select * into v_inv from public.invoices where id = r.object_ref::uuid;
    v_entry := public._ledgr_post_cogs(v_inv.business_id, v_inv.id, v_inv.invoice_number,
      -- The sale date if its period is open, else today: corrections never post
      -- into a closed period (20261014000000 period lock; IAS 8 current-period
      -- correction of an immaterial prior-period error).
      case when v_inv.issue_date is not null and not exists (
             select 1 from public.accounting_periods ap where ap.business_id = v_inv.business_id and ap.is_closed
                and v_inv.issue_date between ap.period_start and ap.period_end)
           then v_inv.issue_date else current_date end,
      v_inv.branch_id, v_inv.department_id, r.cost_lines,
      'invoice:' || v_inv.id::text || ':cogs');
    insert into ledgr_repair.repair_log (run_id, business_id, category, object_ref, detail)
    values (v_run, r.business_id, 'D2_MISSING_COGS', r.object_ref,
            jsonb_build_object('journal_entry_id', v_entry, 'amount', r.total, 'cost_lines', r.cost_lines));
    v_n2 := v_n2 + 1;
  end loop;

  -- D3: true-up per business on the ACTUAL post-D1/D2 figures; must match the
  -- reviewed projection (value is additive), otherwise roll everything back.
  for r in select * from _plan where category = 'D3_GL_RECONCILIATION' order by business_id loop
    v_sub := round(ledgr_repair._subledger_value(r.business_id), 2);
    v_gl := round(ledgr_repair._gl_inventory(r.business_id), 2);
    v_var := v_sub - v_gl;
    v_proj := r.amount;
    if abs(v_var - v_proj) > 0.05 then
      raise exception 'Refused: business % reconciliation moved from the reviewed % to % during apply; nothing was changed.',
        r.business_id, v_proj, v_var using errcode = 'P0001';
    end if;
    if abs(v_var) >= 0.01 then
      v_inv_acct := public._ledgr_account_by_code(r.business_id, '1141');
      v_adj_acct := public._ledgr_account_by_code(r.business_id, '5180');
      select coalesce(base_currency, 'MWK') into v_ccy from public.businesses where id = r.business_id;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_inv_acct, 'is_debit', v_var > 0, 'amount', abs(v_var), 'amount_base', abs(v_var),
                           'description', 'Repair 2026-09: inventory GL to stock subledger'),
        jsonb_build_object('account_id', v_adj_acct, 'is_debit', v_var < 0, 'amount', abs(v_var), 'amount_base', abs(v_var),
                           'description', 'Repair 2026-09: inventory GL to stock subledger'));
      v_entry := public._ledgr_post_entry_keyed(r.business_id,
        'repair:2026-09:inventory-reconciliation:' || r.business_id::text || ':' || v_run::text, current_date,
        'Inventory reconciliation — historical repair 2026-09 (evidence ' || btrim(p_evidence_ref) || ')',
        'inventory_reconciliation', v_run::text, v_ccy, 1, null, null, v_lines);
      insert into ledgr_repair.repair_log (run_id, business_id, category, object_ref, detail)
      values (v_run, r.business_id, r.category, r.object_ref,
              jsonb_build_object('journal_entry_id', v_entry, 'subledger', v_sub, 'gl_before', v_gl, 'variance', v_var, 'projected', v_proj));
      v_n3 := v_n3 + 1;
    end if;
  end loop;

  update ledgr_repair.runs set summary = jsonb_build_object(
    'd1_movements', v_n1, 'd2_cogs_entries', v_n2, 'd3_reconciliations', v_n3,
    'd0_drift_rows_reported', (select count(*) from _plan where category = 'D0_QTY_DRIFT'))
   where run_id = v_run;
  return jsonb_build_object('run_id', v_run, 'plan_hash', v_hash,
    'd1_movements', v_n1, 'd2_cogs_entries', v_n2, 'd3_reconciliations', v_n3,
    'remaining_plan_hash', ledgr_repair.plan_hash_2026_09(p_business));
end;
$$;

revoke all on all functions in schema ledgr_repair from public, anon, authenticated;

-- ── Invariant: no migration-created code path UPDATEs a posted journal entry
-- to stamp a posting key any more. grep the chain with:
--   grep -rnE "update\s+(public\.)?journal_entries\s+set\s+posting_key" supabase/migrations/
-- (the only remaining hits are the superseded history above).
