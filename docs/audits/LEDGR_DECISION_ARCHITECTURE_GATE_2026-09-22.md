# LEDGR — DECISION & ARCHITECTURE GATE (PRE-R09.3 / WHOLE-APPLICATION REMEDIATION)

**Date:** 2026-09-22 (Africa/Blantyre)
**Branch / commit:** `arena/01a0c215-ledgr-react` @ `ccd37ac` (whole-application coverage review)
**Mode:** DECISION, ARCHITECTURE, DEPENDENCY AND SCOPE ANALYSIS ONLY — nothing implemented, nothing fixed, nothing selected.
**Baseline honored:** 678 PASS / 2 FAIL (`EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`) / 53 BLOCKED / 733 records — not reinterpreted.

---

# 1. Executive Summary

1. **DEC-02 (phone recovery) is not actually an open policy question** — it was formally approved in R02 §26 (2026-09-21) with a complete contract; what remains is the approved work program (a–f) plus runtime/provider evidence. One in-report wording tension exists and is documented (§D-02), not resolved here.
2. **P-D3-FINAL remains the single policy decision that must precede R09.3.** Everything else can run parallel to or after R09.3 with explicit scope carve-outs (§18).
3. **The two open FAILs (R12) and the non-POS financial-authority family (GAP-1..7) are implementation gaps, not evidence gaps** — they cannot be closed with runtime testing alone. They are, however, **independent of R09.3** and independently release-blocking.
4. **GAP-6's critical question is partially answered by code inspection: the balance invariant DOES propagate on every writer today** (`trg_stock_movement_apply_balance` → `_ledgr_apply_stock_movement_balance`, R06 migration), so transfers cannot change quantities without the non-negative constraint. What remains genuinely open on that path is **cost authority (caller-supplied `unit_cost` enters weighted-average cost), dispatch/receive idempotency, and two-step atomicity** — not the invariant itself.
5. **The only implementation package authorizable today without making policy decisions for the project is the R12 webhook/edge remediation package** (the expected behavior is already asserted by existing release records; no option selection is involved).
6. **Minimum safe prerequisite set to enter R09.3: {P-D3-FINAL signed; acceptance of scope carve-outs defined in §18}.** No implementation item is a strict prerequisite.

---

# 2. Decision Register (§4 requirement)

| Decision ID | Decision required | Why it matters | Affected surfaces | Dependencies | Consequence per option | Required before |
|---|---|---|---|---|---|---|
| **D-01** | P-D3-FINAL — offline queue policy for rejected/denied sale replays, from viable set {Model 1 restricted offline selling, Model 3 reject/quarantine, Model 4 reconciliation workflow} (compositions allowed per R09.3 analysis) | R09.3's entire exception semantics; what "failure" means for offline-minted receipts | Offline queue, sync engine, till UX, reconciliation surfaces | R09.2 evidence (authoritative), R06 invariant (unchangeable), R10 typed quota boundary | see §D-01 | R09.3 implementation |
| **D-02** | Whether to keep the R02-approved recovery contract as-is and fund its remaining work program; or formally re-open the contract (not recommended; would require its own rationale) | Recovery is identity-critical; containment (RECOVERY_UNAVAILABLE) is interim by design | Auth/recovery, onboarding, support ops | R02 evidence, R14 support-verification coordination | keep = proceed with (a)–(f) items + runtime evidence; re-open = new design cycle + containment stays | permanent recovery implementation package |
| **D-03** | DEC-03 branch matrix: org-wide vs assigned-scope roles; one vs multiple branch assignments; `business_users.branch_id IS NULL` = org-wide (already codified in `can_access_branch`) — confirm or replace; per-table scope matrix | 8 BRANCH.* records; every direct-write surface w/o branch predicates; AI.BRANCH | ~all write surfaces, views, reporting | R04 role helpers, R08 usage, offline queue scope | org-wide confirm → harden/enforce + evidence; assigned-matrix → columns+predicates+records | Branch package; informs R09.3 carve-out |
| **D-04** | Receipt-dispatch classification & authority boundary: product requirement with security touchpoints (see §D-04); whether receipts must be server-generated artifacts or client-rendered views | R07.RECEIPT.DISPATCH historic BLOCK | POS receipts, invoices (dispatch already exists), delivery events | R07, R12 tone | product-only acceptance vs server-artifact implementation | dispatch package; does not block R09.3 |
| **D-05** | Invoice/payroll quota: A (extend P0QLT contract to those RPCs) / B (exclude from metering) / C (defer separate decision) | Meter semantics today count invoices+payroll but only enforce on 3 posting paths | Invoices builder path, payroll run path, billing UX | R10 contract | A → consistent meter; B → semantic inconsistency (counted ≠ enforced) + weakens authority posture; C → current asymmetry persists w/ documentation | decision before closing billing/quota surface; not before R09.3 |
| **D-06** | CI gate semantics (A all-PASS / B signed-expected / C mandatory-vs-deferred split) | gate is RED today by design; closure needs an accepted terminal semantics | CI, release process | R12 package, runtime package, seal status | see §17 | release closure |
| **D-07** | A/B/C architectural direction per financial GAP (§5 gate). One registry decision with per-GAP pick | determines implementation body size of the non-POS financial authority package | journals, invoices, payroll, bank, assets/fx, transfers, tax config | R05 evidence, §5 analysis | per-GAP table below | P-FIN-AUTH package |

