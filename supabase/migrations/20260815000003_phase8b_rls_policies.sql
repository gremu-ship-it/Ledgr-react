-- ============================================================================
-- Phase 8B.3 — RLS policy reconstruction for the 30 policy-less tables
-- ============================================================================
--
-- PROBLEM (Phase 8A.1, confirmed on live staging 2026-08-15)
--   30 tables have RLS enabled with ZERO policies — every authenticated
--   query is denied (deny-all). The legacy database's policies for these
--   tables were out-of-band (never version-controlled).
--
-- APPROACH
--   Reuse the repository's OWN verified policy pattern and helpers:
--     • master-data pattern (20260728000008_role_aware_master_data_rls.sql):
--         <t>_member_read        FOR SELECT  USING is_business_member(business_id)
--         <t>_writer_insert      FOR INSERT WITH CHECK can_write_business_data(business_id)
--         <t>_writer_update      FOR UPDATE USING + WITH CHECK can_write_business_data(business_id)
--         <t>_admin_delete       FOR DELETE USING can_admin_business_data(business_id)
--         <t>_platform_admin_read FOR SELECT USING is_platform_admin(auth.uid())
--     • payroll pattern (20260728000009) for the tables it already covers —
--       NONE of the 30 tables overlap the payroll set (employees,
--       employee_allowances, employee_deductions, payroll_runs,
--       payroll_employee_lines already have policies).
--     • audit pattern (20260728000009 can_read_audit) for audit_log.
--   Every policy below is classified:
--     [VERIFIED] — mirrors a pattern the repository already applies to the
--                  same class of table (master data / accounts / fixed
--                  assets), or the app's documented access needs.
--     [INFERRED] — the legacy policy shape for THIS table is unknown
--                  (production was out of scope); the chosen shape is the
--                  repo's own standard.
--     No [UNKNOWN] behaviour is implemented — tables the app never touches
--     client-side stay deny-all (service-role only).
--
-- SECURITY MODEL (from the repository, [VERIFIED])
--   is_business_member     — any active member of the business
--   can_write_business_data — owner/admin/accountant/supervisor/data_entry/
--                              inventory_manager/sales_clerk/purchasing_officer/
--                              warehouse_worker/sales_manager/customer_service_rep/
--                              tax_compliance_officer/treasury_manager/asset_manager/
--                              branch_manager
--   can_admin_business_data — owner/admin only
--   can_read_audit          — owner/admin/accountant/payroll_manager/auditor/board_member
--   is_platform_admin       — platform staff (support tooling)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- GROUP A — business-scoped tables: standard 5-policy pattern
--   [VERIFIED pattern; INFERRED per-table application]
--   Drop any out-of-band policies first (same approach as 20260728000008),
--   then rebuild a known, uniform set.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    -- Transactions
    'invoices',
    'invoice_lines',
    'invoice_payments',
    'expenses',
    'expense_lines',
    'expense_payments',
    'journal_entries',
    'journal_lines',
    'bank_statements',
    'bank_statement_lines',
    -- Inventory
    'products',
    'product_categories',
    'inventory_balances',
    'stock_movements',
    'stock_transfers',
    'stock_transfer_lines',
    -- Financial management
    'budgets',
    'budget_lines',
    'accounting_periods',
    'tax_configurations',
    'paye_bands'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Table public.% not found, skipping.', t;
      continue;
    end if;

    -- Drop any pre-existing (out-of-band) policies so the set is uniform.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    -- Read: any active member of the business.
    execute format($f$
      create policy %I on public.%I
        for select using (public.is_business_member(business_id))
    $f$, t || '_member_read', t);

    -- Insert: any role with canWrite (the canWrite set mirrors
    -- usePermissions.ts; includes soft-delete-capable writers).
    execute format($f$
      create policy %I on public.%I
        for insert with check (public.can_write_business_data(business_id))
    $f$, t || '_writer_insert', t);

    -- Update: any role with canWrite (covers the app's soft delete via
    -- UPDATE deleted_at). WITH CHECK keeps rows inside the caller's business.
    execute format($f$
      create policy %I on public.%I
        for update using (public.can_write_business_data(business_id))
                  with check (public.can_write_business_data(business_id))
    $f$, t || '_writer_update', t);

    -- Hard delete: owner/admin only.
    execute format($f$
      create policy %I on public.%I
        for delete using (public.can_admin_business_data(business_id))
    $f$, t || '_admin_delete', t);

    -- Platform staff keep read access for support tooling.
    execute format($f$
      create policy %I on public.%I
        for select using (public.is_platform_admin(auth.uid()))
    $f$, t || '_platform_admin_read', t);

    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- GROUP B1 — business_users (membership)
