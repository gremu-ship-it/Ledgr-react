# LEDGR — R08 Pre-Implementation Discovery Report

**Date:** 2026-09-21
**Method:** read / inspect / trace / classify / propose. **Zero code, zero migrations, zero tests changed.** Audit-state untouched; R01–R07 evidence untouched.
**Baseline at start:** release evidence **630 PASS / 2 FAIL / 51 BLOCKED @683** (both FAILs R12-owned, out of R08 scope); app vitest 666/666.

---

## 1. R08 register scope (authoritative)

Register: `docs/audits/LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md` §"`R08 — Establish trustworthy till context and shift reporting`" (priority **High**, owner *Frontend + backend*, dependencies **R04, R06–R07, DEC-08**, scope *POS/branch*); expanded register entry `docs/audits/LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md` §R08 (release blocker for POS/shift reporting & branch-scoped promises).

**Exact objective:** the till must not be able to invent its organisational/branch/terminal context; shift lifecycle, cash movements and shift/close reporting must be provable from complete authorized records, server-side.

**Planned actions (register verbatim):** configure real branch+location and replace UI-only register identity with the minimum durable terminal association; persist POS sale/channel/shift association without making every finance invoice a POS sale; prevent duplicate open shifts per approved terminal/cashier policy; build history/close reports from complete authorized records and tenders (not latest-30 generic invoices with omitted fields); make cash movements/concurrent shift totals reliable; preserve closed reports; record late arrivals separately (DEC-08).

**Acceptance (register verbatim):** non-POS invoices excluded from shift totals; report totals/per-method receipts/refunds/drawer reconcile to complete underlying records; cashier and branch scopes enforced by query, not client filter; restart/duplicate-shift/late-sale/refund/cash-movement cannot silently overwrite a signed close.

## 2. R08-owned findings (register §R08 "Current behaviour" / audit §§4,9) — and where each lives

| # | Finding | Classification (§5) |
|---|---|---|
| F1 | Active POS branch is hard-null; branch list empty; register identity is UI state | **A — confirmed** |
| F2 | Terminal identity accepted but never persisted; no terminal model exists | **A** (UI claims it) + **B** (minimum robust model is design-pending per register) |
| F3 | Open-shift insertion has no duplicate-open policy (client or server) | **A — confirmed** |
| F4 | `closeShift` is non-atomic browser read-modify-write AND re-closable: a second close silently recomputes and **rewrites the signed close** (no `status='open'` guard in the UPDATE) | **A — confirmed** (DEC-08 violation today) |
| F5 | `updateShiftTotals` and `recordCashMovement→updateShiftTotals` are non-atomic read-modify-write pairs; concurrent updates lose increments | **A — confirmed** |
| F6 | RLS on `pos_shifts`/`pos_cash_movements` is tenant+shared-tier only: any writing-tier user (incl. cashier) can update **any** shift in the business (expected_cash/status/variance); insert fabricates historical `opened_at`; `cashier_id`/`cashier_name` are trusted free text (`currentUser?.id \|\| 'cashier-1'` fallback) | **A — confirmed** |
| F7 | Sales have **no durable shift/terminal/channel link** (post_pos_sale touches drawer arithmetic only; invoices carry caller `branch_id`+`client_key` only) | **A — confirmed** (feeds F11) |
| F8 | `post_pos_sale` trusts caller `branch_id` and `shift_id`: the drawer update is guarded by business+open status, but NOT by cashier==auth.uid() or branch-consistency — a sale can steer cash into another branch's/cashier's open shift within the tenant; `_ledgr_stock_location` then resolves stock from the caller-supplied branch | **A — confirmed** (same-tenant wrong-branch/wrong-cashier; cross-tenant branch id is FK-blocked for branch existence but attribution of a *foreign-or-unassigned* stamped branch is not) |
| F9 | History = latest **30** invoices of **any type** (`findByBusiness(businessId, undefined, 30)`), then mapped over fields that are **omitted by `LIST_SELECT`** (`subtotal`, `discount_amount`, `created_by`, `payment_reference`, `contact`) → gross/discount silently render 0, receipt falls back to invoice_number, cashier renders 'Cashier' | **A — confirmed** |
| F10 | Z-report computes from that same 30-row list + the shift's client-maintained counters; non-cash payment breakdown is hard-zeroed; report number is `Date.now()`-derived and **never persisted**; no close snapshot exists anywhere | **A — confirmed** |
| F11 | Deferred: "build reports from complete authorized records and tenders" — tenders ARE authoritative and complete server-side (`invoice_payments.payment_method`/`bank_account_id`); the data exists, the report path is the deficit (cluster root = F9/F10) | **C — partially** (data layer complete; report layer broken; classified A in effect) |
| F12 | DEC-08 late arrivals: no adjustment/reconciliation record type; drawer update simply skips closed shifts (`where … status='open'`) and the client warns; total drawer effect of a late sync is *silently absent* from any adjustment ledger | **B — design gap → A (impact present)**: the skipping is the least-bad decoy; register DEC-08 requires an append-only adjustment record, which does not exist |
| F13 | R07 canonical refund/void commands do **not** touch `pos_shifts` refunds/drawer counters (by design isolation) while the legacy demo path does — an open shift's drawer is not reconciled against canonical corrections | **A — confirmed** (R08-owned integration seam; **R07 is not to be modified by R08**, seam lands via R08's own close/derive layer, §11) |
| F14 | Z-report "email the owner" is simulated client-only (`console.info` + 600 ms timer + success banner) | **A — confirmed** (flying-under-reporting-trust defect; strictly a reporting-surface item) |
| F15 | `pos_settings.require_approval_for_void/refund` toggles no longer bind to any server behavior (R07 uses tier+token contract) while the Settings UI still presents them as the correction gate | **B — design gap** (stale control display; must be reconciled by explicit decision — server wins) |
| F16 | BRANCH.* depth (per-table branch predicates) | **E — dependency**: DEC-03 user→branch assignment contract is still **undecided** (8 release records `BRANCH.read/…/cross-branch-admin` stand BLOCKED, co-owned `R04/R08`) |

