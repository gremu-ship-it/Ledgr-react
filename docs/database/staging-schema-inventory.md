# Ledgr — Staging Schema Inventory (Phase 8A.1)

> **Status: EVIDENCE-BASED.** The live staging database could not be reached from
> the Phase 8A.1 sandbox (no credentials; Supabase network blocked — see the
> environment isolation report in the final report). This inventory is built from
> the strongest available evidence, chiefly `src/dal/types/database.generated.ts`,
> which was itself generated **from the live staging database** (PostgREST 14.5).
> Every entry carries a confidence marker. Live capture (`scripts/database/
> capture-staging-schema.sh`) must be run before this inventory is certified.

- Generated: 2026-08-13T12:04:01+00:00
- PostgREST version at generation: "14.5"
- PostgreSQL version: UNVERIFIED — SHOW server_version requires live capture (Step 3 pending)
- Evidence sources: src/dal/types/database.generated.ts, supabase/migrations/*.sql (51 files), src/dal/types/database.supplement.ts, supabase/functions/* (edge functions), src/dal/repositories/*.ts, src/lib/*, src/pages/*, scripts/*.sql (diagnostics), local-backup/

## Confidence legend

| evidence | directly evidenced in repository (migration DDL, generated types, code) |
| convention | strong convention evidenced across migration-created tables (uuid pk + gen_random_uuid, timestamptz + now(), text, numeric) |
| override | explicit override from evidence |
| inferred | inferred; no direct repository evidence — MUST verify against live staging |
| unknown | no evidence in repository — not reconstructable without live capture |

## Classification summary

- Tables in `database.generated.ts`: **50**
- **Base tables (missing from repository migrations): 39**
- Tables created by migrations: 26
- Migration tables missing from generated.ts (stale types): 15
- Supplement tables (hand-typed): 9
- **Base enums: 12** — account_subtype, account_type, asset_status, currency_code, depreciation_method, invoice_status, journal_status, payment_method, payroll_status, stock_movement_type, tax_code, user_role
- **Base functions (signatures known, bodies missing): 11**
- **Base views (bodies missing): 4**

## Extensions

| Extension | Schema | Classification | Evidence |
|---|---|---|---|
| pgcrypto | extensions | MATCH (created by migration) | 20260727000000_multi_currency_ias21.sql (create extension if not exists pgcrypto) |
| pg_cron | cron | MATCH (created by migration) | 20260726000003_schedule_expire_subscriptions.sql |
| pg_net | net | MATCH (created by migration) | 20260726000003_schedule_expire_subscriptions.sql |
| pg_trgm | public | UNKNOWN — present on staging per generated types function list; not enabled by any migration | suspected from show_trgm/show_limit in generated types |

## Enums

| Enum | Labels (live order) | Classification |
|---|---|---|
| account_subtype | current_asset, non_current_asset, fixed_asset, current_liability, non_current_liability, share_capital, retained_earnings, reserves, revenue, other_income, cost_of_sales, operating_expense, finance_cost, tax_expense, depreciation_amortisation | MISSING FROM REPOSITORY (base enum) |
| account_type | asset, liability, equity, income, expense | MISSING FROM REPOSITORY (base enum) |
| asset_status | active, disposed, fully_depreciated, impaired, under_construction | MISSING FROM REPOSITORY (base enum) |
| currency_code | MWK, USD, EUR, GBP, ZAR, ZMW, TZS, KES, UGX | MISSING FROM REPOSITORY (base enum) |
| depreciation_method | straight_line, reducing_balance, units_of_production, sum_of_years_digits | MISSING FROM REPOSITORY (base enum) |
| invoice_status | draft, sent, partially_paid, paid, overdue, void, credit_note | MISSING FROM REPOSITORY (base enum) |
| journal_status | draft, posted, reversed | MISSING FROM REPOSITORY (base enum) |
| payment_method | cash, bank_transfer, cheque, airtel_money, tnm_mpamba, card, other | MISSING FROM REPOSITORY (base enum) |
| payroll_status | draft, approved, paid, void | MISSING FROM REPOSITORY (base enum) |
| stock_movement_type | purchase, sale, adjustment_in, adjustment_out, transfer_in, transfer_out, return_in, return_out, opening_balance, write_off | MISSING FROM REPOSITORY (base enum) |
| tax_alert_channel | email, sms | MATCH (created by migration) |
| tax_alert_status | pending, sent, failed | MATCH (created by migration) |
| tax_alert_type | 14_day, 7_day, 1_day, due_date | MATCH (created by migration) |
| tax_code | vat_standard, vat_zero, vat_exempt, paye, wht_15, wht_20, wht_10, cit, fbt, none, tpr_pension | MISSING FROM REPOSITORY (base enum) |
| tax_return_status | pending, filed, paid, overdue, void | MATCH (created by migration) |
| user_role | owner, admin, accountant, payroll_manager, supervisor, data_entry, inventory_manager, sales_clerk, auditor, viewer, purchasing_officer, warehouse_worker, sales_manager, customer_service_rep, tax_compliance_officer, treasury_manager, asset_manager, board_member, branch_manager | MISSING FROM REPOSITORY (base enum) |

## Tables

### `accounting_periods`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| accounting_periods_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| closed_at | timestamptz | `string | null` | yes | `—` | convention |
| closed_by | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_closed | boolean | `boolean` | no | `—` | convention |
| name | text | `string` | no | `—` | convention |
| period_end | date | `string` | no | `—` | evidence |
| period_start | date | `string` | no | `—` | evidence |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `accounts`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| accounts_branch_id_fkey | branch_id | branches(id) |
| accounts_business_id_fkey | business_id | businesses(id) |
| accounts_currency_fkey | currency | currencies(code) |
| accounts_department_id_fkey | department_id | departments(id) |
| accounts_parent_id_fkey | parent_id | accounts(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| account_subtype | account_subtype | `Database["public"]["Enums"]["account_subtype"] | null` | yes | `—` | enum |
| account_type | account_type | `Database["public"]["Enums"]["account_type"]` | no | `—` | enum |
| bank_account_number | text | `string | null` | yes | `—` | convention |
| bank_branch | text | `string | null` | yes | `—` | convention |
| bank_name | text | `string | null` | yes | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| code | text | `string` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| currency | text | `string` | no | `—` | convention |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| description | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| is_bank_account | boolean | `boolean` | no | `—` | convention |
| is_group | boolean | `boolean` | no | `—` | convention |
| is_system | boolean | `boolean` | no | `—` | convention |
| mobile_money_number | text | `string | null` | yes | `—` | convention |
| mobile_money_type | text | `string | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| normal_balance | text | `string` | no | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| opening_balance | numeric | `number` | no | `—` | convention |
| opening_balance_date | text | `string | null` | yes | `—` | convention |
| parent_id | uuid | `string | null` | yes | `—` | fk |
| tax_code | tax_code | `Database["public"]["Enums"]["tax_code"] | null` | yes | `—` | enum |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `asset_categories`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| asset_categories_accumulated_dep_account_id_fkey | accumulated_dep_account_id | accounts(id) |
| asset_categories_asset_account_id_fkey | asset_account_id | accounts(id) |
| asset_categories_business_id_fkey | business_id | businesses(id) |
| asset_categories_dep_expense_account_id_fkey | dep_expense_account_id | accounts(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| accumulated_dep_account_id | uuid | `string | null` | yes | `—` | fk |
| asset_account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| dep_expense_account_id | uuid | `string | null` | yes | `—` | fk |
| depreciation_method | depreciation_method | `Database["public"]["Enums"]["depreciation_method"]` | no | `—` | enum |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| is_depreciable | boolean | `boolean` | no | `true` | convention / default: evidence |
| mra_depreciation_rate | numeric | `number | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| residual_percent | numeric | `number` | no | `—` | convention |
| useful_life_years | numeric | `number | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `audit_log`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | inferred |
| changed_fields | text[] | `string[] | null` | yes | `—` | convention |
| entry_hash | text | `string | null` | yes | `—` | convention |
| event_type | text | `string` | no | `—` | convention |
| id | bigserial | `number` | no | `—` | override |
| ip_address | inet | `unknown` | no | `—` | override |
| new_values | jsonb | `Json | null` | yes | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| occurred_at | timestamptz | `string` | no | `—` | convention |
| old_values | jsonb | `Json | null` | yes | `—` | convention |
| prev_hash | text | `string | null` | yes | `—` | convention |
| resource_id | text | `string | null` | yes | `—` | convention |
| resource_ref | text | `string | null` | yes | `—` | convention |
| resource_type | text | `string` | no | `—` | convention |
| session_id | text | `string | null` | yes | `—` | convention |
| user_agent | text | `string | null` | yes | `—` | convention |
| user_email | text | `string | null` | yes | `—` | convention |
| user_id | uuid | `string | null` | yes | `—` | inferred |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `bank_statement_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| bank_statement_lines_business_id_fkey | business_id | businesses(id) |
| bank_statement_lines_journal_line_id_fkey | journal_line_id | journal_lines(id) |
| bank_statement_lines_statement_id_fkey | statement_id | bank_statements(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| balance | numeric | `number | null` | yes | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| credit_amount | numeric | `number` | no | `—` | convention |
| debit_amount | numeric | `number` | no | `—` | convention |
| description | text | `string` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_reconciled | boolean | `boolean` | no | `—` | convention |
| journal_line_id | uuid | `string | null` | yes | `—` | fk |
| reference | text | `string | null` | yes | `—` | convention |
| statement_id | uuid | `string` | no | `—` | fk |
| transaction_date | date | `string` | no | `—` | evidence |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `bank_statements`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| bank_statements_account_id_fkey | account_id | accounts(id) |
| bank_statements_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| account_id | uuid | `string` | no | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| closing_balance | numeric | `number` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| opening_balance | numeric | `number` | no | `—` | convention |
| source | text | `string | null` | yes | `—` | convention |
| statement_date | date | `string` | no | `—` | evidence |
| uploaded_by | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `branches`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| branches_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| code | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| location | text | `string | null` | yes | `—` | convention |
| manager_id | text | `string | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `budget_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| budget_lines_account_id_fkey | account_id | accounts(id) |
| budget_lines_branch_id_fkey | branch_id | branches(id) |
| budget_lines_budget_id_fkey | budget_id | budgets(id) |
| budget_lines_business_id_fkey | business_id | businesses(id) |
| budget_lines_department_id_fkey | department_id | departments(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| account_id | uuid | `string` | no | `—` | fk |
| annual_total | numeric | `number | null` | yes | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| budget_id | uuid | `string` | no | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| m01_amount | numeric | `number` | no | `—` | convention |
| m02_amount | numeric | `number` | no | `—` | convention |
| m03_amount | numeric | `number` | no | `—` | convention |
| m04_amount | numeric | `number` | no | `—` | convention |
| m05_amount | numeric | `number` | no | `—` | convention |
| m06_amount | numeric | `number` | no | `—` | convention |
| m07_amount | numeric | `number` | no | `—` | convention |
| m08_amount | numeric | `number` | no | `—` | convention |
| m09_amount | numeric | `number` | no | `—` | convention |
| m10_amount | numeric | `number` | no | `—` | convention |
| m11_amount | numeric | `number` | no | `—` | convention |
| m12_amount | numeric | `number` | no | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `budgets`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| budgets_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| fiscal_year | text | `string` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| name | text | `string` | no | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| period_end | date | `string` | no | `—` | evidence |
| period_start | date | `string` | no | `—` | evidence |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `business_invitations`

**Classification:** MATCH (created by migration) — created by `20260723000001_expanded_roles_and_invitations.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| business_invitations_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| accepted_at | timestamptz | `string | null` | yes | `—` | convention |
| accepted_by | text | `string | null` | yes | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| email | text | `string | null` | yes | `—` | convention |
| expires_at | timestamptz | `string` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| invited_at | timestamptz | `string` | no | `—` | convention |
| invited_by | text | `string | null` | yes | `—` | convention |
| role | user_role | `Database["public"]["Enums"]["user_role"]` | no | `—` | enum |
| token | text | `string` | no | `—` | convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `business_users`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| business_users_branch_id_fkey | branch_id | branches(id) |
| business_users_business_id_fkey | business_id | businesses(id) |

**Unique constraints (evidenced):**
- `business_id, user_id` — migrations use ON CONFLICT on these columns (20260728000003/20260728000002)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| accepted_at | timestamptz | `string | null` | yes | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| invitation_expires_at | timestamptz | `string | null` | yes | `—` | convention |
| invitation_token | text | `string | null` | yes | `—` | convention |
| invited_at | timestamptz | `string | null` | yes | `—` | convention |
| invited_by | uuid | `string | null` | yes | `—` | inferred |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| role | user_role | `Database["public"]["Enums"]["user_role"]` | no | `—` | enum |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| user_id | uuid | `string` | no | `—` | evidence |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `businesses`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| businesses_base_currency_fkey | base_currency | currencies(code) |

**Check constraints (evidenced):**
- `businesses_plan_tier_check` `(plan_tier in ('free', 'growth', 'pro', 'enterprise'))` — 20260726000001_add_business_plan_tier.sql

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| address_line1 | text | `string | null` | yes | `—` | convention |
| address_line2 | text | `string | null` | yes | `—` | convention |
| base_currency | text | `string` | no | `—` | convention |
| brand_color | text | `string | null` | yes | `—` | convention |
| city | text | `string | null` | yes | `—` | convention |
| coa_template | text | `string` | no | `—` | convention |
| country | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| default_payment_method | payment_method | `Database["public"]["Enums"]["payment_method"] | null` | yes | `—` | enum |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| email | text | `string | null` | yes | `—` | convention |
| expense_next_number | integer | `number` | no | `—` | override |
| expense_prefix | text | `string | null` | yes | `—` | convention |
| financial_year_start | text | `string` | no | `—` | override |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| invoice_next_number | integer | `number` | no | `—` | override |
| invoice_prefix | text | `string | null` | yes | `—` | convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| logo_url | text | `string | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| payroll_next_number | integer | `number` | no | `—` | override |
| payroll_prefix | text | `string | null` | yes | `—` | convention |
| phone | text | `string | null` | yes | `—` | convention |
| plan_expires_at | timestamptz | `string | null` | yes | `—` | convention |
| plan_tier | text | `string` | no | `'free'` | override / default: evidence |
| plan_updated_at | timestamptz | `string | null` | yes | `—` | convention |
| registration_number | text | `string | null` | yes | `—` | convention |
| timezone | text | `string` | no | `—` | convention |
| tpin | text | `string | null` | yes | `—` | convention |
| trading_name | text | `string | null` | yes | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| vat_number | text | `string | null` | yes | `—` | convention |
| vat_period | text | `string | null` | yes | `—` | convention |
| vat_registered | boolean | `boolean` | no | `—` | convention |
| website | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `contacts`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| contacts_ap_account_id_fkey | ap_account_id | accounts(id) |
| contacts_ar_account_id_fkey | ar_account_id | accounts(id) |
| contacts_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| address_line1 | text | `string | null` | yes | `—` | convention |
| address_line2 | text | `string | null` | yes | `—` | convention |
| ap_account_id | uuid | `string | null` | yes | `—` | fk |
| ar_account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| city | text | `string | null` | yes | `—` | convention |
| contact_type | text | `string` | no | `—` | convention |
| country | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| credit_limit | numeric | `number | null` | yes | `—` | convention |
| credit_terms_days | numeric | `number | null` | yes | `—` | convention |
| currency | currency_code | `Database["public"]["Enums"]["currency_code"] | null` | yes | `—` | enum |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| email | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| mobile_money_number | text | `string | null` | yes | `—` | convention |
| mobile_money_type | text | `string | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| phone | text | `string | null` | yes | `—` | convention |
| tpin | text | `string | null` | yes | `—` | convention |
| trading_name | text | `string | null` | yes | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| vat_number | text | `string | null` | yes | `—` | convention |
| wht_exempt | boolean | `boolean` | no | `—` | convention |
| wht_exemption_ref | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `currencies`

**Classification:** MATCH (created by migration) — created by `20260727000000_multi_currency_ias21.sql`


| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| code | text | `string` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| decimal_places | numeric | `number` | no | `—` | convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| is_frankfurter_supported | boolean | `boolean` | no | `—` | convention |
| is_primary | boolean | `boolean` | no | `—` | convention |
| name | text | `string` | no | `—` | convention |
| symbol | text | `string` | no | `—` | convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `departments`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| departments_branch_id_fkey | branch_id | branches(id) |
| departments_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| code | text | `string | null` | yes | `—` | convention |
| cost_centre | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| head_user_id | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| name | text | `string` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `depreciation_schedules`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| depreciation_schedules_asset_id_fkey | asset_id | fixed_assets(id) |
| depreciation_schedules_business_id_fkey | business_id | businesses(id) |
| depreciation_schedules_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| accumulated_to_date | numeric | `number` | no | `—` | convention |
| asset_id | uuid | `string` | no | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| depreciation_charge | numeric | `number` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| net_book_value | numeric | `number` | no | `—` | convention |
| period_end | date | `string` | no | `—` | evidence |
| period_start | date | `string` | no | `—` | evidence |
| posted | boolean | `boolean` | no | `—` | convention |
| posted_at | timestamptz | `string | null` | yes | `—` | convention |
| posted_by | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `employee_allowances`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| employee_allowances_business_id_fkey | business_id | businesses(id) |
| employee_allowances_employee_id_fkey | employee_id | employees(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| effective_from | date | `string` | no | `—` | evidence |
| effective_to | date | `string | null` | yes | `—` | evidence |
| employee_id | uuid | `string` | no | `—` | fk |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| is_taxable | boolean | `boolean` | no | `—` | convention |
| name | text | `string` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `employee_deductions`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| employee_deductions_business_id_fkey | business_id | businesses(id) |
| employee_deductions_employee_id_fkey | employee_id | employees(id) |
| employee_deductions_liability_account_id_fkey | liability_account_id | accounts(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| deduction_type | text | `string` | no | `—` | convention |
| effective_from | date | `string` | no | `—` | evidence |
| effective_to | date | `string | null` | yes | `—` | evidence |
| employee_id | uuid | `string` | no | `—` | fk |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| liability_account_id | uuid | `string | null` | yes | `—` | fk |
| name | text | `string` | no | `—` | convention |
| percentage | numeric | `number` | no | `—` | convention |
| pre_tax | boolean | `boolean` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `employees`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| employees_branch_id_fkey | branch_id | branches(id) |
| employees_business_id_fkey | business_id | businesses(id) |
| employees_department_id_fkey | department_id | departments(id) |
| employees_paye_liability_account_id_fkey | paye_liability_account_id | accounts(id) |
| employees_salary_account_id_fkey | salary_account_id | accounts(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| bank_account_number | text | `string | null` | yes | `—` | convention |
| bank_branch | text | `string | null` | yes | `—` | convention |
| bank_name | text | `string | null` | yes | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| currency | currency_code | `Database["public"]["Enums"]["currency_code"]` | no | `—` | enum |
| date_of_birth | date | `string | null` | yes | `—` | evidence |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| email | text | `string | null` | yes | `—` | convention |
| employee_number | text | `string` | no | `—` | convention |
| employment_type | text | `string` | no | `—` | convention |
| end_date | date | `string | null` | yes | `—` | evidence |
| first_name | text | `string` | no | `—` | convention |
| gender | text | `string | null` | yes | `—` | convention |
| gross_salary | numeric | `number` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| job_title | text | `string | null` | yes | `—` | convention |
| last_name | text | `string` | no | `—` | convention |
| mobile_money_number | text | `string | null` | yes | `—` | convention |
| mobile_money_type | text | `string | null` | yes | `—` | convention |
| national_id | text | `string | null` | yes | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| pay_frequency | text | `string` | no | `—` | convention |
| paye_code | text | `string | null` | yes | `—` | convention |
| paye_liability_account_id | uuid | `string | null` | yes | `—` | fk |
| paye_tax_class | text | `string | null` | yes | `—` | convention |
| payment_method | payment_method | `Database["public"]["Enums"]["payment_method"]` | no | `—` | enum |
| phone | text | `string | null` | yes | `—` | convention |
| probation_end_date | text | `string | null` | yes | `—` | convention |
| salary_account_id | uuid | `string | null` | yes | `—` | fk |
| start_date | date | `string` | no | `—` | evidence |
| tax_exempt | boolean | `boolean` | no | `—` | convention |
| tpin | text | `string | null` | yes | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `exchange_rates`

**Classification:** MATCH (created by migration) — created by `20260727000000_multi_currency_ias21.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| exchange_rates_business_id_fkey | business_id | businesses(id) |
| exchange_rates_from_currency_fkey | from_currency | currencies(code) |
| exchange_rates_to_currency_fkey | to_currency | currencies(code) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| from_currency | text | `string` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| rate | numeric(20,10) | `number` | no | `—` | override |
| rate_date | text | `string` | no | `—` | convention |
| source | text | `string | null` | yes | `—` | convention |
| to_currency | text | `string` | no | `—` | convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `expense_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| expense_lines_account_id_fkey | account_id | accounts(id) |
| expense_lines_business_id_fkey | business_id | businesses(id) |
| expense_lines_expense_id_fkey | expense_id | expenses(id) |
| expense_lines_product_id_fkey | product_id | products(id) |
| expense_lines_product_id_fkey | product_id | v_reorder_alerts(product_id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| description | text | `string` | no | `—` | convention |
| discount_amount | numeric | `number` | no | `0` | convention / default: evidence |
| discount_percent | numeric | `number` | no | `0` | convention / default: evidence |
| expense_id | uuid | `string` | no | `—` | fk |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| line_number | numeric | `number` | no | `—` | convention |
| line_subtotal | numeric | `number | null` | yes | `—` | convention |
| line_total | numeric | `number` | no | `—` | convention |
| product_id | uuid | `string | null` | yes | `—` | fk |
| quantity | numeric | `number` | no | `—` | convention |
| tax_amount | numeric | `number` | no | `—` | convention |
| tax_code | tax_code | `Database["public"]["Enums"]["tax_code"]` | no | `—` | enum |
| tax_rate | numeric | `number` | no | `—` | convention |
| unit_price | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `expense_payments`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| expense_payments_bank_account_id_fkey | bank_account_id | accounts(id) |
| expense_payments_business_id_fkey | business_id | businesses(id) |
| expense_payments_currency_fkey | currency | currencies(code) |
| expense_payments_expense_id_fkey | expense_id | expenses(id) |
| expense_payments_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| expense_payments_original_currency_fkey | original_currency | currencies(code) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| bank_account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| currency | text | `string` | no | `—` | convention |
| exchange_rate | numeric(20,10) | `number` | no | `—` | override |
| expense_id | uuid | `string` | no | `—` | fk |
| functional_amount | numeric | `number | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| notes | text | `string | null` | yes | `—` | convention |
| original_amount | numeric | `number | null` | yes | `—` | convention |
| original_currency | text | `string | null` | yes | `—` | convention |
| payment_date | date | `string` | no | `—` | evidence |
| payment_method | payment_method | `Database["public"]["Enums"]["payment_method"]` | no | `—` | enum |
| rate_date | date | `string | null` | yes | `—` | evidence |
| rate_is_stale | boolean | `boolean` | no | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `expenses`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| expenses_ap_account_id_fkey | ap_account_id | accounts(id) |
| expenses_branch_id_fkey | branch_id | branches(id) |
| expenses_business_id_fkey | business_id | businesses(id) |
| expenses_contact_id_fkey | contact_id | contacts(id) |
| expenses_contact_id_fkey | contact_id | v_ar_ageing(contact_id) |
| expenses_currency_fkey | currency | currencies(code) |
| expenses_department_id_fkey | department_id | departments(id) |
| expenses_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| expenses_original_currency_fkey | original_currency | currencies(code) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount_paid | numeric | `number` | no | `—` | convention |
| ap_account_id | uuid | `string | null` | yes | `—` | fk |
| approved_at | timestamptz | `string | null` | yes | `—` | convention |
| approved_by | text | `string | null` | yes | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| contact_id | uuid | `string | null` | yes | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| currency | text | `string` | no | `—` | convention |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| due_date | date | `string | null` | yes | `—` | evidence |
| exchange_rate | numeric(20,10) | `number` | no | `—` | override |
| expense_date | date | `string` | no | `—` | evidence |
| expense_number | text | `string` | no | `—` | convention |
| expense_type | text | `string` | no | `—` | convention |
| functional_amount | numeric | `number | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| notes | text | `string | null` | yes | `—` | convention |
| original_amount | numeric | `number | null` | yes | `—` | convention |
| original_currency | text | `string | null` | yes | `—` | convention |
| rate_date | date | `string | null` | yes | `—` | evidence |
| rate_is_stale | boolean | `boolean` | no | `—` | convention |
| receipt_filename | text | `string | null` | yes | `—` | convention |
| receipt_mime_type | text | `string | null` | yes | `—` | convention |
| receipt_size_bytes | numeric | `number | null` | yes | `—` | convention |
| receipt_url | text | `string | null` | yes | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |
| status | text | `string` | no | `—` | convention |
| subtotal | numeric | `number` | no | `—` | convention |
| discount_amount | numeric | `number` | no | `0` | convention / default: evidence |
| discount_percent | numeric | `number` | no | `0` | convention / default: evidence |
| total_amount | numeric | `number` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| vat_amount | numeric | `number` | no | `—` | convention |
| wht_amount | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `fixed_assets`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| fixed_assets_accumulated_dep_account_id_fkey | accumulated_dep_account_id | accounts(id) |
| fixed_assets_asset_account_id_fkey | asset_account_id | accounts(id) |
| fixed_assets_branch_id_fkey | branch_id | branches(id) |
| fixed_assets_business_id_fkey | business_id | businesses(id) |
| fixed_assets_category_id_fkey | category_id | asset_categories(id) |
| fixed_assets_dep_expense_account_id_fkey | dep_expense_account_id | accounts(id) |
| fixed_assets_department_id_fkey | department_id | departments(id) |
| fixed_assets_disposal_journal_id_fkey | disposal_journal_id | journal_entries(id) |
| fixed_assets_purchase_journal_id_fkey | purchase_journal_id | journal_entries(id) |
| fixed_assets_revaluation_surplus_account_fkey | revaluation_surplus_account | accounts(id) |
| fixed_assets_supplier_id_fkey | supplier_id | contacts(id) |
| fixed_assets_supplier_id_fkey | supplier_id | v_ar_ageing(contact_id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| accumulated_dep_account_id | uuid | `string | null` | yes | `—` | fk |
| accumulated_depreciation | numeric | `number` | no | `—` | convention |
| acquisition_cost | numeric | `number` | no | `—` | convention |
| acquisition_date | date | `string` | no | `—` | evidence |
| asset_account_id | uuid | `string | null` | yes | `—` | fk |
| asset_number | text | `string` | no | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| category_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| dep_expense_account_id | uuid | `string | null` | yes | `—` | fk |
| department_id | uuid | `string | null` | yes | `—` | fk |
| depreciable_amount | numeric | `number | null` | yes | `—` | convention |
| depreciation_method | depreciation_method | `Database["public"]["Enums"]["depreciation_method"]` | no | `—` | enum |
| depreciation_rate | numeric | `number | null` | yes | `—` | convention |
| depreciation_start_date | text | `string` | no | `—` | convention |
| description | text | `string | null` | yes | `—` | convention |
| disposal_date | date | `string | null` | yes | `—` | evidence |
| disposal_journal_id | uuid | `string | null` | yes | `—` | fk |
| disposal_proceeds | numeric | `number | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| image_url | text | `string | null` | yes | `—` | convention |
| insurance_expiry_date | text | `string | null` | yes | `—` | convention |
| insurance_policy_number | text | `string | null` | yes | `—` | convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| is_depreciable | boolean | `boolean` | no | `true` | convention / default: evidence |
| last_depreciation_date | text | `string | null` | yes | `—` | convention |
| location | text | `string | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| net_book_value | numeric | `number | null` | yes | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| purchase_invoice_ref | text | `string | null` | yes | `—` | convention |
| purchase_journal_id | uuid | `string | null` | yes | `—` | fk |
| residual_value | numeric | `number` | no | `—` | convention |
| revaluation_date | text | `string | null` | yes | `—` | convention |
| revaluation_surplus_account | uuid | `string | null` | yes | `—` | fk |
| revalued_amount | numeric | `number | null` | yes | `—` | convention |
| serial_number | text | `string | null` | yes | `—` | convention |
| status | asset_status | `Database["public"]["Enums"]["asset_status"]` | no | `—` | enum |
| supplier_id | uuid | `string | null` | yes | `—` | fk |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| useful_life_months | numeric | `number | null` | yes | `—` | convention |
| useful_life_years | numeric | `number | null` | yes | `—` | convention |
| warranty_expiry_date | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `fx_revaluations`

**Classification:** MATCH (created by migration) — created by `20260727000000_multi_currency_ias21.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| fx_revaluations_business_id_fkey | business_id | businesses(id) |
| fx_revaluations_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| fx_revaluations_reversal_entry_id_fkey | reversal_entry_id | journal_entries(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| closing_rate_source | text | `string` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| line_count | numeric | `number` | no | `—` | convention |
| revaluation_date | text | `string` | no | `—` | convention |
| reversal_entry_id | uuid | `string | null` | yes | `—` | fk |
| status | text | `string` | no | `—` | convention |
| total_unrealised_gain | numeric | `number` | no | `—` | convention |
| total_unrealised_loss | numeric | `number` | no | `—` | convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `inventory_balances`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| inventory_balances_business_id_fkey | business_id | businesses(id) |
| inventory_balances_location_id_fkey | location_id | inventory_locations(id) |
| inventory_balances_product_id_fkey | product_id | products(id) |
| inventory_balances_product_id_fkey | product_id | v_reorder_alerts(product_id) |

**Unique constraints (evidenced):**
- `business_id, product_id, location_id` — migrations use ON CONFLICT on these columns (20260728000003/20260728000002)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| average_cost | numeric | `number` | no | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| last_movement_at | timestamptz | `string | null` | yes | `—` | convention |
| location_id | uuid | `string` | no | `—` | fk |
| product_id | uuid | `string` | no | `—` | fk |
| quantity_available | numeric | `number | null` | yes | `—` | convention |
| quantity_on_hand | numeric | `number` | no | `—` | convention |
| quantity_reserved | numeric | `number` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `inventory_locations`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| inventory_locations_branch_id_fkey | branch_id | branches(id) |
| inventory_locations_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| code | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| is_default | boolean | `boolean` | no | `—` | convention |
| name | text | `string` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `invoice_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| fk_invoice_line_product | product_id | products(id) |
| fk_invoice_line_product | product_id | v_reorder_alerts(product_id) |
| invoice_lines_account_id_fkey | account_id | accounts(id) |
| invoice_lines_business_id_fkey | business_id | businesses(id) |
| invoice_lines_invoice_id_fkey | invoice_id | invoices(id) |
| invoice_lines_invoice_id_fkey | invoice_id | v_ar_ageing(invoice_id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| description | text | `string` | no | `—` | convention |
| discount_amount | numeric | `number` | no | `0` | convention / default: evidence |
| discount_percent | numeric | `number` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| invoice_id | uuid | `string` | no | `—` | fk |
| line_number | numeric | `number` | no | `—` | convention |
| line_subtotal | numeric | `number | null` | yes | `—` | convention |
| line_total | numeric | `number` | no | `—` | convention |
| product_id | uuid | `string | null` | yes | `—` | fk |
| quantity | numeric | `number` | no | `—` | convention |
| tax_amount | numeric | `number` | no | `—` | convention |
| tax_code | tax_code | `Database["public"]["Enums"]["tax_code"]` | no | `—` | enum |
| tax_rate | numeric | `number` | no | `—` | convention |
| unit_price | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `invoice_payments`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| invoice_payments_bank_account_id_fkey | bank_account_id | accounts(id) |
| invoice_payments_business_id_fkey | business_id | businesses(id) |
| invoice_payments_currency_fkey | currency | currencies(code) |
| invoice_payments_invoice_id_fkey | invoice_id | invoices(id) |
| invoice_payments_invoice_id_fkey | invoice_id | v_ar_ageing(invoice_id) |
| invoice_payments_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| invoice_payments_original_currency_fkey | original_currency | currencies(code) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| bank_account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| currency | text | `string` | no | `—` | convention |
| exchange_rate | numeric(20,10) | `number` | no | `—` | override |
| functional_amount | numeric | `number | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| invoice_id | uuid | `string` | no | `—` | fk |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| notes | text | `string | null` | yes | `—` | convention |
| original_amount | numeric | `number | null` | yes | `—` | convention |
| original_currency | text | `string | null` | yes | `—` | convention |
| payment_date | date | `string` | no | `—` | evidence |
| payment_method | payment_method | `Database["public"]["Enums"]["payment_method"]` | no | `—` | enum |
| rate_date | date | `string | null` | yes | `—` | evidence |
| rate_is_stale | boolean | `boolean` | no | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `invoices`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| invoices_ar_account_id_fkey | ar_account_id | accounts(id) |
| invoices_branch_id_fkey | branch_id | branches(id) |
| invoices_business_id_fkey | business_id | businesses(id) |
| invoices_contact_id_fkey | contact_id | contacts(id) |
| invoices_contact_id_fkey | contact_id | v_ar_ageing(contact_id) |
| invoices_credit_note_for_fkey | credit_note_for | invoices(id) |
| invoices_credit_note_for_fkey | credit_note_for | v_ar_ageing(invoice_id) |
| invoices_currency_fkey | currency | currencies(code) |
| invoices_department_id_fkey | department_id | departments(id) |
| invoices_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| invoices_original_currency_fkey | original_currency | currencies(code) |
| invoices_revenue_account_id_fkey | revenue_account_id | accounts(id) |

**Check constraints (evidenced):**
- `invoices_template_check` `(template in ('professional', 'minimal', 'ngo', 'government'))` — 20260725000001_invoice_automation.sql

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount_due | numeric | `number | null` | yes | `—` | convention |
| amount_paid | numeric | `number` | no | `—` | convention |
| ar_account_id | uuid | `string | null` | yes | `—` | fk |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| contact_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| credit_note_for | uuid | `string | null` | yes | `—` | fk |
| currency | text | `string` | no | `—` | convention |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| discount_amount | numeric | `number` | no | `—` | convention |
| discount_percent | numeric | `number` | no | `—` | convention |
| due_date | date | `string | null` | yes | `—` | evidence |
| exchange_rate | numeric(20,10) | `number` | no | `—` | override |
| functional_amount | numeric | `number | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| invoice_number | text | `string` | no | `—` | convention |
| invoice_type | text | `string` | no | `—` | convention |
| issue_date | date | `string` | no | `—` | evidence |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| notes | text | `string | null` | yes | `—` | convention |
| original_amount | numeric | `number | null` | yes | `—` | convention |
| original_currency | text | `string | null` | yes | `—` | convention |
| po_number | text | `string | null` | yes | `—` | convention |
| project_code | text | `string | null` | yes | `—` | convention |
| lpo_number | text | `string | null` | yes | `—` | convention |
| accent_colour | text | `string | null` | yes | `—` | convention |
| payment_provider | text | `string | null` | yes | `—` | convention |
| payment_reference | text | `string | null` | yes | `—` | convention |
| template | text | `string` | no | `'professional'` | convention / default: evidence |
| rate_date | date | `string | null` | yes | `—` | evidence |
| rate_is_stale | boolean | `boolean` | no | `—` | convention |
| revenue_account_id | uuid | `string | null` | yes | `—` | fk |
| sent_at | timestamptz | `string | null` | yes | `—` | convention |
| status | invoice_status | `Database["public"]["Enums"]["invoice_status"]` | no | `—` | enum |
| subtotal | numeric | `number` | no | `—` | convention |
| taxable_amount | numeric | `number` | no | `—` | convention |
| terms | text | `string | null` | yes | `—` | convention |
| total_amount | numeric | `number` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| vat_amount | numeric | `number` | no | `—` | convention |
| viewed_at | timestamptz | `string | null` | yes | `—` | convention |
| wht_amount | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `journal_entries`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| journal_entries_branch_id_fkey | branch_id | branches(id) |
| journal_entries_business_id_fkey | business_id | businesses(id) |
| journal_entries_currency_fkey | currency | currencies(code) |
| journal_entries_department_id_fkey | department_id | departments(id) |
| journal_entries_period_id_fkey | period_id | accounting_periods(id) |
| journal_entries_reversal_of_fkey | reversal_of | journal_entries(id) |
| journal_entries_reversed_by_fkey | reversed_by | journal_entries(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| currency | text | `string` | no | `—` | convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| description | text | `string` | no | `—` | convention |
| entry_date | date | `string` | no | `—` | evidence |
| entry_number | text | `string` | no | `—` | convention |
| exchange_rate | numeric(20,10) | `number` | no | `—` | override |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| period_id | uuid | `string | null` | yes | `—` | fk |
| posted_at | timestamptz | `string | null` | yes | `—` | convention |
| posted_by | text | `string | null` | yes | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |
| reversal_of | uuid | `string | null` | yes | `—` | fk |
| reversed_by | uuid | `string | null` | yes | `—` | fk |
| source_id | text | `string | null` | yes | `—` | convention |
| source_type | text | `string | null` | yes | `—` | convention |
| status | journal_status | `Database["public"]["Enums"]["journal_status"]` | no | `—` | enum |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `journal_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| journal_lines_account_id_fkey | account_id | accounts(id) |
| journal_lines_branch_id_fkey | branch_id | branches(id) |
| journal_lines_business_id_fkey | business_id | businesses(id) |
| journal_lines_currency_fkey | currency | currencies(code) |
| journal_lines_department_id_fkey | department_id | departments(id) |
| journal_lines_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| journal_lines_original_currency_fkey | original_currency | currencies(code) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| account_id | uuid | `string` | no | `—` | fk |
| amount | numeric | `number` | no | `—` | convention |
| amount_base | numeric | `number` | no | `—` | convention |
| branch_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| currency | text | `string` | no | `—` | convention |
| department_id | uuid | `string | null` | yes | `—` | fk |
| description | text | `string | null` | yes | `—` | convention |
| exchange_rate | numeric(20,10) | `number` | no | `—` | override |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_debit | boolean | `boolean` | no | `—` | convention |
| journal_entry_id | uuid | `string` | no | `—` | fk |
| line_number | numeric | `number` | no | `—` | convention |
| original_amount | numeric | `number | null` | yes | `—` | convention |
| original_currency | text | `string | null` | yes | `—` | convention |
| rate_date | date | `string | null` | yes | `—` | evidence |
| rate_is_stale | boolean | `boolean` | no | `—` | convention |
| reconciled | boolean | `boolean` | no | `—` | convention |
| reconciled_at | timestamptz | `string | null` | yes | `—` | convention |
| tax_amount | numeric | `number` | no | `—` | convention |
| tax_code | tax_code | `Database["public"]["Enums"]["tax_code"] | null` | yes | `—` | enum |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `loan_repayments`

**Classification:** MATCH (created by migration) — created by `20260723000000_capital_financing.sql`

**Primary key:** `id` (uuid)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| bank_account_id | text | `string | null` | yes | `—` | convention |
| business_id | text | `string` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| interest_portion | numeric | `number` | no | `—` | convention |
| journal_entry_id | text | `string | null` | yes | `—` | convention |
| loan_id | text | `string` | no | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| principal_portion | numeric | `number` | no | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |
| repayment_date | text | `string` | no | `—` | convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `loans`

**Classification:** MATCH (created by migration) — created by `20260723000000_capital_financing.sql`

**Primary key:** `id` (uuid)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | text | `string` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| description | text | `string | null` | yes | `—` | convention |
| drawdown_journal_id | text | `string | null` | yes | `—` | convention |
| first_payment_date | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| interest_expense_account_id | text | `string | null` | yes | `—` | convention |
| interest_rate_pct | numeric | `number | null` | yes | `—` | convention |
| lender_name | text | `string` | no | `—` | convention |
| loan_account_id | text | `string` | no | `—` | convention |
| principal_amount | numeric | `number` | no | `—` | convention |
| start_date | text | `string` | no | `—` | convention |
| status | text | `string` | no | `—` | convention |
| term_months | numeric | `number | null` | yes | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `paye_bands`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| paye_bands_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| band_from | numeric | `number` | no | `—` | convention |
| band_label | text | `string | null` | yes | `—` | convention |
| band_to | numeric | `number | null` | yes | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| effective_from | date | `string` | no | `—` | evidence |
| effective_to | date | `string | null` | yes | `—` | evidence |
| fiscal_year | text | `string` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| rate | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `payroll_employee_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| payroll_employee_lines_business_id_fkey | business_id | businesses(id) |
| payroll_employee_lines_employee_id_fkey | employee_id | employees(id) |
| payroll_employee_lines_payroll_run_id_fkey | payroll_run_id | payroll_runs(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| basic_salary | numeric | `number` | no | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| employee_id | uuid | `string` | no | `—` | fk |
| gross_pay | numeric | `number` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| net_pay | numeric | `number` | no | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| other_deductions | numeric | `number` | no | `—` | convention |
| paid_at | timestamptz | `string | null` | yes | `—` | convention |
| paye_bands_json | jsonb | `Json | null` | yes | `—` | convention |
| paye_deduction | numeric | `number` | no | `—` | convention |
| paye_taxable_income | numeric | `number` | no | `—` | convention |
| payment_method | payment_method | `Database["public"]["Enums"]["payment_method"]` | no | `—` | enum |
| payment_ref | text | `string | null` | yes | `—` | convention |
| payroll_run_id | uuid | `string` | no | `—` | fk |
| payslip_generated | boolean | `boolean` | no | `—` | convention |
| payslip_url | text | `string | null` | yes | `—` | convention |
| pension_employee | numeric | `number` | no | `—` | convention |
| pension_employer | numeric | `number` | no | `—` | convention |
| total_allowances | numeric | `number` | no | `—` | convention |
| total_deductions | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `payroll_runs`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| payroll_runs_business_id_fkey | business_id | businesses(id) |
| payroll_runs_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| approved_at | timestamptz | `string | null` | yes | `—` | convention |
| approved_by | text | `string | null` | yes | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| notes | text | `string | null` | yes | `—` | convention |
| pay_date | date | `string` | no | `—` | evidence |
| paye_filed_at | timestamptz | `string | null` | yes | `—` | convention |
| paye_return_ref | text | `string | null` | yes | `—` | convention |
| payroll_period | text | `string` | no | `—` | convention |
| period_end | date | `string` | no | `—` | evidence |
| period_start | date | `string` | no | `—` | evidence |
| run_number | text | `string` | no | `—` | convention |
| status | payroll_status | `Database["public"]["Enums"]["payroll_status"]` | no | `—` | enum |
| total_gross | numeric | `number` | no | `—` | convention |
| total_net | numeric | `number` | no | `—` | convention |
| total_other_deductions | numeric | `number` | no | `—` | convention |
| total_paye | numeric | `number` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `product_categories`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| product_categories_business_id_fkey | business_id | businesses(id) |
| product_categories_parent_id_fkey | parent_id | product_categories(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| name | text | `string` | no | `—` | convention |
| parent_id | uuid | `string | null` | yes | `—` | fk |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `products`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| products_business_id_fkey | business_id | businesses(id) |
| products_category_id_fkey | category_id | product_categories(id) |
| products_cogs_account_id_fkey | cogs_account_id | accounts(id) |
| products_inventory_account_id_fkey | inventory_account_id | accounts(id) |
| products_purchase_account_id_fkey | purchase_account_id | accounts(id) |
| products_sales_account_id_fkey | sales_account_id | accounts(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| barcode | text | `string | null` | yes | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| category_id | uuid | `string | null` | yes | `—` | fk |
| cogs_account_id | uuid | `string | null` | yes | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| currency | currency_code | `Database["public"]["Enums"]["currency_code"]` | no | `—` | enum |
| deleted_at | timestamptz | `string | null` | yes | `—` | convention |
| description | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| image_url | text | `string | null` | yes | `—` | convention |
| inventory_account_id | uuid | `string | null` | yes | `—` | fk |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| name | text | `string` | no | `—` | convention |
| product_type | text | `string` | no | `—` | convention |
| purchase_account_id | uuid | `string | null` | yes | `—` | fk |
| purchase_price | numeric | `number` | no | `—` | convention |
| purchase_tax_code | tax_code | `Database["public"]["Enums"]["tax_code"]` | no | `—` | enum |
| reorder_level | numeric | `number | null` | yes | `—` | convention |
| reorder_quantity | numeric | `number | null` | yes | `—` | convention |
| sale_price | numeric | `number` | no | `—` | convention |
| sales_account_id | uuid | `string | null` | yes | `—` | fk |
| sales_tax_code | tax_code | `Database["public"]["Enums"]["tax_code"]` | no | `—` | enum |
| sku | text | `string | null` | yes | `—` | convention |
| track_inventory | boolean | `boolean` | no | `—` | convention |
| unit_of_measure | text | `string | null` | yes | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `profiles`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| full_name | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | inferred / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `share_transactions`

**Classification:** MATCH (created by migration) — created by `20260723000000_capital_financing.sql`

**Primary key:** `id` (uuid)

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| bank_account_id | text | `string | null` | yes | `—` | convention |
| business_id | text | `string` | no | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | text | `string | null` | yes | `—` | convention |
| notes | text | `string | null` | yes | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |
| share_account_id | text | `string` | no | `—` | convention |
| shareholder_name | text | `string` | no | `—` | convention |
| shares_count | numeric | `number | null` | yes | `—` | convention |
| transaction_type | text | `string` | no | `—` | convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `stock_movements`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| stock_movements_business_id_fkey | business_id | businesses(id) |
| stock_movements_location_id_fkey | location_id | inventory_locations(id) |
| stock_movements_product_id_fkey | product_id | products(id) |
| stock_movements_product_id_fkey | product_id | v_reorder_alerts(product_id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| location_id | uuid | `string` | no | `—` | fk |
| movement_date | date | `string` | no | `—` | evidence |
| movement_type | stock_movement_type | `Database["public"]["Enums"]["stock_movement_type"]` | no | `—` | enum |
| notes | text | `string | null` | yes | `—` | convention |
| product_id | uuid | `string` | no | `—` | fk |
| quantity | numeric | `number` | no | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |
| source_id | text | `string | null` | yes | `—` | convention |
| source_type | text | `string | null` | yes | `—` | convention |
| total_cost | numeric | `number | null` | yes | `—` | convention |
| unit_cost | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `stock_transfer_lines`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| stock_transfer_lines_business_id_fkey | business_id | businesses(id) |
| stock_transfer_lines_product_id_fkey | product_id | products(id) |
| stock_transfer_lines_product_id_fkey | product_id | v_reorder_alerts(product_id) |
| stock_transfer_lines_transfer_id_fkey | transfer_id | stock_transfers(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| notes | text | `string | null` | yes | `—` | convention |
| product_id | uuid | `string` | no | `—` | fk |
| quantity_dispatched | numeric | `number | null` | yes | `—` | convention |
| quantity_received | numeric | `number | null` | yes | `—` | convention |
| quantity_requested | numeric | `number` | no | `—` | convention |
| transfer_id | uuid | `string` | no | `—` | fk |
| unit_cost | numeric | `number` | no | `—` | convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `stock_transfers`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| stock_transfers_approved_by_fkey | approved_by | user_profiles(id) |
| stock_transfers_business_id_fkey | business_id | businesses(id) |
| stock_transfers_from_location_id_fkey | from_location_id | inventory_locations(id) |
| stock_transfers_received_by_fkey | received_by | user_profiles(id) |
| stock_transfers_requested_by_fkey | requested_by | user_profiles(id) |
| stock_transfers_to_location_id_fkey | to_location_id | inventory_locations(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| approved_at | timestamptz | `string | null` | yes | `—` | convention |
| approved_by | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| dispatched_at | timestamptz | `string | null` | yes | `—` | convention |
| from_location_id | uuid | `string` | no | `—` | fk |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| notes | text | `string | null` | yes | `—` | convention |
| received_at | timestamptz | `string | null` | yes | `—` | convention |
| received_by | uuid | `string | null` | yes | `—` | fk |
| requested_by | uuid | `string | null` | yes | `—` | fk |
| status | text | `string` | no | `—` | convention |
| to_location_id | uuid | `string` | no | `—` | fk |
| transfer_number | text | `string` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `subscription_payments`

**Classification:** MATCH (created by migration) — created by `20260726000002_subscription_payments.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| subscription_payments_business_id_fkey | business_id | businesses(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| billing_cycle | text | `string` | no | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| checkout_url | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| currency | text | `string` | no | `—` | convention |
| gateway | text | `string` | no | `—` | convention |
| gateway_reference | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| initiated_by | text | `string | null` | yes | `—` | convention |
| plan_expires_at | timestamptz | `string | null` | yes | `—` | convention |
| raw_response | jsonb | `Json | null` | yes | `—` | convention |
| status | text | `string` | no | `—` | convention |
| target_plan_tier | text | `string` | no | `—` | convention |
| tx_ref | text | `string` | no | `—` | convention |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `tax_alerts`

**Classification:** MATCH (created by migration) — created by `20260708000000_tax_compliance_module.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| tax_alerts_business_id_fkey | business_id | businesses(id) |
| tax_alerts_tax_return_id_fkey | tax_return_id | tax_returns(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| alert_type | tax_alert_type | `Database["public"]["Enums"]["tax_alert_type"]` | no | `—` | enum |
| business_id | uuid | `string` | no | `—` | fk |
| channel | tax_alert_channel | `Database["public"]["Enums"]["tax_alert_channel"]` | no | `—` | enum |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| scheduled_for | text | `string` | no | `—` | convention |
| sent_at | timestamptz | `string | null` | yes | `—` | convention |
| status | tax_alert_status | `Database["public"]["Enums"]["tax_alert_status"]` | no | `—` | enum |
| tax_return_id | uuid | `string` | no | `—` | fk |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `tax_configurations`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| tax_configurations_business_id_fkey | business_id | businesses(id) |
| tax_configurations_tax_payable_account_id_fkey | tax_payable_account_id | accounts(id) |
| tax_configurations_tax_receivable_account_id_fkey | tax_receivable_account_id | accounts(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| description | text | `string | null` | yes | `—` | convention |
| effective_from | date | `string` | no | `—` | evidence |
| effective_to | date | `string | null` | yes | `—` | evidence |
| employee_rate | numeric | `number | null` | yes | `—` | override |
| employer_rate | numeric | `number | null` | yes | `—` | override |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| is_active | boolean | `boolean` | no | `true` | convention / default: convention |
| mra_reference | text | `string | null` | yes | `—` | convention |
| name | text | `string` | no | `—` | convention |
| rate | numeric | `number` | no | `—` | convention |
| tax_code | tax_code | `Database["public"]["Enums"]["tax_code"]` | no | `—` | enum |
| tax_payable_account_id | uuid | `string | null` | yes | `—` | fk |
| tax_receivable_account_id | uuid | `string | null` | yes | `—` | fk |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

### `tax_payments`

**Classification:** MATCH (created by migration) — created by `20260708000000_tax_compliance_module.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| tax_payments_bank_account_id_fkey | bank_account_id | accounts(id) |
| tax_payments_business_id_fkey | business_id | businesses(id) |
| tax_payments_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |
| tax_payments_tax_return_id_fkey | tax_return_id | tax_returns(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount | numeric | `number` | no | `—` | convention |
| bank_account_id | uuid | `string | null` | yes | `—` | fk |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| notes | text | `string | null` | yes | `—` | convention |
| payment_date | text | `string` | no | `—` | convention |
| payment_method | payment_method | `Database["public"]["Enums"]["payment_method"]` | no | `—` | enum |
| receipt_path | text | `string | null` | yes | `—` | convention |
| reference | text | `string | null` | yes | `—` | convention |
| tax_return_id | uuid | `string` | no | `—` | fk |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `tax_returns`

**Classification:** MATCH (created by migration) — created by `20260708000000_tax_compliance_module.sql`

**Primary key:** `id` (uuid)

**Foreign keys:**

| Constraint | Columns | References |
|---|---|---|
| tax_returns_business_id_fkey | business_id | businesses(id) |
| tax_returns_journal_entry_id_fkey | journal_entry_id | journal_entries(id) |

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| amount_due | numeric | `number` | no | `—` | convention |
| amount_paid | numeric | `number` | no | `—` | convention |
| business_id | uuid | `string` | no | `—` | fk |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| created_by | text | `string | null` | yes | `—` | convention |
| due_date | text | `string` | no | `—` | convention |
| filed_at | timestamptz | `string | null` | yes | `—` | convention |
| filed_ref | text | `string | null` | yes | `—` | convention |
| gross_amount | numeric | `number` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | convention / default: convention |
| input_tax | numeric | `number` | no | `—` | convention |
| journal_entry_id | uuid | `string | null` | yes | `—` | fk |
| output_tax | numeric | `number` | no | `—` | convention |
| period_end | text | `string` | no | `—` | convention |
| period_label | text | `string` | no | `—` | convention |
| period_start | text | `string` | no | `—` | convention |
| source_id | text | `string | null` | yes | `—` | convention |
| source_type | text | `string | null` | yes | `—` | convention |
| status | tax_return_status | `Database["public"]["Enums"]["tax_return_status"]` | no | `—` | enum |
| tax_code | tax_code | `Database["public"]["Enums"]["tax_code"]` | no | `—` | enum |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** enabled by migration
**Policies:** none evidenced in repository (see drift report)

---

### `user_profiles`

**Classification:** MISSING FROM REPOSITORY (base table)

**Primary key:** `id` (uuid)

**Check constraints (evidenced):**
- `user_profiles_preferred_language_check` `(preferred_language in ('en', 'ny', 'sw', 'fr', 'pt'))` — 20260724000000_add_user_language_preference.sql

| Column | PG type | TS type | Nullable | Default | Evidence |
|---|---|---|---|---|---|
| avatar_url | text | `string | null` | yes | `—` | convention |
| created_at | timestamptz | `string` | no | `now()` | convention / default: convention |
| deletion_finalized_at | timestamptz | `string | null` | yes | `—` | convention |
| deletion_requested_at | timestamptz | `string | null` | yes | `—` | convention |
| full_name | text | `string` | no | `—` | convention |
| id | uuid | `string` | no | `gen_random_uuid()` | evidence / default: convention |
| is_platform_admin | boolean | `boolean` | no | `—` | convention |
| phone | text | `string | null` | yes | `—` | convention |
| preferred_language | text | `string | null` | yes | `'en'` | override / default: evidence |
| preferred_currency | currency_code | `Database["public"]["Enums"]["currency_code"] | null` | yes | `—` | enum |
| updated_at | timestamptz | `string` | no | `now()` | convention / default: convention |

**RLS:** expected (default deny; see policies)
**Policies:** none evidenced in repository (see drift report)

---

## Views

### `v_ar_ageing`

**Classification:** MISSING FROM REPOSITORY (view body not in migrations; only column signature known)

| Column | TS type |
|---|---|
| ageing_bucket | `string | null` |
| amount_due | `number | null` |
| amount_paid | `number | null` |
| business_id | `string | null` |
| contact_id | `string | null` |
| contact_name | `string | null` |
| currency | `string | null` |
| days_overdue | `number | null` |
| due_date | `string | null` |
| invoice_id | `string | null` |
| invoice_number | `string | null` |
| issue_date | `string | null` |
| total_amount | `number | null` |

---

### `v_asset_register`

**Classification:** MISSING FROM REPOSITORY (view body not in migrations; only column signature known)

| Column | TS type |
|---|---|
| accumulated_depreciation | `number | null` |
| acquisition_cost | `number | null` |
| acquisition_date | `string | null` |
| asset_number | `string | null` |
| branch | `string | null` |
| business_id | `string | null` |
| category | `string | null` |
| department | `string | null` |
| depreciable_amount | `number | null` |
| depreciation_method | `Database["public"]["Enums"]["depreciation_method"] | null` |
| last_depreciation_date | `string | null` |
| name | `string | null` |
| net_book_value | `number | null` |
| residual_value | `number | null` |
| status | `Database["public"]["Enums"]["asset_status"] | null` |

---

### `v_cash_flow`

**Classification:** MATCH (created by migration 20260726000000_v_cash_flow_view.sql + 20260728000006_fix_cash_flow_cash_side.sql)

| Column | TS type |
|---|---|
| business_id | `string | null` |
| financing | `number | null` |
| investing | `number | null` |
| net_change | `number | null` |
| operating | `number | null` |
| period | `string | null` |

---

### `v_reorder_alerts`

**Classification:** MISSING FROM REPOSITORY (view body not in migrations; only column signature known)

| Column | TS type |
|---|---|
| average_cost | `number | null` |
| business_id | `string | null` |
| estimated_reorder_cost | `number | null` |
| location_name | `string | null` |
| product_id | `string | null` |
| product_name | `string | null` |
| quantity_available | `number | null` |
| quantity_on_hand | `number | null` |
| quantity_reserved | `number | null` |
| reorder_level | `number | null` |
| reorder_quantity | `number | null` |
| sku | `string | null` |

---

### `v_trial_balance`

**Classification:** MISSING FROM REPOSITORY (view body not in migrations; only column signature known)

| Column | TS type |
|---|---|
| account_subtype | `Database["public"]["Enums"]["account_subtype"] | null` |
| account_type | `Database["public"]["Enums"]["account_type"] | null` |
| balance | `number | null` |
| business_id | `string | null` |
| code | `string | null` |
| name | `string | null` |
| normal_balance | `string | null` |
| total_credits | `number | null` |
| total_debits | `number | null` |

---

## Functions

| Function | Signature | Classification |
|---|---|---|
| accept_invitation | `"{ Args: { p_token: string }; Returns: Json }"` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| create_business_with_owner | `{"Args": {"p_address_line1": "string", "p_base_currency": "string", "p_brand_color": "string", "p_city": "string", "p_co` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| current_user_role | `{"Args": "{ p_business_id: string }", "Returns": "Database[\"public\"][\"Enums\"][\"user_role\"]"}` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| get_enum_values | `"{ Args: { enum_name: string }; Returns: string[] }"` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| get_user_role | `{"Args": "{ p_business_id: string }", "Returns": "Database[\"public\"][\"Enums\"][\"user_role\"]"}` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| increment_amount_paid | `{"Args": "{ p_amount: number; p_id: string; p_table: string }", "Returns": "undefined"}` | MATCH (created by migration) |
| invite_member | `{"Args": {"p_business_id": "string", "p_email": "string", "p_role": "Database[\"public\"][\"Enums\"][\"user_role\"]"}, "` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| log_manual_audit_event | `{"Args": {"p_business_id": "string", "p_event_type": "string", "p_new_values": "Json", "p_notes": "string", "p_old_value` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| reserve_next_document_number | `{"Args": "{ p_business_id: string; p_kind: string }", "Returns": "string"}` | MATCH (created by migration) |
| seed_new_business | `"{ Args: { p_biz: string }; Returns: undefined }"` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| show_limit | `"{ Args: never; Returns: number }"` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| show_trgm | `"{ Args: { \"\": string }; Returns: string[] }"` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |
| user_has_role | `{"Args": {"p_business_id": "string", "p_min_role": "Database[\"public\"][\"Enums\"][\"user_role\"]"}, "Returns": "boolea` | MATCH (created by migration) |
| verify_audit_chain | `{"Args": "{ p_business_id: string; p_resource_type?: string }", "Returns": {"chain_valid": "boolean", "entry_hash": "str` | MISSING FROM REPOSITORY (signature known from generated types; BODY NOT AVAILABLE — cannot be reconstructed without live capture) |

## Storage

| Bucket | Visibility | Size limit | MIME | Evidence |
|---|---|---|---|---|
| business-logos | public (getPublicUrl in src/pages/SettingsPage.tsx) | UNKNOWN (live capture) | UNKNOWN (live capture) | src/pages/SettingsPage.tsx, src/App.tsx |
| user-exports | private (createSignedUrl; service-role upload) | UNKNOWN (live capture) | application/zip used by export-my-data | supabase/functions/export-my-data/index.ts |

**Storage policies:** UNKNOWN — no storage policies in migrations; requires live capture of storage.policies

## Scheduled jobs (cron)

| Job | Schedule | Target | Secret header | Created by |
|---|---|---|---|---|
| expire-subscriptions-daily | 0 1 * * * | https://<PROJECT_REF>.supabase.co/functions/v1/expire-subscriptions | x-cron-secret: <CRON_SECRET> | 20260726000003_schedule_expire_subscriptions.sql |
| send-renewal-reminders-daily | 0 8 * * * | https://<PROJECT_REF>.supabase.co/functions/v1/send-renewal-reminders | x-cron-secret: <CRON_SECRET> | 20260726000005_schedule_send_renewal_reminders.sql |
| generate-partner-invoices-monthly | UNKNOWN (see 20260727000006_schedule_generate_partner_invoices.sql) | generate-partner-invoices edge function | x-cron-secret | 20260727000006_schedule_generate_partner_invoices.sql |

**Substitution:** <PROJECT_REF> and <CRON_SECRET> are placeholders; deployment substitutes them per environment (documented in DEPLOYMENT.md / deploy.yml). No real secrets in migrations.

## Known gaps (objects not reconstructable from repository evidence)

1. **11 base RPC bodies** — signatures are in `database.generated.ts`, but the
   function bodies are not in the repository and cannot be reconstructed without
   live capture (`pg_get_functiondef`): `accept_invitation`, `create_business_with_owner`,
   `current_user_role`, `get_enum_values`, `get_user_role`, `invite_member`,
   `log_manual_audit_event`, `seed_new_business`, `show_limit`, `show_trgm`,
   `verify_audit_chain`. (`show_limit`/`show_trgm` are resolved by `pg_trgm`, which
   the base migration now creates; the remaining nine need live capture.)
2. **4 view bodies** — `v_ar_ageing`, `v_asset_register`, `v_reorder_alerts`,
   `v_trial_balance`: column signatures known, bodies not in repository.
3. **RLS policies** on base tables not rebuilt by migrations (invoices, journal_entries,
   journal_lines, stock_movements, stock_transfers, stock_transfer_lines, inventory_balances,
   products, product_categories, budgets, budget_lines, accounting_periods, bank_statements,
   bank_statement_lines, expenses, expense_lines, expense_payments, audit_log, profiles,
   user_profiles, paye_bands, tax_configurations, currencies).
4. **Base-table indexes, updated_at triggers, exact numeric precisions** where marked
   [INFERRED], storage bucket size/MIME limits, and any grants not evidenced.

## Source of truth

Machine-readable form: [`artifacts/database/staging-schema-inventory.json`](../artifacts/database/staging-schema-inventory.json)
