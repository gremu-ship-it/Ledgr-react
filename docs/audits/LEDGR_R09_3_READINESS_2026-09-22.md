# LEDGR — R09.3 READINESS / RECONCILIATION DECISION ANALYSIS

**Phase:** DECISION / READINESS CHECK ONLY — **NO IMPLEMENTATION**
**Authorization:** R09.3 Readiness Gate (2026-09-22)
**Working tree:** R09.2 verified state (`75e3744`, PR #164) — preserved exactly
**Author:** Agent (Arena Agent Mode) · **Date:** 2026-09-22

*This document changes no code, no migration, no release record, no decision. It
verifies whether R09.3 (quota-denied, stock-denied, closed-shift reconciliation)
has the decisions/contracts required to receive a separate implementation
authorization — against actual repository evidence, not earlier proposals.*

---

## 1. Current Baseline

- **R09.2 state (preserved, immutable for this phase):** 670 PASS / 2 FAIL /
  53 BLOCKED / 725 records, deterministic ×2.
  Gate FAILs unchanged: `EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`.
- **R08 CLOSED:** 652 PASS / 2 FAIL / 51 BLOCKED / 705 records.
- Preserved as mandated: R09.1 cache confidentiality; R09.2 provenance,
  actor binding, quarantine, cross-tab lease, legacy quarantine. The two R09.2
  BLOCKED records (`R09.QUEUE.ACTOR-BINDING.SAME-USER`,
  `R09.QUEUE.REGRESSION.REPLAY-CONTRACT`) remain BLOCKED; their migration-only
  readback limitation is expressly not addressed here.
- Unit layer (743+16 infra folders aside) green; build, lint, both type lanes clean.

## 2. P-D2 Verification

P-D2 = *a typed quota-denial contract (dedicated error code or structured error
shape, declared once, asserted consistently by server metering paths, owned by
R10, consumed by R09.3).*

**Repository evidence (all current files):**

| Site | Evidence |
|---|---|
| Authoritative raise | `supabase/migrations/20260921000001_usage_limit_counts_documents.sql:70-73` — `raise exception 'Monthly transaction limit reached (%). Please upgrade your plan.' using errcode = 'P0001'` inside `_ledgr_assert_usage_limit(p_business_id)` (SECURITY DEFINER, volatile, set search_path). |
| Metering call sites (server) | `supabase/migrations/20260923000000_post_pos_sale_rpc.sql:659` `perform public._ledgr_assert_usage_limit(v_business_id);` inside `post_pos_sale` before document creation; the quick-save RPCs (payroll/expense/sale) established in `20260911000001`/`20260911000002` do the same pattern. |
| Read-only meter | `public.ledgr_monthly_document_count` (20260921000002) — counting RPC; cannot deny. |
| Client precheck | `src/lib/billing/UsageService.ts:206-220` — `assertCanCreateDocument` = client-side look-ahead via the count RPC, with clientKey replay-fallback (`findDocumentByClientKey`). Called in `src/offline/syncEngine.ts:163, 269, 358` for invoice/expense/payroll queue items. POS items rely on the **server-side** assert. |

**Answers to the mandated eight questions:**

1. **Typed contract present?** **No.** The denial is SQLSTATE `P0001`
   (`raise_exception_class` for plain `raise exception`), with the limit only
   inside a human-language message string. No dedicated SQLSTATE (e.g. `P0002`+
   is still generic for explicit raises), no `detail`/`hint`/jsonb payload,
   no machine-readable discriminator anywhere in the call path. Supabase/RPC
   surfaces pre-P0001 code as-is — there is nothing in the repository mapping
   it to a quota-specific error shape.
2. **Server-authoritative?** Yes — the assert runs inside the posting
   transaction (SECURITY DEFINER) in `post_pos_sale` and the quick-save RPCs.
   Authority is correct; the *signal type* is not.
3. **Stable and machine-readable?** No. Consumers can only regex the message
   text ('Monthly transaction limit reached...'); the identifier `%L` is
   interpolated, no structured metadata, and `P0001` collides with any other
   application `raise exception` (shared class).
4. **Distinguishes quota from transient/database/network?** Only by message
   text, and only in English today. Network/database failure classes
   (`08000`,`2F000`, etc.) are distinct from `P0001`, but *quota vs. any other
   application-raised P0001* is not distinguishable deterministically.
5. **Used consistently by metering paths?** The paths that exist call the one
   function consistently (`post_pos_sale`, quick-save). Consistent raise site —
   but *no typed contract* to assert.
6. **Has R10 delivered P-D2?** **No.** No R10 phase has landed in the
   repository (no R10 migrations, no error-shape module, no shared typed
   contract file). The P-D2 prerequisite record stands as adopted in
   `LEDGR_R09_DECISION_CONSISTENCY_2026-09-22.md` §P-D2 / bundle D-2 amendment.
7. **If it existed, is consumption additive/contract-safe?** Yes — the queue
   failure path already funnels every RPC error into
   `lastError` + `failed`, and a typed shape would slot into the same boundary
   without touching R06/R08 semantics. The consumption STRATEGY is ready; the
   artifact to consume does not exist.
8. **If missing — R09.3 blocked?** Yes. Mapping "this failed item is a quota
   denial (policy) not a transient failure (retry)" requires exactly what
   P-D2 provides; inventing the discriminator inside R09.3 would be a new
   undeclared contract → forbidden by the mandate (do not invent P-D2).

## 3. D-2 Status

> **D-2 BLOCKED — P-D2 NOT DELIVERED**

(Not "READY WITH NARROW PREREQUISITE": the missing artifact is substantive — an
R10-owned contract declared once and asserted by server metering paths. Nothing
in scope for R09.3-impl can produce it legally.)

## 4. D-3 Model Comparison — P-D3-FINAL

Option set is the consistency-narrowed {Model 1, Model 3, Model 4} — the
controlled-oversell model was ruled out (and stays ruled out, §6). No signed
`P-D3-FINAL` exists anywhere in the repository (verified by full-tree grep of
docs/audits and sign-off forms — only the prerequisite listing, never an
executed selection).

**Common platform facts (verified):**

- Replay path is `post_pos_sale` (POS) and the quick-save RPCs, all enforcing
  the ONE authoritative stock propagation `_ledgr_apply_stock_movement_balance`
  (20260928000001_r06_stock_balance_authority.sql:53, :118) with the
  `chk_inventory_balances_on_hand_nonneg` check (20260817000001:50) raising
  **23514** in-transaction; every denial currently lands in the queue as
  status `failed` with the error text in `lastError`, retried by the normal
  loop until MAX attempts (none — retries continue) — *today policy-denied
  items are visually indistinguishable from transient failures* (drawer shows
  free-text).
- R09.2 states: `pending|syncing|synced|failed|quarantined` with
  `quarantineReason` ∈ `{actor-mismatch, missing-provenance, legacy}` +
  durable metadata + lease on each row.

| Concern | Model 1 — Restricted offline selling | Model 3 — Reject/quarantine | Model 4 — Reconciliation workflow |
|---|---|---|---|
| Affected queue states | Unchanged pending; adds a capture-time gating layer (capture denial never enqueues) | `failed→` new/repurposed exception state for 23514 policy rejections | New visible exception state(s) + reconcile actions through R06 mechanisms |
| Required server response | None new at capture; replay still hits 23514 if stale cache was wrong | Existing 23514; client must RELIABLY classify it. 23514 is a distinct typed SQLSTATE — **available today**, unlike quota P0001 | Existing 23514 + R06 authorized adjustment commands (movement posting RPCs) executed by an actor |
| Client behavior | Refuse capture when cached on-hand would go negative (cached value = evidence only) | Convert 23514 into durable quarantine-like exception | Surface as exception; an authorized user posts an R06 adjustment, then retries replay |
| R06 modification | None | None | None |
| New financial authority | No | No | No (reuse existing movement / posting commands) |
| Accepted-offline-sale representation | Not enqueued (capturer warned at till) | Quarantined exception with full payload | Exception queue entry with full payload |
| User learns reconciliation needed | At capture (till warning) | Drawer/site badge on the exception state; **requires a new exception-visible state like quarantine** | Same, plus explicit reconcile action |
| Duplicate replay protection | `clientKey` unique path unchanged | Same + exception excludes item from auto-replay | Same; retry only after adjustment, previously idempotent |
| Stock under R06 | Yes | Yes | Yes |
| R09.2 compatibility | Independent (capture-time layer) | Direct — fits the quarantine pattern, needs a quarantineReason extension (`stock-denied`) or a sibling exception status | Same shape as 3 + a reconcile (never transfer) action |
| Unresolved dependency | Cached-stock staleness discipline + product copy decisions | Typed **signal** for quota still missing (quota half); stock half alone consumable once classification strategy decided | Approval path for adjustments resolves to EXISTING mechanisms — must not invent |
| Risk | Offline usability reduced at low stock; false negatives from stale cache; NEW local decision surface | Policy items visibly stop; retained evidence — clean failure semantics | Offline sale *attempt* survives capture ⇒ POS UX unchanged; reconcile demand can surprise business owners |

**Model interaction caveats** (kept explicit, not silently resolved):
- 1 and 3 are **composable by design**: 1 reduces frequency, 3 is the
  guaranteed backstop. 4 is orthogonal workflow DEPTH, not a capture/replay
  rule — 4 only makes sense ON TOP of 3's visible exception.
- Model 1 alone is UNSAFE as the only answer: cached evidence lies (multi-user,
  returns post-capture), and a capture-time refusal never retro-fits items
  already enqueued.
- No model is selected here. Any single-model pick (e.g. "just 3") or composite
  ordering rule (e.g. "1 with 3 backstop") changes accepted-offline-sale UX and
  till behavior — signed-owner territory.

> **P-D3-FINAL — DECISION REQUIRED.** No signed model selection found in the
> repository. Attempting to proceed would decide product policy by
> implementation, which this phase explicitly forbids.

## 5. Controlled Oversell — Explicit Prohibition Verified

Current server ground truth: `chk_inventory_balances_on_hand_nonneg`
check constraint — the FINAL definition (validated, not `not valid`,
20260911000001:123 series) — plus `_ledgr_apply_stock_movement_balance`
header comment: oversell denial **delegated** to the check, 23514 inside the
posting command's transaction (20260928000001:34-39, :118). No code path in the
repository softens, overlays, or conditionally skips this constraint; the
repository layer cannot write negative balances through any path.

**Replay permitting `on_hand < 0` (weakening/bypass of the check) is and
remains FORBIDDEN.** Any R09.3 implementation proposal that requires it = STOP
and classify as a new R06 decision requirement. None does — Models {1,3,4}
are all compatible with the standing invariant.

## 6. D-4 / R08 Compatibility

R08 verified contracts (current files):

- Shift steering restricted to the caller's OWN shift (42501,
  20260930000001_r08_post_pos_sale_binding.sql:120-127); branch via shift
  (`coalesce(v_branch_resolved, v_shift_row.branch_id)`, :129).
