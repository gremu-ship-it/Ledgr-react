# LEDGR — P4 OWNER DECISION RECORD (SIGNED)

**Date:** 2026-09-24
**Owner:** Alexander Gremu
**Source:** `docs/audits/LEDGR_P4_OWNER_DECISION_RESOLUTION_2026-09-24.md` (1158L, §1–§10, 15-question sheet) — authoritative options
**Baseline re-verified at signing:** `HEAD e36e46e2c6bb4f3204b27cfe57c86ba31c335881` == `bc97e32` baseline + docs-only `befab28→e36e46e` (778L P4, 97K, 13 sections), gate `b9d41ec854a1` (742 PASS / 0 FAIL / 40 BLOCKED / 782), `git diff --stat HEAD` empty for `src/* supabase/*`
**Channel:** Owner reply 2026-09-24 (chat) — 15 explicit selections (Q1–Q15) quoted verbatim below
**Status:** DECISIONS RECORDED — NO PRODUCT CODE CHANGED IN THIS RECORD (analysis-only record). Implementation remains blocked until separate implementation commits.

---

## Verbatim Owner Selections

```
Q1: B — Typed exception stale-version
Q2: B — Typed exception unknown-version
Q3: A — Version exceptions never reconcilable
Q4: A — Indefinite retention
Q5: N/A
Q6: N/A
Q7: N/A
Q8: C — Typed exceptionClass, but ordinary failed
Q9: B — Typed stale-version
Q10: B — clientKey-payload-mismatch / payload-tampered
Q11: D — Never expand RECONCILABLE automatically
Q12: B — Uniform P0QLT enforcement
Q13: C — Capture-time + authoritative server posting check
Q14: B — Optional branch filter
Q15: B — After BRANCH.* / P8
```

---

## §1 Interpreted Decision Table (with option labels as in Resolution §2 / §7)

