# CI + DEPLOY RED ON `main` — ROOT CAUSE & REMEDIATION

**Date:** 2026-09-24
**Branch:** `arena/01a0d4b1-ledgr-react` (from `1c7aa075fac8270646f35f25cabad2386a6d8f63` = merge of PR #164)
**Type:** PRODUCT FIX — SQL migration chain, deploy script, regression guard
**Red runs investigated:**
- CI #408 `36036682801` (PR #176, dependabot) — `Isolated release evidence (R13)` exit 1
- CI #407 `36036320812` (main `1c7aa07`) — `Isolated release evidence (R13)` exit 1
- Deploy #225 `36036320730` (main `1c7aa07`) — `Link & migrate staging database` exit 1

Both failures are inherited from the PR #164 merge onto `main`; the dependabot
PR is only a bystander (its CI runs the same `main` job definition).

---

## §1 Failure 1 — two balance writers, every movement counted twice (CI)

**Observed.** `npm run test:release` exits 1 with
`{"PASS":724,"FAIL":18,"BLOCKED":54}`. All 18 FAILs are exact-double-count
signatures:

| Record | Observed | Expected |
| --- | --- | --- |
| `R06.POS.STOCK.NORMAL`, `R06.POS.REPLAY-EXACTLY-ONCE`, `POS.STOCK` | 98 | 99 |
| `R06.POS.BALANCE-PROPAGATION` | 96 | 98 |
| `R06.POS.WEIGHTED-AVERAGE-COST` | 120 | 110 |
| `R06.POS.STOCK.CLIENT-TAMPER` | 104 | 5 |
| `R06.POS.STOCK.CONCURRENT-2C`, `CROSS-TENANT`, `REPLAY`, `PRODUCT-MISMATCH` | 0 / 94 | 1 / 0 |
| `R093.RECON.*` (3 records) | false | true |

**Root cause.** `public.stock_movements` carries **two** additive balance
triggers, both firing on INSERT:

```
trg_stock_movement_apply_balance          -> public._ledgr_apply_stock_movement_balance()   (20260928000001)
trg_stock_movements_apply_inventory_balance -> public.update_inventory_balance()             (20260925000001)
```

- `20260925000001` installs the canonical delta writer, drops every competing
  balance trigger and asserts exactly one remains.
- `20260928000001` (new in the merge) claimed *“NO trigger exists on
  public.stock_movements”*, dropped only the **singular**
  `trg_stock_movement_apply_balance`, and created its own — leaving the plural
  `trg_stock_movements_apply_inventory_balance` in place. The claim was true of
  the database it was authored against and false of the shipped chain.
- Each green state before the merge contained exactly one of the two files:
  pre-merge `main` (`0f840659`) had only `20260925000001`; the release branch
  (`9c56cf1`…`013b37b`) had only `20260928000001`. The merge combined them.
- This is the same “two additive triggers on one insert = every movement counted
  twice” defect (10 received, 20 on hand) that `20260925000001` was written to
  end for the 2026-09 stock-count incident.

**Confirmed mechanically** by replaying the chain into a disposable embedded
Postgres and listing `pg_trigger` for `public.stock_movements` — two enabled
triggers, events `INSERT` and `INSERT/DELETE/UPDATE`.

## §2 Failure 2 — duplicate migration versions block `supabase db push` (Deploy)

**Observed.** `Link & migrate staging database` fails after 3 attempts with
*“supabase db push failed after 3 attempts for staging. If the project status
above is ACTIVE_HEALTHY, the database is likely unresponsive…”* — which points
at the Supabase dashboard, not the repository.

**Root cause.** Two migration files share a version prefix, and
`supabase_migrations.schema_migrations` is **keyed by that prefix**:

```
20260926000001_fix_backfill_and_recalculate_inventory.sql   (main, PR #169 — already applied on staging)
20260926000001_r01_acceptance_current_authority.sql         (branch, 4363e77)
20261003000000_invoice_member_readback.sql                  (branch, bba09ef)
20261003000000_r06_pos_product_tenant_validation.sql        (branch, 1ae6519)
```

**Reproduced** against a local Postgres holding the `0f840659` schema and
migration history, using the pinned CLI (`supabase 2.117.0`) and the same
invocation as `deploy.yml` (`supabase db push --db-url … --include-all`):

```
Applying migration 20260926000000_r01_privileged_write_boundaries.sql...
Applying migration 20260926000001_r01_acceptance_current_authority.sql...
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(20260926000001) already exists.
At statement: 15
INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)
```

Deterministic: byte-identical on every retry, so the retry loop can never
succeed and the “unresponsive database” advice is wrong. The transaction rolls
back, so no schema object from the colliding file was applied — the deploy is
blocked, not partially applied.

## §3 Changes

| File | Change |
| --- | --- |
| `supabase/migrations/20260928000001_r06_stock_balance_authority.sql` | Drops **every** balance-maintaining trigger on `public.stock_movements` (predicate shared with `20260925000001`) before installing the R06 writer, then **asserts exactly one remains**. Fires on `INSERT OR UPDATE OR DELETE`: INSERT keeps the R06 valuation policy (weighted average on costed inbound only, never silent zero-cost substitution) byte-identical; UPDATE/DELETE are net-deltaed through the already-proven `public._ledgr_apply_stock_movement_delta` so an out-of-band edit cannot desynchronise a balance. Keeps `quantity_available` in sync where it is a plain column (never writes it where it is generated). Header corrected: the stale inventory claim is now stated as a claim about a database, with the consequence documented. |
| `supabase/migrations/20261009000000_r06_single_stock_balance_writer.sql` | **New.** Deploy-time invariant enforcement for the one case an edited file cannot reach: a database where `20260928000001` is already recorded as applied (so its body never re-runs). Idempotent — drops competing writers, installs the canonical writer if missing, asserts exactly one, logs the result. Never rewrites a balance row. |
| `20260926000001_r01_acceptance_current_authority.sql` → `20260926000002_…` | Renamed to a free version, position in the replay order unchanged. Content byte-identical (the SHA-256 recorded in `LEDGR_R01_SECURITY_BOUNDARY_REMEDIATION_2026-09-21.md` stays valid). |
| `20261003000000_r06_pos_product_tenant_validation.sql` → `20261003000001_…` | Same: renamed, content byte-identical, replay order preserved (`invoice_member_readback` still applies first). |
| `scripts/ci/supabase-link-and-push.sh` | Pre-flight refuses to run when two migration files share a version prefix, naming both files; the push loop also recognises the `schema_migrations_pkey` signature and stops immediately with the colliding version instead of burning 3 retries and blaming the database. |
| `src/lib/__tests__/migrationInvariants.test.ts` | **New** fast-suite guard: (A) version prefixes unique, (B) file-name shape, (C) a migration that installs a balance writer on `stock_movements` must also purge competing writers. Both (A) and (C) were verified to fail against the original defects. |
| `tests/release/r01-security.test.ts`, `tests/release/r06-stock.test.ts` | Provenance strings updated to the renamed files. |
| `DEPLOYMENT.md` | New troubleshooting subsection: the `23505` signature, why retries cannot fix it, and how to rename correctly (never rename an already-recorded version — that becomes migration-history drift). |

## §4 Verification

| Gate | Before | After |
| --- | --- | --- |
| `npm run test:release` (R13) | `724 PASS / 18 FAIL / 54 BLOCKED`, exit 1 → CI fail | `742 PASS / **0 FAIL** / 54 BLOCKED`, exit 2 → CI pass (documented BLOCKED gate) |
| `npm run test` | 833 pass | 833 pass (incl. 3 new invariant tests) |
| `npm run typecheck` / `lint` / `build` | clean | clean (lint 0 errors, pre-existing warnings only) |
| `supabase db push --include-all` (staging-shaped DB, CLI 2.117.0) | `SQLSTATE 23505`, exit 1 | `Finished supabase db push.`, exit 0 — all 19 pending migrations applied and recorded, every version distinct |
| Legacy-duplicate repair (`20261009000000` against a DB carrying two writers) | — | 2 writers → 1; re-applying is a no-op |

All 18 previously FAILing records now PASS, including the three
`R093.RECON.*` records that depend on authoritative stock deduction.

## §5 Residual risk / follow-ups

1. **Production trigger shape.** `20260928000001` could only ever reach a
   project *after* `20260926000001` in version order, and the push aborts there,
   so no environment should carry the double writer. Production's deploy runs
   failed at `link`/`push` before that point. `20261009000000` now asserts the
   shape on the next successful deploy regardless — confirm the `raise notice`
   line `R06 invariant verified: exactly one balance writer …` in the deploy log.
2. **Balances already written by a double-count.** Staging's push rolled back,
   so no staging balance was double-counted by this chain. If any environment is
   found with two writers, `v_inventory_balance_ledger_drift` (installed by
   `20260925000001`) lists the affected `(product, location)` pairs; corrections
   belong in the app as a stock adjustment, not in SQL.
3. **Two collisions were fixed by rename.** Keep the pre-flight in
   `scripts/ci/supabase-link-and-push.sh` and
   `src/lib/__tests__/migrationInvariants.test.ts` in place — the underlying
   cause is a merge combining independently-numbered branch migrations, which
   will recur without them.
