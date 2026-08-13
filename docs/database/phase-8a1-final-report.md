# Phase 8A.1 Final Report — Authoritative Staging Schema Capture & Baseline Reconstruction

**Date:** 2026-08-13
**Branch:** `arena/019ffae7-ledgr-react`
**Phase status:** ⚠️ **RED — Baseline cannot currently be reconstructed safely**
(see §Final Status for the precise reasoning and what unblocks it)

---

## 0. Environment isolation report (Step 1 — VERIFY ENVIRONMENT)

The phase requires verifying `LEDGR_ENV=staging` and that the staging ref
differs from the production ref **before any connection**. Verification
**FAILED** in this sandbox:

| Check | Result |
|---|---|
| `LEDGR_ENV` | **not set** anywhere in the sandbox (no `.env`, no exported vars) |
| `STAGING_SUPABASE_PROJECT_REF` / `PRODUCTION_SUPABASE_PROJECT_REF` | **not set**; the GitHub Actions *variables* that hold them are **not readable** by this session's token (`gh api .../actions/variables` → HTTP 403 "Resource not accessible by integration") |
| DB password / service-role key / access token | **not present** (`~/.supabase/access-token` absent; no `.env`; GitHub *secrets* are write-only and unreadable by design) |
| Network to Supabase | **blocked** — `https://supabase.co` and `https://api.supabase.com` fail with SSL/SYSCALL errors; only GitHub and npm registries are reachable |
| `scripts/database/capture-staging-schema.sh` | **did not exist** in the repository — created during this phase (§1) |
| Phase 8A discovery artifacts (operations doc, schema inventory, drift report, 8A report) | **absent** from this checkout — re-produced from evidence in this phase |

**Conclusion: the environment isolation check could not be satisfied, so no
connection to any hosted database was attempted.** Production was never
touched. Staging was never touched. No credentials were requested or stored.
Per the phase's own rule ("Report the environment isolation failure"), the
live-capture chain (Steps 2–3) is reported **FAIL** below, and the remainder
of the phase was executed against the strongest available evidence.

---

## 1. Staging database captured — **FAIL**

Live read-only capture was impossible (see §0). As the phase's capture tooling
was referenced but missing, it was **created** and is ready to run once access
exists:

- `scripts/database/capture-staging-schema.sh` — env-guarded (refuses to run
  unless `LEDGR_ENV=staging`, refs set and distinct, URL host matches the
  staging ref), read-only (SELECT/SHOW/pg_get_*def only), redacts JWTs, keys,
  tokens and passwords from artifacts, writes raw evidence into
  `artifacts/database/capture/`.
- `scripts/database/capture-staging-schema.sql` — the exact read-only query
  set (schemas, extensions, enums, domains, tables+columns+defaults, generated
  and identity columns, PKs, FKs, uniques, checks, indexes, sequences, views,
  matviews, functions via `pg_get_functiondef`, triggers via
  `pg_get_triggerdef`, RLS status, policies, grants, roles, storage buckets and
  policies, cron jobs).

**Substitute evidence used** (explicitly labelled, not certified):
`src/dal/types/database.generated.ts` — produced from the live staging
database via `supabase gen types` (PostgREST 14.5) — plus all migrations,
`database.supplement.ts`, edge functions, DAL repositories, diagnostic SQL.

## 2. PostgreSQL version verified — **FAIL**

`SHOW server_version` requires live capture. The staging version is
**UNVERIFIED**. `supabase/config.toml` (created this phase, previously absent)
defaults `major_version = 17` (current Supabase CLI default) and documents that
it must be confirmed against staging. The disposable replay used PostgreSQL
**18.4** (embedded-postgres) — all migrations replay on it, but version parity
with staging is not established.

## 3. Complete schema inventory — **PASS** (evidence-based)

- `artifacts/database/staging-schema-inventory.json` — machine-readable
  inventory of every evidenced object with confidence markers.
- `docs/database/staging-schema-inventory.md` — human-readable inventory:
  **50 tables** (39 base), **16 enums** (12 base, label orders included),
  **14 functions** (11 base), **5 views** (4 base), extensions, storage
  buckets, cron jobs, and every evidenced constraint/FK/default.
- All **167 foreign keys** from the live-staging-derived types are captured
  with their exact constraint names.

## 4. Schema drift reconciled — **PASS**

`docs/database/schema-drift-reconciliation.md` classifies every object:

- **MISSING FROM REPOSITORY:** 39 base tables, 12 base enums, 9 base RPC
  bodies (+2 resolved to `pg_trgm`), 4 base view bodies.
