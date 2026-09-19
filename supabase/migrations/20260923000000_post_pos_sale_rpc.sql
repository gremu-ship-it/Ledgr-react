-- ============================================================================
-- 20260923000000_post_pos_sale_rpc.sql
--
-- Stage 1 of docs/database/pos-sale-posting-rpc.md: the server-side posting
-- path for a POS sale, so that a cashier never needs to write the ledger.
--
-- WHY
-- --
-- The till currently posts its own sale from the browser: invoices,
-- invoice_lines, invoice_payments, stock movements and the revenue/receipt
-- journal entries (src/services/posService.commitPosSaleDocuments). That is why
-- a cashier still holds INSERT on the ledger tables after
-- 20260922000000_pos_role_write_scope — and therefore why a cashier session can
-- reach the ledger at all. Moving the write behind this RPC is what makes
-- closing it possible.
--
-- STAGE 1 ONLY. This migration is additive: it creates functions and grants and
-- touches no policy and no data. Nothing is required to call it — the client
-- falls back to the current path whenever the function is absent (stage 2 in
-- the design doc switches the client over; stage 3, a separate migration,
-- narrows the policies and is only safe once stage 2 is deployed everywhere).
--
-- DESIGN CONTRACT (same "hybrid executor" shape as 20260911000001)
-- ----------------------------------------------------------------
--   * The client keeps computing policy inputs: FX rate, VAT and discount
--     maths, revenue/AR account resolution, tender → account mapping. The RPC
--     validates and commits the whole sale — document, tenders, ledger, stock —
--     in ONE transaction, or nothing at all.
--   * Idempotent on (business_id, client_key), like createWithLines: a retried
--     sale (lost response, offline queue replay) returns the committed document
--     instead of duplicating it.
--   * A replay does not merely return early: it COMPLETES the sale.
--     commitPosSaleDocuments tolerates a commit whose follow-up steps failed
--     (the sale stands, a warning is shown), so the retry of such a sale must
--     still post the missing ledger/stock half. Skipping that would turn a
--     recoverable half-posted sale into a permanently unposted one — the exact
--     failure mode the legacy path's per-step guards exist to repair.
--   * Deliberately NOT done here: refunds (processReturn) and voids
--     (processVoid). Both write invoices/invoice_lines/journal (void also
--     UPDATEs journal_entries for the reversal) and need the same treatment
--     before stage 3 covers their tables. Tracked in the design doc §2.
--
-- PARITY — this must produce the same books as the TypeScript path it replaces
--   * Accounts by code: 1131 debtors, 4112 (or the invoice's revenue_account_id)
--     revenue, 4130 discount allowed, 2121 VAT payable, 1110 cash for an
--     unmapped tender, and product inventory_account_id / cogs_account_id
--     overrides for COGS (via the existing _ledgr_post_cogs).
--   * Sale entry: DR debtors total / CR revenue (gross when discounted, net
--     otherwise) / DR discount / CR VAT — the shape of
--     journalService.createInvoiceReceivableEntry.
--   * One settlement entry per tender, each debiting the account the money
--     actually landed in (invoice_payments.bank_account_id, resolved
--     client-side) — the shape of createInvoiceSettlementEntry.
--   * Posting keys are the same strings the TS path uses
--     (invoice:<id>:sale, invoice:<id>:settlement:<payment id>,
--     invoice:<id>:cogs) so the two implementations cannot double-post the
--     same sale while stage 2's fallback exists.
--   * Stock: movements dated at issue_date, unit cost read from the balance
--     BEFORE the movement lands; a COGS failure is a warning, never a sale
--     failure (same tolerance as postCogsForSale / _ledgr_post_cogs).
--   * Drawer totals: only while the shift is open — a closed shift has been
--     counted and signed (see applyShiftTotals in posService).
--
-- IDEMPOTENT MIGRATION: create-or-replace + grants. No data changes.
-- ============================================================================


-- ── 1. Who may operate a till ────────────────────────────────────────────────
-- The sales-side writer tier. Excludes stock_clerk (no sales duty), and the
-- read-only roles (viewer, auditor, board_member, payroll_manager).
-- SECURITY DEFINER so the RPC can consult business_users, search_path pinned
-- per Supabase linter 0011.

create or replace function public.can_operate_pos(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        'owner',
        'admin',
        'cashier',
        'manager',
        'sales_clerk',
        'sales_manager',
        'branch_manager',
        'customer_service_rep'
      )
  );
