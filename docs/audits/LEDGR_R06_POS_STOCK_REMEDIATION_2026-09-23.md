# LEDGR — R06 POS Sale Command Surface: Remediation & Verification Report

**Date:** 2026-09-23
**Package:** R06 — POS Command Surface Remediation & Verification (owner authorization 2026-09-23, R06 ONLY)
**Class:** Verification-first; historical-failure reconstruction; ONE minimal server-authoritative correction; 10 new release records
**Outcome:** Combined release evidence **709 PASS / 0 FAIL / 54 BLOCKED / 763 records**, two consecutive full harness runs with byte-identical per-record signatures. **Gate classification (§13): COMPLETE.**

> This report does not rewrite the 2026-09-21 R06 report (`LEDGR_R06_POS_STOCK_INTEGRITY_REMEDIATION_2026-09-21.md`), which remains the byte-preserved historical record of the original FAIL→PASS flip. This package re-verifies, hardens and seals the POS sale command stock surface under the 2026-09-23 mandate.

---

## 1. Authorization & Objective

Mandated objective (verbatim scope): the POS sale command (A) cannot create negative available stock; (B) atomically commits stock and financial effects; (C) has no path bypassing the authoritative stock-balance mechanism; (D) does not consume or mutate another tenant's stock; (E) preserves existing POS authorization and idempotency; (F) does not let client-supplied values bypass server-side stock rules; (G) produces zero unintended financial or inventory mutation when stock validation fails. Explicitly not a redesign of transfers, adjustments, replenishment, cost layers or warehouse flows.

Every clause maps to a release record in §7; (A–G) all verified. One additional defect of the same divergence class was demonstrated and closed (§6).

## 2. Baseline Establishment (Before Any Change)

| Point | Evidence |
|---|---|
| Actual current release baseline at tip `a846119` (R09.3-final, = `2b01054` code) | **700 PASS / 0 FAIL / 53 BLOCKED / 753** — two deterministic runs, per-record outcome sha256 identical (R09.3 report §7) |
| Historical chain (preserved byte-for-byte) | R05-final **601/3/54/658** → R06-era (2026-09-21) **608/2/54/664** (POS.STOCK flip + 6 R06.POS.* records) → R12 remediated both EDGE.* FAILs → … → R09.3 700/0/53/753 |
| `POS.STOCK` at baseline | **PASS** (flipped FAIL→PASS on 2026-09-21 by migration `20260928000001_r06_stock_balance_authority.sql`; original R05-era evidence "Observed 100; expected 99" preserved in R01/R05/09-21 audit reports) |
| Mandated premise resolution | The "remaining release failure POS.STOCK" named in the authorization is **historical** — already remediated and continuously PASSing. The mandate anticipated this (§2 "establish the actual current release baseline"). R06(23-09) therefore = verification of the existing remediation + mandated matrix + any real residual defect on the POS stock surface. |

## 3. §4(A) — Stock-Path Discovery Inventory (verified by source and by execution)

Full authoritative write path for an online POS sale at this tip:

1. `post_pos_sale(jsonb)` — effective body: `20260930000001_r08_post_pos_sale_binding.sql` (the only superseding definition; `20260923000000` is the parent). SECURITY DEFINER.
   - **Authorization:** `can_operate_pos(business)` (owner/admin/cashier/manager/sales_clerk/sales_manager/branch_manager/customer_service_rep) else **42501** — confirms `POS.DENY.viewer` / `POS.DENY.stock_clerk`.
   - **R08 till gates (untouched):** terminal existence/activity/branch/ambiguity (22023/42501), shift trusted-state (unknown/foreign 22023, terminal binding 22023, branch scope 42501, own-shift steering 42501, closed-shift DEC-08 late-arrival preserved).
   - **Idempotency:** `(business_id, client_key)` unique on `invoices`; replay → complete-and-return `idempotent:true`; `unique_violation` race falls in behind the winner and completes it.
   - **Payload validation:** malformation/total>0/rate>0/tender-settlement/credit-tender exclusion → P0001.
   - **Tenant product validation (NEW, §6):** every non-null `lines[].product_id` must belong to the business → **22023**, before quota, numbering and any write.
   - **Quota:** `_ledgr_assert_usage_limit` → R10 **P0QLT** (validated after validation, before numbering).
   - **Writes:** invoices (client_key, pos_shift_id), invoice_lines, invoice_payments (`on conflict (business_id, client_key) do nothing`), then `_ledgr_complete_pos_sale`.
   - **Drawer effects:** only on the primary path, only while shift open (`status='open'` guarded update); closed shifts untouched (DEC-08 adjustment keyed `client_key:late`). Replay path returns before drawer effects.