No register finding tests as **D (false positive)**; none are **F (out of scope)** beyond the exclusions in §17–18.

## 3. Evidence surface

### Client (files inspected line-by-line)
- `src/pages/PosPage.tsx` — till orchestration. `branchId = null` (l.59); `branches={[]}` (l.520); data load: `findActiveShift(businessId, cashier, null)`, **and** `repos.invoice.findByBusiness(businessId, undefined, 30)` mapped to `PosSale` with omitted fields (l.252–270); `currentShift?.id` → `processSale` payload (l.331–332); `handleOpenShift/handleCloseShift/handleRecordCashMovement` raw repo calls, no duplicate-open guard (l.377–436).
- `src/dal/repositories/PosRepository.ts` — `findActiveShift/getCurrentShift` (branch filter optional, absent ⇒ business-wide); `openShift` raw INSERT incl. trusted identities, `terminal_id` accepted in arg type but discarded (l.219–282); `closeShift` read→compute→UPDATE `.eq('id')` with no status/stock guard (l.289–352); `updateShiftTotals` non-atomic RMW (l.416–474); `recordCashMovement` INSERT + separate totals call (l.476–546); `listShifts`/`listCashMovements` tenant-only (no cashier scoping options besides manual filter).
- `src/services/posReportService.ts` — `generateZReportSummary`: zeros for all non-cash buckets; gross/net fallback to shift counters; report number `Z-{year}-{Date.now()%100000}`; no persistence; `formatZReportEmailBody` plain-text.
- `src/components/pos/PosZReportModal.tsx` — computes summary from `currentShift` + `salesHistory`; **fake email dispatch** (l.49–64).
- `src/components/pos/PosOwnerAnalytics.tsx` — aggregates from `salesHistory` (30 rows, zero-mapped numbers) and single current shift; `currentBranchId` `undefined` (page passes null-ish); `salesByCashier` therefore attributes nothing real.
- `src/components/pos/PosHeader.tsx`, `PosShiftModal.tsx`, `PosCashMovementModal.tsx`, `PosSalesHistoryModal.tsx`, `PosSettingsModal.tsx`, `src/hooks/usePosPermissions.ts` (`canOpenShift = open_shift || cashier||manager||admin`), `src/types/pos.ts` (`terminal_id?: string` on open args only).
- `src/services/posService.ts` — `shiftId` carried in the sale payload (l.247/341/495); lines 1227–1330 are demo-sim-local correction bodies (R07-gated; out of real-server path).

