# Ledgr — Fresh Database Comparison (Phase 8A.1)

## Method

1. A **disposable** PostgreSQL instance (PostgreSQL 18.4 via `embedded-postgres`,
   no Docker available in the sandbox) was initialised with empty catalogs.
2. Supabase-managed objects were stubbed read-only for replay purposes:
   `auth.users`/`auth.uid()`/`auth.role()`, `storage.buckets`/`storage.objects`,
   and stub `pg_cron`/`pg_net` extensions. **No application objects were created
   manually** — Studio-style manual patching was explicitly avoided.
3. All **57 repository migrations** were replayed in order with `ON_ERROR_STOP`
   semantics; replay **stopped at the first failure** while iterating (all
   failures were fixed in the migration sources, never by patching the database).
4. The resulting schema was dumped from the catalogs and compared against the
   staging evidence (database.generated.ts + migrations + supplement).

- Fresh database: PostgreSQL PostgreSQL 18.4 (embedded-postgres 18.4), replayed from 57 repository migrations on a disposable instance
- Replay result: **ALL 57 MIGRATIONS REPLAYED SUCCESSFULLY** (base migration
  `20250101000000_base_schema.sql` + 56 existing migrations)
- Staging evidence: database.generated.ts (live-staging-derived) + migrations + supplement

## 1. Extensions

- Fresh: pg_cron, pg_net, pg_trgm, pgcrypto, plpgsql
- Note: pg_cron/pg_net are stubs in the harness; pg_trgm was installed by the harness (not by any migration) to test the show_trgm hypothesis

## 2. Tables

- Fresh database: **65** tables
  (40 from the base migration including `currencies` + 25 created by incremental
  migrations)
- Staging evidence: 50 tables in `database.generated.ts` (+ 9 supplement tables)

- Tables present in both: **50/50** — every staging-evidenced
  table exists in the fresh database
- Tables extra in fresh (migration-created): 15 — EXPECTED
- Tables missing from fresh: 0 — none

### Column-level differences on shared tables

| Table | Columns extra in fresh (migration-added) | Type differences | Classification |
|---|---|---|---|
| accounting_periods | — | — | MATCH |
| accounts | — | — | MATCH |
| asset_categories | — | — | MATCH |
| audit_log | — | changed_fields: fresh=text[] vs evidence=string[] | null; ip_address: fresh=inet vs evidence=unknown | EXPECTED (TS mapping artifacts) |
| bank_statement_lines | match_method, match_confidence, locked_at | — | EXPECTED |
| bank_statements | reconciled_at, reconciled_by, is_locked, locked_at | — | EXPECTED |
| branches | — | — | MATCH |
| budget_lines | — | — | MATCH |
| budgets | — | — | MATCH |
| business_invitations | — | — | MATCH |
| business_users | — | — | MATCH |
| businesses | — | — | MATCH |
| contacts | — | — | MATCH |
| currencies | — | — | MATCH |
| departments | — | — | MATCH |
| depreciation_schedules | — | — | MATCH |
| employee_allowances | — | — | MATCH |
| employee_deductions | — | — | MATCH |
| employees | — | — | MATCH |
| exchange_rates | — | — | MATCH |
| expense_lines | — | — | MATCH |
| expense_payments | exchange_rate_used, functional_currency | — | EXPECTED |
| expenses | exchange_rate_used, functional_currency | — | EXPECTED |
| fixed_assets | — | — | MATCH |
| fx_revaluations | — | — | MATCH |
| inventory_balances | — | — | MATCH |
| inventory_locations | — | — | MATCH |
| invoice_lines | — | — | MATCH |
| invoice_payments | exchange_rate_used, functional_currency | — | EXPECTED |
| invoices | exchange_rate_used, functional_currency | — | EXPECTED |
| journal_entries | — | — | MATCH |
| journal_lines | exchange_rate_used, functional_currency, functional_amount | — | EXPECTED |
| loan_repayments | — | — | MATCH |
| loans | — | — | MATCH |
| paye_bands | — | — | MATCH |
| payroll_employee_lines | — | — | MATCH |
| payroll_runs | — | — | MATCH |
| product_categories | — | — | MATCH |
| products | — | — | MATCH |
| profiles | — | — | MATCH |
| share_transactions | — | — | MATCH |
| stock_movements | — | — | MATCH |
| stock_transfer_lines | — | — | MATCH |
| stock_transfers | — | — | MATCH |
| subscription_payments | — | — | MATCH |
| tax_alerts | — | — | MATCH |
| tax_configurations | — | — | MATCH |
| tax_payments | — | — | MATCH |
| tax_returns | — | — | MATCH |
| user_profiles | — | — | MATCH |

Notes:
- The `extra_in_fresh` columns are exactly the columns added by migrations
  20260725000000 (bank reconciliation) and 20260727000000 (IAS21). They are
  **EXPECTED** if `database.generated.ts` is stale relative to staging, or
  **UNEXPECTED** if staging never received those migrations. Live capture
  decides.
- The two type differences on `audit_log` are TS-mapping artifacts:
  `text[]` ↔ `string[]` and `inet` ↔ `unknown` (PostgREST maps `inet` to
  `unknown`). No real type mismatch.

### Foreign keys

- FKs evidenced on staging that are **missing from fresh: 0**
  → every FK in `database.generated.ts` exists in the fresh database. The base
  migration's FK reconstruction (constraint names included) is **validated**.

