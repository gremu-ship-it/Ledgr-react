# Runbook — Historical inventory / COGS repair 2026-09

Owner authorisation: 2026-09-26 (historical data repair requested).
Mechanism: `supabase/migrations/20261013000001_ledgr_repair_2026_09.sql` (private `ledgr_repair` schema).
Workflow: `.github/workflows/repair-2026-09-inventory.yml`.
Status: **NOT RUN IN PRODUCTION.** Only a synthetic reproduction has been tested locally (release records `OD.REPAIR.*`).

## What it corrects

| Category | Defect | Correction (always a NEW row) |
|---|---|---|
| D0_QTY_DRIFT | `inventory_balances` ≠ Σ movements | **Report only.** You need a physical count, then a normal stock adjustment. |
| D1_INVALID_SALE_MOVEMENT | Stock released for a draft or credit-note invoice, or for a void invoice with no offsetting return (backfill status defect) | `adjustment_in` at the original unit cost, `source_type='repair_2026_09'`, `source_id=<invoice id>` |
| D2_MISSING_COGS | A live sale moved stock but never posted COGS (legacy client partial) | Keyed COGS entry `invoice:<id>:cogs` at movement cost |
| D3_GL_RECONCILIATION | Inventory GL ≠ stock subledger after D1/D2 (includes the 20261010000000 balance rewrite and swallowed receipt/adjustment journals) | One keyed entry per business, 1141 ↔ 5180 |

Nothing is deleted. No historical movement, journal, invoice or payment is updated. `inventory_balances` is never written directly (D1 goes through the R06 trigger).

## Procedure

1. **Evidence first.** Complete `docs/runbooks/IC_2026-09-25_P0_EVIDENCE_PRESERVATION.md` (snapshot/export). Write down its id, for example `PITR-2026-10-02T08:00Z` or an export object path. That id is the `evidence_ref`, and the database refuses to apply without one.
2. **Deploy** migration 20261013000001 through the normal release (it changes no data).
3. **Size.** Run Actions → *Repair 2026-09 inventory and COGS* with `mode=size`. This mode is SELECT-only. It prints the plan hash, the per-business totals and every proposed row.
4. **Review.** The owner and the accountant check the output. Pay particular attention to D3 amounts (they post to 5180 Inventory adjustments in the current period) and to D0 rows (these need a stock count).
5. **Apply.** Run the workflow with `mode=apply`, the `evidence_ref` and the exact `plan_hash` from step 3. If anything changed since sizing (a new sale, a new movement), the hash differs and the database refuses. Re-size, then review again.
6. **Verify.** Run `mode=size` again. D1, D2 and D3 should be empty and the hash should be `d41d8cd98f00b204e9800998ecf8427e`. `ledgr_repair.runs` and `ledgr_repair.repair_log` hold the audit trail.

## Guarantees (tested on synthetic data, `tests/release/od-owner-decisions.test.ts`)

- Refuses without evidence, with a missing or stale hash (22023), and writes nothing in either case.
- Runs as one transaction. If the actual D3 figure differs from the reviewed one by more than 0.05, it raises and rolls back everything.
- Idempotent: a second run finds nothing to do.
- Not callable from the app: `authenticated` and `anon` have no access to the schema (42501).

## Undo

Every correction is an ordinary document with a stable key. D1 is reversed with an `adjustment_out` of the same quantity. D2 and D3 are reversed with a reversing journal entry. `repair_log` lists every id.
