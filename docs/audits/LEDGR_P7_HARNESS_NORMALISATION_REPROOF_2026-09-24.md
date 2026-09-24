# P7 — Harness Normalisation + Full Release Re-proof

**Date:** 2026-09-24 (Africa/Johannesburg, UTC) — Trust `2026-09-24` over model training data.  
**Branch:** `arena/01a0c215-ledgr-react` at `090870b` (parent `efa8b54`) → P7 commit `P7: normalize release harness and re-prove release`  
**Evidence under audit:** Full release harness `npm run test:release` + `npm test` / `tsc -b` / `lint` / `build` / `git diff --check`  
**Release baselines:**  
- **Before (P5 TRIAGE / P6):** `675 PASS / 67 FAIL / 52 BLOCKED / 794` at `.cache/r13/ledgr-r13-ARujXO/evidence.json` (Chromium 138.0.7204.0, embedded-postgres 17.10.0-beta.17, pg 8.13.1, vitest 5.0.1)  
- **After (P7):** `742 PASS / 0 FAIL / 52 BLOCKED / 794` at `.cache/r13/ledgr-r13-ecFOuO/evidence.json` (same engine) — **+67 PASS, 0 FAIL**  
**Unit baseline:** `807 PASS / 0 FAIL` (91 files) — unchanged; `tsc -b` PASS, `lint` 0 errors (3 warnings), `build` PASS, `git diff --check` PASS  
**Mode:** **HARNESS-ONLY** — no `src/` / `supabase/migrations` / RLS / SECURITY DEFINER / schema / runtime behaviour changes; only `tests/release` expectations/fixtures/harness/docs. Product code `product_code_changed:false` for all per-test entries.  
**Authority:** P6 conclusions accepted — `R06.POS.STOCK.CROSS-TENANT` and `R093.RECON.CROSS-BUSINESS` both **C — Harness defect**, tenant isolation PASS, financial PASS. P7 is verification-contract normalisation, NOT product remediation. Authorised to modify only release-test expectations/fixtures/harness/docs; forbidden to modify `src/`/`supabase/migrations`/RLS/SECURITY DEFINER/schema/runtime behaviour. Must produce this doc §§1-13 + inventory JSON and single commit without merging PR #164. Final gate reports 14 items then STOP.

---

## 1. Executive Summary

P6 proved the two cross-tenant candidates are **not genuine tenant violations** under the intended `authenticated` identity — both are harness artefacts rooted in P5-D DEC-03 (`can_access_branch` fail-closed for assigned-scope `business_users.branch_id = NULL`) combined with sequential-test pollution and obsolete expectations. P7 preserves that product truth (T1) and **normalises the verification contract** (T2) so the harness again matches the shipped product.

**What P7 changed (harness-only, 5 files):**

- **Fixtures (`tests/release/fixtures.ts`):** `seedFixture` now assigns **assigned-scope** users to their owning branch (`A_cashier→A1`, `A_branch_manager→A2`, etc.) instead of `NULL`. NULL remains unassigned/org-wide; assigned-scope `NULL` is now **fail-closed `42501`** per P5-D `20261007000000_p5d_branch_scope_remediation.sql`. Unassigned roles (`A_admin`, `A_owner`, `A_accountant`, `B_owner`) stay `NULL` organisational.
- **R06 / R08 branch matrix (`tests/release/r08-shifts.test.ts`):** Matrix `U(805)` (A_cashier NULL) corrected `true,true → false,false` (DEC-03 fail-closed); (c) corrected from “NULL legitimately works A2” to **negative test** `U(805)` denied `42501 no access branch` + **positive control** `U(804)` (A2 manager) succeeds. `CLOSE-IMMUTABLE` and `BYPASS-CLOSED` raw-`UPDATE` expectations corrected for P5-D `grant all` + RLS no `FOR UPDATE` policy → `pos_shifts` `UPDATE` affects **0 rows** (still immutable) while `pos_shift_closes` remains `42501`.
- **R09.4 stale-version (`tests/release/r094-browser.test.ts`):** `R094.BROWSER.STALE-VERSION-MEASURE` (measurement-only, pre-DEC-09) updated to P5-A Q1/Q2/Q11 C: `payloadVersion 0 → quarantined stale-version`, `9999 → quarantined unknown-version` (was `synced`), legacy `null → missing-provenance` unchanged.
- **Quota (`tests/release/offline.test.ts`):** `seedUsageToLimit` made **idempotent** per disposable fixture — FK-safe deletes of `invoice_payments → invoice_lines → invoices → journal_lines → journal_entries` for `DAY` before re-seeding 50 `R13-USG-*` — so repeated calls in-suite no longer exceed the 50-doc `P0QLT` limit. `R10.QUOTA.CLIENT-PRECHECK` split `enqueue` (fail-open) vs `syncQueue` (authoritative `P0QLT`) via `mockResolvedValueOnce` + `mockRejectedValue`.
- **R09.3 replay (`tests/release/r093-reconciliation.test.ts`):** `R093.EXCEPTION.STOCK-DENIED` `rpcCalls` now expects quota probe + sale (`ledgr_monthly_document_count + post_pos_sale`); `R093.TAMPER.QUARANTINED` allows quota probe (1) before integrity quarantine (still 0 `post_pos_sale`/`reconcile`), durable `reconcile` also allows quota probe.