### Server / DB
- `supabase/migrations/20260920000000_pos_module.sql` — `pos_shifts` (no uniqueness on (branch|cashier|terminal,open); no terminal_id), `pos_cash_movements`, `pos_settings`; RLS: select=`is_business_member`, insert/update=`can_write_business_data` (tier **includes cashier**), delete=`can_admin_business_data`.
- `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` — `can_operate_pos` membership+role gate (l.598 ✓); invoice insert persists caller `branch_id` (l.706), `created_by`, `client_key`; **no shift/cashier/terminal columns**; drawer-total update guarded `where id=v_shift and business_id=v_business_id and status='open'` (l.794–807 ✓ against cross-tenant/closed, ✗ against wrong-cashier/wrong-branch within tenant).
- `supabase/migrations/20260928000002_r07_correction_commands.sql` — canonical commands; **no pos_shifts coupling** (grep = 0 hits); R07 must not be regressed.
- Base schema: `invoice_payments` (`payment_method` enum, `bank_account_id`) — the complete tender surface R08 reports should reconcile against; `business_users.branch_id` + FK exists (assignment *data* channel present, enforcement decision absent).
- `supabase/migrations/20260728000008_role_aware_master_data_rls.sql` — `can_write_business_data` tier (incl. `cashier`) as used by pos tables.

### Tests (existing)
- Release: `tests/release/database.test.ts` — 8 `BRANCH.*` BLOCKED records (co-owned `R04/R08`); `tests/release/fixtures.ts` seeds branches/locations/one open shift per org; `r05-finance`/`r06-pos`/`r07-approvals` families (no shift-lifecycle coverage anywhere).
- App: `src/dal/repositories/__tests__/posRepository.test.ts` (open/close/cash-movement raw-mock happy paths — *characterizes the vulnerable shape*), `src/services/__tests__/posHardwareAndReports.test.ts` (Z-summary arithmetic incl. the zeroed buckets), `posIntegration.test.ts`, `src/lib/__tests__/branchPerformance.test.ts`.

### Configuration
None R08-owned. Do-not-touch.

## 4. End-to-end control/data flows (traced)

**Open shift:** UI modal → `openShift({businessId, branchId:null, cashierId, cashierName, float})` → `pos_shifts` INSERT (RLS tier check only) → identity = whatever UI passed ('cashier-1' fallback); no terminal; no duplicate guard; opened_at client-influenced ⇒ *wrong-role/fabricated-shift possible within tenant*.

**Sale with shift:** cart → `buildPosSaleQueuePayload` → `post_pos_sale` (membership+`can_operate_pos` ✓ atomic ✓ replay via client_key ✓) → drawer `UPDATE pos_shifts … where id=v_shift and business_id and status='open'` → **invoice keeps the money trail, keeps NO shift link; shift keeps counters, keeps NO sale list** — the close cannot be independently re-derived; rejection/close-skipped case leaves totals silently unadjusted (F12).

**Close shift:** UI → `closeShift(shiftId, {closingCashActual, notes})` → SELECT whole shift → browser arithmetic → UPDATE status='closed'+expected/variance. Not atomic; id-key only; **idempotent-close absent: re-close rewrites signed values** (F4).

**Cash movement:** UI → `recordCashMovement` INSERT row + separate `updateShiftTotals` RMW; pair non-atomic; movement rows carry trusted user text; non-monotonic totals possible under two tabs (F5).

**History/analytics:** `findByBusiness(30)` `LIST_SELECT` → mapped over missing projection fields — numbers shown are structural zeros for discount/gross (F9).