- Closed shift ⇒ `v_late := true` (DEC-08 late path, :126-128), landing in the
  append-only `pos_shift_late_adjustments` (20260930000000:149 f., SELECT-only
  role grant, policy-gated); the close is a signed snapshot (status=`closed`
  with immutable close payload, 20260930000000:441 (:462), comment :9).
- Legacy/branch-less compatibility path = `branch_id IS NULL` tolerated where
  no shift resolves a branch (the acknowledged SERVERSIDE residual; still open
  for old clients; DEC-09 window + separately authorized additive server check
  closes it — **not part of R09.3**).

**Interaction with the three products of the models:**

| Situation | Effect under any of {1,3,4} |
|---|---|
| Open shift | Replay continues under the R08 live shift path. Stock/quota denials become the model's exception, NOT a drawer-total edit. |
| Closed shift (item queued pre-close) | post_pos_sale binds to the now-closed shift and routes via DEC-08 late adjustment (existing behavior). A stock/quota denial still wins over late adjust: exception lands, no snapshot touched, no local shift recreated. |
| Valid claimed shift (after reload) | Identity via R09.2 provenance/shiftId; R08 path decides acceptance. |
| Terminal-bound shift | Terminal check applied server-side by R08 binding (20260930000001/0001 series); client exceptions never bypass. |
| Shift-less legacy payload | Legacy items are QUARANTINED evidence (R09.2 §5) and remain so; a stock/quota surface NEVER auto-unquarantines them. |
| Late adjustment | Preserved byte-for-byte mechanism; R09.3 may only CLASSIFY the failure of the late-adjusting attempt, not mutate the adjustment. |
| Quarantined queue item | Never re-enters replay due to R09.3 (see §7). |