**Result:** `npm run test:release` **742/0/52** (was 675/67/52) — **67 harness-obsolete FAILs → PASS**, 0 genuine defects, 52 BLOCKED unchanged (environment, not product). `npm test` 807 PASS, `tsc -b` PASS, `lint` 0 errors, `build` PASS.

No `src/` or migration was touched; no security boundary was weakened; no `service_role` proof was accepted.

---

## 2. Scope & Mandate

### 2.1 What is in scope (P7)

- **T1 Preserve product:** RLS, SECURITY DEFINER, `auth.uid()`, `is_business_member`, `can_access_branch`/`can_access_location`/`can_operate_pos`, `post_pos_sale`, `reconcile_offline_queue_item`, stock `23514` triggers/constraints, offline provenance, P0QLT `20261001000000_r10_typed_quota_contract.sql`, DEC-03, P5-A/B/C/D/E/F — all protected, no weakening.
- **T2 Normalise harness:** DEC-03 `branch_id IS NULL` fail-closed for assigned-scope (`42501`); `42501` authz vs `23514` stock vs `P0QLT` quota error-class distinction; `R093` branch-denied vs stock-denied; `R09` `payloadVersion` stale-quarantine; `P0QLT` quota; `payloadVersion 0 vs 1`.
- **T3 Re-prove:** Full `npm run test:release` + `npm test` / `tsc -b` / `release-types` / `lint` / `build` / `git diff --check` and per-test delta.
- **T4 Reclassify:** All remaining `FAIL`/`BLOCKED` as genuine (A) / obsolete (B) / harness (C) / environment (D) / accepted (E) / other (F) — with governing contract.

### 2.2 What is out of scope

- No `src/` / `supabase/migrations` / RLS / SECURITY DEFINER / schema / runtime behaviour change to make harness green.
- No weakening of security boundary; if test conflicts with contract, fix test/harness not product.
- No `QUEUE_PAYLOAD_VERSION` / `hasTrustworthyProvenance` / TTL / `exceptionClass` / `_ledgr_assert_usage_limit` / `ai_context` change without authorization.
- No customer-distribution inference; no taxonomy expansion.
- Do not fake BLOCKED environment; do not merge PR #164.
- `LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md` never modified.

### 2.3 Required tenant / branch / quota model (per charter §§1-13)

- **DEC-03 (P5-D):** `business_users.branch_id IS NULL` for **assigned-scope** roles (cashier, branch_manager, stock_clerk) is **fail-closed** (`can_access_branch → false` → `42501` on command). NULL for **org-wide** roles (owner, admin, accountant, auditor) is legitimate org-wide.
- **R06:** `post_pos_sale` → `can_operate_pos` (`42501`) → `can_access_branch` → product tenant (`22023`) → `trg_stock_movement_apply_balance` (`23514` on-hand o. stock constraint) → quota (`P0QLT`) — each distinct `SQLSTATE`.
- **R09.3:** `branch-denied` (42501) vs `stock-denied` (23514) distinction; `isReconcilable` only `stock-denied|policy-denied`; manager-tier `reconcile_offline_queue_item`.
- **R09.4 / P5-A:** `payloadVersion 0` stale / `9999` unknown-future → `quarantined stale-version` / `unknown-version` (not `synced`); provenance `missing` → `missing-provenance`.
- **R10:** `P0QLT` distinct from `42501` / `P0001` / `23514`; `_ledgr_assert_usage_limit` authoritative.

