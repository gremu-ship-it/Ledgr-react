# P9 — Owner Decision Final Record

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)
**Baseline commit (P9 start):** `268fd67` `P9: prepare owner release decision` (parent `dc80e1c` P8, `874c6df` P7, `090870b` P6) — branch `arena/01a0c215-ledgr-react`
**Decision timestamp:** 2026-09-24T10:45:00+02:00 (Africa/Johannesburg) — recorded via Arena ask_user Q1–Q9
**Evidence baseline (unchanged):** `742 PASS / 0 FAIL / 52 BLOCKED / 794` at `.cache/r13/ledgr-r13-ecFOuO/evidence.json` + `807 PASS` unit + `tsc -b` PASS + `lint` 0 errors / 3 warnings + `build` PASS + P8 `A 0, B 21, C 15, D 4, E 0, F 12`
**Mode:** **RECORD ONLY** — no `src/` / `supabase/` / `tests/` / RLS / SECURITY DEFINER / migrations / harness / runtime changes. P6/P7/P8/P9 preparation evidence preserved; this document adds only the owner answers and approved scope.

> This record formally captures the owner's **GO** for the **Limited Controlled Release Scope** as defined in P9 §3/§6, with all 21 environment blockers, 15 accepted limitations, and 4 deferred owner-decision items explicitly accepted as `OUT OF RELEASE SCOPE` for this release. It does **not** rewrite historical P6/P7/P8 evidence.

---

## Baseline Commit

```
commit 268fd67  P9: prepare owner release decision
parent dc80e1c  P8: classify final blocked release evidence
       874c6df  P7: normalize release harness and re-prove release
       090870b  P6 audit — Cross-Tenant Isolation Evidence (efa8b54) — C harness, no genuine tenant bypass
branch arena/01a0c215-ledgr-react
evidence 742 PASS / 0 FAIL / 52 BLOCKED / 794 (.cache/r13/ledgr-r13-ecFOuO/evidence.json)
         807 PASS / 0 FAIL unit (91 files)
         tsc -b PASS, lint 0 errors, build PASS, git diff --check PASS
P8 classification: A 0, B 21, C 15, D 4, E 0, F 12 — 0 remediation candidates, 0 security-critical, 0 financial-integrity blockers
```

---

## Owner Answers Q1–Q9 (verbatim, no inference)

| Question | Text | Answer |
|---|---|---|
| **Q1** — RELEASE SCOPE | Do I approve the proposed **Limited Controlled Release Scope** described in P9? | **YES** |
| **Q2** — ENVIRONMENT BLOCKERS (21) | Do I accept the 21 Class-B environment limitations as deferred evidence for the defined limited release? (R094 2 + TENANT.storage 2 + AUTH 4 + PRIV 4 + R02 provider-token 9) | **YES** |
| **Q3** — ACCEPTED LIMITATIONS (15) | Do I accept the 15 Class-C limitations for the defined release scope? (BRANCH 5 + OFFLINE 4 + R06.CONCURRENT 1 + AI.BRANCH 1 + R02.DEC-02/OTP 4) | **YES** |
| **Q4** — BRANCH ADMINISTRATION (3) | Do I explicitly defer `BRANCH.create` / `BRANCH.cross-branch-admin` / `BRANCH.modify` outside the current release scope? | **YES** |
| **Q5** — BILLING | Do I accept the current release boundary where tested server quota (P0QLT) is certified but the complete commercial billing/subscription lifecycle (`BILLING.SERVER-QUOTA`) remains deferred? **Mode:** | **YES** — **PILOT / LIMITED CONTROLLED USERS** (not Full Commercial) |
| **Q6** — STORAGE | Do I accept that Storage isolation remains unverified and Storage-dependent security claims are excluded? | **YES** |
| **Q7** — PROVIDER AUTHENTICATION | Do I accept that provider-specific AUTH/PRIV/R02 evidence remains environment-blocked and outside the current certification boundary? | **YES** |
| **Q8** — BROWSER/SERVER REVALIDATION | Do I accept that the two R094 browser→PostgREST→JWT tests remain unverified and outside the current certification boundary? | **YES** |
| **Q9** — RELEASE DECISION | Choose exactly one: GO / CONDITIONAL GO / NO-GO | **GO** — Release the defined limited scope |

