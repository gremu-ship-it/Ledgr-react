# LEDGR — R08 Till Context & Shift Reporting: IMPLEMENTATION Report

**Date:** 2026-09-21
**Package:** R08 — Establish trustworthy till context and shift reporting (High; frontend + backend; deps R04/R06–R07/DEC-08/DEC-03)
**Predecessors:** `LEDGR_R08_PRE_IMPLEMENTATION_DISCOVERY_2026-09-21.md` (approved); R01–R07 closed (baseline **630/2/51 @683**)
**Status line:** **R08.1 COMPLETE (sign-offs) · R08.2 COMPLETE (migration + authoritative shift/cash commands) · R08.3 COMPLETE (guarded `post_pos_sale` shift/branch association) · R08.4 COMPLETE (tender-derived reporting) · R08.5 COMPLETE (client rewire + F15 + HISTORY records). R08.6–R08.7 NOT STARTED.** Awaiting review authorization for R08.6.

---

## R08.2 — MIGRATION + AUTHORITATIVE SHIFT/CASH COMMANDS (COMPLETE)

### Exact files changed (this sub-package)
- **NEW** `supabase/migrations/20260930000000_r08_till_context.sql` (only migration).
- `tests/release/fixtures.ts` — additive only: one seeded terminal per org (`orgs.*.terminal`); no existing seed row touched.
- **NEW** `tests/release/r08-shifts.test.ts` — 10 R08.2 records.
- `tests/release/gate.mjs` — suite map entry `r08-shifts.test.ts → r08-shifts.json` (HARNESS.DISCOVERY stays green).

### Exact database objects added
Tables: `pos_terminals` · `pos_shift_closes` (+ `pos_z_report_seq`) · `pos_shift_late_adjustments`.
Columns: `pos_shifts.terminal_id`, `pos_shifts.open_command_key`, `pos_cash_movements.command_key`, `invoices.pos_shift_id` (all nullable; **zero backfill of historical rows**).
Indexes (partial, legacy-exempt where noted): `pos_shifts_one_open_per_terminal(business,terminal) where open and terminal is not null` · `pos_shifts_one_open_per_cashier(business,cashier) where open and terminal is not null` · `pos_shifts_open_command_key_uq` · `pos_cash_movements_command_key_uq` · uniques on closes `(business,shift_id)` + `(business,command_key)`; adjustments `(business,command_key)`.
Functions: `can_access_branch(business,branch)` (DEC-03) · `_ledgr_pos_actor_name` · `open_pos_shift_command(jsonb)` · `close_pos_shift_command(jsonb)` · `record_pos_cash_movement_command(jsonb)` · guard trigger `guard_pos_shift_link` on invoices (pos_shift_id immutable after insert).
Grants/policies: EXECUTE→authenticated on the three commands + `can_access_branch`; **REVOKE insert/update/delete** from authenticated on `pos_shifts` + `pos_cash_movements` (loud 42501, not silent no-op); select re-scoped to member ∧ branch (DEC-03) incl. `pos_shift_closes`/`pos_shift_late_adjustments` select-only; terminals admin-managed.

