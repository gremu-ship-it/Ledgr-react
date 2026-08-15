# Ledgr — Staging Schema Inventory (Phase 8A.1) — AUTHORITATIVE (live capture)

> **Status: LIVE CAPTURE.** Built from the read-only Management API capture of
> project `bkxzgkurcqvccsdjmqzg`
> (LIVE CAPTURE — read-only Management API capture of project bkxzgkurcqvccsdjmqzg (ledgr-staging), 2026-08-15).

- PostgreSQL version (live): **17.6 (SHOW server_version from live capture)**
- Generated: 2026-08-15T19:26:13+00:00
- Capture files: check_constraints.json, cron_jobs.json, domains.json, enums.json, extensions.json, foreign_keys.json, functions.json, generated_columns.json, grants.json, identity_columns.json, indexes.json, matviews.json, policies.json, primary_keys.json, rls.json, roles.json, schemas.json, sequences.json, server_version.json, storage_buckets.json, storage_policies.json, tables.json, triggers.json, unique_constraints.json, views.json

## Classification summary

- Tables: **65** (65 match repository migrations)
- Enums: **16**; base enums missing from repo: 12
- Functions: **71**; missing from repo: 0
- Views: **3**; missing from repo: 0
- Policies: **102** across 35 tables
- **Tables with RLS enabled but NO policies (deny-all): 30**
- Storage buckets: 0
- Cron jobs: 3

## Schemas

`auth`, `cron`, `extensions`, `graphql`, `graphql_public`, `net`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault`

## Extensions

| Extension | Version | Schema |
|---|---|---|
| pg_cron | 1.6.4 | pg_catalog |
| pg_net | 0.20.4 | public |
| pg_stat_statements | 1.11 | extensions |
| pg_trgm | 1.6 | public |
| pgcrypto | 1.3 | extensions |
| plpgsql | 1.0 | pg_catalog |
| supabase_vault | 0.3.1 | vault |
| uuid-ossp | 1.1 | extensions |

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

### `accounting_periods` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| closed_at | `timestamp with time zone` | False | `—` | — | — |
| closed_by | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_closed | `boolean` | True | `—` | — | — |
| name | `text` | True | `—` | — | — |
| period_end | `date` | True | `—` | — | — |
| period_start | `date` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `accounts` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| account_subtype | `account_subtype` | False | `—` | — | — |
| account_type | `account_type` | True | `—` | — | — |
| bank_account_number | `text` | False | `—` | — | — |
| bank_branch | `text` | False | `—` | — | — |
| bank_name | `text` | False | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| code | `text` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| currency | `text` | True | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| description | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| is_bank_account | `boolean` | True | `—` | — | — |
| is_group | `boolean` | True | `—` | — | — |
| is_system | `boolean` | True | `—` | — | — |
| mobile_money_number | `text` | False | `—` | — | — |
| mobile_money_type | `text` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| normal_balance | `text` | True | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| opening_balance | `numeric` | True | `—` | — | — |
| opening_balance_date | `text` | False | `—` | — | — |
| parent_id | `uuid` | False | `—` | — | — |
| tax_code | `tax_code` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `ai_insights_usage` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| user_id | `uuid` | True | `—` | — | — |
| window_start | `timestamp with time zone` | True | `—` | — | — |
| count | `integer` | True | `1` | — | — |

---

### `api_keys` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| name | `text` | True | `—` | — | — |
| key_hash | `text` | True | `—` | — | — |
| key_prefix | `text` | True | `—` | — | — |
| last_used_at | `timestamp with time zone` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| revoked_at | `timestamp with time zone` | False | `—` | — | — |

---

### `api_usage` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| api_key | `text` | False | `—` | — | — |
| count | `integer` | False | `0` | — | — |
| window_start | `timestamp with time zone` | False | `date_trunc('minute'::text, now())` | — | — |
| created_at | `timestamp with time zone` | False | `now()` | — | — |
| api_key_id | `uuid` | False | `—` | — | — |

---

### `asset_categories` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| accumulated_dep_account_id | `uuid` | False | `—` | — | — |
| asset_account_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| dep_expense_account_id | `uuid` | False | `—` | — | — |
| depreciation_method | `depreciation_method` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| is_depreciable | `boolean` | True | `true` | — | — |
| mra_depreciation_rate | `numeric` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| residual_percent | `numeric` | True | `—` | — | — |
| useful_life_years | `numeric` | False | `—` | — | — |

---

### `audit_log` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| changed_fields | `text[]` | False | `—` | — | — |
| entry_hash | `text` | False | `—` | — | — |
| event_type | `text` | True | `—` | — | — |
| id | `bigint` | True | `nextval('audit_log_id_seq'::regclass)` | — | — |
| ip_address | `inet` | True | `—` | — | — |
| new_values | `jsonb` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| occurred_at | `timestamp with time zone` | True | `—` | — | — |
| old_values | `jsonb` | False | `—` | — | — |
| prev_hash | `text` | False | `—` | — | — |
| resource_id | `text` | False | `—` | — | — |
| resource_ref | `text` | False | `—` | — | — |
| resource_type | `text` | True | `—` | — | — |
| session_id | `text` | False | `—` | — | — |
| user_agent | `text` | False | `—` | — | — |
| user_email | `text` | False | `—` | — | — |
| user_id | `uuid` | False | `—` | — | — |

---

### `bank_statement_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| balance | `numeric` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| credit_amount | `numeric` | True | `—` | — | — |
| debit_amount | `numeric` | True | `—` | — | — |
| description | `text` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_reconciled | `boolean` | True | `—` | — | — |
| journal_line_id | `uuid` | False | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| statement_id | `uuid` | True | `—` | — | — |
| transaction_date | `date` | True | `—` | — | — |
| match_method | `text` | False | `—` | — | — |
| match_confidence | `numeric(5,4)` | False | `—` | — | — |
| locked_at | `timestamp with time zone` | False | `—` | — | — |

---

### `bank_statements` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| account_id | `uuid` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| closing_balance | `numeric` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| opening_balance | `numeric` | True | `—` | — | — |
| source | `text` | False | `—` | — | — |
| statement_date | `date` | True | `—` | — | — |
| uploaded_by | `text` | False | `—` | — | — |
| reconciled_at | `timestamp with time zone` | False | `—` | — | — |
| reconciled_by | `uuid` | False | `—` | — | — |
| is_locked | `boolean` | True | `false` | — | — |
| locked_at | `timestamp with time zone` | False | `—` | — | — |

---

### `branches` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| code | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| location | `text` | False | `—` | — | — |
| manager_id | `text` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `budget_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| account_id | `uuid` | True | `—` | — | — |
| annual_total | `numeric` | False | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| budget_id | `uuid` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| m01_amount | `numeric` | True | `—` | — | — |
| m02_amount | `numeric` | True | `—` | — | — |
| m03_amount | `numeric` | True | `—` | — | — |
| m04_amount | `numeric` | True | `—` | — | — |
| m05_amount | `numeric` | True | `—` | — | — |
| m06_amount | `numeric` | True | `—` | — | — |
| m07_amount | `numeric` | True | `—` | — | — |
| m08_amount | `numeric` | True | `—` | — | — |
| m09_amount | `numeric` | True | `—` | — | — |
| m10_amount | `numeric` | True | `—` | — | — |
| m11_amount | `numeric` | True | `—` | — | — |
| m12_amount | `numeric` | True | `—` | — | — |
| notes | `text` | False | `—` | — | — |

---

### `budgets` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| fiscal_year | `text` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| name | `text` | True | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| period_end | `date` | True | `—` | — | — |
| period_start | `date` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `business_invitations` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| email | `text` | False | `—` | — | — |
| role | `user_role` | True | `—` | — | — |
| token | `text` | True | `—` | — | — |
| invited_by | `uuid` | False | `—` | — | — |
| invited_at | `timestamp with time zone` | True | `now()` | — | — |
| expires_at | `timestamp with time zone` | True | `(now() + '7 days'::interval)` | — | — |
| accepted_at | `timestamp with time zone` | False | `—` | — | — |
| accepted_by | `uuid` | False | `—` | — | — |

---

### `business_terms_acceptances` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| user_id | `uuid` | True | `—` | — | — |
| terms_version | `text` | True | `—` | — | — |
| accepted_at | `timestamp with time zone` | True | `now()` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `business_users` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| accepted_at | `timestamp with time zone` | False | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| invitation_expires_at | `timestamp with time zone` | False | `—` | — | — |
| invitation_token | `text` | False | `—` | — | — |
| invited_at | `timestamp with time zone` | False | `—` | — | — |
| invited_by | `uuid` | False | `—` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| role | `user_role` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| user_id | `uuid` | True | `—` | — | — |

---

### `businesses` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| address_line1 | `text` | False | `—` | — | — |
| address_line2 | `text` | False | `—` | — | — |
| base_currency | `text` | True | `—` | — | — |
| brand_color | `text` | False | `—` | — | — |
| city | `text` | False | `—` | — | — |
| coa_template | `text` | True | `—` | — | — |
| country | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| default_payment_method | `payment_method` | False | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| email | `text` | False | `—` | — | — |
| expense_next_number | `integer` | True | `—` | — | — |
| expense_prefix | `text` | False | `—` | — | — |
| financial_year_start | `text` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| invoice_next_number | `integer` | True | `—` | — | — |
| invoice_prefix | `text` | False | `—` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| logo_url | `text` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| payroll_next_number | `integer` | True | `—` | — | — |
| payroll_prefix | `text` | False | `—` | — | — |
| phone | `text` | False | `—` | — | — |
| plan_expires_at | `timestamp with time zone` | False | `—` | — | — |
| plan_tier | `text` | True | `'free'::text` | — | — |
| plan_updated_at | `timestamp with time zone` | False | `—` | — | — |
| registration_number | `text` | False | `—` | — | — |
| timezone | `text` | True | `—` | — | — |
| tpin | `text` | False | `—` | — | — |
| trading_name | `text` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| vat_number | `text` | False | `—` | — | — |
| vat_period | `text` | False | `—` | — | — |
| vat_registered | `boolean` | True | `—` | — | — |
| website | `text` | False | `—` | — | — |

---

### `contacts` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| address_line1 | `text` | False | `—` | — | — |
| address_line2 | `text` | False | `—` | — | — |
| ap_account_id | `uuid` | False | `—` | — | — |
| ar_account_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| city | `text` | False | `—` | — | — |
| contact_type | `text` | True | `—` | — | — |
| country | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| credit_limit | `numeric` | False | `—` | — | — |
| credit_terms_days | `numeric` | False | `—` | — | — |
| currency | `currency_code` | False | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| email | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| mobile_money_number | `text` | False | `—` | — | — |
| mobile_money_type | `text` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| phone | `text` | False | `—` | — | — |
| tpin | `text` | False | `—` | — | — |
| trading_name | `text` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| vat_number | `text` | False | `—` | — | — |
| wht_exempt | `boolean` | True | `—` | — | — |
| wht_exemption_ref | `text` | False | `—` | — | — |

---

### `currencies` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| code | `text` | True | `—` | — | — |
| name | `text` | True | `—` | — | — |
| symbol | `text` | True | `''::text` | — | — |
| decimal_places | `integer` | True | `2` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| is_primary | `boolean` | True | `false` | — | — |
| is_frankfurter_supported | `boolean` | True | `false` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `departments` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| code | `text` | False | `—` | — | — |
| cost_centre | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| head_user_id | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| name | `text` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `depreciation_schedules` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| accumulated_to_date | `numeric` | True | `—` | — | — |
| asset_id | `uuid` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| depreciation_charge | `numeric` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| net_book_value | `numeric` | True | `—` | — | — |
| period_end | `date` | True | `—` | — | — |
| period_start | `date` | True | `—` | — | — |
| posted | `boolean` | True | `—` | — | — |
| posted_at | `timestamp with time zone` | False | `—` | — | — |
| posted_by | `text` | False | `—` | — | — |

---

### `employee_allowances` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| amount | `numeric` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| effective_from | `date` | True | `—` | — | — |
| effective_to | `date` | False | `—` | — | — |
| employee_id | `uuid` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| is_taxable | `boolean` | True | `—` | — | — |
| name | `text` | True | `—` | — | — |

---

### `employee_deductions` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| amount | `numeric` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| deduction_type | `text` | True | `—` | — | — |
| effective_from | `date` | True | `—` | — | — |
| effective_to | `date` | False | `—` | — | — |
| employee_id | `uuid` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| liability_account_id | `uuid` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| percentage | `numeric` | True | `—` | — | — |
| pre_tax | `boolean` | True | `—` | — | — |

---

### `employees` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| bank_account_number | `text` | False | `—` | — | — |
| bank_branch | `text` | False | `—` | — | — |
| bank_name | `text` | False | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| currency | `currency_code` | True | `—` | — | — |
| date_of_birth | `date` | False | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| email | `text` | False | `—` | — | — |
| employee_number | `text` | True | `—` | — | — |
| employment_type | `text` | True | `—` | — | — |
| end_date | `date` | False | `—` | — | — |
| first_name | `text` | True | `—` | — | — |
| gender | `text` | False | `—` | — | — |
| gross_salary | `numeric` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| job_title | `text` | False | `—` | — | — |
| last_name | `text` | True | `—` | — | — |
| mobile_money_number | `text` | False | `—` | — | — |
| mobile_money_type | `text` | False | `—` | — | — |
| national_id | `text` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| pay_frequency | `text` | True | `—` | — | — |
| paye_code | `text` | False | `—` | — | — |
| paye_liability_account_id | `uuid` | False | `—` | — | — |
| paye_tax_class | `text` | False | `—` | — | — |
| payment_method | `payment_method` | True | `—` | — | — |
| phone | `text` | False | `—` | — | — |
| probation_end_date | `text` | False | `—` | — | — |
| salary_account_id | `uuid` | False | `—` | — | — |
| start_date | `date` | True | `—` | — | — |
| tax_exempt | `boolean` | True | `—` | — | — |
| tpin | `text` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `exchange_rates` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| from_currency | `text` | True | `—` | — | — |
| to_currency | `text` | True | `—` | — | — |
| rate | `numeric(20,10)` | True | `—` | — | — |
| rate_date | `date` | True | `—` | — | — |
| source | `text` | True | `'manual'::text` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `expense_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| account_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| description | `text` | True | `—` | — | — |
| discount_amount | `numeric` | True | `0` | — | — |
| discount_percent | `numeric` | True | `0` | — | — |
| expense_id | `uuid` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| line_number | `numeric` | True | `—` | — | — |
| line_subtotal | `numeric` | False | `—` | — | — |
| line_total | `numeric` | True | `—` | — | — |
| product_id | `uuid` | False | `—` | — | — |
| quantity | `numeric` | True | `—` | — | — |
| tax_amount | `numeric` | True | `—` | — | — |
| tax_code | `tax_code` | True | `—` | — | — |
| tax_rate | `numeric` | True | `—` | — | — |
| unit_price | `numeric` | True | `—` | — | — |

