# LEDGR — R09.3 DECISION & POLICY GATE — DECISION PACKAGE

**Date:** 2026-09-23 (Africa/Blantyre)
**Mode:** DECISION ANALYSIS ONLY — nothing implemented, nothing selected.
**Baseline verified:** branch `arena/01a0c215-ledgr-react` @ `0e6e1e8`; working tree clean; release evidence **684 PASS / 0 FAIL / 53 BLOCKED / 737 records** (R12 closed; both former FAILs PASS). R09.3 implementation has not started and is not authorized by this document.

---

## 1. Governing constraints (verified against current code/evidence)

| Constraint | Authority | Consequence for P-D3 |
|---|---|---|
| Non-negative stock invariant `chk_inventory_balances_on_hand_nonneg` + trigger apply path | R06 (PASS records) | rejects at replay with **23514** if stock would go negative — server-final, cannot be negotiated by client |
| Queue states `pending / syncing / synced / failed / quarantined`; `quarantineReason ∈ {actor-mismatch, missing-provenance, legacy}` | R09.2 (`src/offline/db.ts`, `syncEngine.ts`) | existing exception machinery exists and covers actor/provenance/legacy classes; new classes must be named against it (extend or sibling — a sub-decision) |
| Actor binding, device identity, capture-time, lease-exclusivity records | R09.2 (18 PASS + 2 sealed BLOCKED: `SAME-USER`, `REPLAY-CONTRACT`) | the two seals pin what must *become* the model's own records once P-D3-FINAL is signed — no weakening allowed |
| Quota denial typed as **SQLSTATE `P0QLT`** (single meter, server-authoritative) | R10 (8 PASS records) at `src/lib/billing/quotaContract.ts` + `syncEngine.lastErrorCode` | the retry/exception boundary CAN route policy failures deterministically without message text; any P-D3 state must consume this code, not invent another |
| Named terminals; server-steered shift binding (42501 own-shift / 22023 unknown/mismatched); signed close; DEC-08 late-arrival append (`pos_shift_late_adjustments`); **closed claimed shifts still post as late adjustments** | R08 (22 PASS; binding at `20260930000001:96-131`) | closed-shift-at-replay is **already a defined, non-failure path**; P-D3 must not redefine it |
| Legacy branch-less compatibility (`v_branch_resolved := coalesce(payload.branch, shift.branch)` at binding :130) | R08 + D-4 rider | see §6 — permissible for legacy payloads while DEC-09 window is open; not widening |
| Controlled oversell excluded | R06 posture | **Model 2 class is out** — any P-D3 shape must keep 23514 as the final stock answer |

**Evidence-anchored stale-cache note (consistency finding preserved from R09.x):** cached on-hand is *evidence only*; multi-device/multi-user shelves make capture-time reads non-authoritative. Model 1 alone cannot guarantee zero false negatives/positives at till; this is a constraint on what Model 1 may claim, not a blocker.

---

## 2. Model 1 — Restricted Offline Selling (analysis)