**Consistency check (per P9.1 §4):** No contradictions — Q1 YES + Q9 GO consistent; Q2 YES + Q9 GO with explicit treatment of 21 blockers (§7) consistent; Q5 PILOT (not FULL COMMERCIAL) with deferred `BILLING.SERVER-QUOTA` consistent (Q5 FULL would have been contradiction); Q6 YES with Storage excluded from certified scope consistent; Q7 YES with provider claims excluded consistent; Q8 YES with browser revalidation excluded consistent. No owner clarification needed. No contradictions to return.

---

## Approved Scope (ENGINEERING PROVEN + OWNER ACCEPTED)

The following capabilities are **Release-certified** for this **Limited Controlled Release** and are **PROVEN** by P5–P8 evidence **and** **ACCEPTED** by owner Q1 YES:

- **Tenant isolation** — P6 two-business `authenticated` + separate `pg` clients, `relrowsecurity true` + `is_business_member` on 6 tenant tables, SECURITY DEFINER `post_pos_sale`/`reconcile_offline_queue_item` with `auth.uid()` + `request.jwt.claim.sub`/`role` — **PROVEN**, **ACCEPTED**
- **POS sales / till operations** — R06/P6/P7 `post_pos_sale` `42501`/`23514`/`P0QLT`, till `pos_shifts` — **PROVEN**, **ACCEPTED**
- **Inventory / stock integrity** — R06 `trg_stock_movement_apply_balance` `FOR UPDATE` `23514`, `R06.POS.STOCK.*` 9 PASS + `REPLAY`/`ATOMIC`, `R093` stock-denied — **PROVEN**, **ACCEPTED**
- **Branch authorization — till family** — P5-D `can_access_branch` DEC-03 fail-closed, P7 `A_cashier→A1`/`A_branch_manager→A2` matrix `U805 false,false`, `R08.SHIFT.BRANCH-SCOPED-READ` — **PROVEN**, **ACCEPTED**
- **Sales and payments** — R06/P7 — **PROVEN**, **ACCEPTED**
- **Customers/suppliers where currently implemented as org-wide** — P6/P7 — **PROVEN** as org-wide, **ACCEPTED** (BRANCH.customers deferred is app-wide branch)
- **Financial reporting** — R05 + R08 `ZREPORT.RECONCILES-TENDERS` + POS shift report `42501` branch-enforced — **PROVEN** as org-wide except POS report branch, **ACCEPTED**
- **POS corrections/refunds/voids + till/shift integrity** — R07 + R08 `SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE` `22023`/`BYPASS-CLOSED` 0-rows — **PROVEN**, **ACCEPTED**
- **Offline queue/reconciliation within `RECONCILABLE` contract** — P5-B `reconcile_offline_queue_item` manager-tier `42501` + `isReconcilable` `stock-denied|policy-denied` only (Q3/Q11), P6 `R093.RECON.*` 9 PASS — **PROVEN within contract**, **ACCEPTED**
- **Billing/quota within tested `P0QLT`** — P5-C Q12 B uniform `P0QLT` `20261001000000` on `post_pos_sale`/`save_quick_*` + `BEFORE INSERT` + `ledgr_monthly_document_count` vs `head:true` + Q13 C dual authority, `R10.QUOTA.*` 5 PASS — **PROVEN within tested POS/quick contract**, **ACCEPTED** for PILOT per Q5
- **AI/business reporting with branch controls** — P5-E `ai_context(business_id, branch_id?)` optional `can_access_branch` read-only non-authoritative, after P8 per Q14/Q15 — **PROVEN within contract**, **ACCEPTED**
- **Multi-business tenant isolation** — P6/P7 `TENANT.A/B.*` 10 PASS (pos/read/update/delete) via `is_business_member` — **PROVEN**, **ACCEPTED** (excluding Storage per Q6)

**All above are both `ENGINEERING PROVEN` and `OWNER ACCEPTED` → `Release status: CERTIFIED`.**

---

## Excluded Scope (OUT OF RELEASE SCOPE — not removed from code)

The following capabilities are **Implemented** (exist in code, work in development) but are **OUT OF RELEASE SCOPE** for this limited release — **not** `Release-certified`. They are **OWNER ACCEPTED as EXCLUDED** per Q2–Q8 YES and remain **BLOCKED** or **DEFERRED**, not **PASS**:

