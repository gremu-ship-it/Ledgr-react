# CI + DEPLOY RED ON `main` — ROOT CAUSE, REMEDIATION & RECONCILIATION

**Date:** 2026-09-24
**Branch:** `arena/01a0d4b1-ledgr-react`
**Red runs investigated:** CI `36036682801` (PR #176) · CI `36036320812` (main `1c7aa07`) · Deploy `36036320730` (main `1c7aa07`)
**Type:** PRODUCT FIX (migration chain, deploy script, regression guards) + analysis
**Status:** both defects fixed on `main`; staging migrations now apply cleanly; guardrails added in this PR

---

## §1 Failure 1 — two balance writers, every movement counted twice (CI)

**Observed.** `npm run test:release` exited 1 with `{"PASS":724,"FAIL":18,"BLOCKED":54}`. All 18
FAILs were exact-double-count signatures:

| Record | Observed | Expected |
| --- | --- | --- |
| `R06.POS.STOCK.NORMAL`, `R06.POS.REPLAY-EXACTLY-ONCE`, `POS.STOCK` | 98 | 99 |
| `R06.POS.BALANCE-PROPAGATION` | 96 | 98 |
| `R06.POS.WEIGHTED-AVERAGE-COST` | 120 | 110 |
| `R06.POS.STOCK.CLIENT-TAMPER` | 104 | 5 |
| `R06.POS.STOCK.CONCURRENT-2C`, `CROSS-TENANT`, `REPLAY`, `PRODUCT-MISMATCH` | 0 / 94 | 1 / 0 |
| `R093.RECON.*` (3 records) | false | true |

**Root cause.** `public.stock_movements` carried **two** additive balance triggers, both firing on
INSERT:

```
trg_stock_movements_apply_inventory_balance -> public.update_inventory_balance()            (20260925000001)
trg_stock_movement_apply_balance            -> public._ledgr_apply_stock_movement_balance() (20260928000001)
```

- `20260925000001` installs the canonical delta writer, drops competing balance triggers and
  asserts exactly one remains.
- `20260928000001` was authored against a database whose history stopped before `20260925000001`,
  so its premise “NO trigger exists on public.stock_movements” was true *of that database* and
  false of the shipped chain. It dropped only the **singular** trigger name, leaving the plural
  one in place.
- Each green state before the merge contained exactly one of the two files: pre-merge `main`
  (`0f840659`) had only `20260925000001`; the release branch (`9c56cf1`…`013b37b`) had only
  `20260928000001`. The merge combined them.
- Same defect class as the 2026-09 stock-count incident (10 received, 20 on hand).

**Confirmed mechanically** by replaying the chain into a disposable embedded Postgres and listing
`pg_trigger` for `public.stock_movements`: two enabled triggers, events `INSERT` and
`INSERT/DELETE/UPDATE`.

**Fix (PR #178, on `main`).** `20260928000001` removes *every* balance-maintaining trigger
(predicate shared with `20260925000001`) before installing the R06 writer, and asserts the
resulting shape; `20261009000000_r06_single_stock_balance_writer.sql` enforces the same invariant
at deploy time for a database where `20260928000001` is already recorded and never re-runs.
Result: `742 PASS / 0 FAIL / 54 BLOCKED` (exit 2 — the documented BLOCKED gate).

## §2 Failure 2 — duplicate migration versions block `supabase db push` (Deploy)

**Observed.** `Link & migrate staging database` failed after 3 attempts with *“the database is
likely unresponsive…”* — pointing at the dashboard rather than the repository.

**Root cause.** `supabase_migrations.schema_migrations` is keyed by the **version prefix** of the
file name, and two files shared a prefix:

```
20260926000001_fix_backfill_and_recalculate_inventory.sql   (main, PR #169 — already applied on staging)
20260926000001_r01_acceptance_current_authority.sql         (branch, 4363e77)
20261003000000_invoice_member_readback.sql                  (branch, bba09ef)
20261003000000_r06_pos_product_tenant_validation.sql        (branch, 1ae6519)
```

**Reproduced** against a local Postgres holding the `0f840659` schema and history, using the
pinned CLI (`supabase 2.117.0`) and the same invocation as `deploy.yml`:

```
Applying migration 20260926000001_r01_acceptance_current_authority.sql...
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey" (SQLSTATE 23505)
Key (version)=(20260926000001) already exists.
At statement: 15
INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)
```

Deterministic: identical on every retry, so the retry loop could never succeed and the “unresponsive
database” advice was wrong. Each migration runs in its own transaction, so the colliding file
rolled back — the deploy was blocked, not partially applied.

**Fix (PR #178, on `main`).** The newer file of each pair was renamed to a free version, content
byte-identical, replay order preserved (`…00000002_r01_acceptance…`, `…00000001_r06_pos_product…`).
The deploy script now refuses to run when two files share a version prefix, naming both files, and
recognises the `23505` signature in the push output instead of retrying three times.

## §3 The same defect class recurred within the hour — and the guard caught it

While PR #178 was in flight, PR #177 merged into `main` carrying
`20261009000000_single_balance_trigger_and_wac.sql` — a second file on `20261009000000`, the exact
prefix PR #178 had just used. The collision was live on `main` for a few minutes.

What happened next is the argument for the guardrail: the deploy run for that commit
(`36045211990`) failed in **seconds**, with annotations naming both files —

```
supabase/migrations contains migration files sharing a version prefix — supabase_migrations.schema_migrations is keyed by version, so only one of each can ever be recorded:
  20261009000000_r06_single_stock_balance_writer.sql
  20261009000000_single_balance_trigger_and_wac.sql
```

— instead of burning three retries and blaming the database. PR #180 then renamed the repair file
to `20261010000000_eagle_nova_manure_balance_repair.sql`, and **staging migrations now apply**:
`Link & migrate staging database` succeeded in run `36045839906`, i.e. all 19 pending migrations
including both stock-balance migrations are applied and recorded on staging.

## §4 Reconciliation: which writer is canonical, and why it is frozen

Two coherent single-writer designs existed by the end of the day:

| | Design A (shipped) | Design B (considered, not shipped) |
| --- | --- | --- |
| Canonical writer | `trg_stock_movement_apply_balance` → `_ledgr_apply_stock_movement_balance()` (installed by `20260928000001`) | `trg_stock_movements_apply_inventory_balance` → `update_inventory_balance()` → `_ledgr_apply_stock_movement_delta()` (installed by `20260925000001`) |
| Zero-cost inbound | leaves `average_cost` unchanged (R06 writer) | leaves `average_cost` unchanged (after the same correction) |
| Environment alignment | staging already applied it on 2026-09-24 | would apply only to fresh replays |

Design B was drafted on this branch and **deliberately not shipped**: staging had already applied
Design A, so flipping the canonical writer would leave fresh replays on one writer and
staging/production on the other — drift between environments, which is precisely the mistake that
caused §1 (an inventory true of one database, false of the chain). Both designs pass the same
evidence; the tie is broken by what the environments have already run.

## §5 What this PR adds

| File | Change |
| --- | --- |
| `src/lib/__tests__/migrationInvariants.test.ts` | New rule **D**: the chain must contain an assertion that exactly one balance-maintaining trigger exists on `public.stock_movements` (cross-file, wording-tolerant). Rules A–C (unique version prefixes, name shape, a writer must purge competitors) landed with PR #178. Rule A and rule C were each falsification-tested against the real defects; rule D's pattern was checked to match the three live assertions and to stop matching when the phrase is removed. |
| `docs/audits/LEDGR_CI_DEPLOY_REMEDIATION_2026-09-24.md` | This record. |

Already on `main` from PR #178 (listed for completeness): the `20260928000001` single-writer
rework, `20261009000000_r06_single_stock_balance_writer.sql`, the two renames, the deploy-script
pre-flight and `23505` detection, rules A–C, and the `DEPLOYMENT.md` `23505` troubleshooting
section.

## §6 Verification

| Gate | Before | After |
| --- | --- | --- |
| `npm run test:release` (R13) | `724 PASS / 18 FAIL / 54 BLOCKED`, exit 1 | `742 PASS / 0 FAIL / 54 BLOCKED`, exit 2 (documented BLOCKED gate) |
| CI on `main` after PR #178 (`36045839949`) | red | green (R13 + typecheck/lint/test/build) |
| `supabase db push --include-all` vs staging-shaped DB (CLI 2.117.0) | `SQLSTATE 23505`, exit 1 | `Finished supabase db push.` — all pending migrations recorded under distinct versions |
| Deploy `Link & migrate staging database` on `main` (`36045839906`) | exit 1 after 3 retries | **success** — migrations applied to staging |
| Legacy-duplicate repair (DB carrying both writers) | — | converges to exactly one writer |
| unit · typecheck · release-types · lint · build | green | green (lint 0 errors, pre-existing warnings only) |

## §7 Remaining work (not this PR)

1. **`Deploy Edge Functions (staging)` still fails** on `main` — a separate step, downstream of the
   database push (run `36045839906`). PR #181 added diagnostics that name the failing function;
   the fix belongs with whoever owns the edge-function deploy step.
2. **Production.** Production’s deploys have failed at `link`/`push` before `20260928000001` could
   apply, so no production environment should carry the double writer. The next successful
   production deploy logs `R06 invariant verified: exactly one balance writer (…)` — confirm that
   line, and treat anything else as a stop condition.
3. **Balances written under a double count.** `v_inventory_balance_ledger_drift` (installed by
   `20260925000001`) lists affected `(product, location)` pairs; corrections belong in the app as a
   stock adjustment, not as a SQL rewrite.

## §8 Lesson carried forward

Both defects were invisible to typecheck, lint, unit tests and build, and both were *deterministic
in the database* while looking like infrastructure flakiness from the outside. Three habits would
have caught them earlier and are now enforced: migrations are numbered uniquely (rule A),
a balance writer is never added without removing the others (rules C/D), and a deploy failure message
names the file or version at fault rather than the platform.
