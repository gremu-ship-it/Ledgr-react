# Phase 8B.3 — RLS Policy Matrix

**Status:** ✅ COMPLETE — policies reconstructed for all 24 tables the app
touches client-side; 6 tables deliberately left deny-all (service-role only);
**41/41 security tests passing** on a fresh replay (59 migrations), including
the full cross-tenant ORG-A/ORG-B matrix.

> **Honesty statement:** the legacy policies were out-of-band (never
> version-controlled) and production was out of scope. Every policy below
> reuses the repository's **own verified helpers and patterns**; per-table
> application is **[INFERRED]** where the legacy shape for that exact table is
> unknown. No `[UNKNOWN]` behaviour was implemented — tables the app never
> touches client-side remain deny-all.

## Authorization model (repository-verified)

| Helper | Grants | Source |
|---|---|---|
| `is_business_member(business_id)` | any active member of the business | 20260728000008 |
| `can_write_business_data(business_id)` | owner, admin, accountant, supervisor, data_entry, inventory_manager, sales_clerk, purchasing_officer, warehouse_worker, sales_manager, customer_service_rep, tax_compliance_officer, treasury_manager, asset_manager, branch_manager | 20260728000008 |
| `can_admin_business_data(business_id)` | owner, admin | 20260728000008 |
| `can_view_payroll(business_id)` | owner, admin, accountant, payroll_manager | 20260728000009 |
| `can_write_payroll(business_id)` | owner, admin, accountant, payroll_manager | 20260728000009 |
| `can_read_audit(business_id)` | owner, admin, accountant, payroll_manager, auditor, board_member | 20260728000009 |
| `is_platform_admin(uid)` | platform staff flag | 20260726000004 |

## Group A — business-scoped tables: standard 5-policy pattern

`member_read` (SELECT is_business_member) · `writer_insert` (INSERT
can_write_business_data) · `writer_update` (UPDATE can_write_business_data,
USING+WITH CHECK) · `admin_delete` (DELETE can_admin_business_data) ·
`platform_admin_read` (SELECT is_platform_admin)

**Pattern [VERIFIED]** — 20260728000008 applies exactly this to contacts,
branches, departments, inventory_locations; 20260731000000 to accounts;
20260811000002 to fixed assets. **Per-table application [INFERRED]**.

| Table | Class | Read | Insert | Update | Delete | Classification |
|---|---|---|---|---|---|---|
| `invoices` | transaction | member | writer | writer | admin | [VERIFIED pattern / INFERRED per-table] |
| `invoice_lines` | transaction | member | writer | writer | admin | same |
| `invoice_payments` | transaction | member | writer | writer | admin | same |
| `expenses` | transaction | member | writer | writer | admin | same |
| `expense_lines` | transaction | member | writer | writer | admin | same |
| `expense_payments` | transaction | member | writer | writer | admin | same |
| `journal_entries` | transaction | member | writer | writer | admin | same |
| `journal_lines` | transaction | member | writer | writer | admin | same |
| `bank_statements` | transaction | member | writer | writer | admin | same |
| `bank_statement_lines` | transaction | member | writer | writer | admin | same |
| `products` | inventory | member | writer | writer | admin | same |
| `product_categories` | inventory | member | writer | writer | admin | same |
| `inventory_balances` | inventory | member | writer | writer | admin | same |
| `stock_movements` | inventory | member | writer | writer | admin | same |
| `stock_transfers` | inventory | member | writer | writer | admin | same |
| `stock_transfer_lines` | inventory | member | writer | writer | admin | same |
| `budgets` | financial mgmt | member | writer | writer | admin | same |
| `budget_lines` | financial mgmt | member | writer | writer | admin | same |
| `accounting_periods` | financial mgmt | member | writer | writer | admin | same |
| `tax_configurations` | tax | member | writer | writer | admin | same |
| `paye_bands` | tax/payroll | member | writer | writer | admin | same |

## Group B — membership & identity