### Authorization boundary, before → after
- Shift open/close/movement: raw DML under tier-RLS with caller-supplied exact rows (any staff could rewrite anyone's signed close) → **three definer commands**; server resolves identity (`auth.uid()`), name (`user_profiles`), branch (terminal row), branch scope (`can_access_branch`); bypass INSERT/UPDATE denied loudly (proven `R08.SHIFT.BYPASS-CLOSED`).
- Duplicate opens: nothing → DB partial uniques per terminal AND per cashier (legacy terminal-less rows exempt, additive-safe).
- Close: browser read-modify-write + re-closable (silently rewrote the signed close) → row-locked single transition + **immutable `pos_shift_closes` snapshot**; re-close under a fresh key `22023`; replay of the original key idempotent (same `report_number`).
- Money on the close: client-side counters → **derived from `invoice_payments` tenders per payment method**, refunds derived from R07 `pos_corrections` bounded by each document's cash tender share (R07 bodies untouched), movements from movement rows.
- Movements: INSERT + separate RMW UPDATE (lost updates) → locked-shift atomic row+totals transition; exactly-once by command key; `cash_in|cash_out|petty_cash|safe_deposit`, amount>0, reason required.
- Report numbering: `Date.now()` → persistent global sequence `pos_z_report_seq` formatted `Z-YYYY-<n>`.

### Test results (R08.2 family, 10/10 PASS)
`R08.SHIFT.SINGLE-OPEN` (per-terminal & per-cashier denied 22023, replay idempotent, server-resolved identity/branch/name) · `CLOSE-ATOMIC` (derived expected 50000+5000−2000=53000 exactly; row transition once; snapshot persisted; `Z-\d{4}-\d+` number) · `CLOSE-IDEMPOTENT` (same-key replay returns same report_number; exactly one closes row) · `CLOSE-IMMUTABLE` (fresh-key re-close 22023 *"Shift is already closed; the signed close is immutable."*; snapshot md5 byte-stable; raw UPDATEs denied 42501) · `LATE-ARRIVAL` (post-close movement denied; adjustment table not app-writable; R08.3 binds sale arrivals to it) · `CROSS-CASHIER-DENIED` (non-manager other-user close/movement 42501; manager-tier close allowed as documented channel; foreign-org → unknown shift) · `MOVEMENT.ATOMIC-PAIR` (row+totals atomic; malformed ⇒ zero mutation; replay idempotent; expected 20000+3000=23000) · `BYPASS-CLOSED` (raw INSERT/UPDATE on shifts + raw INSERT on movements → 42501 even as owner) · `BRANCH-SCOPED-READ` (assigned branch manager sees only own-branch shifts; admin org-wide; DEC-03 at query level) · `DATA-UNCHANGED` (closes=0, adjustments=0, shifts=2, terminals=2, no pos_shift_id links, contacts=2, business_users=14).

### Concurrency evidence & limitation (per mandate §18)
Single-open uniqueness proven deterministically via same-tx second-open denial (index enforcement; a racing insert sees the open unique violation) and the close's `FOR UPDATE` row lock proven by sequential re-close denial. The R13 harness executes probes on one fixture connection at a time; a second-connection `Promise.all` race is **not claimed** — marked as harness limitation; index + row-lock design covers the mechanism (documented, not asserted).

### Regression evidence (R05–R07 preservation at R08.2)
Full release protocol twice: **640 PASS / 2 FAIL / 51 BLOCKED @693** both runs; deterministic repeat **0 diffs** across all outcomes; FAIL set is exactly the two R12-owned records, unchanged ids. Delta vs R07-final (630/2/51 @683): **+10 records, all R08.*, 0 changed, 0 removed** (ids + statuses verified; PASS 630→640 exactly, BLOCKED 51→51 exactly). NOTE: the sandbox pruned `.cache/r13` between sessions (including the historical v6XitO/R07-final artifact dirs) — baseline was re-established with two 0-diff runs this sub-package, and the exact 630→640 id-set arithmetic above. App unit suite: **666/666** unchanged (no app code touched).
R07 corrections still fully pass (`refund_pos_sale_command`/`void_pos_sale_command` untouched — byte-identical files); R06 anchors green (`_ledgr_stock_location` untouched); R05 probes green (balanced-journal assertions unchanged; close derivation reads, never posts).

### Migration/data effects
Replay-clean on the full migration chain (PG17 fixture). Additive-only; no existing row changed (incl. pre-R08 terminal-less fixture shifts); rollback/containment: drop the new migration's objects (no data dependence created for legacy rows); feature absence fails closed on missing functions (client-side binding lands in R08.5; no client currently calls the new commands).

### Failures/blockers during this sub-package (documented)
1. First-draft migration had (a) an undeclared `v_shift_id`, (b) a broken aggregate shape for tender derivation, (c) ambiguous unique-violation handling — fixed, all replay-verified.
2. `update pos_shifts` with NO update policy silently no-ops (0 rows) instead of denying → enforcement moved to GRANT-layer revoke (loud 42501); documented as the bypass-bypass hazard for any future "policy-only" tightening.
3. A suite probe forgot `set local role authenticated` after `reset role`, running a raw-DML probe as observer — corrected; debug harness file removed after use.

**STOP — R08.2 complete.** Awaiting review authorization for R08.3 (guarded `post_pos_sale` shift/branch association).

---

## R08.3 — GUARDED `post_pos_sale` SHIFT/BRANCH ASSOCIATION (COMPLETE)

### Migration
**`supabase/migrations/20260930000001_r08_post_pos_sale_binding.sql`** — additive `CREATE OR REPLACE FUNCTION public.post_pos_sale(jsonb)` superset (all statements of the June-23 body plus R08.3 context resolution); the original file remains byte-untouched and replay order (2026-09-23 → 2026-09-30-01) gives the binding authoritative. `_ledgr_complete_pos_sale` is not re-created and byte-identical. No app code touched.

### Context resolution (new server behavior, §1b/§1c of the function body)
1. **Terminal-authoritative:** when `terminal_id` is supplied — null-safe `(payload->>'')` UUID parse — the terminal must exist, belong to the business, and be active; violations ⇒ 22023. DEC-03 `can_access_branch` is enforced against the terminal's bound branch (⇒ 42501). A caller-declaimed branch conflicting with the terminal's branch ⇒ 22023 (*conflicts with the authorised terminal branch*). The invoice is stamped with the terminal's branch (`branch_id = v_branch_resolved`), never with caller-reachable leakage.
2. **Branch substitution blocked on the legacy path:** with no terminal claimed, any payload branch now passes the same DEC-03 gate (⇒ 42501).
3. **Shift binding:** a claimed `shift_id` must exist in the business (⇒ 22023), match the claimed terminal (⇒ 22023), sit in an accessible branch, and belong to the caller — **unless** the caller holds manager tier in that business (`owner`/`admin`/`manager`), which legitimately posts anchors for their cashiers (⇒ 42501 otherwise). With no shift claim and a terminal present, the server auto-binds the caller's own open shift on that terminal.
4. The invoice INSERT gains `pos_shift_id = v_shift` at creation; the R08.2 trigger blocks any post-insert re-bind (⇒ 22023/42501).
5. **DEC-08 binding (§9b):** a sale claiming a **closed** shift still commits; the signed close is never rewritten and drawer totals are not re-opened. Exactly one append-only row lands in `pos_shift_late_adjustments` (`command_key = client_key║':late'`, `on conflict do nothing` ⇒ replays add nothing) carrying `invoice_id` and the cash amount.

### Failure semantics (attack matrix, §17)
Foreign terminal, unknown terminal, deactivated terminal, conflicting branch, foreign/unknown shift, other-user open shift without manager tier, inaccessible branch (legacy path and terminal path) — all denied with 22023 / 42501 and **zero mutation** (whole-transaction rollback; verified in-suite).

### Release records (4 added — 10 → 14 R08 records)
`R08.SALE.SHIFT-LINK` (terminal payload, no caller claim ⇒ server binds caller's own open shift, stamps terminal branch, links `pos_shift_id` at insert, drawer exactly +1500, replay idempotent, re-bind UPDATE denied) · `R08.SALE.TERMINAL-SCOPE` (foreign till / branch conflict / deactivated till / unknown shift / other-user's shift ⇒ 22023/22023/22023/22023/42501, zero invoices mutated) · `R08.SALE.LATE-ARRIVAL-BOUND` (closed shift: sale commits, replay idempotent, exactly one adjustment row amount 1500 with `:late` key, close-snapshot md5 stable, drawer stays at close value, `pos_shift_id` = closed shift) · `R08.SALE.BRANCH-SUBSTITUTION` (assigned-scope caller denied 42501 stamping an inaccessible branch; same caller on own A2 till posts and binds own shift).

**Record refinement (same-arc precedent from R07):** `R08.SHIFT.LATE-ARRIVAL`'s expected-text stub wording ("sale-level arrival lands with R08.3") was tightened to reference `R08.SALE.LATE-ARRIVAL-BOUND` now providing the sale-level binding — status/PASS semantics unchanged; recorded here as a meta-text evolution, not a status change.

### Anchored-preservation protocol
R07 refund/void anchors (`POS.REFUND.*`, `POS.VOID.*`) post with a *different* user's shift claim and remain byte-stable because the manager-tier exemption in §1c covers exactly those anchor flows — evidence diff vs the R07-final baseline: **0 removed, 0 changed, +4 added (only the new R08.SALE.* ids)**.

### Evidence
- R08 suite: **14/14 PASS** (replay of the full migration chain with the new superset verified per run).
- Full release protocol, two consecutive runs (`ledgr-r13-YXajyw`, `ledgr-r13-9ECOjD`): **PASS 644 · FAIL 2 · BLOCKED 51** @ 697 records; cross-run diff **0**; vs R08.2 baseline (640/2/51 @693): **0 removed, 0 changed, +4 added**. FAIL ids remain exactly the two R12-owned: `EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer` — **gate deliberately remains NOT GREEN**.
- App unit suite: **666/666** tests across 77 files (no app code changed in R08.3).

### Learning recorded
A test-side trap, not a product change: reusing `saleFixture` on a *different* till keeps `shift_id` pointed at the seeded legacy shift, which is bound to another terminal — the server correctly answers 22023. The BRANCH-SUBSTITUTION record now drops the caller-side claim and lets §1c auto-bind, which is also the intended integration pattern for R08.5 UI.

**STOP — R08.3 complete.** Awaiting review authorization for R08.4 (tender-derived reporting per the sub-package table).

---

## R08.4 — TENDER-DERIVED REPORTING (COMPLETE)

### Migration
**`supabase/migrations/20260930000002_r08_tender_reporting.sql`** — additive only:
1. **`public.get_pos_shift_report(p_shift_id uuid) returns jsonb`** (`security definer, stable, search_path=public`, execute → `authenticated` only): the server-controlled read surface for a shift's position. Every reported number is **derived from authoritative rows** — per-method tenders and cash/other splits from `invoice_payments` joined through `invoices.pos_shift_id` (`status='paid'`, not deleted), the per-method `tender_breakdown` object, sales count, R07 refunds from `pos_corrections` bounded by the original cash portion (`least(amount, cash_portion)`), drawer movements from `pos_cash_movements`, and `expected_cash = opening + cash_tenders − refunds + in − out`. Caller-claimed payload values and the client-maintained `pos_shifts` counters travel only inside an explicitly-labelled `client_counters{…, authoritative:false}` object. Once closed, the payload gains a `close{…}` block carrying the immutable snapshot fields **plus `payload_hash = md5(payload::text)`** so clients can verify what they render is what was signed. Authority: anon ⇒ 42501; unknown shift ⇒ 22023; `can_access_branch` on the shift's branch ⇒ 42501 otherwise (org-wide roles incl. accountant/auditor pass; assigned-scope callers must match the branch). Read-only (`stable`); zero mutation on every path.
2. **`close_pos_shift_command` CREATE OR REPLACE** — byte-extracted from the R08.2 definition with exactly ONE string change: the legacy-shift message no longer promises an "R08.4 management path" (no such path is mandated; historical attribution stays with R15). Behavior for terminal-bound shifts is byte-equivalent; all anchored CLOSE-* records unchanged. The R08.2 file itself is byte-untouched; replay order makes the correction authoritative.

### Records (2 added — 14 → 16 R08 records)
`R08.ZREPORT.RECONCILES-TENDERS` (mandated id): open (5000) → cash sale 1500 + split-tender sale (card 1000 + airtel_money 500) posted with **garbage caller claims** (`cash_sales=9999`) → admin-tier R07 refund 700 → live report BEFORE close: cash 1500 / other 1500 / total 3000 / refund 700 / count 2 / expected 5800 / breakdown `{cash:1500,card:1000,airtel_money:500}`; claims appear ONLY in `client_counters.cash_sales_amount=11499` ⇒ never in derivation → close at 5800: variance 0, snapshot version of the same numbers, `Z-2026-N` → second close on a fresh till gets `N+1` (sequentiality) → report AFTER close: drift-free digest; `payload_hash` equals observer-side `md5(payload::text)` and stored breakdown matches exactly.
`R08.SHIFT.REPORT-AUTHORITY` (attack matrix §17): cashier reads own-branch report; org-wide read role (accountant) passes; assigned caller confined to another branch ⇒ 42501; foreign-org caller ⇒ 42501; unknown shift ⇒ 22023.

### Evidence
- R08 suite: **16/16 PASS** (full migration chain replayed per run — the new migration replays clean on top of every prior file).
- Full release protocol twice (`ledgr-r13-a8ylTB`, `ledgr-r13-zsX4lb`): **PASS 646 · FAIL 2 · BLOCKED 51** @ 699; cross-run diff **0**. The R08.3 baseline evidence dir was pruned by the sandbox between sessions; arithmetic vs the recorded R08.3 state (644/2/51): PASS +2 = exactly the two announced new records, FAIL and BLOCKED unchanged ⇒ no existing record changed status. FAIL ids remain exactly `EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer` (R12-owned); **gate deliberately remains NOT GREEN**.
- App unit suite: **666/666** (no app code touched in R08.4).
- R07 command surface byte-untouched: the refund in the new record is posted through the un-modified `refund_pos_sale_command`; the R07 seam remains derivation-only.

### Learnings recorded (test-side, no product change)
1. `_debug` harness note reaffirmed: fixture-level raw `select … from invoices` under `authenticated` is denied at the GRANT layer — probes must use RPC return values (the real records already did; only the throwaway harness tripped it).
2. `refund_pos_sale_command` returns `document_id`/`amount` (not `id`): one assertion corrected to the actual R07 return contract.

**STOP — R08.4 complete.** Awaiting review authorization for R08.5 (client rewire + F15 flags read-only + HISTORY records).

---

## R08.5 — CLIENT REWIRE + F15 + HISTORY RECORDS (COMPLETE)

**No database changes in this sub-package** (no new migration; the server contract is unchanged). All React/service surfaces now consume — and cannot bypass — the R08.2–R08.4 command/report authority.

### Client rewire (src/dal/repositories/PosRepository.ts)
- `openShift` → `open_pos_shift_command` (`{business_id, terminal_id, command_key, opening_cash}` **only**). Caller-supplied `cashier_id`/`cashier_name`/`branch_id` are intentionally **not forwarded** (server resolves auth.uid → user_profiles, till → branch). Till resolution: first active `pos_terminals` row; zero tills ⇒ honest thrown error, NO fallback write (fail-closed). Generated row types predate `pos_terminals` ⇒ queried through an explicitly-commented untyped handle (`{ id }` contract only).
- `closeShift` → `close_pos_shift_command` (`{shift_id, command_key, closing_cash, variance_reason}`); re-reads the server-signed row. No client-side expected-cash arithmetic remains on this path.
- `recordCashMovement` → `record_pos_cash_movement_command` (`{shift_id, command_key, movement_type, amount, reason}`); `'safe_drop'` aliased to canonical `'safe_deposit'`; the client-side `updateShiftTotals` side-effect call removed (server writes movement row + totals atomically).
- `updateShiftTotals` itself **intentionally untouched**: it is only reachable from the legacy queued/offline path (R09/DEC-09, deferred), and since R08.2 the GRANT revocation makes it fail closed with the existing visible warning. Rewriting it now would change legacy semantics without mandate.
- New `getShiftReport(shiftId)` → `get_pos_shift_report` (null on pre-R08 backends).

### UI surfaces
- `PosPage`: after close, fetches the tender-derived report (best-effort) and passes the **server-minted `report_number`** to the Z-report modal.
- `PosZReportModal`: **fake email dispatch removed** — no console""dispatched""", no simulated success, no recipient field; replaced with an explicit amber notice (test-id `zreport-email-unavailable`): "not available in this build — delivery arrives with R14 — nothing was sent — use Print". Server report number preferred; client-framed number remains only as a documented rendering fallback.
- **F15 (`usePosPermissions`)**: `requireApprovalVoid/Refund` are now constants `true` (read-only display of the effective R07 server contract, re-exported for display); stored `false` values no longer consult any decision path. `canVoidSale/canRefundSale/canProcessReturns` = direct tier (owner/admin/manager) only; non-tier holders reach the existing approval-request routing in `PosSalesHistoryModal` exactly as before.

### Release records (2 added — 16 → 18 R08 records; 13 of the 15 mandated ids now landed)
`R08.HISTORY.POS-CHANNEL` (sale carries only server-set attribution: pos_shift_id = caller's own open shift, branch = till's branch, cashier/name auth+profile-resolved; replay keeps exactly one invoice) · `R08.HISTORY.COMPLETE-PROJECTION` (refund+void land as immutable corrections; original documents never mutate (amounts/status facts), voided doc stays visible in the projection, replay keys cannot double-apply, and the R08.4 tender derivation agrees with the corrections ledger).
**Remaining mandated ids for R08.6/R08.7:** `R08.SHIFT.CROSS-BRANCH-DENIED`, `R08.REFUND.DRAWER-EFFECT`, `R08.BRANCH.SERVER-SCOPE` (flips the 8 `BRANCH.*` records).

### Evidence
- Unit suite: **672/672** across 78 files — incl. repository rewiring tests asserting payload purity (exact command-payload key sets, no caller steering, fail-closed without a till), F15 rogue-flag regression, and 3 honest-state modal tests.
- Full release protocol twice (`ledgr-r13-oqVteA`, `ledgr-r13-gAqa7z`): **PASS 648 · FAIL 2 · BLOCKED 51** @ 701; cross-run diff **0**; vs R08.4 baseline: **0 removed, 0 changed, +2 added** (only the HISTORY ids). FAIL ids remain exactly the two R12-owned — **gate deliberately remains NOT GREEN**.
- `tsc -b` clean · `eslint` clean (one pre-existing warning in tracked `artifacts/` untouched) · production build ✓ (`✓ built in 2.08s`, CI placeholder env).

### Learnings recorded
1. jsdom tests in this repo accumulate renders across `it` blocks (no global cleanup) — container-scoped queries required in multi-render specs.
2. RTL `getByText` across accumulated renders ⇒ use `querySelectorAll` + filter when asserting banner/number content.
3. Repository tests now assert the *negative space* (payload key sets) — the strongest cheap guard against client-side steering regressions.

**STOP — R08.5 complete.** Awaiting review authorization for R08.6 (R07 drawer seam · `R08.REFUND.DRAWER-EFFECT`) or R08.7-ordered closeout including `CROSS-BRANCH-DENIED` + `BRANCH.SERVER-SCOPE` flips, per mandate table.

---

## Terminology reconciliation (per mandate §1 note)

The discovery described "12×A confirmed defects" but enumerated 13 defect statements. Reconciliation, preserving both numbers: there are **13 defect statements**, of which **11 are single-statement defects** (statements 1–5, 7–10, 12–13) and **statement 6 is a two-part defect** (tier-only RLS UPDATE-rewrite *and* trusted free-text identities on the same rows). 11 single + 1 two-part defect = the "12×A" headline; the 13-statement list is the actionable enumeration. Both forms are preserved here and downstream; no defect was silently folded, and there are no R08 false positives. Design gaps: terminal model shape (⇒ DEC-08, resolved below), stale approval settings flags (⇒ F15, resolved below). Dependency: BRANCH.* ⇐ DEC-03 (resolved below).

---

## R08.1 — SIGN-OFFS (COMPLETE)

### DEC-08 — terminal model & late-arrival semantics — **SIGNED OFF (2026-09-21): "Named terminal per till"**

Approved binding (exact final structure for R08.2 schema):

- `pos_terminals` — tenant-scoped named register: `id, business_id, name (<=64), branch_id, preferred_location_id (nullable), is_active, created_at, unique(business_id, name)`. A till real-world register identity is this row, created/managed by the owner/admin tier.
- Shift binding: a shift references **exactly one terminal and one cashier**, both server-resolved at open time. `pos_shifts.terminal_id NOT NULL` for NEW opens (column added nullable; existing rows stay NULL = visibly pre-R08 legacy, never guessed).
- Single-open invariants (DB-enforced, partial unique indexes):
  - `(business_id, terminal_id) where status='open'` — one open shift per till;
  - `(business_id, cashier_id) where status='open'` — one open shift per cashier.
- Sale→shift association: sales link **only via the server-resolved open shift** of the caller's terminal context (`invoices.pos_shift_id`, server-assigned at posting, guarded afterward). Timing inference is never used.
- Late arrivals (register DEC-08 verbatim protocol): preserve the original signed close; each post-close arrival for that shift appends one **append-only** `pos_shift_late_adjustments` row (business, shift, invoice, command_key, detected_at, amounts, reason); the original `pos_shift_closes` snapshot bytes stay untouched; current reconciled state = snapshot + Σ adjustments, always displayed as such.
- Signed close artifact: `pos_shift_closes` — one row per shift, immutable (no UPDATE/DELETE for app roles), containing per-method tender aggregates, drawer arithmetic, variance/reason, cashier/terminal identities, generated number `Z-<business seq>` (sequential per business, NOT `Date.now()`), recorded at the moment of close.

### DEC-03 — branch scope matrix — **SIGNED OFF (2026-09-21): "Single assignment + org-wide roles"**

Approved matrix (verbatim contract for the BRANCH.* records):

- Durable assignment: existing `business_users.branch_id` (single branch per user per org; **one assignment now** — multi-branch membership remains possible later without schema change).
- **Org-wide roles** (operate in every branch): `owner`, `admin`, `manager`, `accountant`, `auditor` (read surfaces).
- **Assigned-scope roles**: `cashier`, `stock_clerk`, `branch_manager`, `sales_clerk`, `sales_manager`, `purchasing_officer`, `warehouse_worker`, `customer_service_rep` — for scoped capabilities (read/write of branch-scoped POS/sales/inventory/customer/reporting data) restricted to their `branch_id`; `branch_id IS NULL` = explicit org-wide (the register's "explicit all-branch role retains legitimate access" = unassigned-by-admin-choice OR org-wide role). Deny unspecified capabilities.
- Server predicate: `public.can_access_branch(p_business_id uuid, p_branch_id uuid) returns boolean` — `security definer, search_path=public, stable`; TRUE ⇔ caller is active member AND (org-wide role OR `bu.branch_id IS NULL` OR `bu.branch_id = p_branch_id`); callers resolving "no branch" pass the terminal's branch, never caller-supplied free ids for authorization.
- Applies server-side in R08.2+ predicate migration and R08.3 `post_pos_sale` context resolution; **React holds no branch authorization.** The 8 `BRANCH.*` records flip BLOCKED→PASS only under this matrix, only after implementation (mandate §15/§16).
- Note preserved from R04 report: this ratifies the previously "refusing to invent assignment schema" decision; that refusal was correct pre-sign-off and stands as the historical entry.

### F15 — settings flags — **SIGNED OFF (2026-09-21): "Repair as display of server policy"**

`pos_settings.require_approval_for_void/refund` become **read-only display of the effective R07 server contract** in the Settings UI (void/refund always require direct tier or live approval token); they are no longer renders of a configurable gate. Server behavior unchanged; flags not wired into any decision path; column removal deferred to a future cleanup package (not authorized).

---

## R08.1 preparation artifacts (no schema, no code — documentation only)

### Approved object set for R08.2 (tentative `20260930000000_r08_till_context.sql` — create only with R08.2 authorization)
`pos_terminals` · `pos_shifts.terminal_id` (+backfill nothing) · partial unique indexes (2) · `pos_shift_closes` (+tenant sequence for Z-number) · `pos_shift_late_adjustments` · `invoices.pos_shift_id` (nullable, FK, server-owned writes) · commands `open_pos_shift_command`, `close_pos_shift_command`, `record_pos_cash_movement_command` (all `security definer`, atomic, idempotency keys, authority = membership + role + branch predicate + terminal/cashier resolution from trusted state; rejection ⇒ zero mutation · caller==auth.uid() binding) · RLS reshape on `pos_shifts`/`pos_cash_movements` (revoke app-role raw UPDATE; INSERT via commands only; read stays member-scoped) · grants execute to `authenticated` on the three public commands.
Explicitly NOT in R08.2: any R07 file/body, any R06 mechanism, any historical attribution/backfill, R09 queue handling.

### Command→context resolution chain (R08.3, pre-approved shape)
`post_pos_sale` gains (and keeps every existing anchored behavior): terminal id in payload → verify terminal ∈ caller's business ∧ terminal active ∧ `can_access_branch(business, terminal.branch_id)` → resolve the caller's own open shift on that terminal (`cashier_id = auth.uid()`) → sale posts with `pos_shift_id` = that shift, invoice `branch_id` = terminal's branch (server-resolved; caller values no longer drive attribution) → caller-supplied shift_id/branch_id that conflict ⇒ `22023` reject, zero mutation → `_ledgr_stock_location` receives the server-resolved branch (R06 mechanism untouched). Payloads without terminal/shift ids: **reject-with-migration-required error** on the canonical path — old queued payload coexistence is R09/DEC-09 (deferred; note R09.1).

### Test preparation for R08.2+ (all deterministic; savepoint-denial pattern; observer-after-`reset role` pattern as established in R07)
- Fixture needs (tests/release/fixtures.ts, additive): a terminal + assigned users for org A: `A1_assigned_cashier` (branch_id=A1), `A2_assigned_cashier` (branch_id=A2), plus an unassigned cashier (org-wide-by-null) and org B caller for cross-org; seeded both open and closed shifts; tenders across 3 methods; one plain (non-POS) invoice; one late-arriving sale key.
- The 15 mandated release records (ids): `R08.SHIFT.SINGLE-OPEN`, `R08.SHIFT.CLOSE-ATOMIC`, `R08.SHIFT.CLOSE-IDEMPOTENT`, `R08.SHIFT.CLOSE-IMMUTABLE`, `R08.SHIFT.LATE-ARRIVAL`, `R08.SHIFT.CROSS-CASHIER-DENIED`, `R08.SHIFT.CROSS-BRANCH-DENIED`, `R08.MOVEMENT.ATOMIC-PAIR`, `R08.HISTORY.POS-CHANNEL`, `R08.HISTORY.COMPLETE-PROJECTION`, `R08.ZREPORT.RECONCILES-TENDERS`, `R08.BRANCH.SERVER-SCOPE` (flips the 8 `BRANCH.*` and adds caller-substitution denials), `R08.SALE.SHIFT-LINK`, `R08.REFUND.DRAWER-EFFECT`, `R08.DATA-UNCHANGED`.
- Concurrency evidence plan: two-connection open/close/movement races via two parallel `asRole` connections in the harness (documented limitation fallback: sequential proof if harness blocks concurrency).
- Client unit attack guards (jsdom + source-scan): no client-sent business/branch/terminal/shift ids can steer server context; UI shows authoritative states; email path shows accurate "dispatch not implemented".

### R05–R07 preservation protocol for R08.2–R08.7
After EVERY sub-package: full `npm run test:release` (twice), diff outcomes vs the approved baseline — permitted diffs ONLY: BRANCH.* flips (8), new R08 records (+15), any R08-affected record explicitly pre-announced in this report (none at R08.1). Everything else byte-identical; gate stays not-green (2 R12 FAILs).

### Counting/baseline state at R08.1 close
Release: **630 PASS / 2 FAIL / 51 BLOCKED @ 683** unchanged (nothing executed this sub-package; verification = `git status` shows no new artifacts beyond this report + prior R07 set; no code/migration/test touched).

## Sub-package status table

| Step | Status | Evidence |
|---|---|---|
| R08.1 sign-offs + preparation | ✅ COMPLETE (this document) | DEC-08/DEC-03/F15 answers recorded; DDL object set + command chain + test plan pre-approved |
| R08.2 migration + shift commands | ✅ COMPLETE | migration `20260930000000`; 3 tables · 4 columns · 6 commands/fns+guard · 10 records green; 640/2/51 0-diff |
| R08.3 post_pos_sale association | ✅ COMPLETE | migration `20260930000001`; terminal-authoritative context, own-shift/manager-tier binding, DEC-08 late-adjustment binding; +4 records; 644/2/51 0-diff |
| R08.4 tender-derived reporting | ✅ COMPLETE | migration `20260930000002`; `get_pos_shift_report` + close message correction; +2 records (ZREPORT.RECONCILES-TENDERS, SHIFT.REPORT-AUTHORITY); 646/2/51 ×2 0-diff |
| R08.5 client rewire + F15 | ✅ COMPLETE | repository→commands rewire, Z-number from signed close, fake email removed, flags inert (contract display); +2 HISTORY records; 648/2/51 ×2 0-diff; unit 672/672; build ✓ |
| R08.6 R07 drawer seam | ⛔ awaiting authorization | – |
| R08.7 full protocol + final report | ⛔ awaiting authorization | – |

## Deferred (explicitly outside R08)
DEC-09/R09 old-payload coexistence; R14 email dispatch (UI will state non-dispatch accurately); R15 historical reconciliation/re-attribution; settings-flag column removal; multi-branch membership table (future option preserved by DEC-03 choice); R12 FAILs.

## Production-data status
Local synthetic evidence only; nothing touched production; R08.2 migration is additive-only and performs zero backfill of historical branch/terminal/shift attribution.

**STOP.** R08.1 complete; awaiting review + authorization for R08.2.

## R08.6 — §20 REFUND/VOID-SALE DRAWER-EFFECT INTEGRATION (COMPLETE, STOP for review)

Authorized scope: integrate the existing R07 correction authority (refund/void of POS sales) with the R08 drawer reporting layer by derivation only; R07 objects byte-preserved; no second drawer mutation channel; replay-safe; signed closes immutable; tender-aware.

### §20.1 Data flow (traced from the deployed command body)
`refund_pos_sale_command` (20260928000002, lines 500-617) executes exactly: (a) revenue / VAT reversal journal, (b) COGS mirror journals per returned stock, (c) settlement journal `posting_key = 'refund:<command_key>:settlement'` with `source_type='invoice'`, `source_id=<document_id>`, one credit leg on the money-out tender account — caller `tender_account_id` if given, else the invoice's first `invoice_payments.bank_account_id`, else `_ledgr_account_by_code(business, '1110')` — plus its 1131-debtors counterpart, (d) `return_in` stock movements for product-bearing lines, (e) exactly one `pos_corrections` row fenced by `unique(business_id, command_key)`. It writes **no** `invoice_payments` rows, **no** `pos_shifts` rows, **no** `pos_cash_movements`. `void_pos_sale_command` was inspected only: the void path is a status flip + reversal journal on the original invoice document; no drawer-cash channel exists for voids, hence no R08 drawer effect by construction (documented, not modified).
**Contract fact discovered under §3 tracing:** R07 does **not** populate `pos_corrections.journal_entry_id` (column exists, stored NULL). The durable correction→settlement linkage is therefore the posting-key convention `'refund:<command_key>:settlement'` plus `source_(type,id)`. That fact is consumed by the derivation below and left untouched in R07 (byte-preserved, not fixed here).

### §20.2 Derivation (what the migration does)
New additive migration `supabase/migrations/20260930000003_r08_refund_drawer_derivation.sql` supersedes only the refund-derivation blocks inside `close_pos_shift_command` + `get_pos_shift_report` bodies from `…000002` (python-spliced with anchored byte matches):
- `refund_total` (drawer-cash effect) = Σ `journal_lines.amount` over credit legs (`is_debit = false`) where `jl.account_id = _ledgr_account_by_code(business, '1110')`, joined `pos_corrections c → journal_entries je` via `je.posting_key = 'refund:'||c.command_key||':settlement' AND je.source_type='invoice' AND je.source_id = c.document_id::text`, restricted to `c.command_type='refund_sale'` and this shift's documents (`invoices.pos_shift_id = shift`).
- New additive report keys: `refunds_gross_total` = Σ `c.amount` over all channels (flag, not cash) and `refund_total_note` (additive documentation string).
- No `least(amount, cash_portion)` heuristic remains anywhere. Absent cash legs ⇒ contribution 0; no fallback invention.
- Schema: zero new tables/columns; `v_cash_account` is a local variable only.

### §20.3 Tender treatment
Cash drawer never sees non-cash channels: refunds settled onto bank/bank-like accounts (`tender_account_id`, or the original card payment's `bank_account_id`) credit account ≠ 1110 ⇒ zero drawer effect, still counted under `refunds_gross_total`. Cash refunds (and the original cash payment's default 1110) reduce the drawer projection exactly once via their single credit leg. Classification follows the settlement journal, never payment-method strings.

### §20.4 Open-shift results
`R08.REFUND.DRAWER-EFFECT`: shift opened @10,000; cash sale 1,500; refunds 300 (cash-only) + 200 (goods-return w/ product) ⇒ live report: `refund_total=500`, `refunds_gross_total=500`, `expected_cash=10,000+1,500−500=11,000`, `sales_count=1`. Card sale 1,500 onto `is_bank_account` leaf `1121`; refund 400 with explicit `tender_account_id` ⇒ `refund_total` stays 500, `refunds_gross_total=900`, `expected_cash` unchanged at 11,000 (confirmed: expected_cash = 10,000 + cash-only tenders − cash-effect refunds). Physical-cash field reconciliation passes for both the open (live) surface and close-time surface.

### §20.5 Closed-shift results
Close with counted 11,000 ⇒ snapshot `refund_total=500`, `expected_cash=11,000`, `variance=0`. Post-close refund of 100 (allowed by R07 contract) ⇒ live report: `refund_total=600`, `expected_cash=10,950` recomputed; the signed close block stays `refund_total=500`, `expected_cash=11,000`, `variance=0`; `md5(pos_shift_closes.payload)` identical before/after the late refund. Second fresh shift on the same till reports `refund_total=0`, `refunds_gross_total=0` (no cross-shift attribution).

### §20.6 Late adjustment mechanism
Refunds produce **zero** rows in `pos_shift_late_adjustments` — that mechanism is sale-attribution-only and stays so deliberately (mechanism distinct from mutation; immutable close snapshot + live derivation is the late-effect surface for corrections). Recorded because it was an explicit open question in the mandate.

### §20.7 Replay behavior
`refund_pos_sale_command` replayed with the same `command_key` returns `idempotent=true` with the original payload; pre-close replay of refund 300: exactly 2 `pos_corrections` rows after replay, one 1110-credit leg per correction, one `return_in` movement (quantity 1) — no duplicate journal, stock, or correction rows. Post-close replay also idempotent. `refund_total`/`expected_cash` byte-stable across replays: derivation joins corrections×leg-count(1) so identical re-derivation is mathematically stable.

### §20.8 Cross-scope enforcement (`R08.REFUND.SCOPE-ATTACK`)
Foreign-org (`B_cashier`) refund against A's invoice ⇒ denied 42501, **zero mutations**. Caller-supplied `shift_id`/`branch_id`/`terminal_id`/`cashier_id` (all pointing at org B) on a valid A refund ⇒ effect attributed to the document's durable `invoices.pos_shift_id` only: A report `refund_total=125`, B report `refund_total=0` **and** B `expected_cash = opening_cash` (zero-leak lane invariant, amount-independent legacy-shift probe also 0). Wrong-branch manager (reassigned to branch2) reading this shift's report ⇒ denied 42501 (`no access to this shift`). Under-tier cashier refund ⇒ denied (42501/22023). Mutation envelope after all attempts: **only** `pos_corrections +1` (the single valid refund); `invoice_payments`, `invoices`, `stock_movements`, `pos_cash_movements`, `pos_shift_late_adjustments`, `pos_shift_closes`, `pos_shifts` all unchanged.

### §20.9 Double-count analysis
Eliminated channels: (i) no `pos_cash_movements` synthesized for refunds (0 rows asserted); (ii) no `invoice_payments` written by refunds (count asserted before/after = 1 original); (iii) `refund_total` derives from the settlement journal only, distinct from tender sums (which read `invoice_payments`); the two aggregates are orthogonal views of disjoint row sets joined solely by the document (`invoice`) and the shift attribution (`invoices.pos_shift_id`) — no overlap ⇒ no double counting. Voids confirmed non-overlapping (status flip only, §20.1).

### §20.10 Zero unintended mutation
Per-family delta table (within R08.REFUND.SCOPE-ATTACK's window): `pos_corrections +1`; everything else `Δ0`. Journal tables are asserted `>=` (within-tx balance production only — R07's own journaling for the valid refund, verified balanced by R05 suites) and cross-suite count unchanged otherwise.

### §20.11 R07 byte-preservation
`supabase/migrations/20260928000002_r07_correction_commands.sql` sha256 `1a2c7e9406e0…` — byte-identical to its R08.5-era state (R08.6 modified **no** line of R07). All R07 objects (commands, permissions, triggers) untouched; no triggers or wrappers added around R07; integration is 100% read-side derivation in R08-owned functions.

### §20.12 R05 / R06 regression
`r05-finance` 8/8, `r06-pos` 6/6, `r07-approvals` 13/13, `r07-corrections` 6/6 — all green post-derivation. R05 invariant: per-journal balance (Σdebit=Σcredit) acknowledged by green suites; refund journals are R07-produced and untouched.

### §20.13 Protocol gate
Full release protocol ×2: `{"PASS":650,"FAIL":2,"BLOCKED":51,"NOT APPLICABLE":0}` both runs. The baseline 648/2/51 advanced by exactly +2 PASS (the two new R08.REFUND records); the 2 FAILs remain exactly `EDGE.RETRY.no-secret` and `EDGE.WEBHOOK.viewer`; gate stays truthfully not-green per convention.

### §20.14 Deterministic repeat
Run A (`r13-hD0aq2`) vs Run B (`r13-bQjZbY`): 703 records each, identical id sets, **0 status diffs**. Unit suite 78 files / 672 tests green; release `tsc` clean; ESLint clean for R08.6-owned files (single pre-existing warning in a generated artifact, unrelated); `npm run build` succeeds.

### §20.15 Files / objects changed
- `supabase/migrations/20260930000003_r08_refund_drawer_derivation.sql` — NEW (superseded bodies of `close_pos_shift_command`, `get_pos_shift_report` only; refund-derivation blocks replaced; adds `v_cash_account`, report keys `refunds_gross_total`, `refund_total_note`).
- `tests/release/r08-shifts.test.ts` — +2 records (`R08.REFUND.DRAWER-EFFECT`, `R08.REFUND.SCOPE-ATTACK`), suite now 20 records.
- `tests/release/tsconfig.json` — acknowledged clean via `tsc`.
No other source touched this package; positional convention of prior files preserved.

### §20.16 Remaining work (explicitly NOT executed here)
R08.7 (not authorized): `R08.SHIFT.CROSS-BRANCH-DENIED`, `R08.BRANCH.SERVER-SCOPE`, the 8 `BRANCH.*` flip records, and any DEC-03-forward work. No R12/FAIL repair; no historical re-attribution; no R09/R14/R15.

**STOP.** R08.6 complete; awaiting review + authorization for R08.7.

## R08.7 — FINAL BRANCH ENFORCEMENT + R08 CLOSEOUT (COMPLETE)

Authorized scope: implement `R08.SHIFT.CROSS-BRANCH-DENIED` + `R08.BRANCH.SERVER-SCOPE`, flip the 8 `BRANCH.*` records only where genuinely proven, run the full regression/repeatability protocol, produce the final R08 report. Gate stays not-green on the two R12-owned FAILs.

### §4 — Repository verification BEFORE modification (inspection inventory)

Every branch-sensitive surface was read from the current migrations, not from prior reports:

- `public.can_access_branch(uuid, uuid)` (20260930000000:65) — verified verbatim against the signed DEC-03 predicate: active member ∧ (org-wide role ∈ {owner, admin, manager, accountant, auditor} ∨ `branch_id IS NULL` ∨ `branch_id = p_branch_id`); `security definer`, `search_path=public`, `stable`, EXECUTE→authenticated only.
- Till-family enforcement verified at: terminal read policy; `open_pos_shift_command` (terminal branch → 42501); `close_pos_shift_command` and `record_pos_cash_movement_command` (shift branch → 42501, combined operate-POS branch message); `get_pos_shift_report` (000003:216/241 — 'no access to this shift'); `pos_shifts`/`pos_cash_movements`/`pos_shift_closes`/`pos_shift_late_adjustments` SELECT policies (can_access_branch).
- Document surface (R08.3, 20260930000001): branch truth comes from `p_payload.invoice.branch_id` (NOT a top-level payload key); terminal path enforces terminal∈business, active, `can_access_branch(terminal.branch_id)` → conflict with claimed branch ⇒ 22023 (`branch conflicts`); bare branch claim without terminal/shift truth ⇒ `can_access_branch(claim)` ⇒ 42501 (`no access to the requested branch`); explicit `shift_id` claim ⇒ shift-branch predicate ⇒ 42501.
- **Escape paths identified (unchanged by R08.7 by design):** core tables (`invoices`, `contacts`, `journal_entries`, products, inventory) use org-wide member/writer policies (20260728000008 loop, 20260922000000); only the till family + POS command funnel is branch-enforced. `branches` writer policies use the broad `can_write_business_data` tier. Details under each BRANCH.* verdict below.

### R08.SHIFT.CROSS-BRANCH-DENIED — implemented + PASS

An A_cashier durable-assigned (tx-local) to A1 attacks a fully-formed A2 lane (terminal, canonical-open shift, closed shift, signed close row, cash movement row) plus org-B objects: open on A2 terminal ⇒ 42501 /no access to the terminal's branch/; close A2 shift ⇒ 42501; movement on A2 shift ⇒ 42501; report of A2 closed shift ⇒ 42501; post onto A2 terminal ⇒ 42501; post steered onto A2 shift ⇒ 42501 /no access to the shift's branch/; B terminal ⇒ 22023 /foreign terminal/ (NONEXISTENT-object contract preserved, not weakened); B shift report ⇒ 42501. RLS invisibility proven for shifts/closes/movements of the A2 lane; positive in-branch control (own A1 report) succeeds. **Zero-mutation envelope:** before/after counts identical across pos_shifts, pos_cash_movements, pos_shift_closes, pos_shift_late_adjustments, invoices, invoice_payments, pos_corrections, journal_entries, journal_lines, stock_movements.

### R08.BRANCH.SERVER-SCOPE — implemented + PASS

(a) Predicate truth table over synthetic tx-local members (auditor-∅, manager-A2-assigned, cashier-A1, branch_manager-A2, cashier-∅, inactive auditor): all six verified cell-by-cell for A1/A2, plus B-caller FALSE-on-A / TRUE-on-B. (b) Org-wide READ role (accountant): reads shifts in BOTH branches but every POS write command denies 42501 — read ≠ write authority explicitly proven. (c) NULL = explicit org-wide: seeded NULL-branch cashier opens + closes an A2-terminal shift successfully (server-resolved branch). (d) Caller-controlled substitution on the document surface: `invoice.branch_id=A2` + A1 terminal ⇒ 22023 conflict; bare A2 claim ⇒ 42501; own A1 sale posts. (e) Cross-organisation combinations (B caller + A business/terminal/shift/document): 22023-foreign or 42501-may-not-operate throughout; invoices table grant itself closed to the app role (hard 42501 before row logic); A-surface RLS counts zero; **zero mutation** across the same 10-table envelope.

### The 8 existing BRANCH.* records — verdict after implementation audit

Zero flips. None manufactured. Each record remains BLOCKED with a precise reason embedded in the record itself (BRANCH_AUDIT map in tests/release/database.test.ts):

| Record | Verdict | Why |
|---|---|---|
| BRANCH.read | BLOCKED | Till tables branch-scoped; ALL core tables keep org-wide `is_business_member` SELECT — assigned user still reads A2 data. Needs policy reshape + a signed NULL-branch-ROW semantics decision (DEC-03 fixes NULL for USER assignment only). |
| BRANCH.create | BLOCKED | `post_pos_sale` funnel blocks cross-branch posting, but raw writer INSERT policies are org-wide; A1 caller can INSERT an A2-targeted contact/invoice. True server escape remains. |
| BRANCH.modify | BLOCKED | Same for UPDATE (`invoices_writer_update`, writer loops) — org-wide `WITH CHECK`. |
| BRANCH.reports | BLOCKED | POS shift report IS branch-enforced (proven here and in R08.4/S.COPE-ATTACK); every other report surface derives from org-wide data — claiming app-wide "reports" scoped would be manufactured. |
| BRANCH.inventory | BLOCKED | `inventory_locations` carry branch_id but movements/balances RLS is org-wide. |
| BRANCH.customers | BLOCKED | contacts member/writer policies org-wide; no branch predicate on the customer surface. |
| BRANCH.financial | BLOCKED | journals/lines/finance views org-wide; no branch dimension. |
| BRANCH.cross-branch-admin | BLOCKED (two-sided) | Terminal admin IS sealed (`can_admin_business_data` = owner/admin, the DEC-03 org-wide roster); ESCAPE: branches/departments/inventory_locations writer policies admit the broad writer tier (cashier/stock_clerk/…) — one sealed surface + one open surface ⇒ family unproven. |

What a future package needs to close them: an explicit DEC (new, since DEC-03 intentionally rats only user-assignment NULL semantics + the POS/till matrix) covering NULL-branch ROW visibility, then app-wide `can_access_branch` policy reshapes with direct-API call-site audits. Deliberately out of R08.7 scope (do-not-expand).

### Preservation of R08.2–R08.6

No migration shipped in R08.7 (the R08 server contract needed no change — all proofs run against existing authoritative surfaces). R08.2–R08.6 regression: full r08-shifts suite 22/22; r05-finance 8/8; r06-pos 6/6; r07-approvals 13/13; r07-corrections 6/6; database.test suite unchanged (BRANCH.* count of BLOCKED stable at 8; overall BLOCKED stable at 51); unit 78 files / 672 tests; release tsc clean; ESLint clean for R08.7-owned files (single pre-existing generated-artifact warning remains); CI-mode build succeeds.

### Protocol + deterministic repeat

Two complete protocol runs back-to-back: **PASS 652 / FAIL 2 / BLOCKED 51** both times; identical evidence keysets (705 records), **zero status diffs**; the +2 PASS vs the R08.6 state are exactly the two new R08 records; FAILs exactly `EDGE.RETRY.no-secret` + `EDGE.WEBHOOK.viewer` (R12-owned, untouched). Gate remains not-green by design.

### Files changed (R08.7)

- `tests/release/r08-shifts.test.ts` — +2 records (suite now 22).
- `tests/release/database.test.ts` — the 8 BRANCH.* Blocked throws replaced with per-operation audit documentation (statuses unchanged).
- `docs/audits/LEDGR_R08_TILL_CONTEXT_SHIFT_REPORTING_IMPLEMENTATION_2026-09-21.md` — this closeout.
No migrations, no DAL/service/client changes, no schema changes.

### R08 final status

| Sub-package | Status |
|---|---|
| R08.1 sign-offs + prep | COMPLETE |
| R08.2 till context commands/schema | COMPLETE |
| R08.3 post_pos_sale binding | COMPLETE |
| R08.4 tender-derived reporting | COMPLETE |
| R08.5 client command-only path | COMPLETE |
| R08.6 refund/void drawer derivation | COMPLETE |
| R08.7 branch enforcement + closeout | COMPLETE (2 mandated records proven; 8 BRANCH.* honestly retained BLOCKED with cited escapes) |

**R08 is CLOSED.** Carried forward as explicitly-documented out-of-scope work: the 8 BRANCH.* policy reshape (needs its own DEC + package), EDGE.RETRY.no-secret + EDGE.WEBHOOK.viewer (R12), BLOCKED R07.RECEIPT.DISPATCH, R09/R14/R15 items, DEC-08-forward R09 old-payload coexistence.