---

### `expense_payments` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| amount | `numeric` | True | `—` | — | — |
| bank_account_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| currency | `text` | True | `—` | — | — |
| exchange_rate | `numeric(20,10)` | True | `—` | — | — |
| expense_id | `uuid` | True | `—` | — | — |
| functional_amount | `numeric` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| original_amount | `numeric` | False | `—` | — | — |
| original_currency | `text` | False | `—` | — | — |
| payment_date | `date` | True | `—` | — | — |
| payment_method | `payment_method` | True | `—` | — | — |
| rate_date | `date` | False | `—` | — | — |
| rate_is_stale | `boolean` | True | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| exchange_rate_used | `numeric(20,10)` | False | `exchange_rate` | — | s |
| functional_currency | `text` | False | `—` | — | — |
| client_key | `uuid` | False | `—` | — | — |

---

### `expenses` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| amount_paid | `numeric` | True | `—` | — | — |
| ap_account_id | `uuid` | False | `—` | — | — |
| approved_at | `timestamp with time zone` | False | `—` | — | — |
| approved_by | `text` | False | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| contact_id | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| currency | `text` | True | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| due_date | `date` | False | `—` | — | — |
| exchange_rate | `numeric(20,10)` | True | `—` | — | — |
| expense_date | `date` | True | `—` | — | — |
| expense_number | `text` | True | `—` | — | — |
| expense_type | `text` | True | `—` | — | — |
| functional_amount | `numeric` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| original_amount | `numeric` | False | `—` | — | — |
| original_currency | `text` | False | `—` | — | — |
| rate_date | `date` | False | `—` | — | — |
| rate_is_stale | `boolean` | True | `—` | — | — |
| receipt_filename | `text` | False | `—` | — | — |
| receipt_mime_type | `text` | False | `—` | — | — |
| receipt_size_bytes | `numeric` | False | `—` | — | — |
| receipt_url | `text` | False | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| status | `text` | True | `—` | — | — |
| subtotal | `numeric` | True | `—` | — | — |
| discount_amount | `numeric` | True | `0` | — | — |
| discount_percent | `numeric` | True | `0` | — | — |
| total_amount | `numeric` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| vat_amount | `numeric` | True | `—` | — | — |
| wht_amount | `numeric` | True | `—` | — | — |
| exchange_rate_used | `numeric(20,10)` | False | `exchange_rate` | — | s |
| functional_currency | `text` | False | `—` | — | — |
| client_key | `uuid` | False | `—` | — | — |

---

### `fixed_assets` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| accumulated_dep_account_id | `uuid` | False | `—` | — | — |
| accumulated_depreciation | `numeric` | True | `—` | — | — |
| acquisition_cost | `numeric` | True | `—` | — | — |
| acquisition_date | `date` | True | `—` | — | — |
| asset_account_id | `uuid` | False | `—` | — | — |
| asset_number | `text` | True | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| category_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| dep_expense_account_id | `uuid` | False | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| depreciable_amount | `numeric` | False | `—` | — | — |
| depreciation_method | `depreciation_method` | True | `—` | — | — |
| depreciation_rate | `numeric` | False | `—` | — | — |
| depreciation_start_date | `text` | True | `—` | — | — |
| description | `text` | False | `—` | — | — |
| disposal_date | `date` | False | `—` | — | — |
| disposal_journal_id | `uuid` | False | `—` | — | — |
| disposal_proceeds | `numeric` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| image_url | `text` | False | `—` | — | — |
| insurance_expiry_date | `text` | False | `—` | — | — |
| insurance_policy_number | `text` | False | `—` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| is_depreciable | `boolean` | True | `true` | — | — |
| last_depreciation_date | `text` | False | `—` | — | — |
| location | `text` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| net_book_value | `numeric` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| purchase_invoice_ref | `text` | False | `—` | — | — |
| purchase_journal_id | `uuid` | False | `—` | — | — |
| residual_value | `numeric` | True | `—` | — | — |
| revaluation_date | `text` | False | `—` | — | — |
| revaluation_surplus_account | `uuid` | False | `—` | — | — |
| revalued_amount | `numeric` | False | `—` | — | — |
| serial_number | `text` | False | `—` | — | — |
| status | `asset_status` | True | `—` | — | — |
| supplier_id | `uuid` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| useful_life_months | `numeric` | False | `—` | — | — |
| useful_life_years | `numeric` | False | `—` | — | — |
| warranty_expiry_date | `text` | False | `—` | — | — |

---

### `fx_revaluations` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| revaluation_date | `date` | True | `—` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| reversal_entry_id | `uuid` | False | `—` | — | — |
| total_unrealised_gain | `numeric(18,2)` | True | `0` | — | — |
| total_unrealised_loss | `numeric(18,2)` | True | `0` | — | — |
| line_count | `integer` | True | `0` | — | — |
| closing_rate_source | `text` | True | `'manual/cache'::text` | — | — |
| status | `text` | True | `'posted'::text` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `inventory_balances` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| average_cost | `numeric` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| last_movement_at | `timestamp with time zone` | False | `—` | — | — |
| location_id | `uuid` | True | `—` | — | — |
| product_id | `uuid` | True | `—` | — | — |
| quantity_available | `numeric` | False | `—` | — | — |
| quantity_on_hand | `numeric` | True | `—` | — | — |
| quantity_reserved | `numeric` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `inventory_locations` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| code | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| is_default | `boolean` | True | `—` | — | — |
| name | `text` | True | `—` | — | — |

---

### `invoice_delivery_events` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| invoice_id | `uuid` | True | `—` | — | — |
| event_type | `text` | True | `—` | — | — |
| reminder_stage | `text` | False | `—` | — | — |
| occurred_at | `timestamp with time zone` | True | `now()` | — | — |
| metadata | `jsonb` | True | `'{}'::jsonb` | — | — |

---

### `invoice_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| account_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| description | `text` | True | `—` | — | — |
| discount_amount | `numeric` | True | `0` | — | — |
| discount_percent | `numeric` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| invoice_id | `uuid` | True | `—` | — | — |
| line_number | `numeric` | True | `—` | — | — |
| line_subtotal | `numeric` | False | `—` | — | — |
| line_total | `numeric` | True | `—` | — | — |
| product_id | `uuid` | False | `—` | — | — |
| quantity | `numeric` | True | `—` | — | — |
| tax_amount | `numeric` | True | `—` | — | — |
| tax_code | `tax_code` | True | `—` | — | — |
| tax_rate | `numeric` | True | `—` | — | — |
| unit_price | `numeric` | True | `—` | — | — |

---

### `invoice_payments` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| amount | `numeric` | True | `—` | — | — |
| bank_account_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| currency | `text` | True | `—` | — | — |
| exchange_rate | `numeric(20,10)` | True | `—` | — | — |
| functional_amount | `numeric` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| invoice_id | `uuid` | True | `—` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| original_amount | `numeric` | False | `—` | — | — |
| original_currency | `text` | False | `—` | — | — |
| payment_date | `date` | True | `—` | — | — |
| payment_method | `payment_method` | True | `—` | — | — |
| rate_date | `date` | False | `—` | — | — |
| rate_is_stale | `boolean` | True | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| exchange_rate_used | `numeric(20,10)` | False | `exchange_rate` | — | s |
| functional_currency | `text` | False | `—` | — | — |
| client_key | `uuid` | False | `—` | — | — |

---

### `invoices` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| amount_due | `numeric` | False | `—` | — | — |
| amount_paid | `numeric` | True | `—` | — | — |
| ar_account_id | `uuid` | False | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| contact_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| credit_note_for | `uuid` | False | `—` | — | — |
| currency | `text` | True | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| discount_amount | `numeric` | True | `—` | — | — |
| discount_percent | `numeric` | True | `—` | — | — |
| due_date | `date` | False | `—` | — | — |
| exchange_rate | `numeric(20,10)` | True | `—` | — | — |
| functional_amount | `numeric` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| invoice_number | `text` | True | `—` | — | — |
| invoice_type | `text` | True | `—` | — | — |
| issue_date | `date` | True | `—` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| original_amount | `numeric` | False | `—` | — | — |
| original_currency | `text` | False | `—` | — | — |
| po_number | `text` | False | `—` | — | — |
| project_code | `text` | False | `—` | — | — |
| lpo_number | `text` | False | `—` | — | — |
| accent_colour | `text` | False | `—` | — | — |
| payment_provider | `text` | False | `—` | — | — |
| payment_reference | `text` | False | `—` | — | — |
| template | `text` | True | `'professional'::text` | — | — |
| rate_date | `date` | False | `—` | — | — |
| rate_is_stale | `boolean` | True | `—` | — | — |
| revenue_account_id | `uuid` | False | `—` | — | — |
| sent_at | `timestamp with time zone` | False | `—` | — | — |
| status | `invoice_status` | True | `—` | — | — |
| subtotal | `numeric` | True | `—` | — | — |
| taxable_amount | `numeric` | True | `—` | — | — |
| terms | `text` | False | `—` | — | — |
| total_amount | `numeric` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| vat_amount | `numeric` | True | `—` | — | — |
| viewed_at | `timestamp with time zone` | False | `—` | — | — |
| wht_amount | `numeric` | True | `—` | — | — |
| exchange_rate_used | `numeric(20,10)` | False | `exchange_rate` | — | s |
| functional_currency | `text` | False | `—` | — | — |
| client_key | `uuid` | False | `—` | — | — |

---

### `journal_entries` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| currency | `text` | True | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| description | `text` | True | `—` | — | — |
| entry_date | `date` | True | `—` | — | — |
| entry_number | `text` | True | `—` | — | — |
| exchange_rate | `numeric(20,10)` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| period_id | `uuid` | False | `—` | — | — |
| posted_at | `timestamp with time zone` | False | `—` | — | — |
| posted_by | `text` | False | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| reversal_of | `uuid` | False | `—` | — | — |
| reversed_by | `uuid` | False | `—` | — | — |
| source_id | `text` | False | `—` | — | — |
| source_type | `text` | False | `—` | — | — |
| status | `journal_status` | True | `—` | — | — |