---

# D-01 — Offline Stock Reconciliation (models from R09.3 viable set only; no controlled oversell)

| Dimension | Model 1 — Restricted offline selling | Model 3 — Reject/quarantine | Model 4 — Reconciliation workflow |
|---|---|---|---|
| R06 non-negative invariant | Untouched (client uses cached on-hand as evidence-only hint; server constraint still final) | Untouched (23514 stays the final answer) | Untouched — correction executes **through R06 mechanisms** (movement + invariant), never bypass |
| R08 signed shifts | Unchanged; capture-time denial never writes shift state | Failed replays stay evidence on item; late-adjustment path unaffected | Reconcile event lands as approved movement inside a (possibly late) shift context — interacts with DEC-08 late-adjustment semantics |
| R09.2 actor binding | Independent (capture-time layer) | Fits existing quarantine shape; needs `quarantineReason` extension (`stock-denied`) or sibling exception status | Same as Model 3 + explicit reconcile *action* (never a transfer) by an authorized actor — reuses actority, adds a new audited action |
| Quota denial `P0QLT` (R10) | Orthogonal: capture-time refusal ≠ quota; quota denial surfaces at replay with `P0QLT`; since R10, the boundary CAN distinguish quota (plan policy) from stock denial (23514) — a Model-3/4 exception state should key on the **typed code**, not message text | Same — quota items should NOT be quarantined as stock rejections; `lastErrorCode` enables exact routing (this is why P-D3-FINAL should state the P0QLT routing explicitly) | Same + resolve-then-retry flow must re-evaluate quota at retry time (plan state may have changed) |
| UX | Deny at till; no orphan queue items | sale "accepted" offline then visibly exceptioned later (disclosure pattern needed) | exception + resolve action; heaviest UX surface |
| Financial/inventory integrity | Highest (never over-sells beyond cached evidence window) — but multi-device cache staleness ≠ proof | Integrity safe; sale loss risk moves to exception-handling discipline | Highest correction safety; largest operator burden |
| Implementation scope | smallest: capture gating + server unchanged | small-moderate: exception state + quarantineReason/sibling + surfacing | largest: exception state + reconcile action + audit trail + retry integration |
| Evidence required | capture-denial records; staleness-window documentation | exception-state lifecycle; code-routing records (23514-quarantine ≠ P0QLT-administrative) | full reconcile lifecycle + actor + audit + retry re-check records |

**Interaction notes transcribed from R09.3 (preserved):** Model 1 alone is unsafe as the only answer (cached evidence lies in multi-user shelves); 1+3 composable; Model 4 only atop Model 3. **Not selected here.**

---

# D-02 — Phone Recovery (DEC-02/R02)

**What is actually unresolved vs already decided — precise inventory:**

| Item | Status | Nature |
|---|---|---|
| Phone as account *identifier* | **DECIDED** (R02 §26.3): unique phone may locate its account; never authorizes credential change | none pending |
| Verified possession | **DECIDED direction** (OTP-based possession, single-owner; shared phones deliberately excluded §26.4); implementation NOT authorized/built | future implementation (§26.9a) |
| OTP/provider dependency | Contract requires app-owned challenge = single-use, atomic, time-limited, replay-resistant (§26.6); provider choice is a build item | future implementation |
| Credential rotation on never-signed-in accounts | **DECIDED deny** (§26.5) | none pending |
| Recovery authority (who may effect recovery) | **DECIDED**: provider email flow / support-verification process (§26.1); phone-only = RECOVERY_UNAVAILABLE (containment) | support-verification process itself to be specified with R14 (ops) |
| Shared-phone prohibition | **DECIDED** (§26.4, §24 finding = data-integrity issue) | duplicate-capable display phones remain a data-integrity item |
| Runtime/provider evidence | 12 records BLOCKED (PROVIDER-TOKEN ×9, OTP ×3) + DEC-02 corridor ×1 | **evidence only** — needs isolated Auth fixture (§26.9e) |
| Containment removal | Licensed ONLY after §26.9 (a)–(e) complete + negative suite kept by real mechanism (§26.9f) | gated implementation |

**In-report inconsistency to reconcile (recorded, not resolved):** R02 §7 calls DEC-02 "approved (§26/§28.5)" while the §9 legend labels the §26 design "unapproved." The §26 status line (later, dated, and self-referential to the approval event) reads as the governing statement; the legend likely describes the pre-approval snapshot. Reconciliation evidence: the R02 report itself plus the release records; a one-line legend correction would close it (not performed — historical artifact; authors may add an erratum if desired).

**Decision genuinely required:** none on policy. The only decision is whether to fund the already-approved work program now (implementation package) — that is scheduling, not policy. Runtime items are evidence-only and correspond to the runtime package infra, no app design.

---

# D-03 — Branch Authorization (DEC-03 exactly as recorded)

**1) Controls already in place (verified in code):**
- `public.can_access_branch(business_id, branch_id)` SECURITY DEFINER, server-side; rule set: {owner, admin, manager, accountant, auditor} org-wide; others by `business_users.branch_id`; **`NULL branch_id = explicit org-wide`** (comment codified).
- `business_users.branch_id` assignment column exists; R08 till context binds shifts to trusted branch ids (terminal-derived, never caller raw values); R08 records pass.
- All 63 tables RLS-enabled; role-tier helpers (`can_write_business_data`, etc.) server-side.