| Question | Analysis against current architecture |
|---|---|
| What can be captured offline | POS `pos_sale` items only where the capture path carries full provenance: actor uid, device id, capture time, business, terminal, open shift of that terminal, payload version, clientKey — exactly the R09.2 provenance set; quick sale/quick expense/invoice flows already queue-compatible today but the model's capture gate would apply to stock-carrying POS items principally |
| What inventory authority exists offline | **None authoritative.** Cached on-hand (IndexedDB snapshot) is evidence-only; the model enforces *capture-gating* from cache as a disclosure/hint, never as a guarantee |
| When authoritative stock cannot be verified | Options within model: (a) refuse capture (hard gate), (b) capture with explicit "unverified stock" capture-level flag + accepted later-verification. Both keep 23514 final; (b) pushes failures to replay and drags an exception class back in |
| Quota P0QLT handling | Quota cannot be known at capture (server count). P0QLT arrives at replay → item becomes a **policy denial** (plan window), which is NOT a stock problem: capture gating must not surface quota-style predictions, and replay must route P0QLT away from any stock-denial state (typed `lastErrorCode` from R10 makes this exact) |
| R09.2 provenance | Unchanged — required fields already enforced; capture without provenance would be blocked at the existing actor-binding checks |
| R08 terminal/shift | Capture requires bound terminal+shift (R08 model); replay preserves server steering (payload branch vs shift branch authority server-side) |
| Originating shift closed at replay | **Nothing new**: server already treats it as DEC-08 late arrival — posts + `pos_shift_late_adjustments` appended; model must not convert this into an error |
| Cannot-reconcile outcome | The model *by itself* has none — item would sit at `failed`. Practical consequence: Model 1 must either accept plain `failed` evidence-only completion (with the operator manual-recovery burden) **or adopt a sibling exception path (i.e., pair with Model 3)** |
| Requires exception/quarantine state? | Not for capture denials (they never enqueue). Residual replay failures still need *a* disposition → materially leans 1+3 |

**Implementation scope (if selected):** capture-gate (cached-stock evaluation + UX), staleness policy for the cache hint, no server changes for the gate itself; sync unchanged except the routing-by-code for residual failures.

## 3. Model 3 — Reject / Quarantine (analysis)

| Question | Analysis |
|---|---|
| Exact rejection conditions | Server-typed classes only: (i) **23514** stock invariant denial → *stock denial*; (ii) **P0QLT** plan/quota denial → *policy denial*; (iii) R08 AUTH denial classes (42501/22023 steering) → *authority denial*; (iv) existing R09.2 classes (actor-mismatch/missing-provenance/legacy) already quarantined; (v) stale/unsupported payload version → per DEC-09 window rule; transient/network codes are **never** rejections (stay `failed` + retry) |
| Quota denial | `lastErrorCode='P0QLT'` → durable exception *of plan-administrative kind*; the item is evidence-complete and should not burn retry budget; resolution = plan upgrade by admin (out-of-band), then plain retry |
| Stock denial | `23514` → durable exception *of stock kind*; resolution per Model 3 alone: permanently retained-with-evidence, no in-app correction |
| Closed shift | **Not a rejection condition** — R08/DEC-08 already defines late-adjustment posting |
| Stale payload/version | accepted-with-warning vs reject is the DEC-09 version-window decision axis (open — see §6); under reject branch it joins the durable-exception family with reason `stale-version` |
| Actor mismatch | existing `quarantined{actor-mismatch}` — unchanged (sealed by R09.2 records) |
| Missing provenance/legacy | existing quarantine classes — unchanged |
| Retry behaviour | transient classes retry as today (with lease exclusivity); typed policy classes exit the retry loop exactly once, durably visible, no silent purge (evidence retention is mandatory) |
| User-visible exception | durable exception surface (drawer/site badge + detail page) — the existing quarantine UI vocabulary is the natural home; quota cases should render plan language; stock cases render stock language — **code-typed routing makes this deterministic** |
| Evidence preservation without posting | payload + provenance + `lastErrorCode` + timestamps + leader/lease history remain in Dexie; server side records nothing financial — quarantined items must never create partial postings (already true: posting RPCs are atomic) |

**Implementation scope:** exception-state wiring on existing `failed`-with-typed-code (either extend `quarantineReason` — a DOMINO data-model change in db.ts + guards — or introduce a sibling durable status; both are contained in `src/offline/*`), exception visibility surface, retry-loop routing on typed code, plan-administrative resolution path. No stock/POS/financial schema change.

## 4. Model 4 — Reconciliation Workflow (analysis)