| # | Decision | Owner Choice | Full Option Name (per Resolution) | Notes / Consistency |
|---|---|---|---|---|
| **Q1** | DEC-09 stale `< current` | **B** | Typed exception `stale-version` (quarantine, visible, not retried, Model 3) | `payloadVersion < QUEUE_PAYLOAD_VERSION (=1)` → `quarantined` + `exceptionClass='stale-version'` + `quarantineReason` not `failed` infinite loop nor `delete`. Distinct from `missing-provenance` (`null`). |
| **Q2** | DEC-09 future `> current` | **B** | Typed exception `unknown-version` (quarantine, visible, not retried, Model 3) | `payloadVersion > 1` (e.g. `9999` → `unknown-version` quarantine). Combined with Q1 = `!== current` is quarantined, but as two typed classes not single bucket. |
| **Q3** | DEC-09 reconcilability | **A** | Keep `RECONCILABLE=['stock-denied','policy-denied']` (version exceptions **never** reconcilable / permanently non-reconcilable) | Version-typed `stale-version`/`unknown-version` are **never** `isReconcilable`, never `reconcile_offline_queue_item`, like `missing-provenance`/`payload-tampered`. No re-hydration nor new-capture via `reconcile`; user must create fresh `clientKey` via new `enqueue` if needed. |
| **Q4** | DEC-TTL retention | **A** | Indefinite retention (keep current, no TTL, `failed` retries forever via `recoverStaleSyncClaims`, `quarantined` until reconciled, `MAX_PENDING 2000` + `STALE_SYNC 2m` + `LEASE 30s` bounds only) | No TTL. |
| **Q5** | DEC-TTL threshold | **N/A** | — (only if Q4=B) | Correctly N/A because Q4=A. T0 none / indefinite applies. No `QUEUE_TTL_MS`. |
| **Q6** | DEC-TTL disposition | **N/A** | — (only if TTL) | Correctly N/A. No `expired` `quarantineReason`/`delete`/`failed`/`new capture`. |
| **Q7** | DEC-TTL reconcilability | **N/A** | — (only if Q6=quarantine) | Correctly N/A. No `expired` `RECONCILABLE` decision. |
| **Q8** | OFFLINE.CONFLICT ordinary vs typed | **C** | Non-`RECONCILABLE` ordinary `failed` with `exceptionClass` typed but not `quarantined` | `42501` (`can_operate_pos`/`can_access_branch`)/`22023` product/terminal `22023` terminal-mismatch cease to be untagged `failed`; they become `failed` + `exceptionClass='branch-denied'` / `'terminal-denied'` etc. **but not** `quarantined`, and **not** `RECONCILABLE` (per Q11 D). Stops anonymous loop but remains `failed` visibility (never retried as typed `failed`? — see P4: typed `failed` today is not retried like `stock-denied`/`policy-denied`; to be specified as typed `failed` that is not retried, distinct from ordinary `pending→failed→syncing→failed` loop). |
| **Q9** | OFFLINE.CONFLICT payload-version typed | **B** | Typed `stale-version` of Q1 | Explicitly makes class 7 a typed conflict — consistent with Q1 B / Q2 B. Same quarantine vs typed-`failed` semantics as Q1/Q2 (quarantine per Q1/Q2 B). |
| **Q10** | OFFLINE.CONFLICT same `clientKey` + different payload | **B** | Typed exception `clientKey-payload-mismatch` / `payload-tampered` (`quarantined` + `quarantineReason`) | Same `clientKey 6001` + `line_total 1500→9999` ceases to be silent `idempotent:true count 1 no hash compare (dee7abf8)`; it becomes typed `quarantined` `payload-tampered` / `clientKey-payload-mismatch` (`quarantineReason`, never retried, permanently non-reconcilable) via `payloadHash` per `client_key` + `post_pos_sale` hash compare. |
| **Q11** | OFFLINE.CONFLICT RECONCILABLE | **D** | Never expand `RECONCILABLE` automatically (freeze at `['stock-denied','policy-denied']`, typed but permanently non-reconcilable along `missing-provenance`/`corrupt-payload`) | Typed expansions from Q8 (`branch-denied`)/Q9 (`stale-version`)/Q10 (`clientKey-payload-mismatch`) are **never** added to `RECONCILABLE_EXCEPTION_CLASSES` automatically. They remain permanently non-reconcilable (`quarantined` or typed `failed` never `isReconcilable`), like `missing-provenance`/`payload-tampered`/`legacy`. Combined with Q3 A: no `RECONCILABLE` expansion for version either. |
| **Q12** | BILLING quota scope | **B** | Uniform `P0QLT` (every `invoices`/`expenses`/`payroll_runs` INSERT) | `_ledgr_assert_usage_limit` ceases to be POS+quick-only (`post_pos_sale`/`save_quick_sale`/`save_quick_expense`+`execute_pending_payroll_run`); it must be added to all `INSERT` paths: `InvoiceRepository.createWithLines`/`BusinessRepository.reserveDocumentNumber`+`createWithLines`/`PayrollRepository`/direct `supabase.from(...).insert`/`BEFORE INSERT` trigger — `P0001`/success becomes `P0QLT` when over `plan_tier` (free 50). Fixes `payroll_runs` counted-but-not-metered and RLS `head:true` vs `ledgr_monthly_document_count` divergence. |
| **Q13** | BILLING quota authority | **C** | Both (entitlement at `enqueue` + authoritative `post_pos_sale` authority) | Quota checked **both** at capture time (`queueApi.ts` `enqueue` offline `UsageService.assertCanCreateDocument` / `ledgr_monthly_document_count` security-definer entitlement/command, `policy-denied` before `post_pos_sale`) **and** at server posting time (inside `post_pos_sale`/`save_quick_*`/uniform `BEFORE INSERT`, atomic `P0QLT` with `detail`/`hint`). Fixes concurrent `count(*)` without `FOR UPDATE` race and offline capture without warning, while preserving authoritative rollback. |
| **Q14** | AI.BRANCH scope | **B** | Optional branch filter (read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check) | `ai_context` gains optional `branch_id?` (or `ai_branch_context` RPC) — `null` = org-wide as today, `A1` = `can_access_branch(business_id, branch_id)`-checked branch-filtered `WHERE branch_id` KPIs (`invoices.branch_id`/`inventory_locations.branch_id`); no new RLS; reuse `can_access_branch()`; read-only not remediation. |
| **Q15** | AI.BRANCH timing vs P8 | **B** | After `BRANCH.*` / `P8` (coherent, branch AI and branch writes share `can_access_branch()`, 8 `BRANCH.*` escapes closed) | Branch-aware AI ships **after** `P8` closes 8 `R08.BRANCH.* BLOCKED`. AI `WHERE branch_id` + `can_access_branch` is coherent with writes (`INSERT`/`UPDATE`/`SELECT` on `invoices`/`expenses`/`inventory`/`customers` `WHERE branch_id` + `can_access_branch`). `R11` `WHERE branch_id` metric-consistency proven after `P8`. `DEC-03` one-vs-multi respected. |

