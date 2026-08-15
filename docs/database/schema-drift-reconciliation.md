# Ledgr — Schema Drift Reconciliation (Phase 8A.1) — LIVE-VERIFIED

> **Status: LIVE-VERIFIED.** This revision supersedes the evidence-based draft.
> On 2026-08-15 the **read-only capture of the live staging database**
> (project `bkxzgkurcqvccsdjmqzg`, `ledgr-staging`, built from the repository
> migrations) completed successfully (24+2/26 queries; the final two policy
> queries were fixed in PR #94 and re-run green). Every classification below
> is grounded in that live capture.

## Classification legend

| Class | Meaning |
|---|---|
| MATCH | Object exists on live staging and is created by a repository migration (or the Phase 8A.1 base migration) |
| MISSING FROM REPOSITORY | Object existed on the legacy database (per `database.generated.ts`) but is created by no migration and is **absent from live staging** |
| UNKNOWN | Not determinable |

## 1. Verified matches (live staging == repository replay)

| Category | Live staging | Repository replay | Verdict |
|---|---|---|---|
| Tables | **65** | 65 | ✅ identical sets |
| Enums | **16** | 16 | ✅ identical labels + order |
| Foreign keys | **195** | 195 | ✅ identical definitions |
| Triggers | **11** | 11 | ✅ identical |
| Cron jobs | **3** | 3 (20260726000003, 2000005, 27000006) | ✅ identical schedules/commands (placeholders intact) |
| Extensions | pg_cron 1.6.4, pg_net 0.20.4, pg_trgm 1.6, pgcrypto 1.3 (+ platform: pg_stat_statements, supabase_vault, uuid-ossp, plpgsql) | same | ✅ (pg_trgm added by base migration; pgcrypto/pg_cron/pg_net by migrations) |
| PostgreSQL | **17.6** | — | ✅ `config.toml major_version = 17` confirmed |
| Base tables/columns/defaults | 40 base tables incl. `currencies`, `audit_log.id` = bigint + `audit_log_id_seq` default, `invoices.issue_date/due_date/rate_date` = date, `exchange_rate` = numeric(20,10) | base migration | ✅ all `[INFERRED]` markers in the base migration resolved as correct |

## 2. Confirmed gaps — objects that existed only on the LEGACY database

The Phase 8A.1 evidence (from `database.generated.ts`, generated from the
legacy shared project) listed objects that are **not reproducible from the
repository** — and the live capture of the new staging database **confirms
they are absent there too**. They exist only on the legacy project (now
production), which Phase 8A.1 may not inspect.

### 9 RPCs (bodies never version-controlled)

| Function | Signature (from generated types) | Used by | On live staging? |
|---|---|---|---|
| `accept_invitation` | `(p_token text) → json` | AcceptInvitationPage, accept-invite-link (fallback) | ❌ absent |
| `create_business_with_owner` | `(18 args) → string` | CreateBusinessPage (primary path) | ❌ absent |
| `current_user_role` | `(p_business_id uuid) → user_role` | Period/Journal repositories | ❌ absent |
| `get_user_role` | `(p_business_id uuid) → user_role` | Period/Journal repositories | ❌ absent |
| `get_enum_values` | `(enum_name text) → string[]` | settings pages | ❌ absent |
| `invite_member` | `(p_business_id, p_email, p_role) → string` | TeamManagementPage (fallback) | ❌ absent |
| `log_manual_audit_event` | `(4 args) → void` | AuditLogRepository | ❌ absent |
| `seed_new_business` | `(p_biz json) → void` | CreateBusinessPage | ❌ absent |
| `verify_audit_chain` | `(p_business_id, p_resource_type) → table` | AuditLogRepository | ❌ absent |

**Live staging function census: 71 functions** — every migration-created
helper plus the `pg_trgm` extension family (`show_limit`, `show_trgm`,
`similarity`, `set_limit`, …). The 9 RPCs are not among them.

### 4 views (bodies never version-controlled)

`v_ar_ageing`, `v_asset_register`, `v_reorder_alerts`, `v_trial_balance` —
absent from live staging. Live staging has exactly the 3 migration-created
views: `v_cash_flow`, `v_inventory_ledger_variance`, `v_partner_client_usage`.

### RLS policies on 30 tables — deny-all (CRITICAL)

Live staging has **RLS enabled on all 65 tables** (none disabled, none
forced) and **102 policies on 35 tables**. The remaining **30 tables have RLS
enabled with zero policies — every authenticated query is denied**:

```
accounting_periods, ai_insights_usage, api_usage, audit_log,
bank_statement_lines, bank_statements, budget_lines, budgets,
business_terms_acceptances, business_users, expense_lines, expense_payments,
expenses, inventory_balances, invoice_lines, invoice_payments, invoices,
journal_entries, journal_lines, paye_bands, product_categories, products,
profiles, stock_movements, stock_transfer_lines, stock_transfers,
subscription_reminders_sent, support_agent_usage, tax_configurations,
user_profiles
```

This includes the **core financial tables** (invoices, journal_entries,
expenses, stock_*) and the **membership tables** (business_users,
user_profiles). The legacy database had out-of-band policies on these tables
(created in the dashboard, never migrated); the repository cannot reproduce
them, and Phase 8A.1 preserves the observed staging state (no policies) rather
than inventing new ones. **The app is not functional against a fresh
environment until these policies are reconstructed — Phase 8B scope.**

### Storage

- **0 buckets** on live staging (`business-logos`, `user-exports` are
  dashboard-created; absent from a fresh environment).
- **0 storage policies** on live staging.

## 3. Root-cause confirmation

The earlier hypotheses (stale generated types vs. divergent migration
history) are now resolved:

- `database.generated.ts` was generated from the **legacy** project, which
  contained out-of-band objects (9 RPCs, 4 views, 30 policy sets, storage
  buckets) that were **never version-controlled**.
- The **new staging database** was built purely from the repository
  migrations, so it reproduces exactly what the repository can express — and
  the live capture proves fresh == staging 1:1.
- The repository is therefore **reproducible for everything it contains**,
  and the outstanding gaps are precisely the out-of-band objects.

## 4. Accounting-safeguard observations (unchanged)

- `journal_lines` carries `amount` (original) + `amount_base` (functional)
  with `is_debit`; generated `exchange_rate_used` columns confirmed on 5
  transaction tables.
- `businesses` counters advanced atomically by `reserve_next_document_number`
  (SECURITY DEFINER, search_path=public — verified live).
- `audit_log` has no FKs (confirmed live: business_id/user_id are plain
  uuid, no constraints), hash-chain columns present; `id` = bigint +
  `audit_log_id_seq` default.
- All 11 live triggers are migration-created; no out-of-band triggers exist.
- Grants: Supabase defaults (`arwdDxtm` for anon/authenticated/service_role)
  with the migration-created revocations (e.g. `accounts` revokes anon;
  payroll tables revoke anon) confirmed live.
