# LEDGR — POST-R09.3 READINESS & DEPENDENCY GATE

**Date:** 2026-09-23
**Class:** Readiness, dependency, coverage and sequencing analysis. **No implementation performed** — zero changes to application source, migrations, schema, Edge Functions, tests, CI workflows, release-gate logic or existing audit reports. This document is the only artifact created.
**Working commit:** `1ae6519` (branch `arena/01a0c215-ledgr-react`).

---

## 1. Current Repository Baseline

| Fact | Value |
|---|---|
| HEAD | `1ae6519` — *feat(release): R06 POS command surface verification + product-tenant boundary (2026-09-23)* |
| Last implementation packages | R09.3 (`2b01054`) → R06(2026-09-23) verification+hardening (`1ae6519`) |
| Repo code state vs. R09.3 | Identical except the R06(09-23) additions: 1 migration (`20261003000000_r06_pos_product_tenant_validation.sql`), 1 suite (`tests/release/r06-stock.test.ts`), gate registration, audit report |
| Historical evidence | R00–R13 reports in `docs/audits/` (28 files), all preserved byte-for-byte |

## 2. Current Release Evidence Baseline

**The prompt's stated 700/0/53/753 is superseded by legitimate later evidence** (the owner-authorized R06 package). Verified against the repository:

| Run | PASS | FAIL | BLOCKED | Records | Determinism |
|---|---|---|---|---|---|
| R09.3-final (`2b01054`, two runs) | 700 | 0 | 53 | 753 | per-record sha256 identical |
| **Actual current (`a846119` code = `1ae6519`, two runs `.cache/r13/ledgr-r13-X1twjU` / `-J1TNkl`)** | **709** | **0** | **54** | **763** | per-record signature sha256 `a65e8e67…93c2` identical |

Delta is arithmetic-exact: +10 records = the 10 mandated `R06.POS.STOCK.*` records (9 PASS + 1 honest BLOCKED `R06.POS.STOCK.CONCURRENT`); zero pre-existing records changed status. Supporting gates at this HEAD: unit 731/731 (86 files), `tsc -b` clean, release-types clean, ESLint 0 errors (1 pre-existing generated-file warning), CI-mode build OK.

## 3. Package Status Matrix (§4)