---

## §2 Consistency & Cross-Checks

- **Q1 B + Q2 B + Q3 A + Q9 B + Q11 D →** Version-typed `stale-version`/`unknown-version` are quarantined/typed-`failed` **permanently non-reconcilable**. Consistent with `offline_queue_reconciliations` CHECK **not** expanded for version, `RECONCILABLE` frozen, drawer shows `stale-version`/`unknown-version` with no Reconcile button, `hasTrustworthyProvenance` branching `payloadVersion < /> QUEUE_PAYLOAD_VERSION` will quarantine.
- **Q4 A → Q5–Q7 N/A →** No TTL. Correct: `pruneSyncedItems(7d)` stays manual-only for `synced`; `MAX_PENDING 2000` / `STALE_SYNC 2m` / `LEASE 30s` remain sole bounds. No `expired` class.
- **Q8 C + Q11 D →** `42501`/`22023` become typed `exceptionClass='branch-denied'`/`'terminal-denied'` as `failed` (not `quarantined`) **but not** `RECONCILABLE`. This matches P4 description of Option C: typed `failed` that is never retried (unlike ordinary loop) but also never `isReconcilable` (so `RECONCILABLE` not expanded). Requires `classifyReplayException` branching, not quarantine.
- **Q10 B + Q11 D →** `clientKey-payload-mismatch` is `quarantined` + `quarantineReason` **permanently non-reconcilable** (`payloadHash` per `client_key` storage + `post_pos_sale` hash compare → `22023` before audit). Consistent with never expanding `RECONCILABLE`.
- **Q12 B + Q13 C →** Uniform metering (all `invoices`/`expenses`/`payroll_runs` `INSERT`s) **plus** dual authority (capture-time entitlement `enqueue` + authoritative `P0QLT` inside posting RPC/trigger). This fixes all currently uncovered paths (Q12) and fixes race + offline warning (Q13). Requires `ledgr_monthly_document_count` vs `head:true` alignment, `billing/page.tsx` copy update, and `FOR UPDATE` consideration for concurrency.
- **Q14 B + Q15 B →** Optional branch filter after `P8`. Coherent: `can_access_branch()` reused without new RLS, `R11` branch lane after `P8`, no `canViewReports` expansion for `cashier` until explicitly decided after `P8` (keeps 12 `v_reports_roles` until post-`P8`).

No contradictions detected. `NO CUSTOMER POPULATION INFERENCE PERMITTED` — thresholds remain “NOT EVIDENCED — no customer population inference permitted” per P4.

---

## §3 What This Record Does / Does Not Do

- **Does:** Records owner’s explicit choices for all 15 decisions against the same baseline `bc97e32` / `e36e46e` / `b9d41ec854a1` (742/0/40/782). Serves as binding input for downstream implementation planning (Model 3/Model 4/R09.4/R11/P8/DEC-03/DEC-07/DEC-10/R02/billing/offline) per dependency map `§6`.
- **Does NOT:** Change any `src/*`, `supabase/*`, `src/offline/*` (`QUEUE_PAYLOAD_VERSION`/`hasTrustworthyProvenance`/`sweepUnverifiableItems`), `supabase/migrations/*` (`_ledgr_assert_usage_limit`/`post_pos_sale`/`offline_queue_reconciliations`/`reconcile_offline_queue_item`/`payloadHash`/`can_write_business_data`/`can_access_branch`), `supabase/functions/ai-chat`, `src/hooks/usePermissions.ts`/`src/components/ai/*`, `billing/page.tsx`, `tests/*`, `.github/*`, `package.json`, schema, RLS, Edge, AI, billing, offline, TTL, version, branch, CI. `git diff --stat HEAD` remains docs-only.