---

### `journal_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| account_id | `uuid` | True | `—` | — | — |
| amount | `numeric` | True | `—` | — | — |
| amount_base | `numeric` | True | `—` | — | — |
| branch_id | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| currency | `text` | True | `—` | — | — |
| department_id | `uuid` | False | `—` | — | — |
| description | `text` | False | `—` | — | — |
| exchange_rate | `numeric(20,10)` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_debit | `boolean` | True | `—` | — | — |
| journal_entry_id | `uuid` | True | `—` | — | — |
| line_number | `numeric` | True | `—` | — | — |
| original_amount | `numeric` | False | `—` | — | — |
| original_currency | `text` | False | `—` | — | — |
| rate_date | `date` | False | `—` | — | — |
| rate_is_stale | `boolean` | True | `—` | — | — |
| reconciled | `boolean` | True | `—` | — | — |
| reconciled_at | `timestamp with time zone` | False | `—` | — | — |
| tax_amount | `numeric` | True | `—` | — | — |
| tax_code | `tax_code` | False | `—` | — | — |
| exchange_rate_used | `numeric(20,10)` | False | `exchange_rate` | — | s |
| functional_currency | `text` | False | `—` | — | — |
| functional_amount | `numeric(18,2)` | False | `—` | — | — |

---

### `loan_repayments` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| loan_id | `uuid` | True | `—` | — | — |
| repayment_date | `date` | True | `—` | — | — |
| amount | `numeric` | True | `—` | — | — |
| principal_portion | `numeric` | True | `—` | — | — |
| interest_portion | `numeric` | True | `—` | — | — |
| bank_account_id | `uuid` | False | `—` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `loans` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| lender_name | `text` | True | `—` | — | — |
| description | `text` | False | `—` | — | — |
| loan_account_id | `uuid` | True | `—` | — | — |
| interest_expense_account_id | `uuid` | False | `—` | — | — |
| principal_amount | `numeric` | True | `—` | — | — |
| interest_rate_pct | `numeric` | False | `—` | — | — |
| term_months | `integer` | False | `—` | — | — |
| start_date | `date` | True | `—` | — | — |
| first_payment_date | `date` | False | `—` | — | — |
| status | `text` | True | `'active'::text` | — | — |
| drawdown_journal_id | `uuid` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `partner_admins` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| partner_id | `uuid` | True | `—` | — | — |
| user_id | `uuid` | True | `—` | — | — |
| role | `text` | True | `'admin'::text` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `partner_clients` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| partner_id | `uuid` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | False | `now()` | — | — |

---

### `partner_feature_flags` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| partner_id | `uuid` | True | `—` | — | — |
| feature_key | `text` | True | `—` | — | — |
| enabled | `boolean` | False | `false` | — | — |

---

### `partner_invoices` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| partner_id | `uuid` | False | `—` | — | — |
| amount | `numeric(15,2)` | False | `0` | — | — |
| currency | `text` | False | `'MWK'::text` | — | — |
| status | `text` | False | `'draft'::text` | — | — |
| created_at | `timestamp with time zone` | False | `now()` | — | — |
| updated_at | `timestamp with time zone` | False | `now()` | — | — |
| invoice_number | `text` | False | `—` | — | — |
| period_start | `date` | False | `—` | — | — |
| period_end | `date` | False | `—` | — | — |
| due_date | `date` | False | `—` | — | — |
| client_count | `integer` | True | `0` | — | — |
| notes | `text` | False | `—` | — | — |

---

### `partners` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| name | `text` | True | `—` | — | — |
| domain | `text` | False | `—` | — | — |
| logo_url | `text` | False | `—` | — | — |
| primary_colour | `text` | False | `'#1a3a5c'::text` | — | — |
| support_email | `text` | False | `—` | — | — |
| app_name | `text` | False | `'Ledgr'::text` | — | — |
| client_limit | `integer` | False | `100` | — | — |
| is_active | `boolean` | False | `true` | — | — |
| billing_email | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | False | `now()` | — | — |
| updated_at | `timestamp with time zone` | False | `now()` | — | — |
| slug | `text` | False | `—` | — | — |
| custom_domain | `text` | False | `—` | — | — |
| onboarding_title | `text` | False | `—` | — | — |
| onboarding_subtitle | `text` | False | `—` | — | — |
| support_phone | `text` | False | `—` | — | — |
| allow_client_visibility | `boolean` | True | `false` | — | — |
| billing_contact_name | `text` | False | `—` | — | — |
| price_per_client | `numeric(15,2)` | True | `0` | — | — |
| billing_currency | `text` | True | `'MWK'::text` | — | — |

---

### `paye_bands` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| band_from | `numeric` | True | `—` | — | — |
| band_label | `text` | False | `—` | — | — |
| band_to | `numeric` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| effective_from | `date` | True | `—` | — | — |
| effective_to | `date` | False | `—` | — | — |
| fiscal_year | `text` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| rate | `numeric` | True | `—` | — | — |

---

### `payroll_employee_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| basic_salary | `numeric` | True | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| employee_id | `uuid` | True | `—` | — | — |
| gross_pay | `numeric` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| net_pay | `numeric` | True | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| other_deductions | `numeric` | True | `—` | — | — |
| paid_at | `timestamp with time zone` | False | `—` | — | — |
| paye_bands_json | `jsonb` | False | `—` | — | — |
| paye_deduction | `numeric` | True | `—` | — | — |
| paye_taxable_income | `numeric` | True | `—` | — | — |
| payment_method | `payment_method` | True | `—` | — | — |
| payment_ref | `text` | False | `—` | — | — |
| payroll_run_id | `uuid` | True | `—` | — | — |
| payslip_generated | `boolean` | True | `—` | — | — |
| payslip_url | `text` | False | `—` | — | — |
| pension_employee | `numeric` | True | `—` | — | — |
| pension_employer | `numeric` | True | `—` | — | — |
| total_allowances | `numeric` | True | `—` | — | — |
| total_deductions | `numeric` | True | `—` | — | — |

---

### `payroll_runs` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| approved_at | `timestamp with time zone` | False | `—` | — | — |
| approved_by | `text` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| pay_date | `date` | True | `—` | — | — |
| paye_filed_at | `timestamp with time zone` | False | `—` | — | — |
| paye_return_ref | `text` | False | `—` | — | — |
| payroll_period | `text` | True | `—` | — | — |
| period_end | `date` | True | `—` | — | — |
| period_start | `date` | True | `—` | — | — |
| run_number | `text` | True | `—` | — | — |
| status | `payroll_status` | True | `—` | — | — |
| total_gross | `numeric` | True | `—` | — | — |
| total_net | `numeric` | True | `—` | — | — |
| total_other_deductions | `numeric` | True | `—` | — | — |
| total_paye | `numeric` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |
| client_key | `uuid` | False | `—` | — | — |

---

### `product_categories` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| name | `text` | True | `—` | — | — |
| parent_id | `uuid` | False | `—` | — | — |

---

### `products` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| barcode | `text` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| category_id | `uuid` | False | `—` | — | — |
| cogs_account_id | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| currency | `currency_code` | True | `—` | — | — |
| deleted_at | `timestamp with time zone` | False | `—` | — | — |
| description | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| image_url | `text` | False | `—` | — | — |
| inventory_account_id | `uuid` | False | `—` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| name | `text` | True | `—` | — | — |
| product_type | `text` | True | `—` | — | — |
| purchase_account_id | `uuid` | False | `—` | — | — |
| purchase_price | `numeric` | True | `—` | — | — |
| purchase_tax_code | `tax_code` | True | `—` | — | — |
| reorder_level | `numeric` | False | `—` | — | — |
| reorder_quantity | `numeric` | False | `—` | — | — |
| sale_price | `numeric` | True | `—` | — | — |
| sales_account_id | `uuid` | False | `—` | — | — |
| sales_tax_code | `tax_code` | True | `—` | — | — |
| sku | `text` | False | `—` | — | — |
| track_inventory | `boolean` | True | `—` | — | — |
| unit_of_measure | `text` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `profiles` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| full_name | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |

---

### `recurring_invoices` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| template_invoice_id | `uuid` | True | `—` | — | — |
| frequency | `text` | True | `—` | — | — |
| next_run_date | `date` | True | `—` | — | — |
| auto_send | `boolean` | True | `true` | — | — |
| active | `boolean` | True | `true` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `share_transactions` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| shareholder_name | `text` | True | `—` | — | — |
| transaction_type | `text` | True | `—` | — | — |
| shares_count | `numeric` | False | `—` | — | — |
| amount | `numeric` | True | `—` | — | — |
| share_account_id | `uuid` | True | `—` | — | — |
| bank_account_id | `uuid` | False | `—` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `stock_movements` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| created_by | `text` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| location_id | `uuid` | True | `—` | — | — |
| movement_date | `date` | True | `—` | — | — |
| movement_type | `stock_movement_type` | True | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| product_id | `uuid` | True | `—` | — | — |
| quantity | `numeric` | True | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| source_id | `text` | False | `—` | — | — |
| source_type | `text` | False | `—` | — | — |
| total_cost | `numeric` | False | `—` | — | — |
| unit_cost | `numeric` | True | `—` | — | — |
| client_key | `uuid` | False | `—` | — | — |

---

### `stock_transfer_lines` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| notes | `text` | False | `—` | — | — |
| product_id | `uuid` | True | `—` | — | — |
| quantity_dispatched | `numeric` | False | `—` | — | — |
| quantity_received | `numeric` | False | `—` | — | — |
| quantity_requested | `numeric` | True | `—` | — | — |
| transfer_id | `uuid` | True | `—` | — | — |
| unit_cost | `numeric` | True | `—` | — | — |

---

### `stock_transfers` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| approved_at | `timestamp with time zone` | False | `—` | — | — |
| approved_by | `uuid` | False | `—` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| dispatched_at | `timestamp with time zone` | False | `—` | — | — |
| from_location_id | `uuid` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| notes | `text` | False | `—` | — | — |
| received_at | `timestamp with time zone` | False | `—` | — | — |
| received_by | `uuid` | False | `—` | — | — |
| requested_by | `uuid` | False | `—` | — | — |
| status | `text` | True | `—` | — | — |
| to_location_id | `uuid` | True | `—` | — | — |
| transfer_number | `text` | True | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `subscription_payments` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| tx_ref | `text` | True | `—` | — | — |
| gateway | `text` | True | `'paychangu'::text` | — | — |
| gateway_reference | `text` | False | `—` | — | — |
| target_plan_tier | `text` | True | `—` | — | — |
| billing_cycle | `text` | True | `—` | — | — |
| amount | `numeric` | True | `—` | — | — |
| currency | `text` | True | `'MWK'::text` | — | — |
| status | `text` | True | `'pending'::text` | — | — |
| checkout_url | `text` | False | `—` | — | — |
| plan_expires_at | `timestamp with time zone` | False | `—` | — | — |
| initiated_by | `uuid` | False | `—` | — | — |
| raw_response | `jsonb` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `subscription_reminders_sent` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| plan_expires_at | `timestamp with time zone` | True | `—` | — | — |
| days_before | `integer` | True | `—` | — | — |
| sent_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `support_agent_usage` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| user_id | `uuid` | True | `—` | — | — |
| window_start | `timestamp with time zone` | True | `—` | — | — |
| count | `integer` | True | `1` | — | — |

---

