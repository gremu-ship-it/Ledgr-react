-- Phase 7B: additive server-authoritative POS reporting read surfaces.
-- Existing callers and RPC contracts remain unchanged; the new report details
-- enrich the shift report and owner analytics is a separate aggregate API.

create or replace function public.get_pos_shift_report_details(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_sales record;
  v_tax_breakdown jsonb;
  v_refunds record;
  v_tender_counts jsonb;
  v_cash_movements jsonb;
begin
  if auth.uid() is null then
    raise exception 'Anonymous callers cannot read a shift report.' using errcode = '42501';
  end if;

  select id, business_id, branch_id into v_shift
    from public.pos_shifts where id = p_shift_id;
  if not found then
    raise exception 'Unknown shift.' using errcode = '22023';
  end if;
  if not public.can_access_branch(v_shift.business_id, v_shift.branch_id) then
    raise exception 'Caller has no access to this shift''s branch.' using errcode = '42501';
  end if;

  select count(*)::integer as sales_count,
         coalesce(sum(i.subtotal + i.discount_amount), 0) as gross_sales,
         coalesce(sum(i.discount_amount), 0) as discount_total,
         coalesce(sum(i.total_amount), 0) as net_sales,
         coalesce(sum(i.vat_amount), 0) as tax_total
    into v_sales
    from public.invoices i
   where i.business_id = v_shift.business_id
     and i.pos_shift_id = p_shift_id
     and i.status = 'paid'
     and i.deleted_at is null;

  select coalesce(jsonb_object_agg(x.tax_key, jsonb_build_object(
           'amount', x.tax_amount, 'count', x.line_count
         )), '{}'::jsonb)
    into v_tax_breakdown
    from (
      select concat(l.tax_rate::text, '% ', l.tax_code::text) as tax_key,
             coalesce(sum(l.tax_amount), 0) as tax_amount,
             count(*)::integer as line_count
        from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id and i.business_id = l.business_id
       where i.business_id = v_shift.business_id
         and i.pos_shift_id = p_shift_id
         and i.status = 'paid'
         and i.deleted_at is null
       group by l.tax_rate, l.tax_code
    ) x;

  select count(*)::integer as return_count,
         coalesce(sum(c.amount), 0) as refunds_gross_total
    into v_refunds
    from public.pos_corrections c
    join public.invoices i on i.id = c.document_id
   where c.business_id = v_shift.business_id
     and c.command_type = 'refund_sale'
     and i.business_id = v_shift.business_id
     and i.pos_shift_id = p_shift_id;

  select coalesce(jsonb_object_agg(x.payment_method, x.method_data), '{}'::jsonb)
    into v_tender_counts
    from (
      select p.payment_method::text as payment_method,
             jsonb_build_object('count', count(*)::integer, 'total', coalesce(sum(p.amount), 0)) as method_data
        from public.invoice_payments p
        join public.invoices i on i.id = p.invoice_id and i.business_id = p.business_id
       where i.business_id = v_shift.business_id
         and i.pos_shift_id = p_shift_id
         and i.status = 'paid'
         and i.deleted_at is null
       group by p.payment_method
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'movement_type', m.movement_type,
           'amount', m.amount,
           'reason', m.reason,
           'created_at', m.created_at
         ) order by m.created_at), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.business_id = v_shift.business_id and m.shift_id = p_shift_id;

  return jsonb_build_object(
    'shift_id', p_shift_id,
    'gross_sales', v_sales.gross_sales,
    'discount_total', v_sales.discount_total,
    'net_sales', v_sales.net_sales,
    'tax_total', v_sales.tax_total,
    'tax_breakdown', v_tax_breakdown,
    'sales_count', v_sales.sales_count,
    'return_count', v_refunds.return_count,
    'refunds_gross_total', v_refunds.refunds_gross_total,
    'tender_counts', v_tender_counts,
    'cash_movements', v_cash_movements
  );
end;
$$;