2. `_ledgr_complete_pos_sale(business, invoice)` (single definition, `20260923000000:276`): reads back the stored document; keyed **sales journal** (`invoice:<id>:sale`, posts exactly once, sets `invoices.journal_entry_id`); keyed **settlement** per stored payment (`invoice:<id>:settlement:<payment_id>`); stock release guarded by the movement-exists gate per `(business_id, source_type='invoice', source_id)`; per product line: tenant + `track_inventory` scoped lookup (miss ⇒ skip — see §6), location derived by `_ledgr_stock_location(business, branch)` (branch → business default → any, all tenant-scoped), `unit_cost` read from the live balance row (never caller input); keyed **COGS** (`invoice:<id>:cogs`, failure tolerated by design as postCogsForSale parity).
3. `trg_stock_movement_apply_balance` → `_ledgr_apply_stock_movement_balance()` (`20260928000001`, the ONLY online propagation mechanism — proven 2026-09-21 and re-proven here): upserts the one balance row per `(business_id, product_id, location_id)` (base-schema unique constraint = serialization point), locks it **FOR UPDATE** (concurrent postings serialize), applies the signed quantity, weighted-average cost on costed inbound only (zero/unknown cost never substitutes zero valuation).
4. `chk_inventory_balances_on_hand_nonneg` (`20260817000001`), `quantity_on_hand >= 0` → **23514** inside the posting transaction — the approved final-unit oversell policy. **§4(D): preserved — untouched by this package; never weakened, replaced or bypassed.**

## 4. §4(B) — Idempotency Semantics

| Mechanism | Verified behavior |
|---|---|
| `client_key` unique `(business_id, client_key)` on invoices + replay-complete | Replay returns same document flagged `idempotent:true`; effects exactly once (`R06.POS.STOCK.REPLAY`) |
| Payments keyed `(business_id, client_key)`, `on conflict do nothing` | Single tender row across replays |
| Movement gate per `(business_id, source_type, source_id)` | Balance effects exactly once per committed document; backfill interplay documented in `20260928000001` header |
| Journal posting keys (singleton upsert-with-key discipline) | One sale + one settlement + one COGS per invoice — replay cannot double-post |
| Race double-submit | `unique_violation` path falls in behind winner and completes |
| Retry after denial | A 23514/22023-denied command persists nothing (rollback); the same client key can legitimately retry with fixed input — no partial mutation blocks it (`R06.POS.STOCK.INSUFFICIENT`, `ATOMIC-FAILURE` zero-persistence assertions) |
| Side effects | Drawer totals skipped on replay (early return), verified by pre/post `pos_shifts` md5 |
| Document number | Reserved only after all validations (no number burned on a denied sale) |

## 5. §4(C) — Caller-Input Authority Classification

| Input | Classification | Enforcement |
|---|---|---|
| `quantity` | Caller-controlled, constraint-enforced | 23514 at the balance row; `qty <= 0` lines write-through but never move stock (document-only; DEC-07 class, see §12) |
| `unit_price`, line totals, discount, tax, VAT | Caller-controlled write-through | Register DEC-07 (decision-gated, unchanged — not R06 stock scope) |
| `unit_cost` | **Server-derived** (not read from payload) | Live balance WAC; no `unit_cost` column exists on `invoice_lines` (`R06.POS.STOCK.CLIENT-TAMPER`) |
| `location` | **Server-derived** (not read from payload) | `_ledgr_stock_location(business, branch)` |
| `average_cost` / `quantity_on_hand` / balance fields | **Server-owned** (not read from payload) | Client cache/values are evidence only; tamper record proves non-effect |
| `product_id` | Caller-controlled → **now tenant-validated** | 22023 since `20261003000000` (§6) |
| `business_id` | Caller-supplied, authz-gated | `can_operate_pos` 42501 (`R06.POS.STOCK.CROSS-TENANT`) |
| `branch_id` | Caller may narrow only | DEC-03 `can_access_branch` (42501); terminal-authoritative when present (22023) |
| `terminal_id` / `shift_id` | Caller-claimed, server-validated | R08 gates (22023/42501 matrix) |
| `client_key` | Caller-minted UUID, uniqueness-enforced | Idempotency §4 |
| `payments[].bank_account_id` | Caller-controlled write-through | DEC-07 tender-mapping finding (§12) — unchanged |
| `lines[].account_id` | Caller-controlled write-through | DEC-07 finding (§12) — unchanged |

## 6. §5 — Historical Failure Reconstruction (Script Requirement)