### `tax_alerts` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| tax_return_id | `uuid` | True | `—` | — | — |
| alert_type | `tax_alert_type` | True | `—` | — | — |
| scheduled_for | `date` | True | `—` | — | — |
| sent_at | `timestamp with time zone` | False | `—` | — | — |
| channel | `tax_alert_channel` | True | `'email'::tax_alert_channel` | — | — |
| status | `tax_alert_status` | True | `'pending'::tax_alert_status` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `tax_configurations` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| business_id | `uuid` | True | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| description | `text` | False | `—` | — | — |
| effective_from | `date` | True | `—` | — | — |
| effective_to | `date` | False | `—` | — | — |
| employee_rate | `numeric` | False | `—` | — | — |
| employer_rate | `numeric` | False | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| mra_reference | `text` | False | `—` | — | — |
| name | `text` | True | `—` | — | — |
| rate | `numeric` | True | `—` | — | — |
| tax_code | `tax_code` | True | `—` | — | — |
| tax_payable_account_id | `uuid` | False | `—` | — | — |
| tax_receivable_account_id | `uuid` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `tax_payments` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| tax_return_id | `uuid` | True | `—` | — | — |
| payment_date | `date` | True | `CURRENT_DATE` | — | — |
| amount | `numeric` | True | `—` | — | — |
| payment_method | `payment_method` | True | `'bank_transfer'::payment_method` | — | — |
| bank_account_id | `uuid` | False | `—` | — | — |
| reference | `text` | False | `—` | — | — |
| receipt_path | `text` | False | `—` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| notes | `text` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `tax_returns` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| tax_code | `tax_code` | True | `—` | — | — |
| period_label | `text` | True | `—` | — | — |
| period_start | `date` | True | `—` | — | — |
| period_end | `date` | True | `—` | — | — |
| due_date | `date` | True | `—` | — | — |
| output_tax | `numeric` | True | `0` | — | — |
| input_tax | `numeric` | True | `0` | — | — |
| gross_amount | `numeric` | True | `0` | — | — |
| amount_due | `numeric` | True | `0` | — | — |
| amount_paid | `numeric` | True | `0` | — | — |
| status | `tax_return_status` | True | `'pending'::tax_return_status` | — | — |
| journal_entry_id | `uuid` | False | `—` | — | — |
| filed_ref | `text` | False | `—` | — | — |
| filed_at | `timestamp with time zone` | False | `—` | — | — |
| source_type | `text` | False | `—` | — | — |
| source_id | `uuid` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `user_profiles` — MATCH (created by base migration 20250101000000)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| avatar_url | `text` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| deletion_finalized_at | `timestamp with time zone` | False | `—` | — | — |
| deletion_requested_at | `timestamp with time zone` | False | `—` | — | — |
| full_name | `text` | True | `—` | — | — |
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| is_platform_admin | `boolean` | True | `—` | — | — |
| phone | `text` | False | `—` | — | — |
| preferred_language | `text` | False | `'en'::text` | — | — |
| preferred_currency | `currency_code` | False | `—` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `webhook_deliveries` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| webhook_id | `uuid` | True | `—` | — | — |
| event | `text` | True | `—` | — | — |
| payload | `jsonb` | True | `—` | — | — |
| status_code | `integer` | False | `—` | — | — |
| response_body | `text` | False | `—` | — | — |
| attempt | `integer` | True | `1` | — | — |
| delivered_at | `timestamp with time zone` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |

---

### `webhooks` — MATCH (created by migration)

| Column | Type | Not null | Default | Identity | Generated |
|---|---|---|---|---|---|
| id | `uuid` | True | `gen_random_uuid()` | — | — |
| business_id | `uuid` | True | `—` | — | — |
| url | `text` | True | `—` | — | — |
| events | `text[]` | True | `'{}'::text[]` | — | — |
| secret | `text` | True | `encode(gen_random_bytes(32), 'hex'::text)` | — | — |
| is_active | `boolean` | True | `true` | — | — |
| last_triggered_at | `timestamp with time zone` | False | `—` | — | — |
| created_by | `uuid` | False | `—` | — | — |
| created_at | `timestamp with time zone` | True | `now()` | — | — |
| updated_at | `timestamp with time zone` | True | `now()` | — | — |

---

## Constraints

- Primary keys: 70
- Foreign keys: 195
- Unique constraints: 12
- Check constraints: 18
- Indexes: 121
- Generated columns: 5
- Identity columns: 0
- Sequences: 0

## Views

### `v_cash_flow` — MATCH (created by migration)

```sql
 WITH account_meta AS (
         SELECT a.id,
            a.business_id,
            a.code,
            a.account_subtype,
                CASE
                    WHEN a.is_bank_account THEN true
                    WHEN (a.code = ANY (ARRAY['1110'::text, '1115'::text, '1125'::text, '1126'::text])) THEN true
                    ELSE false
                END AS is_cash_equivalent
           FROM accounts a
          WHERE (a.deleted_at IS NULL)
        ), posted_entries AS (
         SELECT je.id AS entry_id,
            je.business_id,
            je.source_type,
            je.reversal_of,
            to_char((je.entry_date)::timestamp with time zone, 'YYYY-MM'::text) AS period
           FROM journal_entries je
          WHERE (je.status = ANY (ARRAY['posted'::journal_status, 'reversed'::journal_status]))
        ), effective_entries AS (
         SELECT pe.entry_id,
            pe.business_id,
            pe.period,
                CASE
                    WHEN ((pe.source_type = 'reversal'::text) AND (pe.reversal_of IS NOT NULL)) THEN COALESCE(( SELECT je_orig.source_type
                       FROM journal_entries je_orig
                      WHERE (je_orig.id = pe.reversal_of)), 'reversal'::text)
                    ELSE pe.source_type
                END AS effective_source_type
           FROM posted_entries pe
        ), enriched_lines AS (
         SELECT ee.entry_id,
            ee.business_id,
            ee.period,
            ee.effective_source_type,
            jl.is_debit,
            jl.amount_base,
            am.code AS account_code,
            am.account_subtype,
            am.is_cash_equivalent
           FROM ((effective_entries ee
             JOIN journal_lines jl ON ((jl.journal_entry_id = ee.entry_id)))
             JOIN account_meta am ON ((am.id = jl.account_id)))
        ), cash_per_entry AS (
         SELECT el.entry_id,
            el.business_id,
            el.period,
            sum(
                CASE
                    WHEN el.is_cash_equivalent THEN
                    CASE
                        WHEN el.is_debit THEN el.amount_base
                        ELSE (- el.amount_base)
                    END
                    ELSE (0)::numeric
                END) AS net_cash
           FROM enriched_lines el
          GROUP BY el.entry_id, el.business_id, el.period
         HAVING bool_or(el.is_cash_equivalent)
        ), classification_per_entry AS (
         SELECT cpe_1.entry_id,
            cpe_1.business_id,
            cpe_1.period,
            cpe_1.net_cash,
                CASE
                    WHEN bool_or((el.effective_source_type = 'fixed_asset_revaluation'::text)) THEN 'excluded'::text
                    WHEN bool_or((el.effective_source_type = 'fixed_asset_disposal'::text)) THEN 'investing'::text
                    WHEN bool_and(el.is_cash_equivalent) THEN 'operating'::text
                    WHEN bool_or((el.account_subtype = 'fixed_asset'::account_subtype)) THEN 'investing'::text
                    WHEN bool_or((el.account_code = ANY (ARRAY['2140'::text, '2145'::text, '2510'::text, '2511'::text, '2512'::text, '2515'::text]))) THEN 'financing'::text
                    WHEN bool_or((el.account_code = '3140'::text)) THEN 'financing'::text
                    WHEN bool_or((el.account_subtype = 'share_capital'::account_subtype)) THEN 'financing'::text
                    ELSE 'operating'::text
                END AS classification
           FROM (cash_per_entry cpe_1
             JOIN enriched_lines el ON ((el.entry_id = cpe_1.entry_id)))
          GROUP BY cpe_1.entry_id, cpe_1.business_id, cpe_1.period, cpe_1.net_cash
        )
 SELECT cpe.business_id,
    cpe.period,
    COALESCE(sum(
        CASE
            WHEN (cls.classification = 'operating'::text) THEN cpe.net_cash
            ELSE (0)::numeric
        END), (0)::numeric) AS operating,
    COALESCE(sum(
        CASE
            WHEN (cls.classification = 'investing'::text) THEN cpe.net_cash
            ELSE (0)::numeric
        END), (0)::numeric) AS investing,
    COALESCE(sum(
        CASE
            WHEN (cls.classification = 'financing'::text) THEN cpe.net_cash
            ELSE (0)::numeric
        END), (0)::numeric) AS financing,
    COALESCE(sum(
        CASE
            WHEN (cls.classification = ANY (ARRAY['operating'::text, 'investing'::text, 'financing'::text])) THEN cpe.net_cash
            ELSE (0)::numeric
        END), (0)::numeric) AS net_change
   FROM (cash_per_entry cpe
     JOIN classification_per_entry cls USING (entry_id))
  GROUP BY cpe.business_id, cpe.period;
```

### `v_inventory_ledger_variance` — MATCH (created by migration)

```sql
 WITH subledger AS (
         SELECT ib.business_id,
            COALESCE(sum((ib.quantity_on_hand * ib.average_cost)), (0)::numeric) AS subledger_value
           FROM inventory_balances ib
          GROUP BY ib.business_id
        ), ledger AS (
         SELECT a.business_id,
            COALESCE(sum(
                CASE
                    WHEN jl.is_debit THEN jl.amount_base
                    ELSE (- jl.amount_base)
                END), (0)::numeric) AS ledger_balance
           FROM ((accounts a
             LEFT JOIN journal_lines jl ON ((jl.account_id = a.id)))
             LEFT JOIN journal_entries je ON (((je.id = jl.journal_entry_id) AND (je.status = ANY (ARRAY['posted'::journal_status, 'reversed'::journal_status])))))
          WHERE ((a.code ~~ '114%'::text) AND (a.is_group = false) AND (a.deleted_at IS NULL))
          GROUP BY a.business_id
        )
 SELECT b.id AS business_id,
    b.name AS business_name,
    COALESCE(s.subledger_value, (0)::numeric) AS stock_on_hand_value,
    COALESCE(l.ledger_balance, (0)::numeric) AS inventory_ledger_balance,
    (COALESCE(s.subledger_value, (0)::numeric) - COALESCE(l.ledger_balance, (0)::numeric)) AS variance,
        CASE
            WHEN (abs((COALESCE(s.subledger_value, (0)::numeric) - COALESCE(l.ledger_balance, (0)::numeric))) < 0.01) THEN 'reconciled'::text
            WHEN (COALESCE(s.subledger_value, (0)::numeric) > COALESCE(l.ledger_balance, (0)::numeric)) THEN 'missing from balance sheet'::text
            ELSE 'overstated on balance sheet'::text
        END AS status
   FROM ((businesses b
     LEFT JOIN subledger s ON ((s.business_id = b.id)))
     LEFT JOIN ledger l ON ((l.business_id = b.id)))
  WHERE (b.deleted_at IS NULL);
```

### `v_partner_client_usage` — MATCH (created by migration)

```sql
 SELECT pc.partner_id,
    b.id AS business_id,
    b.name AS business_name,
    b.plan_tier,
    b.is_active,
    pc.created_at AS onboarded_at,
    ( SELECT count(*) AS count
           FROM journal_entries je
          WHERE (je.business_id = b.id)) AS journal_entry_count,
    ( SELECT count(*) AS count
           FROM invoices i
          WHERE (i.business_id = b.id)) AS invoice_count,
    ( SELECT count(*) AS count
           FROM business_users bu
          WHERE ((bu.business_id = b.id) AND bu.is_active)) AS user_count,
    ( SELECT max(je.created_at) AS max
           FROM journal_entries je
          WHERE (je.business_id = b.id)) AS last_activity_at
   FROM (partner_clients pc
     JOIN businesses b ON ((b.id = pc.business_id)))
  WHERE ((b.deleted_at IS NULL) AND is_partner_admin(auth.uid(), pc.partner_id));
```

## Functions (RPCs)

### `add_partner_admin(p_partner_id uuid, p_user_email_or_id text, p_role text)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.add_partner_admin(p_partner_id uuid, p_user_email_or_id text, p_role text DEFAULT 'admin'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can add partner admins.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role is null or p_role not in ('admin', 'viewer') then
    raise exception 'Partner admin role must be "admin" or "viewer".';
  end if;

  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'Partner not found.';
  end if;

  if p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_user_id from auth.users where id = p_user_email_or_id::uuid;
  else
    select id into v_user_id from auth.users
     where lower(email) = lower(trim(p_user_email_or_id));
  end if;

  if v_user_id is null then
    raise exception 'No registered Ledgr user found for "%". Ask them to create an account first.', p_user_email_or_id;
  end if;

  insert into public.partner_admins (partner_id, user_id, role)
  values (p_partner_id, v_user_id, p_role)
  on conflict (partner_id, user_id)
  do update set role = excluded.role; -- keep original created_at
end;
$function$

```

### `apply_subscription_payment(p_tx_ref text, p_status text, p_gateway_reference text, p_raw_response jsonb)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.apply_subscription_payment(p_tx_ref text, p_status text, p_gateway_reference text, p_raw_response jsonb)
 RETURNS subscription_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment public.subscription_payments;
