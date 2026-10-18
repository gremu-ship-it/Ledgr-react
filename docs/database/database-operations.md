# Ledgr — Database Operations (Phase 8A.1)

Operational runbook for the Ledgr Supabase databases (staging and production),
updated with the Phase 8A.1 baseline findings. Covers how the database is
migrated, verified, backed up, and how environment-specific configuration
(cron secrets, storage) is reproduced.

## 1. Environments

| Environment | Supabase project | DB URL pattern | Used by |
|---|---|---|---|
| Staging | `ledgr-staging` (ref in GitHub var `SUPABASE_PROJECT_REF_STAGING`) | `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` | deploy.yml on push to `main` |
| Production | `ledgr-production` (ref in GitHub var `SUPABASE_PROJECT_REF_PROD`) | same pattern | deploy.yml on `v*` tags (manual approval) |

**Isolation rule (Phase 8A.1):** staging and production are separate projects.
Every database interaction during Phase 8A/8B must target staging only; the
capture script refuses to run unless `LEDGR_ENV=staging` and the refs are
distinct.

## 2. Migration workflow

Migrations live in `supabase/migrations/` and are applied by CI:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db push --password "$SUPABASE_DB_PASSWORD"
```

Local full replay (disposable database):

```bash
supabase db reset        # requires Docker + config.toml (see below)
```

Phase 8A.1 added the missing **base migration**
(`20250101000000_base_schema.sql`) that must sort before all incremental
migrations. Replay order is therefore:

```
20250101000000_base_schema.sql
20250724_api_usage.sql
20260708000000_tax_compliance_module.sql
… (all incremental migrations in filename order)
```

### Rules

- Never edit an applied migration. Add a new one.
- `supabase db reset` must succeed with **zero manual object creation**; if it
  fails, fix the migration source, not the database.
- After any schema change, regenerate types **from staging** — the project
  built from these migrations (`SUPABASE_PROJECT_REF_STAGING`, currently
  `bkxzgkurcqvccsdjmqzg`):

  ```bash
  npx supabase gen types typescript \
    --project-id "$SUPABASE_PROJECT_REF_STAGING" \
    > src/dal/types/database.generated.ts
  ```

  **Never generate from production** (`hsuhuvuxfuufrlejsatw`). Production is
  the *legacy* project (`schema-drift-reconciliation.md` §2): it still carries
  table shapes, and out-of-band objects, that these migrations do not express.
  Generating from it reintroduces them — on 2026-10-07 that is exactly what
  happened, and `npm run typecheck` failed with five errors on `api_keys`,
  `webhooks` and `webhook_deliveries` (see §9.8). Where production and the
  migrations disagree, the migrations are the contract: repair the database,
  not the generated types. Re-run `npm run typecheck` after every
  regeneration; a failure means the source was wrong or an environment is
  drifted.

  Then verify the regenerated file against the pre-implementation gate's
  schema truth before committing it:

  ```bash
  node scripts/ci/verify-regenerated-types.mjs src/dal/types/database.generated.ts
  ```

  The script requires the file to surface the full migration chain (79
  tables, 21 views, 131 application functions, 16 enums with their catalog
  labels, and the 9 column-drift columns on their 5 tables — the gate §5.3
  checklist, with the gate's own "88 functions / 9 enums" counts corrected to
  90 / 0; see the script header) and prints the file's SHA-256 for the record.
  It is deliberately not wired into CI: the tracked file is stale until the
  regeneration chore PR lands.

## 3. Replaying migrations without Docker

The sandbox that produced the Phase 8A.1 baseline had no Docker, so a
disposable PostgreSQL 18.4 was run via `embedded-postgres` (npm) with stubs for
Supabase-managed objects. Procedure (recorded for reproducibility):

1. `npm i embedded-postgres` (platform binaries via `@embedded-postgres/linux-x64`).
2. Bootstrap: roles (`anon`, `authenticated`, `service_role`), `auth.users`
   (+ `auth.uid()`/`auth.role()`), `storage.buckets`/`storage.objects`, stub
   `pg_cron` and `pg_net` extensions, `pgcrypto` + `pg_trgm` extensions,
   Supabase default grants (`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
   authenticated, service_role`).
3. Apply `supabase/migrations/*.sql` in filename order with `ON_ERROR_STOP`.
4. Dump catalogs and compare (see `docs/database/fresh-database-comparison.md`).

The harness is not committed to the repository (sandbox-only); the capture
tooling that IS committed is `scripts/database/capture-staging-schema.sh`.

## 4. Read-only capture (Phase 8A.1)

```bash
LEDGR_ENV=staging \
STAGING_SUPABASE_PROJECT_REF=<ref> \
PRODUCTION_SUPABASE_PROJECT_REF=<ref> \
STAGING_SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
./scripts/database/capture-staging-schema.sh
```

- Issues only `SELECT`/`SHOW`/`pg_get_*def` statements (see
  `scripts/database/capture-staging-schema.sql` for the exact query set).
- Redacts JWTs, keys, tokens and passwords from captured artifacts.
- Writes raw evidence to `artifacts/database/capture/`; the authoritative
  inventory (`artifacts/database/staging-schema-inventory.json`) must then be
  rebuilt from that evidence and certified against this phase's evidence-based
  version.

**No-password variant (recommended):**
`scripts/database/capture-staging-schema-via-api.sh` performs the same capture
over the Supabase Management API
(`POST https://api.supabase.com/v1/projects/{ref}/database/query`) using
`SUPABASE_ACCESS_TOKEN` — the same token the deploy workflow already uses — so
**no database password is required**. Same isolation guards, same artifacts
(JSON + rendered `.txt` per query), same redaction, and it reports partial
failures instead of fabricating output. The GitHub Actions workflow
`.github/workflows/capture-staging-schema.yml` uses this variant.

## 5. Backup & restore

CI workflow `.github/workflows/backup-verify.yml` restores a logical dump into
a throwaway PostgreSQL 17 instance and runs verification. It reuses the existing
deployment configuration (`SUPABASE_ACCESS_TOKEN`, environment project ref, and
environment database password) to resolve the project's session-pooler endpoint;
it does **not** require a separate `SUPABASE_DB_URL_*` secret. Manual:

```bash
pg_dump "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require" -Fc -f ledgr-$(date +%F).dump
pg_restore --clean --if-exists -d fresh_db ledgr-$(date +%F).dump
```

## 6. Cron jobs and secrets (environment configuration)

Five `pg_cron` jobs are declared in migrations. Four call an Edge Function
over HTTP and ship with `<PROJECT_REF>` / `<CRON_SECRET>` placeholders; the
expiry sweep has run as plain SQL since 20261017000000:

| Job | Schedule | Declared in | Runs |
|---|---|---|---|
| `expire-subscriptions-daily` | `5 0 * * *` | 20260726000003, replaced by 20261017000000 §5 | in-database SQL (no placeholder) |
| `send-renewal-reminders-daily` | `0 8 * * *` | 20260726000005 | `send-renewal-reminders` (HTTP) |
| `generate-partner-invoices-monthly` | `0 2 1 * *` | 20260727000006 | `generate-partner-invoices` (HTTP) |
| `retry-failed-webhooks-daily` | `0 6 * * *` | 20260820000000 | `retry-failed-webhooks` (HTTP) |
| `finalize-account-deletions-daily` | `0 3 * * *` | 20261019000000 (the job had existed on production, undeclared, since before that) | `finalize-account-deletions` (HTTP) |

`supabase db push` applies the placeholders verbatim, and 20261017000000 §3
deactivates any job still holding one (20261019000000 §2 repeats the guard for
jobs a later migration schedules). Every deploy then runs
`scripts/ci/apply-cron-jobs.sh` (deploy.yml, after the edge functions): it
applies `scripts/cron-jobs.sql` with the environment's project ref and
`CRON_SECRET` substituted, and fails the run unless no job anywhere still holds
a placeholder **and** every job `cron-jobs.sql` schedules is active. (Since
2026-10-14 a failure there no longer holds back the frontend deploy; the
release manifest reports it as `cronJobs`.)

Three rules follow from the 2026-10-14 staging and 2026-10-16 production incidents:

- **A migration that schedules an HTTP job with a placeholder needs a matching
  `cron.schedule()` in `scripts/cron-jobs.sql`**, plus the job name in its
  re-enable list. `retry-failed-webhooks-daily` was missing, so the check failed
  on every staging deploy from 2026-10-09 to 2026-10-14, and the frontend deploy
  behind it was skipped (MIXED-VERSION).
- **A job that exists only in the database is not declared anywhere, and
  nothing substitutes it.** `finalize-account-deletions-daily` was created
  out-of-band on production (the function header pointed at a
  `schedule_finalize_deletions.sql` that no branch ever contained), so it held
  unsubstituted placeholders and failed the production placeholder check on
  every deploy from 2026-10-16 while looking active in `cron.job`. 20261019000000
  adopts it under the same name and schedule; declare jobs in migrations, never
  by hand in the SQL editor.
- **`cron.schedule()` never re-enables a job.** It upserts on
  `(jobname, username)` and rewrites only schedule/command/database, so a job §3
  deactivated stays inactive after its URL is fixed — the placeholder check
  passes and the job never fires. `cron-jobs.sql` re-enables its jobs with
  `cron.alter_job(jobid, null, null, null, null, true)` and is the source of
  truth for their active flag: a job paused from the dashboard is re-enabled by
  the next deploy, so pause one durably in `cron-jobs.sql`.

`tests/database/cron_jobs_apply.test.js` replays every migration and runs the
real `apply-cron-jobs.sh` against a local stand-in for the Management API, so
both rules are proven on Postgres; `src/lib/__tests__/deployCronContracts.test.ts`
checks them statically in CI.

**No real secrets are embedded in migrations.** Recreating a fresh environment
requires: run migrations → set function secrets (`CRON_SECRET` included) → run
`scripts/ci/apply-cron-jobs.sh` (verify with the capture script's
`cron_jobs.txt`).

## 7. Storage buckets (environment configuration)

| Bucket | Visibility | Purpose | Evidence |
|---|---|---|---|
| `business-logos` | public (client `getPublicUrl`) | business logo uploads | src/pages/SettingsPage.tsx |
| `user-exports` | private (service-role upload, signed URLs) | GDPR/data export zips | supabase/functions/export-my-data/index.ts |

Buckets are dashboard-created and are **not** declared in migrations; recreate
them per environment (public for `business-logos`, private for `user-exports`)
and verify storage policies against staging before Phase 8B.

## 8. Validation commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Standalone database harnesses (embedded Postgres, not part of `npm test`):

```bash
node tests/database/posting_integrity_migrations.test.js     # posting integrity + quota guard
node tests/database/public_api_table_convergence.test.js     # legacy public-API tables + repair (§9.8)
node tests/database/cron_placeholder_sweep.test.js           # pg_cron privilege contract (§9.9)
node tests/database/cron_jobs_apply.test.js                  # deploy pg_cron step, end to end (§6)
```

`npm run db:validate` / `npm run db:validate:strict` are referenced by the Phase
8A.1 brief but are **not defined** in `package.json` — they should be added in a
later phase or invoked as: `supabase db lint` (needs Docker) and
`supabase db diff --local` (needs Docker). Without Docker, the comparison
procedure in `docs/database/fresh-database-comparison.md` (catalog dump vs
inventory) is the substitute.

## 9. Known operational gaps (from Phase 8A.1)

1. PostgreSQL server version of staging is unverified (`SHOW server_version`
   pending live capture); local replay used 18.4. Supabase defaults should be
   confirmed (`supabase/config.toml` `[db] major_version`).
2. Nine base RPC bodies and four view bodies exist only in the live database —
   they must be captured with `pg_get_functiondef` and promoted into migrations
   before the baseline is certified.
3. RLS policies on 23 base tables are not evidenced in the repository — capture
   `pg_policies` from staging and reconcile before Phase 8B.
4. Storage bucket size limits / MIME restrictions and storage policies are
   unverified.
5. `inventory_balances.quantity_available` is a **STORED GENERATED column**
   (`quantity_on_hand - quantity_reserved`) on the live project, but a plain
   nullable column in the repository's base schema. Any migration or function
   that maintains balances must therefore *omit* the column and let the database
   derive it, or branch on `pg_attribute.attgenerated` — PostgreSQL cannot
   convert an existing plain column into a generated one (`ALTER COLUMN ... ADD
   GENERATED ALWAYS AS` does not exist), so the two shapes have to be tolerated
   rather than normalised. Writing it is a hard error: `SQLSTATE 428C9 cannot
   insert a non-DEFAULT value into column "quantity_available"`.
   `20260924000001_fix_stock_movement_balance_trigger.sql` failed on production
   with exactly that until it stopped writing the column;
   `tests/database/stock_movement_balance_trigger.test.js` replays the
   current balance-trigger migration against both shapes so the next deploy
   cannot rediscover it.
6. **`stock_movements` is not a complete ledger of on-hand stock on
   production.** The 2026-09-24 deploy showed `sum(stock_movements.quantity)`
   netting to **-1829** for a live product: opening stock and older history
   were never written as movements. Consequences:
   * `inventory_balances` must be maintained as a **delta**
     (`balance += movement.quantity`), never recomputed as `sum(ledger)`.
     `20260925000001_stock_movement_balance_delta_trigger.sql` is the canonical
     writer; it also asserts that exactly one balance-maintaining trigger
     exists on `stock_movements` — production had carried two additive ones
     out-of-band (`trg_update_inventory_balance`,
     `trg_stock_movement_apply_balance`), which is what made a 10-unit receipt
     land as 20. `trg_stock_immutable`, also out-of-band, is deliberately kept.
   * `backfill_and_recalculate_inventory()` used to recompute a business's
     balances from the ledger — the last writer violating this rule — and was
     rejected by `chk_inventory_balances_on_hand_nonneg` on production when a
     customer clicked Warehouse → "Reconcile stock levels" (2026-09-24,
     proposed `on_hand = -3`). `20260926000001_fix_backfill_and_recalculate_inventory.sql`
     replaces it with a movements-only version: it backfills purchases, then
     records any shortfall between missing sales and on-hand stock as explicit
     `opening_balance` movements, then backfills the sales — every row applied
     by the canonical delta trigger, so no balance is ever rewritten or driven
     negative. `tests/database/backfill_reconcile_inventory.test.js` replays
     it against the production shape.
   * Any writer of `inventory_balances` must UPDATE first and INSERT only when
     the row is missing. `INSERT ... ON CONFLICT DO UPDATE` evaluates CHECK
     constraints on the *proposed* row before it finds the conflict, so a
     negative movement (every sale) trips the non-negative check even when the
     resulting balance is valid.
   * Balances the old double-count overstated are **not** rewritten by the
     migration — blanket repairs cannot tell an over-count from imported
     opening stock. `public.v_inventory_balance_ledger_drift` lists every
     `(business, product, location)` whose balance differs from its ledger.
     For a key you have confirmed is a pure double-count (all of its history is
     in the ledger, `difference` equals the duplicated quantity), correct the
     **balance row**, not the ledger — the movement was recorded once; posting
     an `adjustment_out` would leave the offset in the view forever and book a
     stock loss that never happened:
     ```sql
     update public.inventory_balances ib
        set quantity_on_hand = d.ledger_quantity, updated_at = now()
       from public.v_inventory_balance_ledger_drift d
      where d.business_id = ib.business_id and d.product_id = ib.product_id
        and d.location_id = ib.location_id
        and ib.product_id = '<product uuid>' and ib.location_id = '<location uuid>';
     ```
     Keys with a large positive `difference` and an old `last_ledger_movement_at`
     are pre-ledger opening stock; leave them alone.
7. **Posted-journal immutability vs keyed postings (2026-09-27).** A customer
   Receive Stock failed with `Database error in stock_movements: Cannot modify
   posted journal entry JNL-20260927-000403. Create a reversal instead.`
   Production enforces posted-entry immutability with an out-of-band guard
   (the same rule `JournalRepository.post` documents; GAP-2 in
   `docs/audits/LEDGR_DECISION_ARCHITECTURE_GATE_2026-09-22.md`), but the
   migration-chain keyed posters violated it: `_ledgr_post_entry_keyed`
   (20260923000000) and the COGS callers
   (`_ledgr_complete_pos_sale`, `record_sale_stock_and_cogs`,
   `ledgr_repair.apply_2026_09`) INSERTed entries already `status='posted'`
   and then UPDATEd the row to stamp `journal_entries.posting_key`. The guard
   rejected the UPDATE, so the receipt's single server transaction (H-3)
   rolled back entirely — no partial state was left, no data repair was
   needed; every retry just burned a fresh JNL number from the sequence.
   `20261015000000_posted_journal_posting_key_inline.sql` fixes the defect
   class: `posting_key` is now written with the INSERT that creates the entry
   (12-arg `_ledgr_post_entry` / 8-arg `_ledgr_post_cogs` overloads; the
   historical shapes delegate with a null key), so no posting path UPDATEs a
   posted journal entry any more. Release evidence:
   `H03.INVJ.POSTED-ENTRY-IMMUTABLE` and `H02.POS.POSTED-ENTRY-IMMUTABLE`
   replay a production-shaped immutability guard and prove receipts, POS
   sales and invoice COGS still post.

8. **Legacy public-API tables on production (2026-10-07).** `api_keys`,
   `webhooks` and `webhook_deliveries` pre-date
   `20260727000001_public_api_webhooks.sql` on production, so that migration's
   `create table if not exists` was a no-op there and the columns/defaults it
   declares never arrived. Staging (built from the migrations) is correct,
   which is why the drift only appears when types are generated from
   production: `npm run typecheck` then reported `webhooks.secret` as required
   on insert, `webhooks.last_triggered_at` and `webhook_deliveries.attempt` as
   non-existent, and `api_keys.created_at` as nullable. The consequences were
   runtime, not cosmetic:
   * the browser's `registerWebhook()` insert omits the signing secret on
     purpose (it must never be client-known), so without the database default
     it fails with 23502;
   * `webhook-dispatcher`'s delivery-log insert needs `attempt`, so delivery
     history is empty and `retry-failed-webhooks` (`.gte('attempt', 3)`) has
     nothing to retry;
   * the dispatcher's `last_triggered_at` update (and the same update in
     `supabase/functions/api`) fails, so "last delivery" is never recorded;
   * `api_keys` rows could exist with no creation timestamp.
   `20261018000000_repair_legacy_public_api_tables.sql` converges all three
   tables to the migration-declared shape (additive, idempotent, back-fills
   before every NOT NULL). Verify before/after with
   `scripts/diagnose-public-api-table-drift.sql` (per-column verdict, full
   column inventory, RLS/policy/grant check).
   `tests/database/public_api_table_convergence.test.js` reproduces the
   production shapes, replays the whole migration set on top of them, and
   asserts the result is column-for-column identical to a clean replay — so a
   repair that misses a column fails there instead of on the next regeneration.
   Residual: only the columns the generated types exposed are confirmed; the
   diagnostic script's §2 prints the full column inventory of the three tables
   in case production carries extra legacy columns the migrations never
   declared.

9. **pg_cron tables are not writable by the deploy role (2026-10-08).** A
   hosted `supabase db push` connects as a role that owns neither the pg_cron
   extension nor its tables. `cron.schedule` / `cron.unschedule` /
   `cron.alter_job` are `SECURITY DEFINER`, so they work; a raw
   `update cron.job …` does not:
   `20261017000000_subscription_expiry_enforcement.sql` §3 was the only
   statement in the whole migration set that wrote the table directly, and the
   production push aborted with `permission denied for table job`
   (SQLSTATE 42501). Because the push aborted, the migration was never recorded
   in `supabase_migrations.schema_migrations` — which also keeps
   `scripts/ci/verify-migration-target.sh` (and therefore the frontend deploy
   gate) closed, so this class of failure presents as *two* problems, not one.
   §3 now attempts the UPDATE and falls back to `cron.alter_job(…, active =>
   false)`; it deactivates, never deletes, so the job stays visible for an
   operator and the next `apply-cron-jobs.sh` overwrites it with real values.
   `tests/database/cron_placeholder_sweep.test.js` replays the migration set and
   re-runs §3 as a role holding only `SELECT` on `cron.job`, asserting the block
   completes and the job is deactivated rather than removed.
   **Rule for future migrations: never write `cron.job` (or any pg_cron table)
   directly — use the `cron.*` functions.**

   The release harness's pg_cron stub (`tests/release/bootstrap.sql`) mirrors
   the same contract: it provides `cron.schedule` / `cron.unschedule` /
   `cron.alter_job` with pg_cron 1.5+ semantics so the migration set replays
   without the extension installed. Keep the stub faithful to the real
   extension — when `20261017000000` first called `cron.unschedule`, the stub
   did not provide it and the entire release replay aborted (SQLSTATE 42883),
   blocking 621 database-backed records in `npm run test:release`. Likewise,
   the stub in `tests/database/cron_placeholder_sweep.test.js` re-activated an
   existing job on `cron.schedule`, which pg_cron never does; that is how the
   jobs §3 deactivated could stay inactive on staging with every test green
   (2026-10-14, §6). It now leaves `active` alone, like the extension.

   Note on process: this migration was **edited after it was merged**, which the
   §2 rule otherwise forbids. It is safe here because the change is confined to
   a best-effort deactivation guard, the edit is what makes the migration
   applicable at all (it could not run on hosted production in its merged form),
   and any environment that already recorded the version keeps its own applied
   state — `db push` skips recorded versions and only fresh replays see the
   revised text.

10. **Extension functions must be schema-qualified in migrations (2026-10-08).**
   pgcrypto lives in the **`extensions`** schema on hosted Supabase projects.
   The Supabase SQL editor has `extensions` on its search_path; a
   `supabase db push` session does **not**. An unqualified
   `gen_random_bytes(32)` therefore works when a migration is pasted into the
   editor and aborts the same file under `db push`:
   `function gen_random_bytes(integer) does not exist` (SQLSTATE 42883). The
   batch is rejected as one implicit transaction, so nothing in the file is
   applied and nothing is recorded — the migration simply reverts to pending.
   `20260815000000_phase8b_reconstruct_rpcs.sql` uses the correct form
   (`extensions.gen_random_bytes(32)`);
   `20261018000000_repair_legacy_public_api_tables.sql` resolves the schema
   from `pg_extension.extnamespace` at apply time instead of assuming it, so it
   also works where pgcrypto sits in `public`.
   **Rule: never call an extension function unqualified in a migration — use
   the schema-qualified name or resolve the schema at apply time.** Note the
   SQL editor is not a faithful proxy for `db push`: anything that only works
   there, works nowhere else.

11. **`relation "projects" already exists` (SQLSTATE 42P07).** This is a
    schema-name collision, not a project-health or connection problem. The
    former Phase A migration used the generic `public.projects` name, and the
    failing `CREATE TABLE` found that relation name occupied. The error alone
    does not establish whether it is an unrelated legacy relation or a
    Phase A table left by migration-history drift. Retries cannot resolve it.
    The construction feature now uses the dedicated
    `public.construction_projects` table; its repositories and later BOQ,
    valuation and reporting migrations all target that relation.

    `20261028000000_construction_projects.sql` adopts `public.projects` only if
    its core column types and nullability, primary/foreign keys (matched by
    definition) and lifecycle status check match the Phase A construction
    table. Otherwise it leaves the existing relation untouched and creates
    `construction_projects`. The forward migration
    `20261028000001_construction_projects_namespace.sql` handles environments
    that already recorded the old Phase A version (notably staging): it
    renames only the recognized construction table, rewrites the feature's
    known RPC bodies, and creates a restricted security-invoker compatibility
    view only when the old name is free. An unrecognized existing relation is
    never dropped, renamed or modified.

    Because the reported attempt failed at table creation, do **not** mark
    `20261028000000` as applied with `supabase migration repair`; that could
    skip its remaining RLS, grants, FKs, triggers and RPCs. First inspect the
    remote migration history and relation definition read-only
    (`scripts/database/diagnose-projects-namespace.sql`). If the version is
    still pending, apply the corrected chain; if it is already recorded, the
    edited source will be skipped. After rollout, verify the remote history
    and confirm `public.construction_projects` has the expected table,
    policies, indexes and RPC dependencies. The CI push wrapper fails
    immediately with the migration name and recovery warning on SQLSTATE
    42P07 instead of spending three attempts retrying deterministic DDL.

    Process exception: the source of `20261028000000` was corrected because the
    reported failure occurs at its original `CREATE TABLE public.projects`.
    Remote schema and migration history were not queried, so confirm both
    before rollout. If production has not recorded that migration, the corrected
    source can run; if it has recorded the original migration, the source edit is
    skipped and the forward migration handles the Phase A schema, stopping for
    manual reconciliation only if the table is missing entirely afterwards.
    The release suite covers a clean replay, a pre-existing unrelated
    `public.projects` table, and a simulated staging upgrade from the original
    Phase A schema.

12. **`Cannot namespace construction projects … (SQLSTATE 55000)`.** The
    namespace guard described in §11 originally required an *exact* Phase A
    signature — exactly 13 columns, exactly 9 constraints and the original
    `projects_*` constraint names — and aborted the push when staging's
    `public.projects` did not match. That fingerprint rejected genuine but
    evolved Phase A tables (for example `boq_locked_at` already applied out
    of order under the old name, an extra guard check, or constraints
    created while the table was called `construction_projects`), and it
    also aborted when the name belonged to an unrelated legacy relation
    whose Phase A history entry was already recorded. Because
    `20261028000001` sits mid-chain, the one deterministic failure — retried
    three times by the wrapper before reporting — blocked every later
    migration on staging (`project status: ACTIVE_HEALTHY` confirmed the
    project itself was fine).

    Confirmed staging state (remote `schema_migrations`, 2026-10-18):
    `20261028000000`, `20261030000000` (BOQ), `20261031000001` (valuations)
    and `20261101000000` (reporting) are recorded, and `20261028000001` is
    the missing one. The later construction migrations were therefore
    applied against the old `public.projects` name before the namespace
    migration existed, so staging's table is an *evolved* Phase A table
    (it already carries `boq_locked_at` and the BOQ/valuation/reporting
    tables, policies and RPC bodies built on the old name) — exactly the
    state the exact-signature fingerprint rejected. On the next push,
    `supabase db push` skips the recorded versions, applies
    `20261028000001`, and then applies whatever else is still pending
    (expected: `20261102000000` and `20261103000000`; confirm with
    `supabase migration list`, which shows local vs remote per version).
    The already-recorded BOQ/valuation/reporting migrations are not
    re-run, so their objects must survive the rename in place: foreign
    keys and policies follow the table OID automatically, and the
    namespace migration rewrites the known RPC bodies from
    `public.projects` to `public.construction_projects`.

    The guard now matches Phase A identity *by definition*: all 13 core
    columns with their types and nullability (extra columns allowed), a
    primary key on `id`, foreign keys `business_id → businesses` and
    `created_by → auth.users` (all matched by column/target, not by
    constraint name), and the lifecycle status vocabulary in a check
    constraint (definition, not name). A table matching that identity is
    renamed with its data, indexes and dependencies intact; the BOQ
    migration's `boq_locked_at` addition is `IF NOT EXISTS` so an adopted
    table that already carries the column no longer fails next with
    SQLSTATE 42701. A `public.projects` that does not match is preserved
    untouched — never renamed, dropped or modified — and the namespace
    migration creates `public.construction_projects` and
    `public.project_status_log` alongside it (logging a WARNING), exactly
    as the Phase A migration already behaved for the same collision. If
    the preserved table did hold construction rows, they stay in it for
    manual reconciliation after the push; nothing is deleted either way.
    The CI wrapper now also fails fast (no retries) if it ever sees the
    old 55000 guard from an older checkout, and points at the diagnosis
    script. `20261028000001` was edited in place for this: it had never
    applied successfully on the affected environment (it *is* the failing
    migration, so it is pending there), and environments that did record
    it skip the edited source as usual. Before retrying a failed staging
    push, run `scripts/database/diagnose-projects-namespace.sql` read-only
    to confirm which of the two states the project is in; afterwards,
    confirm the WARNING/rename outcome in the push log and that the
    migration target in `supabase migration list` was reached. The
    release suite covers both states: an evolved original Phase A schema
    upgrading in place (`construction-project-namespace`), and a legacy
    `public.projects` preserved while the feature tables are created
    alongside it (`construction-project-namespace-legacy`).

13. **`project_status_log` collision annotation: preserve evidence before repair.**
    Production runs `39128722410` and `39131240114` reported a wrapper annotation
    claiming SQLSTATE `42P07` while applying `20261028000000`. The raw job logs
    were not accessible from this workspace; **the actual server error remains
    unconfirmed**. Do not infer an out-of-band application, an unrelated legacy
    table, or an applied migration from that annotation alone.

    Subsequent **owner-supplied catalog output** (not an independent live query
    from this workspace) establishes a more specific shape:

    - Remote head `20261027000000`, 133 recorded versions: Phase A and later
      construction versions are not recorded on that database.
    - `public.construction_projects` is absent. `public.projects` is a
      postgres-owned, RLS-enabled ordinary table with the construction core,
      `boq_locked_at`, and **`lifecycle_state` instead of `status`**, including
      the five-state lifecycle check. That is not identical to the expected core.
    - `project_status_log` is postgres-owned and RLS-enabled; its seven core
      columns/defaults, validated non-deferrable FKs and valid indexes match
      the construction audit design. Its project FK targets **the existing
      `public.projects(id)`**, with `ON DELETE CASCADE`.
    - Both tables grant authenticated users SELECT, not direct writes. No
      application rows or reliable row counts were inspected.

    The current adoption predicate requires a `status` column, so it does not
    recognize that variant. Creating a fresh construction table beside it does
    not move the audit FK or existing data; the audit guard correctly refuses
    that split with `55000`. Disposable full-file replays reproduce this refusal
    without changing populated project/audit rows or existing dependencies.
    **The safety/reporting PR is not a complete production remediation.** Do not
    automatically rename `lifecycle_state`, re-point the FK, copy/drop data or
    mark Phase A applied. Inspect the coupled RPC signatures/definitions, return
    types, triggers, policies and table/row-type dependencies first, and approve a
    data-preserving convergence plan. `postgres` ownership alone does not prove
    business ownership, full equivalence or how the schema reached this state.

    There is a reproducible reporting bug: the wrapper previously matched
    `relation "…" already exists` anywhere in push output. Both construction
    migrations already use `CREATE TABLE IF NOT EXISTS public.project_status_log`,
    which emits the benign `NOTICE: relation "project_status_log" already exists,
    skipping` when the name is occupied. If a later statement or the connection
    failed, that notice caused a **hardcoded 42P07 annotation**, suppressing the
    real error. The notice proves neither equivalence nor the cause of failure.
    The corrected wrapper classifies actual `ERROR:` severity lines, preserves
    their SQLSTATE/message/statement context, and keeps retries for transport and
    explicitly transient PostgreSQL conditions (including serialization failures
    and deadlocks). Schema failures still stop after one attempt; neither those
    failures nor notices authorize history repair.

    **Inspect without deploying:**

    - Run **Migration forensics (read-only)** → `production` once the workflow is
      available on GitHub. It uses the existing Management API token and the
      explicitly selected project's ref, sends catalog SELECTs with
      `read_only=true`, and requires no database password. A failed/incomplete
      inspection is **UNKNOWN**, not evidence that an object/version is absent.
    - Alternatively, run each `@query` section of
      `scripts/database/diagnose-project-status-log.sql` **separately** in the
      affected project's SQL editor. Some editors show only the last statement's
      result; `remote_head`/`recorded_versions` is only the history summary, not
      the relation inspection. For the remaining RPC/dependency review, open a
      **new empty query tab** and run only
      `scripts/database/diagnose-project-status-log-dependencies.sql`: its single
      statement returns one row labelled `LEDGR_DEPENDENCY_CHECK_V1`, containing
      full coupled function definitions/return types, direct table and row-type
      dependents, policies, triggers and incoming FKs. It changes no schema or
      history and fetches no application rows. Review definitions for embedded
      credentials before sharing externally.
    - Or run `bash scripts/ci/remote-schema-forensics.sh --label production` with
      credentials supplied through your existing secure environment. Do not put
      credentials into SQL, a command saved in the repo, an issue, or chat.
    - The report includes relation **owner/OID/kind**, standalone type collisions,
      column defaults/nullability/identity/generated attributes, PK/FK target
      columns and delete/update actions, validation/deferral, full index
      definitions/validity, RLS/policies/roles, grants (including column ACLs),
      triggers, dependencies, coupled RPC signatures/return types/security, and
      the construction migration history. Row figures are **estimates**, not
      proof of an empty table; no application rows are fetched. Local migration
      SHA-256 hashes identify the exact source being compared.

    **Review the entire failing migration**, not only its audit-table declaration.
    Phase A can adopt a recognized `public.projects` table, creates the project
    and audit indexes, enables RLS, replaces policies, revokes direct browser
    writes, adds procurement/location `project_id` columns and FKs, replaces the
    lifecycle/procurement/location RPCs and triggers, and verifies authorization
    and the state machine. The forward namespace migration also rewrites known
    RPC bodies and may create a restricted compatibility view. Matching seven
    audit columns alone cannot establish equivalence of all those effects.
    Compare the deployed revision, remote history, relation ownership and every
    dependent object before choosing a repair. A function return-type conflict,
    for example, is not fixed by skipping table creation.

    The pending Phase A and namespace sources now add a **read-only, fail-closed
    audit guard** before attaching audit indexes/policies/grants: permanent table
    kind, core column types/nullability/defaults, PK and both validated,
    non-deferrable FKs (including referenced columns and actions) must match.
    Unknown shapes raise `55000` with the live owner/columns and inspection path;
    missing FKs/defaults are **not silently added**. The guard does not constitute
    an ownership approval or a full-feature equivalence verdict. No audit table
    is dropped, renamed, re-pointed or rewritten, and no migration is marked
    applied. Full-file transactional replays verify refusal preserves rows,
    grants, policies, indexes and function definitions.

    Source-edit exception: production's reported attempt is still failing in
    `20261028000000`, so a later migration cannot protect that pending replay.
    Both original and namespace sources carry the same guard for pending
    installs/upgrades. Environments that already recorded either version **skip
    its edited source**; this is not a claim that their live schemas changed.
    Confirm remote versions first. Do not `migration repair --status applied`
    merely to bypass this guard: that skips the remainder of the file. If any
    object is unrelated or ownership is uncertain, stop for an owner-approved,
    data-preserving reconciliation plan rather than automatically moving it
    aside and retrying the deploy.