**Method limitation (documented honestly):** the entire R00–R08 package was committed squashed (`4363e77`); the R05-final code state exists only in the evidence/audit records, not in a separable commit, so a byte-exact historical replay from git is impossible.

**Mechanism-exact reproduction (performed at this tip, before any change):** the only behavioral delta between defect-era and current schema for this path is the propagation trigger. Inside a single rolled-back transaction the trigger was dropped (transactional DDL) and the POS.STOCK-identical probe executed:

| Run | Observation |
|---|---|
| **Defect-era (trigger dropped)** | `movements_inserted=1, observed_on_hand=100, expected_on_hand=99` — byte-identical to the R05-era anchored evidence *"Observed 100; expected 99"* |
| **Control (trigger present)** | committed sale takes on_hand 100 → 99, WAC 900 |

Causality is single-toggle isolated: the same probe, the same seed, the same transaction shape; only the propagation mechanism varies. Combined with the preserved 2026-09-21 root-cause inventory (no trigger existed anywhere in the chain; the only balance writers were offline reconcilers), the original failure is conclusively a **real product defect, genuinely remediated** — not a harness/evidence artifact.

## 7. §6 — Remediation: One Minimal Server-Authoritative Correction

**Demonstrated residual defect (probe-verified at the baseline, output captured):** a POS sale of business A whose lines carry business B's `product_id` **committed** — invoice, lines, tender, sales+settlement journals all posted — while the stock release silently skipped the foreign product (completion helper's tenant+`track_inventory` scoped lookup miss ⇒ `continue`). Result: a committed financial document claiming an item was sold, with **zero inventory effect and no signal** — the same silent stock/financial divergence class as anchored POS.STOCK. No phantom balance is created and no B-side stock moves (both probed), so it is not a cross-tenant stock *consumption* hole, but it is an unauthorized product/inventory relationship accepted at the POS boundary and a stock-meaningful mutation the caller is never told failed.

**Why the invariant cannot prevent it:** `chk_inventory_balances_on_hand_nonneg` constrains balances only; no movement row is ever inserted, so the trigger never fires. CHECK constraints cannot express cross-table tenant validation; a tightened FK on `invoice_lines.product_id` would bind every non-POS invoice writer (frozen financial surfaces — rejected).

**The correction — `supabase/migrations/20261003000000_r06_pos_product_tenant_validation.sql`:**
- The effective `post_pos_sale` body (byte-preserved copy of the R08 binding) with exactly **one injected validation block (marker `3b. R06`)**: every non-null `lines[].product_id` must exist in `products` with `business_id` = the sale's business, else raise **`22023`** — placed after payload math validation, **before** quota consumption, document-number reservation and every write.
- Manual lines (no product) and the business's own `track_inventory=false` service products are unaffected (`R06.POS.SERVICE-NO-STOCK` still PASS).
- Alternatives rejected: FK tightening (blast radius into frozen invoice flows); raising in the completion helper (would only fire when the movement gate is open — replay-repair of legacy rows could newly fail; and validation must precede quota/numbering).
- §11 discipline box: defect (above) · why invariant insufficient (above) · minimal proof (one block; 339→364 function lines; no other statement touched) · no-weakening (only raises earlier for a payload class that previously committed a divergent half-document; R08 gates, idempotency, tenders, trigger, 23514 policy, quota order byte-preserved) · rollback (re-apply `20260930000001_r08_post_pos_sale_binding.sql` — same create-or-replace shape) · full harness rerun ×2 (§9) · baseline preserved (§2).

**Cost-authority investigation (mandated §6):** in the POS path, movement `unit_cost` is derived exclusively from the live server balance (`coalesce(v_balance.average_cost, 0)`); caller cost input cannot influence WAC. No redesign required — GAP-6/WAC carve-out untouched. Zero/unknown-cost inbound propagates quantity only (asserted inside CLIENT-TAMPER), register's unknown-cost rule intact.

## 8. §7/§8 — Mandated Release Matrix (all records in `tests/release/r06-stock.test.ts`, registered in the gate)