**Z-report:** shift counters + 30-row list ⇒ printed/emailed values; email never dispatched (F14); report non-persisted, number non-determined (F10).

**State of where identity/threat gating actually lives:** membership/`can_operate_pos` server-side for sale posting ✓; **shift layer: none** (RLS tier only); branch: caller-supplied everywhere on the POS path (F1/F8/F16).

## 5. Threat analysis (per R08-owned workflow; only real-surface threats listed)

| Workflow | Threats present |
|---|---|
| openShift | wrong-role (any writing-tier incl. cashier anywhere in tenant), caller-supplied identity substitution (cashierId-'cashier-1'), caller-supplied branch (null default), duplicate submission (no guard), fabricated backdating (opened_at trusted), RLS-tier-only (no row ownership) |
| closeShift | race/lost-update, **replay re-close rewriting signed totals**, wrong-role cross-cashier overwrite (RLS), stale state (whole-row RMW), client-computed financials |
| updateShiftTotals / cash movement | concurrency lost-update, partial mutation (movement row without totals or vice versa), wrong-role, caller-supplied user identity |
| post_pos_sale shift/branch | wrong-branch (within tenant, incl. null-collapse), wrong-cashier shift steering, stale open-shift id (degrades to silent skip = partial attribution), cross-tenant branch stamping (FK existence-blocked but attribution-free-form otherwise: verified: business guard on drawer only, not on stamped branch validity ↔ business ownership is enforced by `_ledgr_stock_location` resolution semantics — falls back) |
| history/analytics/Z | RLS enforces tenant on reads ✓; wrong-scope (branch missing), incomplete dataset as "complete" reporting — an integrity-fraud surface (report content ≠ underlying records) |
| R07 commands ↔ drawer | stale shift counters after canonical refunds (F13) — divergence, not a bypass of R07 financials |

SECURITY DEFINER surface relevant to R08: `post_pos_sale` (fine-grained: business-pinned; keeps caller branch/shift semantics — the seam). **No RLS bypass or service-role misuse found in the R08 surface.**

## 6. Financial integrity analysis

- **Authoritative money record today:** `invoices` + `invoice_payments` + `journal_entries` (+ R07 `pos_corrections`), all written transactionally by `post_pos_sale` / R07 commands. **Shift counters are client-maintained derived caches** — never re-derived, never reconciled; the close stores them as if authoritative.
- **Downstream expectations on close:** close snapshot must equal `opening + Σcash tenders − Σrefunds ± Σmovements` over the shift's **linked** tenders; today's `expected_cash` equals whatever the browser accumulated (F5 losses included).
- **R05 invariants preserved** (no accounting redesign proposed): R08's reports and close snapshots must be *projections/proofs* of existing records, plus new append-only rows — never rewrites of R05/R06 data.
- Rejection on any new R08 command ⇒ zero financial mutation (R07 pattern); close becomes immutable-INSERT + status flip, not recalculated overwrite.

## 7. R06 dependency analysis (§10)

- `stock_movements`/`inventory_balances` are R06-authoritative via the posting trigger; **POS location resolution** is `_ledgr_stock_location(business, caller_branch)` — F1/F8 mean stock may be resolved at the default location while the invoice is stamped with another branch. Once the terminal context is durable and server-derived, R08's `post_pos_sale` change will feed the *server-resolved* branch into location selection (no change to the R06 mechanism itself).
- R08 must not modify the movement→balance mechanism, COGS/WAC logic, or the R06 release records.

## 8. R07 dependency analysis (§11)