$$;

comment on function public.can_operate_pos(uuid) is
  'True when the caller may record sales for the business (till roles). Guard for post_pos_sale; mirrors the POS permission set in src/types/pos.ts. Judge of "may sell", not "may write the ledger" — see can_write_ledger_directly in the stage 3 migration.';

revoke all on function public.can_operate_pos(uuid) from public;
grant execute on function public.can_operate_pos(uuid) to authenticated, service_role;


-- ── 2. Keyed posting: resume-or-post ─────────────────────────────────────────
-- journal_entries.posting_key (20260921000000) already makes postings
-- idempotent *client-side*: the TS path looks the key up and skips. This is
-- the same rule expressed once, in SQL, so the RPC can post a sale, a
-- settlement and a COGS entry in one transaction and a replay can resume any
-- half that is missing.

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

  v_id := public._ledgr_post_entry(
    p_business_id,
    public.next_journal_entry_number(p_business_id),
    p_entry_date, p_description, p_source_type, p_source_id,
    p_currency, p_exchange_rate, p_branch_id, p_department_id, p_lines
  );

  update public.journal_entries set posting_key = p_posting_key where id = v_id;
  return v_id;
end;
$$;

comment on function public._ledgr_post_entry_keyed(uuid,text,date,text,text,text,text,numeric,uuid,uuid,jsonb) is
  'Post a journal entry under a deterministic posting_key, or return the entry that key already produced. Internal helper for post_pos_sale; wraps _ledgr_post_entry (20260911000001) and relies on the (business_id, posting_key) unique index from 20260921000000.';

revoke all on function public._ledgr_post_entry_keyed(uuid,text,date,text,text,text,text,numeric,uuid,uuid,jsonb) from public;


-- ── 3. Customer resolution ───────────────────────────────────────────────────
-- Mirrors resolveSaleContact in posService: a till can hold a walk-in
-- sentinel, or a contact invented while offline, so the RPC resolves or
-- creates the contact itself. Without this a cashier would still need INSERT
-- on contacts after stage 3.

create or replace function public._ledgr_resolve_sale_contact(
  p_business_id uuid,
  p_contact_id text,
  p_customer jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_customer->>'name', ''));
  v_is_walk_in boolean;
  v_new_id uuid;
begin
  -- A real server id for this business is used as-is.
  if p_contact_id is not null and p_contact_id ~ '^[0-9a-fA-F-]{36}$' then
    select id into v_id
      from public.contacts
     where id = p_contact_id::uuid
       and business_id = p_business_id
       and deleted_at is null
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- coalesce is load-bearing: with a null contact_id the third predicate would
  -- evaluate to NULL, and `IF NOT v_is_walk_in` is then also NULL (not false),
  -- so a named customer would silently fall through to the walk-in branch.
  v_is_walk_in := v_name = ''
    or v_name ~* '^walk[\s-]?in'
    or coalesce(p_contact_id, '') = 'offline_walk_in_customer';

  if not v_is_walk_in then
    -- A named customer: reuse an existing contact with the same name (keeps
    -- retries from piling up duplicates), else create it now.
    select id into v_id
      from public.contacts
     where business_id = p_business_id
       and contact_type = 'customer'
       and is_active = true
       and deleted_at is null
       and lower(btrim(name)) = lower(v_name)
     order by created_at
     limit 1;
    if v_id is not null then
      return v_id;
    end if;

    -- wht_exempt is NOT NULL with no default (see 20250101000000); the UI form
    -- passes false explicitly, and resolveSaleContact in posService omits it —
    -- which fails on a schema without the out-of-band default. Pass it.
    insert into public.contacts (
      business_id, name, contact_type, is_active, phone, email, wht_exempt
    ) values (
      p_business_id, v_name, 'customer', true,
      nullif(btrim(coalesce(p_customer->>'phone', '')), ''),
      nullif(btrim(coalesce(p_customer->>'email', '')), ''),
      false
    ) returning id into v_new_id;
    return v_new_id;
  end if;

  -- Walk-in: the named default customer if the business has one, else its
  -- first active customer — same order as ContactRepository.findDefaultSaleContact.
  select id into v_id
    from public.contacts
   where business_id = p_business_id
     and contact_type = 'customer'
     and is_active = true
     and deleted_at is null
     and name = 'Walk-in Customer'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select id into v_id
    from public.contacts
   where business_id = p_business_id
     and contact_type = 'customer'
     and is_active = true
     and deleted_at is null
   order by name
   limit 1;

  if v_id is null then
    raise exception 'This sale has no customer and the business has no customer contact to bill it to. Add a customer first.'
      using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