| Capability | Evidence status | Owner acceptance | Release status |
|---|---|---|---|
| **Storage isolation** (`storage.objects` RLS, path, signed URL) | **BLOCKED B** 2 — `TENANT.A/B.storage` — no Storage infrastructure, DB RLS does not prove `storage.objects` | **ACCEPTED YES** (Q6) | **EXCLUDED** — Storage-dependent security claims excluded |
| **Provider authentication** (`AUTH.valid-login`/`expired-session`/`logout-revocation` + `PRIV.*` + `R02.PROVIDER-TOKEN.*` 9) | **BLOCKED B** 17 — no isolated GoTrue (`auth.users`) | **ACCEPTED YES** (Q7) | **EXCLUDED** — provider-specific claims excluded; tenant membership via `pg` mock-JWT + RLS is proven instead |
| **Browser/server revalidation** (`R094` 2× `B` CRITICAL) | **BLOCKED B** — no wire-reachable PostgREST/GoTrue/JWT in sandbox | **ACCEPTED YES** (Q8) | **EXCLUDED** — rely on P6 DB authority + stub client-path, not browser→JWT→RLS |
| **Full commercial billing lifecycle** (`BILLING.SERVER-QUOTA` `D`) | **OWNER DECISION D** — canonical billing command not defined (POS/quick `P0QLT` is proven) | **ACCEPTED YES** (Q5 PILOT) | **EXCLUDED** — limited to tested POS/quick `P0QLT`; full subscription deferred |
| **App-wide branch admin** (`BRANCH.create`/`modify`/`cross-branch-admin` 3× `D`) | **OWNER DECISION D** — writer `can_write_*` org-wide escape, till family sealed but `branches` not | **ACCEPTED YES** (Q4) | **EXCLUDED** — till via `post_pos_sale` certified; app-wide admin deferred |
| **Branch-scoped customers/financial/inventory/reports beyond till** (5× `C`) | **ACCEPTED LIMITATION C** — R08.7 audit: org-wide intentional, till family only | **ACCEPTED YES** (Q3) | **EXCLUDED** — org-wide is current contract |
| **Generic offline conflict/multitab/browser process + concurrent stock 2-client** (`OFFLINE` 4 + `R06.CONCURRENT` 1) | **ACCEPTED C** — no approved contract / honest harness | **ACCEPTED YES** (Q3) | **EXCLUDED** — P5-A/B proven, generic not contract |
| **AI branch after P8** (`AI.BRANCH` `C`) | **ACCEPTED C** — Q14/Q15 B after P8 | **ACCEPTED YES** (Q3) | **EXCLUDED** until implemented |

**Acceptance does NOT convert `BLOCKED` into `PASS`.** Example:

```
Storage isolation
    Evidence: BLOCKED B (no Storage infrastructure)
    Owner acceptance: YES (Q6)
    Release status: EXCLUDED (Storage claims not certified)
— NOT: Evidence PASS
```

Apply this principle throughout: `OWNER ACCEPTED` ≠ `ENGINEERING PROVEN`.

---

## Accepted Limitations (Class C — 15)

Owner **ACCEPTED YES** (Q3) for the defined release scope; each is **not a defect** per P8:

- `BRANCH.customers` — contacts org-wide `can_write_business_data` (contacts.branch_id out-of-scope per R08.7/P6) — normal use unaffected, not security, not financial
- `BRANCH.financial` — journal org-wide intentional, POS shift report branch-enforced only — same
- `BRANCH.inventory` — stock_movements org-wide, `23514` invariant + POS branch proven — honest limitation per R08.7
- `BRANCH.read` — core org-wide `is_business_member` SELECT, till family `can_access_branch` only — do-not-expand per R08.7
- `BRANCH.reports` — POS report proven, other reports org-wide intentional
- `OFFLINE.ACTOR-BINDING` — no durable originating-user/device contract for generic queue — P5-A provenance is contract
- `OFFLINE.BROWSER` — fake IndexedDB not browser process proof — P5-F `R094.BROWSER.SW.*` 8 PASS is current
- `OFFLINE.CONFLICT` — no generic conflict contract — Q8/Q10 typed
- `OFFLINE.MULTITAB` — no generic workers — lease proven, workers are R11 future
- `R06.POS.STOCK.CONCURRENT` — concurrent `FOR UPDATE` needs 2-client harness — sequential `23514` proven, honest limitation
- `AI.BRANCH` — deferred until after P8 per Q15
- `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` — DEC-02 single-owner, no SMS/OTP per P4
- `R02.RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` / `SUBSTITUTED-TARGET-DENIED` / `WRONG-DENIED` — no OTP mechanism per P4

