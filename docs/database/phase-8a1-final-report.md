# Phase 8A.1 Final Report — Authoritative Staging Schema Capture & Baseline Reconstruction

**Date:** 2026-08-15 (rev. 2 — live-verified)
**Branch/PRs:** `arena/phase-8a1-base-migration` → PR #92 (merged) · `arena/fix-migration-raise-param` → PR #93 (merged) · `arena/fix-capture-policies` → PR #94 (merged)
**Phase status:** 🟡 **YELLOW — major progress; reproducibility verified for everything version-controlled; app-critical gaps confirmed with live evidence**

---

## 0. Environment isolation — RESOLVED

The original isolation failure (staging == production ref) was resolved during
this phase:

- A **separate staging Supabase project** was created: `ledgr-staging`
  (ref `bkxzgkurcqvccsdjmqzg`; production remains `hsuhuvuxfuufrlejsatw`).
- GitHub variables/secrets updated (`SUPABASE_PROJECT_REF_STAGING`,
  `VITE_SUPABASE_URL_STAGING`, `SUPABASE_DB_PASSWORD_STAGING`,
  `VITE_SUPABASE_ANON_KEY_STAGING`; `_PROD` untouched).
- The staging database was bootstrapped **from the repository migrations**
  (after the base migration and a RAISE-format fix were merged to `main`):
  `supabase db push --include-all` applied all 55 migrations.

## 1. Staging database captured — **PASS**

Read-only capture via the Supabase Management API
(`scripts/database/capture-staging-schema-via-api.sh` in GitHub Actions):
**26/26 queries succeeded** → 25 artifacts + capture log, committed to
`artifacts/database/capture/` on `main` (commit `303b849`). Includes
`pg_get_functiondef` for all 71 functions, `pg_get_viewdef` for all 3 views,
all 102 policies with USING/WITH CHECK expressions, RLS status, grants, roles,
storage, cron, `SHOW server_version`.

## 2. PostgreSQL version verified — **PASS**

Live: **17.6**. `supabase/config.toml` `major_version = 17` confirmed correct.
(The disposable replay used 18.4; all 55 migrations apply on both.)

## 3. Complete schema inventory — **PASS**

`artifacts/database/staging-schema-inventory.json` +
`docs/database/staging-schema-inventory.md` rebuilt **from the live capture**:
65 tables, 16 enums, 71 functions, 3 views, 195 FKs, 11 triggers, 102
policies, 3 cron jobs, grants, roles, storage (0 buckets), extensions.
Builder: `scripts/database/build-live-inventory.py` (reproducible).

## 4. Schema drift reconciled — **PASS**

`docs/database/schema-drift-reconciliation.md` (live-verified):
- **MATCH:** all 65 tables, 16 enums, 195 FKs, 11 triggers, 3 cron jobs,
  extensions, defaults — live staging is byte-for-byte the repository replay.
- **CONFIRMED GAPS (exist only on the legacy/production DB):** 9 RPCs, 4
  views, RLS policies for 30 tables, storage buckets.

## 5. Base migration created — **PASS**

`supabase/migrations/20250101000000_base_schema.sql` — merged to `main` via
PR #92. Every `[INFERRED]` marker was **validated correct** by the live
capture (e.g. `audit_log.id` bigint+sequence, `issue_date`/`due_date`/`rate_date`
= date, `exchange_rate` = numeric(20,10), enum label orders).

## 6. Existing migrations replay successfully — **PASS**

55/55 replay on the disposable PostgreSQL; **and** all 55 applied to the live
staging database. Two migration bugs were found and fixed in source (never in
the DB):
- base migration missing from `main` (ordering guard) → PR #92
- `RAISE ... , p_amount` without format placeholder (SQLSTATE 42601) in
  `20260813000001` → PR #93

## 7. Fresh database created without manual objects — **PASS**

Fresh DB built only from repository migrations + documented Supabase-platform
stubs (auth/storage/pg_cron/pg_net). No application object was created by hand
(including on the live staging bootstrap — `supabase db push --include-all`).

## 8. Fresh database matches staging — **PASS (within repository scope)**

Live capture vs. fresh replay: **65/65 tables, 16/16 enums, 195/195 FKs,
11/11 triggers, 3/3 cron jobs, extensions — identical. No unexpected
differences.** The only differences are the known gaps (below), which are
absent from BOTH fresh and staging (they exist only on the legacy DB).

## 9. Functions/RPCs reproducible — **PARTIAL**

- ✅ 71/71 functions on live staging are reproduced by the repository (all
  migration-created + `pg_trgm` extension family).
- ❌ **9 app RPCs are missing from the repository AND from live staging**:
  `accept_invitation`, `create_business_with_owner`, `current_user_role`,
  `get_enum_values`, `get_user_role`, `invite_member`, `log_manual_audit_event`,
  `seed_new_business`, `verify_audit_chain`. Signatures known (generated
  types); bodies exist only on the legacy/production DB, which Phase 8A.1 may
  not inspect. **Impact:** `create_business_with_owner` is the primary
  business-creation path — a fresh environment cannot onboard businesses
  until this is resolved.

## 10. Triggers reproducible — **PASS**

11/11 live triggers match the repository (all migration-created). No
out-of-band triggers exist.

## 11. RLS policies reproducible — **PARTIAL (CRITICAL GAP)**

