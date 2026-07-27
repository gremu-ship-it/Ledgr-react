-- ─────────────────────────────────────────────────────────────────────────
-- Fix recursive partner-client RLS policies
-- ─────────────────────────────────────────────────────────────────────────
-- partner_clients_read used to query partner_clients again while PostgreSQL
-- was evaluating that table's RLS policy. Queries of either partner_clients
-- or businesses (whose partner policies read partner_clients) therefore failed
-- with SQLSTATE 42P17: "infinite recursion detected in policy for relation
-- partner_clients".
--
-- Keep policy expressions free of protected-table subqueries. These narrowly
-- scoped SECURITY DEFINER helpers perform the same checks as the table owner,
-- which bypasses RLS, and therefore break both direct and cross-table policy
-- recursion. Each function uses a fixed, empty search path and fully-qualified
-- relation names so callers cannot redirect its queries to another schema.

create or replace function public.can_read_partner_client(pid uuid, bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_partner_admin(auth.uid(), pid)
    or exists (
      select 1
        from public.business_users bu
       where bu.business_id = bid
         and bu.user_id = auth.uid()
         and bu.is_active
    )
    or (
      exists (
        select 1
          from public.partners p
         where p.id = pid
           and p.allow_client_visibility
      )
      and exists (
        select 1
          from public.partner_clients mine
          join public.business_users bu on bu.business_id = mine.business_id
         where mine.partner_id = pid
           and bu.user_id = auth.uid()
           and bu.is_active
      )
    );
$$;

create or replace function public.is_partner_business_admin(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.partner_clients pc
     where pc.business_id = bid
       and public.is_partner_admin(auth.uid(), pc.partner_id)
  );
$$;

create or replace function public.can_read_partner_peer_business(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.partner_clients target
      join public.partners p on p.id = target.partner_id
     where target.business_id = bid
       and p.allow_client_visibility
       and exists (
         select 1
           from public.partner_clients mine
           join public.business_users bu on bu.business_id = mine.business_id
          where mine.partner_id = target.partner_id
            and bu.user_id = auth.uid()
            and bu.is_active
       )
  );
$$;

revoke all on function public.can_read_partner_client(uuid, uuid) from public;
revoke all on function public.is_partner_business_admin(uuid) from public;
revoke all on function public.can_read_partner_peer_business(uuid) from public;
grant execute on function public.can_read_partner_client(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_partner_business_admin(uuid) to authenticated, service_role;
grant execute on function public.can_read_partner_peer_business(uuid) to authenticated, service_role;

comment on function public.can_read_partner_client(uuid, uuid) is
  'RLS-safe check for whether the current user may read one partner_clients row.';
comment on function public.is_partner_business_admin(uuid) is
  'RLS-safe check for whether the current user administers the partner that owns a business.';
comment on function public.can_read_partner_peer_business(uuid) is
  'RLS-safe check for opt-in visibility of a business to another client of the same partner.';

-- No subquery in this policy reads partner_clients, so evaluating it can no
-- longer recursively invoke itself.
drop policy if exists partner_clients_read on public.partner_clients;
create policy partner_clients_read on public.partner_clients
  for select using (
    public.can_read_partner_client(partner_id, business_id)
  );

-- Avoid an indirect businesses -> partner_clients -> businesses RLS cycle as
-- well. Access remains SELECT-only and has exactly the same admin/peer rules.
drop policy if exists businesses_partner_admin_read on public.businesses;
create policy businesses_partner_admin_read on public.businesses
  for select using (
    public.is_partner_business_admin(id)
  );

drop policy if exists businesses_partner_peer_read on public.businesses;
create policy businesses_partner_peer_read on public.businesses
  for select using (
    public.can_read_partner_peer_business(id)
  );