| Question | Analysis |
|---|---|
| Who reconciles | Manager-tier only (owner/admin/manager — the same tier R08 already entrusts with on-record steering), with named-actor audit; never the original cashier silently self-approving (mirrors R07 approval hygiene) |
| Authority action or mere retry | **Authority action.** The reconcile decision is itself auditable and must be attributable (actor+time+item+item-clientKey), distinct from "/retry this" |
| Original actor/device/provenance | Attached and immutable — reconciliation annotates; it never rewrites the capture record (matches R09.2 tamper-evidence posture) |
| Stock & quota revalidation | At reconcile time, server-side, fresh: stock re-checked (23514 still final); quota re-asserted (P0QLT may appear *now* even if absent at original replay — plan state can change); branch/shift steering re-evaluated as at replay |
| R08 signed shift | Respected: reconcile into the DEC-08 late-arrival semantics for closed shifts; never opening/re-signing an old close (would violate R08) |
| Duplicate/replay prevention | clientKey exactly-once is already server-enforced (R06 replay evidence); reconciliation must hit the same intentional binding — a reconcile that reuses the original clientKey is idempotent by construction |
| Audit of reconcile decisions | New audit shape needed: reconcile-action event (who/when/item/reason/reference) — additive to the audit surfaces; local transitions also journaled device-side for continuity |
| Can reconciliation alter financial meaning? | **No.** It may only *permit the already-authorized original transaction to proceed*. Any content change (items/amounts/taxes/prices) invalidates the original capture and requires a new capture (new clientKey) — altering amounts in-place would break the R09.2 provenance contract |

**Net:** Model 4 is Model 3's exception family **plus** an authorized resolve→retry action; it cannot stand without the Model-3 disposition layer.

## 5. Neutral comparison (16 dimensions)

| Dimension | Model 1 — Restricted capture | Model 3 — Reject/Quarantine | Model 4 — Reconciliation workflow |
|---|---|---|---|
| Financial integrity | Invalid stock posting impossible by invariant; valid failures end as inert `failed` items | Same invariant; durable exception carries no posting risk | Same; posting only after fresh server revalidation |
| Stock integrity (R06) | full | full | full (plus correction flows reuse R06 mechanisms, never bypass) |
| Quota integrity (P0QLT) | routed at replay as plan-policy; capture can't predict it | routed at replay to plan-admin exception, retry invariant | re-asserted again at reconcile time |
| Actor integrity (R09.2) | unchanged | unchanged (+ new reasons, not replaced) | unchanged + reconciliation actor added, never rewritten |
| Device provenance | unchanged | unchanged | unchanged |
| Shift/till integrity (R08) | capture requires binding | unchanged | late-arrival semantics preserved |
| Closed shift | DEC-08 late-arrival (existing) | same | same (reconcile still lands as late-arrival) |
| Duplicate replay | clientKey exactly-once (existing) | same | same (reconcile reuses original clientKey → idempotent) |
| Network recovery | items replay normally; gate irrelevant | transient vs policy classes split by typed code | + reconcile only possible online |
| User experience | refusal at till when cache says no (possible false refuse on stale cache) | sale accepted, possible later exception notice — disclosure UX needed | same + visible "awaiting reconciliation" queue for managers |
| Evidence retention | full (unchanged) | full + durable exceptions never purged | full + reconcile audit trail |
| Auditability | existing records | + exception transitions | + reconcile decisions (actor/time/reason) |
| Implementation complexity | lowest (capture layer + routing) | medium (exception states + visibility + routing) | highest (exceptions + authority action + audit) |
| Operational burden | none after capture; worst: silent dead-ends as plain `failed` | exceptions need handling discipline but can wait admin | deliberate workload for managers per exception |
| Failure modes | false capture-denials (stale cache); overflow recovery manual | operator ignores exceptions (visibility mitigates) | reconcile backlog; decision quality risk |
| Release evidence required | capture-gate positives/negatives; routing by code | exception lifecycle by typed class; no-mutation proofs | full lifecycle incl. authority+audit+revalidate records |

*No ranking is given; models answer different halves of the same problem (capture-time vs replay-time).*

## 6. Mandatory contract (applies to ANY selection)

