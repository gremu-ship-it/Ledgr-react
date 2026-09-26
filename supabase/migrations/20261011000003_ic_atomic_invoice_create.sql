-- ============================================================================
-- 20261011000003_ic_atomic_invoice_create.sql
-- INCIDENT CONTAINMENT 2026-09-25 — P7: atomic invoice header + lines
-- ============================================================================
-- Finding (crawl 2026-09-25, CONFIRMED MEDIUM): InvoiceRepository.
-- createWithLines inserted the header, then the lines in a second request,
-- and on line failure tried a compensating DELETE — which invoices_admin_delete
-- RLS blocks for every non-admin writer, leaving orphan headers (a posted-
-- looking invoice with no lines).
--
-- New command: public.create_invoice_with_lines(p_invoice jsonb,
--                                                p_lines jsonb,
--                                                p_client_key uuid)
--   * SECURITY INVOKER — every insert runs under the caller's own RLS
--     (invoices_writer_insert / invoice_lines_writer_insert, branch scope,
--     quota trigger). Nothing is bypassed or broadened.
--   * One transaction: optional number reservation + header + all lines.
--     Any failure rolls back everything — no orphan header, and when the
--     number is reserved here, no consumed number either.
--   * Numbering: if p_invoice has no invoice_number (or an offline
--     placeholder INV-OFFLINE-…), reserve_next_document_number(business,
--     'invoice') is called INSIDE this transaction. A caller-supplied real
--     number is used as-is (unchanged behaviour for pre-reserving screens).
--   * Idempotency: an invoice already committed under (business_id,
--     client_key) is returned with its lines and idempotent=true; a
--     concurrent duplicate first attempt is resolved via the unique index.
--   * Columns: only real, non-generated columns of the target tables are
--     taken from the payload (as PostgREST would); business_id / invoice_id /
--     client_key on lines and client_key on the header are server-set.
--   Side effects that were already separate client steps (journal, stock,
--   webhook) are unchanged and remain client-side, keyed and idempotent.
--
-- No data is read or written by this migration.
-- ============================================================================

create or replace function public.create_invoice_with_lines(
  p_invoice jsonb,
  p_lines jsonb,
  p_client_key uuid default null
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_business uuid;
  v_inv public.invoices%rowtype;
  v_cols text;
  v_vals text;
  v_lcols text;
  v_lvals text;
  v_header jsonb := p_invoice;
  v_lines jsonb;
  v_result_lines jsonb;
  v_idempotent boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to create an invoice.' using errcode = '42501';
  end if;
  if p_invoice is null or jsonb_typeof(p_invoice) <> 'object' then
    raise exception 'Malformed invoice payload.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Malformed invoice lines payload.' using errcode = '22023';
  end if;
  begin
    v_business := (p_invoice->>'business_id')::uuid;
  exception when others then
    v_business := null;
  end;
  if v_business is null then
    raise exception 'Invoice business is required.' using errcode = '22023';
  end if;

  -- Replay (RLS-scoped read: a caller who cannot see it cannot replay it).
  if p_client_key is not null then
    select * into v_inv from public.invoices
     where business_id = v_business and client_key = p_client_key;
    if found then
      v_idempotent := true;
    end if;
  end if;

  if not v_idempotent then
    -- In-transaction numbering when no real number was supplied.
    if coalesce(v_header->>'invoice_number', '') = ''
       or (v_header->>'invoice_number') like 'INV-OFFLINE-%' then
      v_header := v_header || jsonb_build_object(
        'invoice_number', public.reserve_next_document_number(v_business, 'invoice'));
    end if;

    select coalesce(string_agg(format('%I', a.attname), ',' order by a.attnum), ''),
           coalesce(string_agg(format('r.%I', a.attname), ',' order by a.attnum), '')
      into v_cols, v_vals
      from pg_attribute a
     where a.attrelid = 'public.invoices'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity = ''
       and a.attname <> 'client_key'
       and v_header ? a.attname::text;

    begin
      execute format(
        'insert into public.invoices (%s, client_key) select %s, $2 from jsonb_populate_record(null::public.invoices, $1) r returning *',
        v_cols, v_vals)
      into v_inv
      using v_header, p_client_key;
    exception when unique_violation then
      if p_client_key is null then raise; end if;
      select * into v_inv from public.invoices
       where business_id = v_business and client_key = p_client_key;
      if not found then raise; end if;
      v_idempotent := true;
    end;

    if not v_idempotent and jsonb_array_length(p_lines) > 0 then
      select jsonb_agg((l - 'invoice_id' - 'business_id' - 'client_key')
                       || jsonb_build_object('invoice_id', v_inv.id, 'business_id', v_inv.business_id))
        into v_lines
        from jsonb_array_elements(p_lines) l;
      if exists (select 1 from jsonb_array_elements(v_lines) l where jsonb_typeof(l) <> 'object') then
        raise exception 'Malformed invoice line.' using errcode = '22023';
      end if;

      select coalesce(string_agg(format('%I', a.attname), ',' order by a.attnum), ''),
             coalesce(string_agg(format('r.%I', a.attname), ',' order by a.attnum), '')
        into v_lcols, v_lvals
        from pg_attribute a
       where a.attrelid = 'public.invoice_lines'::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attgenerated = '' and a.attidentity = ''
         and exists (select 1 from jsonb_array_elements(v_lines) l where l ? a.attname::text);

      execute format(
        'insert into public.invoice_lines (%s) select %s from jsonb_populate_recordset(null::public.invoice_lines, $1) r',
        v_lcols, v_lvals)
      using v_lines;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(il) order by il.line_number), '[]'::jsonb)
    into v_result_lines
    from public.invoice_lines il
   where il.invoice_id = v_inv.id and il.business_id = v_inv.business_id;

  return jsonb_build_object('invoice', to_jsonb(v_inv), 'lines', v_result_lines, 'idempotent', v_idempotent);
end;
$$;

comment on function public.create_invoice_with_lines(jsonb, jsonb, uuid) is
  'IC 2026-09-25 P7: atomic invoice header + lines (+ in-transaction number reservation when no real number is supplied), idempotent by client_key. SECURITY INVOKER: caller RLS applies to every insert.';
revoke all on function public.create_invoice_with_lines(jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_invoice_with_lines(jsonb, jsonb, uuid) to authenticated;
