# LEDGR — R06 Inventory and POS Sale Posting Integrity: Remediation Report

**Date:** 2026-09-21
**Package:** R06 (register §"R06 — Correct inventory and POS sale posting", Critical priority)
**Class:** Fail-driven fix + new release coverage. **One migration; zero existing-behavior weakening.**
**Outcome:** Combined release evidence **608 PASS / 2 FAIL / 54 BLOCKED @664 records** — from the R05-final baseline 601/3/54 @658. The single anchored failure **POS.STOCK FAIL → PASS** with no other record changed; exactly 6 new `R06.POS.*` records added, all PASS; deterministic repeat run **0 diffs**.

---

## 1. Anchored Failure (Before State)

| Record | Before | Evidence |
|---|---|---|
| `POS.STOCK` — “Sale reduces actual balance 100 → 99 (not merely movement insertion)” | FAIL: `Observed 100; expected 99.` | `post_pos_sale` / `_ledgr_complete_pos_sale` inserted a `stock_movements` row for the sale, yet `inventory_balances.quantity_on_hand` never moved on the online path |

**Root cause (verification-first inventory, mechanically proven before authoring any fix):**
- **No trigger existed** on `public.stock_movements` or `public.inventory_balances` anywhere in the migration chain.
- The **only writers** of `inventory_balances` were the offline/backfill reconciliation RPCs (`20260728000002`, `20260730000005`) — batch **rebuilders** from movements, not an online propagation mechanism.
- Online posting commands (`post_pos_sale`, `save_quick_sale`) inserted movements only. Balances moved only when somebody later ran a reconciler — i.e., the register's "Version one authoritative stock-movement→balance mechanism … Do not install a second updater alongside an unknown live trigger" constraint was satisfiable: there was **no live updater at all**; we installed the first, not a second.

## 2. Fix (One Migration)

**`supabase/migrations/20260928000001_r06_stock_balance_authority.sql`**

- `_ledgr_apply_stock_movement_balance()` — SECURITY DEFINER trigger function, `AFTER INSERT ON stock_movements FOR EACH ROW`:
  - locates (and upserts if absent) the one authoritative balance row per `(business_id, product_id, location_id)` — the base schema's `unique (business_id, product_id, location_id)` constraint (20250101000000:2191) is the serialization point; row locked `FOR UPDATE`, so **concurrent postings of the final unit serialize deterministically**;
  - applies the **signed movement quantity** (chain-wide convention: inbound `purchase` positive, outbound `sale` negative);
  - **weighted-average cost** on costed inbound only — inbound with `unit_cost <= 0` propagates quantity and leaves `average_cost` untouched (never a silent zero-cost valuation substitution, register R06 unknown-cost rule);
  - oversell policy: the existing `chk_inventory_balances_on_hand_nonneg` check (R05-verified, 23514) is the approved stock policy — a movement driving on_hand negative fails the posting command's transaction; nothing else to invent.
- Exactly-once: balance effects happen once per inserted movement; posting commands already gate movement insertion per `(business_id, source_type, source_id)`.
- Idempotent re-apply: `create or replace function` + `drop trigger if exists` + `create trigger`.
- Backfill interplay documented in-file: reconcilers insert missing movements (each propagating) then rebuild balances wholesale — convergent, no double count.

## 3. New Release Suite

`tests/release/r06-pos.test.ts` — 6 records, all PASS (gate registration `'r06-pos.test.ts': 'r06-pos.json'`), using the R05-established observer/savepoint conventions:

| Record | Assertion | SQLSTATE |
|---|---|---|
| `R06.POS.BALANCE-PROPAGATION` | sale movement −2 → on_hand 100→98; inbound +3 → 101; reserved untouched | — |
| `R06.POS.OVERSELL-DENIED` | −101 rejected, on_hand stays 100; final-unit −100 → 0 allowed | 23514 |
| `R06.POS.WEIGHTED-AVERAGE-COST` | (100×900 + 10×1000)/110 = 909.0909; zero-cost inbound leaves average unchanged | — |
| `R06.POS.REPLAY-EXACTLY-ONCE` | `post_pos_sale` twice, same client key: same invoice id, balance 100→99, exactly 1 sale movement | — |
| `R06.POS.SERVICE-NO-STOCK` | `track_inventory=false` product sale posts normally; 0 movements; no balance row created | — |
| `R06.POS.DATA-UNCHANGED` | all probes roll back: seeded balance 100@900, movements/invoices 0, contacts 2, business_users 14 | — |