| Record | Assertion (exact, no "any error") | Status |
|---|---|---|
| `R06.POS.STOCK.NORMAL` | 100→99, reserved 0, WAC 900; exactly 1 typed sale movement (qty −1, unit_cost 900, server-derived location); paid invoice bound to branch+shift+ledger; journals {sale:1, settlement:1, cogs:1}; tenders 1 | **PASS** |
| `R06.POS.STOCK.INSUFFICIENT` | qty 1 at 0 on hand → **SQLSTATE 23514**, message names `chk_inventory_balances_on_hand_nonneg`; zero document/tender for the key; balance stays 0 | **PASS** |
| `R06.POS.STOCK.EXACT` | qty = full remainder (99) commits; on_hand exactly **0**; movement −99 | **PASS** |
| `R06.POS.STOCK.REPLAY` | identical payload+key → same id, `idempotent:true`; still 1 movement / 1 tender / 3 keyed journals; balance unchanged; drawer md5 unchanged | **PASS** |
| `R06.POS.STOCK.CROSS-TENANT` | B cashier against A business → **SQLSTATE 42501**; zero mutation both tenants; full seven-surface snapshot equality | **PASS** |
| `R06.POS.STOCK.PRODUCT-MISMATCH` | foreign product id → **SQLSTATE 22023**; zero persistence; no cross-tenant balance row; full snapshot equality | **PASS** |
| `R06.POS.STOCK.ATOMIC-FAILURE` | financially-valid sale failing stock validation: invoices/lines/payments/journals/journal_lines/movements counts + balances md5 + shift md5 **byte-identical** before/after (23514 pinned) | **PASS** |
| `R06.POS.STOCK.CLIENT-TAMPER` | junk `unit_cost/location_id/quantity_on_hand/average_cost` line fields: movement costed 900 (live WAC), located at derived A location; tampered fields have no columns to land in; zero-cost inbound quantity-only (avg stays 900) | **PASS** |
| `R06.POS.STOCK.CONCURRENT` | **BLOCKED — honest harness limitation** (single-connection fixture; Promise.all serializes on the client's own queue; no second-connection factory). Concurrency protection NOT claimed; mechanism analytic (balance-row FOR UPDATE + unique key + 23514 final check) | **BLOCKED** |
| `R06.POS.STOCK.DATA-UNCHANGED` | balance equation exact (`on_hand = 100 + Σmovements = 4`, reserved 0, WAC 900); B pristine (100@900; zero documents/movements/journals); zero cross-tenant balance/movement rows anywhere; A = exactly 3 paid invoices with 9 keyed journals; identity counts (businesses 2, users 14, contacts 2) | **PASS** |

Denial assertions distinguish invariant (23514), authorization (42501) and validation (22023) SQLSTATEs exactly — no "any error" assertions; every denial is rollback-clean by construction of the probes and additionally verified by snapshot/keyed zero-persistence checks.

## 9. §12 — Validation & Determinism

| Gate | Result |
|---|---|
| Focused R06 suite | 9 PASS / 1 BLOCKED / 0 FAIL (10/10 records produced) |
| `test:release:types` (`tsc -p tests/release`) | clean |
| `tsc -b` | clean |
| `eslint .` | 0 errors; 1 pre-existing warning (generated artifact, unchanged) |
| Unit | **731/731** (86 files) |
| Placeholder CI build | success (PWA) |
| Full harness run 1 | **709 PASS / 0 FAIL / 54 BLOCKED / 763** (`.cache/r13/ledgr-r13-X1twjU`) |
| Full harness run 2 | **709 / 0 / 54 / 763** (`.cache/r13/ledgr-r13-J1TNkl`) |
| Determinism | per-record outcome signature sha256 **`a65e8e6701…93c2` identical** across runs; zero per-record diffs |
| Baseline comparison | 753 pre-existing records + exactly 10 new = 763; +9 PASS / +1 BLOCKED / +0 FAIL additive delta ⇒ **no existing record's status or evidence changed**; no BLOCKED→PASS unauthorized flips; historical R01–R13/R09.x records preserved |
| Edge bundle | not applicable (no Edge change) |

## 10. §10 — Scope Compliance (in/out honored)

**In scope (touched):** POS sale command stock/balance/idempotency/atomicity/tenant validation; R06 evidence. Files changed: `supabase/migrations/20261003000000_r06_pos_product_tenant_validation.sql` (new), `tests/release/r06-stock.test.ts` (new), `tests/release/gate.mjs` (suite registration). **Zero product code or historical-record modification.**

**Out of scope (verified untouched):** transfers (GAP-6), dispatch/receive, inventory adjustment redesign, WAC/cost redesign, procurement, warehouse, branch remediation (8× BRANCH.* remain BLOCKED), non-POS financial commands (`save_quick_*` family), invoice/journal lifecycle, payroll, banking, tax, offline/R09.3 (sealed records untouched), storage, auth, AI, webhooks, receipts. A dependency on a frozen surface was encountered (FK-tightening would have touched invoice flows) and was **documented and avoided** per §9 rather than silently changed.

## 11. §9 — Frozen-Surface Statement

No change to: R05 invariants (journal balance, period locks, audit actors), R07 corrections, R08 till/terminal/shift controls (the binding body carried forward byte-identical), R09.1 cache model, R09.2 provenance/quarantine (sealed records still BLOCKED with their documented limitation), R09.3 reconciliation, R10 P0QLT contract, R12 webhook remediations, historical release records. None weakened; none re-implemented.

## 12. Decision-Gated Findings (documented, deliberately unimplemented)

1. **Foreign-product acceptance in the `save_quick_sale` / quick-save command family** — same guard-by-skip class on a **non-POS** surface (out of R06's POS-command boundary; register candidate for the owning package). Probed pattern matches `_ledgr_complete_pos_sale` pre-fix behavior.
2. **Tender-account tenant validation & mapping policy** (DEC-07): `bank_account_id` on tenders is written through; settlement journals derive from it. Same status as the 2026-09-21 R06 report §6.2.
3. **Price/discount/tax/VAT write-through** (DEC-07) and **line `account_id` write-through** (DEC-07): unchanged, decision-gated.
4. **Zero/negative-quantity lines** persist on documents (no stock effect; constraint-denied only at line-level non-negativity where phase10 applies — probed negative-qty sale is 23514-denied by the existing phase10 checks).
5. **COGS replay gate** ("stock-exists implies COGS-complete") — unchanged per 2026-09-21 report §6.3 (R07-model dependent).
6. **True multi-connection race harness** — harness-scope extension, not product behavior; `R06.POS.STOCK.CONCURRENT` stays BLOCKED until a second-connection factory exists.

## 13. Gate Classification (§13): **COMPLETE**

| Condition | State |
|---|---|
| POS.STOCK remediated or conclusively shown harness/evidence defect | **Actually remediated (2026-09-21); re-verified; failure mechanistically re-produced with single-toggle causality (§6)** |
| All new R06 records pass | 9 PASS; 1 BLOCKED with an exact, mandate-sanctioned limitation (§7 explicitly permits recording the concurrency limitation rather than claiming protection) |
| No weakened invariant | Only additive hardening (22023 denial); 23514 path byte-preserved and re-proven |
| Idempotency intact | REPLAY record incl. drawer side-effect audit |
| No partial mutations | ATOMIC-FAILURE seven-surface snapshot equality |
| Tenant isolation preserved | CROSS-TENANT (42501), PRODUCT-MISMATCH (22023), zero cross-tenant rows in DATA-UNCHANGED |
| Prior evidence intact | Additive-only delta; historical records byte-preserved |
| Two deterministic runs | sha256-identical outcome signatures |
| No unrelated scope | §10 |

Not "green suite = COMPLETE": the classification rests on the enumerated conditions, the reconstruction, and the exact-limitation BLOCKED being mandate-compliant rather than a concealed failure.

## 14. Deliverables

| Path | Change |
|---|---|
| `supabase/migrations/20261003000000_r06_pos_product_tenant_validation.sql` | Server-authoritative product-tenant validation at the POS command boundary (the only migration; verification-preferred otherwise) |
| `tests/release/r06-stock.test.ts` | 10 mandated `R06.POS.STOCK.*` records (9 PASS + 1 honest BLOCKED) |
| `tests/release/gate.mjs` | Suite registration (`r06-stock.json`) |
| `docs/audits/LEDGR_R06_POS_STOCK_REMEDIATION_2026-09-23.md` | This report |

Historical artifacts untouched: 2026-09-21 R06 report, `POS.STOCK` record itself, all prior suites/reports/migrations.

## 15. Evidence Integrity

- Baseline (§2) established from repository + preserved prior reports before any change; two post-change full runs deterministic; comparison arithmetic exact (763 = 753 + 10).
- Probe transcript (foreign-product commitment, tamper derivation, negative-qty 23514, oversell zero-persistence, trigger-drop reproduction) executed against the baseline fixture before the migration existed; reproduction outputs quoted verbatim in §6/§7.
- No fabricated evidence: the concurrency record is BLOCKED-with-limitation rather than a claimed PASS; migration-only profile noted; no customer data anywhere (synthetic fixtures only).

## 16. Result

R06's 2026-09-23 objectives are closed: the historical POS.STOCK failure is conclusively reproduced and re-verified as fixed; the full mandated `R06.POS.STOCK.*` matrix exists and is green where the harness can honestly attest; one real residual silent-divergence defect on the POS boundary is closed with a single minimal, reversible, non-weakening migration; idempotency, tenant isolation, atomicity and the non-negativity invariant are proven, not asserted. Evidence: **709/0/54/763, deterministic ×2**. **STOP — nothing beyond R06 is authorized; decision-gated findings in §12 await their owning packages.**
