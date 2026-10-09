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

Three `pg_cron` jobs are declared in migrations with placeholders:

| Job | Schedule | Migration | Target edge function |
|---|---|---|---|
| `expire-subscriptions-daily` | `0 1 * * *` | 20260726000003 | `expire-subscriptions` |
| `send-renewal-reminders-daily` | `0 8 * * *` | 20260726000005 | `send-renewal-reminders` |
| `generate-partner-invoices-monthly` | monthly | 20260727000006 | `generate-partner-invoices` |

The migrations contain `<PROJECT_REF>` and `<CRON_SECRET>` placeholders.
Deployment substitutes them per environment:

1. Set the edge-function secret: `supabase secrets set CRON_SECRET=<random> SB_ENV=staging`
2. Apply the migration with the project ref substituted (the CI `deploy.yml`
   flow does this via `supabase db push`; the cron job commands reference
   `https://<PROJECT_REF>.supabase.co/functions/v1/...`).

**No real secrets are embedded in migrations.** Recreating a fresh environment
requires: run migrations → set function secrets → ensure `cron.job` rows point
at the environment's function URLs (verify with the capture script's
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
   blocking 621 database-backed records in `npm run test:release`.

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