- Interactions: sale posting + corrections are the drawer-affecting workflows. R07 commands deliberately do **not** touch `pos_shifts` (grep-verified). The seam (F13) belongs to R08's reporting/closure layer: proposal = *derive* drawer truth from linked tenders/movements at close time and reconcile corrections against the shift on which they land, by **server-side derivation** — not by editing R07 command bodies unless a later register entry approves an in-command adjustment hook (preferred: keep R07 atomic bodies untouched; derive + record adjustment rows under DEC-08 protocol).
- `post_pos_sale` **is** R06/R07-owned: R08's required changes (persist `pos_shift_id`, validate shift-vs-caller, server-resolve branch) modify this function's body → **authorized-edit requirement with byte-identical preservation of the R05–R07 anchored records**; propose checksum-level guard tests (already: POS.SALE/POS.REFUND/POS.VOID records + r06-pos suite) run after any edit.
- R08 introduces a new approval bond? **No new approval requirements recommended.** Cashier-different-from-approver draws on the existing R04 role model; bulk close/manager-close may later use R07 `request_pos_approval` (action domain extension — register decision only if requested; excluded from the proposed plan).

## 9. Test-design proposal (proposed only — none implemented)

| Test ID | Scenario | Setup | Action | Expected result | Proves |
|---|---|---|---|---|---|
| R08.SHIFT.SINGLE-OPEN | second open for same (tenant,cashier,terminal) | seeded open shift | command open | 22023; zero mutation; only one open row (observed) | duplicate prevention, rejection zero mutation |
| R08.SHIFT.CLOSE-ATOMIC | close persists snapshot equal to tenders | shift with N sales+movements | close command | one `pos_shift_closes` row; sums == tender sums; status closed; replay of same command_key idempotent | atomicity, idempotent replay |
| R08.SHIFT.CLOSE-IMMUTABLE | re-close after close | closed shift | close again (new key) | 22023; snapshot bytes unchanged (hash compare) | signed-close immutability (DEC-08) |
| R08.SHIFT.LATE-ARRIVAL | offline sale lands after close | closed shift; late key | post late sale | sale posts; NO drawer rewrite; one `pos_shift_late_adjustments` row referencing invoice | DEC-08 append-only policy |
| R08.SHIFT.CROSS-CASHIER | B2 cashier closes/updates A1 cashier shift | two cashiers, each open shift | command with foreign shift id | 42501/22023; zero mutation | row-ownership authority |
| R08.SHIFT.CROSS-BRANCH | sale steering to foreign open shift | branches B1/B2 | post with shift_id of B2 while terminal=B1 | command rejects (22023) or attributes to caller's own (decided contract) | wrong-branch steering denial |
| R08.MOVEMENT.ATOMIC-PAIR | movement+totals single transaction | open shift | record movement | row + totals moved together; forced error mid-way ➜ neither row | atomicity |
| R08.HISTORY.POS-CHANNEL | history excludes non-POS invoices | 30 POS + 20 plain invoices | history command | complete POS pages only; cap-proof paging | query correctness |
| R08.HISTORY.COMPLETE-FIELDS | modal shows real numbers | fixture with discount | read | gross/discount/cashier/tenders == underlying rows | projection completeness |
| R08.ZREPORT.RECONCILE | Z equals tenders+movements | mixed tenders | generate close report | per-method totals == `invoice_payments` aggregation; zero drift | reconcile to authoritative records |
| R08.BRANCH.SERVER-SCOPE (post-DEC-03) | A1-assigned user blocked from A2 | assignment seeded | any scoped command | 42501; unassign BRANCH.* flips BLOCKED→PASS only after DEC-03 | branch predicates non-client |
| R08.SALE.SHIFT-LINK | invoice records durable link | open shift invited via command | sale | invoice carries server-assigned shift (not client-selected), terminal id | durable association |
| R08.REFUND.DRAWER-EFFECT | canonical refund reflects in close math | refund mid-shift | close | refund totals included from `pos_corrections`/tenders; no R07 anchors change | R07 seam closure w/o regression |
| R08.DATA-UNCHANGED | all probes rolled back | — | suite end | pos_shifts/closes/adjustments baseline counts unchanged | probe hygiene |
| Attack tests (client unit) | page cannot select arbitrary business/branch/terminal/shift ids | jsdom | — | source-level guards + RPC contract badges | client-only-authorization denial |