comment on function public._ledgr_resolve_sale_contact(uuid,text,jsonb) is
  'Resolve the contact a POS sale is billed to, tolerating a walk-in sentinel or an offline-created customer (creates it when named). Mirrors resolveSaleContact in src/services/posService.ts so a cashier needs no direct INSERT on contacts.';

revoke all on function public._ledgr_resolve_sale_contact(uuid,text,jsonb) from public;


-- ── 4. Completion: ledger, stock and COGS for an existing sale ───────────────
-- Reads the stored invoice and its tenders so it produces identical books
-- whether it runs right after the insert or on a replay that has to fill in a
-- missing half. Every posting is keyed, so a second run is a no-op.

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
    v_location := public._ledgr_stock_location(p_business_id, v_inv.branch_id);

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
        -- Same tolerance as postCogsForSale: a stock-valuation problem must not
        -- block or invalidate the sale; the variance shows in reconciliation.
        raise warning 'COGS posting failed for invoice %: %', v_inv.invoice_number, sqlerrm;
        v_cogs_entry := null;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_sale_entry,
    'cogs_entry_id', v_cogs_entry
  );
end;
$$;

comment on function public._ledgr_complete_pos_sale(uuid,uuid) is
  'Post the ledger, stock release and COGS for an already-written POS sale, from the stored invoice and its tenders. Keyed throughout, so running it after the insert and running it on a replay are both safe; this is what lets a retried sale repair a missing half instead of skipping it. Internal to post_pos_sale.';

revoke all on function public._ledgr_complete_pos_sale(uuid,uuid) from public;


-- ── 5. The RPC ───────────────────────────────────────────────────────────────