**2) Direct-write surfaces still lacking branch enforcement:** invoices & payments, expenses & payments, journal entries/lines, bank statements/lines, contacts, products, inventory (balances/movements), stock transfers, payroll lines/employees, accounts, assets/FX/fx, budgets, tax configs — branch predicates exist on NONE of these policies today (tenant-scope only); reporting views likewise tenant-scoped only. (Enumerated from phase8b RLS policy inventory.)

**3) Evidence gaps (BRANCH.* ×8):** `create, read, customers, financial, inventory, reports, modify, cross-branch-admin` — each corresponds to a testable property under whichever DEC-03 semantics is signed. These flip only after the decision + any required predicates.

**4) Actual implementation gaps:** conditional on DEC-03 — if "assigned-scope" roles are confirmed as the intended matrix *for the surfaces above*, the gap is: membership-with-branch predicates on the direct-write tables + view filtering + write checks in 0 existing RPCs beyond POS context. If "org-wide for all current roles" is confirmed, gaps reduce to audit/evidence records only. **Cannot be determined without the decision** (by design).

**5) Must branch remediation precede R09.3?** Analysis: R09.3 semantics (queue exception handling, replay/quarantine) operate at business-scope membership level and shift-actor provenance (R08/R09.2 — already verified server-side). Branch correctness of *replayed writes* is already bounded by each target path's own server enforcement (e.g., post_pos_sale binding is branch-stamped server-side). Therefore **branch remediation is NOT a hard prerequisite** for R09.3; the risk is only that R09.3 statements must not *claim* branch-level completeness while DEC-03 is open. (See §18 carve-out.)

**6) Do queue records need branch binding first?** Queue payloads already carry business_id; branch-sensitive writes (POS) carry terminal/shift-derived branch stamps server-side. Binding every queue record to a branch *identity* is only meaningful after DEC-03 decides assignment semantics → **follows the decision, does not precede it.**

---

# D-04 — Receipt Dispatch (classification, not implementation)

| Layer | Where it sits today | Requirement class |
|---|---|---|
| Recording the financial transaction | server-authoritative (post_pos_sale binding) | **security (financial integrity)** — complete |
| Generating a receipt | POS client renders from the recorded transaction payload; invoices have server artifacts (send-invoice path) | **product** (with security touchpoint: any authority-bearing artifact should derive from server state, not client memory) |
| Delivering a receipt | invoice dispatch exists (send-invoice + invoice_delivery_events); **POS receipt delivery does not exist** | **product + operational** |
| Proving delivery | delivery events for invoices only | **product/compliance** |

