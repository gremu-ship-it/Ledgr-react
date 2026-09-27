# Ledgr — Owner decisions implemented (2026-09-26)

Branch `arena/01a0d9f5-ledgr-react` (PR #185, draft), on top of 58f6e99. **Not deployed.** Production is still `f671656`. Nothing ran against any production system.

| # | Owner decision | Status |
|---|---|---|
| a | Only a **supervisor** may override prices at the till; cashiers may not | Implemented, server-enforced |
| b | POS sales deduct from **branch** stock, not the warehouse | Implemented, server-enforced |
| c | Perform **historical data repair** | Mechanism implemented and tested on synthetic data. **Not run in production** (no prod access here; needs the evidence snapshot first) |
| d | Guidance on merging the three Vercel projects | Guide written: `docs/runbooks/VERCEL_PROJECT_CONSOLIDATION.md`. No Vercel change made |

All earlier controls (ddb348a / cd25da2 / 033178f) are unchanged. RLS, `chk_inventory_balances_on_hand_nonneg`, R06 / R08 / R09, DEC-03 and DEC-07 are untouched. No historical migration was edited.

## (a) Supervisor-only price override — `20261013000000` (D-PRICE)

- **Supervisors** (server definition `_ledgr_is_pos_supervisor`): owner, admin, manager, sales_manager, branch_manager.
- **Price rule.** `post_pos_sale` (via `_ledgr_assert_pos_sale_amounts`, now also calling `_ledgr_assert_pos_price_authority`) refuses a line whose unit price differs from `products.sale_price` by more than 0.005 if the seller is not a supervisor. The error is 22023 `price-override-required`, and nothing is written.
- **Discount rule.** The server enforces caps: owner/admin 100 %, managers `pos_settings.manager_max_discount_percent`, others `cashier_max_discount_percent`. When no settings row exists, the fallbacks are 25 / 10, matching the client. A higher discount without a token is refused 22023 `discount-override-required`.
- **Cashier path.** `request_pos_price_override` creates a pending token. A supervisor authorises it from **their own session** with `authorize_pos_price_override`. Not the requester; the supervisor must belong to the same business; for discounts, only within the supervisor's own cap. The sale carries the token (`lines[].price_override_token` / `invoice.discount_override_token`). The server consumes it **once**. A price token is bound to product + price, and a discount token to a maximum %. Tokens expire (15 min by default).
- **Table.** `pos_price_overrides`: members can read it; authenticated callers cannot write it directly (42501).
- **Client.**
  - The cart has a new **Price** action per line: supervisors apply the price directly, cashiers go through server approval.
  - Over-cap discounts now use the server approval mode instead of the local-only confirmation.
  - The threshold is the operator's own cap.
  - Tokens travel only in the `post_pos_sale` payload, never in invoice columns.
- **Known limitation, stated plainly.** Like the existing R07 void/refund approvals, the app has **no supervisor inbox screen** yet. A supervisor authorises by calling `authorize_pos_price_override` with the token, and the modal shows the token prefix. Building that screen is a follow-up.
- **Consequence for offline sales.** An offline sale priced from a stale cache after a price change, or discounted over the cap without a token, is **refused on sync** (22023) instead of being accepted silently. That is the decision working as intended. The queue shows it as a failed sale for a supervisor to redo.

## (b) Branch stock only — `20261013000000` (D-BRANCH)

- `_ledgr_pos_stock_location` is strict: it returns the branch's own location and nothing else. Only a sale with **no branch** keeps the old default/first-location rule.
- `_ledgr_complete_pos_sale` (the latest body, one change) raises P0001 `branch-location-missing` if the branch has no location and the sale has a tracked stock line. Nothing is written. Service lines still sell.
- `pos_stock_availability` now returns `branch_location_missing`. The till shows a red banner telling staff to create a branch location and transfer stock. The demo client mirrors this.
- **Operational action before deploying.** Every shop that sells stock needs its own `inventory_locations` row holding its stock. Check it with
  `select b.id, b.name from branches b where not exists (select 1 from inventory_locations l where l.branch_id = b.id);`
  Otherwise those tills will refuse stock sales after the deploy.
- The R08 record `R08.SALE.BRANCH-SUBSTITUTION` sold on a branch with no location. Its fixture now creates that branch's location inside the rolled-back probe. The assertion and the evidence text are unchanged.

## (c) Historical repair — `20261013000001` + workflow

See `docs/runbooks/REPAIR_2026-09_INVENTORY.md`.

The migration adds a private `ledgr_repair` schema with no app access, and the migration itself changes no data. It provides:

- `plan_2026_09` (read-only sizing);
- `plan_hash_2026_09`;
- `apply_2026_09(evidence_ref, plan_hash)`: one transaction, advisory-locked, refuses without evidence or on a stale hash, and aborts if the D3 true-up drifts from the reviewed figure by more than 0.05.

Correction categories:

- **D0.** Quantity drift. Reported only; resolve it with a physical count.
- **D1.** Compensating `adjustment_in` for stock released by draft, credit-note and unreturned-void invoices.
- **D2.** Keyed COGS entries for live sales missing them.
- **D3.** One keyed 1141 ↔ 5180 true-up per business, so inventory GL equals the stock subledger.

No DELETE, no rewrite of history, and no direct balance write. Every row is labelled and logged (`ledgr_repair.runs` / `repair_log`).

Run order is **evidence snapshot → deploy → size → owner review → apply with the hash → size again (empty)**. The workflow `.github/workflows/repair-2026-09-inventory.yml` has the same owner gate as the existing repair workflow: manual dispatch from main by the owner, the confirmation phrase, and `vars.LEDGR_REPAIR_WORKFLOW_ENABLED`. Inputs are validated against strict allow-lists before being placed into SQL.

What it cannot know: real production figures. The size run produces them. **No production amount appears in this report because none was observed.**

## (d) Vercel

Findings (from the 2026-09-25 CI deploy logs and the live aliases):

- `ledgr-react` is production (prod Supabase).
- `ledgr-react-prod` is actually **staging** (staging Supabase).
- `ledgr-react-hp5u` deploys through Git integration, outside CI, and serves a different route shape (`/` → `/en/`); what it is remains unverified.

Recommendation: keep two projects. Rename `-prod` → `-staging` (the project id is unchanged, so CI needs no change). Disconnect, then retire hp5u after checking its domains and Supabase target. The full step list is in the guide.

## Verification (local, synthetic only)

| Check | Result |
|---|---|
| `npm run typecheck`, `test:release:types` | pass |
| `npm run lint` | 0 errors (3 pre-existing warnings in files not touched) |
| `npm run test` | 102 files / 920 tests pass (new: `posPriceOverride.test.ts`, `PosStockStatusBanner.branch.test.tsx`) |
| `npm run build` | pass (placeholder env) |
| Release gate run 1 / run 2 | **809 PASS / 0 FAIL / 55 BLOCKED** both times; identical per ID |
| vs 58f6e99 baseline (regenerated: 793 / 0 / 56) | +15 added `OD.*` records (all PASS); `H02.POS.PRICING-POLICY` BLOCKED → PASS (decision made); `IC.POS.FALLBACK-FLAGGED` expected text updated to the new branch rule (PASS → PASS). No other record changed |

Remaining BLOCKED: the 54 pre-existing environment-bound records, plus `H04.INVOICE.PERIOD-AND-APPROVAL-POLICY` (still an open owner decision). The P0 evidence-preservation runbook is **still pending**, and the repair must not be applied before it is done.

## Files

- `supabase/migrations/20261013000000_owner_decisions_price_override_branch_stock.sql`
- `supabase/migrations/20261013000001_ledgr_repair_2026_09.sql`
- `.github/workflows/repair-2026-09-inventory.yml`, `scripts/repair/2026-09-sizing.sql`
- `src/services/posPriceOverrideRpc.ts`; changes in `PosCart.tsx`, `PosPage.tsx`, `PosStockStatusBanner.tsx`, `posService.ts`, `posSaleRpc.ts`, `offline/payloads.ts`, `types/pos.ts`, `lib/demo/client.ts`
- `tests/release/od-owner-decisions.test.ts` (new, registered in `gate.mjs`); `ic-containment.test.ts` and `r08-shifts.test.ts` (as described above)
- `docs/runbooks/REPAIR_2026-09_INVENTORY.md`, `docs/runbooks/VERCEL_PROJECT_CONSOLIDATION.md`