All 15 are **ENGINEERING `C` + OWNER `ACCEPTED` → `Release status: ACCEPTED LIMITATION` (not certified, not scheduled).

---

## Deferred Evidence (Class B 21 + Class D 4)

**Owner DEFERRED per Q2, Q4, Q5, Q6, Q7, Q8 YES** — each remains `BLOCKED`/`DEFERRED`, not `PASS`, and is **OUT OF RELEASE SCOPE** for this limited release:

| Group | Count | Test IDs | Why deferred | What would discharge |
|---|---|---|---|---|
| **R094 browser/server** | 2 | `R094.BROWSER.SERVER-REVALIDATION` (2) | No wire-reachable PostgREST/GoTrue/JWT (embedded-postgres process-local) — P5-F investigation | Docker Supabase + GoTrue + PostgREST + `request.jwt.claim.sub`/`role` + browser test `browser → real JWT → real RLS` |
| **TENANT.storage** | 2 | `TENANT.A/B.storage` | No Storage (`storage.objects` RLS) + effective `business_users` grants | Real Supabase Storage + `storage.objects` RLS + path isolation test |
| **AUTH** | 4 | `AUTH.*` | No isolated GoTrue | Isolated Auth service (`auth.users`) + real `valid-login`/`expired-session`/`logout-revocation` |
| **PRIV** | 4 | `PRIV.*` | No Auth Admin + delivery | Auth Admin + phone verification + invitation lifecycle |
| **R02 provider-token** | 9 | `R02.PROVIDER-TOKEN.*` | No recovery service/delivery | Isolated recovery service + Edge admin + delivery |
| **BRANCH admin** | 3 | `BRANCH.create`/`cross-branch-admin`/`modify` | Writer org-wide escape per R08.7 — needs policy reshape | Owner decision per Q14/Q15 + `can_access_branch` on writer policies + direct-API audit |
| **BILLING canonical** | 1 | `BILLING.SERVER-QUOTA` | Generic command not defined per Q12/Q13 — POS/quick `P0QLT` proven | Canonical command/approval/entitlement per Q12 B + Q13 C + `_ledgr_assert_usage_limit` on generic paths + concurrency/`FOR UPDATE` + idempotency |

**Total deferred evidence:** `21 B` + `4 D` = `25 BLOCKED` remain deferred, but **do not affect the defined limited scope** because the associated capabilities are excluded (§5 second table).

---

## Billing Mode

**Owner answer Q5:** **YES — PILOT / LIMITED CONTROLLED USERS** (explicit, not Full Commercial).

- **Tested authoritative server quota enforcement:** `P0QLT` `20261001000000` uniform on `post_pos_sale`/`save_quick_sale`/`save_quick_expense`/`execute_pending_payroll_run` + `BEFORE INSERT` + `ledgr_monthly_document_count` — **PROVEN** (5 PASS `R10.QUOTA.*`) and **CERTIFIED** for this pilot scope.
- **Complete commercial billing/subscription/entitlement lifecycle:** `BILLING.SERVER-QUOTA` generic command — **NOT certified**, **DEFERRED** as `D` (see Deferred Evidence).
- **Commercial mode:** **PILOT / LIMITED CONTROLLED USERS** — quota is enforced (`P0QLT`), subscription is manually managed/invited, Stripe/payment recovery not certified. Full Commercial would require `BILLING.SERVER-QUOTA` package (Future Package E) — owner explicitly did **not** choose Full Commercial (Q5 FULL not selected).

---

## Release Decision

**Owner answer Q9:** **GO — Release the defined limited scope** (all Q1–Q8 YES, no conditions).

- **Approved scope:** Limited Controlled Release as defined in `P9 §3` and `LEDGR_P9_OWNER_RELEASE_DECISION_2026-09-24.md` §3/§6 — see Approved Scope above.
- **Explicit exclusions:** Storage, provider-specific AUTH, browser/server revalidation, app-wide branch admin, full commercial billing, branch-scoped customers/financial/inventory/reports beyond till, generic offline conflict/multitab, legacy — see Excluded Scope.
- **Accepted limitations:** All 15 `C` per Q3 YES — see Accepted Limitations.
- **Deferred evidence:** All 21 `B` + 4 `D` per Q2, Q4, Q6, Q7, Q8 YES — see Deferred Evidence.
- **Billing mode:** PILOT / LIMITED CONTROLLED USERS per Q5 PILOT.
- **Conditions:** **None** — owner selected `GO` (not `CONDITIONAL GO`). No conditions to implement before release.