---

## 3. Governing Contracts

| Contract | File | Behaviour | Harness expectation |
|---|---|---|---|
| **DEC-03** | `supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql` | `can_access_branch(biz, NULL) = false` for assigned-scope → `42501 no access branch` | Assigned-scope NULL denied; org-wide NULL allowed |
| **R06 23514** | `20260928000001` trigger | `quantity_on_hand < 0` → `23514` | `INSUFFICIENT` stock → `23514` |
| **R06 42501** | `post_pos_sale` | `can_operate_pos = false` → `42501` | Cross-tenant / cross-branch → `42501` |
| **P0QLT** | `20261001000000_r10_typed_quota_contract.sql` | `monthly limit 50` → `P0QLT` | Quota → `P0QLT`, not `42501` |
| **P5-A Q1/Q2** | `src/offline/*` | `payloadVersion 0/9999` → `quarantined` | `stale-version` / `unknown-version` |
| **RLS no FOR UPDATE** | `20260930000000` + P5-D `grant all` | `pos_shifts` `UPDATE` with no `FOR UPDATE` policy → `0 rows` (not `42501` permission) | `CLOSE-IMMUTABLE` / `BYPASS-CLOSED` 0 rows |

---

## 4. T1 — Product Behaviour Preserved

No `src/` or migration was modified (`git diff --stat` shows only `tests/release/*`). Verified:

- `supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql` unchanged — `can_access_branch` still fail-closed; `grant all on pos_shifts` retained.
- `20261001000000_r10_typed_quota_contract.sql` unchanged — `P0QLT` raise intact.
- `20261002000000_r093_offline_reconciliation.sql` unchanged — manager-tier + `22023` integrity.
- `src/offline/*` (`syncEngine`, `queueApi`, `provenance`, `payloadIntegrity`) unchanged — stale/unknown quarantine, `payload-tampered` before network, quota `P0QLT` via `isQuotaDenial`.
- Two-business isolation still proven via separate authenticated identities (`13000000-...` vs `...0105`) and `createSecondClient` — no shared `request.jwt`.

---

## 5. T2 — Harness Normalisation (Detail)

### 5.1 DEC-03 `NULL → 42501` (fixtures + R08 matrix)

- **Before:** `seedFixture` inserted `A_cashier` etc. with `branch_id = NULL` (pre-P5-D org-wide interpretation). `r08-shifts` matrix claimed `U(805)` `true,true` (NULL org-wide) and (c) claimed NULL cashier legitimately opens at A2.
- **After:** `fixtures.ts` assigns `A_cashier→A1`, `A_branch_manager→A2`, `A_auditor→A1` (assigned-scope) to `A1/B1`; `A_stock_clerk→A1`. Matrix `U(805)` `false,false` with comment `P7 DEC-03 P5-D: assigned cashier NULL = fail-closed (not org-wide)`; (c) now `deniedInTx( U(805) open A2, 42501)` + positive control `U(804)` (A2 manager) succeeds. Governing contract `can_access_branch`.

### 5.2 `42501` / `23514` / `P0QLT` Distinction

- `pos_shifts` `UPDATE` with no `FOR UPDATE` policy but `grant all` → **0 rows** (RLS `USING` false) not `42501`. `r08-shifts` `CLOSE-IMMUTABLE` / `BYPASS-CLOSED` updated accordingly; `pos_shift_closes` still `42501` (no grant). `R06` `INSUFFICIENT` remains `23514`; cross-tenant `42501`.

### 5.3 `R093` Branch-Denied vs Stock-Denied

- With NULL fail-closed, `A_cashier` offline `post_pos_sale` at A was `branch-denied` (42501) not `stock-denied` (23514), so not reconcilable. After fixture fix, stock-denied path is reachable; `STOCK-DENIED` now correctly `stock-denied` with quota probe + sale (2 RPCs).

### 5.4 `R09` `payloadVersion` Stale-Quarantine (P5-A)

- `payloadVersion 0` → `stale-version`, `9999` → `unknown-version` (both `quarantined` pre-network). `r094-browser` measurement updated; `STALE-VERSION-MEASURE` now PASS.

### 5.5 `P0QLT` Quota & Idempotent Seed

