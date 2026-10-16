# Project-linked return, wastage and damage — design only (not implemented)

**Date:** 2026-10-16 · **Status:** design proposal, **no command, movement type, table or permission is added by this
document** · **Related:** `CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md` (option C, now implemented),
`LEDGR_CONSTRUCTION_UPGRADE_STAGE_A_2026-10-16.md`, `LEDGR_CONSTRUCTION_UPGRADE_PHASE1_BASELINE_2026-10-16.md`.

## 0. Why this is design only

Three workflows are asked for: material **returned** from a site, material **wasted** on site, and material
**damaged** on site. Every one of them changes stock and (potentially) the ledger, and today the repository
has no approved answer to two questions:

1. **What is the movement type?** The enum carries `issue_out` for construction issues
   (`20261020500000_stock_movement_type_construction_issue.sql`). A return, a wastage write-off and a damage
   write-off are three different stock events and must not share one token.
2. **What is the accounting effect?** Construction material consumption has GL posting **disabled** on purpose
   (`chk_crpp_gl check (gl_posting_enabled = false)`), and issuing material to a project currently writes a
   `stock_movements` row with `source_type 'construction_issue'` while the paired
   `construction_material_issues` row records `journal_effect 'none'`. A wastage or damage write-down is the
   classic case where a stock-only treatment and a cost-of-sales treatment differ, and IAS 2 §34 requires the
   write-down loss to be recognised in the period it arises. Inventing that policy is outside the authority of
   this change.

Until those are decided and tested, implementing the commands would create an unapproved accounting effect.
The approved scope for this task is therefore the design below.

## 1. Shared requirements for all three workflows

| Requirement | Rule |
| --- | --- |
| Command, not table write | Each workflow is a `SECURITY DEFINER` command following the existing construction pattern (`ledgr.construction_command` marker, append-only guards, `client_key` idempotency, capability gate via `_ledgr_construction_actor`). No direct DML grant is added to any construction table. |
| Branch scope | The command derives branch/site/location from the source document (as GRN recording already does) and refuses with `42501` unless `can_access_branch` passes — the same predicate Stage A applied to reads. |
| Business scope | Every referenced row must belong to the same business; a forged identifier is `42501`, not a
default. |
| Capability | A dedicated token per workflow (e.g. `procurement.material.return`, `procurement.wastage.record`) granted through the existing `grant_construction_procurement_capability` workflow. Role names alone never authorise. |
| Reason and evidence | Mandatory, following `_ledgr_construction_reason_present`: a non-empty reason and an evidence reference (photo, report, minute number). No free-text-only path. |
| Append-only audit | The record is written once and never updated or deleted; corrections are new records
referencing the original. |
| Quantity limits | A return may never exceed the quantity issued to that site (or, if the material never left the store, may never exceed the receipt); a wastage/damage record may never exceed what the site holds for that material. Enforced in the command, not in the UI. |
| No second ledger | Stock moves only through `stock_movements` with a branch/location and the pool's `average_cost`, exactly as receipts and issues do today. |

## 2. Workflow A — material returned from a project

| Item | Design |
| --- | --- |
| Trigger | Physically returned to the store (or to another site — see the open question below). |
| Movement | **New** enum token, e.g. `issue_return`, with **positive** quantity against the destination location, `source_type 'construction_return'`, and a link to the original issue. |
| Cost | At the original issue's `average_cost` (not today's pool cost) so the issue/return pair is value-neutral; the difference, if the pool moved, is a costing question that must be answered before implementation. |
| Permissions | `procurement.material.issue` holder at the destination branch **plus** the new return token. |
| Evidence | Reason, condition of the material, and who accepted it back. |
| Accounting | If the issue was stock-only (`journal_effect 'none'`), the return is stock-only too. If the organisation later enables consumption posting, the return must reverse the same accounts — this coupling is the reason the movement is linked to the original issue. |
| Reconciliation | `on_hand` at the destination increases by exactly the returned base quantity; the site's issued
balance decreases by the same amount. |

## 3. Workflow B — material wasted on site

| Item | Design |
| --- | --- |
| Trigger | Loss during handling/installation that is not a return (offcuts, breakage in use, spillage). |
| Movement | **New** enum token, e.g. `wastage_out`, with **negative** quantity, `source_type 'construction_wastage'`. Wastage must be distinguishable from an ordinary issue in every report. |
| Cost | At the pool `average_cost` at the time of the record. |
| Permissions | Site-scoped capability holder plus a threshold above which an approver is required (four-eyes,
like PO authorisation). |
| Evidence | Reason category (handling, cutting, weather, theft/suspected), free-text reason, photographic or report reference. |
| Accounting | **Undecided and blocking.** Options: (a) stock-only, consistent with today's disabled consumption posting; (b) write-down to expense in the period it arises (IAS 2 §34). The choice must be made, posted through the same journal design as consumption, and tested before the command exists. |
| Reconciliation | `on_hand` decreases; the wastage quantity is reported separately so a site's consumption can be split into installed, wasted and damaged. |

## 4. Workflow C — material damaged on site

| Item | Design |
| --- | --- |
| Trigger | Material damaged but **still present** (possibly repairable, possibly scrapped). |
| Movement | Two-step, mirroring the receipt-side design that already exists: a **hold** (`damaged`) that moves nothing, then either a **return** (Workflow A) or a **scrap** (`damage_out`, negative quantity) that moves stock. |
| Cost | The held quantity carries the issue cost until it is scrapped. |
| Permissions | `procurement.receipt.inspect`-style inspection capability for the assessment, plus the scrapping authority; a damaged-then-scrapped record always names both actors. |
| Evidence | Damage description, assessment outcome, scrap authorisation reference. |
| Accounting | Same blocking decision as wastage: scrap is a write-down event under IAS 2 §34 unless an insurance recovery is recognised, which is a separate approval. |
| Reconciliation | Held quantity is excluded from available stock; the scrap moves `on_hand` at the recorded weighted-average cost. |

## 5. What must be decided and tested before any of this is implemented

1. **Movement tokens** — names and semantics of the new enum values, and whether a return to a *different* site is one movement or two.
2. **Cost basis** for return versus wastage versus damage, including what happens when the pool weighted-average cost has moved between issue and return.
3. **Accounting treatment** of wastage and damage (stock-only vs period write-down), with the journal design
   approved before any GL posting is enabled. **GL posting for construction consumption stays disabled**
   (`gl_posting_enabled = false`); no journal entry may be created for these workflows without that approval.
4. **Approval thresholds** — which quantities or values require a second actor, and who that actor is.
5. **Evidence requirements** per workflow and how evidence is retained and referenced.
6. **Reconciliation reports** — site-level issued/installed/wasted/damaged/returned, reconciled to `stock_movements` and to the issue records.
7. **Tests** — positive and negative cases for quantity limits, branch and business boundaries, capability denial, four-eyes where applicable, idempotent replay by `client_key`, and that a wastage/damage record never produces a duplicate stock movement.

## 6. Deliberately out of scope

No progress billing, no revenue recognition, no automatic project-cost journal posting, no supplier-credit
note path, and no second inventory ledger. Invoices never create stock movements: an invoice for construction
work is a billing document, and materials move only through the commands above.
