# Project-linked returns, wastage and damage — evidence-based design (not implemented)

**Date:** 2026-10-16 (Stage C review) · **Branch:** `arena/2faa03b4-ledgr-react` · **HEAD at review:** `92f64fa`
(after Stage A `545e3e1` and Stage B `92f64fa`) · **Status:** **design only — nothing in this document is implemented.** **Gate 0 for the Phase 1 baseline was
granted on 2026-10-16** by the owner decision recorded in
`docs/audits/LEDGR_CONSTRUCTION_RETURNS_PHASE1_OWNER_DECISION_2026-10-16.md`, which also answered §8 Q2, Q5, Q6
and Q7 and directed the corrections applied in §14. **Decisions A and B were confirmed on 2026-10-16** (the
movement label `construction_return_in`, and the approved Phase 1 costing policy — §7.1, §9.1, §14). Phases 2–4
remain unauthorised, and **Phase 1 implementation still requires a separate explicit instruction** (§10); the
staged plan is `CONSTRUCTION_RETURNS_PHASE1_IMPLEMENTATION_PLAN_2026-10-16.md`.

> **Supersedes the Stage-B draft of the same file.** That draft was written before a full trace of the ledger,
> and four of its statements are wrong (§3 lists them with the evidence). Everything still correct in it is
> preserved here; nothing was silently dropped.

**Related:** `CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md` (option C, implemented),
`CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` (§5b contains refusals this design must not contradict),
`LEDGR_CONSTRUCTION_UPGRADE_STAGE_A_2026-10-16.md`, `LEDGR_CONSTRUCTION_UPGRADE_STAGE_B_2026-10-16.md`,
`LEDGR_CONSTRUCTION_UPGRADE_PHASE1_BASELINE_2026-10-16.md`.

**Evidence class.** Every schema fact below was read from the **replayed** schema (embedded PostgreSQL,
R13 harness, `LEDGR_TEST_ENV=local`), not from migration text: `pg_enum`, `information_schema.columns`,
`pg_constraint`, `pg_index`, `pg_trigger`, `pg_policies`, `pg_class.relacl`, `pg_proc`. Every code fact carries
a file and line reference. **No production or shared database was contacted.** Where a statement is standard
or proposal rather than measurement it is labelled in the text.

---

## 1. Why this is design only, in one paragraph