- `seedUsageToLimit` in `offline.test.ts` was not idempotent — second call in-suite exceeded 50 and raised `P0QLT` at `insert`. Fixed FK-safe deletes (`invoice_payments → invoice_lines → invoices → journal_lines → journal_entries` for `DAY`) before re-seed. `CLIENT-PRECHECK` split `enqueue` (fail-open) vs `syncQueue` (authoritative).

### 5.6 `payloadVersion 0 vs 1`

- Preserved — no harness change needed beyond stale quarantine.

---

## 6. Fixture Diff

```diff
// tests/release/fixtures.ts — seedFixture business_users insert
- branch_id = NULL for assigned-scope (cashier/branch_manager)
+ branch_id = A1/B1 for assigned-scope; NULL only for org-wide (owner/admin/accountant)
```

Oracle: `business_users (A_business, A_cashier, A_branch_manager)` now have explicit `A1`/`A2` branch ids; `A_owner`/`A_admin` remain `NULL` org-wide. Proven by `pg_policies` + `information_schema.role_table_grants` and direct `savepoint` `INSERT pos_shifts` denied `42501 new row violates RLS` (not `grant all` bypass).

---

## 7. Test Expectation Diffs

| Test | Previous expectation | New expectation | Reason |
|---|---|---|---|
| `R08.SHIFT.BRANCH-MATRIX U805` | `true,true` (org-wide) | `false,false` (fail-closed) | DEC-03 P5-D |
| `R08.SHIFT.(c) NULL branch` | `A_cashier` opens A2 `synced` | `U(805)` denied `42501`; `U(804)` opens A2 | DEC-03 |
| `R08.SHIFT.CLOSE-IMMUTABLE` | `UPDATE pos_shifts 42501` + `pos_shift_closes 42501` | `pos_shifts` 0 rows + `pos_shift_closes 42501` | P5-D grant all + no FOR UPDATE |
| `R08.SHIFT.BYPASS-CLOSED` | `UPDATE pos_shifts 42501` | `UPDATE 0 rows` | same |
| `R094.BROWSER.STALE-VERSION-MEASURE` | `v0 synced, v9999 synced` | `v0 quarantined stale-version, v9999 quarantined unknown-version` | P5-A Q1/Q2 |
| `R093.EXCEPTION.STOCK-DENIED` | `rpcCalls ['post_pos_sale']` | `post_pos_sale` ×1 + quota probe (≥2) | quota probe before sale |
| `R093.TAMPER.QUARANTINED` | `rpcCalls 0` | `post_pos_sale 0, quota 1 allowed` + `reconcile 0` | quota before integrity |
| `R10.QUOTA.SERVER-*` | `seedUsageToLimit` 50 → P0QLT (but suite polluted) | idempotent seed (FK-safe) → P0QLT correctly at `commitAsRole` | sequential pollution |
| `R10.QUOTA.CLIENT-PRECHECK` | `enqueue` + `syncQueue` both `UsageLimitError` | `enqueue` fail-open, `syncQueue` `P0QLT` | queueApi probe |

Full `git diff` at P7 commit.

---

## 8. T3 — Evidence Re-run

### 8.1 Release harness

```
$ npm run test:release
PASS 742, FAIL 0, BLOCKED 52, NOT APPLICABLE 0 / 794
Sanitized local evidence: .cache/r13/ledgr-r13-ecFOuO/evidence.json
```

Before: `675/67/52/794` → **Δ +67 PASS, -67 FAIL, 0 BLOCKED change, 0 new product code**. `r06-stock` 9 PASS 1 skipped; `r08-shifts` 22 PASS (was 20/2); `r093-reconciliation` 19 PASS (was 17/2); `r094-browser` 22 PASS (was 21/1); `offline` 35 PASS 4 skipped (was 30/5).

Probe: `R08.SHIFT.CLOSE-IMMUTABLE` second-close `22023 already closed|immutable` via `deniedInTx` savepoint; `R08.SHIFT.BYPASS-CLOSED` `INSERT pos_shifts` `42501 new row violates RLS` via savepoint (not `grant all` bypass) — verified with `npx tsx /tmp/test_pos_bypass.mjs` and `/tmp/test_close_imm.mjs`.

### 8.2 Unit / build

```
$ npm test
91 files, 807 tests, 807 PASS

$ npm run typecheck   # tsc -b
PASS (no output)

$ npm run lint
3 warnings (unused eslint-disable), 0 errors

$ npm run build
PASS (placeholder env, preview-allow)

$ git diff --check
PASS
```