1. **R09.2 provenance must remain complete** for every retained item: user, device, capture time, business, branch/terminal/shift where the architecture binds them, payload version, clientKey. Existing quarantine reasons are **kept verbatim** (`actor-mismatch`, `missing-provenance`, `legacy`); additional typed classes must be extensions (e.g. `stock-denied`, `policy-denied`, `stale-version`) or a clearly-named sibling state — **no downgrade of existing reasons**, and the two sealed BLOCKED records (`R09.QUEUE.ACTOR-BINDING.SAME-USER`, `R09.QUEUE.REGRESSION.REPLAY-CONTRACT`) become the implementation's own acceptance records, fabricated evidence prohibited as today.
2. **Quota is `P0QLT` only.** No second error code, no second meter, no message-text classification. Expected routing in every model: `P0QLT` → plan-policy exception/retire-with-evidence (never stock-exception, never transient); `23514` → stock-policy handling per model; transient classes → existing retry; code absent/unknown → existing transient behavior (fail-open to retry, fail-closed to evidence — current posture kept).
3. **R08 preserved as-is:** named-terminal model, server-shift steering (42501/22023 signed behavior), signed close + immutable snapshot, DEC-08 late adjustments, server-derived branch/till/shift authority, zero client authority over signed shift state. P-D3 neither redefines closed-shift posting nor adds client permission to bypass it.
4. **R06 invariant preserved:** 23514 stays the final stock answer; no oversell window anywhere.
   **Safe R06-claim list for R09.3 (explicit):** POS sale post paths, quick-expense stock lines, quick-sale lines, and `InventoryRepository`-keyed movement paths — these have invariant+replay evidence.
   **Outside the safe claim (carve-out, from GAP-6):** stock transfer dispatch/receive idempotency and caller-controlled `unit_cost` into weighted-average cost on transfer/adjustment writes; claim limited until that package closes.
5. **Typed-code routing is the single classifier:** the sync boundary's `lastErrorCode` (R10) is the only source of truth for exception attribution; message text is diagnostic only.

## 7. D-4 legacy compatibility rider (reconfirmed, not broadened)

1. **What the legacy path currently permits:** legacy clients (pre-R08-payload) may submit POS payloads *without* an explicit branch field; the binding coalesces `payload.branch ?? shift.branch` (binding :130). Shift-claim steering (name/ownership checks, 42501/22023), R06 replay, idempotency remain fully active on this path — it is a **shape tolerance, not an authority tolerance**.
2. **Why temporarily accepted:** DEC-09 coexistence window — in-flight PWA clients during upgrade must not silently lose captured sales; the alternative (hard reject pre-window-close) is a data-loss posture with customer-visible impact.
3. **DEC-09/version-window control expected:** a signed supported-version list + acceptance window end-date + reject-with-evidence semantics for post-window stale payloads (recorded in the readiness plan under DEC-09; the accept-with-warning vs reject tail is **REQUIRES DECISION** at window design — marked here, not invented).
4. **Additional server-side protection required by P-D3?** No new protection needed *for P-D3* — queue items of the new lineage carry provenance; legacy-shape replays hit the same server steering as direct legacy clients already do today. Broadening the path (e.g., allowing branch-less *new* payloads) is **prohibited**.
5. **R09.3 claim limits (explicit):** may claim branch-consistent behavior for payloads carrying (or resolvable to) branch+shift; may **not** claim completed branch enforcement application-wide (DEC-03 open), nor claim the legacy path is closed.

## 8. Composition analysis