Anchors to extend: `tests/release/database.test.ts` may host R08.SHIFT.* anchored probes (PosQL fixture pattern); a new `r08-shifts.test.ts` for the matrix — keeping every existing record byte-identical (POS.SALE etc. only gain ground truth, never lose).

## 10. Migration proposal (none created)

`tentative: 20260930000000_r08_pos_shift_terminal.sql` — **yes, required** (register: migration required = yes).

- **Objects:** `pos_terminals` (tenant-scoped durable register identity; name+branch+location); `pos_shifts.terminal_id` + partial unique `(business_id, cashier_id) where status='open'` + `(terminal_id) where status='open'`; `pos_shift_closes` (append-only snapshot + per-method tender aggregates + content hash); `pos_shift_late_adjustments` (DEC-08 append-only record of post-close arrivals); `invoices.pos_shift_id uuid null` (+FK; tenant-pinned insert trigger or command-enforced; **null stays the explicit 'not-a-POS-shift-sale' marker — zero backfill guesses**); commands `open_pos_shift_command / close_pos_shift_command / record_pos_cash_movement_command` (definer, atomic, caller==auth.uid identity binding, authority tiers, idempotency keys); replacement RLS: **revoke raw UPDATE on pos_shifts from app roles** (close path moves into command; read/insert policy reshaped so fabricated shifts impossible — insert only via command too).
- **Preconditions:** DEC-08 relativized (adjustment protocol), DEC-03 answer deferred or the DEC-03-blocked branch predicates ship **independent** of this migration (branch *stamping* validity server-side does not require DEC-03's per-table scope matrix); register approval for the exact table-vs-column choice for sale→shift linkage.
- **Postconditions:** no client can rewrite a signed close; one open shift per cashier+terminal; close snapshots provable against `invoice_payments`; history is tender-derived; R05–R07 records remain byte-identical; BRANCH.* remain BLOCKED (DEC-03-owned).
- **Old clients/queued sales (R09 seam):** older payloads may lack terminal/shift ids → policy: accept-with-warning vs reject must be decided with R09 (DEC-09 coexistence window); zero silent discard.
- **Historical data:** additive-only; nothing re-attributed; pre-R08 unlinked sales remain unlinked (visible, not guessed).
- **Evidence overlap:** `post_pos_sale` edit is the only R05–R07 intersection; verification plan re-runs the full release protocol twice (architecture baseline byte-diff).

## 11. Implementation sequence (proposal only — NOT started)

- **R08.1 Register sign-offs:** DEC-08 implementation shape (snapshot+adjustment rows), sale→shift linkage table-vs-column choice, old-payload policy (R09 seam), F15 settings-flags reconciliation (display-only vs wired contract). *(docs only)*
- **R08.2 Migration** (§10) + commands, RLS tightening, function-grants; release-layer tests ① single-open, ② close-atomic/idempotent/immutable, ③ movement atomic pair, ④ cross-cashier denials, ⑤ late-arrival adjustment.
- **R08.3 `post_pos_sale` link+validation edit** (server-resolved terminal/shift binding), ⑥ shift-link, ⑦ cross-branch denial; full release protocol re-run (byte-diff).
- **R08.4 History/close reporting queries** (`improved: repos.pos.listShiftSales` server command or restrictive select) replacing 30-row path; ⑧ channel, ⑨ projection, ⑩ Z-reconcile records.
- **R08.5 Client rewire:** PosPage branch/terminal from server session context; open/close/movement via commands; Z-report from close snapshot; delete fake email path (operator copy/print only until R14 owns dispatch), settings flags repaired per F15 decision; unit attack guards.
- **R08.6 R07 drawer seam:** close-time derivation consumes `pos_corrections`/tenders (R07 untouched); ⑬ refund drawer record.
- **R08.7 Regression stack + report + STOP** (counts frozen, repeat-diff, baseline byte-diff as in R07 protocol).
Each step: smallest-safe, independently rollable-back; rollback = feature-flag drawing stop + preserve immutable rows (never rewrite).

## 12. Risks

- Closing today's Z-report numbers as authoritative could bank **structurally wrong totals** (F9/F10 zeros; lost increments F5) into printed/audited artifacts.
- An employee can currently **re-close and alter a signed close** (F4) or edit another cashier's drawer (F6) — direct fraud surface.
- Wrong-branch stock/COGS resolution at scale (F8) silently corrupts R06-derived margins per branch.
- Late offline sales vanish from all drawer accounting (F12) — unexplained variance at audit time and premature shift-closing behavior (T-CANDID: T15 references).
- Register intentionally says High priority: delay keeps the till's signed documents non-substantiable.

## 13. Deferred/design decisions (register owner)

1. Terminal model minimum (device binding vs soft register) and policy for shared cashier stationary terminals (smooths into DEC-09 coexistence window).
2. DEC-08 implementation row: my proposal = new `pos_shift_late_adjustments` + close snapshots; sign-off needed.
3. DEC-03 (branch assignment) — R08 cannot single-handedly unblock the 8 BRANCH.* records; recommended as the very next decision (precedes R08.2 branch-predicate work, independent of the terminal work).
4. F15 settings flags: rebind to the R07 token policy (require-approval means "direct tier is void") or mark display-only/deprecated.
5. Z-report dispatch (email) — outside R08; recommend R14; interim = explicit non-dispatch UI.
6. Real branch configuration wizard (register action line 1) — onboarding UX owned by product; R08 consumes, does not invent.

## 14. Dependencies on other packages

- **R04:** tier helpers (`can_write_business_data`, `is_business_member`, `can_operate_pos`) — reused, not edited; BRANCH.* flip only after DEC-03.
- **R05/R06:** `post_pos_sale` edit + `_ledgr_stock_location` semantics; verification = byte-identical records; late-arrival tests must not race the stock trigger.
- **R07:** corrections ↔ drawer seam (derive-only; R07 files byte-static).
- **R09:** old offline payloads (missing terminal/shift ids) — coexistence window decision; queue replay tests must remain green.
- **R12-owned EDGE FAILs:** untouched. **R10/R11/R14/R15:** not touched.

## 15. Files/objects expected to change (implementation phase)

- New migration (§10); `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` function body edit (link+validation) under R05–R07 byte-guard; **new** R08 test family (`tests/release/r08-shifts.test.ts` + anchor additions) — additive; `src/dal/repositories/PosRepository.ts` (commands + scoping), `src/services/posReportService.ts` (tender-derived reporting), `src/pages/PosPage.tsx`, `src/components/pos/{PosShiftModal,PosCashMovementModal,PosZReportModal,PosOwnerAnalytics,PosSettingsModal}.tsx`, `src/hooks/usePosPermissions.ts` (consumption only), `src/types/pos.ts`; unit tests listed in §3.

## 16. Explicitly excluded (must not be touched)

`post_pos_sale` *redesign*, R06 stock mechanism, R07 command bodies/corrections tables, R04 tier helpers, R09 queue/cache files, R10 billing, R12 edge functions, the 2 R12 FAIL records, all existing release records' content (only additive/new records + gated BRANCH.* unblock after DEC-03), base finance schema beyond the additive `invoices.pos_shift_id`, configuration, production data.

## 17. Production-data status

All work described is local-synthetic (release harness + unit). No production data accessed or modified in discovery; migration is additive-by-design and leaves pre-R08 rows explicitly unlinked (no backfill guesses).

## 18. Recommended R08 authorization boundary

Authorize: R08.1 sign-offs → R08.2 → R08.3 → R08.4 → R08.5 → R08.6 → R08.7 as above, i.e. **server commands + immutable close/adjustment records + `post_pos_sale` linkage edit + positional client rewire + derived reporting**, with: R05–R07 anchors byte-preserved, release gate stays not-green (2 R12 FAILs exclusive), DEC-03/08 sign-offs captured in the change-impact register before schema lands, and additive-only data treatment.

Do **not** authorize in this boundary: DEC-03's branch enforcement matrix itself (separate decision), email dispatch (R14), offline queue changes (R09), any R07 body edits, any backfill/reconciliation of historical unlinked sales (R15).
