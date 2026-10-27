# Demo seed — construction + manufacturing + double-entry accounting

This folder contains the reproducible demo-data seed and its verification harness.

## What it creates

For the business supplied in `ledgr.business_id` (default target:
`487334df-a057-45c3-b088-85e6c0a6aeb3`):

- 10 construction products, 2 active projects, 10 stock receipts (100 units each)
- 2 construction progress valuations + retention-ledger rows + 2 journal entries
- 10 manufacturing products (6 raw materials, 4 finished goods)
- 4 active BOMs (one per finished good)
- 6 raw-material receipts
- 3 work orders driven through the real RPC lifecycle:
  - `WO-2026-001` completed (2 runs, 4,900 good / 130 scrap)
  - `WO-2026-002` in progress (1 run, 1,000 good / 25 scrap, 1 manual cement issue)
  - `WO-2026-003` draft
- 16 purchase journal entries, 7 manufacturing entries (automatic backflush), 2 valuation
  entries, 6 sales/COGS entries — 31 balanced entries in total
- Matching `sale` stock movements for the finished-goods sales

No row is deleted or updated. Re-running the seed adds nothing.

## Run against a local migration replay

```bash
npm ci
node scripts/demo/local-replay.mjs --fresh
node scripts/demo/local-postgres.mjs &          # listens on 127.0.0.1:55432
node scripts/demo/query.mjs -f scripts/demo/local-fixture.sql
node scripts/demo/run-seed.mjs
node scripts/demo/verify_demo.mjs
```

`local-fixture.sql`, `local-replay.mjs` and `local-postgres.mjs` are **local-only**.
They create a disposable cluster under `.cache/ledgr-demo` and a synthetic business row
with the target ID. Never run the fixture against a hosted project.

## Run against a hosted database

```bash
export DATABASE_URL='postgresql://...'
node scripts/demo/run-seed.mjs 487334df-a057-45c3-b088-85e6c0a6aeb3 --allow-remote
node scripts/demo/verify_demo.mjs 487334df-a057-45c3-b088-85e6c0a6aeb3
```

The runner refuses a non-local target without `--allow-remote`. It sets
`request.jwt.claim.sub` to the business's owner for the duration of the transaction so the
manufacturing RPCs pass their `auth.uid()` and role checks.

The seed assumes the repository-head schema (`accounts`, `journal_lines`, `project_valuations`,
`products.sale_price`, `inventory_balances.quantity_on_hand`, `stock_movements.movement_type`).
Run the discovery queries in `DEMO_SEED_REPORT.md` §3 first if the hosted project may have
drifted.

## Verification

`verify_demo.mjs` is read-only and prints a compact JSON summary. It also writes
`.cache/demo-report/verification.json` (gitignored). Checks:

- 5a product-type vocabulary
- 5b balance sanity / location-by-type
- 5c stock-movement ↔ balance reconciliation
- 5d BOM completeness and cost
- 5e work-order lifecycle, yield, overproduction
- 5f material variance
- 5g valuation arithmetic
- 6a per-entry debit/credit balance
- 6b trial balance and sign conventions
- 6c WIP reconciliation (literal + corrected unpaired-WIP basis)
- 6d retention reconciliation

See `DEMO_SEED_REPORT.md` for the full execution report, schema mapping and findings.
