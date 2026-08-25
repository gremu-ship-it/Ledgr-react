-- Phase 10 final verification: close anonymous SECURITY DEFINER access.
--
-- ai_context previously treated a NULL auth.uid() as service-role execution.
-- Anonymous PostgREST requests also have a NULL UID, and PostgreSQL grants
-- EXECUTE to PUBLIC by default unless it is explicitly revoked. Keep the full
-- function body here so deployed authorization does not depend on patching an
-- older definition or on migration ordering outside this repository.

create or replace function public.ai_context(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_business_id is null then
    raise exception 'ai_context: business id is required';
  end if;

  -- Only the service role may call without a user identity. Anonymous callers
  -- also have auth.uid() = NULL, so checking UID presence alone would turn this
  -- SECURITY DEFINER function into a cross-tenant read primitive.
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null or not public.is_business_member(p_business_id) then
      raise exception 'ai_context: not authorised for this business'
        using errcode = '42501';
    end if;
  end if;

  select jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'company', coalesce((
      select jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'currency', b.base_currency,
        'vat_registered', b.vat_registered,
        'financial_year_start', b.financial_year_start
      )
      from public.businesses b
      where b.id = p_business_id
    ), 'null'::jsonb),
    -- coalesce to an EMPTY OBJECT, not null: src/lib/ai/context.ts does
    -- asRecord(root.kpis) and treats null as "no data at all".
    'kpis', coalesce((
      select to_jsonb(k) - 'business_id'
      from public.v_ai_kpis k
      where k.business_id = p_business_id
    ), '{}'::jsonb),
    'monthlyTrend', coalesce((
      select jsonb_agg(to_jsonb(t) - 'business_id' order by t.month_start)
      from public.v_ai_monthly_trend t
      where t.business_id = p_business_id
    ), '[]'::jsonb),
    'overdueInvoices', coalesce((
      select jsonb_agg(to_jsonb(o) - 'business_id' order by o.days_overdue desc)
      from (
        select * from public.v_ai_overdue_invoices
        where business_id = p_business_id
        order by days_overdue desc
        limit 25
      ) o
    ), '[]'::jsonb),
    'topExpenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', x.category,
        'account_code', x.account_code,
        'amount', x.amount,
        'document_count', x.document_count,
        'period_days', 90
      ) order by x.amount desc)
      from (
        select
          category,
          account_code,
          round(sum(amount), 2)          as amount,
          sum(document_count)            as document_count
        from public.v_ai_top_expenses
        where business_id = p_business_id
          and month >= (date_trunc('month', current_date) - interval '2 months')::date
        group by category, account_code
        order by sum(amount) desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'topCustomers', coalesce((
      select jsonb_agg(to_jsonb(c) - 'business_id' - 'contact_id' order by c.revenue desc)
      from (
        select * from public.v_ai_top_customers
        where business_id = p_business_id
        order by revenue desc
        limit 10
      ) c
    ), '[]'::jsonb),
    'concentration', (
      select to_jsonb(cc) - 'business_id' - 'top_contact_id'
      from public.v_ai_customer_concentration cc
      where cc.business_id = p_business_id
    ),
    'anomalies', coalesce((
      select jsonb_agg(to_jsonb(a) - 'business_id' order by
        case a.severity when 'high' then 0 when 'medium' then 1 else 2 end,
        a.occurred_on desc)
      from (
        select * from public.v_ai_anomalies
        where business_id = p_business_id
        order by
          case severity when 'high' then 0 when 'medium' then 1 else 2 end,
          occurred_on desc
        limit 20
      ) a
    ), '[]'::jsonb),
    'upcomingReceivables', coalesce((
      select jsonb_agg(to_jsonb(r) - 'business_id' order by r.due_date)
      from (
        select * from public.v_ai_upcoming_receivables
        where business_id = p_business_id
        order by due_date
        limit 200
      ) r
    ), '[]'::jsonb),
    'upcomingPayables', coalesce((
      select jsonb_agg(to_jsonb(p) - 'business_id' order by p.due_date)
      from (
        select * from public.v_ai_upcoming_payables
        where business_id = p_business_id
        order by due_date
        limit 200
      ) p
    ), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

comment on function public.ai_context(uuid) is
  'Tenant financial AI context. SECURITY DEFINER: service_role may call without a JWT; every other caller must have a non-null auth.uid() and active business membership.';

revoke all on function public.ai_context(uuid) from public;
revoke all on function public.ai_context(uuid) from anon;
revoke all on function public.ai_context(uuid) from authenticated;
revoke all on function public.ai_context(uuid) from service_role;
grant execute on function public.ai_context(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.ai_context(uuid)', 'execute') then
    raise exception 'ai_context must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.ai_context(uuid)', 'execute') then
    raise exception 'ai_context must remain executable by authenticated users';
  end if;
  if not has_function_privilege('service_role', 'public.ai_context(uuid)', 'execute') then
    raise exception 'ai_context must remain executable by service_role';
  end if;
end;
$$;