- ✅ 102 policies on 35 tables reproduced exactly (accounts 6, master data
  5×5, payroll 4×5, fixed assets 5×3, businesses 5, exchange_rates 2,
  partner/webhook/tax/loan/etc.).
- ❌ **30 tables have RLS enabled with ZERO policies (deny-all)** — including
  `invoices`, `journal_entries`, `journal_lines`, `expenses`, `stock_*`,
  `products`, `budgets`, `bank_statements`, `audit_log`, `business_users`,
  `user_profiles`, `profiles`, `paye_bands`, `tax_configurations`,
  `accounting_periods`. The legacy DB's policies for these were out-of-band
  (never migrated). Phase 8A.1 preserves observed state (per phase rules) and
  does not fabricate policies; **reconstruction is Phase 8B scope and is
  required before the app can function on a fresh environment.**

## 12. Storage reproducible — **PARTIAL**

0 buckets / 0 storage policies on live staging (dashboard-created on the
legacy DB; absent from fresh). Recreate per environment (`business-logos`
public, `user-exports` private) — documented in `database-operations.md`.

## 13. Type generation — **PARTIAL**

- `database.generated.ts` (from the legacy DB) was **not overwritten**.
- Approximate types regenerated from the fresh replay (mirrors live staging):
  `artifacts/database/fresh-database.generated.approx.ts` (65 tables, 16
  enums).
- Exact regeneration command for whoever has network access:
  ```bash
  supabase gen types typescript --db-url "postgresql://postgres:<pw>@db.bkxzgkurcqvccsdjmqzg.supabase.co:5432/postgres" > src/dal/types/database.generated.ts
  ```
  then move the 10 supplement entries + 6 untyped tables into the generated
  file and delete the supplement (or keep it until the regeneration lands).

## 14. Tests — **PASS**

`npm run typecheck` ✅ · `npm run lint` ✅ · `npm run test` (202) ✅ ·
`npm run build` ✅. (`db:validate*` scripts still not defined in
`package.json`; `supabase db diff --local` requires Docker — documented.)

## 15. Remaining gaps

| ID | Object | Problem | Risk | Recommended action |
|---|---|---|---|---|
| G-01 | `create_business_with_owner` | Body not in repo or staging; primary onboarding path | Fresh env cannot create businesses | Separately authorized read-only capture from production, or reconstruct from app code (next phase) |
| G-02 | `accept_invitation`, `invite_member` | Bodies missing; legacy fallbacks in app | Team invites degrade | Same as G-01 |
| G-03 | `current_user_role`, `get_user_role` | Bodies missing; used by period/journal repos | Role lookups degrade | Same as G-01 |
| G-04 | `get_enum_values` | Body missing; settings UI | Enum dropdowns degrade | Same as G-01 |
| G-05 | `log_manual_audit_event`, `verify_audit_chain` | Bodies missing; audit trail | Manual audit events/chain verification unavailable | Same as G-01; verify chain in Phase 8B |
| G-06 | `seed_new_business` | Body missing | New-business setup incomplete | Same as G-01 |
| G-07 | `v_ar_ageing`, `v_asset_register`, `v_reorder_alerts`, `v_trial_balance` | View bodies missing | AR ageing/asset register/reorder/trial-balance reports break | Same as G-01 (`pg_get_viewdef` from production or reconstruction) |
| G-08 | RLS policies for 30 tables (deny-all) | Policies never migrated; app non-functional on fresh env | **All core flows (invoices, journals, expenses, stock, memberships) return zero rows** | Phase 8B: reconstruct policies from app access patterns + captured legacy behavior, apply as migration, test |
| G-09 | Storage buckets + policies | Dashboard-created; absent on fresh | Logos/exports broken on fresh env | Per-env creation procedure (documented) |
| G-10 | `database.generated.ts` staleness | File reflects legacy DB | Type drift | Regenerate from staging (command above), migrate supplement |
| G-11 | `db:validate*` scripts / Docker-based diffs | Not available in this environment | Validation story incomplete | Add scripts; run `supabase db diff --local` where Docker exists |
| G-12 | Production out-of-band objects | 9 RPCs/4 views/30 policy sets/storage exist only in production | Single point of truth outside version control | After Phase 8B, plan production capture + migration promotion |

---

## Final status

## 🟡 YELLOW — Major progress; reproducibility verified; known gaps confirmed

Chosen because:

- The phase's core test **passed with live evidence**: a fresh database built
  only from repository migrations **matches the live staging database 1:1**
  (65/65 tables, 16/16 enums, 195/195 FKs, 11/11 triggers, 3/3 cron,
  extensions, version 17.6). **No unexpected differences.**
- The base migration is merged, the deploy pipeline works end-to-end on the
  new staging project, and two latent migration bugs were found and fixed.
- GREEN is **not** claimed because the **app-critical objects are not
  reproducible**: 9 RPCs (incl. the sole business-creation path), 4 views,
  RLS policies for 30 tables, and storage buckets exist only on the
  legacy/production database, which Phase 8A.1 was not permitted to inspect.
  A fresh environment cannot run the app until those are reconstructed
  (Phase 8B / next sub-phase).

**Phase 8B (RLS penetration testing) may begin once the RLS policy gap
(G-08) is addressed — the current deny-all state is itself the baseline to
test, but the missing policies must be reconstructed first for the app to be
exercisable.**