| Composition | Class routing | Transitions | Failure handling | Authority keeps at | Contradictions? |
|---|---|---|---|---|---|
| 1 + 3 | capture-gate for stock-carrying capture; replay-time typed exceptions for everything that still slips (stale cache) | captured → queued → (syncing) → accepted \| exception(reason-typed) | transient retries; policy classes durable | server (capture only advisory) | none — the gate can only *reduce* the exception load; gate failures and exception states speak different classes |
| 3 + 4 | all transactions: plain replay; stock/policy exceptions reconcilable under manager authority | exception → reconciliable → (authority action) → reconciled \| superseded | reconcile revalidates all three checks fresh | server + named reconcile actor | none if Rule: **reconcile permits original transaction only; edits = new capture** |
| 1 + 3 + 4 | gate at capture; exceptions at replay; manager resolve for high-value classes | union of the two, single state machine | pyramid: gate → retry → exception → reconcile | server | **only contradiction class:** Model 1's "never accept doubt" vs Model 3/4's "accept then resolve" — the composition resolves it by *class*: gate is advisory-tolerance configured per event class (stock hard-gate vs informational), which is itself a sub-decision |

Feasibility verdicts (factual, not preference): 1+3 coherent and minimal; 3+4 coherent and most operable; 1+3+4 coherent but needs the extra sub-decision on which classes the gate is hard vs advisory. Composition desirability remains the owner's policy call.

## 9. Proposed state-transition model (existing states + model-conditional extensions)

Justified existing states (R09.2): `pending(captured) → syncing(replaying) → synced(accepted) | failed(transient) | quarantined(reason)`.

| State | Entered by (client/server) | Reversible? | Financial mutation? | Evidence |
|---|---|---|---|---|
| `pending` (captured) | capture (client) | → `syncing` | none | full provenance |
| `syncing` | retry run under lease (client, server-authoritative lease) | → `synced`/`failed`/exception | the posting attempt (atomic) | attempt stamps |
| `synced` (accepted) | server commit ack | terminal (corrections are new transactions) | **yes — the one financial mutation** | server doc + local completion |
| `failed` (transient) | typed-transient abort | → `syncing` on retry | none | lastError + code |
| `quarantined{actor-mismatch, missing-provenance, legacy}` | existing R09.2 guards | assisted recovery only; never auto | none | durable |
| **EXT-conditional** `exception{stock-denied}` | 23514 routing (Models 3/4; reason extension or sibling) | Model 3: terminal-with-evidence; Model 4: → `reconcilable` | none | durable + typed code |
| **EXT-conditional** `exception{policy-denied}` | P0QLT routing (all models) | plan upgrade + manual retry only; never auto-retry | none | durable + typed code |
| **EXT-conditional** `exception{stale-version}` | DEC-09 rule when signed | window-dependent | none | durable |
| **EXT-conditional** `reconcilable` | manager-visible filter/flag over stock-class exceptions (Model 4) | → `reconciled`/`superseded` | none yet | same |
| **EXT-conditional** `reconciled` | Model 4 authority action re-executing original clientKey through server binding | terminal | **yes — of the original authorized payload, idempotently** | + reconcile audit (actor/time/reason) |
| `permanently failed`* | not proposed as a new row-state; realized as durable `exception{policy-denied}` (+ optionally `stock-denied`) classes — avoids state duplication | — | none | — |

`*` "permanently failed" as a distinct stored state adds no invariant beyond the typed durable exceptions — kept out of the proposal (state-set economy).

Transition authorities: capture/retry initiation client-side; **`synced`, exceptions, and reconcile are server-truth transitions** (client records mirror them); reversibility exactly as table; every transition appends evidence (none overwrites).

## 10. Security & financial safety case matrix (expected behavior under the mandatory contract — model deltas noted)

