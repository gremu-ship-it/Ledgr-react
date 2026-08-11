-- Ensure fixed-asset setup can be persisted by every role that the UI allows
-- to manage assets (especially asset_manager). Some environments still have
-- pre-role-expansion policies on these tables; an UPDATE hidden by RLS returns
-- zero rows without a PostgREST error, which made the category modal report a
-- successful save even though its GL defaults remained null.
--
-- Uses the shared capability helpers introduced in 20260728000008 so this is
-- consistent with the rest of the business-scoped master data.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'asset_categories',
    'fixed_assets',
    'depreciation_schedules'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Table public.% not found, skipping.', t;
      continue;
    end if;

    for p in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    execute format($policy$
      create policy %I on public.%I
        for select using (public.is_business_member(business_id))
    $policy$, t || '_member_read', t);

    execute format($policy$
      create policy %I on public.%I
        for insert with check (public.can_write_business_data(business_id))
    $policy$, t || '_writer_insert', t);

    execute format($policy$
      create policy %I on public.%I
        for update using (public.can_write_business_data(business_id))
                  with check (public.can_write_business_data(business_id))
    $policy$, t || '_writer_update', t);

    execute format($policy$
      create policy %I on public.%I
        for delete using (public.can_admin_business_data(business_id))
    $policy$, t || '_admin_delete', t);

    execute format($policy$
      create policy %I on public.%I
        for select using (public.is_platform_admin(auth.uid()))
    $policy$, t || '_platform_admin_read', t);

    execute format('revoke all on public.%I from anon', t);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      t
    );
  end loop;
end
$$;

comment on table public.asset_categories is
  'Fixed-asset category defaults, including required GL links. RLS: active members read; can_write roles insert/update; owner/admin hard-delete.';