| Package / Domain | Current Status | Evidence | Remaining Gap | Decision Required? | Implementation Ready? | Dependencies |
|---|---|---|---|---|---|---|
| R05 finance invariants | COMPLETE | 709-PASS suite incl. `FINANCE.*` (REVERsal PASS), `R05.*` | none inside scope | no | n/a | — |
| R06 POS stock integrity | **COMPLETE (re-verified & sealed 2026-09-23)** | POS.STOCK PASS; 6× `R06.POS.*`; 10× `R06.POS.STOCK.*` (9P/1B); failure mechanistically reproduced | `R06.POS.STOCK.CONCURRENT` harness-only BLOCKED | no | n/a | GAP-6 carve-out stands (§8) |
| R07 approvals/corrections | COMPLETE | `R07.*` all PASS (refund/void/approval/audit) | COGS replay-gate finding (register) | yes (correction-model rung) | no | R07-model continuation |
| R08 till/shift/branch | COMPLETE at till (*scoped*) | `R08.*` PASS incl. `BRANCH.SERVER-SCOPE`, `SHIFT.CROSS-BRANCH-DENIED` | 8× `BRANCH.*` escape paths outside till family | **YES (DEC-03 completion)** | no | branch remediation package |
| R09.1 cache confidentiality | COMPLETE | `R09.CACHE.*` 6/6 PASS (fake-indexeddb layer) | browser re-confirmation → R09.4 | no | yes (evidence) | R09.4 |
| R09.2 queue integrity | COMPLETE | 12 PASS + 2 sealed BLOCKED (`SAME-USER`, `REPLAY-CONTRACT`) | sealed readback (harness ACL profile) | no (harness ext.) | yes (harness) | R13-H harness package |
| R09.3 offline sync (Model 3+4) | COMPLETE | `R093.*` 16/16 PASS ×2 deterministic | DEC-09 window, queue TTL, browser evidence | yes (DEC-09/TTL, not for closure) | n/a | R09.4; DEC-09 for version control |
| R10 typed quota (P0QLT) | COMPLETE | `R10.QUOTA.*` 7/7 PASS; BILLING fixtures PASS | `BILLING.SERVER-QUOTA` concurrent/expired server denial | **YES (command/entitlement contract)** | no | that decision |
| R12 webhooks | COMPLETE | both EDGE FAILs → PASS; EDGE.* all PASS | none | no | n/a | — |
| R09.4 browser/runtime | NOT STARTED | none | entire browser evidence lane (§13) | no (evidence) | **YES (evidence package)** | browser tooling availability |
| R11 AI | dependency-satisfied (register: R03–R05, R10 — all complete) | `EDGE.AI.*` PASS | `AI.BRANCH` contract; metric-consistency evidence none | **YES (AI.BRANCH; DEC-03-adjacent)** | partial (metric lane) | DEC-03 rider for branch lane |
| R14 deployment/recovery/ops | NOT STARTED (phase-0 assets exist: backup-verify workflow, keepalive) | R00 baseline; ci.yml runs release gate | DEC-10 objectives; jobs evidence; restore proof; runbooks | **YES (DEC-10)** | partial (jobs/runbooks) | DEC-10 (for acceptance) |
| R15 final readiness | BLOCKED | register §6 acceptance | reconciliation tooling + pilot + sign-offs | yes (multiple) | no | R09.4, R11, R14, GAP packages, DEC-03/09/10 |
| AUTH/recovery | CONTAINED (DEC-02 approved) | R02 report; `EDGE.RECOVERY.foreign-identity` PASS | OTP capability, isolated-Auth evidence, 4 impl items | **YES (OTP provider/cost)** | no | SMS provider + isolated Auth fixture |
| TENANT storage | source policies exist; evidence sealed | R00 §234 ff; 2× `TENANT.*.storage` BLOCKED | deployed ACL profile + runtime negative proofs | no (harness) | yes (harness/R14) | R13-H; R14 |
| BRANCH.* (non-till) | OPEN | 8 records with exact escape paths | branch remediation package | **YES** | no | DEC-03 completion |
| GAP-1..7 non-POS authority | OPEN (unchanged by R05+) | whole-app review rows 142–151 | per-domain evidence + some decisions | partial (per domain) | partial | see §9 |
| GAP-6 transfer/cost authority | carve-out documented | review §143/GAP-6 row; R06(09-23) report §12 | transfer semantics evidence; cost-authority policy | **YES (cost authority)** | evidence-phase possible | R06 done |
| Receipt/invoice automation dispatch | coverage = EDGE negatives only | `EDGE.send-invoice/process-invoice-automation.*` PASS (negative) | delivery proof, idempotency-drift (GAP-12) | yes (enable/verify jobs) | no | R14 jobs lane |
| Invoice/payroll quota symmetry | PARTIAL | P0QLT enforced on `post_pos_sale`, `save_quick_sale`, `save_quick_expense` only (call-site grep: no invoice-builder/payroll invocation) | wiring + contract decision | **YES** | no | GAP-1/GAP-3 packages |
| CI gate semantics | understood (§11) | gate.mjs `evidenceExit`; ci.yml step | release-declaration policy for deferred BLOCKED | **YES (gate policy, later)** | no | R15 |
| FINANCE.REVERSAL | **COMPLETE** | `FINANCE.REVERSAL` PASS (R07) | none | no | n/a | — |
| Queue TTL/backlog | OPEN (register, not blocking) | R09.3 decision pkg §49 | TTL/backlog horizon decision | **YES** | no | DEC-09 family |

## 4. Full BLOCKED-Record Reconciliation (§5) — 54 records, zero changed

Legend — class: **1** still genuinely blocked · **2** potentially unlocked by R09.3 · **3** requires policy decision · **4** requires runtime/browser evidence · **5** requires implementation · **6** historical/deferred by design · **7** duplicate/obsolete (no new action in this gate).

