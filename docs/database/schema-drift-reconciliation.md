# Ledgr — Schema Drift Reconciliation (Phase 8A.1)

> Compares the **live staging schema evidence** (`src/dal/types/database.generated.ts`,
> produced from the staging database, plus the hand-typed supplement) against the
> **repository's migration set** (`supabase/migrations/`). Live capture was not
> possible in this sandbox (see the Phase 8A.1 final report), so every object is
> classified with the evidence available. Counts below were recomputed from the
> evidence during this phase and **supersede the Phase 8A discovery estimates**.

## Classification legend

| Class | Meaning |
|---|---|
| MATCH | Object exists in staging evidence and is created by a repository migration |
| MISSING FROM REPOSITORY | Object exists in staging evidence but no migration creates it |
| MISSING FROM STAGING | Object is created by a migration but absent from staging evidence |
| DIFFERENT | Object exists in both but with differing shape |
| UNKNOWN | Cannot be determined without live capture |

---

## 1. High-level counts

| Category | Staging evidence | Created by migrations | Classification |
|---|---|---|---|
| Tables | 50 (generated) + 9 (supplement) | 26 | 39 base tables **MISSING FROM REPOSITORY** |
| Enums | 16 | 4 (`tax_alert_*`, `tax_return_status`) | 12 base enums **MISSING FROM REPOSITORY** |
| Functions (RPCs) | 14 | 5 (`increment_amount_paid`, `user_has_role`, `reserve_next_document_number`, …) | 9 base RPCs **MISSING FROM REPOSITORY** (bodies); 2 resolved by `pg_trgm` |
| Views | 5 | 1 (`v_cash_flow` + 2 fix migrations) | 4 base views **MISSING FROM REPOSITORY** (bodies) |
| Extensions | — | 3 (`pgcrypto`, `pg_cron`, `pg_net`) | `pg_trgm` **UNKNOWN** (now included in base migration based on `show_limit`/`show_trgm` evidence) |

**Note on prior counts:** the Phase 8A discovery estimated 39 typed base tables,
12 generated enums, 9 custom RPCs and 4 generated views. The 39/12 counts are
**confirmed** by this reconciliation. RPCs are now 9 (not 9+`show_limit`/`show_trgm`,
which are extension functions), views remain 4.

## 2. Base tables — MISSING FROM REPOSITORY (39)

All 39 tables below exist in `database.generated.ts` (live staging evidence) but
are created by **no** migration. The base migration
`20250101000000_base_schema.sql` now creates all of them plus `currencies`
(required by 13 base-table foreign keys).

```
accounting_periods    accounts              asset_categories      audit_log
bank_statement_lines  bank_statements       branches              budget_lines
budgets               business_users        businesses            contacts
departments           depreciation_schedules employee_allowances  employee_deductions
employees             expense_lines         expense_payments      expenses
fixed_assets          inventory_balances    inventory_locations   invoice_lines
invoice_payments      invoices              journal_entries       journal_lines
paye_bands            payroll_employee_lines payroll_runs          product_categories
products              profiles              stock_movements       stock_transfer_lines
stock_transfers       tax_configurations    user_profiles
```

## 3. Base enums — MISSING FROM REPOSITORY (12)

```
account_subtype (15)  account_type (5)      asset_status (5)
currency_code (9)     depreciation_method (4) invoice_status (7)
journal_status (3)    payment_method (7)    payroll_status (4)
stock_movement_type (10) tax_code (11)      user_role (19)
```

Label sets and order are taken from `database.generated.ts` Constants, which
reflect the live staging enum order. The base migration creates them with all
labels, so the guarded `ALTER TYPE … ADD VALUE` statements in later migrations
(20260723000001, 20260728000000) become no-ops on replay. Replay verified the
fresh enum labels match the staging evidence **16/16 (zero diffs)**.

## 4. Base RPCs — MISSING FROM REPOSITORY (bodies)

Signatures exist in `database.generated.ts`; bodies are not in the repository.

