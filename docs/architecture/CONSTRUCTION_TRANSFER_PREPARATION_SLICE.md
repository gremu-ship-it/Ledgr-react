# Construction store-to-site transfer preparation — local workflow slice

**Status:** Working in-app preparation and observation workflow implemented in React memory only, and reachable from the local draft route only — it is **not** the server-backed `/construction/*` workspace, which is described in the next section. It is **not** a saved, authorized, or live inventory transfer. Dispatch and receipt observations do not post stock movements. `INV-CM-001` remains proposed, not accepted.

## Where this fits now — the draft route vs the server-backed workspace (2026-10-16)

Two different things now exist, and this document describes only the first:

| Route | What it is |
| --- | --- |
| `/projects-funding-sources/construction-draft` | **This document's subject.** The local, in-memory preparation and observation workflow implemented in `src/pages/ConstructionProjectSetupDraftPage.tsx`. No repository, Supabase or browser-storage call; it does not reserve, move or value stock. Unchanged by the work below. |
| `/construction/*` | The server-backed Construction workspace (`src/pages/construction/ConstructionWorkspacePage.tsx`). It reads member-scoped data through `ConstructionProcurementRepository` and acts only by calling the authorised `public.*_construction_*` commands. |

The persistent alternative this slice asked for **now exists** for construction procurement site
registration, explicit product UOM conversions, authorised purchase orders, goods receipts with
five-way classification and evidenced holds, receipt cost bases under an approved posting policy, and
material issues that draw the pool weighted-average cost — see
[`CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md`](CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md).
It is deliberately narrower than the generic transfer this document describes: it is tied to a registered
construction site (which is what supplies the branch, the location and the project reference), it resolves
products and units against master data rather than free text, and it refuses anything the policy does not
support.

Still open, and why the local slice's non-posting boundary remains honest:

- **GL posting is disabled by construction** for every construction command; a material issue writes one
  `issue_out` stock movement at the pool's weighted-average cost and no journal entry.
- **Dispatch/receipt differences, in-transit custody, returns and write-downs are not modelled.** Accepted
  stock cannot be released back out (`accepted-release-unsupported`), rejected stock cannot be released
  onward (`rejected-release-unsupported`), and an accepted-stock write-down needs an approved IAS 2 §28
  basis that does not exist yet. The draft's review-only difference observation therefore has no
  persistent counterpart, by design.
- **`INV-CM-001` remains proposed, not accepted.** No deployed Supabase authorisation, RLS/ACL or Storage
  behaviour has been verified; the release suite's pre-existing `BLOCKED` rows still need official
  Auth/PostgREST and the deployed policies. Isolated PostgreSQL evidence is not production evidence.

The draft route gains nothing from any of this: it remains a local preparation surface, its free-text
store/site/material values are still not resolved to Ledgr records, and it cannot reach the new commands.

## Working functionality

From a local Construction Project Workspace draft, a user can create a transfer note with a local reference, optional source-document reference and transfer date, free-text source-store and destination-site notes, and material lines containing description/code/unit notes and requested quantities. A note can be kept as a local draft, marked prepared in the current tab, reopened, edited, and discarded.

The same note can hold dispatch and destination-receipt observations. Dispatch observations require at least one positive dispatched quantity, and each dispatched quantity may not exceed its requested quantity. A receipt quantity can be entered only for a line with a dispatch note; at the receipt-observed stage, every dispatched line needs a received quantity note, with zero allowed explicitly. A received quantity may not exceed its dispatch note. A quantity below dispatch is shown as a difference for review; the workflow does not classify it as a shortage, loss, damage, or adjustment.

These are validation rules for a local note, not an approved inventory contract. Store, site, material, unit, and source-document values are free text; they are not resolved to Ledgr records or validated against a product catalogue, business branch, or inventory location. Local stages are presentation labels, not authorization or workflow approvals.

## Non-posting and scope boundary

The feature is held in page-component memory. It makes no API, repository, Supabase, or browser-storage call. It does not reserve stock, decrease source stock, create an in-transit balance, increase destination stock, create a movement, approval, receipt, valuation, journal, or GL entry. Notes clear when the page is refreshed or left, when the user signs out, or when the active business changes. A transfer note is filtered by the local project and active business context; this is not a server-side authorization control.

The feature does not change the Projects & Funding Sources boundary, RLS, database schema, production data, or permissions. It does not call the existing client-orchestrated `TransferRepository` sequence, whose atomicity and authorization guarantees are unverified. No posting action is exposed.

## Decisions and evidence required before any persistent or posting path

1. **Product/data and operations owners — source, site, and movement semantics:** approve how requests originate and whether source references must resolve; identify authoritative store, site, branch, business, item, and unit identities; define project-to-site/location mapping; decide whether dispatch and receipt can be partial, split, reversed, or corrected; define in-transit, custody, return, and exception states; and decide duplicate and cancellation handling.
2. **Security/data owners — trusted authorization boundary:** approve exact-business and branch controls, membership/action authorization, actor identity derivation, server-side source/destination/product scope checks, and the intended separation from the restricted Projects & Funding Sources resource. A proposed role matrix is not permission evidence. Do not rely on client-provided IDs or client-side sequencing for authorization.
3. **Accounting owner — inventory and discrepancy treatment:** determine whether/how location transfers affect valuation or accounting, the approved cost basis and timing, and the treatment of partial receipt, quantity differences, damaged/lost goods, period cut-offs, returns, and any required balanced journal examples. Do not infer account classification or adjustments from the local comparison message.
4. **Data/security/release owners — atomic command and failure evidence:** design and review a trusted server-side transaction that validates all scopes, derives the actor, handles concurrent changes, uses idempotency keys for retry safety, and rolls back fully on failure. Specify atomicity across dispatch and receipt boundaries and prove duplicate/retry behavior. Test authorization, RLS, business/branch isolation, partial movement, rollback, concurrency, and replay in an authorized isolated database before separately deciding on any migration or deployment.

No schema migration, permission change, production data operation, or external database action is part of this slice. No local mock or UI test is evidence of live RLS, database transaction integrity, or stock movement.

## Verification boundary

The focused domain/UI tests cover local decimal validation (including negative, zero, over-request, over-dispatch, and invalid numeric forms), zero receipt observations, exact decimal comparisons, project/business scoping, context-change clearing, and retry when the local callback reports an unavailable context. They also assert that the current workflow does not call the network or browser storage. These tests verify only in-memory behavior. No live database, RLS, atomic command, or stock integration was exercised or enabled.