--   SELECT  [INFERRED] any member reads the team list (SettingsPage /
--           TeamManagementPage) AND a user always reads their own
--           memberships (CreateBusinessPage/AcceptInvitationPage reload
--           .eq('user_id', auth.uid()))
--   WRITE   [VERIFIED] team management is owner/admin (canManageUsers in
--           usePermissions.ts; SettingsPage gating) -> can_admin_business_data
-- ────────────────────────────────────────────────────────────────────────────
drop policy if exists business_users_member_read on public.business_users;
create policy business_users_member_read on public.business_users
  for select using (
    user_id = auth.uid()
    or public.is_business_member(business_id)
  );

drop policy if exists business_users_admin_write on public.business_users;
create policy business_users_admin_write on public.business_users
  for insert with check (public.can_admin_business_data(business_id));

drop policy if exists business_users_admin_update on public.business_users;
create policy business_users_admin_update on public.business_users
  for update using (public.can_admin_business_data(business_id))
            with check (public.can_admin_business_data(business_id));

drop policy if exists business_users_admin_delete on public.business_users;
create policy business_users_admin_delete on public.business_users
  for delete using (public.can_admin_business_data(business_id));

drop policy if exists business_users_platform_admin_read on public.business_users;
create policy business_users_platform_admin_read on public.business_users
  for select using (public.is_platform_admin(auth.uid()));

revoke all on public.business_users from anon;

-- ────────────────────────────────────────────────────────────────────────────
-- GROUP B2 — user_profiles (identity; no business_id column)
--   SELECT  [VERIFIED] own profile (BusinessRepository.findUserProfile
--           .eq('id', userId)); [INFERRED] same-business members' profiles
--           (TeamManagementPage .in('id', userIds) where userIds come from
--           the caller's business_users)
--   UPDATE  [VERIFIED] own row only (LanguageSwitcher, DeleteAccountSection
--           both .eq('id', user.id))
-- ────────────────────────────────────────────────────────────────────────────
drop policy if exists user_profiles_own_read on public.user_profiles;
create policy user_profiles_own_read on public.user_profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.business_users bu
      where bu.user_id = auth.uid()
        and bu.is_active = true
        and exists (
          select 1 from public.business_users bu2
          where bu2.business_id = bu.business_id
            and bu2.user_id = user_profiles.id
            and bu2.is_active = true
        )
    )
  );

drop policy if exists user_profiles_own_update on public.user_profiles;
create policy user_profiles_own_update on public.user_profiles
  for update using (id = auth.uid())
            with check (id = auth.uid());

drop policy if exists user_profiles_platform_admin_read on public.user_profiles;
create policy user_profiles_platform_admin_read on public.user_profiles
  for select using (public.is_platform_admin(auth.uid()));

revoke all on public.user_profiles from anon;

-- ────────────────────────────────────────────────────────────────────────────
-- GROUP C — audit_log (immutable, security-sensitive)
--   SELECT [VERIFIED] can_read_audit (20260728000009: owner/admin/accountant/
--           payroll_manager/auditor/board_member)
--   NO insert/update/delete policies: writes go through the SECURITY DEFINER
--   log_manual_audit_event RPC (Phase 8B.1); ordinary clients must not be
--   able to forge, modify or delete audit records.
-- ────────────────────────────────────────────────────────────────────────────
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select using (public.can_read_audit(business_id));

drop policy if exists audit_log_platform_admin_read on public.audit_log;
create policy audit_log_platform_admin_read on public.audit_log
  for select using (public.is_platform_admin(auth.uid()));

revoke all on public.audit_log from anon;

-- ────────────────────────────────────────────────────────────────────────────
-- GROUP D — service-role-only tables (no client policies, fail-closed)
--   api_usage                 [VERIFIED] rlsIsolation.test.ts pins NO policy
--   ai_insights_usage         [INFERRED] no client queries; edge functions
--   support_agent_usage         use service_role (bypasses RLS)
--   subscription_reminders_sent [INFERRED] same
--   business_terms_acceptances [VERIFIED] no client queries; written by
--                              record_business_terms_acceptance (SECURITY
--                              DEFINER)
--   profiles (legacy)         [VERIFIED] only export-my-data reads it via
--                              service_role
--   No policies are created here — RLS stays enabled and deny-all for
--   authenticated clients.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- Sanity guard: every table covered by this migration must now have at
-- least one policy (or be deliberately service-role-only).
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  missing text;
  _t text;
begin
  missing := null;
  foreach _t in array array[
    'invoices','invoice_lines','invoice_payments','expenses','expense_lines',
    'expense_payments','journal_entries','journal_lines','bank_statements',
    'bank_statement_lines','products','product_categories','inventory_balances',
    'stock_movements','stock_transfers','stock_transfer_lines','budgets',
    'budget_lines','accounting_periods','tax_configurations','paye_bands',
    'business_users','user_profiles','audit_log'
  ]
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = _t
    ) then
      missing := coalesce(missing || ', ', '') || _t;
    end if;
  end loop;
  if missing is not null then
    raise exception 'RLS reconstruction incomplete — no policies on: %', missing;
  end if;
end
$$;