| Record | Owner | Class | Reason | Prerequisite | R09.3 changed prerequisite? | Recommended next handling |
|---|---|---|---|---|---|---|
| `AI.BRANCH` | R11 | 3 | branch assignment + field-permission contract not approved | DEC-03 rider + AI contract | no | decision package; then R11 branch lane |
| `AUTH.valid-login`/`invalid-login`/`expired-session`/`logout-revocation` (4) | R01/R02 | 4 | no isolated Auth service in harness | environment package (isolated Auth fixture) | no | authorize isolated-Auth evidence package |
| `BILLING.SERVER-QUOTA` | R10 | 3 | canonical command/approval/entitlement contract unapproved | contract decision | no (R10 delivered typed denial; not the concurrent-denial command contract) | decision → implement denial command; then record |
| `BRANCH.create/modify/read/reports/financial/inventory/customers/cross-branch-admin` (8) | R04/R08 | 3 | org-wide writer/member policies; per-surface escape paths documented | DEC-03 completion (one-vs-multi assignments) + branch remediation package | no | hold as honest ledger; own package after decision |
| `LEGACY.*` (12) | R13 | 6 | fixed/shared bootstrap legacy suites intentionally not ported | none (deferred by design) | no | none; may be retired at R15 cleanup |
| `OFFLINE.ACTOR-BINDING` | R09 | 7 | **superseded**: R09.2 delivered the durable originating user/device contract it demanded; semantics now carried by `R09.QUEUE.PROVENANCE.*` + `ACTOR-BINDING.*` (PASS) | reclassification approval | yes (via R09.2 assets R09.3 consumed) | owner-approved reclassification inside a gate/evidence package (not unilaterally) |
| `OFFLINE.MULTITAB` | R09 | 7 (partially) | **superseded in code layer**: lease contract delivered by R09.2 with 4 PASS records; browser-workers tail overlaps `OFFLINE.BROWSER` | reclassification + R09.4 for the tail | yes (assets) | fold browser-tail into R09.4; reclassify ledger entry with approval |
| `OFFLINE.CONFLICT` | R09 | 3 | no approved conflict-resolution contract / no generic queue update op | conflict-policy decision (DEC-09 family) | partially (R09.3 exception vocabulary + provenance give the decision better primitives; decision itself not made) | decision package |
| `OFFLINE.BROWSER` | R09 | 4 | no browser/service-worker runner | R09.4 package (browser tooling) | **yes — target contracts are now final** (R09.1/9.2/9.3) | make R09.4 the next evidence package (§13/§15) |
| `OFFLINE.REOPEN`, `OFFLINE.RETRY` | R09 | 1 (environment) | post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile | harness: declared deployed-ACL profile | no | R13-H harness package (§13); no fake success meanwhile |
| `PRIV.INVITATION` | R02 | 4 | needs isolated Auth + DB integration | isolated Auth fixture | no | isolated-Auth evidence package |
| `PRIV.RECOVERY` | R02 | 4 | isolated Auth Admin + approved recovery contract | fixture + DEC-02 impl package | no | same package family |
| `PRIV.MEMBERSHIP`, `PRIV.PROFILE` | R01 | 1 (environment) | effective UPDATE/column grants not represented in migration-only ACL | harness: declared deployed-ACL profile | no | R13-H harness package |
| `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` | R02 | 5 | DEC-02 contract approved; possession-verification capability unbuilt | OTP/support-verification implementation (+provider) | no | R02-impl package after provider decision |
| `R02.PROVIDER-TOKEN.*` (9) | R02 | 4 | no isolated Auth recovery service/delivery | isolated Auth fixture | no | isolated-Auth evidence package |
| `R02.RECOVERY.OTP.*` (3) | R02 | 5 | no SMS/OTP mechanism | provider + lifecycle implementation (cost/decision) | no | R02-impl package |
| `R06.POS.STOCK.CONCURRENT` | R06 | 1 (environment) | single-connection fixture; no second-connection factory | harness: second-connection factory | no | R13-H harness package; no claim meanwhile |
| `R09.QUEUE.ACTOR-BINDING.SAME-USER`, `R09.QUEUE.REGRESSION.REPLAY-CONTRACT` | R09.2 | 1 (environment) | sealed: readback SELECT grants absent in migration-only profile | harness: declared deployed-ACL profile | no (R09.3 preserved their seal verbatim) | R13-H harness package — these become its acceptance records |
| `TENANT.A.storage`, `TENANT.B.storage` | R04 | 1 (environment) | storage policy depends on business_users SELECT grant absent in profile | harness ACL profile + storage runtime probes | no | R13-H + R14 storage runtime lane |

**Totals by class (verified against the evidence file, sum = 54 ✓):**
- **1 — still genuinely blocked (9):** `OFFLINE.REOPEN`, `OFFLINE.RETRY`, `PRIV.MEMBERSHIP`, `PRIV.PROFILE`, `R06.POS.STOCK.CONCURRENT`, `R09.QUEUE.ACTOR-BINDING.SAME-USER`, `R09.QUEUE.REGRESSION.REPLAY-CONTRACT`, `TENANT.A.storage`, `TENANT.B.storage` — all environment/harness-profile limitations
- **2 — potentially unlocked by R09.3 (0):** none — Model 3+4 added no Auth service, no ACL profile, no browser runner (impact is §5, not reclassification)
- **3 — requires policy decision (11):** `AI.BRANCH`, `BILLING.SERVER-QUOTA`, `OFFLINE.CONFLICT`, 8× `BRANCH.*`
- **4 — requires runtime/browser evidence (16):** `OFFLINE.BROWSER`, 4× `AUTH.*`, 9× `R02.PROVIDER-TOKEN.*`, `PRIV.INVITATION`, `PRIV.RECOVERY`
- **5 — requires implementation (4):** `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY`, 3× `R02.RECOVERY.OTP.*`
- **6 — historical/deferred by design (12):** `LEGACY.*`
- **7 — duplicate/obsolete (2):** `OFFLINE.ACTOR-BINDING`, `OFFLINE.MULTITAB`