begin
  if p_status not in ('success', 'failed', 'cancelled') then
    raise exception 'Invalid subscription payment status: %', p_status;
  end if;

  select * into v_payment
  from public.subscription_payments
  where tx_ref = p_tx_ref
  for update;

  if not found then
    raise exception 'Unknown subscription payment tx_ref: %', p_tx_ref;
  end if;

  -- Already resolved — don't reprocess (e.g. webhook arrives after the
  -- user's own post-redirect verification already settled it).
  if v_payment.status <> 'pending' then
    return v_payment;
  end if;

  update public.subscription_payments
  set status = p_status,
      gateway_reference = coalesce(p_gateway_reference, gateway_reference),
      raw_response = coalesce(p_raw_response, raw_response)
  where tx_ref = p_tx_ref
  returning * into v_payment;

  if p_status = 'success' then
    update public.businesses
    set plan_tier = v_payment.target_plan_tier,
        plan_expires_at = v_payment.plan_expires_at,
        plan_updated_at = now()
    where id = v_payment.business_id;
  end if;

  return v_payment;
end;
$function$

```

### `backfill_and_recalculate_inventory(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.backfill_and_recalculate_inventory(p_business_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_business_id uuid, sales_backfilled integer, purchases_backfilled integer, balances_updated integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sales_count INT := 0;
  v_purchases_count INT := 0;
  v_balances_count INT := 0;
  v_biz_record RECORD;
  v_default_loc_id UUID;
BEGIN
  -- BUG 3 FIX: only the service role may reconcile "every business" (NULL).
  -- Any other caller must name a business it can write to.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_business_id IS NULL THEN
      RAISE EXCEPTION 'business_id is required.'
        USING ERRCODE = '22004'; -- null_value_not_allowed
    END IF;

    IF NOT public.can_write_business_data(p_business_id) THEN
      RAISE EXCEPTION 'You do not have permission to reconcile inventory for this business.'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
  END IF;

  FOR v_biz_record IN
    SELECT id FROM public.businesses
    WHERE (p_business_id IS NULL OR id = p_business_id)
      AND is_active = true
      AND deleted_at IS NULL
  LOOP
    -- 1. Ensure at least one default warehouse location exists for this business
    SELECT id INTO v_default_loc_id
    FROM public.inventory_locations
    WHERE business_id = v_biz_record.id AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    IF v_default_loc_id IS NULL THEN
      INSERT INTO public.inventory_locations (
        business_id, name, is_default, is_active, created_at, updated_at
      )
      VALUES (
        v_biz_record.id, 'Main Warehouse', true, true, now(), now()
      )
      RETURNING id INTO v_default_loc_id;
    END IF;

    -- 2. Backfill missing stock movements for past purchases (expenses) FIRST,
    -- so the sales backfill below can price each sale off the purchase
    -- history that predates it.
    WITH missing_purchases AS (
      SELECT
        e.business_id,
        el.product_id,
        COALESCE(
          (SELECT loc.id FROM public.inventory_locations loc WHERE loc.branch_id = e.branch_id AND loc.is_active = true LIMIT 1),
          v_default_loc_id
        ) AS location_id,
        'purchase'::public.stock_movement_type AS movement_type,
        e.expense_date AS movement_date,
        el.quantity AS quantity, -- positive for purchases
        el.unit_price AS unit_cost,
        'expense' AS source_type,
        e.id AS source_id,
        e.expense_number AS reference,
        e.created_by
      FROM public.expenses e
      JOIN public.expense_lines el ON el.expense_id = e.id
      JOIN public.products p ON p.id = el.product_id
      WHERE e.business_id = v_biz_record.id
        AND e.deleted_at IS NULL
        AND p.track_inventory
        AND el.product_id IS NOT NULL
        AND el.quantity > 0
        -- Skip if a stock movement for this expense & product already exists
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.business_id = e.business_id
            AND sm.source_id = e.id
            AND sm.source_type = 'expense'
            AND sm.product_id = el.product_id
        )
    ),
    inserted_purchases AS (
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      SELECT
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      FROM missing_purchases
      RETURNING id
    )
    SELECT COUNT(*) INTO v_purchases_count FROM inserted_purchases;

    -- 3. Backfill missing stock movements for past sales (invoices).
    --
    -- BUG 1 FIX: cost each backfilled sale at the weighted-average cost of
    -- that product's inbound movements up to (and including) the sale date
    -- — never at il.unit_price, which is what the customer was charged and
    -- has nothing to do with what the stock cost the business. Falls back
    -- to the product's current purchase_price only when no purchase history
    -- exists for that product at all (e.g. opening stock was never
    -- recorded), and to 0 as a last resort — matching buildCogsPostings'
    -- existing "skip zero-cost lines rather than invent a number" rule.
    WITH missing_sales AS (
      SELECT
        i.business_id,
        il.product_id,
        COALESCE(
          (SELECT loc.id FROM public.inventory_locations loc WHERE loc.branch_id = i.branch_id AND loc.is_active = true LIMIT 1),
          v_default_loc_id
        ) AS location_id,
        'sale'::public.stock_movement_type AS movement_type,
        i.issue_date AS movement_date,
        -il.quantity AS quantity, -- negative for sales
        COALESCE(
          (
            SELECT SUM(sm2.quantity * sm2.unit_cost) / NULLIF(SUM(sm2.quantity), 0)
            FROM public.stock_movements sm2
            WHERE sm2.business_id = i.business_id
              AND sm2.product_id = il.product_id
              AND sm2.quantity > 0
              AND sm2.movement_date <= i.issue_date
          ),
          p.purchase_price,
          0
        ) AS unit_cost,
        'invoice' AS source_type,
        i.id AS source_id,
        i.invoice_number AS reference,
        i.created_by
      FROM public.invoices i
      JOIN public.invoice_lines il ON il.invoice_id = i.id
      JOIN public.products p ON p.id = il.product_id
      WHERE i.business_id = v_biz_record.id
        AND i.deleted_at IS NULL
        AND p.track_inventory
        AND il.product_id IS NOT NULL
        AND il.quantity > 0
        -- Skip if a stock movement for this invoice & product already exists
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.business_id = i.business_id
            AND sm.source_id = i.id
            AND sm.source_type = 'invoice'
            AND sm.product_id = il.product_id
        )
    ),
    inserted_sales AS (
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      SELECT
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      FROM missing_sales
      RETURNING id
    )
    SELECT COUNT(*) INTO v_sales_count FROM inserted_sales;

    -- 4. Recalculate inventory_balances from stock_movements.
    --
    -- BUG 2 FIX: weighted-average cost over INBOUND movements only
    -- (Σ inbound qty × inbound cost ÷ Σ inbound qty), matching how
    -- average_cost is defined everywhere else in the app (see
    -- inventoryValuation.ts). The previous AVG(ABS(unit_cost)) blended sale
    -- prices and purchase costs together with no quantity weighting.
    WITH calc_balances AS (
      SELECT
        sm.business_id,
        sm.product_id,
        sm.location_id,
        COALESCE(SUM(sm.quantity), 0) AS calc_quantity_on_hand,
        COALESCE(
          SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity * sm.unit_cost ELSE 0 END)
            / NULLIF(SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END), 0),
          0
        ) AS calc_avg_cost,
        MAX(sm.created_at) AS last_movement
      FROM public.stock_movements sm
      WHERE sm.business_id = v_biz_record.id
      GROUP BY sm.business_id, sm.product_id, sm.location_id
    ),
    upserted_balances AS (
      INSERT INTO public.inventory_balances (
        business_id, product_id, location_id, quantity_on_hand, quantity_reserved,
        average_cost, last_movement_at, updated_at
      )
      SELECT
        cb.business_id, cb.product_id, cb.location_id, cb.calc_quantity_on_hand, 0,
        cb.calc_avg_cost, cb.last_movement, now()
      FROM calc_balances cb
      ON CONFLICT (business_id, product_id, location_id)
      DO UPDATE SET
        quantity_on_hand = EXCLUDED.quantity_on_hand,
        average_cost = CASE WHEN EXCLUDED.average_cost > 0 THEN EXCLUDED.average_cost ELSE inventory_balances.average_cost END,
        last_movement_at = EXCLUDED.last_movement_at,
        updated_at = now()
      RETURNING id
    )
    SELECT COUNT(*) INTO v_balances_count FROM upserted_balances;

    RETURN QUERY SELECT v_biz_record.id, v_sales_count, v_purchases_count, v_balances_count;
  END LOOP;
END;
$function$

