# Construction material receipt preparation — first Phase 2 slice

**Status:** Application workflow implemented as an in-memory, non-posting preparation only, and reachable from the local draft route only — it is **not** the server-backed `/construction/*` workspace, which is described in the next section and in [`CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md`](CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md). This is not a saved or live-integrated receipt workflow. **ADR `INV-CM-001` remains proposed, not accepted.**

## Where this fits now — the draft route vs the server-backed workspace (2026-10-16)

Two different things now exist, and this document describes only the first:

| Route | What it is |
| --- | --- |
| `/projects-funding-sources/construction-draft` | **This document's subject.** The local, in-memory preparation workflow implemented in `src/pages/ConstructionProjectSetupDraftPage.tsx`. No repository, Supabase or browser-storage call; no stock, valuation or journal effect. Unchanged by the work below. |
| `/construction/*` | The server-backed Construction workspace (`src/pages/construction/ConstructionWorkspacePage.tsx`). It reads member-scoped data through `ConstructionProcurementRepository` and acts only by calling the authorised `public.*_construction_*` commands. |

The persistent construction procurement path that this slice listed as a precondition **now exists** for
purchase orders, delivery notes, goods receipts with five-way classification and evidenced holds,
inspection/quality release, supplier-invoice-reference registration, receipt↔bill-line matching, receipt
cost bases, a posting policy and material issues — see
[`CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md`](CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md),
which also records the mapping to the decisions below. Of the four decision groups in this document, the
site/location/branch scope, explicit UOM conversions, actor derivation, four-eyes authorisation,
idempotency and the cost basis (IAS 2 §11 / IAS 21 §§21, 23(b), 28) are addressed there, with evidence
from an isolated PostgreSQL replay only.

Still open, and the reasons this slice's non-posting boundary remains honest:

- **GL posting is disabled by construction** for every construction command. Accepting stock records a
  stock movement and a frozen cost basis; it never writes a journal entry.
- **Supplier returns and accepted-stock write-downs are refused** pending an approved IAS 2 §28 basis, and
  cost basis in a converted bill UOM is refused rather than converted by guesswork.
- **`INV-CM-001` remains proposed, not accepted**, and no deployed Supabase authorisation,
  RLS/ACL or Storage behaviour has been verified — the release suite's pre-existing `BLOCKED` rows still
  need official Auth/PostgREST and the deployed policies. Isolated PostgreSQL evidence is not production
  evidence.

The draft route gains nothing from any of this: it stays a local preparation surface, it is not the
authorised path to a persistent receipt, and nothing in the new commands is reachable from it.

## Working functionality

From a local Construction Project Workspace draft, a user can prepare a material receipt note with a source-document label and reference, optional document date and supplier note, a destination-site note, and one or more material lines. Lines capture free-text description/code/unit notes and delivered, accepted, and rejected quantity observations. The receipt note can be kept as a local draft, marked prepared in the current tab, reopened, edited, or discarded.

The source-document labels are descriptive UI choices, not an approved policy or linked records. Site, supplier, item, and unit values are not verified against Ledgr master data. A blank accepted/rejected quantity means **not assessed**, not zero. Validation supports this local note only and is not an approved domain/schema contract.

## Non-posting boundary

The workflow is held only in React component memory. It makes no API, repository, Supabase, or browser-storage call. It does not create a goods receipt, inventory movement, transfer, approval, stock-balance change, valuation, tax calculation, journal, or GL entry. Its statuses are local presentation states, not business approvals. The existing Projects & Funding Sources boundary, permissions, RLS, and schema are unchanged. No migration or data operation is included.

## Exact decisions before persistent receipt/posting

1. **Product/data owner — source and receipt semantics:** approve which source documents qualify, whether references must resolve to an existing purchase/receiving record, how partial delivery/rejection/inspection and duplicate source references work, and which item/UOM identities and conversions are allowed.
2. **Data/security owners — operational site scope:** approve the operational job/site identity and the exact mapping from a project/site to an inventory location and branch. Define exact-business, active-membership, role/action, endpoint-scope, and actor checks at the trusted server boundary. Do not use the restricted Projects & Funding Sources resource as a substitute.
3. **Accounting owner — receipt valuation/posting:** approve the applicable reporting basis and when accepted quantities enter stock; the source of unit/landed cost; currency, tax and period treatment; whether the receipt posts to inventory/GRNI or another approved treatment; account mapping; and the expected balanced journal examples. No such treatment is inferred here.
4. **Data/security/release owners — command and evidence:** review an atomic, retry-safe command and additive schema only after the above decisions. The command must validate business/product/source/site/location scope server-side, derive actor identity server-side, handle duplicate keys and concurrent stock changes, and roll back fully on failure. Test RLS/branch isolation and failure/retry behavior in an authorized disposable database before a separate migration or deployment decision.

## Integration limits and next workflow

The current generic receipt operation is a stock-and-journal command, so this local preparation flow does not call it while the accounting treatment is unresolved. The existing client-side stock transfer sequence performs multiple writes and is not reused as a construction transaction boundary. A persistent receipt or store-to-site transfer is therefore **not verified or enabled** by this slice.

The store-to-site transfer preparation/dispatch workflow is now implemented as a separate local-only slice; see [`CONSTRUCTION_TRANSFER_PREPARATION_SLICE.md`](CONSTRUCTION_TRANSFER_PREPARATION_SLICE.md). It does not use the client-side transfer sequence or move stock. Any persistent or posting path still requires approved business/site/location scope and a server-atomic, retry-safe dispatch/receipt command, including in-transit, partial receipt, exception, idempotency, and concurrency behavior.

## Verification boundary

Focused unit and UI tests prove local validation, editing, status presentation, business-context clearing, and the absence of API/storage calls. They do not prove database authorization or live stock integration. The workspace currently has no `supabase`, Docker, or PostgreSQL executable available for an isolated migration/RLS test run; no remote environment was inspected or changed.