## 5. R09.3 Impact Analysis (§6)

| Surface | Did Model 3+4 unlock it? | Rationale |
|---|---|---|
| R09.4 browser evidence | **YES (primary unlock)** | Every contract R09.4 must verify is now final: R09.1 wipe model, R09.2 provenance/lease/quarantine, R09.3 typed exceptions (`23514`/`P0QLT`/authority/quarantine classes), durable exception storage, manager reconciliation path (`reconcile_offline_queue_item`, `OfflineQueueDrawer` UI surface) |
| Offline conflict record (`OFFLINE.CONFLICT`) | PARTIAL | R09.3's exception taxonomy + provenance fields make the conflict-resolution decision well-posed; the decision itself was not made and is not implied |
| Sealed readback records (REOPEN/RETRY/R09.QUEUE×2) | NO | Limitation is harness-ACL; only harness extension unlocks |
| AUTH/recovery | NO | untouched surface |
| R11 | PARTIAL (already possible) | Register deps (R03–R05, R10) were complete before R09.3; R09.3 adds nothing conceptually new; branch lane still decision-gated |
| R14 | PARTIAL | command-outcome contracts (P0QLT, typed exceptions, keyed posting) now cover all in-scope commands → "command outcome contracts" register prerequisite for R14 is effectively satisfied; DEC-10 still open |
| R15 | PARTIAL | R15 needs per-tenant reconciliation + pilot: R09.3 removed offline-sync design risk but GAP-1..7, R09.4, R11, R14, DEC-03/09/10 remain |

No record was upgraded silently; the two "unlock" effects are both *authorization-scope* effects (something may now be worked on), not evidence effects.

## 6. Decision Register Reconciliation (§8)

| Decision | Current state | Classification |
|---|---|---|
| **DEC-09** stale/unsupported payload version | Interim coexistence documented (accept-with-warning) "temporarily accepted" with rationale; expected control = signed supported-version list + acceptance-window end-date + reject-with-evidence semantics (R09.3 decision pkg §110) | **required before release** (not required before R09.4; R09.4 may *measure* current stale-version behavior honestly and feed the window design) |
| **Queue TTL/backlog horizon** | Open register item; no TTL exists | **required before release** (exception backlog semantics depend on it); not required before R09.4 |
| **OFFLINE.CONFLICT** conflict-resolution contract | Open | **required before implementation** of conflict handling; currently blocked-by-design |
| **BILLING.SERVER-QUOTA** command/entitlement contract | Open | **required before implementation** of the server-side concurrent-quota denial |
| **FINANCE.REVERSAL** | Delivered (`FINANCE.REVERSAL` PASS, R07) | **closed for readiness purposes** — separate financial packages can reference it; does not gate current work |
| **DEC-03 / BRANCH.*** | Partially applied (R08 till family proven); matrix completion (one-vs-multi assignments) open | **required before** the BRANCH.* remediation package and the R11 branch lane; not required for R09.4 |
| **DEC-02 recovery** | Contract **approved** (2026-09-21); remaining = implementation (support-verification routing minimum or single-owner OTP enhancement) + isolated-Auth evidence + 4 hardening items (R02 §336 a–f, incl. OTP provider, delivery cost, lifecycle, resolver hardening, invite-link phone-fallback, onboarding credential lifecycle) | **required before release** (recovery claims); implementation/funding decision sits with owner; provider runtime evidence after implementation |
| **AI.BRANCH** contract | Open | **required before** R11 branch-aware features |
| **DEC-10** recovery objectives (RTO/RPO) | Open | **required before** R14 acceptance (restore demonstration) and any SLA claims |
| **DEC-07** price/discount/tax/tender write-through | Open (documented in R06-era reports) | **required before release** for finance claims on POS document accuracy; **not gating** R09.4/R14 |
| **Release-gate policy for deferred BLOCKED** | Implicit (gate red while any BLOCKED) | **required before release declaration** (§11) — an owner decision, flagged, not invented here |
| Storage limits/public-flag posture (E11) | Unknown deployed config | **required before release** as runtime verification (R14), not a design decision |

No new decisions invented; items marked "required before release" are consolidated into §12-§16 sequencing.