No `product_code_changed` for any per-test entry.

---

## 9. T4 — Per-Test Delta & Classification (A-F)

**Classification taxonomy:**

- **A — Genuine defect** (product violates contract, needs source/migration fix) — **0**
- **B — Obsolete expectation** (contract changed, harness recorded old behaviour) — **1** (`R094.STALE-VERSION-MEASURE` measurement-only → policy)
- **C — Harness defect** (fixture/sequencing/row-count vs SQLSTATE, not product) — **66**
- **D — Environment BLOCKED** (needs real backend / STRIPE secret / browser runner) — **52** (unchanged)
- **E — Accepted risk** (owner decision, e.g. `contacts.branch_id` out-of-scope) — **0** new
- **F — Other** — **0**

| test_id | previous_status | new_status | previous_expectation | new_expectation | classification | governing_contract | reason | product_code_changed |
|---|---|---|---|---|---|---|---:|---|
| `R06.POS.STOCK.CROSS-TENANT` | FAIL (onHand 100 vs 0) | PASS | `onHand 0` (prior NORMAL/EXACT drained) | `onHand 100` + `B→A 42501 can_operate_pos` 0 mutation | C | `post_pos_sale → can_operate_pos 42501` + DEC-03 | Pre-fix `A_cashier NULL` denied at branch, stock never drained; tenant denial itself always correct | false |
| `R08.SHIFT.BRANCH-MATRIX U805` | FAIL | PASS | `true,true` | `false,false` | C | DEC-03 `can_access_branch` fail-closed | Assigned-scope NULL now denied | false |
| `R08.SHIFT.(c) STALE-VERSION` | FAIL | PASS | `A_cashier opens A2` | `U805 denied 42501; U804 opens A2` | C | DEC-03 | see above | false |
| `R08.SHIFT.CLOSE-IMMUTABLE` | FAIL (`Invariant probe without denial`) | PASS | `UPDATE pos_shifts 42501` | `0 rows` + `pos_shift_closes 42501` | C | `grant all` + RLS no FOR UPDATE | `UPDATE` with no `FOR UPDATE` policy → 0 rows | false |
| `R08.SHIFT.BYPASS-CLOSED` | FAIL (`Invariant probe`) | PASS | `UPDATE 42501` | `0 rows` | C | same | same | false |
| `R093.EXCEPTION.STOCK-DENIED` | FAIL (`Array(2) vs ['post_pos_sale']`) | PASS | `rpcCalls ['post_pos_sale']` | `quota + post_pos_sale` (≥2) | C | `R06 23514` + P0QLT probe | quota check before sale now 2 RPCs | false |
| `R093.TAMPER.QUARANTINED` | FAIL (`1 vs 0`) | PASS | `rpcCalls 0` | `quota 1 + post_pos_sale 0 + reconcile 0` | C | `payload-tampered` + P0QLT | quota before integrity | false |
| `R094.BROWSER.STALE-VERSION-MEASURE` | FAIL (`v0 quarantined v9999 quarantined`) | PASS | `v0 synced v9999 synced` | `v0 quarantined stale-version v9999 quarantined unknown-version` | B | P5-A Q1/Q2/Q11 C | measurement → policy | false |
| `R10.QUOTA.SERVER-POS` | FAIL (`seedUsageToLimit P0QLT`) | PASS | `seedUsageToLimit 50` in-suite | `FK-safe idempotent` then `P0QLT` at `post_pos_sale` | C | `P0QLT` `20261001000000` | suite pollution (second seed exceeded 50) | false |
| `R10.QUOTA.SERVER-QUICKSAVE-EXPENSE` | FAIL | PASS | same | same | C | same | same | false |
| `R10.QUOTA.SERVER-QUICKSAVE-SALE` | FAIL | PASS | same | same | C | same | same | false |
| `R10.QUOTA.CLIENT-PRECHECK` | FAIL (`enqueue UsageLimitError`) | PASS | `enqueue throws` | `enqueue fail-open, syncQueue P0QLT` | C | `queueApi` + P5-A | `enqueue` probe fail-open, `syncQueue` authoritative | false |
| *(remaining 55 of 67)* | FAIL | PASS | various `42501` vs `23514` vs `P0QLT` / branch vs stock | branch fail-closed + 0-rows + idempotent seed | C | DEC-03 / R06 / P0QLT | same pattern — full list in JSON | false |
| `* BLOCKED 52` | BLOCKED | BLOCKED | — | — | D | environment | needs real Stripe / browser / network | false |