revoke all on function public.get_pos_shift_report_details(uuid) from public, anon;
grant execute on function public.get_pos_shift_report_details(uuid) to authenticated;
comment on function public.get_pos_shift_report_details(uuid) is
  'Additive server-side POS shift report enrichment. Shift-scoped to p_shift_id, member/branch-authorized, and derived from paid invoices, invoice lines/payments, corrections, and cash movements.';

create or replace function public.get_pos_owner_analytics(
  p_business_id uuid,
  p_branch_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sales record;
  v_returns record;
  v_payment_breakdown jsonb;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'Caller is not an active business member.' using errcode = '42501';
  end if;
  if p_branch_id is not null and not public.can_access_branch(p_business_id, p_branch_id) then
    raise exception 'Caller has no access to the selected branch.' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception 'The analytics range must have a start before its end.' using errcode = '22023';
  end if;

  select count(*)::integer as order_count,
         coalesce(sum(i.subtotal + i.discount_amount), 0) as gross_sales,
         coalesce(sum(i.discount_amount), 0) as discount_total,
         coalesce(sum(i.total_amount), 0) as net_sales
    into v_sales
    from public.invoices i
   where i.business_id = p_business_id
     and i.pos_shift_id is not null
     and i.status = 'paid'
     and i.deleted_at is null
     and (p_branch_id is null or i.branch_id = p_branch_id)
     and public.can_access_branch(p_business_id, i.branch_id)
     and (p_from is null or i.created_at >= p_from)
     and (p_to is null or i.created_at < p_to);

  select count(*)::integer as return_count,
         coalesce(sum(c.amount), 0) as refunds_total
    into v_returns
    from public.pos_corrections c
    join public.invoices i on i.id = c.document_id
   where c.business_id = p_business_id
     and c.command_type = 'refund_sale'
     and i.business_id = p_business_id
     and i.pos_shift_id is not null
     and i.status = 'paid'
     and i.deleted_at is null
     and (p_branch_id is null or i.branch_id = p_branch_id)
     and public.can_access_branch(p_business_id, i.branch_id)
     and (p_from is null or c.created_at >= p_from)
     and (p_to is null or c.created_at < p_to);

  select coalesce(jsonb_object_agg(x.payment_method, jsonb_build_object(
           'count', x.payment_count, 'total', x.payment_total
         )), '{}'::jsonb)
    into v_payment_breakdown
    from (
      select p.payment_method::text as payment_method,
             count(*)::integer as payment_count,
             coalesce(sum(p.amount), 0) as payment_total
        from public.invoice_payments p
        join public.invoices i on i.id = p.invoice_id and i.business_id = p.business_id
       where i.business_id = p_business_id
         and i.pos_shift_id is not null
         and i.status = 'paid'
         and i.deleted_at is null
         and (p_branch_id is null or i.branch_id = p_branch_id)
         and public.can_access_branch(p_business_id, i.branch_id)
         and (p_from is null or i.created_at >= p_from)
         and (p_to is null or i.created_at < p_to)
       group by p.payment_method
    ) x;

  return jsonb_build_object(
    'order_count', v_sales.order_count,
    'gross_sales', v_sales.gross_sales,
    'net_sales', v_sales.net_sales,
    'discount_total', v_sales.discount_total,
    'average_ticket', case when v_sales.order_count > 0 then v_sales.net_sales / v_sales.order_count else 0 end,
    'return_count', v_returns.return_count,
    'refunds_total', v_returns.refunds_total,
    'payment_breakdown', v_payment_breakdown
  );
end;
$$;

revoke all on function public.get_pos_owner_analytics(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_pos_owner_analytics(uuid, uuid, timestamptz, timestamptz) to authenticated;
comment on function public.get_pos_owner_analytics(uuid, uuid, timestamptz, timestamptz) is
  'Server-aggregated POS owner analytics by business, optional accessible branch, and optional creation-time range. Does not transfer invoice history to the client.';