- **MISSING FROM STAGING (per generated types):** 15 migration-created tables
  and several migration-added column groups (bank reconciliation, IAS21) —
  consistent with stale generated types **or** divergent staging migration
  history (both hypotheses documented).
- **DIFFERENT:** `user_profiles.preferred_language` nullability conflict;
  `loans`/`loan_repayments`/`share_transactions` FK sets; `audit_log.id`
  identity mechanism.
- **UNKNOWN:** RLS policies on 23 base tables, storage limits/policies,
  exact numeric precisions marked `[INFERRED]`.

The Phase 8A discovery estimates (39 tables / 12 enums / 9 RPCs / 4 views)
were re-derived from evidence and are **confirmed** (39/12), with the RPC
count refined to 9 app RPCs + 2 `pg_trgm` extension functions.

## 5. Base migration created — **PASS**

`supabase/migrations/20250101000000_base_schema.sql` (sorts before all
incremental migrations):

- 12 base enums with live label order; `pg_trgm` extension (evidenced by
  `show_limit`/`show_trgm` in the staging-derived function list);
- **40 tables** (39 base + `currencies`, which 13 base FKs require; the IAS21
  migration's `CREATE TABLE IF NOT EXISTS` makes replay deterministic);
- columns with types/nullability/defaults, exact FK constraint names, the
  evidenced unique constraints (`business_users(business_id,user_id)`,
  `inventory_balances(business_id,product_id,location_id)`) and evidenced
  check constraints;
- RLS enabled on every base table; **no policies fabricated**;
- every `[INFERRED]` item is commented for live verification; nothing was
  invented to satisfy validation.

Accounting structures (journal debit/credit, invoice/payment/inventory/
payroll/tax relationships, counters, audit hash chain) were preserved exactly
as evidenced — nothing "improved" (§7 of the phase).

## 6. Existing migrations replay successfully — **PASS**

A disposable PostgreSQL 18.4 was created with `embedded-postgres` (no Docker
in the sandbox), Supabase-managed objects stubbed (`auth.users`,
`auth.uid()`, `auth.role()`, `storage.buckets`/`objects`, stub `pg_cron` and
`pg_net`), and **all 51 migrations** (base + 50 incremental) replayed in
filename order, stopping at the first failure and fixing the **migration
source** (never the database) on each iteration. Result:

```
ALL 51 MIGRATIONS REPLAYED SUCCESSFULLY
```

## 7. Fresh database created without manual objects — **PASS**

The fresh database was created only from the repository migrations plus the
declared, documented stubs for Supabase-managed platform objects (auth/
storage/pg_cron/pg_net). No application object was created by hand at any
point.

## 8. Fresh database matches staging — **PARTIAL**

`docs/database/fresh-database-comparison.md` + machine-readable
`artifacts/database/fresh-database-comparison.json`:

- ✅ 50/50 staging-evidenced tables present in fresh; all 167 evidenced FKs
  present (constraint names included); **16/16 enums identical** (labels and
  order).
- ✅ Every object the incremental migrations define is present.
- ⚠️ **9 base RPC bodies** and **4 base view bodies** missing from fresh —
  bodies exist only in the live database.
- ⚠️ RLS policies on 23 base tables not evidenced (fresh has RLS enabled but
  only the migration-owned policy sets).
- ⚠️ Migration-added columns (bank recon, IAS21) exist in fresh but not in
  the (older) generated types — EXPECTED if types are stale, UNEXPECTED if
  staging diverged; live capture decides.
- ⚠️ `loans`/`loan_repayments`/`share_transactions` carry 4 FKs each in fresh
  but none in staging evidence — UNKNOWN until live capture.
- ⚠️ Storage buckets/policies and cron job rows are environment configuration,
  not in migrations.

**Target `NO UNEXPECTED DIFFERENCES` is NOT met** — remaining differences are
known gaps that require the live read-only capture.

## 9. Functions/RPCs reproducible — **PARTIAL**

- ✅ All 90+ migration-created functions reproduce (fresh has 106 functions
  including `pg_trgm` helpers).
- ✅ `show_limit`/`show_trgm` — proven to be `pg_trgm` extension functions
  (verified against real PG 18); closed by adding `pg_trgm` to the base
  migration.
- ❌ **9 app RPC bodies** are not in the repository: `accept_invitation`,
  `create_business_with_owner`, `current_user_role`, `get_enum_values`,
  `get_user_role`, `invite_member`, `log_manual_audit_event`,
  `seed_new_business`, `verify_audit_chain`. Signatures, arg names and return
  types are known (generated types + call sites); bodies require
  `pg_get_functiondef` from staging. Not fabricated (phase safety rule).

## 10. Triggers reproducible — **PARTIAL**

- ✅ All triggers defined in migrations reproduce
  (`bank_line_locked_guard`, `trg_enforce_plan_tier_change`,
  `trg_prevent_functional_currency_change`, `trg_tax_returns_updated_at`,
  `trg_subscription_payments_updated_at`, partner triggers, …).
- ⚠️ Base-table triggers that are not declared in any migration (e.g.
  `updated_at` triggers on base tables such as `invoices`, if any exist on
  staging) are **UNKNOWN** — live capture required.

## 11. RLS policies reproducible — **PARTIAL**

- ✅ Policy sets rebuilt by migrations reproduce verbatim: accounts (6),
  businesses (6), contacts/branches/departments/inventory_locations (5 each),
  employees/employee_allowances/employee_deductions/payroll_runs/
  payroll_employee_lines (4 each), asset_categories/fixed_assets/
  depreciation_schedules (5 each), exchange_rates (2).
- ⚠️ Policies on the remaining 23 base tables exist on staging but are not
  evidenced anywhere in the repository. The repository itself contains a
  flagged assumption that master-data policy expressions were inferred
  (20260728000008 header). No policies were fabricated in the base migration.
  RLS penetration testing (Phase 8B) must not start until these are captured.

## 12. Storage reproducible — **PARTIAL**

- Buckets documented with visibility from code evidence:
  `business-logos` (public, client `getPublicUrl`), `user-exports` (private,
  service-role upload + signed URLs).
- Buckets/policies are dashboard-created and **not declared in migrations**;
  size limits, MIME restrictions and storage policies are **UNKNOWN**.
  Recreate per environment with the procedure in
  `docs/database/database-operations.md`; verify against live capture before
  Phase 8B.

## 13. Type generation — **PARTIAL**

- `database.generated.ts` was **not overwritten**: it is the primary live
  staging evidence and regenerating it from the fresh DB would destroy the
  only evidence of staging's actual shape.
- Types were regenerated **from the fresh database**
  (`artifacts/database/fresh-database.generated.approx.ts`; the CLI's
  `gen types --db-url` needs Docker, so the regeneration is a documented
  structural approximation) and compared: all 65 fresh tables and 16 enums
  map cleanly; the only differences are the known gaps above.
- **Supplement analysis** (`database.supplement.ts`): all 10 supplemented
  objects (`api_keys`, `api_usage`, `webhooks`, `webhook_deliveries`,
  `partners`, `partner_feature_flags`, `partner_clients`, `partner_admins`,
  `partner_invoices`, `v_partner_client_usage`) exist in the fresh DB and
  would be generated by a refreshed `gen types` run. **They remain in the
  supplement deliberately**: the generated file must not be refreshed until a
  live-verified regeneration is possible (otherwise unverifiable drift is
  introduced). Each entry's migration source is identified in the supplement
  header; the merge mechanism in `database.ts` is unchanged.
- 6 further tables used via untyped casts (`ai_insights_usage`,
  `business_terms_acceptances`, `invoice_delivery_events`,
  `recurring_invoices`, `subscription_reminders_sent`,
  `support_agent_usage`) also exist in fresh and should be picked up by the
  same future regeneration.

## 14. Tests — **PASS**

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run lint` | ✅ PASS (3 errors were in the new artifact TS file; fixed with an artifact header — source tree is clean) |
| `npm run test` | ✅ PASS (24 files, 202 tests) |
| `npm run build` | ✅ PASS |
| `npm run db:validate` / `db:validate:strict` | ⚠️ **scripts do not exist in `package.json`** (referenced by the phase; documented in `database-operations.md` as a follow-up) |
| `npx supabase db diff --local` | ⚠️ **not runnable** — requires Docker (absent). Substituted by the catalog-dump comparison (Step 8) |

---

## 15. Remaining gaps

| ID | Object | Problem | Risk | Recommended action |
|---|---|---|---|---|
| G-01 | Live staging capture | No credentials/network in sandbox; env isolation unverifiable | Baseline cannot be certified; everything below stays unverifiable | Configure credentials (`LEDGR_ENV`, refs, `STAGING_SUPABASE_DB_URL`) or run `scripts/database/capture-staging-schema.sh` from an environment with access; reconcile inventory |
| G-02 | PostgreSQL version | `SHOW server_version` unverified | `config.toml`/CI version mismatch; migration behavior could differ | Run capture; set `supabase/config.toml [db] major_version` to the verified value |
| G-03 | `accept_invitation` | Body not in repo; used by invite flows | New-business onboarding broken on a fresh DB | Capture `pg_get_functiondef`; promote body into a new migration |
| G-04 | `create_business_with_owner` | Body not in repo; **entry point for every new business** | Fresh DB cannot onboard businesses | Same as G-03 |
| G-05 | `invite_member` | Body not in repo; legacy invite fallback | Team invites degrade | Same as G-03 |
| G-06 | `seed_new_business` | Body not in repo | New-business setup incomplete | Same as G-03 |
| G-07 | `current_user_role` / `get_user_role` | Bodies not in repo; used by period/journal repos | Role checks fall back to RLS functions only | Same as G-03 |
| G-08 | `get_enum_values` | Body not in repo; settings UI | Enum dropdowns degrade | Same as G-03 |
| G-09 | `log_manual_audit_event` / `verify_audit_chain` | Bodies not in repo; audit trail integrity | Manual audit events and chain verification unavailable | Same as G-03; verify hash-chain behaviour in Phase 8B |
| G-10 | `v_ar_ageing` | View body not in repo | AR ageing reports break on fresh DB | Capture `pg_get_viewdef`; promote into migration |
| G-11 | `v_asset_register` | View body not in repo | Asset register reports break | Same as G-10 |
| G-12 | `v_reorder_alerts` | View body not in repo | Reorder alerts break | Same as G-10 |
| G-13 | `v_trial_balance` | View body not in repo | Trial balance reports break | Same as G-10 |
| G-14 | RLS policies on 23 base tables | Not evidenced in repo; RLS enabled but policies absent on fresh | Authenticated app access to those tables denied on fresh DB; Phase 8B untestable | Capture `pg_policies` from staging; promote policies into migration (do NOT redesign) |
| G-15 | `loans`/`loan_repayments`/`share_transactions` FKs | Fresh has 4 FKs each; staging evidence shows none | Unknown divergence between repo and staging | Confirm against live capture; align migration or evidence |
| G-16 | `user_profiles.preferred_language` | Generated types: nullable; migration: `not null default 'en'` | Nullability mismatch between fresh and staging | Confirm live; align base migration |
| G-17 | Base-table indexes / `updated_at` triggers | Not evidenced | Performance/behaviour drift on fresh DB | Capture `pg_indexes` + `pg_trigger`; add to migration |
| G-18 | Storage buckets + policies | Dashboard-created; limits/MIME unknown | Export/logos broken on fresh env | Document per-env creation; capture `storage.buckets`/`pg_policies` |
| G-19 | Cron job rows | Placeholders `<PROJECT_REF>`/`<CRON_SECRET>`; stub-only in replay | Recurring jobs (subscriptions, reminders, partner invoices) not running on fresh env | Keep as env config; document substitution (done in `database-operations.md`) |
| G-20 | `npm run db:validate*` | Scripts referenced by phase but undefined | Validation story incomplete | Add `db:validate`/`db:validate:strict` scripts (requires CLI+Docker) |
| G-21 | Staging migration-history divergence | generated.ts lacks objects from 20260725000000/25000001/26000004(part)/27000000 | Unknown whether staging == repository replay | Compare `pg_dump`/capture vs fresh dump; decide stale-types vs divergent-history |

---

## Final status

## 🔴 RED — Baseline cannot currently be reconstructed safely

Chosen deliberately, per the phase's own rule: **do not claim GREEN** unless a
fresh database has actually been created from repository migrations **and**
compared against staging. That comparison happened (Step 8) and shows
**UNEXPECTED/UNKNOWN differences**: nine RPC bodies and four view bodies are
unreconstructable from the repository, RLS policies on 23 base tables are
un-evidenced, and live staging could not be captured at all.

What was achieved (substantial, replayable progress):
- 51/51 migrations (base + incremental) replay cleanly on a disposable DB;
- 50/50 evidenced tables, 167/167 FKs, 16/16 enums match the staging-derived
  evidence;
- the base migration is deterministic, ordered, version-controlled and safe
  to apply to a fresh disposable database.

What keeps the phase RED (all mechanical once access exists):
1. Run `scripts/database/capture-staging-schema.sh` against staging.
2. Transcribe the 9 RPC bodies (`pg_get_functiondef`) and 4 view bodies
   (`pg_get_viewdef`) into new migrations.
3. Promote captured RLS policies (unchanged) for the 23 uncovered tables.
4. Re-run the replay + comparison; regenerate `database.generated.ts` from
   **staging**; then migrate the supplement entries into it.

**Phase 8B (RLS penetration testing) must NOT begin** until the baseline is
reproducible and the fresh database matches staging with no unexpected
differences. Seed creation (next sub-phase) also waits for items 1–4.