```

### `business_partner_id(bid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.business_partner_id(bid uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select partner_id from public.partner_clients where business_id = bid limit 1;
$function$

```

### `can_admin_business_data(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.can_admin_business_data(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in ('owner', 'admin')
  );
$function$

```

### `can_read_audit(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.can_read_audit(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- The pre-existing 'auditor' tier, preserved exactly, plus
        -- board_member as an oversight role. Deliberately NOT widened to
        -- every member: the audit log records who did what.
        'owner', 'admin', 'accountant', 'payroll_manager', 'auditor',
        'board_member'
      )
  );
$function$

```

### `can_read_partner_client(pid uuid, bid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=""']`

```sql
CREATE OR REPLACE FUNCTION public.can_read_partner_client(pid uuid, bid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

```

### `can_read_partner_peer_business(bid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=""']`

```sql
CREATE OR REPLACE FUNCTION public.can_read_partner_peer_business(bid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

```

### `can_view_payroll(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.can_view_payroll(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- Mirrors canViewPayroll in src/hooks/usePermissions.ts.
        'owner', 'admin', 'accountant', 'payroll_manager'
      )
  );
$function$

```

### `can_write_business_data(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.can_write_business_data(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- Mirrors canWrite in src/hooks/usePermissions.ts. Keep in sync.
        'owner',
        'admin',
        'accountant',
        'supervisor',
        'data_entry',
        'inventory_manager',
        'sales_clerk',
        'purchasing_officer',
        'warehouse_worker',
        'sales_manager',
        'customer_service_rep',
        'tax_compliance_officer',
        'treasury_manager',
        'asset_manager',
        'branch_manager'
        -- Deliberately absent: payroll_manager (payroll only), auditor,
        -- viewer, board_member.
      )
  );
$function$

```

### `can_write_payroll(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.can_write_payroll(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- Mirrors canWritePayroll in src/hooks/usePermissions.ts.
        -- (TeamManagementPage.tsx's matrix also lists supervisor; the hook
        -- does not, and the hook is what runs. Following the hook.)
        'owner', 'admin', 'accountant', 'payroll_manager'
      )
  );
$function$

```

### `clear_partner_admins(p_partner_id uuid)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.clear_partner_admins(p_partner_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_removed integer;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can revoke a partner''s staff access.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'Partner not found.';
  end if;

  delete from public.partner_admins
   where partner_id = p_partner_id;
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$function$

```

### `consume_api_rate_limit(p_bucket text, p_limit integer, p_window_start timestamp with time zone)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_bucket text, p_limit integer, p_window_start timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if p_bucket is null or length(p_bucket) = 0 or p_limit < 1 then
    raise exception 'Invalid rate limit arguments' using errcode = '22023';
  end if;

  insert into public.api_usage (api_key, count, window_start)
  values (p_bucket, 1, p_window_start)
  on conflict (api_key, window_start) where api_key is not null do update
    set count = public.api_usage.count + 1
    where public.api_usage.count < p_limit
  returning count into v_count;

  return v_count is not null;
end;
$function$

```

### `create_api_journal_entry(p_business_id uuid, p_entry jsonb, p_lines jsonb)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.create_api_journal_entry(p_business_id uuid, p_entry jsonb, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry public.journal_entries;
  v_debits numeric;
  v_credits numeric;
begin
  if jsonb_typeof(p_entry) <> 'object' or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry needs a header and at least two lines.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as l(account_id uuid, amount_base numeric, is_debit boolean)
    left join public.accounts a on a.id = l.account_id and a.business_id = p_business_id
    where l.account_id is null or l.amount_base is null or l.amount_base <= 0 or l.is_debit is null or a.id is null
  ) then
    raise exception 'Every journal line must have a business account, a positive amount_base, and debit/credit side.' using errcode = '22023';
  end if;

  select coalesce(sum(case when l.is_debit then l.amount_base else 0 end), 0),
         coalesce(sum(case when not l.is_debit then l.amount_base else 0 end), 0)
    into v_debits, v_credits
  from jsonb_to_recordset(p_lines) as l(amount_base numeric, is_debit boolean);

  if abs(v_debits - v_credits) > 0.005 then
    raise exception 'Journal entry lines do not balance in functional currency.' using errcode = '22023';
  end if;

  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, reference, currency,
    exchange_rate, branch_id, department_id, period_id, source_type, source_id, status
  )
  values (
    p_business_id,
    p_entry->>'entry_number',
    (p_entry->>'entry_date')::date,
    p_entry->>'description',
    nullif(p_entry->>'reference', ''),
    coalesce(nullif(p_entry->>'currency', ''), 'MWK'),
    coalesce((p_entry->>'exchange_rate')::numeric, 1),
    nullif(p_entry->>'branch_id', '')::uuid,
    nullif(p_entry->>'department_id', '')::uuid,
    nullif(p_entry->>'period_id', '')::uuid,
    nullif(p_entry->>'source_type', ''),
    nullif(p_entry->>'source_id', '')::uuid,
    'draft'
  ) returning * into v_entry;

  insert into public.journal_lines (
    journal_entry_id, business_id, line_number, account_id, is_debit, amount,
    amount_base, currency, exchange_rate, description, branch_id, department_id,
    tax_code, tax_amount, original_currency, original_amount, rate_date, rate_is_stale
  )
  select v_entry.id, p_business_id, l.line_number, l.account_id, l.is_debit,
         l.amount, l.amount_base, coalesce(l.currency, v_entry.currency),
         coalesce(l.exchange_rate, v_entry.exchange_rate), l.description,
         l.branch_id, l.department_id, l.tax_code, coalesce(l.tax_amount, 0),
         l.original_currency, l.original_amount, l.rate_date, coalesce(l.rate_is_stale, false)
  from jsonb_to_recordset(p_lines) as l(
    line_number integer, account_id uuid, is_debit boolean, amount numeric,
    amount_base numeric, currency text, exchange_rate numeric, description text,
    branch_id uuid, department_id uuid, tax_code public.tax_code, tax_amount numeric,
    original_currency text, original_amount numeric, rate_date date, rate_is_stale boolean
  );

  return to_jsonb(v_entry);
end;
$function$

```

### `current_partner_ids(uid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.current_partner_ids(uid uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select partner_id from public.partner_admins where user_id = uid;
$function$

```

### `diagnose_user_login(p_user_email_or_id text)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.diagnose_user_login(p_user_email_or_id text)
 RETURNS TABLE(check_name text, status text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id       UUID;
  v_email         TEXT;
  v_confirmed_at  TIMESTAMPTZ;
  v_banned_until  TIMESTAMPTZ;
  v_visible_count INT;
  v_total_count   INT;
BEGIN
  IF p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, email, email_confirmed_at, banned_until
      INTO v_user_id, v_email, v_confirmed_at, v_banned_until
      FROM auth.users WHERE id = p_user_email_or_id::UUID;
  ELSE
    SELECT id, email, email_confirmed_at, banned_until
      INTO v_user_id, v_email, v_confirmed_at, v_banned_until
      FROM auth.users WHERE LOWER(email) = LOWER(TRIM(p_user_email_or_id));
  END IF;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT
      'auth.users'::TEXT, 'FAIL'::TEXT,
      format('No user matches "%s".', p_user_email_or_id);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'auth.users'::TEXT, 'OK'::TEXT,
    format('Found %s (%s).', v_email, v_user_id);

  -- Supabase rejects signInWithPassword with "Email not confirmed" when a
  -- dashboard-created user was never marked confirmed.
  RETURN QUERY SELECT
    'email_confirmed'::TEXT,
    (CASE WHEN v_confirmed_at IS NOT NULL THEN 'OK' ELSE 'FAIL' END)::TEXT,
    (CASE WHEN v_confirmed_at IS NOT NULL
          THEN format('Confirmed at %s.', v_confirmed_at)
          ELSE 'NOT confirmed — login fails with "Email not confirmed". '
               'Tick "Auto Confirm User" in the dashboard, or run: '
               'update auth.users set email_confirmed_at = now() where id = ''' || v_user_id || ''';'
     END)::TEXT;

  RETURN QUERY SELECT
    'not_banned'::TEXT,
    (CASE WHEN v_banned_until IS NULL OR v_banned_until < now() THEN 'OK' ELSE 'FAIL' END)::TEXT,
    COALESCE('Banned until ' || v_banned_until, 'Not banned.')::TEXT;

  RETURN QUERY SELECT
    'user_profiles'::TEXT,
    (CASE WHEN EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user_id)
          THEN 'OK' ELSE 'WARN' END)::TEXT,
    (CASE WHEN EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user_id)
          THEN 'Profile row present.'
          ELSE 'No user_profiles row. Not fatal, but name/language/admin flags '
               'will be empty. grant_user_business_access() creates one.'
     END)::TEXT;

  SELECT count(*) INTO v_total_count
    FROM public.business_users WHERE user_id = v_user_id;

  -- This predicate is the exact one the app uses.
  SELECT count(*) INTO v_visible_count
    FROM public.business_users bu
    JOIN public.businesses b ON b.id = bu.business_id
   WHERE bu.user_id = v_user_id
     AND bu.is_active = true
     AND b.is_active = true
     AND b.deleted_at IS NULL;

  RETURN QUERY SELECT
    'visible_memberships'::TEXT,
    (CASE WHEN v_visible_count > 0 THEN 'OK' ELSE 'FAIL' END)::TEXT,
    format(
      '%s of %s membership row(s) are visible to the app. %s',
      v_visible_count, v_total_count,
      CASE WHEN v_visible_count = 0
           THEN 'User signs in but is redirected to /create-business. '
                'Fix with grant_user_business_access().'
           ELSE '' END
    );

  RETURN QUERY
    SELECT
      'membership'::TEXT,
      (CASE WHEN bu.is_active AND b.is_active AND b.deleted_at IS NULL
            THEN 'OK' ELSE 'HIDDEN' END)::TEXT,
      format(
        'business=%s (%s) role=%s bu.is_active=%s b.is_active=%s b.deleted_at=%s',
        b.name, b.id, bu.role, bu.is_active, b.is_active,
        COALESCE(b.deleted_at::TEXT, 'null')
      )
    FROM public.business_users bu
    JOIN public.businesses b ON b.id = bu.business_id
   WHERE bu.user_id = v_user_id;
END;
$function$

```

### `enforce_expense_payment_allowed()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.enforce_expense_payment_allowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status
    from public.expenses
   where id = new.expense_id;

  if v_status = 'void' then
    raise exception 'Cannot record a payment against a void expense.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$

```

### `enforce_invoice_payment_allowed()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.enforce_invoice_payment_allowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status
    from public.invoices
   where id = new.invoice_id;

  if v_status in ('void', 'credit_note') then
    raise exception 'Cannot record a payment against a % invoice.', v_status
      using errcode = '22023';
  end if;

  return new;
end;
$function$

```

### `enforce_partner_client_limit()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.enforce_partner_client_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  lim int;
  used int;
begin
  select client_limit into lim from public.partners where id = new.partner_id;
  if lim is null then
    return new;
  end if;
  select count(*) into used from public.partner_clients where partner_id = new.partner_id;
  if used >= lim then
    raise exception 'Partner client limit reached (% of %)', used, lim
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$

```

### `enforce_plan_tier_change()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `false` · Owner: `postgres` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.enforce_plan_tier_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.plan_tier is distinct from old.plan_tier then
    -- Edge functions (webhook / verify / cron) use the service role key
    -- and are the only path allowed to *raise* plan_tier, since that only
    -- happens after a gateway-confirmed payment. Any other caller
    -- (the owner's own browser, including direct REST/devtools calls)
    -- may still lower it — e.g. the self-serve "Downgrade" button.
    if auth.role() <> 'service_role' and public.plan_tier_rank(new.plan_tier) > public.plan_tier_rank(old.plan_tier) then
      raise exception 'Upgrading plan_tier requires a confirmed payment — use the Billing tab to check out.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$

```

### `gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$

```

### `gin_extract_value_trgm(text, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$

```

### `gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$

```

### `gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
 RETURNS "char"
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$

```

### `grant_user_business_access(p_user_email_or_id text, p_business_id uuid, p_role text)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.grant_user_business_access(p_user_email_or_id text, p_business_id uuid, p_role text DEFAULT 'viewer'::text)
 RETURNS TABLE(out_user_id uuid, out_business_id uuid, out_role text, out_action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID;
  v_role_enum user_role;
  v_existing  RECORD;
  v_action    TEXT;
BEGIN
  -- Validate the role against the live enum.
  BEGIN
    v_role_enum := p_role::user_role;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'Invalid role "%". Valid roles: %',
      p_role,
      (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role');
  END;

  -- Resolve the user by UUID or email.
  IF p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_user_id FROM auth.users WHERE id = p_user_email_or_id::UUID;
  ELSE
    SELECT id INTO v_user_id FROM auth.users
     WHERE LOWER(email) = LOWER(TRIM(p_user_email_or_id));
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User "%" was not found in auth.users.', p_user_email_or_id;
  END IF;

  -- The business must exist and be live, otherwise the app's !inner join
  -- silently drops the membership and the user still sees nothing.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND is_active = true AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Business % does not exist, is inactive, or is soft-deleted. '
      'The app filters these out, so the membership would be invisible.',
      p_business_id;
  END IF;

  -- Ensure a user_profiles row exists. findUserProfile() uses maybeSingle()
  -- so a missing row is not fatal, but the profile drives display name and
  -- preferred_language, and several RLS helpers read from this table.
  INSERT INTO public.user_profiles (id)
  VALUES (v_user_id)
  ON CONFLICT (id) DO NOTHING;

  SELECT id, is_active, role INTO v_existing
    FROM public.business_users
   WHERE business_id = p_business_id AND user_id = v_user_id;

  IF v_existing.id IS NULL THEN
    v_action := 'created';
  ELSIF v_existing.is_active THEN
    v_action := 'updated';
  ELSE
    v_action := 'reactivated';
  END IF;

  INSERT INTO public.business_users (
    business_id, user_id, role, is_active, accepted_at, created_at, updated_at
  )
  VALUES (
    p_business_id, v_user_id, v_role_enum, true, now(), now(), now()
  )
  -- NB: the conflicting row is referenced by the bare table name here.
  -- Schema-qualifying it ("public.business_users.accepted_at") is rejected by
  -- Postgres with "invalid reference to FROM-clause entry".
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET role        = EXCLUDED.role,
        is_active   = true,
        accepted_at = COALESCE(business_users.accepted_at, now()),
        updated_at  = now();

  RETURN QUERY SELECT v_user_id, p_business_id, p_role, v_action;
END;
$function$

```

### `gtrgm_compress(internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_compress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_compress$function$

```

### `gtrgm_consistent(internal, text, smallint, oid, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_consistent$function$

```

### `gtrgm_decompress(internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_decompress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_decompress$function$

```

### `gtrgm_distance(internal, text, smallint, oid, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_distance$function$

```

### `gtrgm_in(cstring)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_in(cstring)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_in$function$

```

### `gtrgm_options(internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_options(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/pg_trgm', $function$gtrgm_options$function$

```

### `gtrgm_out(gtrgm)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_out(gtrgm)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_out$function$

```

### `gtrgm_penalty(internal, internal, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_penalty$function$

```

### `gtrgm_picksplit(internal, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_picksplit$function$

```

### `gtrgm_same(gtrgm, gtrgm, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_same(gtrgm, gtrgm, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_same$function$

```

### `gtrgm_union(internal, internal)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.gtrgm_union(internal, internal)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_union$function$

```

### `increment_amount_paid(p_table text, p_id uuid, p_amount numeric)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.increment_amount_paid(p_table text, p_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Validate table name to prevent SQL injection.
  if p_table not in ('invoices', 'expenses') then
    raise exception 'Invalid table name: %. Must be "invoices" or "expenses"', p_table
      using errcode = '22023';
  end if;

  -- Zero is a no-op and almost certainly a caller bug; negative is a valid
  -- back-out (payment reversal).
  if p_amount = 0 then
    raise exception 'Amount must be non-zero: %', p_amount
      using errcode = '22023';
  end if;

  if p_table = 'invoices' then
    -- Ownership: caller must be a writer of this invoice's business.
    if not exists (
      select 1 from public.invoices i
      where i.id = p_id
        and public.can_write_business_data(i.business_id)
    ) then
      raise exception 'Invoice % not found or you lack permission to update it', p_id
        using errcode = 'P0002';
    end if;

    update public.invoices
       set amount_paid = amount_paid + p_amount
     where id = p_id
       and amount_paid + p_amount >= 0;

    if not found then
      raise exception 'Reversal exceeds amount paid for invoice %', p_id
        using errcode = '22023';
    end if;

  elsif p_table = 'expenses' then
    if not exists (
      select 1 from public.expenses e
      where e.id = p_id
        and public.can_write_business_data(e.business_id)
    ) then
      raise exception 'Expense % not found or you lack permission to update it', p_id
        using errcode = 'P0002';
    end if;

    update public.expenses
       set amount_paid = amount_paid + p_amount
     where id = p_id
       and amount_paid + p_amount >= 0;

    if not found then
      raise exception 'Reversal exceeds amount paid for expense %', p_id
        using errcode = '22023';
    end if;
  end if;
end;
$function$

```

### `is_business_member(p_business_id uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
  );
$function$

```

### `is_partner_admin(uid uuid, pid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.is_partner_admin(uid uuid, pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.partner_admins pa
     where pa.user_id = uid and pa.partner_id = pid
  ) or public.is_platform_admin(uid);
$function$

```

### `is_partner_business_admin(bid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=""']`

```sql
CREATE OR REPLACE FUNCTION public.is_partner_business_admin(bid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.partner_clients pc
     where pc.business_id = bid
       and public.is_partner_admin(auth.uid(), pc.partner_id)
  );
$function$

```

### `is_platform_admin(uid uuid)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.is_platform_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select is_platform_admin from public.user_profiles where id = uid), false);
$function$

```

### `list_all_businesses()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.list_all_businesses()
 RETURNS TABLE(out_business_id uuid, out_business_name text, out_trading_name text, out_email text, out_phone text, out_plan_tier text, out_created_at timestamp with time zone, out_owner_emails text, out_owner_names text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can list all businesses.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      b.id,
      b.name::text,
      b.trading_name::text,
      b.email::text,
      b.phone::text,
      b.plan_tier::text,
      b.created_at,
      coalesce(string_agg(au.email, ', ' order by au.email), '')::text,
      coalesce(string_agg(coalesce(nullif(up.full_name, ''), au.email), ', ' order by au.email), '')::text
    from public.businesses b
    left join public.business_users bu
      on bu.business_id = b.id and bu.role = 'owner' and bu.is_active = true
    left join auth.users au on au.id = bu.user_id
    left join public.user_profiles up on up.id = bu.user_id
   where b.deleted_at is null
   group by b.id
   order by b.created_at desc;
end;
$function$

```

### `list_partner_admins(p_partner_id uuid)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.list_partner_admins(p_partner_id uuid)
 RETURNS TABLE(out_user_id uuid, out_email text, out_name text, out_role text, out_created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_partner_admin(auth.uid(), p_partner_id) then
    raise exception 'Not authorized to view admins for this partner.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      pa.user_id,
      au.email::text,
      coalesce(nullif(up.full_name, ''), au.email)::text,
      pa.role::text,
      pa.created_at
    from public.partner_admins pa
    join auth.users au on au.id = pa.user_id
    left join public.user_profiles up on up.id = pa.user_id
   where pa.partner_id = p_partner_id
   order by au.email asc;
end;
$function$

```

### `plan_tier_rank(tier text)` — MATCH (created by migration)

- Volatility: `i` · Security definer: `false` · Owner: `postgres` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.plan_tier_rank(tier text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case tier
    when 'free' then 0
    when 'growth' then 1
    when 'pro' then 2
    when 'enterprise' then 3
    else -1
  end;
$function$

```

### `prevent_functional_currency_change()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `false` · Owner: `postgres` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.prevent_functional_currency_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'UPDATE' and new.base_currency is distinct from old.base_currency then
    raise exception 'Functional currency cannot be changed after business creation (IAS 21). Create a new business if the functional currency changes.';
  end if;
  return new;
end;
$function$

```

### `prevent_locked_bank_line_change()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `false` · Owner: `postgres` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.prevent_locked_bank_line_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if exists (select 1 from public.bank_statements s where s.id = coalesce(old.statement_id, new.statement_id) and s.is_locked) then
    raise exception 'This bank reconciliation period is locked';
  end if;
  return coalesce(new, old);
end; $function$

```

### `protect_partner_commercial_fields()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.protect_partner_commercial_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_platform_admin(auth.uid()) and (
        old.client_limit         is distinct from new.client_limit
    or  old.price_per_client     is distinct from new.price_per_client
    or  old.billing_currency     is distinct from new.billing_currency
    or  old.billing_email        is distinct from new.billing_email
    or  old.billing_contact_name is distinct from new.billing_contact_name
    or  old.is_active            is distinct from new.is_active
    or  old.slug                 is distinct from new.slug
    or  old.custom_domain        is distinct from new.custom_domain
  ) then
    raise exception 'Only Ledgr (platform admin) can change a partner''s commercial, billing or routing settings (client_limit, price_per_client, billing_currency, billing_email, billing_contact_name, is_active, slug, custom_domain).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$

```

### `record_business_terms_acceptance(p_business_id uuid, p_terms_version text)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.record_business_terms_acceptance(p_business_id uuid, p_terms_version text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accepted_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to accept the Terms and Conditions.';
  END IF;

  IF p_terms_version <> '1.1' THEN
    RAISE EXCEPTION 'The supplied Terms and Conditions version is not current.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_users
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
      AND role = 'owner'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active business owner can record Terms and Conditions acceptance.';
  END IF;

  INSERT INTO public.business_terms_acceptances (business_id, user_id, terms_version)
  VALUES (p_business_id, auth.uid(), p_terms_version)
  ON CONFLICT (business_id, user_id, terms_version) DO UPDATE
    SET accepted_at = business_terms_acceptances.accepted_at
  RETURNING accepted_at INTO v_accepted_at;

  RETURN v_accepted_at;
END;
$function$

```

### `remove_partner_admin(p_partner_id uuid, p_user_email_or_id text)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.remove_partner_admin(p_partner_id uuid, p_user_email_or_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can remove partner admins.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_user_id from auth.users where id = p_user_email_or_id::uuid;
  else
    select id into v_user_id from auth.users
     where lower(email) = lower(trim(p_user_email_or_id));
  end if;

  if v_user_id is null then
    raise exception 'User "%" was not found.', p_user_email_or_id;
  end if;

  delete from public.partner_admins
   where partner_id = p_partner_id and user_id = v_user_id;
end;
$function$

```

### `reserve_next_document_number(p_business_id uuid, p_kind text)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.reserve_next_document_number(p_business_id uuid, p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_number integer;
  v_prefix text;
  v_allowed boolean;
begin
  if p_kind not in ('invoice', 'expense', 'payroll') then
    raise exception 'Unknown document kind %. Expected invoice, expense or payroll.', p_kind
      using errcode = '22023';
  end if;

  -- Payroll numbers are reserved only by payroll roles; everything else by the
  -- general writer set. Checked before the row is touched.
  if p_kind = 'payroll' then
    v_allowed := public.can_write_payroll(p_business_id);
  else
    v_allowed := public.can_write_business_data(p_business_id);
  end if;

  if not v_allowed then
    raise exception 'You do not have permission to record % documents for this business.', p_kind
      using errcode = '42501';   -- insufficient_privilege, mapped to UnauthorizedError
  end if;

  -- Atomic read-and-increment. The row lock serialises concurrent callers, so
  -- two users cannot receive the same number.
  if p_kind = 'invoice' then
    update public.businesses
       set invoice_next_number = invoice_next_number + 1,
           updated_at          = now()
     where id = p_business_id
       and deleted_at is null
    returning invoice_next_number - 1, coalesce(invoice_prefix, 'INV')
      into v_number, v_prefix;

  elsif p_kind = 'expense' then
    update public.businesses
       set expense_next_number = expense_next_number + 1,
           updated_at          = now()
     where id = p_business_id
       and deleted_at is null
    returning expense_next_number - 1, coalesce(expense_prefix, 'EXP')
      into v_number, v_prefix;

  else
    update public.businesses
       set payroll_next_number = payroll_next_number + 1,
           updated_at          = now()
     where id = p_business_id
       and deleted_at is null
    returning payroll_next_number - 1, coalesce(payroll_prefix, 'PAY')
      into v_number, v_prefix;
  end if;

  -- Distinguish a genuinely absent business from a permission problem. The
  -- permission case already returned above, so reaching here means no row.
  if v_number is null then
    raise exception 'Business % does not exist or has been deleted.', p_business_id
      using errcode = 'P0002';   -- no_data_found
  end if;

  return v_prefix || '-' || lpad(v_number::text, 4, '0');
end;
$function$

```

### `seed_partner_feature_flags()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.seed_partner_feature_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.partner_feature_flags (partner_id, feature_key, enabled)
  values
    (new.id, 'ai_advisor', true),
    (new.id, 'payroll', true),
    (new.id, 'inventory', true),
    (new.id, 'multi_currency', true),
    (new.id, 'bank_reconciliation', true)
  on conflict (partner_id, feature_key) do nothing;
  return new;
end;
$function$

```

### `set_limit(real)` — MATCH (pg_trgm extension function)

- Volatility: `v` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.set_limit(real)
 RETURNS real
 LANGUAGE c
 STRICT
AS '$libdir/pg_trgm', $function$set_limit$function$

```

### `set_partner_invoice_number()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `false` · Owner: `postgres` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.set_partner_invoice_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.invoice_number is null then
    new.invoice_number := 'PINV-' || lpad(nextval('public.partner_invoice_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$function$

```

### `set_updated_at()` — MATCH (created by migration)

- Volatility: `v` · Security definer: `false` · Owner: `postgres` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```

### `set_user_business_access(p_user_email_or_id text, p_business_ids uuid[], p_role text, p_revoke_others boolean)` — MATCH (created by migration)

- Volatility: `v` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.set_user_business_access(p_user_email_or_id text, p_business_ids uuid[], p_role text DEFAULT 'viewer'::text, p_revoke_others boolean DEFAULT false)
 RETURNS TABLE(out_business_id uuid, out_business_name text, out_role text, out_action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     UUID;
  v_role_enum   user_role;
  v_biz_id      UUID;
  v_invalid     UUID[];
  v_revoked     INT := 0;
BEGIN
  IF p_business_ids IS NULL OR array_length(p_business_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_business_ids must contain at least one business id.';
  END IF;

  -- Validate the role against the live enum, and list the real options on
  -- failure rather than the stale hardcoded list the old function printed.
  BEGIN
    v_role_enum := p_role::user_role;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid role "%". Valid roles: %',
      p_role,
      (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role');
  END;

  -- Resolve the user by UUID or email.
  IF p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_user_id FROM auth.users WHERE id = p_user_email_or_id::UUID;
  ELSE
    SELECT id INTO v_user_id FROM auth.users
     WHERE LOWER(email) = LOWER(TRIM(p_user_email_or_id));
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User "%" was not found in auth.users.', p_user_email_or_id;
  END IF;

  -- Reject the whole call if ANY target business is missing/inactive/deleted.
  -- The app filters those out, so a membership pointing at one would be
  -- invisible and would look like the grant silently failed.
  SELECT array_agg(t.id) INTO v_invalid
    FROM unnest(p_business_ids) AS t(id)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.businesses b
      WHERE b.id = t.id AND b.is_active = true AND b.deleted_at IS NULL
   );

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION
      'These business ids do not exist, are inactive, or are soft-deleted: %. '
      'No changes were made.', v_invalid;
  END IF;

  -- Grant/reactivate each target business first, so the revoke step below can
  -- never transiently leave the user with nothing.
  FOREACH v_biz_id IN ARRAY p_business_ids LOOP
    RETURN QUERY
    WITH prior AS (
      SELECT bu.id, bu.is_active
        FROM public.business_users bu
       WHERE bu.business_id = v_biz_id AND bu.user_id = v_user_id
    ),
    upsert AS (
      INSERT INTO public.business_users (
        business_id, user_id, role, is_active, accepted_at, created_at, updated_at
      )
      VALUES (v_biz_id, v_user_id, v_role_enum, true, now(), now(), now())
      ON CONFLICT (business_id, user_id) DO UPDATE
        SET role        = EXCLUDED.role,
            is_active   = true,
            -- Preserve the original acceptance timestamp; the old function
            -- left it untouched on conflict, so rows reactivated after an
            -- invite could keep a NULL accepted_at.
            accepted_at = COALESCE(business_users.accepted_at, now()),
            updated_at  = now()
      RETURNING business_id
    )
    SELECT
      v_biz_id,
      b.name::TEXT,
      p_role::TEXT,
      (CASE
         WHEN NOT EXISTS (SELECT 1 FROM prior)          THEN 'created'
         WHEN (SELECT p.is_active FROM prior p)         THEN 'updated'
         ELSE 'reactivated'
       END)::TEXT
    FROM upsert u
    JOIN public.businesses b ON b.id = u.business_id;
  END LOOP;

  -- Opt-in exclusivity. Only reachable once the grants above have succeeded.
  IF p_revoke_others THEN
    UPDATE public.business_users
       SET is_active = false, updated_at = now()
     WHERE user_id = v_user_id
       AND NOT (business_id = ANY (p_business_ids))
       AND is_active = true;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    -- Belt and braces: verify the user still has somewhere to land. If not,
    -- abort the whole transaction rather than lock them out.
    IF NOT EXISTS (
      SELECT 1
        FROM public.business_users bu
        JOIN public.businesses b ON b.id = bu.business_id
       WHERE bu.user_id = v_user_id
         AND bu.is_active = true
         AND b.is_active = true
         AND b.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'Aborted: revoking other memberships would leave user % with no '
        'visible business, locking them out of the app.', p_user_email_or_id;
    END IF;

    RAISE NOTICE 'Deactivated % other membership(s) for %.',
      v_revoked, p_user_email_or_id;
  END IF;
END;
$function$

```

### `show_limit()` — MATCH (pg_trgm extension function)

- Volatility: `s` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.show_limit()
 RETURNS real
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_limit$function$

```

### `show_trgm(text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.show_trgm(text)
 RETURNS text[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_trgm$function$

```

### `similarity(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity$function$

```

### `similarity_dist(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_dist$function$

```

### `similarity_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `s` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_op$function$

```

### `strict_word_similarity(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$

```

### `strict_word_similarity_commutator_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `s` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$

```

### `strict_word_similarity_dist_commutator_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$

```

### `strict_word_similarity_dist_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$

```

### `strict_word_similarity_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `s` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$

```

### `user_has_role(p_business_id uuid, p_min_role user_role)` — MATCH (created by migration)

- Volatility: `s` · Security definer: `true` · Owner: `postgres` · Search path: `['search_path=public']`

```sql
CREATE OR REPLACE FUNCTION public.user_has_role(p_business_id uuid, p_min_role user_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_min_role::text
    -- Read tier. Every active member, so master data and transactional lists
    -- populate for all roles. Payroll tables no longer use this tier.
    when 'viewer'          then public.is_business_member(p_business_id)

    -- Oversight read (audit_log).
    when 'auditor'         then public.can_read_audit(p_business_id)

    -- Payroll tier, kept narrow.
    when 'payroll_manager' then public.can_view_payroll(p_business_id)

    -- General write tier: the canWrite set from usePermissions.ts.
    when 'accountant'      then public.can_write_business_data(p_business_id)

    -- Administrative / destructive.
    when 'admin'           then public.can_admin_business_data(p_business_id)
    when 'owner'           then exists (
                                  select 1
                                  from public.business_users bu
                                  where bu.business_id = p_business_id
                                    and bu.user_id = auth.uid()
                                    and bu.is_active = true
                                    and bu.role::text = 'owner'
                                )

    -- Unknown tier denies, matching the original NULL-returning behaviour but
    -- explicitly.
    else false
  end;
$function$

```

### `word_similarity(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity$function$

```

### `word_similarity_commutator_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `s` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$

```

### `word_similarity_dist_commutator_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$

```

### `word_similarity_dist_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `i` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$

```

### `word_similarity_op(text, text)` — MATCH (pg_trgm extension function)

- Volatility: `s` · Security definer: `false` · Owner: `supabase_admin` · Search path: `None`

```sql
CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_op$function$

```

## Triggers

| Trigger | Table | Definition |
|---|---|---|
| bank_line_locked_guard | bank_statement_lines | `CREATE TRIGGER bank_line_locked_guard BEFORE DELETE OR UPDATE ON public.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION prevent_locked_bank_line_change()` |
| trg_enforce_plan_tier_change | businesses | `CREATE TRIGGER trg_enforce_plan_tier_change BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION enforce_plan_tier_change()` |
| trg_prevent_functional_currency_change | businesses | `CREATE TRIGGER trg_prevent_functional_currency_change BEFORE UPDATE OF base_currency ON public.businesses FOR EACH ROW EXECUTE FUNCTION prevent_functional_currency_change()` |
| expense_payments_status_guard | expense_payments | `CREATE TRIGGER expense_payments_status_guard BEFORE INSERT OR UPDATE ON public.expense_payments FOR EACH ROW EXECUTE FUNCTION enforce_expense_payment_allowed()` |
| invoice_payments_status_guard | invoice_payments | `CREATE TRIGGER invoice_payments_status_guard BEFORE INSERT OR UPDATE ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION enforce_invoice_payment_allowed()` |
| trg_enforce_partner_client_limit | partner_clients | `CREATE TRIGGER trg_enforce_partner_client_limit BEFORE INSERT ON public.partner_clients FOR EACH ROW EXECUTE FUNCTION enforce_partner_client_limit()` |
| trg_set_partner_invoice_number | partner_invoices | `CREATE TRIGGER trg_set_partner_invoice_number BEFORE INSERT ON public.partner_invoices FOR EACH ROW EXECUTE FUNCTION set_partner_invoice_number()` |
| trg_protect_partner_commercial_fields | partners | `CREATE TRIGGER trg_protect_partner_commercial_fields BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION protect_partner_commercial_fields()` |
| trg_seed_partner_feature_flags | partners | `CREATE TRIGGER trg_seed_partner_feature_flags AFTER INSERT ON public.partners FOR EACH ROW EXECUTE FUNCTION seed_partner_feature_flags()` |
| trg_subscription_payments_updated_at | subscription_payments | `CREATE TRIGGER trg_subscription_payments_updated_at BEFORE UPDATE ON public.subscription_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at()` |
| trg_tax_returns_updated_at | tax_returns | `CREATE TRIGGER trg_tax_returns_updated_at BEFORE UPDATE ON public.tax_returns FOR EACH ROW EXECUTE FUNCTION set_updated_at()` |

## RLS

- Tables with RLS: 65/65 · Forced: 0

### Policies by table

| Table | Policies |
|---|---|
| accounts | accounts_admin_delete, accounts_member_read, accounts_partner_admin_read, accounts_platform_admin_read, accounts_writer_insert, accounts_writer_update |
| api_keys | api_keys_business_read, api_keys_business_update |
| asset_categories | asset_categories_admin_delete, asset_categories_member_read, asset_categories_platform_admin_read, asset_categories_writer_insert, asset_categories_writer_update |
| branches | branches_admin_delete, branches_member_read, branches_platform_admin_read, branches_writer_insert, branches_writer_update |
| business_invitations | business_invitations_business_access |
| businesses | businesses_member_read, businesses_partner_admin_read, businesses_partner_peer_read, businesses_platform_admin_read, businesses_update |
| contacts | contacts_admin_delete, contacts_member_read, contacts_platform_admin_read, contacts_writer_insert, contacts_writer_update |
| currencies | currencies_read |
| departments | departments_admin_delete, departments_member_read, departments_platform_admin_read, departments_writer_insert, departments_writer_update |
| depreciation_schedules | depreciation_schedules_admin_delete, depreciation_schedules_member_read, depreciation_schedules_platform_admin_read, depreciation_schedules_writer_insert, depreciation_schedules_writer_update |
| employee_allowances | employee_allowances_payroll_delete, employee_allowances_payroll_insert, employee_allowances_payroll_read, employee_allowances_payroll_update |
| employee_deductions | employee_deductions_payroll_delete, employee_deductions_payroll_insert, employee_deductions_payroll_read, employee_deductions_payroll_update |
| employees | employees_payroll_delete, employees_payroll_insert, employees_payroll_read, employees_payroll_update |
| exchange_rates | exchange_rates_business_read, exchange_rates_business_write |
| fixed_assets | fixed_assets_admin_delete, fixed_assets_member_read, fixed_assets_platform_admin_read, fixed_assets_writer_insert, fixed_assets_writer_update |
| fx_revaluations | fx_revaluations_business_read |
| inventory_locations | inventory_locations_admin_delete, inventory_locations_member_read, inventory_locations_platform_admin_read, inventory_locations_writer_insert, inventory_locations_writer_update |
| invoice_delivery_events | invoice_delivery_events_member_read, invoice_delivery_events_writer_insert |
| loan_repayments | loan_repayments_business_access |
| loans | loans_business_access |
| partner_admins | partner_admins_read, partner_admins_write |
| partner_clients | partner_clients_read, partner_clients_write |
| partner_feature_flags | partner_feature_flags_read, partner_feature_flags_write |
| partner_invoices | partner_invoices_read, partner_invoices_write |
| partners | partners_admin_write, partners_partner_admin_update, partners_public_read |
| payroll_employee_lines | payroll_employee_lines_payroll_delete, payroll_employee_lines_payroll_insert, payroll_employee_lines_payroll_read, payroll_employee_lines_payroll_update |
| payroll_runs | payroll_runs_payroll_delete, payroll_runs_payroll_insert, payroll_runs_payroll_read, payroll_runs_payroll_update |
| recurring_invoices | recurring_invoices_admin_delete, recurring_invoices_member_read, recurring_invoices_writer_insert, recurring_invoices_writer_update |
| share_transactions | share_transactions_business_access |
| subscription_payments | subscription_payments_platform_admin_read, subscription_payments_read |
| tax_alerts | tax_alerts_business_access |
| tax_payments | tax_payments_business_access |
| tax_returns | tax_returns_business_access |
| webhook_deliveries | webhook_deliveries_business_read |
| webhooks | webhooks_business_insert, webhooks_business_read, webhooks_business_update |

### RLS enabled but NO policies (deny-all)

The following tables have RLS enabled and no policies — every authenticated
query is denied (zero rows):

- `accounting_periods`
- `ai_insights_usage`
- `api_usage`
- `audit_log`
- `bank_statement_lines`
- `bank_statements`
- `budget_lines`
- `budgets`
- `business_terms_acceptances`
- `business_users`
- `expense_lines`
- `expense_payments`
- `expenses`
- `inventory_balances`
- `invoice_lines`
- `invoice_payments`
- `invoices`
- `journal_entries`
- `journal_lines`
- `paye_bands`
- `product_categories`
- `products`
- `profiles`
- `stock_movements`
- `stock_transfer_lines`
- `stock_transfers`
- `subscription_reminders_sent`
- `support_agent_usage`
- `tax_configurations`
- `user_profiles`

## Storage

- Buckets: 0 — (none — buckets are dashboard-created and were not migrated)
- Storage policies: 0

## Cron jobs

| Job id | Schedule | Active | Command |
|---|---|---|---|
| 1 | `0 1 * * *` | True | `
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/expire-subscript` |
| 2 | `0 8 * * *` | True | `
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-renewal-rem` |
| 3 | `0 2 1 * *` | True | `
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-partner` |

## Known gaps (confirmed against live staging)

1. **9 RPCs missing from both repository and staging** (they exist only on the
   legacy/production database; bodies were never version-controlled):
   - `accept_invitation`
   - `create_business_with_owner`
   - `current_user_role`
   - `get_enum_values`
   - `get_user_role`
   - `invite_member`
   - `log_manual_audit_event`
   - `seed_new_business`
   - `verify_audit_chain`
2. **4 views missing from both repository and staging** (exist only on the
   legacy/production database):
   - `v_ar_ageing`
   - `v_asset_register`
   - `v_reorder_alerts`
   - `v_trial_balance`
3. **RLS policies for {len(cs['rls_enabled_no_policies'])} tables** — RLS enabled,
   zero policies (deny-all). The legacy database had out-of-band policies that
   were never migrated. The app is not functional on a fresh environment until
   these are reconstructed (Phase 8B scope).
4. **Storage buckets** — `business-logos` / `user-exports` are dashboard-created
   and absent from a fresh environment; recreate per environment.

## Source of truth

Machine-readable form: `artifacts/database/staging-schema-inventory.json`.
Capture tooling: `scripts/database/capture-staging-schema-via-api.sh`.
Builder: `scripts/database/build-live-inventory.py`.