create or replace function public.post_pos_sale(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (p_payload->>'business_id')::uuid;
  v_client_key uuid := (p_payload->>'client_key')::uuid;
  v_invoice jsonb := p_payload->'invoice';
  v_lines jsonb := p_payload->'lines';
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_is_credit boolean := coalesce((p_payload->>'is_credit_sale')::boolean, false);
  v_shift uuid := (p_payload->>'shift_id')::uuid;
  v_existing record;
  v_completion jsonb;
  v_contact uuid;
  v_number text;
  v_invoice_id uuid;

  v_total numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_vat numeric;
  v_rate numeric;
  v_currency text;
  v_functional numeric;
  v_paid numeric := 0;

  v_payment jsonb;
  v_payment_key uuid;
  v_payment_id uuid;
  v_tender uuid;
begin
  -- 1. Authorization. SECURITY DEFINER, so this guard is mandatory, not
  --    decorative.
  if v_business_id is null or not public.can_operate_pos(v_business_id) then
    raise exception 'You do not have permission to record sales for this business.'
      using errcode = '42501';
  end if;

  -- 2. Idempotency. A replay returns the committed document AND completes it,
  --    because the commit it is retrying may have died between the invoice and
  --    its ledger/stock half (see the header).
  if v_client_key is not null then
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;

    if found then
      v_completion := public._ledgr_complete_pos_sale(v_business_id, v_existing.id);
      return jsonb_build_object(
        'id', v_existing.id,
        'number', v_existing.invoice_number,
        'journal_entry_id', coalesce(v_existing.journal_entry_id, (v_completion->>'journal_entry_id')::uuid),
        'idempotent', true
      );
    end if;
  end if;

  -- 3. Validate. The RPC is an executor: the client already resolved accounts
  --    and computed VAT/discount/functional amounts.
  if v_invoice is null or jsonb_typeof(v_invoice) <> 'object'
     or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Malformed POS sale payload.' using errcode = 'P0001';
  end if;

  v_total    := (v_invoice->>'total_amount')::numeric;
  v_subtotal := coalesce((v_invoice->>'subtotal')::numeric, 0);
  v_discount := coalesce((v_invoice->>'discount_amount')::numeric, 0);
  v_vat      := coalesce((v_invoice->>'vat_amount')::numeric, 0);
  v_rate     := coalesce((v_invoice->>'exchange_rate')::numeric, 1);
  v_currency := coalesce(v_invoice->>'original_currency', v_invoice->>'currency');
  v_functional := coalesce((v_invoice->>'functional_amount')::numeric, v_total * v_rate);

  if v_total is null or v_total <= 0 then
    raise exception 'Enter a valid sale total.' using errcode = 'P0001';
  end if;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Enter a valid exchange rate for this sale.' using errcode = 'P0001';
  end if;

  select coalesce(sum((p->>'amount')::numeric), 0)
    into v_paid
    from jsonb_array_elements(v_payments) p;

  if not v_is_credit and abs(v_paid - v_total) > 0.01 then
    raise exception 'Tenders (%) do not settle the sale total (%).',
      round(v_paid, 2), round(v_total, 2) using errcode = 'P0001';
  end if;
  if v_is_credit and jsonb_array_length(v_payments) > 0 then
    raise exception 'A credit sale cannot carry tender lines.' using errcode = 'P0001';
  end if;

  -- 4. Plan limit, then the document number (an offline placeholder becomes a
  --    real number here).
  perform public._ledgr_assert_usage_limit(v_business_id);
  v_number := public.reserve_next_document_number(v_business_id, 'invoice');

  -- 5. The customer, resolved or created in SQL so the till needs no direct
  --    write on contacts.
  v_contact := public._ledgr_resolve_sale_contact(
    v_business_id, v_invoice->>'contact_id', coalesce(p_payload->'customer', '{}'::jsonb)
  );

  -- 6. Document + lines. The unique (business_id, client_key) index is the
  --    backstop for a concurrent double-submit.
  begin
    insert into public.invoices (
      business_id, invoice_number, invoice_type, status, contact_id,
      issue_date, due_date, currency, exchange_rate,
      original_currency, original_amount, functional_currency, functional_amount,
      rate_date, rate_is_stale, subtotal, discount_amount, discount_percent,
      taxable_amount, vat_amount, wht_amount, total_amount, amount_paid,
      ar_account_id, revenue_account_id, notes,
      branch_id, department_id, created_by, client_key
    ) values (
      v_business_id,
      v_number,
      coalesce(v_invoice->>'invoice_type', 'invoice'),
      coalesce(v_invoice->>'status', 'paid')::public.invoice_status,
      v_contact,
      (v_invoice->>'issue_date')::date,
      coalesce((v_invoice->>'due_date')::date, (v_invoice->>'issue_date')::date),
      coalesce(v_invoice->>'currency', v_currency),
      v_rate,
      v_currency,
      (v_invoice->>'original_amount')::numeric,
      v_invoice->>'functional_currency',
      v_functional,
      (v_invoice->>'rate_date')::date,
      coalesce((v_invoice->>'rate_is_stale')::boolean, false),
      v_subtotal,
      v_discount,
      coalesce((v_invoice->>'discount_percent')::numeric, 0),
      coalesce((v_invoice->>'taxable_amount')::numeric, v_subtotal),
      v_vat,
      coalesce((v_invoice->>'wht_amount')::numeric, 0),
      v_total,
      v_paid,
      (v_invoice->>'ar_account_id')::uuid,
      (v_invoice->>'revenue_account_id')::uuid,
      coalesce(v_invoice->>'notes', v_invoice->>'description'),
      (v_invoice->>'branch_id')::uuid,
      (v_invoice->>'department_id')::uuid,
      v_invoice->>'created_by',
      v_client_key
    ) returning id into v_invoice_id;
  exception when unique_violation then
    -- Lost a race with a retry of the same sale: fall in behind it.
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;
    if not found then
      raise;
    end if;
    v_completion := public._ledgr_complete_pos_sale(v_business_id, v_existing.id);
    return jsonb_build_object(
      'id', v_existing.id,
      'number', v_existing.invoice_number,
      'journal_entry_id', coalesce(v_existing.journal_entry_id, (v_completion->>'journal_entry_id')::uuid),
      'idempotent', true
    );
  end;

  insert into public.invoice_lines (
    business_id, invoice_id, line_number, description, quantity, unit_price,
    discount_percent, discount_amount, tax_code, tax_rate, tax_amount, line_total,
    product_id, account_id
  )
  select
    v_business_id, v_invoice_id,
    coalesce((l->>'line_number')::numeric, row_number() over ()),
    l->>'description',
    (l->>'quantity')::numeric,
    (l->>'unit_price')::numeric,
    coalesce((l->>'discount_percent')::numeric, 0),
    coalesce((l->>'discount_amount')::numeric, 0),
    coalesce(l->>'tax_code', 'none')::public.tax_code,
    coalesce((l->>'tax_rate')::numeric, 0),
    coalesce((l->>'tax_amount')::numeric, 0),
    (l->>'line_total')::numeric,
    (l->>'product_id')::uuid,
    (l->>'account_id')::uuid
  from jsonb_array_elements(v_lines) l;

  -- 7. Tenders. Each row carries the key the client minted for it
  --    (deriveClientKey(clientKey, index)); the unique index makes a retry a
  --    no-op, and the stored row id is what the settlement entry is keyed by.
  for v_payment in select * from jsonb_array_elements(v_payments) loop
    v_payment_key := coalesce((v_payment->>'client_key')::uuid, gen_random_uuid());
    v_tender := (v_payment->>'bank_account_id')::uuid;
    if v_tender is null then
      v_tender := public._ledgr_account_by_code(v_business_id, '1110');
    end if;

    insert into public.invoice_payments (
      business_id, invoice_id, amount, currency, exchange_rate,
      original_amount, original_currency, functional_amount,
      payment_date, payment_method, bank_account_id, reference, created_by, client_key
    ) values (
      v_business_id, v_invoice_id, (v_payment->>'amount')::numeric,
      coalesce(v_payment->>'currency', v_currency),
      coalesce((v_payment->>'exchange_rate')::numeric, v_rate),
      coalesce((v_payment->>'original_amount')::numeric, (v_payment->>'amount')::numeric),
      coalesce(v_payment->>'original_currency', v_currency),
      coalesce((v_payment->>'functional_amount')::numeric, (v_payment->>'amount')::numeric),
      coalesce((v_payment->>'payment_date')::date, (v_invoice->>'issue_date')::date),
      coalesce(v_payment->>'payment_method', 'cash')::public.payment_method,
      v_tender,
      v_payment->>'reference',
      coalesce(v_payment->>'created_by', v_invoice->>'created_by'),
      v_payment_key
    )
    on conflict (business_id, client_key) do nothing;
  end loop;

  -- 8. Ledger, stock and COGS — the same helper the replay path uses.
  v_completion := public._ledgr_complete_pos_sale(v_business_id, v_invoice_id);

  -- 9. Drawer totals, only while the shift is open: a closed shift has been
  --    counted, explained and signed, and rewriting it afterwards would make
  --    the Z-report disagree with the data behind it. The caller surfaces a
  --    warning when a sale lands after its shift closed (applyShiftTotals).
  --    Arithmetic copied from PosRepository.updateShiftTotals, including the
  --    absolute recomputation of expected_cash: the drawer expectation is
  --    opening float + cash sales + cash in − cash out − refunds, so it must be
  --    derived from the shift's own movement columns rather than incremented —
  --    incrementing would ignore a cash-in/cash-out or a refund recorded since.
  if v_shift is not null then
    update public.pos_shifts
       set cash_sales_amount  = cash_sales_amount  + coalesce((p_payload->>'cash_sales')::numeric, 0),
           other_sales_amount = other_sales_amount + coalesce((p_payload->>'other_sales')::numeric, 0),
           total_sales_amount =
             (cash_sales_amount + coalesce((p_payload->>'cash_sales')::numeric, 0))
             + (other_sales_amount + coalesce((p_payload->>'other_sales')::numeric, 0)),
           expected_cash =
             opening_cash
             + (cash_sales_amount + coalesce((p_payload->>'cash_sales')::numeric, 0))
             + cash_in_amount - cash_out_amount - refunds_amount,
           updated_at = now()
     where id = v_shift
       and business_id = v_business_id
       and status = 'open';
  end if;

  return jsonb_build_object(
    'id', v_invoice_id,
    'number', v_number,
    'journal_entry_id', (v_completion->>'journal_entry_id')::uuid,
    'cogs_entry_id', (v_completion->>'cogs_entry_id')::uuid,
    'idempotent', false
  );
end;
$$;

comment on function public.post_pos_sale(jsonb) is
  'Atomic POS sale posting: authorize, de-duplicate by client_key, reserve the number, resolve the customer, write invoice + lines + tenders, post the sale/settlement/COGS entries, release stock and add to the open shift''s drawer totals — one round trip, one transaction, or nothing at all. Executor only: policy inputs (accounts, VAT/discount maths, FX, tender → account mapping) are computed client-side. Exists so a cashier never needs direct INSERT on the ledger tables. See docs/database/pos-sale-posting-rpc.md.';

revoke all on function public.post_pos_sale(jsonb) from public, anon;
grant execute on function public.post_pos_sale(jsonb) to authenticated;