| # | Case | Expected outcome | Authoritative control | Financial mutation | Evidence |
|---|---|---|---|---|---|
|1| same user/device/valid provenance | replay → synced | server binding + R09.2 | yes (idempotent) | full |
|2| same user, different device | actor = user-bound, device informational → allowed (per accepted R09.2 design); cross-tab lease prevents cargo | R09.2 actority | yes | full |
|3| different user attempts replay | `quarantined{actor-mismatch}` — sealed behavior | R09.2 guard | none | durable |
|4| legacy item without provenance | `quarantined{legacy}`/`{missing-provenance}` — sealed | R09.2 | none | durable |
|5| missing branch (legacy payload) | server coalesce to shift.branch; posts if steering passes; new-lineage payloads MUST carry branch information per capture contract | R08 binding :130 | yes (post-steering) | full |
|6| wrong branch claimed | 42501 reject | R08 can_access_branch | none | attempt + code |
|7| wrong terminal claimed | 22023 reject; capture-time guard | R08 steering | none | attempt + code |
|8| closed shift at replay | DEC-08 late arrival post (existing defined behavior, not an exception) | R08 binding | yes (+ late-adjustment audit) | full |
|9| quota exceeded | P0QLT → plan-policy handling (exception/retire; never stock state) | R10 + server meter | none until plan change; retry re-checks server-side | durable typed |
|10| stock insufficient | 23514 → per model: Model 1: capture-gate CannotSay ⇒ still hits 3/4 exception class; Models 3/4: stock exception | R06 constraint | none | durable typed |
|11| duplicate clientKey | exactly-once: replay returns committed doc / re-completes (existing R06/R08 evidence) | server clientKey | no second posting | replay idempotent |
|12| network failure mid-replay | transient `failed`; lease released; retry next run | existing worker+lease | none | attempt |
|13| partial response after commit | re-connect → duplicate-clientKey completion path (R08 binding: second phase completes) | server | no duplicate | per binding |
|14| stale payload version | DEC-09 window rule (accept-with-warning vs reject pending — REQUIRES DECISION at window design) | version policy server-side | per window | durable typed |
|15| logout before sync | queue persists (Dexie); next session with same-actor provenance resumes; different actor quarantines | R09.2/R09.1 cache isolation | none | durable |
|16| two tabs replay same item | lease exclusivity: one claim wins; loser backs off | R09.2 lease records | none duplicated | lease audit |
|17| item beyond validity window | no silent purge today; P-D3 adds explicit TTL only if signed (REQUIRES DECISION point: TTL vs retain-forever-with-evidence) | policy | none | durable |
|18| local modification of queue evidence | tamper visible on hash/provenance mismatch (R09.2 checks exist); replay of tampered payload fails server binding | R09.2 + server | none | tamper recorded |
|19| quarantined→accepted without authority | prohibited — no auto-path exists; Model 4 adds reconcile only under manager-tier + audit, and only for typed-exception classes (NOT for R09.2-integrity classes, which stay assisted-recovery-only unless owner separately signs) | R09.2+P-D3 | never silently | audit if authority used |
|20| replay against different business | server membership/branch checks deny; payload business must match membership and clientKey namespace | R01/R04/TENANT evidence + R08 | none | attempt + code |

## 11. R09.3 authorization boundary (after P-D3-FINAL is signed)

**In scope (implementation allowed):** the controls directly implementing the selected P-D3 behavior in the offline surface — capture gate (if Model 1), typed exception disposition + visibility (all models), reconcile authority action + audit (if Model 4), RETRY routing on `lastErrorCode`, evidence retention for new classes, D-4 rider records, acceptance-records for the two R09.2 seals **in their required requireReadback form**, plus the release evidence for the new behavior.

**Out of scope (separate authorization required):** invoice/payroll quota symmetry (D-05), branch remediation (DEC-03), GAP-1..7 non-POS financial authority, storage, auth/recovery implementation, R09.4 browser evidence, R11, R14, R15, POS correction redesign, **any R08/R06/R10 change**, CI gate redesign, receipt dispatch, AI branch scope, legacy quarantine policy redefinition, TTL decision (§10.17 — separate point).

## 12. Acceptance criteria (measurable; fold into future release records)

