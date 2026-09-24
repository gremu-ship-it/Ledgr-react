# LEDGR — R07 Approvals, Refunds, Voids & Correction Safety: Remediation Report

**Date:** 2026-09-21
**Package:** R07 (register §"R07 — Make approval, refunds and voids safe", Critical priority)
**Class:** Investigation + machine-verified boundary evidence + decision request. **Zero migrations; zero production-behavior changes.** A containment release is defined below and awaits approval (register: "Remove the false approval guarantee … through an *approved* containment release").
**Outcome:** Combined release evidence **614 PASS / 2 FAIL / 54 BLOCKED @670 records** — from the R06-final baseline 608/2/54 @664. All 664 previously-existing records **byte-identical**; exactly 6 new `R07.*` records added, all PASS; deterministic repeat run **0 diffs**. Root unit suite grew to **77 files / 661 tests** (+3 deterministic false-approval attack tests).

---

## 1. Central Question (R07 mandate)

> *Can a user cause a financially significant operation to execute merely because the client reports that a manager approved it?*

**Answer: YES — unconditionally and deterministically.** The approval is never transmitted, never verified, and never even recorded with the operation. A browser DevTools edit of one React prop (`canVoidSales`/`canProcessReturns = true`) bypasses the approval modal entirely; for users who do see the modal, any 4+ character PIN and any free-text approver name "authorize" the action. The financial mutation then executes with the **caller's own** raw-DML privileges against the database.

## 2. Traced Path (UI → service → database)

**Client**
- `PosPage.handleManagerApproved` (src/pages/PosPage.tsx:297): takes `_managerPin` (**deliberately unused — underscore**), calls `pendingApprovalCallback(approverName)`, closes modal. **No RPC, no repository call, no identity check of the approver.**
- `PosManagerApprovalModal` (src/components/pos/PosManagerApprovalModal.tsx:18-26): the ENTIRE verification is `if (!pin || pin.length < 4) setError(...)`. `managerName` is a free-text input defaulting to `'Store Manager'`.
- Consumers: `PosCart.tsx:115,142` (discounts above `maxCashierDiscountPercent`) and `PosSalesHistoryModal.tsx:100,126` (returns when `!canProcessReturns`, voids when `!canVoidSales`).
- Role gate: `usePosPermissions` — `canVoid = owner|admin|manager OR (require_manager_approval_void==false && perm)`. With default settings, cashiers see the modal; its "approval" is then client theater.
- **The wired `onProcessReturn`/`onVoidSale` callbacks in PosPage (lines 617-645) pass NO `approverName` at all** — even if the modal "approved" with a real identity, nothing would carry it.

**Service layer** (src/services/posService.ts)
- `processReturn` (line 1152): raw client DML — `repos.invoice.createWithLines` (credit-note with client-computed negative totals), `repos.inventory.recordMovement` (return_in), `repos.pos.updateShiftTotals`, then `log_manual_audit_event` with caller-composed notes (`"Approved by: {name}"` supported if provided).
- `processVoid` (line 1296): raw client DML — `repos.invoice.update({status:'void'})`, client-inserted reverse movements (now balance-propagating via R06 trigger), best-effort shift/audit updates.
- Both accept `payload.approverName` when present; PosPage never provides it. Errors are swallowed with `log.warn` (silent partial-completion risk).

**Server / DB (chain-wide inventory, now machine-verified in the release suite)**
- **Zero** public functions matching `approv|refund|void|revers|correct|unpost` (`R07.APPROVAL.NO-SERVER-COMMAND`).
- Sales documents carry **zero approval state**: no approval columns on `invoices`, `invoice_payments`, `invoice_lines`, `journal_entries` (approval columns exist only on `expenses`, `payroll_runs`, `stock_transfers`; `pos_settings.require_approval_for_void/refund` are client-consumed toggles, not approval records) (`R07.APPROVAL.NO-SERVER-STATE`).
- `invoices` triggers are only `trg_invoices_sync_amount_due` + `trg_invoices_touch_updated_at` — **no status-transition guard**; `status='void'` is a plain UPDATE wherever the caller's tier permits DML (`R07.VOID.NO-STATUS-GUARD`). (Payment-on-cancelled rejection DOES exist — R05 `22023` guard — the only correction-adjacent DB protection today.)
- `log_manual_audit_event`: sign-in + `can_write_business_data` only. `user_id`/`email` are server-derived; **all event content is caller-fabricated** (`R07.AUDIT.SAME-TENANT-FABRICATED-ACCEPTED`); the tenant boundary itself holds (`R07.AUDIT.CROSS-TENANT-DENIED` → 42501).