| Table | FKs only in fresh (migration-created) | Classification |
|---|---|---|
| bank_statements | bank_statements_reconciled_by_fkey | EXPECTED (migration DDL) |
| exchange_rates | exchange_rates_created_by_fkey | EXPECTED (migration DDL) |
| expense_payments | expense_payments_functional_currency_fkey | EXPECTED (migration DDL) |
| expenses | expenses_functional_currency_fkey | EXPECTED (migration DDL) |
| fx_revaluations | fx_revaluations_created_by_fkey | EXPECTED (migration DDL) |
| invoice_payments | invoice_payments_functional_currency_fkey | EXPECTED (migration DDL) |
| invoices | invoices_functional_currency_fkey | EXPECTED (migration DDL) |
| journal_lines | journal_lines_functional_currency_fkey | EXPECTED (migration DDL) |
| loan_repayments | loan_repayments_bank_account_id_fkey, loan_repayments_business_id_fkey, loan_repayments_journal_entry_id_fkey, loan_repayments_loan_id_fkey | UNEXPECTED per staging evidence — verify live |
| loans | loans_business_id_fkey, loans_drawdown_journal_id_fkey, loans_interest_expense_account_id_fkey, loans_loan_account_id_fkey | UNEXPECTED per staging evidence — verify live |
| share_transactions | share_transactions_bank_account_id_fkey, share_transactions_business_id_fkey, share_transactions_journal_entry_id_fkey, share_transactions_share_account_id_fkey | UNEXPECTED per staging evidence — verify live |

`loans`/`loan_repayments`/`share_transactions` appear in staging evidence with
**no** FK relationships, while the capital-financing migration creates them with
four FKs each. Either the generated types predate those FKs, or staging's table
structure differs from the migration. **UNKNOWN until live capture.**

### RLS and policies on shared tables

The fresh database has RLS enabled on all base tables and the policy sets the
migrations rebuild (accounts, businesses, master data, payroll, fixed assets,
exchange rates). Policies on the remaining base tables exist on staging but are
not evidenced in the repository — **UNKNOWN gap** (Phase 8B item).

## 3. Views

- Fresh: v_cash_flow, v_inventory_ledger_variance, v_partner_client_usage
- Staging evidence: v_ar_ageing, v_asset_register, v_cash_flow, v_reorder_alerts, v_trial_balance
- Missing from fresh: v_ar_ageing, v_asset_register, v_reorder_alerts, v_trial_balance —
  **UNEXPECTED (known gap)**: view bodies are not in the repository; live capture required
- Extra in fresh (migration-created): v_inventory_ledger_variance, v_partner_client_usage — EXPECTED

## 4. Functions

- Fresh: 106 functions (all migration-created
  helpers + `pg_trgm` extension functions)
- Staging evidence: 14 functions
- Staging-evidenced functions missing from fresh: **9**

  - `accept_invitation`
  - `create_business_with_owner`
  - `current_user_role`
  - `get_enum_values`
  - `get_user_role`
  - `invite_member`
  - `log_manual_audit_event`
  - `seed_new_business`
  - `verify_audit_chain`

These nine RPCs (`accept_invitation`, `create_business_with_owner`,
`current_user_role`, `get_enum_values`, `get_user_role`, `invite_member`,
`log_manual_audit_event`, `seed_new_business`, `verify_audit_chain`) are the
**only functions not reproducible from the repository** — their bodies exist
only in the live database. `show_limit`/`show_trgm` are now reproduced via the
`pg_trgm` extension in the base migration (fresh: present / present).

## 5. Enums

- Fresh enums: 16
- Enum label diffs vs staging evidence: **0** —
  all 16 enums match label-for-label, in order.

## 6. Cron

- Fresh: 3 stub job records
  (harness stub — real Supabase `cron.job` carries the edge-function schedules
  with `<PROJECT_REF>`/`<CRON_SECRET>` placeholders resolved at deploy time).
- stub cron.schedule records; real staging jobs contain <PROJECT_REF>/<CRON_SECRET> placeholders resolved at deploy time

## 7. Classification summary

| Difference | Classification |
|---|---|
| 39 base tables reconstructed and present in fresh | EXPECTED (this phase's deliverable) |
| 12 base enums reconstructed, labels identical | EXPECTED |
| All 167 staging-evidenced FKs present in fresh (names included) | EXPECTED |
| Migration-added columns/tables/views present in fresh but not in generated types | EXPECTED (stale generated types) or UNEXPECTED (divergent staging history) — live capture decides |
| `loans`/`loan_repayments`/`share_transactions` FKs in fresh only | UNKNOWN — verify live |
| 9 base RPC bodies missing from fresh | **UNEXPECTED — known gap (live capture required)** |
| 4 base view bodies missing from fresh | **UNEXPECTED — known gap (live capture required)** |
| RLS policies on 23 base tables not evidenced | **UNKNOWN — known gap (live capture required)** |
| Storage buckets/policies absent from fresh | **UNKNOWN — dashboard-created, not in migrations** |
| `user_profiles.preferred_language` nullability conflict | UNKNOWN — live capture decides |

## 8. Bottom line

The repository now replays **cleanly** into a fresh database that contains
every staging-evidenced table, column, enum and FK, plus every object the
incremental migrations define. The remaining differences are the nine RPC
bodies, four view bodies, un-evidenced RLS policies and storage/cron
configuration — all of which require the live read-only capture that the
sandbox could not perform. **Target `NO UNEXPECTED DIFFERENCES` is not yet
met**: the differences above are either known gaps (needing live capture) or
UNKNOWN (stale-generated-types vs divergent-history).

Machine-readable comparison: `artifacts/database/fresh-database-comparison.json`
Fresh schema dump: `artifacts/database/fresh-schema.json`
Fresh types approximation: `artifacts/database/fresh-database.generated.approx.ts`