1. Actor mismatch ⇒ quarantined with reason; **no mutation** server-side (activation of sealed `R09.QUEUE.ACTOR-BINDING.SAME-USER`).
2. Legacy queue ⇒ sealed `R09.QUEUE.REGRESSION.REPLAY-CONTRACT` lifecycle in requireReadback form.
3. Lease exclusivity: concurrent claims → exactly one execution; no duplicate posting.
4. P0QLT ⇒ plan-policy disposition; **no retry burn**; never lands in stock exception state; retry-after-plan-change re-asserts server-side.
5. 23514 ⇒ stock-class disposition per selected model; deterministic no-mutation.
6. Closed-shift replay ⇒ DEC-08 late-arrival (post + adjustment audit), not exception.
7. Duplicate clientKey ⇒ exactly-once (no second posting; completion path works).
8. Provenance fields complete on every retained item; tamper attempts visible.
9. Mutation/no-mutation boundary proofs for every exception class (zero unintended server writes).
10. Quarantine/exception visibility: durable, retrievable, correct reason vocabulary; never auto-purged.
11. Retry semantics: transient retry etiquette unchanged; typed classes exit once.
12. Deterministic replay: two full-harness runs identical (existing protocol).

## 13. Decision package (structured for completion on owner signature)

### P-D3-FINAL (to be signed by owner)

- **Decision statement:** "For offline-originated sale items, the behavior on replay-time denial is defined by **Model <selection>** {1 | 3 | 4 | 1+3 | 3+4 | 1+3+4}."
- **Transaction classes covered:** offline-captured `pos_sale` queue items (stock-carrying classes per selection's gate config); quick-sale/quick-expense items share the exception routing but not the capture gate. Explicitly NOT covered: refund/void (already non-queueable), invoice-builder/payroll flows (no server quota assert yet — D-05 open).
- **Explicitly prohibited:** controlled oversell; second quota meter/code; client authority over signed shift state; silent purge of exception evidence; alteration of original payload content by any recovery path; auto-unquarantine of R09.2-integrity classes.
- **Required server-authoritative controls:** R06 invariant (23514 single source), R10 meter (P0QLT single source), R08 steering + DEC-08 late-arrival exactly as today, clientKey exactly-once, no new exception state without audit trail.
- **Required client behavior:** typed routing at boundary via `lastErrorCode` (never message text); durable exception visibility; original payload immutable; capture gate advisory vs hard per signed class matrix (sub-decision when Model 1 included).
- **Required quarantine behavior:** existing reasons unchanged; extensions named explicitly (`stock-denied`, `policy-denied`, `stale-version`) with visibility and no auto-retry; assisted-recovery-only for integrity classes.
- **Required reconciliation authority (Model 4 in selection):** manager-tier actors; audit of {actor, time, item, reason}; reconcile = permit original transaction only, executed via server revalidation with original clientKey; content edits → new capture required.
- **Required evidence:** §12 acceptance criteria as release records; two-seal activation; negative mutation proofs per class; dual-run determinism.
- **Known residual risks (unavoidable under models):** stale-cache false denies (Model 1), exception-ignoring operations risk (Model 3), reconcile-backlog/quality risk (Model 4); legacy-shape tolerance until DEC-09 window closes.

### D-4 rider (confirmation)

- Legacy branch-less compatibility **stands**: shape tolerance with full steering; not widened; removal only via a signed DEC-09 version window (its accept-or-reject tail is REQUIRES DECISION, noted).
- R09.3 claim limits: §7.5 list verbatim.

### R09.3 authorization boundary

- May implement: §11 in-scope list only.
- Remains prohibited: §11 out-of-scope list + §4 stop-lines; this document authorizes no implementation itself.

---

## FINAL STATUS

**READY FOR OWNER DECISION** — all three viable models, their compositions, the mandatory contract, the D-4 rider, the carve-outs, and the exact acceptance criteria are evidence-backed and decision-ready. Nothing in the evidence eliminates Models 1, 3, or 4; the only structurally excluded family is oversell-based variants (Model 2 class), removed by the R06 invariant. Open sub-decisions flagged rather than invented: stale-version accept-vs-reject (DEC-09 tail), TTL for aged items (§10.17), Model-1 gate class-matrix (only if Model 1 is in the selection).