## 3. Attack Tests (deterministic, now permanent regression net)

New root-suite file `src/components/pos/__tests__/managerApprovalBoundary.test.tsx` — all 3 PASS (they characterize today's boundary and are authored to turn red when the containment release lands):

| # | Case | Result today |
|---|---|---|
| A | Fabricated PIN `"0000"` + default approver | onApprove fires — "approved", server never consulted |
| B | Forged approver text `"Ghost Manager"` | accepted verbatim — attribution is attacker-controlled |
| C | `handleManagerApproved` static mirror | no `rpc/repos/supabase` anywhere in handler; void/return payloads carry no approver identity |

Server-side fabrication: `R07.AUDIT.SAME-TENANT-FABRICATED-ACCEPTED` executes a cashier-authored audit event containing a forged approver string — accepted for the cashier's own business; cross-tenant is 42501.

## 4. Existing Contract (as found — no invention)

| Contract question | Evidence (traced) |
|---|---|
| Who can approve? | "Any string of 4+ characters" — no role/identity anywhere in the approval path |
| Is approval required for refunds/voids? | Client prompt only when the client-side role check says no; default settings `true` → cashiers always get the modal; anyone with `canVoid/canRefund` skips it |
| Approval tied to document/action/amount? | No — the callback is an opaque continuation; description is display-only |
| Single-use / expiry / replay? | Not applicable — there is no server token at all |
| Same person approve & perform? | Currently yes (self-approval is structurally the only kind possible) |
| Cancellation vs financial reversal? | `processVoid` marks `status='void'` + inserts supplementary movements; it does not reverse journals/payments (a paid void leaves settlement journals standing) |
| Duplicate void/refund? | Nothing prevents running `processVoid`/`processReturn` twice client-side except the movement-exists gap in the *posting* command — processVoid itself has no idempotency there |
| Stale approval? | Not applicable (no server state to age) |

## 5. What the migration chain DOES enforce today (do not lose this)

- Payment guards on cancelled documents (R05, 22023) — void/credit-note invoices and void expenses cannot take new payments.
- Posting-key idempotency for posted journals (R05, 23505) and exactly-once stock effects for posting **commands** (R06).
- Journal entries write-closed to direct DML (R05, 42501) — ledger mutations only via SECURITY DEFINER commands.
- Tenant membership on audit writes (42501 cross-tenant) and nonneg constraints on document-stock side-effects.

## 6. Proposed Canonical Contract (DECISION REQUESTED — DEC-05)

Everything below is **proposed, not built**. Register R07 requires server-verified authority before enabling restricted actions.

### 6.1 Correction commands (replaces raw DML)

1. `void_pos_sale_command(payload)` / `refund_pos_sale_command(payload)` / `reverse_journal_command(payload)` — SECURITY DEFINER, idempotent by caller `command_key` (unique per business; replay returns the prior result like `post_pos_sale`).
2. Validations: caller org membership + role tier for corrections (tier definition = decision input), document belongs to caller's org, status transition legal (`posted→voided`, `posted→partially_refunded→refunded`), totals consistent, cumulative-refund tracking (over-return denied), original currency/COGS preserved.
3. Effects: reversal journal via `_ledgr_post_entry_keyed` (existing infrastructure, posting-key protected), stock return as insert-only signed movements (R06 trigger propagates balance automatically), settlement reversal rows for refunds of paid invoices, state machine updated atomically in one transaction.
4. Ordinary unpaid cancellation == void of a doc with zero posted settlements: state + no journal reversal needed (explicit branch).

### 6.2 Approval authority (replaces browser PIN)

1. `pos_approvals` table: `(business_id, token, approver_user_id (must differ from approver's requester unless policy allows self — decision), action enum (void_sale|refund_sale|discount_above_cap), document_id, amount/discount snapshot, expires_at, consumed_at, consumed_by, created_at)`; single-use via `consumed_at is null` guard; expired tokens rejected.
2. `request_approval_command` (requester) + `authorize_approval_command` (manager-tier role, server-verified PIN → see 6.3) + correction commands accept `approval_token` and re-validate: token belongs to org, action matches, document matches, amount matches, unexpired, unconsumed, approver != consumer (unless self-approval policy approved).
3. PIN storage: bcrypt/argon2 hash on the **server** (Supabase Vault or hash column + service-side verify function) — a 4-digit PIN in transit is not an identity anyway; the token becomes the durable authority artifact which is auditable server-side with `user_id` derived from auth session.
4. Client modal becomes a token-issuance UI only; `handleManagerApproved` passes `approval_token` to the command; no more callback authorization.

### 6.3 Interim containment release (choose ONE, needs approval)

- **Option 1 (recommended): Role-locked restricted actions now.** Hide void/return/cap-discount controls for roles whose *real* permission lacks them (cashier, stock_clerk, viewer): no modal, no fake PIN; actions remain available to owner/admin/manager via their genuine server-side tier. Ship-tested by flipping the R07 attack tests (A/B must now fail).
- **Option 2: Disable self-service refunds/voids entirely** (all roles) with a documented support-correction process — register's explicitly allowed scope option; strongest safety, harms UX until 6.1+6.2 land.
- **Option 3: Honest rewording only** (modal renamed "Re-confirmation", banner states approval is not server-verified). Weakest; retains unrestricted DML but stops lying. Acceptable only as a same-day patch before Option 1/2.

**Recommendation:** Option 1 immediately, then 6.1+6.2 as the R07-follow-up package unblocking `POS.VOID`, `POS.REFUND`, `FINANCE.REVERSAL` (whose BLOCKED causes reference exactly this contract).

## 7. Evidence & Integrity

| Run | PASS | FAIL | BLOCKED | Records |
|---|---|---|---|---|
| Baseline (R06 final) `.cache/r13/ledgr-r13-v6XitO` | 608 | 2 | 54 | 664 |
| **R07 final** `.cache/r13/ledgr-r13-J7qRx3` | **614** | **2** | **54** | **670** |
| Repeat `.cache/r13/ledgr-r13-ejQ9nh` | 614 | 2 | 54 | 670 (0 diffs) |

- Integrity manifest `.cache/r07/comparison.json`: **664/664 byte-identical**; 0 changed; 0 removed; +6 `R07.*` (listed §8), all PASS.
- Remaining FAILs unchanged and later-owned: `EDGE.RETRY.no-secret` (R12/R14), `EDGE.WEBHOOK.viewer` (R12).
- `PATH.POS-SALE`-style preservation: `POS.STOCK` flip (R06) and all R01–R05 records untouched.

## 8. New Release Records (tests/release/r07-corrections.test.ts)

| Record | Fact attested |
|---|---|
| `R07.APPROVAL.NO-SERVER-COMMAND` | no approval/void/refund/reversal/correction command exists server-side |
| `R07.APPROVAL.NO-SERVER-STATE` | zero approval state on sales docs; approval fields exist only on expenses/payroll/stock_transfers |
| `R07.VOID.NO-STATUS-GUARD` | invoices has no status-transition guard (amount_due-sync + updated_at only) |
| `R07.AUDIT.SAME-TENANT-FABRICATED-ACCEPTED` | fabricated audit content accepted for caller's org (actor server-derived) |
| `R07.AUDIT.CROSS-TENANT-DENIED` | cross-org audit fabrication denied 42501 |
| `R07.DATA-UNCHANGED` | every probe rolled back; seeded audit (2 org-creation events), invoices, identities unchanged |

Gate registration: `'r07-corrections.test.ts': 'r07-corrections.json'`.

## 9. Regression Stack (All Green)

- Root unit suite **77 files / 661 tests PASS** (includes the 3 new attack tests)
- `tsc -b`: exit 0 · `eslint .`: 0 errors (1 pre-existing warning) · `node --check` on all release mjs: clean
- esbuild edge bundles **26/26** · placeholder production build: success · `git diff --check`: clean

## 10. Deliverables

| Path | Change |
|---|---|
| `tests/release/r07-corrections.test.ts` | 6-record boundary-evidence suite |
| `tests/release/gate.mjs` | Registration |
| `src/components/pos/__tests__/managerApprovalBoundary.test.tsx` | 3 deterministic false-approval attack tests |
| `.cache/r07/comparison.json` | Integrity manifest |
| This report + §6 decision request | Canonical contract proposal & containment options |

## 11. Result

R07's investigation mandate is complete: the false-approval boundary is traced end-to-end, codified into 9 permanent deterministic tests (6 release records + 3 client attack tests), and the integrity protocol confirms **no existing evidence was touched and no production behavior changed**. `POS.VOID`, `POS.REFUND`, `FINANCE.REVERSAL` remain BLOCKED pending decision on §6. Awaiting your containment decision (Option 1/2/3) and approval of the canonical contract (§6.1–6.2) to implement the actual remediation.

**STOP — decision gate.**