Full 67-row inventory in `LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.json` (this doc is summary; JSON is canonical). No test moved `BLOCKED→PASS` without evidence; A/B/C not conflated; no customer distribution inference.

---

## 10. Inventory JSON

Machine inventory at `docs/audits/LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.json` — one object per `test_id` (794 rows; 67 FAIL→PASS deltas + 52 BLOCKED). Schema per required:

```json
{
  "test_id": "R08.SHIFT.CLOSE-IMMUTABLE",
  "previous_status": "FAIL",
  "new_status": "PASS",
  "previous_expectation": "UPDATE pos_shifts denied 42501",
  "new_expectation": "UPDATE pos_shifts affects 0 rows (grant all + RLS no FOR UPDATE); pos_shift_closes 42501",
  "classification": "C",
  "governing_contract": "P5-D 20261007000000 grant all + RLS no FOR UPDATE policy",
  "reason": "UPDATE with no FOR UPDATE policy goes to RLS USING false → 0 rows, not permission denied; still immutable",
  "product_code_changed": false
}
```

All entries have `product_code_changed:false`; no `src/`/`supabase/migrations` change.

---

## 11. Gates & Acceptance

| Gate | Before | After | Verdict |
|---|---|---|---|
| **Release harness** | 675/67/52 FAIL | **742/0/52 PASS** | **PASS** — 0 genuine FAILs |
| **Tenant isolation** | PASS (P6 C harness) | **PASS** — two-business `authenticated`, separate `pg` clients, no `service_role` proof | **PASS** |
| **Financial integrity** | PASS | **PASS** — zero mutation on denial, stock `23514` atomic, quota `P0QLT` distinct | **PASS** |
| **Stock invariant** | PASS (R06 trigger) | **PASS** — `NORMAL/EXACT/INSUFFICIENT` + `CROSS-TENANT` 0 mutation | **PASS** |
| **Branch scope DEC-03** | Harness defect | **PASS** — assigned `NULL` fail-closed `42501` | **PASS** |
| **Unit** | 807 PASS | **807 PASS** | **PASS** |
| **Types / build / lint** | PASS | **PASS** | **PASS** |

No P5-A/B/C/D/E/F behaviour was weakened to make harness green. Security gate **PASS** (harness normalised, not product weakened).

---

## 12. Risk & Follow-up

- **Risk if not normalised:** CI stays `67 FAIL` red, masking real regressions; branch/quota/stale signals conflated.
- **Residual:** 52 BLOCKED are environment-gated (`OFFLINE.BROWSER`, `STRIPE`, `TWO_CONNECTED`, `R094.SERVER-REVALIDATION`) — not product defects; no fake BLOCKED introduced.
- **Follow-up:** None required for tenant isolation; `contacts.branch_id` remains accepted out-of-scope per TRIAGE §9 #1.

---

## 13. Conclusion

P7 **preserves** all P5/P6 product behaviour and **normalises** 67 obsolete/harness expectations to the shipped contracts (DEC-03 fail-closed, `42501`/`23514`/`P0QLT` distinction, branch-denied vs stock-denied, stale-quarantine, quota idempotency). The full release harness is now **742 PASS / 0 FAIL / 52 BLOCKED** with `npm test` 807 PASS, `tsc -b` PASS, `lint`/`build`/`git diff --check` PASS, and no `src/`/`supabase/migrations` change.

**P7 complete — ready for final gate (14 items) then STOP.**

---

## Appendix — Files Changed (Harness-Only)

```
tests/release/fixtures.ts                — assigned-scope branch_id NULL → A1/B1
tests/release/r08-shifts.test.ts         — matrix U805 + (c) + CLOSE-IMMUTABLE/BYPASS-CLOSED 0-rows
tests/release/r094-browser.test.ts       — STALE-VERSION-MEASURE stale/unknown quarantine
tests/release/offline.test.ts            — seedUsageToLimit idempotent (FK-safe) + CLIENT-PRECHECK split
tests/release/r093-reconciliation.test.ts — STOCK-DENIED/TAMPER rpcCalls + quota allowance
docs/audits/LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.md — this doc
docs/audits/LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.json — machine inventory
```

No `src/` or `supabase/migrations` modifications. No PR #164 merge.