| Table | Policy | Command | Expression | Classification |
|---|---|---|---|---|
| `business_users` | `business_users_member_read` | SELECT | `user_id = auth.uid() OR is_business_member(business_id)` | [INFERRED] — app reads own memberships (CreateBusiness/AcceptInvitation reload `.eq('user_id', auth.uid())`) and team list (SettingsPage `.eq('business_id', …)`) |
| `business_users` | `business_users_admin_write` | INSERT | `can_admin_business_data(business_id)` | [VERIFIED] — team management is owner/admin (usePermissions.canManageUsers) |
| `business_users` | `business_users_admin_update` | UPDATE | `can_admin_business_data` + WITH CHECK | [VERIFIED] |
| `business_users` | `business_users_admin_delete` | DELETE | `can_admin_business_data` | [VERIFIED] |
| `business_users` | `business_users_platform_admin_read` | SELECT | `is_platform_admin(auth.uid())` | [VERIFIED pattern] |
| `user_profiles` | `user_profiles_own_read` | SELECT | `id = auth.uid() OR same-business-member` | [VERIFIED] own profile (BusinessRepository.findUserProfile); [INFERRED] team display (TeamManagementPage `.in('id', userIds)`) |
| `user_profiles` | `user_profiles_own_update` | UPDATE | `id = auth.uid()` + WITH CHECK | [VERIFIED] — LanguageSwitcher, DeleteAccountSection update own row only |
| `user_profiles` | `user_profiles_platform_admin_read` | SELECT | `is_platform_admin(auth.uid())` | [VERIFIED pattern] |

## Group C — audit_log (immutable)

| Policy | Command | Expression | Classification |
|---|---|---|---|
| `audit_log_read` | SELECT | `can_read_audit(business_id)` | [VERIFIED] — 20260728000009 role list |
| `audit_log_platform_admin_read` | SELECT | `is_platform_admin(auth.uid())` | [VERIFIED pattern] |
| — (no insert/update/delete policies) | — | writes only via SECURITY DEFINER `log_manual_audit_event` | [VERIFIED] — Phase 8B.1 RPC; immutability per phase brief |

## Group D — deliberately service-role-only (deny-all, fail-closed)

| Table | Rationale | Classification |
|---|---|---|
| `api_usage` | rate-limit counters; `rlsIsolation.test.ts` pins **NO client policy** | [VERIFIED] |
| `ai_insights_usage` | no client queries; edge functions use service_role | [INFERRED] |
| `support_agent_usage` | no client queries; edge functions use service_role | [INFERRED] |
| `subscription_reminders_sent` | no client queries; cron/edge functions use service_role | [INFERRED] |
| `business_terms_acceptances` | no client queries; written by SECURITY DEFINER RPC | [VERIFIED] |
| `profiles` (legacy) | only export-my-data reads it via service_role | [VERIFIED] |

## Security test results (41/41 PASS)

### Cross-tenant matrix (ORG-A: owner/admin/accountant · ORG-B: owner/viewer)

| Test | Result |
|---|---|
| A-user → A contacts / products / journal_lines | ✅ read (1/1/2 rows) |
| A-user → B contacts / products / journal_lines | ✅ **denied (0 rows)** |
| B-user → A products / employees | ✅ **denied (0 rows)** |
| anonymous → A contacts / products | ✅ **denied** |
| A-user INSERT → B contacts / products | ✅ **denied** |
| A-user UPDATE / DELETE → B contact | ✅ **denied (0 rows)** |
| A-user INSERT → A (writer tier) | ✅ allowed |
| viewer INSERT → A or own B (viewer not writer) | ✅ **denied** |
| accountant DELETE (admin only) | ✅ **denied (0 rows)** |
| owner DELETE | ✅ allowed |
| A-user reads B team list / B profile | ✅ **denied** |
| A-user UPDATE B profile | ✅ **denied (0 rows)** |
| accountant reads B audit log | ✅ **denied** |
| UPDATE / DELETE / INSERT audit_log directly | ✅ **denied (immutable)** |
| B-viewer → A employees (payroll, cross-tenant) | ✅ **denied** |
| A-user log_manual_audit_event on B (RPC boundary) | ✅ **denied** |
| **NO CROSS-TENANT READ / INSERT / UPDATE / DELETE** | ✅ **demonstrated** |

### Role tests

- accountant = payroll tier (can_view/can_write_payroll include accountant per
  20260728000009 — matches the repo's own model; verified as intended, not a
  leak)
- viewer outside payroll tier → denied
- audit_log readable by accountant (can_read_audit), denied to viewer

## Design notes

1. **RLS + views:** the Phase 8B.2 views are security_invoker, so these
   policies flow through the views automatically (no per-view policies
   needed).
2. **Soft delete:** app soft-deletes via `UPDATE deleted_at`, which the
   `writer_update` policy permits (matches the 20260728000008 comment:
   "Soft delete goes through UPDATE deleted_at and is available to writers").
3. **`user_profiles` has no `business_id`** — the same-business read policy
   derives membership through `business_users` (documented in the migration).
4. **`business_users` own-row read** (`user_id = auth.uid()`) keeps login
   membership loading working even before a business is selected.

## Test suite

`tests/database/rls_security.test.js` — 41 assertions, all PASS. Requires the
disposable-Postgres harness (embedded-postgres + pg); see the file header.
