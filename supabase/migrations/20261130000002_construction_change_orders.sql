-- Construction Change Orders (5B-4b)
-- Stores change-order deltas only. BOQ revisions remain a deliberate manual action.
-- Evidence is a text reference; no Supabase Storage objects are created.

create table if not exists public.construction_change_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id uuid not null references public.construction_projects(id) on delete restrict,
  site_id uuid references public.construction_procurement_sites(id) on delete set null,
  co_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  title text not null,
  description text not null,
  reason text not null,
  cost_impact numeric(15, 2) not null default 0
    check (cost_impact > '-Infinity'::numeric and cost_impact < 'Infinity'::numeric),
  time_impact_days integer not null default 0,
  boq_section_id uuid references public.boq_sections(id) on delete set null,
  subcontract_id uuid references public.subcontracts(id) on delete set null,
  evidence_reference text,
  rejection_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint construction_change_orders_business_co_number_key unique (business_id, co_number)
);

create index if not exists construction_change_orders_business_project_idx
  on public.construction_change_orders (business_id, project_id);
create index if not exists construction_change_orders_business_status_idx
  on public.construction_change_orders (business_id, status);

alter table public.construction_change_orders enable row level security;

create or replace function public._construction_change_orders_entitled(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.deleted_at is null
      and public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'
      and 'PROJECT_BASED' = any(coalesce(b.operating_models, array[]::text[]))
  );
$$;
revoke all on function public._construction_change_orders_entitled(uuid) from public, anon;
grant execute on function public._construction_change_orders_entitled(uuid) to authenticated, service_role;

create policy "construction_change_orders_select_member"
  on public.construction_change_orders
  for select to authenticated
  using (public.is_business_member(business_id) and public._construction_change_orders_entitled(business_id));

create policy "construction_change_orders_insert_member"
  on public.construction_change_orders
  for insert to authenticated
  with check (
    public.is_business_member(business_id)
    and public._construction_change_orders_entitled(business_id)
    and created_by = (select auth.uid())
    and status = 'draft'
    and approved_by is null and approved_at is null
    and submitted_by is null and submitted_at is null
    and rejection_reason is null
    and exists (
      select 1 from public.construction_projects p
      where p.id = project_id and p.business_id = construction_change_orders.business_id
    )
    and (site_id is null or exists (
      select 1 from public.construction_procurement_sites s
      where s.id = site_id and s.business_id = construction_change_orders.business_id
        and (s.project_id is null or s.project_id = construction_change_orders.project_id)
    ))
    and (boq_section_id is null or exists (
      select 1 from public.boq_sections bs
      where bs.id = boq_section_id and bs.business_id = construction_change_orders.business_id
    ))
    and (subcontract_id is null or exists (
      select 1 from public.subcontracts sc
      where sc.id = subcontract_id and sc.business_id = construction_change_orders.business_id
        and sc.project_id = construction_change_orders.project_id
    ))
  );

-- Direct edits are drafts-only. Lifecycle changes go through the guarded RPC.
create policy "construction_change_orders_update_draft_member"
  on public.construction_change_orders
  for update to authenticated
  using (
    public.is_business_member(business_id)
    and public._construction_change_orders_entitled(business_id)
    and status = 'draft'
  )
  with check (
    public.is_business_member(business_id)
    and public._construction_change_orders_entitled(business_id)
    and status = 'draft'
    and approved_by is null and approved_at is null
    and submitted_by is null and submitted_at is null
    and rejection_reason is null
    and exists (
      select 1 from public.construction_projects p
      where p.id = project_id and p.business_id = construction_change_orders.business_id
    )
    and (site_id is null or exists (
      select 1 from public.construction_procurement_sites s
      where s.id = site_id and s.business_id = construction_change_orders.business_id
        and (s.project_id is null or s.project_id = construction_change_orders.project_id)
    ))
    and (boq_section_id is null or exists (
      select 1 from public.boq_sections bs
      where bs.id = boq_section_id and bs.business_id = construction_change_orders.business_id
    ))
    and (subcontract_id is null or exists (
      select 1 from public.subcontracts sc
      where sc.id = subcontract_id and sc.business_id = construction_change_orders.business_id
        and sc.project_id = construction_change_orders.project_id
    ))
  );

create policy "construction_change_orders_delete_draft_member"
  on public.construction_change_orders
  for delete to authenticated
  using (public.is_business_member(business_id) and public._construction_change_orders_entitled(business_id) and status = 'draft');

revoke all on public.construction_change_orders from public, anon, authenticated;
grant select, delete on public.construction_change_orders to authenticated;
grant insert (
  business_id, project_id, site_id, co_number, title, description, reason,
  cost_impact, time_impact_days, boq_section_id, subcontract_id,
  evidence_reference, created_by
) on public.construction_change_orders to authenticated;
grant update (
  project_id, site_id, co_number, title, description, reason,
  cost_impact, time_impact_days, boq_section_id, subcontract_id,
  evidence_reference, updated_at
) on public.construction_change_orders to authenticated;
grant all on public.construction_change_orders to service_role;

create or replace function public.transition_construction_co(
  p_co_id uuid,
  p_new_status text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_business_id uuid;
begin
  select co.status, co.business_id
    into v_current_status, v_business_id
  from public.construction_change_orders co
  where co.id = p_co_id
  for update;

  if not found then
    raise exception 'Change order not found.' using errcode = 'P0002';
  end if;

  if not public.is_business_member(v_business_id)
     or not public._construction_change_orders_entitled(v_business_id) then
    raise exception 'Not a member of this business.' using errcode = '42501';
  end if;

  if p_new_status not in ('submitted', 'approved', 'rejected', 'cancelled') then
    raise exception 'Invalid change order status.' using errcode = '22023';
  end if;

  if v_current_status = 'draft' and p_new_status not in ('submitted', 'cancelled') then
    raise exception 'Invalid transition from draft to %.', p_new_status using errcode = '22023';
  elsif v_current_status = 'submitted' and p_new_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Invalid transition from submitted to %.', p_new_status using errcode = '22023';
  elsif v_current_status in ('approved', 'rejected', 'cancelled') then
    raise exception 'Cannot transition from terminal status %.', v_current_status using errcode = '22023';
  elsif v_current_status not in ('draft', 'submitted') then
    raise exception 'Unknown current change order status.' using errcode = '22023';
  end if;

  if p_new_status = 'rejected' and nullif(trim(p_rejection_reason), '') is null then
    raise exception 'A rejection reason is required.' using errcode = '22023';
  end if;

  update public.construction_change_orders
  set status = p_new_status,
      rejection_reason = case
        when p_new_status = 'rejected' then trim(p_rejection_reason)
        else rejection_reason
      end,
      approved_by = case when p_new_status = 'approved' then auth.uid() else approved_by end,
      approved_at = case when p_new_status = 'approved' then now() else approved_at end,
      submitted_by = case when p_new_status = 'submitted' then auth.uid() else submitted_by end,
      submitted_at = case when p_new_status = 'submitted' then now() else submitted_at end,
      updated_at = now()
  where id = p_co_id and business_id = v_business_id;
end;
$$;

revoke all on function public.transition_construction_co(uuid, text, text) from public, anon;
grant execute on function public.transition_construction_co(uuid, text, text) to authenticated, service_role;

comment on function public.transition_construction_co(uuid, text, text) is
  'Applies a tenant-authorized construction change-order status transition and stamps submit/approval metadata.';
