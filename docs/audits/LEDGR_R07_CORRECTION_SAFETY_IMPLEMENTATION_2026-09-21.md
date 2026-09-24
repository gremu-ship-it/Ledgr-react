# LEDGR — R07 Correction Safety: IMPLEMENTATION Report (Decision A + Decision B)

**Date:** 2026-09-21
**Package:** R07 — Make approval, refunds and voids safe (Critical)
**Predecessor:** `LEDGR_R07_APPROVALS_CORRECTIONS_REMEDIATION_2026-09-21.md` (investigation + decision request; user approved the defined containment)
**Outcome — release evidence:** **630 PASS / 2 FAIL / 51 BLOCKED @683 records**, deterministic repeat **0 diffs**.
  Root unit suite **77 files / 666 tests** (all green, incl. the flipped R07 attack-suite now guarding the contained boundary). `tsc` clean; `eslint` clean on every touched file; `SKIP_ENV_CHECK=1 npm run build` ✓ (the default build's intentional missing-secrets guard is unchanged and unrelated).
**History discipline:** against the fixed R13 baseline (`.cache/r13/ledgr-r13-v6XitO`): **0 records removed, 3 changed** (the three authorized BLOCKED anchors flipping to PASS: `POS.VOID`, `POS.REFUND`, `FINANCE.REVERSAL`), **19 added** (all new `R07.*` records). Every other pre-existing record is **byte-identical** across all files (status, expected, actual, source, layer).
**The release gate remains NOT GREEN by contract.** The only 2 FAILs are the standing R12-owned records (`EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`), untouched, in their original wording.

---

## 1. What was approved vs. what shipped

| Mandate decision | Shipped |
|---|---|
| **A — role-locked containment.** Roles not independently authorized are restricted; the server rejects. No new role policy invented. Direct workflow preserved for already-authorized roles. | Direct correction tier = `owner/admin/manager` **inside the server commands** (`_ledgr_correction_preflight`), exactly mirroring the pre-existing client permission model (`canVoidSales`). Everyone else must carry a live server-minted approval token. Cashier attempts without a token: `22023` (`R07.CORRECTIONS.TOKEN-REQUIRED-OUTSIDE-TIER`). React permission helpers untouched. |
| **B — canonical server-verified approval contract.** | `pos_approvals` + `request_pos_approval` / `authorize_pos_approval` / `_ledgr_consume_pos_approval`: org+document+action-bound, 15-minute TTL, single-use, approver≠requester enforced. The client never authorizes. |
| **§3 — PIN.** | **No PIN credential system was introduced.** The client PIN modal is deleted outright. Identity = the authenticated approver session (`auth.uid()` in `authorize_pos_approval`). No PIN is stored, hashed or plaintext, anywhere — documented choice acknowledged, `R07.APPROVAL.SERVER-STATE` pins "no pin-shaped server function exists". |
| **§4 — minimal authoritative state.** | Two tables: `pos_approvals` (request/authorization lifecycle) + `pos_corrections` (append-only correction ledger). No wider architecture was needed; no existing financial table gained approval columns (proven). |
| **§5 — refund command.** | `refund_pos_sale_command`: one atomic transaction — identity→membership→authority→document ownership→document status ("paid" only; voided refused)→eligibility→approval consumption→**cumulative remaining check**→idempotent replay→restock at original cost→scaled VAT/COGS mirror→settlement mirror on the resolved tender→append-only ledger. ANY rejection yields ZERO financial mutation (`R07.REFUND.REJECT-ZERO-MUTATION`; SQLSTATE `22023` with a business message). |
| **§6 — cumulative matrix.** | `R07.REFUND.CUMULATIVE-SERVER-SIDE` (partial 500→partial 500→over-remaining 501 denied→exact remaining 500→0.01 denied; server total 1500) + `R07.REFUND.FULL-THEN-REPLAY` (full→second-full denied→same-key replay idempotent). |
| **§7 — void semantics from the existing model.** | `void_pos_sale_command`: full mirror-reversal of ALL posted journal entries (sale + settlement + COGS), restock at original cost via the R06 balance trigger, invoice → `void` (never erased/overwritten — originals remain). A doc with recorded refunds cannot be voided (`R07.VOID.AFTER-REFUND-DENIED`: converge via refunds). |
| **§8 — distinct concepts.** | Void ≠ refund ≠ status-handwave: void=full reversal for never-refunded paid docs; refund=cumulative partial path; status remains machine-guarded; raw status UPDATEs still write no ledger (boundary truth `R07.VOID.NO-STATUS-GUARD` retained and relevant until R07 follow-up narrows invoice UPDATE). |
| **§9 — self-approval: default DENY, policy parked.** | `authorize_pos_approval` refuses requester==approver (`22023`, `R07.APPROVAL.SELF-APPROVAL-DENIED`). **Register decision parked:** whether an owner may self-authorize with an additional control (e.g. dual-owner counter-signature) is a business-policy call and is now a register entry, not a code default. |
| **§10 — replay matrix.** | Same approval + same doc/action: exactly one live use then `already been consumed`. Different doc / different action / cross-org request: `22023`/`42501` (`R07.APPROVAL.REPLAY-CONSUMED`, `BINDING-MISMATCH-DENIED`, `EXPIRY-ENFORCED`). Unknown-token gibberish denied. |
| **§11+ — UI reflects workflow; never authorizes.** | New modal (§"client containment" below). **Assumption to flag (§11 was truncated):** an in-app *approver-side* management screen ("pending approvals list + approve button") was NOT built; authorization currently executes via the mounted server contract (`authorize_pos_approval` is granted to the direct tier). The operator UI requests & displays; approval intake UI is a parked follow-up (§7 register). |

---

## 2. Server surface (supabase/migrations/20260928000002_r07_correction_commands.sql)

Six functions, `security definer`, minimal `set search_path`; grants: EXECUTE to `authenticated` on the four public verbs only (consume/preflight are internal). **Presence-pinned:** `R07.APPROVAL.SERVER-COMMAND-SURFACE` asserts exactly these six exist and nothing else correction-shaped — superseding, under a new identity, the investigation records `R07.APPROVAL.NO-SERVER-COMMAND` / `NO-SERVER-STATE` (made false by implementation; see §"record conversions"). Authorization status after authorization: the approval rows are **write-closed to app roles** — only the definer commands mutate them (the expiry probe had to time-travel via observer privilege, proving the boundary).

Financial derivation (from the existing model, no invented accounting):
- **Tender resolution**: explicit payload account → first recorded payment's bank account → cash 1110. Sale mirror flips every original line; VAT negated proportionally; COGS mirrored per-entry with every line scaled by returned-cost / original-COGS-total (fixes an earlier one-sided mirror that legitimately failed the posting balance rule).
- Ledger keys: `void:<original_key>`, `refund:<command_key>:<entry>`, …`:settlement/:cogs` — replay-detected; command keys are idempotency keys.
- Every command appends one `pos_corrections` row (org, doc, action, amounts, actor, key) and one audit event.

## 3. Probes & suites (19 records)

- **Anchored flips (3):** `POS.VOID` (exactly-once, mirrored keys, stock+cost restored at 100@900), `POS.REFUND` (tender pair on 1110 ±1500, revenue debit-mirror, COGS mirror 900, data-unchanged invariants), `FINANCE.REVERSAL` (full approval choreography cashier→owner→cashier; consumed token cannot re-authorize; history preserved). Probe architecture rule discovered and applied for all three: role-executed steps capture command returns, ONE `reset role`, THEN observer reads — because `journal_entries`/`inventory_balances` are intentionally grant-closed to app roles (42501).
- **New matrix suite `r07-approvals.test.ts` (13):** lifecycle, self-deny, authority-deny (incl. viewer-request and gibberish-token), expiry at authorize AND consume, replay-consumed, binding mismatches, cumulative, full+replay, zero-mutation, status gating (draft → `/Only a posted (paid)/`, voided refused), void-after-refund, tier enforcement, data-unchanged.
- **`r07-corrections.test.ts` (6):** the two pre-implementation catalog absence records were **converted to presence records** (`R07.APPROVAL.SERVER-COMMAND-SURFACE`, `R07.APPROVAL.SERVER-STATE`) — same positions, honest predicates; the remaining four characterization records (`R07.VOID.NO-STATUS-GUARD`, `R07.AUDIT.*`, `R07.DATA-UNCHANGED`) still hold and are untouched.

## 4. Client containment (Decision A, zero client authority)

- **`src/services/posCorrectionRpc.ts` (new):** the ONLY correction path to a real backend. **No raw-DML fallback** — a stale backend fails closed with `PosCorrectionUnavailableError` (deliberately stricter than the sale-posting path; fallback would resurrect the removed boundary). 22023 *"has not been authorized"* is classified as `PosApprovalPendingError` for honest UI messaging.
- **`posService.processReturn/processVoid`:** now thin routers → canonical RPCs (payload→command JSON; auto idempotency key). The legacy raw-DML bodies surviveONLY as `processReturnLocal/processVoidLocal` behind `isDemoMode()` (the offline demo simulator owns an in-memory dataset with no server boundary at all; unreachable in any real session). `approverName` deleted from both correction payloads; `approvalToken` added.
- **`PosManagerApprovalModal` rewritten:** PIN field gone, free-text approver field gone, zero `<input>`. Modes: **server** (request approval → display pending token state → continue; the SERVER decides consumption) for voids/refunds; **display** for non-financial in-cart nudges (over-cap discount acknowledgment; authorizes nothing).
- **`PosPage`/`PosSalesHistoryModal`/`PosCart`:** interceptor now transports only `(token | undefined)`; document-bound contexts (`void_sale`/`refund_sale`) attach to history flows; approval minting happens via `requestPosApproval` on the server.
- **Attack suite flipped:** `managerApprovalBoundary.test.tsx` — the three deterministic false-approval attacks turned RED at containment (success signal), then were replaced by 5 permanent ATTACK GUARDs pinning: no pin-shaped code, no approver-identity fields, page transports only the token, service has exactly one correction path (demo-gated legacy), payloads carry no approver fields.
- **`posService.test.ts`:** returns/voids section rewritten to the canonical contract (RPC routing + line mapping + token pass-through, fail-closed on PGRST202, pending classification, idempotency keys).

## 5. Register entries (parked decisions, owned follow-ups)

1. **Self-approval policy** (§9): default-deny live; business may later opt into counter-signed self-authorization via a new server command — never via client.
2. **Approver intake UI:** `authorize_pos_approval` has no in-app screen yet (external/ops intake per §1 assumption). Follow-up: pending-approvals inbox for the direct tier.
3. **Invoice UPDATE narrowing:** raw DML can still write `status='void'` silently (`R07.VOID.NO-STATUS-GUARD`). Stage-3 style trigger guard (post-corrections) is the natural next step once every client path is on the commands; deferred to keep R05/R06 anchors byte-stable today.
4. **Returns/corrections display in the till:** pos_corrections is server-side ledger-first; sales-history register visualization pending.
5. **§11-truncation assumption** (per mandate: flag divergent risks) — see §1 last row.

## 6. Verification ledger

| Check | Result |
|---|---|
| Migration replay (PG17 full chain incl. R07) | clean; fixture chain green |
| Release protocol | **630 PASS / 2 FAIL (R12-owned) / 51 BLOCKED @683** |
| Deterministic repeat | 0 diffs |
| Baseline byte-identity | 0 removed, 3 authorized flips, 19 added, all others byte-identical |
| App unit suite | 666/666 (77 files) |
| `tsc --noEmit` / `eslint` (touched files) | clean |
| Build | ✓ with `SKIP_ENV_CHECK=1` (missing-secrets guard unchanged by design) |

**STOP.** Awaiting review; no further scope enters without a new register entry.