R08 requires **no modification** by any of the three models; none of my
findings imply the legacy residual must change now (STOP condition avoided).

## 7. R09.2 Compatibility

Verified against the shipped implementation:

- **Actor-mismatch quarantine:** sync selection excludes `quarantined`
  statuses (`offlineDB.queue.where('status').anyOf('pending','failed')`;
  sweep and replay operate there only). A reconciliation/exception mechanism
  keyed to the same pattern cannot accidentally release an actor-mismatch
  item: releasing any quarantined item requires an explicit, separate,
  authorized action, and R09.3 adds none.
- **Missing provenance / legacy:** same exclusion; nothing in Models {1,3,4}
  would touch these rows — they remain evidence-only.
- **Valid provenance:** replay is still `commitPosSaleDocuments → post_pos_sale`
  with the same clientKey idempotency; any exception-erase is one explicit
  state change inside the existing engine.
- **Lease:** any R09.3 UI-triggered retry must reclaim via `claimLease`/
  `renewLease`/`releaseLease` exactly like the sync loop — no second lock.
- **Replay-time classification** of 23514 (distinct typed SQLSTATE, already
  distinguishable today) and of POOO1 (untyped, see §2–§3) lands AFTER the
  same lease claim, preserving single-tab ownership semantics.

Compatibility verdict: R09.2 states are consumed, not weakened, for all three
models.