---

## §4 Filled Sheet (mirrors Resolution §7 for audit)

| # | Decision | Choice (now filled) |
|---|---|---|
| Q1 | DEC-09 stale `< current` | **B** — Typed `stale-version` |
| Q2 | DEC-09 future `> current` | **B** — Typed `unknown-version` |
| Q3 | DEC-09 reconcilability | **A** — Never reconcilable |
| Q4 | DEC-TTL retention | **A** — Indefinite retention |
| Q5 | DEC-TTL threshold | **N/A** (Q4=A) |
| Q6 | DEC-TTL disposition | **N/A** (Q4=A) |
| Q7 | DEC-TTL reconcilability | **N/A** (Q4=A) |
| Q8 | OFFLINE.CONFLICT ordinary vs typed | **C** — Typed `exceptionClass` but ordinary `failed` |
| Q9 | OFFLINE.CONFLICT payload-version typed | **B** — Typed `stale-version` (consistent Q1) |
| Q10 | OFFLINE.CONFLICT same `clientKey` + diff payload | **B** — `clientKey-payload-mismatch` / `payload-tampered` |
| Q11 | OFFLINE.CONFLICT RECONCILABLE | **D** — Never expand automatically |
| Q12 | BILLING quota scope | **B** — Uniform `P0QLT` |
| Q13 | BILLING quota authority | **C** — Capture-time + authoritative posting |
| Q14 | AI.BRANCH scope | **B** — Optional branch filter |
| Q15 | AI.BRANCH timing | **B** — After `BRANCH.*` / `P8` |

**Owner signature (recorded via chat 2026-09-24):** Alexander Gremu — explicit selections above. Formal wet signature to be added on PDF export if required.

---

## §5 Next Steps (await explicit Implementation Authorization before code)

No implementation started in this commit. Authorized next phase (requires separate `GO` from Alexander) is to produce implementation plan + branch:

1. **Model 3** — new typed `exceptionClass`/`quarantineReason`: `stale-version` (Q1/Q9), `unknown-version` (Q2), `branch-denied`/`terminal-denied` as typed `failed` (Q8 C), `clientKey-payload-mismatch`/`payload-tampered` `quarantined` (Q10 B), with `hasTrustworthyProvenance`/`sweepUnverifiableItems`/`classifyReplayException`/`payloadHash` per `client_key`/`post_pos_sale` hash compare changes.
2. **Model 4** frozen — confirm `RECONCILABLE_EXCEPTION_CLASSES` stays `['stock-denied','policy-denied']` (Q3 A + Q11 D) — no `reconcile_offline_queue_item`/`offline_queue_reconciliations` expansion for version/branch/mismatch; document permanent non-reconcilable semantics and `OfflineQueueDrawer` “no Reconcile” for those classes.
3. **BILLING uniform + dual authority (Q12 B + Q13 C)** — add `_ledgr_assert_usage_limit` to all `INSERT` paths (`createWithLines`/builder/`PayrollRepository`/trigger), fix `ledgr_monthly_document_count` vs `head:true` + `billing/page.tsx` copy, add capture-time `enqueue` entitlement check, address `count(*)` without `FOR UPDATE` race.
4. **AI.BRANCH optional after P8 (Q14 B + Q15 B)** — `P8` first (8 `R08.BRANCH.*` `can_access_branch` closures), then `ai_context(business_id, branch_id?)` / `ai_branch_context` with `can_access_branch` check, `WHERE branch_id` KPIs without new RLS, `R11` `WHERE branch_id` lane after `P8`, `DEC-03` one-vs-multi.
5. **R09.4/R11** — extend browser through `post_pos_sale` with stale-shape + `WHERE branch_id` metric consistency after `P8`.

Do not start `P5`/`P6`/`R11`/`R14`/`GAP-6`/`R02`/`P8`/`P9`/`R15` code until `GO`.

---

## §6 STOP

This record is complete. **WAIT** for `GO` before any `src/supabase` implementation.