## 7. Dependency Graph (§7)

```text
R09.3 COMPLETE ──────────────┬── R09.4 browser/runtime evidence      [READY W/ PREREQ: browser tooling; evidence-only]
                             │       └─► closes OFFLINE.BROWSER; feeds OFFLINE.MULTITAB reclassification; feeds DEC-09 window design
                             ├── R13-H harness extensions             [READY W/ PREREQ: declared deployed-ACL source of truth]
                             │       ├─► 2nd-connection factory  → R06.POS.STOCK.CONCURRENT
                             │       └─► deployed-ACL profile    → OFFLINE.REOPEN/RETRY, R09.QUEUE.SEALED×2, PRIV.MEMBERSHIP/PROFILE, TENANT.storage×2
                             ├── Decision-prep document (analysis only)  [READY]
                             │       ├─► DEC-09 window (+TTL/backlog) · OFFLINE.CONFLICT · SERVER-QUOTA contract · AI.BRANCH
                             │       └─► (outcomes unblock) → R02-impl · conflict impl · quota impl · R11 branch lane
                             ├── R11 metric-consistency lane            [READY W/ PREREQ: carve out AI.BRANCH; R03–R05/R10 already met]
                             ├── R14 phase-1 (jobs evidence, runbooks, monitoring)  [READY W/ PREREQ: DEC-10 needed only for restore/SLA acceptance]
                             ├── GAP-6 transfer package                 [REQUIRES DECISION: cost-authority policy; carve-out stands meanwhile]
                             └── R15                                    [BLOCKED: needs R09.4,R11,R14,GAP-1..7 lane, DEC-03/09/10,pilot]

Auth/recovery line: isolated-Auth evidence package [READY W/ PREREQ: fixture authorization] ─► R02-impl [REQUIRES DECISION: OTP provider/cost] ─► DEC-02 closure ─► R15
```

Per-package safety: **can start now** = R09.4 (evidence), decision-prep document, R13-H (if ACL source of truth available), R11 metric lane, R14 phase-1. **Parallelizable**: all five are mutually independent. **Hard blockers**: R15 (many), R02-impl (provider decision), BRANCH.* package (DEC-03), GAP-6 (cost authority), OFFLINE.CONFLICT impl (contract).

## 8. R06 / GAP-6 Boundary (§9)

The transfer/cost-authority carve-out held through R06(09-23) and R09.3. Answers to the mandated five questions:

1. **Blocks offline reconciliation claims?** NO — provided claims stay path-scoped. R09.3 evidence exercises `reconcile_offline_queue_item` → `post_pos_sale` only; the whole-app review (§3 note 258) already records that stock-reconciliation claims "cannot safely generalize beyond tested paths without the transfer package". R09.3's own report does not over-claim. Discipline requirement: every future stock-reconciliation statement must name its command path.
2. **Blocks inventory release readiness?** PARTIALLY — the balance-level invariant is proven on tested paths (POS + quick-save + movement-trigger inserts); `stock_transfers` direct-write/delete paths remain unevidenced as to whether they propagate through `trg_stock_movement_apply_balance` with consistent cost semantics. An inventory-readiness claim is unsafe until the GAP-6 package runs.
3. **Blocks R15?** YES for the inventory reconciliation line — R15 demands per-tenant movement/balance/GL-value reconciliation; transfer semantics must be evidenced first (else reconciliation targets an unproven mechanism).
4. **Requires a separate GAP-6 package?** YES — evidence + transfer idempotency + cost-authority decision; anticipated decision: caller-supplied `unit_cost` authority on inbound transfer/receipt (WAC feed policy).
5. **Can remain a documented carve-out?** YES — as long as all readiness language stays path-scoped (current state) and no inventory-wide claim is made. Zero urgency from the R09.3 completion.

## 9. Non-POS Financial Authority (§10) — GAP reconciliation vs. current code