**Conclusion:** R07.RECEIPT.DISPATCH is **primarily a product/operational requirement with a security touchpoint** (authority of the receipt artifact's data source). It is *not* a release-blocking security hole on its own: the recorded transaction is authoritative and auditable regardless of dispatch. The open item is the product decision (server-generated receipt artifact vs client-rendered view) + evidence for delivery/dedupe if delivery is chosen. **Does not block R09.3** (queue records preserve the receipt payload + provenance either way).

---

# D-05 — Server-Side Quota Authority (invoice/payroll)

Context (verified): `_ledgr_assert_usage_limit` counts **invoices + expenses + payroll runs and is enforced server-side on 3 paths** (post_pos_sale, save_quick_expense, save_quick_sale). The invoice-builder and payroll posting flows have **client look-ahead only (typed since R10)**, no server assert in their posting path.

| Option | Effect | Consequences |
|---|---|---|
| A — Extend contract to invoice + payroll posting | Same P0QLT SQLSTATE, one meter, all surfaces authoritative | closes the look-ahead-only asymmetry; requires additive migration to the two posting surfaces + evidence records; zero semantic ambiguity |
| B — Exclude invoice/payroll from metering | unlimited on those surfaces while counted | **semantic contradiction** (usage count includes them, enforcement doesn't); weakens "server-authoritative billing authority" posture; likely regression risk if subscription tier-limit positioning matters |
| C — Separate future decision | asymmetry persists, documented | cheapest now; carries the finding forward; cannot be called "fully server-enforced" until decided |

**Not selected.** Analysis note: A is the only option that makes the meter *coherent* with the count rule; B requires re-deciding the count rule too; C is honest deferral.

---

# 5. Non-POS Financial Authority Gate (A/B/C per GAP)

Legend — A: authoritative server command/RPC. B: direct table mutation + RLS + constraints/triggers. C: existing mechanism sufficient, evidence-only.

| GAP | Mutation | Current authority | Security property missing | A/B/C viability | Evidence needed | Implementation needed | Blocks release? |
|---|---|---|---|---|---|---|---|
| GAP-1 invoice lifecycle | create/edit/delete/cancel/pay/credit/tax | B (RLS + payment guards + amount_due trigger) | posted-state immutability; delete-vs-paid guard; post-payment field invariance; audit-on-mutation | **B viable for all of it** if explicit guards (status-transition CHECKs/triggers + audit-on-attempt) are added; A not required for correctness; C insufficient for the immutability class | transition-state contracts; negative mutability records; audit-capture records | guards/triggers (A unnecessary) | YES (financial statement trust) |
| GAP-2 journal edit/delete | edit posted entries; delete entries | B (membership-level RLS; no immutability trigger found in the migration chain) | **posted immutability, period-lock enforcement, destructive-action audit** | **A for delete-or-amend-on-posted** (reversal-only posture enforced server-side) or B with hard immutability trigger + reversal RPC for legitimate changes; C insufficient — R05 covers posting-path correctness, not modification path | immutability negatives; period-lock records; reversal-round-trip evidence | immutability trigger + (reversal already exists client-side in JournalRepository → recommend server command but A/B both defensible) | YES (ledger integrity) |
| GAP-3 payroll | run create/calc/post/corrections/deletion | B for create/RLS (`can_write_payroll`); posting builds journal via client-side `journalRepo.createBalancedEntry` + direct `update` status flows | **amount-authority**: journal amounts for payroll are computed in TypeScript, not re-derived server-side; correction path unproven | **A for posting** (server command re-deriving lines from payroll rows, keyed idempotency) — posting is the money-mover; B acceptable for drafts/edits w/ audit | server re-derivation equivalence records; correction/reversal records | payroll posting RPC (if A) | YES (payroll = financial+taxy correctness) |
| GAP-4 banking | import/lines/match-accept/recon | B + `bank_line_locked_guard` trigger (update/delete protection — R05 evidence PASS) | import idempotency (duplicate statements), reconciliation-completion authority; **match-accept itself does not move money** (links lines to journal_lines only — verified in BankReconciliation.tsx + lines trigger update guard) | **B viable**: add unique dedupe on (statement, line identity) + completion-state machine; A unnecessary for correctness of accepted matches; C insufficient for duplicate-import | duplicate-import negatives; completion-transition records; accepted-match immutability (already guarded ✓) | dedupe constraint + completion workflow records | MEDIUM (integrity not confidentiality; duplicates pollute reports) |
| GAP-5 fixed assets / FX | acquisition/depreciation/disposal; revaluation runs | B; services compute amounts client-side (`CapitalJournalService`, `FxRevaluationService`) then post journals through the client journal path | computation authority (server never re-derives); repeat-execution idempotency (revaluation re-run) | **A viable for run/commit steps** (server re-derives + keyed idempotency); B acceptable if computation is re-verified against stored inputs + unique run keys; C insufficient for repeat-exec | idempotency records (double-run rejection); re-derivation equivalence | run/commit command surface (or B-level keying) | MEDIUM (periodic, audited flows; less interactive attack surface) |
| GAP-6 transfers/adjustments | create/dispatch/receive/delete + manual adjustments | **B with authoritative invariant already on the path** — `trg_stock_movement_apply_balance` → `_ledgr_apply_stock_movement_balance()` for EVERY `stock_movements` row (verified), + non-negative constraint; **cost authority missing** (caller-supplied `unit_cost` feeds weighted-average), **idempotency missing** (dispatch/receive are two-step client flows; no dedupe constraint on movements; retry between steps duplicates movements), **atomicity** (status update and movements are separate client statements) | cost integrity + exactly-once dispatch/receive | **B+ viable**: (1) dedupe constraint keyed on (source_type, source_id, product_id, movement_type) for transfer-generated movements; (2) server-side cost ref check in trigger (cost from product/valuation source of truth, not caller); alternatively **A** = dispatch/receive command RPC like POS commands (consistent with R07 surface); C insufficient for both missing properties | duplicate-dispatch negatives; cost-source-of-truth records; branch-transfer semantics after DEC-03 | dedupe constraint + cost authority (or command RPC) | YES (inventory valuation trust + R09.3 reconciliation claims) |
| GAP-7 tax config | PAYE bands/tax configurations update/delete | B (RLS writer-tier) | audit trail (who/when changed tax rules), effective-dating semantics, history preservation for backdated calc | **C viable as evidence-only if audit triggers exist — none found** → B with `audit-on-config-change` trigger + (optionally immutable history table) suffices; A (approval flow) optional policy choice | config-change audit records; effective-date semantics doc | audit trigger (small); approval flow only if product wants it | MEDIUM (compliance) |

---

# 6. GAP-1 — Invoice Lifecycle (detail)

Current protection inventory (verified): `invoice_payments_status_guard` trigger blocks payments on cancelled documents (R05 evidence ✓); `trg_invoices_sync_amount_due` maintains amount_due; payments go through `increment_amount_paid` keyed RPC (exactly-once append) ✓; `enforce_invoice_payment_allowed`; tenant RLS ✓; quick-sale server path covers the narrow plain-sale case ✓.

Open against the mandate's threat list:

| Threat | Protection today | Verdict |
|---|---|---|
| editing posted financial data | RLS only (no status-based mutation guard) | **open** — needs transition-state guard (B) |
| deleting paid invoices | RLS only; payments guard only blocks NEW payments | **open** — delete needs its own guard |
| changing tax after posting | none | **open** |
| changing customer after payment | none | **open** |
| replay/duplicate payments | `increment_amount_paid` idempotent ✓ (R05 evidence) | covered in-plane |
| cross-tenant mutation | R01/TENANT matrix ✓ | covered |
| cross-branch mutation | none (DEC-03-open) | open — decision-bound |
| audit of attempted/destructive actions | `log_manual_audit_event` exists but is invoked only from a few RPCs; invoice edits/deletes do NOT write audit rows (no trigger) | **open** — audit-on-mutation trigger |

Credit notes exist as a status concept in client code (`void`/`credit_note` states referenced in InvoiceRepository) — lifecycle rules are client-enforced only.

# 7. GAP-2 — Journal Edit/Delete (detail)

- `_ledgr_post_entry` is the **keyed, balanced-line posting RPC used by server-controlled flows** (quick-save family); it enforces ≥2 lines and shape (verified).
- `JournalRepository` additionally does **direct `journal_entries/lines` insert/update/delete** from the client for the general journals UI (draft→post via a single conditional UPDATE; reversal generation client-side). No migration-chain trigger enforces posted immutability or period-lock on table mutation.
- R05 evidence covers: journal number uniqueness, posting-key uniqueness, noneg lines, number reservation — i.e., **posting-path integrity, not modification-path integrity**.
- Audit: `log_manual_audit_event` RPC exists; JournalRepository calls it on some flows (verified import), but there is no trigger-guaranteed audit on direct edits/deletes.
- Conclusion is in the §5 gate: **RLS authorization ≠ accounting correctness for posted-entry mutation.** Reversal (not deletion) is the accounting-correct amendment; whether to hard-immute posts (B) or command-only amendments (A) is the decision.

# 8. GAP-3 — Payroll (detail)

Verified path: `PayrollRepository.approve()` computes payroll journal **lines in TypeScript** and posts via `journalRepo.createBalancedEntry` + `journalRepo.post` (direct writes); run status updates are direct updates; `can_write_payroll` RLS helper exists; R01 matrix rows cover payroll role membership tampering only.

**Financially authoritative? No — access-controlled but not amount-authoritative.** Salary → PAYE → net amounts are computed client-side with tax tables read at calculation time; the server never re-derives. Corrections/reversals/deletion have no dedicated evidence anywhere in the 733-record universe. Employees/allowances/deductions CRUD is RLS-only. Quota: runs count toward usage but no server assert posts them (D-05).

# 9. GAP-4 — Banking/Reconciliation (detail)

Verified: `bank_statement_lines` has `prevent_locked_bank_line_change` trigger (locked after reconciliation) — R05.FINANCE.BANK-LINE-LOCK PASS. Match accept **links** imported lines to journal_lines (client-built), no journal creation, no balance mutation at accept time. Statement import inserts rows directly; no dedupe. Bank account balances elsewhere derive from journals (accounts table). **Verdict held in §5:** authority posture is *nearly* sufficient thanks to the lock trigger; the sincere gaps are import idempotency + completion authority, both addressable inside Model B.

# 10. GAP-5 — Fixed Assets / FX (detail)

Both domains use ledger services that compute tax/fx/depreciation amounts in TypeScript and post journals through the shared client journal path, with direct inserts into `fixed_assets`, `depreciation_schedules`, `fx_revaluations`, `exchange_rates`. No server re-derivation; no run-key idempotency for revaluation/disposal/depreciation batch jobs. Constraints exist at the journal-posting level only. Decision recorded in §5 gate (A for run/commit steps vs strong B keying).

# 11. GAP-6 — Stock Transfers / Adjustments (complete writer-path map)

**Writer-path map (verified from code):**

1. `TransferRepository.dispatch` → direct INSERT into `stock_movements` (quantity<0, `transfer_out`, **client-supplied `unit_cost`**) → **`trg_stock_movement_apply_balance` fires** → `_ledgr_apply_stock_movement_balance()` → updates `inventory_balances` (+ WAC when unit_cost>0) → non-negative constraint applies → separate client statement updates `stock_transfers.status='dispatched'`.
2. `confirmReceipt` → direct INSERT `transfer_in` movements (client `unit_cost`) → same trigger/balance path → separate status update.
3. `InventoryRepository.recordMovement` (manual adjustments) → stock_movements (client-keyed pattern from POS work for some paths) → same trigger.
4. `stock_transfers`/`stock_transfer_lines` direct upsert/delete — header/line mutation without movement backfill; deleting a dispatched transfer does NOT reverse movements (verified: no compensation logic in repository, no trigger).
5. POS/sale/post/quick-save families → server-side movements (part of atomic RPC) → same trigger (authoritative cost from server-resolved product data).

**Critical question answered:** quantity-wise, **every path passes through the same invariant/cost propagation trigger** — the R06 non-negative invariant itself is NOT bypassable by writers reaching `stock_movements`. The genuine implementation gaps are: (a) **caller-controlled `unit_cost`** on transfer/adjustment writes reaches the weighted-average-cost computation; (b) **no idempotency** — a retry between the movement insert and the status update double-dispatches (no dedupe constraint exists on stock_movements for transfer sources); (c) **no atomicity** of status↔movement; (d) **delete-without-compensation** for dispatched transfers; (e) **stale code comment** naming a non-existent `update_inventory_balance()` trigger in TransferRepository (documentation fix, not behavior).

**R09.3 interaction:** R09.3 CAN claim stock-reconciliation coverage for *POS/sale/quick-save/recordMovement paths* (R06-tested), but MUST NOT claim coverage of transfer dispatch/receive double-replay or cost-authority until (a)–(d) are closed. Recorded as a scope carve-out, not a hard stop.

# 12. GAP-7 — Tax Configuration (detail)

Writers: direct upserts/deletes on `paye_bands`, `tax_configurations` (+ `tax_alerts insert`). No audit trigger found; no effective-date immutability; payroll calc reads current config at calculation time (backdated effects possible if configured dates allow); no approval mechanism; R01 matrix covers role membership only. Decision: audit-trigger (B) is the minimal sound floor; approval flow/effective-dating are product-policy options (not chosen).

# 13. Storage Decision Gate

| Bucket | Public? | Content | Write policy | Read policy | Delete | Signed URLs | Status |
|---|---|---|---|---|---|---|---|
| `business-logos` | **YES (public URLs)** | branding logos only (path `{business.id}/logo-*`, from SettingsPage convention; no other writers found in src) | authenticated, scoped to caller's own business via path-prefix policy | public (bucket-level) regardless of RLS | owner-scoped policies (update/delete exist) | n/a (public URLs) | **public by design — NOT classed a vulnerability**; content class matches purpose; residual: file size/mime limits NULL (unknown legacy), policy shape flagged `[INFERRED]` in migration (verified in replay, not independently observed live) |
| `user-exports` | private | full-tenant data export ZIPs (`{userId}/...`) | **deny-all to client roles** (no anon/authenticated policies) | deny-all | deny-all | service-role 1-hour signed URLs (self-authorizing boundary) | **strongest posture in app**; residual: signed-URL forwarding/lifetime behavior evidence at runtime |

Separately per mandate: confidential business documents live exclusively in `user-exports` (self-export channel); nothing routes financial artifacts into `business-logos`. The `TENANT.*.storage` BLOCKED records thus concern **runtime negative proofs** (can tenant B read/tamper tenant A objects), which current policy analysis predicts will PASS for user-exports and PASS for logos-write (read is public by design) — **evidence-only package**, no design change implied; do not presume the answer.

# 14. Auth / Runtime Evidence Gate (classification)

| Set | Records | Nature | Testable under R09.4 browser env without app change? |
|---|---|---|---|
| AUTH.* ×4 (valid/invalid login, logout revocation, expired session) | 4 | **evidence-only** — UI/provider behavior against the real auth stack | YES (fixture accounts) |
| R02.PROVIDER-TOKEN ×9 (missing/malformed/invalid/expired/consumed/replay/substituted/identity-changed/valid-own) | 9 | **evidence-only** but **provider-semantics-dependent** — the GoTrue token behaviors in the deployed environment | YES, provided the fixture reproduces the provider token surface (R22-class isolated auth fixture per R02 §26.9e — that fixture is *test infra build*, not app change) |
| R02.OTP ×3 (future-valid/substituted-target/wrong) | 3 | **evidence-only contingent** — meaningful only when OTP possession flow exists (D-02a work program); today they document the approved contract target | NO — wait for D-02a implementation OR record as design-review checks against the contract (contract-conformance tests) |
| PRIV.* ×4 (invitation/membership/profile/recovery privileged mutation) | 4 | **evidence-only** — privileged manipulation attempts at runtime | YES (fixture users) |

Summary: **all four sets are evidence-class**, none are design/policy blockers — DEC-02's policy content is already approved. The infra build (isolated Auth fixture + browser runner) is the only "work," and it belongs to the evidence package, not application implementation.

# 15. Edge / Webhook Decision (two FAILs, exact properties)

| Record | Failing property (verified from evidence rows) | Implementation or evidence? | Blocks R09.3? | Blocks release? |
|---|---|---|---|---|
| `EDGE.RETRY.no-secret` | retry-failed-webhooks **accepts invocation without the job secret** (observed HTTP 200 where contract says 401 when job config absent & empty secret header supplied) — control: job-secret enforcement on ops-trigger edge | **implementation** (add secret requirement + fail-closed in the function; then re-evidence) | NO (independent surface) | **YES** (CI red; privileged retry execution callable) |
| `EDGE.WEBHOOK.viewer` | webhook-dispatcher **authorizes a viewer to enqueue authoritative arbitrary financial-event payloads** (observed 200 vs expected 403) — control: role/authority gate before event emission | **implementation** (role gate aligned to writer/emitter tiers; then re-evidence) | NO | **YES** (privilege escalation into financial event stream) |

**Common control?** Not mechanically: one is a missing *secret* requirement on a server-only job edge; the other a missing *role* requirement on an event-emitting edge. They share only the anti-pattern class "trusted-by-default caller" across ops edges — worth one combined review pass of Edge privilege defaults, but two distinct fixes. Neither blocks R09.3; both independently block final release through the hard gate.

# 16. AI / Branch / R11

- `DEC-03 → branch enforcement → AI.BRANCH`: AI.BRANCH's runtime proof depends on what DEC-03 decides "branch scope" means for an AI caller. **Sequentially dependent.**
- `R03 → R11`: R03 (containment/authorization context) is complete ✓. R11 = permission-aware AI + **metric consistency** (AI-summarized numbers vs authoritative reports). Its core does not depend on branch semantics: metric consistency binds AI answers to the same server data sources any member sees at tenant scope. Bonused branch-aware variants follow DEC-03. **Verdict: R11 can proceed independently of branch remediation** (with a one-line carve-out for branch-scoped AI cases).

# 17. CI Gate Semantics (models; decision required, not selected)

Current: FAIL→nonzero **and** BLOCKED→nonzero; no continue-on-error; 2 FAIL + 53 BLOCKED ⇒ **gate permanently RED today**.

| Model | Meaning | Consequence |
|---|---|---|
| A — everything PASS | gate stays red until all 55 items are genuinely proven | maximal rigor; couples release to R14/deferred infra; long red period |
| B — signed expected-state | FAIL=0 mandatory; BLOCKED allowed only if individually signed with expiry/review date | honest residual-risk ledger; needs a sanctioned registry mechanism + periodic re-attestation |
| C — two-tier gate | mandatory controls (FAIL + security-relevant BLOCKED) = hard gate; evidence/deferred = informational lane with drift alarms | fast signal; risk of the informational lane silently rotting without B's sign-off discipline |

**Decision required:** gate terminal semantics for release closure; choice interacts with how many BLOCKEDs are genuinely remediable in this release window (see §18–19).

# 18. R09.3 Dependency Test (minimum safe prerequisite set)

| Item | Must precede R09.3? | Parallel? | Can follow? | Reason |
|---|:--:|:--:|:--:|---|
| P-D3-FINAL (D-01) | **YES** | — | — | It *is* R09.3's behavior contract |
| D-4 rider | (records after impl) | YES | YES | rider = run records once prerequisites land; no blocking content (verified R09.3 §6: no R08 edit) |
| DEC-02 | NO | YES | YES | containment already live; orthogonal surface |
| DEC-03 | NO | YES | YES (with carve-out) | R09.3 claims must not include branch-level completeness (§D-03.6) |
| R12 | NO | YES | YES (before release) | independent ops-edge surfaces |
| Branch package | NO | YES | YES | follows DEC-03 |
| Storage package | NO | YES | YES | independent; evidence-only posture likely |
| GAP-1 (invoice lifecycle) | NO | YES | YES | R09.3 must not claim invoice-builder posted-mutation guarantees |
| GAP-2 (journals) | NO | YES | YES | ledger immutability is orthogonal to queue semantics |
| GAP-3 (payroll) | NO | YES | YES | payroll not queue-backed |
| GAP-4 (banking) | NO | YES | YES | bank recon not queue-backed |
| GAP-5 (assets/FX) | NO | YES | YES | periodic jobs; not queue-backed |
| GAP-6 (transfers) | NO (with carve-out) | YES | YES (before stock-reconciliation claims) | R09.3 may claim reconciled POS/scripts paths only (§11) |
| GAP-7 (tax config) | NO | YES | YES | replay uses historical calcs; audit trail is separate |
| R09.4 (runtime evidence) | NO for harness records | YES | R09.3's own runtime/browser proofs follow | harness-level records cover logic; browser proofs = evidence lane |
| R11 | NO | YES | YES | separate AI surface |
| R14 | NO | YES | YES | ops/restore independent |
| R15 | NO | — | YES | reconciliation/pilot last |

**Minimum safe prerequisite set to enter R09.3:** `{ P-D3-FINAL signed; written acceptance of the carve-outs: no branch-scope claims (DEC-03 open), stock-reconciliation claims limited to R06/R08 paths (GAP-6 open), no claims about invoice/payroll quota symmetry (D-05 open) }`. **Zero implementation prerequisites.**

# 19. Architecture Package Map (independent packages; no R-numbers assigned)

### PACKAGE P-WEBHOOK (the two FAILs)
- Purpose: close `EDGE.RETRY.no-secret` + `EDGE.WEBHOOK.viewer`.
- Surfaces: retry-failed-webhooks, webhook-dispatcher; ops-edge privilege-default review pass (adjacent, evidence-level).
- Prereq decisions: none (expected behavior already asserted by existing release records).
- Implementation: YES (secret enforcement; role gate). Browser/runtime: handler-level replay in R13 lanes (existing infra). Records required: flip the two records to PASS via real behavior; regression suites: EDGE lane + full harness ×2.
- Closure: 678/0/53 → 680/0/53 with both records proving the controls; gate loses its red signal for R12.

### PACKAGE P-DEC (decisions only)
- Purpose: sign D-01 (P-D3-FINAL), confirm/re-place D-04 product call, D-05 option, D-06 gate model, D-07 per-GAP model, DEC-03 confirm-or-replace, receipt-dispatch classification.
- Prereq: none. Implementation: none. Closure: decision records committed (docs/release records).

### PACKAGE P-R9.3 (queue reconciliation)
- Purpose: implement signed P-D3-FINAL + D-4 rider records. Surfaces: sync engine exception states, quarantine reasons, UI surfacing (quota-aware routing via R10 `lastErrorCode`).
- Prereq: P-DEC (D-01). Implementation: YES. Evidence: new R13 records + rider records. Closure: exception lifecycle fully evidenced in harness.

### PACKAGE P-RUNTIME (R09.4-class evidence)
- Purpose: satisfy all evidence-only blockers without app change: AUTH ×4, PRIV ×4, R02 provider-token ×9 (isolated Auth fixture), OFFLINE ×6 (browser), BRANCH ×8 (after DEC-03 semantics exist to test against), TENANT.storage ×2, receipt-dispatch runtime when product decision exists.
- Prereq: isolated auth fixture + browser runner infra (test-infra build); DEC-03 semantics for BRANCH subset. Implementation (app): **none planned**; any app defect found becomes its own fix window. Closure: subset flips with real evidence; remainder reclassified to future-scope with rationale.

### PACKAGE P-FIN-AUTH (non-POS financial authority, D-07-dependent)
- Sub-packages keyed to decisions: FIN-INV (GAP-1 guards), FIN-JRN (GAP-2 immutability/reversal posture), FIN-PAY (GAP-3 posting command or B-floor), FIN-BANK (GAP-4 dedupe/completion), FIN-AF (GAP-5 run/commit keying or A), FIN-TRF (GAP-6 dedupe+cost authority or command RPC), FIN-TAX (GAP-7 audit trigger).
- Prereq: P-DEC (D-07 picks). Implementation: YES per pick (mostly small trigger/constraint bodies; only FIN-PAY/FIN-TRF could be RPC-class). Records: R05-class negatives + invariants per sub-package. Closure: every listed mutation has a named authority model + evidence.

### PACKAGE P-BRANCH & P-STORAGE-EVIDENCE (branch predicates per DEC-03; storage negatives (+optional limit config))
### PACKAGE P-AI-R11 (metric consistency; carve-out branch-scoped cases)
### PACKAGE P-CI-CLOSURE (gate model per D-06 + all red drivers resolved)
### PACKAGE P-R14 (restore/jobs/observability T21–T23)
### PACKAGE P-R15-LEGACY (reconciliation/pilot; migrate-or-retire 12 LEGACY packs)

# 20. Final Decision Pack

## DECISIONS REQUIRED NOW (human/owner sign-off; none selected here)

1. **D-01 / P-D3-FINAL** — offline stock-reconciliation model {1 | 3 | 4 | 1+3 | 3+4} + explicit P0QLT routing in exception states. Why: it defines R09.3's behavior. Dependencies: none. Evidence-only remainder: rider records after impl.
2. **DEC-03** — confirm `can_access_branch` matrix semantics as authoritative (org-wide incl. NULL; assigned-scope by row), or replace; and whether multi-branch assignment is in scope now. Why: BRANCH.* ×8 + every report/direct-write surface. Dependencies: R04 helpers (exist). Evidence-only remainder: BRANCH.* runtime proofs once semantics exist.
3. **D-05** — invoice/payroll quota: A unify / B exclude / C defer. Why: meter semantics + server-authority posture. Dependencies: R10 contract (done).
4. **D-06** — CI gate terminal model A/B/C. Why: closure mechanics. Dependencies: none. Evidence-only remainder: whichever residual records exist under B/C need sign-offs.
5. **D-07** — per-GAP architectural direction (A/B/C) for GAP-1..7. Why: determines implementation body + authority posture for all non-POS money movements. Dependencies: §5 analysis (done). Evidence-only remainder: none — these are implementation-package gates.
6. **D-04 classification** — receipt dispatch as product call (client-rendered view accepted vs server-generated artifact + delivery). Why: unblocks/closure scope of R07.RECEIPT.DISPATCH. Dependencies: none.
7. **Storage acceptance** — confirm `business-logos` public-read as accepted design + close limit/mime config question (set limits vs accept NULL). Why: closes storage domain. Dependencies: none. Evidence-only remainder: TENANT.*.storage runtime negatives (P-RUNTIME).
8. **DEC-02 scheduling** — fund approved work program (§26.9 a–f) or leave containment in force; additionally authorize the isolated Auth fixture (test infra). Why: recovery is identity-critical; containment is interim by design. Dependencies: none. Note: no policy re-decision needed unless contract is re-opened.

## SAFE NEXT AUTHORIZATION

**PACKAGE P-WEBHOOK (R12 remediation)** — the single package authorizable today without making any unresolved policy decision on behalf of the project:

- Both failing properties are already *defined* by existing release expectations (401 on absent secret; 403 for viewer emitter) — implementing them asserts no new policy.
- It cannot conflict with P-D3-FINAL, DEC-02, DEC-03, D-05, D-01, storage, branch, or quota decisions (independent ops edges).
- It is small, server-side, and directly measurably closes the gate's only FAIL class.
- Expected effect: 678→680 PASS, FAIL→0, harness exits fail-free except the (redesign-decided D-06) BLOCKED class.

Secondary, also-decision-free-but-larger candidates (do not authorize simultaneously): the test-infra portion of P-RUNTIME (isolated Auth fixture + browser runner) — decision-free because it builds evidence machinery only, though it is wider and slower.

# 21. Report Integrity

- Only repository change in this phase: this file. No code, migration, RLS, RPC, Edge, storage policy, offline, POS, quota, or CI touch. No finding fixed, closed, downgraded, re-scored, or re-marked. No historical audit edited.
- The §D-02 approval-state wording tension, the stale `update_inventory_balance()` code comment (documentation only), and the `[INFERRED]`-flagged storage policy shape were **documented, not repaired**.

---

**FINAL STATE: REQUIRES DECISION (8 decision items at §20) — stop here.**
