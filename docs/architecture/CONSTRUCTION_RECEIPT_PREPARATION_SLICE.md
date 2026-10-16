# Construction material receipt preparation — first Phase 2 slice

**Status:** Application workflow implemented as an in-memory, non-posting preparation only. This is not a saved or live-integrated receipt workflow. **ADR `INV-CM-001` remains proposed, not accepted.**

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