| GAP | Current status (verified) | Changed by R05+? | Security/release blocker? | Decision needed? | Architecture sufficient? | Own package? |
|---|---|---|---|---|---|---|
| GAP-1 invoice lifecycle (builder create/edit/**delete**; state-machine coherence with payments/audit) | OPEN — direct-writer paths ride RLS; R05 covered payment triggers subset; **quota (P0QLT) NOT wired to invoice paths** (call-site grep: `_ledgr_assert_usage_limit` invoked only by POS + quick-save family) | partially (R05 payment guards) | correctness/audit-class blocker for release claims; not a live exploit (RLS org scoping holds) | lifecycle/correction contract | model exists (R07 correction pattern reusable) | **yes (FIN-A)** |
| GAP-2 journal edit/delete authority | OPEN — direct `journal_entries.delete/update` exists; who-may-delete-posted unproven | no (R05 = insert-side invariants) | audit-integrity blocker (release) | authority map decision | R05 primitives + R07 pattern | yes (FIN-A or FIN-B) |
| GAP-3 payroll posting & corrections | OPEN — `payroll_runs` direct insert; posting flow only in BLOCKED legacy pack; corrections unevidenced; quota unwired | no | release-blocker class (correctness) | posting contract | legacy partial | yes |
| GAP-4 banking (statement import, match accept) | OPEN — direct writes; import idempotency + match authority unproven | no | correctness-class | import idempotency contract | AI-match flow exists | yes (with GAP-1 lane) |
| GAP-5 FX revaluation / fixed assets calculators | OPEN — direct insert paths; no release evidence | no | correctness-class | no major policy | services exist | yes (evidence-heavy) |
| GAP-6 transfers/adjustments/cost authority | OPEN carve-out (§8) | R06 trigger exists; transfer-path interplay unproven | release-blocker for inventory claims | **yes (cost authority)** | mechanism exists on tested paths | **yes** |
| GAP-7 config delete-bounds (paye bands, tax config) | OPEN — authenticated-writer deletes ride RLS; no change-audit evidence | no | audit-evidence gap (lower severity) | audit/evidence policy minimal | trivial | fold into FIN-A audit lane |
| Newly surfaced: **quota symmetry** (invoice/payroll) | OPEN — enforcement absent on those command paths (this gate's call-site verification) | R10 contract delivered, not wired | entitlement-correctness (billing fairness class) | wiring decision (extend P0QLT invocation) | `P0QLT` machinery ready | fold into FIN-A / payroll packages |

## 10. Storage / Authentication / Branch / Runtime (§11)

**Storage.** Source-declared policy: `business-logos` public-read (intentional public content), authenticated write requires first path segment = member business id; `user-exports` private, service-role uploads + 3,600s signed URLs; per-bucket size/MIME limits unspecified; deployed flags unknown (E11). Evidence: 2× `TENANT.*.storage` BLOCKED (harness ACL), runtime negative proofs MISSING (no cross-tenant object-access probe executed against a deployed instance). Owner packages: R13-H (profile) + R14 (runtime).

**Authentication / recovery.** DEC-02 contract approved; interim containment active (`EDGE.RECOVERY.foreign-identity` PASS). Remaining = implementation (minimum: support-verification routing; enhancement: single-owner OTP → provider, cost, lifecycle, rate limits, replay protection — explicit owner decision, includes funding), resolver hardening, invite-link phone-fallback, onboarding credential lifecycle, and isolated-Auth fixture evidence (4 AUTH + 9 PROVIDER-TOKEN + PRIV.INVITATION/RECOVERY). No runtime proof exists anywhere yet.

**Branch.** Provable claims today (R08.7): till family branch enforcement (shifts/cash moves/closes/late adjustments), POS terminal admin sealing, server predicate `can_access_branch`, POS sale branch substitution defense, shift report scoping. Everything else = the 8 documented escape paths. **No broader branch claim is currently safe.** DEC-03 one-vs-multi-assignment axis must close before a remediation package can be designed.

**Runtime.** R00's governing statement stands: "Runtime exposure not verified." No hosted/staging verification, no production exposure evidence exists in the programme. `ci.yml` runs the full static battery + release gate in CI; `backup-verify.yml`, `supabase-keepalive.yml`, `capture-staging-schema.yml` exist but produce no release records. All current 709 PASS are local-layer; `productionVerificationRequired` stays true across the register.

## 11. Release Gate Semantics (§12)

Current semantics (`gate.mjs:evidenceExit`): any FAIL → exit 1; any BLOCKED → exit 2; zero outcomes → 2. **Zero tolerated: the gate is not green while any BLOCKED exists**, and `ci.yml` executes it. Interpretation of the 54:

| Bucket | Count | Meaning for the gate |
|---|---|---|
| Expected deferred evidence (LEGACY ×12) | 12 | Deliberate non-port; not product risk |
| Environment/harness-gated (class 1 ×9) | 9 | Unlock via R13-H; no product or policy change |
| Runtime/browser/provider-gated (class 4 ×16) | 16 | Unlock via R09.4 / isolated-Auth packages |
| Policy-gated (class 3 ×11) | 11 | Unlock only via owner decisions (DEC-03/09, conflict, quota, AI.BRANCH) |
| Implementation-gated (class 5 ×4) | 4 | Unlock only via R02-impl (OTP/support flow) |
| Duplicate/obsolete (class 7 ×2) | 2 | Unlock via approved reclassification |
| Genuine *product* blockers among these | 0 confirmed | Every BLOCKED is either deferred, environment, decision or capability — no known product defect hiding in the BLOCKED set |

What must happen before final readiness (R15): the environment/runtime lanes executed, the policy decisions taken and implemented, the obsolete entries reclassified with approval, and — explicitly — **an owner gate-policy decision on how the R13 gate treats owner-deferred items at release declaration** (today's semantics make ANY deferred evidence a red gate; that policy is R15's to set, not this gate's to change).

## 12. Candidate Next Packages (§13)

### P1 — R09.4 Browser/Runtime Evidence
- **Purpose:** close the browser lane: real service-worker lifecycle, real IndexedDB persistence across browser restarts, real cross-tab lease contention, cache-wipe verification in a browser process, R09.3 exception/queue UX (`OfflineQueueDrawer`), behavior evidence for the DEC-09 window design.
- **Evidence already available:** all target contracts final and locally proven (R09.CACHE 6/6, R09.QUEUE 14 records, R093 16 records); PWA build pipeline works (CI-mode build, 111 precache entries).
- **Missing evidence:** everything browser-real (the `fake close/reopen is not browser process shutdown` limitation is verbatim in `OFFLINE.BROWSER`).
- **Required decision:** none for the evidence lane itself.
- **Required implementation:** harness-only (browser runner; no product change).
- **Dependencies:** browser tooling availability in the execution environment.
- **Safe to authorize now?** **READY WITH PREREQUISITE** (verify browser runner availability; if unavailable → staging/browser environment, no fabricated evidence).

### P2 — R13-H Harness Extensions
- **Purpose:** (a) second-connection factory (concurrency evidence); (b) declarative deployed-ACL profile layered onto the migration replay (readback/grant-dependent evidence).
- **Evidence already available:** the 9 sealed honest-BLOCKED records named in §4; capture tooling (`capture-staging-schema.yml`) for ACL source-of-truth.
- **Missing evidence:** deployed-ACL source of truth (staging capture or owner-declared manifest).
- **Required decision:** none for (a); (b) needs the declared ACL source to avoid manufacturing grants.
- **Required implementation:** harness-only.
- **Dependencies:** (b) ← ACL source of truth (environment/owner input).
- **Safe to authorize now?** **READY WITH PREREQUISITE** (ACL source of truth); the second-connection half alone is **READY**.

### P3 — Decision-Preparation Document (analysis only)
- **Purpose:** put options + consequences in front of the owner for DEC-09 window (+TTL/backlog), OFFLINE.CONFLICT contract, BILLING.SERVER-QUOTA command contract, AI.BRANCH — one document, four decisions, no implementation.
- **Safe to authorize now?** **READY** (status of the decisions themselves: **REQUIRES DECISION**).

### P4 — R11 Metric-Consistency Lane
- **Purpose:** permission-aware AI metric consistency (register definition), excluding the branch-aware lane (`AI.BRANCH` stays decision-gated, carve-out preserved).
- **Dependencies:** R03–R05, R10 — all complete.
- **Safe to authorize now?** **READY WITH PREREQUISITE** (explicit scope carve-out of branch behavior).

### P5 — R14 Phase-1 (jobs evidence, monitoring, runbooks)
- **Purpose:** job-execution evidence with owners, alerting path, support runbooks (register R14 middle lanes).
- **Dependencies:** R00 done; command-outcome contracts now effectively complete post-R09.3/R10.
- **Safe to authorize now?** **READY WITH PREREQUISITE** (DEC-10 needed only for the restore/SLA acceptance lanes — exclude those lanes).

### P6 — GAP-6 Transfer / Cost-Authority Package
- **Status:** **REQUIRES DECISION** (cost-authority policy for caller-supplied `unit_cost` on inbound surfaces; evidence phase could precede but the package's objective depends on it).

### P7 — R02-Impl Recovery Capability
- **Status:** **REQUIRES DECISION** (OTP provider/cost vs. support-verification minimum; plus isolated-Auth fixture authorization for evidence).

### P8 — Branch Remediation (BRANCH.*)
- **Status:** **REQUIRES DECISION** (DEC-03 completion) — then dedicated package.

### P9 — FIN-A Invoice Lifecycle / Quota Symmetry (GAP-1 + quota wiring)
- **Status:** **READY WITH PREREQUISITE** (scope/correction-contract decision is small but real; quota-wiring decision included).

### P10 — R15
- **Status:** **BLOCKED** (needs R09.4, R11, R14, FIN/GAP lanes, DEC-03/09/10, pilot cohort).

## 13. R09.4 Assessment (§15)

| Mandated question | Answer |
|---|---|
| Exact outstanding browser evidence | (i) service-worker registration/update/teardown lifecycle; (ii) real IndexedDB persistence across true browser process restarts (fake close/reopen explicitly insufficient per `OFFLINE.BROWSER`); (iii) cache-wipe-on-identity-transition in a real browser profile incl. multi-tab (`R09.CACHE.*` re-confirmation); (iv) cross-tab lease contention under real storage/BroadcastChannel semantics (`OFFLINE.MULTITAB` tail); (v) offline→online sync under real network transitions; (vi) R09.3 durable-exception surface: typed `P0QLT`/`23514` exceptions visible in `OfflineQueueDrawer`, manager-only reconcile action, quarantined items not retried blindly; (vii) current stale-version behavior evidence to feed DEC-09 (measurement only — no policy) |
| Are all contracts for browser testing stable? | YES — R09.1 wipe model, R09.2 provenance/lease/quarantine, R09.3 Model 3/4 are all final and deterministically evidenced locally |
| New browser cases introduced by R09.3? | YES: exception-to-drawer UX, manager reconciliation flow (`reconcile_offline_queue_item`), late-arrival/closed-shift arrival surfacing, tamper-block handling — all new post-R09.3 surface |
| Testable without product changes? | YES — evidence-only package; any product gap found must be documented, not fixed |
| Environment requirements | real browser runner (e.g. Playwright/Chromium) driving the **built** PWA (service worker active) against the disposable local stack (R13 fixture family or local supabase instance); synthetic identities only; no customer data |
| Production/staging access required? | NO for the core record set (local-layer records keep `productionVerificationRequired: true`) |
| Synthetic-only sufficient? | YES |
| Which current blocked records can close? | `OFFLINE.BROWSER` (direct, new `R094.*` evidence + reclassification); `OFFLINE.MULTITAB`'s browser tail (reclassification with approval); input data for DEC-09 decision. Nothing else — the sealed readback/ACL records belong to R13-H, not R09.4 |

## 14. Smallest Safe Next Action (§14)

**Authorize R09.4 — browser/runtime evidence (P1) — optionally in parallel with P3 (decision-preparation document).**

Rationale: R09.4 is the only candidate that (a) requires no unresolved policy decision, (b) materially reduces release uncertainty (the entire browser lane is open, and 3 packages — R09.2 evidence tails, OFFLINE.MULTITAB, DEC-09 design — feed from it), (c) is evidence-only with zero product risk, and (d) has all of its target contracts final as of R09.3 (its previous blocking condition). P3 is a pure document and can proceed in parallel without contention. **No implementation package is being recommended** — none is both safe and decision-free in full scope (R11 and R14 phase-1 carry carve-out prerequisites; P2's ACL half needs a source of truth).

## 15. Exact Authorization Boundary for the Next Package (R09.4)

**IN:** browser runner harness (tests/infra only); new `R094.*` release records (additive, gate-registered); browser-real re-assertion of R09.1/R09.2/R09.3 contracts (wipe, provenance, lease, quarantine, typed exceptions, manager reconcile surface, immutable payload, cross-tab); stale-version behavior *measurement* (evidence for DEC-09, no policy change); audit report; harness ×2 determinism including the new layer; honest BLOCKED-with-limitation for anything the browser environment cannot genuinely exercise (no fabricated evidence — the sealed-record discipline stands).

**OUT:** any product code/UX/migration/Edge change; DEC-09, TTL, conflict-resolution, quota, AI.BRANCH or DEC-03 decisions; reclassification of existing blocked records without separate explicit approval (recommendations may be produced); GAP-6; R11/R14/R15 implementation; staging/production access (remains flagged, not assumed); any weakening of R13 gate semantics.

**STOP conditions (inherited programme discipline):** any product defect discovered → document + owning package, do not fix; any required decision encountered → STOP with decision package; any browser-environment incapacity → BLOCKED with exact limitation.

## 16. Final Readiness Classification (§18)

# **READY FOR NEXT AUTHORIZATION**

Exact immediate package: **R09.4 browser/runtime evidence** under the §15 boundary (READY WITH PREREQUISITE: browser tooling availability, verified during the package's own discovery; otherwise BLOCKED-with-limitation reporting — no fabrication). This classification is evidence-based: the repository holds a decision-free, safe, uncertainty-reducing next package; it is not a statement that release readiness is near (cf. §12: 54 BLOCKED, 11 decision-gated decisions outstanding).

**STOP.** No further work is authorized by this gate.