| Function | Signature (from generated types) | Used by | Body available? |
|---|---|---|---|
| `accept_invitation` | `(p_token text) → json` | AcceptInvitationPage, accept-invite-link | ❌ |
| `create_business_with_owner` | `(18 args) → string` | CreateBusinessPage | ❌ |
| `current_user_role` | `(p_business_id uuid) → user_role` | PeriodRepository, JournalRepository | ❌ |
| `get_user_role` | `(p_business_id uuid) → user_role` | PeriodRepository, JournalRepository | ❌ |
| `get_enum_values` | `(enum_name text) → string[]` | settings pages | ❌ |
| `invite_member` | `(p_business_id uuid, p_email text, p_role user_role) → string` | TeamManagementPage | ❌ |
| `log_manual_audit_event` | `(4 args) → void` | AuditLogRepository | ❌ |
| `seed_new_business` | `(p_biz json) → void` | CreateBusinessPage | ❌ |
| `verify_audit_chain` | `(p_business_id uuid, p_resource_type text) → table` | AuditLogRepository | ❌ |
| `show_limit` | `() → number` | — | ✅ **pg_trgm** extension function |
| `show_trgm` | `(text) → string[]` | — | ✅ **pg_trgm** extension function |

`show_limit`/`show_trgm` were previously classified as custom RPCs. The Phase 8A.1
replay proved they are **pg_trgm extension functions** (PostgreSQL 18 provides
both), so the base migration now creates `pg_trgm`, which closes two of the eleven
gaps. The remaining nine need live capture (`pg_get_functiondef`).

## 5. Base views — MISSING FROM REPOSITORY (bodies)

| View | Columns (generated types) | Body available? |
|---|---|---|
| `v_ar_ageing` | contact_id, invoice_id, … | ❌ |
| `v_asset_register` | … | ❌ |
| `v_reorder_alerts` | product_id, … | ❌ |
| `v_trial_balance` | … | ❌ |
| `v_cash_flow` | business_id, period, operating, investing, financing, net_change | ✅ 20260726000000 + 20260728000006 |

## 6. Objects created by migrations but absent from staging evidence — MISSING FROM STAGING (per evidence)

These exist in migrations but not in `database.generated.ts`. Two explanations
are possible (see §8): the generated types are stale, or staging's migration
history differs from the repository.

- **Tables (15):** `ai_insights_usage`, `api_keys`, `api_usage`,
  `business_terms_acceptances`, `invoice_delivery_events`, `partner_admins`,
  `partner_clients`, `partner_feature_flags`, `partner_invoices`, `partners`,
  `recurring_invoices`, `subscription_reminders_sent`, `support_agent_usage`,
  `webhook_deliveries`, `webhooks`. (9 of these are hand-typed in
  `database.supplement.ts`; the remaining 6 are used via untyped/`as never` casts.)
- **Columns:** `bank_statements.(reconciled_at, reconciled_by, is_locked,
  locked_at)`, `bank_statement_lines.(match_method, match_confidence,
  locked_at)`, `invoices/invoice_payments/expenses/expense_payments/journal_lines
  .(exchange_rate_used, functional_currency, functional_amount*)`,
  `subscription_reminders_sent.*`.
- **Views:** `v_inventory_ledger_variance`, `v_partner_client_usage`.
- **Functions:** all migration-created helpers (106 in the fresh replay).

## 7. DIFFERENT — objects whose shape differs between staging evidence and migrations

| Object | Staging evidence | Migration (repo) | Assessment |
|---|---|---|---|
| `invoices.template` | present (base) | `add column if not exists … check` | consistent — migration is a no-op on fresh replay |
| `user_profiles.preferred_language` | **nullable** | `add column … not null default 'en'` | **conflict**: generated.ts says nullable. Base migration keeps it nullable; live capture must confirm |
| `loans`, `loan_repayments`, `share_transactions` | tables present **without FK relationships** | created with **4 FKs each** (business_id, journal/account links) | fresh DB has the FKs; staging evidence does not → **UNEXPECTED difference to verify live** |
| `audit_log.id` | `number` (integer family) | — | base uses `bigserial` (inferred); live capture must confirm identity vs serial |
| Enum label order | Constants order (live) | guarded `ADD VALUE` | replay produced **identical** label sets |

## 8. Root-cause hypotheses for the staging-evidence gaps

`database.generated.ts` contains objects from migrations dated up to
20260728000000 (e.g. all 19 `user_role` labels added on 2026-07-28) but lacks
objects from migrations dated 2026-07-25/26/27 (bank reconciliation columns,
`invoice_delivery_events`, `subscription_reminders_sent`, IAS21 columns). Three
consistent explanations, all requiring live verification:

1. **Generated types are stale** — regenerated from staging before those
   migrations were applied, and never refreshed afterwards.
2. **Staging's migration history diverges from the repository** — e.g. some
   migrations were applied to a different environment, or applied out of order,
   or the staging DB was rebuilt from an older dump.
3. **Migration files were edited after being applied** (e.g. the IAS21 file may
   have gained `exchange_rate_used`/`functional_currency` after staging was
   migrated).

The fresh-database replay (`docs/database/fresh-database-comparison.md`) applies
the repository migrations **as written**, so the fresh database is the
authoritative statement of what the repository produces. Until a live capture
is reconciled, differences between fresh and staging under hypotheses 2/3 remain
**UNKNOWN**.

## 9. RLS reconciliation

| Table group | Policies rebuilt by migration | Base migration action |
|---|---|---|
| `accounts` | 20260731000000 (6 policies) | RLS enabled only |
| `businesses` | 20260728000010 (6 policies) | RLS enabled only |
| `contacts`, `branches`, `departments`, `inventory_locations` | 20260728000008 (5 policies each) | RLS enabled only |
| `employees`, `employee_allowances`, `employee_deductions`, `payroll_runs`, `payroll_employee_lines` | 20260728000009 (4 policies each) | RLS enabled only |
| `asset_categories`, `fixed_assets`, `depreciation_schedules` | 20260811000002 (5 policies each) | RLS enabled only |
| `exchange_rates` | 20260727000000 (2 policies) | RLS enabled only |
| All other base tables (invoices, journal_*, stock_*, products, budgets, bank_statements, expenses, audit_log, profiles, user_profiles, tax_configurations, paye_bands, accounting_periods, currencies) | **none evidenced** | RLS enabled; policies = **UNKNOWN gap** |

The 20260728000008 migration's own header acknowledges that policy expressions
were inferred ("This was NOT verified against your actual policies on
invoices/expenses"), so even the covered tables must be diffed against live
`pg_policies` output.

## 10. Storage & cron reconciliation

| Object | Staging evidence | Repository | Classification |
|---|---|---|---|
| `business-logos` bucket | public (getPublicUrl in SettingsPage) | not in migrations | MISSING FROM REPOSITORY (dashboard-created) |
| `user-exports` bucket | private, signed URLs (export-my-data) | not in migrations | MISSING FROM REPOSITORY (dashboard-created) |
| Storage policies | none evidenced | none | UNKNOWN |
| Cron: expire-subscriptions-daily | `0 1 * * *` | 20260726000003 | MATCH (placeholders `<PROJECT_REF>`/`<CRON_SECRET>`) |
| Cron: send-renewal-reminders-daily | `0 8 * * *` | 20260726000005 | MATCH (placeholders) |
| Cron: generate-partner-invoices | monthly | 20260727000006 | MATCH (placeholders) |

Cron secrets are **environment configuration**, substituted at deploy time
(`supabase secrets set`), never embedded in migrations. Reproducible deployment
procedure is documented in `docs/database/database-operations.md`.

## 11. Accounting-safeguard observations (documented, NOT changed)

- `journal_lines` carries both `amount` (original currency) and `amount_base`
  (functional currency), with `is_debit`; the IAS21 migration backfills only
  draft lines — posted lines are immutable. Preserved as evidenced.
- `businesses` counters (`invoice_next_number`, `expense_next_number`,
  `payroll_next_number`) are advanced atomically by
  `reserve_next_document_number` (SECURITY DEFINER). Preserved.
- `audit_log` has **no foreign keys** in staging evidence (business/user may be
  deleted) and a hash chain (`prev_hash`/`entry_hash`) verified by
  `verify_audit_chain`. Preserved.
- `stock_transfers` links `approved_by`/`received_by`/`requested_by` to
  `user_profiles(id)`. Preserved.
- The 20260728000008 migration flags that RLS policy expressions for master data
  were inferred, not verified. This is an existing repository-internal
  acknowledgment; it remains a Phase 8B item.
- `user_profiles.preferred_language` nullability conflict (§7) — flagged, not
  silently resolved.