Three of the four events in scope can only be recorded correctly if the business has first decided an
**accounting** question the repository has already, deliberately, refused to answer: what happens, in the
ledger, when accepted stock is derecognised for a reason other than sale. That refusal is not incidental — it
is written into `construction_receipt_posting_policies` as a `CHECK` (`gl_posting_enabled = false`), into the
decision matrix (§5b: "Releasing **accepted** stock back out (post-acceptance damage/shrinkage) … That is an
IAS 2 §28 write-down to net realisable value; no NRV policy is approved"), into the receipt command's refusal
token `accepted-release-unsupported`, and into `INV-CM-001`, which remains **proposed, not accepted**. A
site-level wastage or damage command is the *same* derecognition, one step later in the material's life. The
honest design is therefore not "here are three commands" but "here is which one can be built without an
accounting decision, and here is precisely what the other three are waiting for".

**Update 2026-10-16.** The owner has approved **this baseline for Phase 1 only**, with the corrections in §14,
and answered Q2/Q5/Q6/Q7. Usable returns still involve **no loss**, no expense policy and no journal: they can be
built from engineering evidence once implementation is separately instructed. Phases 2–4, and every accounting
question behind them, remain exactly as described below.

---

## 2. Verified current state

### 2.1 The stock ledger and its single writer

| Fact | Evidence |
| --- | --- |
| `stock_movements` columns are exactly: `business_id`, `created_at`, `created_by` (text), `id`, `location_id`, `movement_date`, `movement_type`, `notes`, `product_id`, `quantity`, `reference`, `source_id` (text), `source_type`, `total_cost` (generated), `unit_cost`, `client_key` (uuid, nullable) | replayed `information_schema.columns`; base table `20250101000000_base_schema.sql:1779-1809`, `client_key` added later |
| **There is no `branch_id` on `stock_movements`.** Branch is reached through `location_id → inventory_locations.branch_id` | replayed columns; `20260928000001_r06_stock_balance_authority.sql:69` |
| The ledger has a **per-business replay fence**: `stock_movements_client_key_uidx` = `UNIQUE (business_id, client_key)` | replayed `pg_index` |
| `authenticated`, `anon` and `service_role` hold **no explicit table privileges** on `stock_movements` (`relacl` = `postgres=arwdDxtm/postgres`); RLS policies exist (`stock_movements_member_read` = `is_business_member(business_id) AND can_access_location(business_id, location_id)`) but no grant | replayed `pg_class.relacl`, `pg_policies` |
| One trigger maintains the balance: `trg_stock_movement_apply_balance` → `_ledgr_apply_stock_movement_balance()`, `AFTER INSERT OR UPDATE OR DELETE` | replayed `pg_trigger`; `20260928000001:222` |
| A second trigger enforces the open period: `trg_aa_period_lock` → `_ledgr_period_guard('movement_date','Stock movement')` | replayed `pg_trigger`; `20261014000000_period_lock_and_invoice_approval.sql` |
| The balance writer applies the **signed** quantity to one `inventory_balances` row per (business, product, location) and updates the weighted average **only on a costed inbound**: `if quantity > 0 and unit_cost > 0 and new_on_hand > 0 then new_avg := (old_qty*old_avg + qty*unit_cost)/new_on_hand else keep old_avg` | `20260928000001_r06_stock_balance_authority.sql:139-155` |
| Negative stock is impossible: `chk_inventory_balances_on_hand_nonneg CHECK (quantity_on_hand >= 0)` (SQLSTATE 23514) | replayed `pg_constraint`; `20260817000001_phase10_nonneg_quantity_checks.sql` |

**Consequence 1 (a correction — see §3).** Because the writer re-prices the pool on *any* costed inbound, a
return recorded at the original issue cost **does** change the pool's weighted average whenever the pool has
moved since. The Stage-B draft asserted the opposite ("so the issue/return pair is value-neutral"). The
existing R07 void path does exactly this restock-at-original-cost (`20260928000002_r07_correction_commands.sql:395-405`),
so the behaviour is a deliberate precedent — and it is now a **decided** treatment, not a neutral one: the owner
decision of 2026-10-16 (items 1–2, §14) records the return at the original issue cost, accepts that the pool
re-prices, and requires the effect to be tested and documented.

### 2.2 Movement types: what exists versus what is used

Enum `stock_movement_type`, in creation order (`pg_enum`): `purchase`, `sale`, `adjustment_in`,
`adjustment_out`, `transfer_in`, `transfer_out`, `return_in`, `return_out`, `opening_balance`, `write_off`,
then `issue_out` added by `20261020500000_stock_movement_type_construction_issue.sql`.

| Token | Used by a server command? | Where |
| --- | --- | --- |
| `purchase` | Yes | construction receipt posting `20261021000000:3615`; stock receipt `20261012000000:601`; `WarehousePage.tsx:602` path; `ExpensesPage.tsx:159` supplier-bill path |
| `issue_out` | Yes — **only** | `issue_construction_materials_to_project` (`20261021000000:3792`); confirmed by function-body search (one function references it) |
| `return_in` | Yes | R07 void/refund restock (`20260928000002:400`, `:572`), POS paths (`20261014000001:118,290`, `20261016000000:776`) |
| `sale`, `purchase` | Yes | POS / quick-sale commands |
| `transfer_out` / `transfer_in` | **No server command** | written client-side by `src/dal/repositories/TransferRepository.ts:139,~208` |
| `adjustment_in` / `adjustment_out` / `opening_balance` | Yes | `record_inventory_journal_movement` (`20261012000000:551`), used by `ProductsPage.tsx:749` and `WarehousePage.tsx:602` |
| **`write_off`** | **No — the label exists and is unused** | enum only; the only other mention is the comment in `20261020500000` |
| **`return_out`** | **No** | enum only; the single code mention is a client-side sign heuristic, `src/services/inventoryJournalService.ts:802-804` |

So the Stage-B draft's framing ("the enum carries only `issue_out` for construction; a return, a wastage
write-off and a damage write-off must not share one token") was **half right**: three *distinct* tokens are not
missing — `return_in`, `return_out` and `write_off` already exist. What is missing is a construction command
that uses them, and any evidence that their intended semantics match a site return or a site write-off.

### 2.3 The issue path (the source document for a return)

`issue_construction_materials_to_project(p_payload jsonb, p_client_key uuid)` —
`20261021000000_construction_procurement_traceability.sql:3689-3812`, `SECURITY DEFINER`:

1. `_ledgr_construction_actor(v_business,'procurement.material.issue')` — auth.uid + active `business_users`
   row + capability (`:3654-3685`).
2. **Idempotency first**: replay of the same `client_key` returns the existing issue id with
   `idempotent: true` **before** any scope check (`:3722-3724`).
3. Scope is **derived, never supplied**: `_ledgr_construction_site()` resolves the registered site and refuses
   an inactive one with `22023`; `can_access_branch` and `can_access_location` refuse with `42501`
   (`:3727-3736`).
4. Product must belong to the business (`42501`); UOM must resolve through an **explicit** registered
   conversion (`_ledgr_construction_to_base`, `:3662-3700`).
5. The posting policy must exist and have `movement_posting_enabled`; `gl_posting_enabled` **must be false**
   (two explicit refusals, `:3748-3755`); the period must be open (`_ledgr_assert_period_open`).
6. The pool row is locked `FOR UPDATE`; issue is refused if `on_hand < base` (`insufficient-stock`) or if
   `average_cost <= 0` (`issue-cost-unknown`) (`:3760-3770`).
7. **One** `stock_movements` row: `movement_type 'issue_out'`, `quantity = -base`, `unit_cost = pool average`,
   `source_type 'construction_issue'`, `source_id = issue id` (`:3792-3797`).
8. One append-only `construction_material_issues` row carrying `site_id, branch_id, location_id, project_ref,
   product_id, uom, quantity, quantity_base, unit_cost_base, total_cost_base, currency, issue_date, issued_to,
   evidence_reference, stock_movement_id, issued_by, client_key`; `CHECK (quantity > 0 and quantity_base > 0)`,
   `CHECK (unit_cost_base > 0 and total_cost_base > 0)`, evidence and project-ref presence checks, and
   `UNIQUE (business_id, client_key)` (`:3770-3810`; replayed constraints confirm `chk_cmi_unique_client`).
9. Returns `journal_effect: 'none'` — **no journal entry is written**, by design (`:3812`).

The command is also where the **only** construction stock writer lives; the receipt command writes the other
one, and both leave the balance to the shared R06 trigger.

### 2.4 Receipts, transfers, and the local-only draft

- **Receipts** — `post_construction_receipt_movement(grn_id)`: locks nothing but posts one `purchase`
  movement **per accepted-but-unposted delta** at the weighted average of the matched cost bases, then
  advances `quantity_posted_base` under the `receipt_post` append-only marker (`:3596-3630`). No GL.
- **Real transfers** — `stock_transfers` / `stock_transfer_lines` exist (base schema), and
  `TransferRepository.dispatch` / `confirmReceipt` write `transfer_out` / `transfer_in` at line `unit_cost`
  through `InventoryRepository.recordMovements`, which upserts on `(business_id, client_key)`
  (`TransferRepository.ts:110-230`, `InventoryRepository.ts:235-270`). This is a **client-side** write path
  against RLS (`stock_movements_writer_insert`), not a `SECURITY DEFINER` command, and it writes **no**
  journal.
- **Construction store-to-site transfer preparation** — `src/lib/construction/materialTransferPreparation.ts`
  and `src/components/construction/MaterialTransferPreparationSection.tsx` are a **local draft with no
  persistence**: its own header states "contains no inventory mutation, location IDs, valuation, accounting,
  or server authorization fields. Its stage labels are not a transfer approval or a stock-ledger status."
  Its stages (`draft → prepared → dispatch_noted → receipt_noted`) are UI labels only. **There is no
  server-side construction transfer command.**
- **Supplier bills** — `ExpensesPage.tsx` writes `purchase` movements for tracked products when a bill is
  recorded (`:159`, with `source_type 'expense'`), deliberately skipping on lookup failure rather than
  blocking the bill (`:120-130`).

### 2.5 Project material cost — a derived figure, not a stored balance

`construction_project_material_cost(p_business_id uuid)` (`20261021000000:3818`, re-created with a branch
filter by `20261023000000_construction_branch_scope.sql:269`) returns `project_ref, issue_count,
quantity_base, material_cost, currency, first_issue_date, last_issue_date` by **summing the append-only issue
register** per `project_ref`. The table comment says so explicitly: "Project material cost is derived from
these rows (sum by project_ref); there is no second stored cost balance and no GL entry."

**Consequence 2.** A usable-material return must therefore reduce a *derived* figure, which means the
derivation query itself has to change (net of returns), and every consumer of it must agree on that: the RPC
plus the two workspace sections that call it (`ConstructionMaterialIssuesSection.tsx:66`,
`ConstructionOverviewSection.tsx:41`, through `ConstructionProcurementRepository.ts:828`). There is **no report
or export consumer today** (verified 2026-10-16; §14 D5). A return that only moved stock would leave project
cost overstated for ever.

### 2.6 Evidence, authorisation, audit and idempotency

| Mechanism | Verified position |
| --- | --- |
| Capability gate | 11 codes in `construction_procurement_capabilities` (replayed): `procurement.{master.manage, po.manage, po.authorize, delivery_note.record, grn.record, receipt.inspect, exception.authorize, bill.match, receipt.post, policy.approve, material.issue}`. **No return, wastage or damage capability exists.** |
| Actor resolution | `_ledgr_construction_actor` raises `42501` for anonymous, non-member, or capability-less callers (`:3654-3685`) |
| Mandatory evidence | `_ledgr_construction_reason_present()` backs `CHECK` constraints on every evidence/reason column |
| Append-only audit | `trg_construction_append_only` on **17** construction tables (replayed), and `_ledgr_construction_append_only()` raises `42501` on UPDATE/DELETE unless the transaction-local marker `ledgr.construction_command` matches one of the table's allowed tokens. Only 8 commands ever set that marker: `approve_construction_receipt_posting_policy`, `authorize_construction_purchase_order`, `cancel_construction_purchase_order`, `post_construction_receipt_movement`, `reclassify_construction_receipt_line`, `register_construction_procurement_site`, `register_construction_product_uom_conversion`, `revoke_construction_procurement_capability` (replayed function-body search). `construction_material_issues` allows **no** token — issues are immutable, full stop. |
| Idempotency | Per-command `client_key` + `UNIQUE (business_id, client_key)` on the document table; the ledger adds its own `(business_id, client_key)` fence; `record_inventory_journal_movement` additionally takes a transaction advisory lock on the business, source type and key tuple **before** the replay check (`20261012000000:614`) |
| Period lock | `_ledgr_assert_period_open` refuses with `period-closed` and tells the user to "record the correction in an open period (credit note, reversing journal or stock adjustment)" (`20261014000000:78-90`) |
| Branch scope on reads | Stage A: 14 unconditional + 1 conditional + 4 branchless construction tables (`20261023000000_construction_branch_scope.sql`) |

### 2.7 Reversal and correction capability **today**

There is **no** construction reversal or correction command of any kind. The only reversal machinery in the
repository is the R07 POS correction surface, and it is worth reading as the precedent because it already
solves the problems this design faces:

| R07 element | Evidence | Why it matters here |
| --- | --- | --- |
| Server-minted, single-document, single-action, single-use, expiring approval token | `pos_approvals` + `request_pos_approval` / `authorize_pos_approval` / `_ledgr_consume_pos_approval` (`20260928000002:70-250`) | The pattern to copy for "blocked until an authorised person approves" |
| Append-only correction record with replay fence | `pos_corrections` (`:70-88`): `command_key`, `command_type` whitelist, `approval_id`, `reason`, `created_by`, `UNIQUE (business_id, command_key)` | How a correction should be recorded rather than by editing history |
| Void mirrors every posted journal and restocks via `return_in` at **original** unit cost | `:395-405` | Precedent for original-cost restock — and, per §2.1, proof that the pool re-prices |
| Cumulative refunds bounded server-side under the document row lock | `:425` ff. | The template for "never over-return" |
| Zero mutation on reject; rejected operations raise before any write | header contract, `:24-30` | Non-negotiable for the new commands |

**Two hard limits of the R07 mechanism, verified, that a construction design must not overlook:**
`pos_approvals.action` is `CHECK (action in ('void_sale','refund_sale'))` and
`pos_approvals.document_id` is `uuid NOT NULL REFERENCES public.invoices(id)`. It therefore **cannot** hold a
construction approval without a schema change. Reuse requires either widening both (a change to a live
approval table used by the POS correction path) or a separate, construction-specific approval table.

### 2.8 Existing valuation, write-down and GL logic that constrains this design

| Existing behaviour | Evidence | Consequence for returns/wastage/damage |
| --- | --- | --- |
| Construction consumption posts **no** journal; `gl_posting_enabled` is forced `false` by `CHECK ((gl_posting_enabled = false))` | replayed `chk_crpp_gl`; `20261021000000:3148-3158` | Wastage/damage cannot post an expense today, and enabling it is a separate approved accounting design — not a by-product of this feature |
| The general inventory adjustment command **does** post: `adjustment_out` → DR 5180 "Inventory Adjustments & Shrinkage" / CR inventory; `receipt` → DR inventory / CR 2114 | `20261012000000:651-690`; accounts created `20260728000005:24-86`; account meta `20260815000000:296` (`5180` = expense / cost_of_sales) | A shrinkage account already exists for **general stock**, but routing *construction project* consumption or loss into 5180 is a policy choice with project-cost consequences (§6, §8 Q3) |
| The legacy client GL rule derives the side from the movement type: `isStockIn = movementType !== 'adjustment_out' && !== 'transfer_out' && !== 'return_out'` | `src/services/inventoryJournalService.ts:802-804` | **A new token would silently be treated as a stock-*in*** by that client rule (DR inventory / CR 5180). `issue_out` is not excluded either. Any client-side GL path must be extended with the new tokens, or the new commands must be server-side and journal-free like the issue command. |
| Post-acceptance write-outs are **refused** today: `accepted-release-unsupported`; the decision matrix records the reason and what would unblock it | `20261021000000:2530-2560` (reclassification refusal); matrix §5b; `INV-CM-001` **proposed** | Site wastage/damage of accepted material is the same derecognition. Implement it and the repository contradicts its own approved refusal unless an NRV policy lands first. |
| Supplier returns of accepted goods are refused pending a supplier-credit-note document | matrix §5b; owner decision recorded there | Out of scope here; a *customer-facing* return of material is a different event and is not proposed at all |
| `cancel_construction_purchase_order` tells the user to "Record a return or a correction instead" | `20261021000000:1270` | A forward reference to machinery that does not exist. If Phase 1 lands, update this message to name the command; until then it stays a gap. |

### 2.9 Branch and business isolation (Stage A, already implemented)

`can_access_branch` / `can_access_location` gate the issue command (`:3727-3736`), and Stage A branch-scoped
the read surface, so a site's issue register, holds and cost bases are already invisible outside the caller's
branches (`20261023000000_construction_branch_scope.sql`; `tests/release/construction-branch-scope.test.ts`,
12 rows). Any new command must inherit both rules rather than invent a third.

### 2.10 Existing test coverage (what a new suite must not duplicate)

`tests/release/construction-procurement.test.ts` — 17 rows, including `CP.ISSUE.PROJECT-COST` (policy gate,
site scope, UOM conversion, open period, available stock, known pool cost, one outbound movement, derived
project cost, no GL), `CP.INSPECT.QUALITY-RELEASE` (rejected- and accepted-release refusals), cost derivation
`CP.COST.IAS2-DERIVATION`, FX `CP.COST.IAS21-TRANSACTION-DATE-RATE`, idempotency and true two-connection
concurrency, and rollback atomicity. `tests/release/construction-branch-scope.test.ts` — 12 `CPB.*` rows.

---

## 3. Corrections to the earlier draft of this document

Not silently overwritten; each is listed with what changed and why. The earlier draft's *shared requirements*
table (§1) and its core insight (§0: the accounting question blocks implementation) survive nearly intact and
are carried forward.

| # | Stage-B draft said | Verified position | Effect |
| --- | --- | --- | --- |
| 1 | "The enum carries `issue_out` for construction issues… a return, a wastage write-off and a damage write-off are three different stock events and **must not share one token**." | `return_in`, `return_out` and `write_off` **already exist** in the enum and, apart from `return_in` (used by POS restock), **no server command uses them** (§2.2). | The gap is *no construction command*, not *no token*. Token choice is a design decision with an existing-label option, not a blank sheet. |
| 2 | Return "at the original issue's `average_cost` … so the issue/return pair is **value-neutral**." | The balance writer re-prices the pool on any costed inbound (§2.1), so a return at original cost **changes** the pool average when it has moved. | **Decided 2026-10-16 (§14):** the return is recorded at the original issue cost and the pool re-prices by design; the effect must be tested (T12) and documented, with **no balancing entry and no GL posting**. §8 Q2 answered. |
| 3 | Damage workflow uses a hold of type `'damaged'`. | `chk_cgrh_type check (hold_type in ('rejected','quarantined','disputed'))` — `'damaged'` is **not** a permitted hold type (`:1779`). | A damage hold needs either a new hold type or a different mechanism; both are schema changes requiring approval. |
| 4 | No mention of the existing refusal of post-acceptance write-outs, `INV-CM-001`, or `5180`. | The repo already refuses accepted-stock release as an IAS 2 §28 write-down pending an NRV policy, and already has a shrinkage account for general stock (§2.8). | The staging in §10 changes completely: wastage/damage are *accounting-policy* work, not engineering work. |
| 5 | "a wastage/damage record may never exceed what the site holds" (stated as the guard). | True, but incomplete in the other direction: the site store balance holds **unissued** receipt stock and, once material has been issued, it no longer records that material at all — the issue reduced it. | The enforceable custody limit is against the **source issue**, not the store balance. Corrected 2026-10-16 — §14 D1. |

---

## 4. The four business events

Shared vocabulary. **Site store** = the `inventory_locations` row registered on
`construction_procurement_sites.location_id`. **Project** = the site's `project_ref` (text, §2.5).
**Source issue** = the `construction_material_issues` row that moved the material. Events 2–4 remain
proposals; Event 1's decided elements are marked **Decided 2026-10-16**, and **nothing below is implemented**.

### Event 1 — Usable material return (material goes back to the store, in usable condition)

| Aspect | Design |
| --- | --- |
| Business meaning | The material never left the business's control and is still fit for use elsewhere. **No loss has occurred**, so no expense arises and the project's cost must fall by the returned value. |
| Who initiates | **Decided 2026-10-16 (decision §4):** the holder of the dedicated **`procurement.material.return`** capability at the branch the material returns to. The catalogue gains one code (§9.5); `procurement.material.issue` alone does not authorise a return. |
| Who approves | **Decided 2026-10-16 (decision §7):** **no second-person approval in Phase 1**, at any value. Authority is the `procurement.material.return` capability plus a mandatory reason and evidence. A separate approval workflow (threshold, second actor) is future work and part of no authorised phase. |
| Who reverses | Nobody may edit a return. A mistake is corrected by an **opposite return record** (a re-issue of the same material to the same project, referencing the return) created by the same capability as a **new** record — the original return row is never edited or deleted — with **no approval tier in Phase 1** (decision §7). Both rows stay visible. |
| Required fields | `business_id`, `site_id` (derived from the source issue — never supplied), `source_issue_id` (**required**), `product_id` and `uom` (must match the source issue), `quantity` (> 0, in the source issue's UOM) and `quantity_base` **derived from the source issue's recorded ratio** (`source_issue.quantity_base / source_issue.quantity`) — decision §3, never re-resolved from the mutable conversion table (§14 D2) —, `return_date`, `condition` (a required controlled value: `usable` / `usable_with_restriction`), `reason` (required, non-empty), `evidence_reference` (required, non-empty), `received_by`, `location_id` = the **source issue's** location (derived), `notes`, `client_key`. The applied cost is **read from the source issue**, never supplied. |
| Movement | Exactly **one** `stock_movements` row: positive `quantity_base` at `location_id` = the source issue's location, `unit_cost` = the source issue's `unit_cost_base` (**decided 2026-10-16, decision §1–2**), `source_type` = `'construction_return'`, `source_id` = the return id, `movement_type` = the new label proposed in §9.1 (the decision fixed the effect but not the label — §14 D4). |
| Project cost | **Decided 2026-10-16 (decision §5):** net valid returns against issued quantity and cost — `quantity_base` and `material_cost` become `Σ issues − Σ returns` for the project — while `issue_count` stays the count of issue records. The RPC's **signature is preserved** and no `return_count` column is added; return detail is presented from the returns register / workspace. |
| Duplicate prevention | `UNIQUE (business_id, client_key)` on the returns table; the same `client_key` replayed returns the committed row with `idempotent: true`; `stock_movements_client_key_uidx` is the second fence. |
| Negative stock / over-return prevention | (a) **the enforceable bound**: cumulative returns ≤ the source issue's recorded `quantity_base`, evaluated under a `SELECT … FOR UPDATE` lock on the source issue row (the R07 cumulative-refund pattern, `20260928000002:284`, `:490-502`); (b) the inbound cannot drive the destination balance negative, and `chk_inventory_balances_on_hand_nonneg` (`20260817000001:49-50`) bites on outbound movements — the earlier "the destination pool must have the physical stock" requirement is **withdrawn** on 2026-10-16 (§14 D1); (c) the source issue must belong to the same business, the same site and a branch the caller can access (**`42501` otherwise**), and its `issue_date` must be **on or before** the return date. |
| Branch / project allocation | Branch, site, location and `project_ref` are **derived from the source issue**, so a caller cannot attribute a return to a project it did not come from. |
| Partial returns | Explicitly supported: `quantity < remaining`, repeatable, each return its own row and its own movement. |
| Previously consumed material | **Corrected 2026-10-16 (§14 D1):** the ledger cannot distinguish material still usable on site from material consumed or lost — issuing removed it from the balance. The enforceable refusal is therefore "already returned" (the cumulative bound above), not "already consumed"; distinguishing the two would need a site-level custody register, which is **not** Phase 1. |
| Material already transferred or re-issued | A return names **one** source issue and returns to **that issue's** location. If material issued to project A is physically moved to project B, that is a **transfer**, not a return, and this design refuses it (there is no server-side construction transfer command — §2.4). Cross-site returns are out of scope (§8 Q7). |
| Untraceable material | **Refused** (`22023`, "traceable-to-issue-required"): every issue is recorded by an append-only command, so a traceable return is always possible and an untraceable one signals a problem worth surfacing. The alternative treatment (stock-in at the pool's current average with no project-cost relief, flagged for accountant review) is described in §9.6 as a deliberate non-default. |
| Audit | The return row is append-only with **no** allowed marker token (like `construction_material_issues`); the movement carries `source_type`/`source_id` back to it; the correction is a new opposite row; the return records `received_by` and the acting holder of the `procurement.material.return` capability, and there is **no approval reference in Phase 1** (decision §7). |
| Blocked until approval | **Nothing in Phase 1** (decision §7). Every refusal — capability, scope, business, cumulative bound, period, posting policy, evidence or reason — raises before any write, so a rejected command leaves no row and no movement. |

### Event 2 — Normal wastage (expected, unavoidable loss during normal construction)

| Aspect | Design |
| --- | --- |
| Business meaning | Recognised in the cost of the work. Under the applicable inventory standard the **normal** level of loss in a normal production process is part of the cost of conversion/consumption (IAS 2 §12–13, §16(a) contrast). It is *not* naturally an abnormal-waste expense. |
| Who initiates | `procurement.material.issue` holder at the site's branch (the person who saw it happen). |
| Who approves | Proposed: a threshold-based second approval (`procurement.exception.authorize`), because repetition is the signal worth controlling. No approval for small routine quantities. |
| Reversal | Append-only; a correction is a new opposite/companion record. **No deletion.** |
| Fields | `site_id` (derived), `source_issue_id` (**required** in this design — see "untraceable" below), product, uom, `quantity`/`quantity_base`, `wastage_date`, `reason_category` (`handling` / `cutting` / `spillage` / `breakage_in_use` / `other`), `reason` (required), `evidence_reference` (required), `notes`, `client_key`, `classification` = `normal` with **the basis for that classification recorded** (who classified it and why — this is the auditor's evidence that "normal" was a judgement, not a convenience). |
| Movement | One outbound movement at the site store (negative `quantity_base`, `unit_cost` = current pool average, new `source_type`, proposal token §5). |
| Project cost | **Stays in project cost.** No GL posting today; the movement is stock-only, exactly like an issue. The project-cost derivation must include it (or not net it off), so that "material cost of project P" = issues − usable returns, and wastage remains part of it. |
| Duplicate / negative / allocation guards | As Event 1 (cumulative limit against the **issue line** under a `FOR UPDATE` lock — the store balance is not a bound, §14 D1; derived scope, `client_key`). |
| Already consumed / transferred | Corrected with Event 1 (§14 D1): the ledger cannot prove what the site still holds; the enforceable refusal is "already returned" on the source issue. |
| Blocked until approval | Above-threshold quantities, and **any** command at all until the wastage policy in §8 Q3 is answered — because the *classification* of normal wastage as project cost must be an approved policy, not a default. |

### Event 3 — Abnormal wastage or avoidable damage (requires investigation, potentially separate expense)

| Aspect | Design |
| --- | --- |
| Business meaning | Loss **outside** normal expectations. The applicable standard explicitly excludes abnormal amounts of wasted materials from the cost of inventories and requires them to be recognised as an expense in the period incurred (IAS 2 §16(a); the same exclusion reappears in the statement of what the period's expense comprises — cited in this repository as §34). It must **not** be capitalised into the project or the inventory. |
| Who initiates | Site/procurement staff with `procurement.material.issue`. |
| Who approves | A second, senior actor: proposed `procurement.policy.approve`-tier (owner/admin) or `procurement.exception.authorize` with a **mandatory investigation reference**. No self-approval (the actor who raises it may not authorise it — mirroring the four-eyes PO rule, `CP.*` already asserts that pattern). |
| Reversal | Append-only; a **decision reversal** (e.g. investigation concludes it was normal) is recorded as a new classification record referencing the original, never an edit. |
| Fields | As Event 2, plus: `classification = abnormal`, `investigation_reference` (required for abnormal), `responsible_party`/`cause_code`, and an explicit `expense_treatment_decision` reference to the approved policy that permits the financial effect. |
| Movement | One outbound movement at the site store (stock effect identical to Event 2). |
| Project cost | **Removed from project cost** — i.e. the project-cost derivation must net abnormal losses off (otherwise the loss is quietly capitalised into the project, the exact treatment §16(a) forbids). Today, with GL disabled, that means: stock leaves, project cost falls, and **no** journal is written — leaving the loss visible in reports but absent from the ledger. That gap must be stated in the report, not hidden. |
| Financial effect | **Proposal, not decision:** a journal DR 5180 Inventory Adjustments & Shrinkage / CR inventory at the pool's average cost (the account the general-inventory adjustment path already uses). It requires the owner to approve the account mapping and the accountant to confirm that 5180 is the right classification for *construction project* loss rather than a project/contract cost account. Until then: **stock-only, journal_effect 'none', `gl_posting_enabled` stays forced false.** |
| Blocked until approval | Everything except recording the physical facts. The command must not be built until §8 Q3 is answered, because building it invites the assumption that "abnormal → 5180" is approved. |

### Event 4 — Damaged but recoverable material

| Aspect | Design |
| --- | --- |
| Business meaning | The material still has value — possibly its full cost (usable with a restriction), possibly less (recoverable value below cost, e.g. downgraded to a lower grade, scrap value, or reusable offcut). This is where the **lower of cost and net realisable value** rule bites (IAS 2 §9, §28: "the cost of inventories may not be recoverable if those inventories are **damaged**…"). |
| Who initiates | Site store holder with `procurement.material.issue`; the **assessment** (which outcome) is a separate act. |
| Who approves | The assessment must be made and signed by a different person holding `procurement.receipt.inspect` (the existing quality/inspection capability — the closest existing authority to "judge the condition and quantity of material"). |
| Three permitted outcomes | (a) **Usable** → treated exactly as Event 1 (return to store, project cost falls, no loss). (b) **Usable with a restriction** → return to store with a recorded condition, no write-down *if* the material's carrying amount remains recoverable (§ Event 1). (c) **Recoverable value below cost** → a **write-down to NRV** is required; this is precisely what `INV-CM-001` and the matrix's §5b refusal say cannot be done yet, because **no NRV measurement policy is approved**. The design therefore permits (a) and (b) to be *designed* now and **blocks** (c). |
| Fields | As Event 1, plus `condition_outcome` (`usable` / `usable_with_restriction` / `recoverable_below_cost`), `assessed_by` (≠ initiating actor), `assessment_date`, `damage_description`, `evidence_reference` (photo/report, required), and for (c) a required `nrv_basis_reference` that can only exist once a policy is approved. |
| Movement | (a) and (b): the Event 1 inbound movement. (c): a **write-down** — and note a write-down in this ledger is not a quantity movement unless quantity is destroyed/scrapped: reducing carrying amount without quantity is **not representable** in `stock_movements` (which carries quantity + unit cost, and the balance writer only re-prices on costed inbound). That is a genuine, verified structural gap (§9.5). |
| Reserved / held material | If the material is damaged and awaiting a decision, it must be excluded from available stock. The receipt side solves this with `construction_goods_receipt_holds` — but that table's `hold_type` does not admit `'damaged'` (§3 item 3), and it hangs off a **receipt line**, not a site store balance. A site-store hold needs its own mechanism. |
| Blocked until approval | Outcome (c) entirely; the damage-hold mechanism; and any treatment that changes carrying amount without changing quantity. |

---

## 5. Workflow comparison table

Legend: **designed now** = buildable without a new accounting decision; **gated** = cannot be built before the
named decision; **N/A** = deliberately out of scope.

| | Event 1 — usable return | Event 2 — normal wastage | Event 3 — abnormal wastage / avoidable damage | Event 4 — damaged, recoverable |
| --- | --- | --- | --- | --- |
| Loss recognised? | No loss | Loss inside normal project cost | Loss excluded from cost; expense in period | Possibly a write-down to NRV |
| Initiator | `material.return` holder, original issuing site store | `material.issue` holder, site branch | `material.issue` holder | `material.issue` holder (custody) |
| Approver | **None in Phase 1** (decision §7) | None below threshold; else `exception.authorize` | Mandatory second actor + investigation reference | Assessment by a different person with `receipt.inspect` |
| Reversible by edit? | No — opposite record | No — opposite record | No — new classification record | No — new assessment record |
| Quantity bounds | Σreturns ≤ Σissued per source issue; plus site-store availability | Against source issue **and** site-store balance | Same | Same |
| Stock movement | **+qty** inbound at source issue's location, at source issue's unit cost (proposal) | **−qty** outbound at pool average | **−qty** outbound at pool average | (a)/(b): +qty inbound; (c): write-down, **not representable today** |
| New token needed? | Proposal: `construction_return` + reuse `return_in` **or** a new token (§9.1) | Yes — proposal `wastage_out` | Yes — proposal `wastage_out` + classification, or a distinct token | Reuses Event 1, plus a write-down mechanism that does not exist |
| Project cost | **Decreases** (derivation nets returns) | **Unchanged** (stays in project cost) | **Decreases** (excluded from project cost) | (a)/(b) decreases; (c) decreases *and* an NRV loss arises |
| Journal today | None (`gl_posting_enabled` false) | None | None — **gap**: the loss is reported but unposted | None — **gap** |
| Journal once approved | n/a (no expense) | n/a | DR 5180 / CR inventory (proposal; needs owner + accountant) | DR 5180 / CR inventory for the write-down (proposal) |
| Evidence required | reason + condition + evidence ref | category + reason + evidence ref + classification basis | + investigation ref + cause | + assessment by second person + damage evidence (+ NRV basis once a policy exists) |
| Buildable now? | **Yes — designed now** (Phase 1) | **Gated** on §8 Q3 | **Gated** on §8 Q3 **and** an investigation/authority decision | (a)/(b) gated on Q3; (c) **gated** on an approved NRV policy |
| Out of scope | Cross-site returns (no transfer command) | — | — | Any write-down without quantity (structural gap, §9.5) |

---

## 6. Proposed stock and accounting effects — **proposals, not decisions**

Everything in this section is a product-design proposal. The only parts that are *not* proposals are the
verification results in §2 and the standard's requirements quoted in §7.

| Event | Stock effect (proposal) | Accounting effect (proposal) | Approval needed |
| --- | --- | --- | --- |
| 1 — usable return | One positive movement, `unit_cost` = source issue's `unit_cost_base`, at the source issue's location; the pool average re-prices per §2.1 (**decided 2026-10-16**) | **Decided 2026-10-16 (decision §1–2, §5):** no entry from the return itself; project cost falls by `quantity_base × unit_cost_base` through the derivation; the pool's re-pricing must be tested (T12) and documented; **no balancing entry and no GL posting** | **None** in Phase 1 (decision §7) |
| 2 — normal wastage | One negative movement at pool average | None. Remains in project cost | Classification policy (§8 Q3) |
| 3 — abnormal wastage | One negative movement at pool average | **Excluded from project cost**; expense in the period. Proposed account 5180 (the only shrinkage account that exists) | Owner + accountant (§8 Q3) |
| 4 — damaged, recoverable | (a)/(b) positive movement as Event 1; (c) write-down | (a)/(b) as Event 1; (c) NRV write-down, reversal of write-down limited to the original write-down | NRV policy (§8 Q4) |

**Two structural facts about the ledger that constrain any accounting effect:**

1. `stock_movements` has **no branch column** and **no journal link**; the only GL switch that could carry an
   amount for these events is the general-inventory command, which is a different (and separately authorised)
   write path.
2. `stock_movements.quantity` is signed and `unit_cost` is a single rate per row, so the ledger can express
   *quantity-moving* events and *costed inbound* re-pricing, but **not** "reduce carrying amount without
   moving quantity". A pure NRV write-down of material still physically present has no representation. That is
   a design gap to be solved by the accounting design (§9.5), not by a token.

---

## 7. Accounting research: authoritative guidance, product design, and accountant decisions

**Framework caveat first.** IAS 2 applies to *inventories*. Whether it is the operative standard for material
consumed on a construction project depends on facts this repository cannot determine:

- **Materials before consumption** — held as materials to be consumed: within IAS 2 (**§6(c)**: inventories
  include assets "in the form of materials or supplies to be consumed in the production process or in the
  rendering of services"). The repository's issue command already relies on this (**§6(c)**, and cites
  **§34** for recognising the carrying amount as an expense).
- **Material installed in an asset the entity will control** (own-use construction) — the cost may belong to
  an asset under IAS 16 / IAS 40, not to inventory expense.
- **Material consumed on a customer contract** — IAS 2 **§8** ends: "Costs incurred to fulfil a contract with
  a customer that do not give rise to inventories (or assets within the scope of another Standard) are
  accounted for in accordance with IFRS 15 *Revenue from Contracts with Customers*." IFRS 15 **§95** then
  permits a contract-cost asset only if the costs meet **all** of (a) relate directly to an identifiable
  contract, (b) "generate or enhance resources of the entity that will be used in satisfying (or in
  continuing to satisfy) performance obligations in the future", and (c) are expected to be recovered. The
  IFRS Interpretations Committee's March 2019 agenda decision on that paragraph concluded that costs incurred
  **satisfying a current performance obligation** — e.g. construction work transferring to the customer as the
  building is built — fail §95(b) and are expensed (see Sources). **This is the single highest-impact open
  question for construction accounting in this repo (§8 Q1).**

### 7.1 Ledgr's approved Phase 1 costing policy (owner decision B, 2026-10-16)

**Approved policy — an internal Ledgr policy, not a statement of what a standard mandates.** Each return
references its identifiable original construction issue; the returned quantity reduces the project's net material
cost at the **original issue's recorded unit cost**; the returned material enters the **existing moving
weighted-average pool**, whose average cost recalculates under the existing inventory valuation mechanism; and
**no artificial balancing entry and no general-ledger posting** is introduced in Phase 1. The pool-recalculation
effect must be **tested and documented**, including its impact on subsequent issues to other projects
(§8 Q2, §9.1, T12, T17).

**What the standards do and do not say, stated precisely:**

- **§25** permits a weighted-average (or FIFO) cost formula for ordinarily interchangeable items — it does not
  prescribe what happens when previously issued material is returned to the pool. Re-pricing the pool at the
  original issue cost is a Ledgr policy choice, not an IAS 2 requirement.
- **§23** requires specific identification for items that are not ordinarily interchangeable and for goods or
  services **produced and segregated for specific projects**. Whether that reaches material merely held at, or
  issued to, a construction site is a facts-and-circumstances question this repository cannot settle (§8 Q8).
- Consequently this design **does not claim** IAS 2 mandates the hybrid treatment. The approved policy stands as
  the owner's decision, and **accountant confirmation of its suitability for the entity's financial reporting is
  an external accounting validation** (decision record §7, "External accounting validation"). Such confirmation
  is a validation of the approved design; if it requires a different treatment, that is a **new owner decision**,
  not a silent change here.

**What the guidance says that directly answers parts of this design:**

| Question | Guidance (authoritative) | Application (proposal) |
| --- | --- | --- |
| Is the **normal** level of loss part of cost, or an expense? | Normal capacity and the systematic allocation of overheads are in the cost of conversion; **§16(a)** excludes only "*abnormal amounts* of wasted materials, labour or other production costs" and requires *those* to be recognised as expenses in the period incurred. The period's expense figure is described as including unallocated production overheads and abnormal production costs (cited in this repo as **§34**). | Event 2 stays in project cost; Event 3 is excluded and expensed. The **normal/abnormal boundary is a judgement** and must be documented per event (§4.3). |
| When is inventory written down? | **§9**: measured at the lower of cost and net realisable value. **§28**: cost may not be recoverable if inventories are "**damaged**", wholly/partially obsolete, or their selling prices have declined. Write-down is normally item by item (**§29**), based on the most reliable available evidence (**§30**), taking account of the purpose for which the inventory is held (**§31**), with materials held for production **not** written down below cost when the finished product is expected to be sold at or above cost (**§32**), and with a fresh assessment each period whose reversal is limited to the amount of the original write-down (**§33** in the edition consulted). | Event 4(c) is exactly a §28 case. **No NRV policy is approved anywhere in this repository** — which is the same reason `accepted-release-unsupported` exists. |
| Quantity adjustment alone, or also an expense? | Both effects are required when carrying amount is impaired and quantity is unchanged. The ledger can only do the quantity half (§6). | §8 Q4 and §9.5. |
| Returned usable material and project cost | No loss arises; the material is still an asset. | The project's cost must fall (derivation change), and the carrying amount stays where the material physically is. |
| Held in inventory vs already consumed | Consumed material is derecognised; a *later* discovery that it should not have been consumed is a **cost correction**, not a return. | This is why Event 1 requires the physical material to be present at the site store (§4.1). |
| Cost formula | **§25** permits FIFO or weighted average (and **§23** requires specific identification for items segregated for a specific project). | The repo uses weighted average per (business, product, location). **Note:** §23 is worth an explicit look — material "segregated for a specific project" would, strictly, be specific-identification territory; whether site-store stock is "segregated for a specific project" is a question for the accountant (§8 Q8). |

**Editions caveat (stated so nobody relies on a number I did not verify).** Paragraph numbering in IAS 2
differs between published editions: at least one freely available consolidated edition numbers the
period-expense sentence §38, while this repository and the edition consulted here place it at §34. The
**content** above was verified verbatim against the sources listed in §11; the **numbering** must be confirmed
against the edition the business's accountant applies before any of it is written into a policy or a comment.

---

## 8. Unresolved business and accounting questions

Each needs a named owner. None may be answered by an engineer, and none of the gated phases in §10 may start
while its question is open. **Update 2026-10-16:** Q2, Q5, Q6 and Q7 were answered by the owner decision
(`docs/audits/LEDGR_CONSTRUCTION_RETURNS_PHASE1_OWNER_DECISION_2026-10-16.md`); the answers are recorded in the
rows below and applied in §14. **Q1, Q3, Q4, Q8, Q9 and Q10 remain open** — Q8 is explicitly *not* named by the
decision, which presupposes the weighted-average pool.

| # | Question | Why it blocks | Owner |
| --- | --- | --- | --- |
| **Q1** | Which framework layer does *material consumed on a customer project* sit in: IAS 2 inventory expense on consumption, an IFRS 15 §95 contract-cost asset, or a self-constructed asset under IAS 16/IAS 40? And is the entity building for customers, for itself, or both? | Determines whether "project material cost" is an expense, an asset, or a contract cost — i.e. what a wastage record should even reduce. The repo currently assumes IAS 2 §6(c) derecognition at consumption (issue command header). **Status 2026-10-16:** still open, and still a business-owner plus accountant decision. Phase 1 creates no loss and no journal, and netting a return reduces whatever project cost *is*, so Q1 does not block usable returns — it blocks Phase 3 and any GL mapping. | Business owner + accountant |
| **Q2** | On a usable return, may the pool's weighted average be re-priced by the inbound at original issue cost (the R07 precedent), or must a return be value-neutral (e.g. inbound at the incumbent average, with any difference taken elsewhere)? | The balance writer re-prices on any costed inbound (§2.1). One of the two must be chosen and tested; "neutral by accident" is not available. **Answered 2026-10-16 (decision §1–2):** a valid return is recorded at the original issue's recorded unit cost and the same amount is deducted from project cost; the moving weighted-average pool re-prices and that effect must be tested and documented; no artificial balancing entry and no GL posting. | Accountant (owner informed) |
| **Q3** | Is the loss line for **normal** wastage part of project cost, and where does **abnormal** wastage go — 5180 "Inventory Adjustments & Shrinkage", a project/contract cost account, or a new account? And what threshold makes a loss "abnormal"? | Decides whether Events 2–4 can post anything at all, and to which account. No journal may be written before this is approved. | Owner + accountant |
| **Q4** | What is the approved **NRV measurement policy** (basis, who assesses, frequency, reversal limit)? | This is the pre-existing blocker behind `accepted-release-unsupported`, `INV-CM-001` and matrix §5b. Event 4(c) cannot exist without it. | Owner + accountant |
| **Q5** | May one person both issue material and accept its return (single capability), or must return be a separate capability token? | Determines whether Phase 1 adds a capability code (a catalogue change) or reuses `procurement.material.issue`. **Answered 2026-10-16 (decision §4):** a dedicated `procurement.material.return` capability. | Owner (controls) |
| **Q6** | Must `construction_project_material_cost` expose returns separately (a new output column) or only net them off? | The Stage-A precedent preserved the signature; adding a column is a signature change and must be deliberate. **Answered 2026-10-16 (decision §5):** preserve the signature; net returns against issued quantity and cost; `issue_count` unchanged; return detail in the register/workspace. | Product owner |
| **Q7** | Is a return to a **different site's** store required, or is "back to the store it came from" sufficient? | Cross-site movement needs a construction transfer command that does not exist (§2.4); deciding "not needed" keeps Phase 1 small. **Answered 2026-10-16 (decision §6):** the original issuing site store only; cross-site returns excluded. | Product owner |
| **Q8** | Does the §23 specific-identification requirement apply to material segregated for a specific project, which would displace the weighted-average pool for site stock? | If yes, the costing model for site stock changes fundamentally — a much larger piece of work than this feature. **Phase 1 basis fixed 2026-10-16 (decision B):** returned material enters the **existing weighted-average pool** (§7.1), so site stock stays on the weighted-average basis for Phase 1. Whether §23 specific identification applies to project-segregated material — and therefore whether this basis is suitable for financial reporting — is **external accounting validation** (accountant confirmation), flagged in decision record §7. A contrary finding would be a **new owner decision**, not a change to this baseline. | Accountant |
| **Q9** | For a damaged-but-present material awaiting a decision, is a site-level hold required (and if so, must `hold_type` gain a value, or a new hold table be created)? | `'damaged'` is not a permitted hold type and holds hang off receipt lines, not site balances (§3 item 3). | Product owner + accountant |
| **Q10** | Does the business want per-project **loss reporting** (issued / installed / wasted / damaged / returned) as a required control? | If yes, the registers must be designed to make it reconcilable from the outset rather than retro-fitted. | Owner |

---

## 9. Data and permission design (proposals — no schema change is made by this document)

### 9.1 Candidate movement types

| Event | Proposal | Alternative | Note |
| --- | --- | --- | --- |
| 1 — usable return | Reuse **`return_in`** with `source_type = 'construction_return'` | **Add `construction_return_in` — decided 2026-10-16 (decision A)** | Reusing an existing label avoids an enum change. **Justification corrected 2026-10-16 (§14 D4):** the earlier claim that reusing `return_in` would make "every existing report" read site returns as sales returns is **not supported** — `return_in` has exactly one writer (`src/services/posService.ts:1338`, `source_type 'pos_return'`) and no reader or report filters on it. The **decision fixed the label as `construction_return_in`** after a compatibility check that found no technical incompatibility (enum add is additive; no SQL consumer switches on the label; no test asserts the enum's membership; `ProductsPage.tsx:906` renders it as inbound because the name ends in `in`). |
| 2 & 3 — wastage / avoidable damage | Add **one** label `wastage_out` and distinguish normal vs abnormal by a **classification column on the register row**, not by a second token | Two labels (`wastage_out`, `damage_out`) | One token keeps the ledger honest: the *stock* event is identical, only the *classification and accounting* differ. Two tokens would encode an accounting judgement in the ledger enum. Requires §8 Q3 first |
| 4 — damaged, recoverable | (a)/(b) reuse the Event 1 token | — | (c) is **not** a token problem (§9.5) |

**No token may be added before the business rules and the accounting policy for its events are approved.**
Adding an enum label is a migration (and, per `20261020500000`, must be its own single-statement migration
because PostgreSQL cannot use a value added in the same transaction). **Phase 1 note (2026-10-16):** the
return's effect is decided (decision §1–2) **and the label is now decided: `construction_return_in`** (decision
A, 2026-10-16). It must still be its own single-statement migration, ordered before the migration that consumes
it (§9.3, implementation plan Stage 1).

### 9.2 Which events are stock-only (proposal)

| Event | Stock-only today | Requires an accounting consequence |
| --- | --- | --- |
| 1 — usable return | **Yes** — identical to the issue command: `journal_effect 'none'`, `gl_posting_enabled` stays `false` | No |
| 2 — normal wastage | Yes | No (stays in project cost) |
| 3 — abnormal wastage | Yes, **but this is a gap**: the loss would be reported in stock and project reports while absent from the ledger | Yes — §8 Q3 |
| 4 — damaged, recoverable | (a)/(b) yes | (c) yes — §8 Q4, plus the representation problem in §9.5 |

### 9.3 Required database constraints and server-side validation (proposal)

- `SECURITY DEFINER` command with `set search_path = public`;
  `_ledgr_construction_actor(business, 'procurement.material.return')` (decision §4); `p_reason`/evidence
  presence checks reusing `_ledgr_construction_reason_present`; `_ledgr_assert_period_open`.
- **Derived scope only**: `site_id`, `branch_id`, `location_id`, `project_ref` and the applied `unit_cost` are
  read from the source issue; the payload may not supply them. This design refuses a payload that carries them
  (`22023`), which is *stricter* than the issue command, which ignores unknown keys — pick one and test it.
- `CHECK (quantity > 0 and quantity_base > 0)`; `CHECK (unit_cost_base > 0 and total_cost_base > 0)`;
  `UNIQUE (business_id, client_key)`; FKs to `businesses`, `construction_procurement_sites`, `branches`,
  `inventory_locations`, `products`, `stock_movements` and the source issue — mirroring the verified
  `construction_material_issues` constraint set.
- **Single enforceable quantity bound** (corrected 2026-10-16, §14 D1): the source issue's remaining
  returnable quantity, re-checked inside the transaction under `SELECT … FOR UPDATE` on the source issue row.
  The earlier "two-sided" bound is withdrawn — a store balance is the return's *destination* and cannot limit
  an inbound.
- **Derived base quantity** (decision §3; §14 D2): `quantity_base := quantity × (source_issue.quantity_base /
  source_issue.quantity)`, validated against the source issue's UOM; the current
  `construction_product_uom_conversions` row is never consulted.
- **Indexes** (§14 D6): the new register needs `(business_id, source_issue_id)` for the cumulative check
  (plus `(business_id, return_date)` and `(business_id, project_ref)` for the register view and netting); the
  project-cost netting reads the issue register, already indexed `(business_id, project_ref)` by
  `idx_cmi_site_project`. The earlier draft omitted all of these.
- **Movement label** (decision A): `movement_type = 'construction_return_in'`, added by its own migration
  **before** this one, with `source_type = 'construction_return'` and `source_id` = the return id. The movement
  insert also carries the command's `client_key`, which activates the existing
  `stock_movements_client_key_uidx (business_id, client_key)` as a real second fence — it is inert today because
  no construction command passes a key (§9.4).
- No direct DML grant: `revoke all from anon, authenticated`, `grant select` only, plus the existing
  `trg_construction_append_only` with **no** allowed token for the new register (immutable), exactly as
  `construction_material_issues` has none.
- **RLS/privileges and self-verification** (decision §9): copy the register pattern of `20261021000000:4036-4095`
  (`revoke all` → `grant select` → one `<table>_member_read` policy) and add the branch predicate exactly as
  `20261023000000:73-155` does. The new migration must carry **its own** self-verification, because the Stage A
  verification list (`20261023000000:438-492`) enumerates a closed set of 15 tables and will not cover a table
  added later.

### 9.4 Branch, business and idempotency/concurrency (proposal)

- Business: every referenced row must carry the caller's `business_id`, else `42501` (never a default).
- Branch: `can_access_branch(business, site.branch_id)` **and** `can_access_location(business, location_id)`,
  both required, both `42501` on failure — identical to the issue command, so no new predicate is invented.
- Idempotency: `client_key` (uuid) per command, `UNIQUE (business_id, client_key)` on the register, replayed
  **before** scope checks (matching the issue command's order, though *after* the actor/capability check).
  **Correction 2026-10-16 (§14 D7):** the ledger's `stock_movements_client_key_uidx` is *not* a second fence
  here — no construction command sets `client_key` on its movement insert, and NULL keys are distinct — so the
  register's unique key plus the advisory lock below is the real fence.
- Concurrency (decision §9; corrected 2026-10-16, §14 D7): take an advisory lock **before** the replay check —
  either key-scoped, `pg_advisory_xact_lock(hashtextextended(business||'|'||'construction_return'||'|'||client_key, 0))`
  (the `record_inventory_journal_movement` pattern, `20261012000000:614`), or business-scoped,
  `pg_advisory_xact_lock(hashtext('ledgr.construction.return.'||business))` (the GRN precedent,
  `20261021000000:1980`). **Choose one explicitly:** the issue command takes neither, so a concurrent duplicate
  there dies on `chk_cmi_unique_client` with 23505 instead of replaying — behaviour this command must not
  inherit, so that T4 can require a graceful `idempotent: true` replay. **And** lock the source issue row
  `FOR UPDATE` before computing the remaining-returnable quantity, so two concurrent partial returns cannot
  both pass the bound. The R06 balance trigger already serialises the pool (it locks the balance row).

### 9.5 New tables and columns — what is necessary, and why

| Item | Necessary? | Why |
| --- | --- | --- |
| A **returns register** (e.g. `construction_material_returns`) | **Yes** for Event 1 — authorised by the 2026-10-16 decision (items 8–10); implementation still needs a separate instruction | Project cost is *derived* from `construction_material_issues` (§2.5). Without a register, the derivation cannot net returns off and the movement alone is untraceable to a project. |
| A **loss register** (`construction_material_losses`) with `classification` (`normal`/`abnormal`) | Yes for Events 2–3 | Same reason, plus it is where the normal/abnormal judgement and its evidence live. |
| A **classification/assessment record** for Events 3–4 | Yes for those events — **not required for Phase 1** (decision §7: no approval tier) | "Blocked until an authorised person approves" needs a durable approval artefact, and the existing `pos_approvals` cannot carry it (§2.7). Options: a construction approval table, or widening the POS one (a change to a live table used by the correction path — not recommended). |
| A site-level **damage hold** | Only if §8 Q9 says yes | `'damaged'` is not a valid `hold_type` and holds are receipt-line-scoped (§3 item 3). |
| A **carrying-amount write-down** mechanism | Only after §8 Q4 | `stock_movements` cannot express a quantity-less cost reduction (§6). Candidate designs: a valuation-adjustment table read by the project-cost derivation and by reports, or a dedicated adjustment document that posts to GL. **Not designed here — it belongs to the NRV policy work.** |
| A new capability token | **Yes — decided 2026-10-16 (decision §4)** | Add `procurement.material.return` to the catalogue (an insert, following `20261021000000:172-184`); `procurement.material.issue` alone does not authorise a return. |
| **A new table or column for Stage B's `project_code` link** | **No** | Out of scope here; recorded in the Stage B report as a text link with a future FK option. |

### 9.6 Untraceable material — the explicit non-default

If an owner ever needs to accept material back that cannot be traced to an issue, the safe treatment is:
inbound at the **incumbent pool average** (so the return cannot re-price the pool using an unverifiable
cost), **no** project-cost relief (the project it came from is unknown), a mandatory `untraced` flag, and a
report listing every untraced return for accountant review. **This is described so that it is not invented ad
hoc later; it is not proposed for implementation in Phase 1**, where the default is refusal.

### 9.7 Tests required (proposal — each maps to a control)

| # | Test | Control it proves |
| --- | --- | --- |
| T1 | Authorised holder returns a partial quantity; project material cost falls by exactly `qty × issue unit cost`; one inbound movement at the issue's location, `source_type` = construction return; site-store `on_hand` rises by exactly `quantity_base` | The happy path and the derivation change |
| T2 | A second, larger return is refused once the issue's remaining returnable quantity is exhausted (`over-return` refusal; no movement, no row) | Over-returning |
| T3 | A return whose cumulative total exceeds the source issue's recorded `quantity_base` is refused (`over-return`), with no row and no movement | Over-returning — the only enforceable custody bound (§14 D1) |
| T4 | Replay of the same `client_key` returns the committed row (`idempotent: true`) with **one** movement; concurrent duplicates via two connections produce one row (mirroring `CP.IDEMPOTENCY.CONCURRENT-GRN`) | Duplicate returns |
| T5 | A user without the capability → `42501`; anon → `42501`; a cross-business site/issue reference → `42501`; a forged `site_id` → `22023`/`42501` | Authorisation, business isolation |
| T6 | An A1-only user cannot return material for an A2 site (same business) → `42501`, and the A2 return is invisible to them on read | Branch isolation (extends the Stage A `CPB.*` pattern) |
| T7 | A full return of the issue **succeeds with the site store's `on_hand` at 0** (the state the issue left it in), proving the store balance is not a bound; a second attempt then fails `over-return` | The D1 correction, and that "already returned" — not "already consumed" — is the enforceable refusal |
| T8 | A closed accounting period → `period-closed`, nothing written | Period lock |
| T9 | Wastage (Event 2) leaves project material cost **unchanged**; abnormal (Event 3) **reduces** it; both write exactly one movement and no journal while `gl_posting_enabled` is false | Classification's cost effect and the GL switch |
| T10 | A replayed correction/opposite record never mutates the original row; `42501` on any direct UPDATE/DELETE of either register | Append-only audit |
| T11 | After an approved-policy change, **no** journal entry exists for any of the four events (structural assertion) | The GL switch is not bypassed |
| T12 | Pool average before/after a return, for a pool whose cost has moved, equals the value the 2026-10-16 decision produces (the inbound re-prices at the original issue cost), **and** the next issue from that store is costed at the new average | The costing decision is enforced, not assumed |
| T13 | A damage assessment by the same person who raised it is refused (four-eyes) | Separation of duties on Event 4 |
| T14 | An above-threshold return with no approval writes nothing; with a consumed approval token it writes exactly once and the token cannot be reused | Approval gate and single-use — **deferred** with the approval tier (decision §7); not part of Phase 1 |
| T15 | After the registered UOM conversion factor for the issued product is changed (deactivate, register a new factor), a return still derives `quantity_base` from the source issue's recorded ratio — the project relief and the inbound movement stay consistent with the original issue | The D2 correction (decision §3) |
| T16 | A single capability holder can return a high-value quantity with **no** approval token, and no construction path reads or writes `pos_approvals` | The decision §7 boundary cannot creep back in |
| T17 | After a return re-prices the pool, a **subsequent issue to a different project** is costed at the recalculated average, and that second project's derived cost reflects it | Decision B item 5 (documented downstream effect of pool recalculation) |

---

## 10. Phased implementation plan with approval gates

**Gate 0 — this document reviewed and accepted.** **Granted 2026-10-16** by the owner decision
(`docs/audits/LEDGR_CONSTRUCTION_RETURNS_PHASE1_OWNER_DECISION_2026-10-16.md`), on the corrected baseline in
§14. That decision implements nothing: no code, migration, token or journal posting is created until a separate
implementation instruction.

| Phase | Content | May start only when | Explicitly not included |
| --- | --- | --- | --- |
| **1 — Usable return (Event 1)** | One migration adding: the returns register with its constraints, indexes and branch-scoped RLS/privileges; a catalogue insert for `procurement.material.return`; one `SECURITY DEFINER` command with derived scope, the single cumulative bound, a `client_key` fence and an append-only trigger with no token; the `construction_project_material_cost` body change (signature preserved); the workspace UI; tests T1–T8, T10–T12, T15–T17; plus one single-statement enum migration for the **decided** label `construction_return_in` (decision A, §9.1). Staged plan: `CONSTRUCTION_RETURNS_PHASE1_IMPLEMENTATION_PLAN_2026-10-16.md` | **Gate 0 granted 2026-10-16; Q2, Q5, Q6, Q7 answered, and the label (A) and costing policy (B) confirmed** — the remaining prerequisite is a **separate explicit implementation instruction** on the corrected baseline (§14) | Any wastage/damage record, any approval tier, any GL posting, any NRV handling, any change to `gl_posting_enabled`, any cross-site return |
| **2 — Normal wastage (Event 2)** | Loss register + `wastage_out` label + command, scoped to `classification = normal`, staying in project cost | Phase 1 shipped and tested **and** §8 Q3 (normal-loss policy) answered | Abnormal losses, write-downs, GL |
| **3 — Abnormal wastage / avoidable damage (Event 3)** | Classification + mandatory investigation reference + second-actor approval + exclusion from project cost, **and** the approved journal mapping | §8 Q3 answered **and** the accounting design (accounts, thresholds, approval tier) signed by the owner **and** the accountant — and, if any journal is to be written, a separate approval to lift the GL constraint (which is a `CHECK` change on a live table) | Any journal before that approval |
| **4 — Damaged, recoverable (Event 4)** | (a)/(b) via Phase 1's machinery; (c) via the NRV policy | §8 Q4 (NRV policy) **and** §8 Q9 (hold mechanism) answered **and** §9.5's write-down representation designed | The quantity-less write-down until its representation exists |
| **Never without separate approval** | Lifting `gl_posting_enabled`, widening `pos_approvals`, renaming or reusing existing movement labels in a way that changes historical reports, `INV-CM-001` status change | — | — |

**Sequencing note.** Phase 1 is deliberately the *only* phase that can be built from engineering evidence
alone: a return creates no loss, so it needs no expense policy — only a costing rule for the pool (Q2), which
is a single, testable question.

---

## 11. Sources and assumptions

### 11.1 Authoritative accounting sources consulted (and how they were used)

| Source | What was taken from it |
| --- | --- |
| IAS 2 *Inventories*, IASB text: measurement at the lower of cost and NRV (**§9**); cost of purchase (**§10–11**, incl. trade discounts deducted); costs of conversion and allocation of fixed overheads based on **normal capacity**, with unallocated overheads expensed (**§12–13**); other costs and the excluded list (**§15–16**, incl. **§16(a)** "abnormal amounts of wasted materials, labour or other production costs"); cost formulas — specific identification for items segregated for a specific project (**§23**), FIFO/weighted average otherwise (**§25**); net realisable value — damage/obsolescence (**§28**), item-by-item (**§29**), most reliable evidence (**§30**), purpose held and firm-contract provisions (**§31**), materials not written below cost when the finished product is expected to be sold at or above cost (**§32**), fresh assessment each period and reversed write-down limited to the original write-down (**§33**); the period-expense description cited in this repository as **§34**; and **§8**'s closing sentence referring contract costs to IFRS 15. | Verified against the IASB-hosted 2025 HTML rendering of IAS 2 and two independent full-text copies, and cross-checked against the repository's own IAS 2 citations in `CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` §4. |
| IFRS 15 *Revenue from Contracts with Customers* **§95(a)–(c)** (contract costs not within another Standard; asset only if the costs relate directly, generate/enhance future resources, and are expected to be recovered) and **§101** (impairment ceiling), plus IFRS 15 **BC308** and the IFRS Interpretations Committee **March 2019** agenda decision on costs to fulfil a contract (costs satisfying a *current* performance obligation fail §95(b) and are expensed) | The framework question in §7/Q1 and the conclusion that material consumed on a customer contract is not automatically a contract-cost asset |
| IAS 21 *The Effects of Changes in Foreign Exchange Rates* **§21–22, §23(a), §28, §40** | Not re-researched here; cited because the receipt costing path already implements it and a return must not re-translate a frozen cost. Recorded from the earlier Stage-C-precursor research in this session. |

**No quotation in this document is invented.** Where a paragraph number could not be pinned to a single
edition, §7's editions caveat says so explicitly.

### 11.2 Repository sources (verified during this review)

`supabase/migrations/20250101000000_base_schema.sql` (:187-197 enum, :1779-1816 table/FKs/RLS, :812-857
transfers) · `20260728000002/…/20261011000005` (historical inventory backfill/costing) ·
`20260728000005_perpetual_inventory_accounts.sql` (:7-86 accounts 2114/5180) ·
`20260815000000_phase8b_reconstruct_rpcs.sql` (:296 account metadata) ·
`20260817000001_phase10_nonneg_quantity_checks.sql` · `20260911000000_hot_path_indexes.sql` ·
`20260911000001_quick_save_rpc.sql` (:241-265 `_ledgr_stock_location`) ·
`20260925000001_stock_movement_balance_delta_trigger.sql` ·
`20260928000001_r06_stock_balance_authority.sql` (:69, :139-155, :222 balance authority) ·
`20260928000002_r07_correction_commands.sql` (:70-88, :97-250, :253-421 approval/correction, restock) ·
`20261012000000_post_containment_hardening.sql` (:538-691 `record_inventory_journal_movement`) ·
`20261014000000_period_lock_and_invoice_approval.sql` (:78-90 period guard) ·
`20261020500000_stock_movement_type_construction_issue.sql` ·
`20261021000000_construction_procurement_traceability.sql` (issue :3689-3812, receipt posting :3596-3630,
policy :3144-3171, append-only :3990-4030, holds :1768-1784, PO cancel message :1270, capabilities :172-184) ·
`20261023000000_construction_branch_scope.sql` (:269 RPC re-creation) ·
`src/dal/repositories/TransferRepository.ts` (:110-230) · `src/dal/repositories/InventoryRepository.ts`
(:235-270, :317-335, :643-650) · `src/dal/repositories/ConstructionProcurementRepository.ts` (:644 findSites) ·
`src/services/inventoryJournalService.ts` (:214-230, :760-810) · `src/pages/ExpensesPage.tsx` (:105-175) ·
`src/pages/ProductsPage.tsx` (:735-770) · `src/pages/WarehousePage.tsx` (:590-625) ·
`src/lib/construction/materialTransferPreparation.ts` (local-only header) ·
`src/components/construction/ConstructionMaterialIssuesSection.tsx` (:41-100) ·
`docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` (§4, §5b, §7.9) ·
`docs/architecture/CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md` ·
`tests/release/construction-procurement.test.ts` (17 rows) · `tests/release/construction-branch-scope.test.ts`
(12 rows) · replayed-schema probes (`pg_enum`, `information_schema.columns`, `pg_constraint`, `pg_index`,
`pg_trigger`, `pg_policies`, `pg_class.relacl`, `pg_proc`) run locally for this document.

### 11.3 Assumptions this document relies on (each falsifiable)

1. The business is a taxable entity applying IFRS as a reporting framework — **unconfirmed**; Q1 exists because
   of it.
2. The site store is a real `inventory_locations` row per site and the site store's `inventory_balances` row is
   the physical quantity available to the site (verified structurally; not verified for a live tenant's data).
3. An issue is the correct traceability unit for a return (i.e. returns are per issue, not per GRN) — a product
   assumption, not a schema fact.
4. Weighted average remains the cost formula for site stock (i.e. §23 specific identification does not apply) —
   falsifiable, and Q8 asks it.
5. No tenant currently holds construction data that a new register would have to be back-filled for; if one
   does, a back-fill plan is a separate approval.

---

## 12. Validation performed for this review

| Check | Result |
| --- | --- |
| Repository state | Branch `arena/2faa03b4-ledgr-react`; HEAD `92f64fa`; working tree clean before the edit. **A shallow-clone state shift was found and repaired before any edit** (see the Stage C report): `.git` was depth-limited at `3e6fd00` with the remote ref absent; `git fetch --deepen=500 origin` → `git reset --mixed 92f64fa` (a forward move — `3e6fd00` is an ancestor, no commit lost) → upstream re-set. No file content was reset, restored or discarded. |
| Schema verification | Embedded PostgreSQL replay through the R13 harness (`LEDGR_TEST_ENV=local`), read-only probes: enum labels, all `stock_movements` columns/constraints/indexes/ACLs, `inventory_balances` checks, construction register columns/FKs, append-only trigger tokens, capability catalogue, GL `CHECK` on the posting policy, approval-precedent tables |
| Code verification | File/line references in §2 and §11.2 read directly, not recalled |
| Documentation check | `git diff --check` — see the Stage C report |
| Database writes | **None.** No migration applied anywhere, no production/shared database contacted, no data changed |
| Application code | **Unchanged.** Only this document is edited |

---

## 13. Summary of what a reviewer must decide

1. **§8 Q1** — which framework layer construction material cost sits in (this changes what "project material
   cost" means, and it is bigger than this feature).
2. ~~**§8 Q2**~~ — **answered 2026-10-16**: a valid return is recorded at the original issue's unit cost, the
   pool re-prices, and the effect must be tested and documented (decision items 1–2).
3. **§8 Q3** — the normal/abnormal boundary and the account for abnormal loss.
4. **§8 Q4** — the NRV policy (which unblocks Events 3 and 4(c), and is already blocking accepted-stock
   release today).
5. ~~**§8 Q5–Q7**~~ — **answered 2026-10-16** (dedicated `procurement.material.return` capability; RPC signature
   preserved with returns netted; original issuing site store only). Still open: **§8 Q9** (damage holds),
   **§8 Q10** (per-project loss reporting) and **§8 Q8** (not named by the decision — confirm with the
   accountant).
6. ~~**Gate 0**~~ — **granted 2026-10-16**. Phase 1 (usable material return only) may be implemented on the
   corrected baseline **after a separate explicit instruction**; Phases 2–4 remain unauthorised.
7. ~~**Movement label**~~ — **decided 2026-10-16 (decision A): `construction_return_in`**, after a compatibility
   check that found no conflict (decision record §7). Phases 2–4 labels remain undecided.

---

## 14. Owner decision of 2026-10-16, and the corrections applied

**Gate 0 granted.** The owner decision recorded in
`docs/audits/LEDGR_CONSTRUCTION_RETURNS_PHASE1_OWNER_DECISION_2026-10-16.md` approved **this baseline for
Phase 1 only**, answered §8 Q2, Q5, Q6 and Q7, and directed the corrections below. It authorises **no
implementation**: a separate explicit instruction is required (§10), and every boundary in decision items 8–10
stands.

| # | Correction | Directed by | Where it is applied |
| --- | --- | --- | --- |
| D1 | The "the destination store must hold the physical stock" bound is **withdrawn**: it is not a custody test, it would refuse the design's own happy path (the store's `on_hand` is 0 after the issue), and an inbound cannot drive a balance negative. The enforceable bound is cumulative returns ≤ the source issue's recorded `quantity_base`, under a `FOR UPDATE` lock on the source issue row. "Already consumed" cannot be refused as such — only "already returned" | decision items 2–3, 7; Phase 1 readiness review §3.2 | §3 item 5; §4 rows *Negative stock / over-return prevention*, *Previously consumed material*, *Blocked until approval*; §9.3; §9.7 T3/T7 |
| D2 | `quantity_base` derives from the **source issue's recorded ratio**, never from the mutable, non-effective-dated conversion table | decision item 3 | §4 *Required fields*; §9.3; §9.7 T15 |
| D3 | No second-person approval in Phase 1: no threshold, no approval artefact, and every refusal raises before any write | decision item 7 | §4 *Who approves*, *Blocked until approval*; §9.5; §10; §9.7 T14 marked deferred, T16 added |
| D4 | The `return_in` justification is corrected (no existing report reads it); the separate-label recommendation stands, but the label name was **not decided** | design accuracy | §9.1 |
| D5 | The netting "consumers" are the RPC and the two workspace sections that call it — there is no report or export consumer | decision item 5 | §2.5 |
| D6 | The cumulative check needs `(business_id, source_issue_id)`; netting reuses `idx_cmi_site_project` | decision item 9 | §9.3 |
| D7 | The ledger's `(business_id, client_key)` fence is **inert** for construction writes (no command sets `client_key` on a movement), and the issue command takes no advisory lock — so an explicit lock choice is required for T4's graceful replay | decision item 9; readiness review §3.2 | §9.4; §9.7 T4 |

**Positions that changed from proposal to decided** (all from the decision, none from this document): return cost
= source issue's `unit_cost_base`; the pool re-prices and the effect must be tested and documented; **no
balancing entry and no GL posting**; capability = `procurement.material.return`; RPC signature preserved with
returns netted and `issue_count` unchanged; destination = the original issuing site store; no approval tier.

**Still open, and not answered by implication:** §8 Q1 (framework layer), Q3 (normal/abnormal boundary and
accounts), Q4 (NRV policy), **Q8** (IAS 2 §23 specific identification — the decision presupposes the
weighted-average pool without naming it), Q9 (damage hold), Q10 (per-project loss reporting); the movement
label's name; and whether the corrected baseline is committed before implementation (decision record §5).

### 14.1 Final decisions confirmed 2026-10-16 (A and B)

| # | Decision | Where applied |
| --- | --- | --- |
| **A** | Movement label = **`construction_return_in`** (the POS-oriented `return_in` is not reused); the label must be its own single-statement migration ordered before its consumer | §2.2 note, §9.1, §9.3, §10; evidence table in the decision record §7 |
| **B** | **Ledgr's approved Phase 1 costing policy:** return at the original issue's recorded unit cost; the returned material enters the existing moving weighted-average pool and the average recalculates; **no balancing entry and no GL posting**; the pool effect must be tested and documented, including downstream issues to other projects | §7.1 (policy + precise statement of what §25/§23 do and do not require), §8 Q2/Q8, §9.3, §9.7 T12/T17 |
| **External validation** | Accountant confirmation that policy B is suitable for the entity's financial reporting (and whether §23 specific identification reaches site stock) — **flagged as external accounting validation, not resolved here**; a contrary finding is a new owner decision | §7.1, §8 Q8, decision record §7 |

**What this correction pass changed:** documentation only. No code, migration, test, policy, grant, schema object,
configuration or database state was touched, and nothing was committed, pushed or deployed.
