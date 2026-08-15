# Ledgr — Fresh Database Comparison (Phase 8A.1) — LIVE-VERIFIED

> **Status: LIVE-VERIFIED.** The disposable fresh database (PostgreSQL replay
> of all 55 repository migrations) is compared against the **live staging
> database** (captured read-only via the Management API on 2026-08-15).
> Target: `NO UNEXPECTED DIFFERENCES`.

## Method

1. Disposable PostgreSQL 18.4 (`embedded-postgres`, no Docker in the sandbox)
   with stubs for Supabase-managed objects (auth, storage, pg_cron, pg_net).
2. All **55 repository migrations** (base `20250101000000` + 54 incremental)
   replayed in order, stopping at the first failure; all failures were fixed
   in the migration sources (RAISE-format bug → PR #93), never in the DB.
3. The **live staging database** (project `bkxzgkurcqvccsdjmqzg`, created
   fresh from the same migrations) was captured read-only.
4. Fresh dump vs. live capture compared object-by-object.

## Result: table/enum/FK/trigger/cron parity

| Object | Fresh replay | Live staging | Verdict |
|---|---|---|---|
| Tables | 65 | 65 | ✅ identical |
| Enums | 16 | 16 | ✅ identical labels & order |
| Foreign keys | 195 | 195 | ✅ identical definitions |
| Triggers | 11 | 11 | ✅ identical |
| Cron jobs | 3 | 3 | ✅ identical |
| Extensions | pg_trgm/pgcrypto/pg_cron/pg_net + platform | same | ✅ |
| PostgreSQL version | 18.4 (replay) | **17.6** (live) | ⚠️ version difference is EXPECTED (replay host vs Supabase); all SQL is compatible (55/55 applied on both) |
| Generated columns | 5 `exchange_rate_used` | 5 | ✅ |
| `audit_log.id` | bigint + seq default | bigint + `audit_log_id_seq` | ✅ |

## Confirmed differences (all EXPECTED / KNOWN GAPS — none unexpected)

| Difference | Classification | Evidence |
|---|---|---|
| 9 RPCs absent from both fresh and staging (`accept_invitation`, `create_business_with_owner`, `current_user_role`, `get_enum_values`, `get_user_role`, `invite_member`, `log_manual_audit_event`, `seed_new_business`, `verify_audit_chain`) | **EXPECTED (known gap)** — bodies were never version-controlled; exist only on the legacy/production DB | live `functions` capture (71 functions, none of the 9) |
| 4 views absent from both (`v_ar_ageing`, `v_asset_register`, `v_reorder_alerts`, `v_trial_balance`) | **EXPECTED (known gap)** — bodies never version-controlled | live `views` capture (3 views) |
| RLS policies: 30 tables with RLS enabled and **no policies** (deny-all), incl. core financial + membership tables | **EXPECTED (known gap)** — legacy DB's policies were out-of-band; Phase 8A.1 preserves observed state; reconstruction is Phase 8B scope | live `rls` + `policies` capture (102 policies on 35 tables; 30 tables none) |
| Storage buckets: 0 on staging (vs `business-logos`/`user-exports` on legacy) | **EXPECTED (known gap)** — dashboard-created, not in migrations; recreate per environment | live `storage_buckets` capture |
| `database.generated.ts` (generated from the legacy DB) lists 50 tables/14 functions/5 views | **EXPECTED** — the generated file reflects the legacy DB, not the fresh/staging DB; regenerate from staging when access allows | types diff |

## Bottom line

**The repository is now reproducible and verified end-to-end:** a fresh
database built only from the repository migrations matches the live staging
database 1:1 on every object the repository defines (tables, enums, FKs,
triggers, cron, extensions). The only differences are the **known gaps** —
objects that were never version-controlled and exist only on the legacy
(production) database. **No unexpected differences remain** within the scope
of what the repository can express.

The Phase 8A.1 gate for GREEN additionally requires the app-critical missing
objects (RPCs, views, policies) to be reproducible; that requires either a
separately authorized read-only capture from production or reconstruction
from application code (next phase). Until then the phase status is YELLOW.

## Artifacts

- Live capture: `artifacts/database/capture/*`
- Live inventory: `artifacts/database/staging-schema-inventory.json`
- Fresh replay schema: `artifacts/database/fresh-schema.json`
- Fresh types approximation: `artifacts/database/fresh-database.generated.approx.ts`
- Comparison data: `artifacts/database/fresh-database-comparison.json`