## 8. Financial-Safety Analysis

| Question (per any model) | Answer from current evidence |
|---|---|
| Money/inventory change BEFORE reconciliation? | No: 23514 aborts the posting transaction; quota P0001 aborts pre-insert; closed-shift cases route the FULL document through DEC-08 server-side. No client-side financial mutation is proposed by any model. |
| Failed offline sale silently lost? | Never: payload + provenance + clientKey + error evidence persist (R09.2); capture-time refusals in Model 1 are visible at capture, not silent denies. |
| Accepted sale indefinitely invisible? | Today YES for policy denials (policy failure indistinguishable in the loop). Models 3/4 fix this with a dedicated visible exception state — which R09.2's queue model can host additively. |
| Retryable vs policy rejection distinguishable? | Stock: yes (23514 is typed). Quota: **not safely** (untyped P0001 — §2/§3). This asymmetry is the precise shape of the P-D2 gap. |
| Sufficient evidence retained? | Complete financial payload + provenance + timestamps + clientKey + lastError; quarantine metadata; ledger unreadable-by-mutation but inspectable. |
| clientKey idempotency intact? | Yes — server unique path + replay completes prior commit AND idempotent retry both verified in R08 evidence; Models never alter it. |
| Journal under R05? | Unchanged. |
| Stock under R06? | Unchanged (single authoritative propagation + nonneg check). |
| POS authority under R08/R09.2? | Unchanged (shift binding, 42501 classes, late adjustments). |

## 9. Repository Evidence Index

- Quota raise: `supabase/migrations/20260921000001:70-73` (P0001); call sites `20260923000000:659` (+ quick-save RPCs).
- Usage client: `src/lib/billing/UsageService.ts:206-240`; sync caller sites `src/offline/syncEngine.ts:163, 269, 358`.
- Stock invariant: `20260817000001:50`; propagation `20260928000001:53, 118`.
- R08 shift binding/DEC-08: `20260930000001:118-130`; snapshot + late-adjust table `20260930000000:149-166, 441-462`.
- R09.2 mechanics: `src/offline/provenance.ts`, `lease.ts`, `syncEngine.ts` (sweep/gate/lease), `db.ts` (v2 states), `legacyPosQueue.ts`.
- Compiled contracts: `tests/release/offline.test.ts` harness identity/rpc patterns; records' classifications at `.cache/r13/.../evidence.json`.
- Decision record: `docs/audits/R09_DECISION_BUNDLE_2026-09-22.md` (D amendments), `LEDGR_R09_DECISION_CONSISTENCY_2026-09-22.md` (P-D2/P-D3-FINAL listings).

## 10. Exact Prerequisites For Implementation Authorization

1. **P-D2 delivered by R10** — typed quota-denial contract:
   dedicated SQLSTATE or structured error payload, declared once, asserted by
   all server metering paths (`post_pos_sale`, quick-save), surfaced by the
   Supabase client unchanged enough to map deterministically. Additive with
   respect to R06/R08.
2. **P-D3-FINAL signed** — model selection from {1, 3, 4} (or an explicitly
   written composite rule), with the answer to: capture-time gate yes/no
   (Model 1 adoption), exception-state shape (Model 3 reuse of quarantine vs
   new status), and whether any reconcile action is in R09.3 scope at all
   (Model 4 depth).
3. **D-4 rider re-confirmed** unchanged (§6 interactions carry no R08 edit).

## 11. New Decisions Required (none invented here)

| # | Decision | Owner | Blocks |
|---|---|---|---|
| P-D2 | Typed quota-denial contract | R10 (consumed by R09.3) | All quota pathmapping in R09.3 |
| P-D3-FINAL | Final stock policy selection / composite | Sign-off owner | All stock pathmapping in R09.3 |

If either future authorization proposes: replay with `on_hand < 0`, an R06
edit, an R08 edit, a new financial authority mechanism, manager transfer, or
closing the legacy branch-less server path early — STOP and treat as a new
decision requirement (D-3/R06/R08/DEC-09 respectively).

## 12. Final Readiness Gate

> ## `BLOCKED`
> **A required technical contract (P-D2) is missing and implementation cannot
> safely proceed.** Secondary condition: `REQUIRES DECISION` on P-D3-FINAL.

Suggested path to green: R10 delivers P-D2 (typed contract only; nothing else
touches R09.3); sign-off executes P-D3-FINAL (one model or written composite);
this file's §10 checklist becomes the acceptance criteria for the R09.3
implementation authorization.

**STOP attestations:** no implementation, no code/migration/release-record
changes, no decision chosen silently, no model selected by convenience; R06/R08
unmodified; no new financial authority invented.