## 4. Evidence Integrity

| Run | PASS | FAIL | BLOCKED | Records |
|---|---|---|---|---|
| Baseline (R05 final) — `.cache/r13/ledgr-r13-dxX1jm` | 601 | 3 | 54 | 658 |
| **R06 final** — `.cache/r13/ledgr-r13-v6XitO` | **608** | **2** | **54** | **664** |
| Repeat — `.cache/r13/ledgr-r13-SrdrCb` | 608 | 2 | 54 | 664 (0 diffs) |

Manifest `.cache/r06/comparison.json`:
- 658 common records: **657 byte-identical**; the **only** change is the anchored flip `POS.STOCK` FAIL→PASS — changed fields exactly `{status, actual}`, the same minimal-flip discipline as R04.
- `added = 6` (all PASS), `removed = []`, `repeat_diffs = []`.
- Remaining FAILs — untouched, later-package-owned: `EDGE.RETRY.no-secret` (R12/R14), `EDGE.WEBHOOK.viewer` (R12).
- Migration delta: exactly `20260928000001_r06_stock_balance_authority.sql`.
- Environment note: the run re-verified determinism across sessions (fresh `node_modules`, fresh embedded-PG fixture → identical counts).

## 5. Regression Stack (All Green)

- Root unit suite: **76 files / 658 tests PASS**
- `tsc -b`: exit 0 · `eslint .`: 0 errors (1 pre-existing warning, unchanged)
- `node --check` on all `tests/release/*.mjs`: clean
- Edge bundles: **esbuild 26/26 OK** · Placeholder production build: success · `git diff --check`: clean

## 6. Register Items Not Yet Anchored (Findings — Decision-Gated, Unimplemented)

R06's planned actions include items beyond the single anchored FAIL. They were **not** built because the register marks the package dependent on **R05 + DEC-07**, and the release inventory shows no enforcement for them; inventing would repeat the R03/R04 failure class:

1. **Server-boundary validation of allowed prices, discounts, tax, tenders, products, location, caller/shift association** for posting inputs — the posting payload's client-supplied price/discount/tax fields are currently written through (trusted input). No migration enforces price/tax policy; requires the approved price-book/discount/tax policy (DEC-07).
2. **Tender-account mapping policy**: unsettled "unknown/missing tender-account → silent cash substitution" is not converted into an explicit exception; a policy decision is needed (which tender codes → which accounts; behavior on unmapped).
3. **COGS exception/replay gap**: the movement-exists guard (`has this invoice already moved stock?`) is also the COGS replay gate; "stock-exists must not imply COGS-complete" is a register finding beyond POS.STOCK's assertion; retry-safety for a partially-posted COGS chain needs the approved correction model (related to R07 corrections).
4. **Concurrent-sale deterministic-denial statement** currently verified observably via the nonneg constraint + row lock behavior (`R06.POS.OVERSELL-DENIED`); a true multi-connection race test would require a harness extension (second concurrent client) — noted as harness-scope, not product behavior.

## 7. Deliverables

| Path | Change |
|---|---|
| `supabase/migrations/20260928000001_r06_stock_balance_authority.sql` | Single authoritative online stock-movement → balance trigger |
| `tests/release/r06-pos.test.ts` | 6-record R06 suite (all PASS) |
| `tests/release/gate.mjs` | Suite registration |
| `.cache/r06/comparison.json` | Integrity manifest (657/658 byte-identical + anchored flip + 6 added) |

## 8. Result

R06’s anchored failure is closed with a single new migration and six new verified invariants. Every previously-existing record is preserved byte-for-byte except the one intended FAIL→PASS flip; determinism holds across repeat and across sessions; the full regression stack is green. The unfixed R06 register items are decision-gated findings (§6), not regressions introduced by this package.

**Next package:** R07 — Approvals, refunds and voids (register: false approval guarantee containment; correction commands on the document/journal model). R08 — POS till/shift context. EDGE.* FAILs remain owned by R12/R14.