**This GO does not imply:** Storage proven, provider Auth proven, browser→JWT→RLS proven, app-wide branch admin sealed, or full commercial billing lifecycle proven. Those remain `BLOCKED`/`DEFERRED` and `OUT OF RELEASE SCOPE` per P9.1 §6.

---

## Conditions (only if CONDITIONAL GO)

**Not applicable** — Q9 was `GO` (unconditional). No conditions to record.

If Q9 had been `CONDITIONAL GO`, conditions would be recorded here (e.g., “real Storage verification within 30 days before expanding to Storage-dependent claims”).

---

## Future Authorized Packages

No package is authorized by this `GO` for the limited scope. The following packages remain **deferred** and **require separate explicit owner authorization** (`GO`) before any `src/`/`supabase` implementation (see `P9 §16`):

| ID | Package | Reason | Capability | Evidence needed | Authorized now? |
|---|---|---|---|---|---|
| **A** | Storage verification | `TENANT.storage` `B` | Tenant storage isolation | Real Storage + `storage.objects` RLS + path test | **NO** — deferred |
| **B** | Real PostgREST/GoTrue browser/server revalidation | `R094` 2× `B` CRITICAL | Browser → HTTPS → PostgREST → JWT → RLS | Docker Supabase + GoTrue + browser test | **NO** — deferred |
| **C** | Provider authentication verification | `AUTH`/`PRIV`/`R02` 17× `B` | GoTrue valid/expired/recovery/invitation | Isolated Auth service + recovery delivery + invite Edge | **NO** — deferred |
| **D** | Branch administration authorization | `BRANCH.create`/`modify`/`cross-branch-admin` 3× `D` | App-wide branch admin | Policy reshape `can_access_branch` + direct-API audit | **NO** — deferred (Q4 YES) |
| **E** | Canonical commercial billing/entitlement | `BILLING.SERVER-QUOTA` `D` | Full commercial subscription | Canonical command per Q12/Q13 + concurrency + idempotency | **NO** — deferred (Q5 PILOT) |
| **F** | Other P8 deferred | `OFFLINE` 4 + `R06.CONCURRENT` + `BRANCH` 5 + `AI.BRANCH` + `OTP` 4 + `LEGACY` 12 = 27 `C`/`F` | Generic offline/legacy | Only if contract expands | **NO** — accepted |

**Even though owner selected `GO`, do not start remediation. Even if `CONDITIONAL GO`, do not implement conditions. Even if `NO-GO`, do not start. Decision-record phase and implementation authorization are separate** (P9.1 §7).

---

## Future Authorized Packages (explicit)

**None authorized at this GO.** All six packages (A–F) remain **deferred** and require a separate `GO` with explicit scope before any engineering (see table above).

Owner may explicitly authorize a future package in a separate instruction (e.g., “Authorize Branch D package for `BRANCH.create` scope with `can_access_branch` reshape”).

---

## Decision Timestamp

```
recorded_at: 2026-09-24T10:45:00+02:00 (Africa/Johannesburg)
asked_at:    2026-09-24T10:4X:XX via Arena ask_user Q1–Q6 + Q7–Q9 (no inference, no silence as acceptance)
recorded_by: release-governance engineer (P9.1 gate) on behalf of owner — answers are owner-provided via ask_user
baseline:    268fd67 — P9: prepare owner release decision
```

---

## Verification

```
git diff --stat since 268fd67: docs/audits/LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md + .json only
src/ supabase/ tests/ unchanged — P9.1 §1 authoritative baseline preserved
LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md unchanged
tests/release/* unchanged (P8 classification-only)
```

---

*This final record does not rewrite historical P6/P7/P8/P9 preparation evidence. The original `LEDGR_P9_OWNER_RELEASE_DECISION_2026-09-24.md` remains the preparation document; this `FINAL` document is the owner's decision. No P10 implementation branch is created.*

**Owner signature:** _________________________________  **Date:** _______________

**Governance engineer:** _________________________________  **Date:** _______________
