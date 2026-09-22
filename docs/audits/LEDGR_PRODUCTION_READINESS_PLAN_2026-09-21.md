# Ledgr — Production-Readiness Remediation Plan

**Date:** 21 September 2026  
**Status:** Proposed plan only — no implementation, production access, deployment, database changes or test execution performed.  
**Basis:** [Architecture and Product-Structure Audit](LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md), reviewed revision `2e0ede303634d753710357077823eeafb9ecfb7d`.

## 1. Objective and release position

**Objective: establish a defensible, commercially useful paid release without rebuilding Ledgr or developing new vertical modules.**

Preserve React/Vite, Supabase/PostgreSQL, the financial domain, repositories, existing financial calculations, the semantic offline queue, and the AI provider/context abstraction. POS remains an optional input channel over shared finance and inventory.

The audit found source-level security and integrity defects, not proof that every defect is deployed or has been exploited. Production readiness must therefore begin with environment verification and containment, then targeted corrections and evidence-based release gates.

### Recommended commercial position

- Continue sales conversations, demonstrations using synthetic data, and onboarding preparation.
- **Do not add paying production tenants while the global privilege-escalation, identity-reset and AI-access exposures remain unverified or uncontained.** A finance-only or owner-only interface does not remove those backend risks.
- Once universal gates pass, release a narrow **finance-first paid offering** if its supported workflows pass the finance tests.
- Release **POS**, **offline selling**, **branch-restricted access**, **AI insights**, and **public integrations** only when their additional gates pass. They need not all ship together.
- Protect existing customers with targeted containment and reconciliation; do not delete their unsynced transactions or force an unnecessary migration to a replacement system.

**Definition of readiness:** an enabled workflow is authorized, tenant-safe, financially correct, recoverable, observable, and supported by an explicit customer promise. A hidden button, green unit suite or successful deployment is insufficient.

---

## 2. Scope: required now versus deliberately deferred

### Universal launch blockers

1. Privileged-profile and account-recovery authorization.
2. Anonymous/null-UID AI RPC exposure and any other globally reachable privileged paths.
3. Tenant and role enforcement on every reachable write/read surface in the launch scope.
4. Reproducible database invariants and correct financial posting for enabled workflows.
5. Protected billing state, working paid activation/expiry and enforceable advertised entitlements.
6. Reconciled customer data, a tested restore path, monitored failures and a reproducible release test gate.
7. Local-cache confidentiality wherever authenticated business data is cached.

### Conditional launch blockers

| Capability offered | Additional blockers |
|---|---|
| POS sales | Real branch/location/stock, trusted pricing/discount controls, sale-to-shift association, correct tender/stock/COGS posting, safe sale corrections |
| Cashier access | Server-enforced safe catalog/history projections; no costs/company financial data; genuine manager approval |
| Branch-restricted access | Server-enforced read/write/report/AI scope, including explicit treatment of unassigned records |
| Offline financial capture | Actor-bound queue, safe account switching, exclusive replay claims, retry completeness, quota/stock/late-shift policy |
| AI financial insights | Role-scoped context, denied unauthorized direct RPC access, canonical metric definitions, cost control and provenance |
| API/webhooks | Paid entitlement, authorization scope, pagination/idempotency, truthful documentation and trusted event delivery |
| Automated recurring invoices/reminders | Complete document generation, retry safety, delivery proof and monitored schedules |

A capability may be deferred only if it is **server-disabled or otherwise unreachable through all relevant paths**, existing customer use is safely handled, and marketing/contracts do not promise it. UI hiding is not containment. APIs, RPCs, cached PWAs and offline queues must be considered.

### Not part of this remediation

NGO/grants, construction job costing, procurement, restaurant operations, advanced custom-role designers, new pricing tiers, a general plugin framework, microservices, a new database, or multiple autonomous agents. Enterprise SLA commitments also wait for operational evidence.

---

## 3. Governance and decisions required before implementation

Assign the following responsibilities; one person may hold multiple roles, but critical security and accounting changes need a second reviewer.

| Role | Responsibility |
|---|---|
| Product/release owner | Define launch promises; approve scope reductions, pilot entry and commercial rollout |
| Backend/security lead | Authorize access-control decisions; own RLS/RPC/Edge hardening and security evidence |
| Finance/domain reviewer | Approve journal/tax/cost/refund rules and reconciliation outcomes |
| Frontend/offline lead | Own supported client behavior, cache/queue identity and PWA compatibility |
| QA/release engineer | Own reproducible tests, failure injection, migration replay and release evidence |
| Operations/support owner | Own deployment inventory, backups, monitoring, incident response and customer recovery |

### Decision register

Resolve these before their dependent work; do not invent answers inside a coding task.

| ID | Decision | Recommended starting position | Needed for |
|---|---|---|---|
| DEC-01 | Initial paid release scope | Finance-first; POS/offline/AI/integrations released separately when ready | All release gates |
| DEC-02 | Who may recover a phone-login identity? | Tenant administrators must not reset an existing shared global identity merely because they know its number or manage one membership. Separate tenant invitations from account recovery. | R02 |
| DEC-03 | Role and branch access matrix | Owner organisation-wide; cashier sale/catalog/own-shift only; branch manager assigned scope; deny unspecified capabilities. Decide whether one or multiple branch assignments are required now. | R04, R08, R11 |
| DEC-04 | Required posting completeness | Required financial/subledger effects commit together. Where a failure cannot be completed immediately, preserve the accepted operation in a durable, visible exception state; never report it as fully posted. | R05–R07 |
| DEC-05 | Billable transaction and accounting period | Define a business-document unit independent of journal lines/tenders; specify which document lifecycle event consumes quota, bounded month/timezone and treatment of drafts, voids, credits, imports and backdating. | R10 |
| DEC-06 | Offline quota and expiry policy | Do not discard financial evidence already accepted offline. Use a bounded, authorized reconciliation path and meter it explicitly; never trust client timestamps as proof of entitlement. | R09, R10 |
| DEC-07 | Offline stock policy | For the initial deployment, explicitly permit reconciliation/oversell under controlled rules or restrict offline selling to a supported scope. Do not promise global stock consistency across disconnected terminals. | R06, R09 |
| DEC-08 | Closed-shift late arrivals | Preserve the original close and append a late-sale adjustment/reconciliation record rather than silently rewriting signed totals. | R08, R09 |
| DEC-09 | Supported PWA/queue versions | Define minimum safe client and payload versions, compatibility window and assisted recovery for older unsynced queues. | R04–R09, rollout |
| DEC-10 | Operational recovery objectives | Agree recovery time and acceptable data-loss objectives before selling an SLA; test the selected backup/PITR arrangement against them. | R14 |

The existing Free/Starter/Growth/Pro/Enterprise implementation must be reconciled with website and customer promises. This is a catalogue consistency decision, not a recommendation to change prices.

---

## 4. Remediation stages and release gates

### Stage A — Verify and contain

**Work:** R00–R03; establish the R13 test fixture early.

- Capture effective production/staging definitions read-only through approved operational access.
- Determine which audited defects are deployed and reachable.
- Apply narrowly scoped containment through a separately approved change process where required.
- Preserve relevant logs and establish whether incident investigation is necessary. A defect is not evidence of a breach.

**Gate A:** no known uncontained privileged-profile escalation, cross-tenant identity-reset path, or anonymous financial AI-context exposure. Evidence includes actual-role denial tests on a production-like environment and an effective-grant review. Global risks cannot be waived by limiting the pilot to trusted users.

### Stage B — Secure and stabilize the financial release

**Work:** R04–R05, finance-relevant R09, R10, R13–R14; begin R15 reconciliation.

- Correct trusted financial commands and required database invariants.
- Enforce role/tenant relationships on enabled paths.
- Make paid activation, expiry and protected entitlements dependable.
- Protect cached data, establish restore proof and integrate release tests.

**Gate B:** universal checklist passes; finance workflows reconcile; launch-excluded surfaces cannot bypass controls. This permits a **small finance-only paid pilot**, not automatic POS/AI/API approval.

### Stage C — Enable selected modules safely

- **POS gate C-POS:** R06–R08, cashier/branch parts of R04 and all relevant R13 tests.
- **Offline gate C-OFFLINE:** R09 plus inventory/quota/shift decisions and failure scenarios.
- **AI gate C-AI:** R03 containment completed, then R11.
- **Integration gate C-API:** R12, with entitlements and security tests.

These gates are independent where their dependencies allow. Do not delay safe finance sales to finish an unneeded integration.

### Stage D — Controlled rollout, then acquisition

**Work:** complete R15 against the intended customer cohort, with operations/support sign-off.

**Gate D:** a monitored pilot completes its representative operating cycle, all known critical defects are resolved/contained, all financial exceptions are explained and owned, and rollback/repair procedures have been exercised. Only then widen acquisition for that exact scope.

A production-readiness date should be set after Stage A establishes actual drift and active client/queue exposure. This plan does not claim a fixed delivery date without that information.

---

## 5. Prioritized work-package register

**Status of every item below: proposed, not started by this plan.** “Done” means evidence and sign-off, not merely a merged change.

| ID | Work package | Priority | Primary owner | Dependencies | Release scope |
|---|---|---|---|---|---|
| R00 | Deployment and exposure baseline | Critical | Operations + backend | None | Universal |
| R01 | Privileged fields and membership transitions | Critical | Backend/security | R00; containment need not await full inventory | Universal |
| R02 | Phone recovery and invitation identity | Critical | Backend/security | R00, DEC-02 | Universal if endpoint deployed; otherwise prove disabled |
| R03 | AI RPC authorization containment | Critical | Backend/security | R00 | Universal if RPC exposed; otherwise prove disabled |
| R04 | Tenant/role/branch enforcement | Critical | Backend/security | DEC-03; sequence with commands R05–R08 | Universal, with branch/cashier extensions |
| R05 | Financial command and database invariants | Critical | Backend + finance | R00, DEC-04, R13 fixtures | Finance |
| R06 | Inventory and POS sale integrity | Critical | Backend + finance | R05, DEC-07 | Inventory/POS |
| R07 | Returns, voids and real approval | Critical | Backend + finance | R05–R06, DEC-03/04 | POS corrections |
| R08 | POS branch, terminal and shift reporting | High | Frontend + backend | R04, R06–R07, DEC-08 | POS/branch scope |
| R09 | Cache, queue and offline recovery | High; confidentiality critical | Frontend/offline + backend | DEC-06/07/08/09; relevant commands | Cache universal; offline conditional |
| R10 | Subscription, payments and metering | High | Backend + product | R01, DEC-05/06 | All paid releases |
| R11 | Permission-aware AI and metric consistency | High | Backend + finance | R03–R05, R10 | AI insights |
| R12 | Public API and trusted webhooks | High | Backend | R04–R05, R10 | Integrations |
| R13 | Reproducible release test harness | High | QA/release | Start with R00; grows alongside fixes | Universal |
| R14 | Restore, observability and jobs | High | Operations | R00; command outcome contracts | Universal + enabled jobs |
| R15 | Data reconciliation and pilot rollout | High | Finance + release owner | Applicable gates above | Every customer cohort |

---

## 6. Work-package specifications and acceptance criteria

### R00 — Establish the deployed truth

**Evidence:** audit §§2, 10, 18; migration reconstruction and historical `artifacts/database/capture`; future-dated filenames do not prove deployment.

**Planned actions**

- Inventory frontend build, Edge Function versions, gateway use, applied migration IDs, effective RLS/policies, table/column/function grants, default privileges, trigger definitions and storage policies.
- Inspect scheduled jobs, actual invocation results and required secret **presence**, without exporting values into tickets or logs.
- Record enabled plans/modules, active POS installations, cached PWA versions and outstanding offline queues where discoverable. Ask deployment owners where telemetry cannot establish this.
- Compare a clean migration replay with staging and deployed definitions. Classify each difference as required invariant, intentional environment difference, obsolete object or unresolved drift.

**Done when:** a dated environment matrix identifies affected surfaces and owners; unknowns have explicit blockers; no “deployed” claim relies only on source or migration filenames.

### R01 — Protect privileged fields and role transitions

**Evidence:** `20260815000003_phase8b_rls_policies.sql`; `user_profiles.is_platform_admin`; broad membership writes; audit §§7, 13/S1.

**Planned actions**

- Prevent ordinary users from modifying platform-administration and other privileged lifecycle fields while retaining legitimate profile edits.
- Use restricted column grants and/or a narrowly authorized server path/guard appropriate to verified grants. Do not rely on withholding UI fields.
- Enforce owner/admin assignment rules at the database/API boundary, including direct membership insert/update and self-promotion.
- Review current privileged accounts against an approved allowlist and investigate unexplained changes through the incident process.

**Acceptance**

- Normal user can edit permitted name/language preferences but cannot become platform admin or fabricate privileged lifecycle state.
- Admin cannot self-promote to owner or assign a forbidden role through direct table access.
- Authorized platform administration still works; support access is explicit and auditable.
- Equivalent tests run as actual authenticated principals, not only service-role clients.

### R02 — Separate phone identity recovery from tenant administration

**Evidence:** `supabase/functions/invite-team-member/index.ts`, `accept-invite-link/index.ts`, `phone_accounts`, editable `user_profiles.phone`; audit §13/S2.

**Planned actions**

- Suspend unsafe existing-account password reset/adoption until target identity authority is established.
- Authorize recovery **before** any global auth account mutation. Merely adding the account to the caller's tenant must not manufacture recovery authority.
- Define safe handling for new phone accounts, existing accounts, never-signed-in accounts, shared identities, repeat invites and account recovery.
- Stop treating an editable profile phone as verified ownership for restricted invitation acceptance; redact invitation tokens from logs.

**Acceptance**

- Owner of tenant A cannot reset or obtain credentials for tenant B's phone-login identity, including never-signed-in users.
- A tenant admin cannot reset a shared global identity under a weaker policy merely because it has a membership in that tenant.
- Editing a profile phone cannot satisfy an invitation's identity restriction.
- Legitimate new-account provisioning and authorized recovery work, retry safely and produce audit records; temporary credentials are not persisted or logged as plaintext.

### R03 — Close AI RPC trust gaps

**Evidence:** `20260823000003_repair_ai_view_tenant_scope.sql`, `ai_context`, `supabase/functions/ai-chat/index.ts`; audit §§8, 13/S3.

**Planned actions**

- Inspect and explicitly restrict function execution, including PUBLIC/default grants; distinguish anonymous, authenticated and genuinely trusted service callers.
- Remove null UID as a proxy for service-role trust.
- Require tenant membership and the appropriate capability/scope for authenticated data retrieval. Preserve explicit authorized server-job behavior without creating a bypass for callers.
- Until role-specific contexts are implemented, reject inappropriate roles rather than send them full financial context.

**Acceptance**

- Anonymous/null-user direct RPC calls return no financial context.
- Tenant A cannot query tenant B by supplying its ID.
- Cashier and payroll-restricted users cannot retrieve forbidden finance/payroll summaries through RPC or chat.
- Authorized owner/finance contexts still load. Test both the direct database API and the Edge Function independently.

### R04 — Make tenant, role and branch restrictions real

**Evidence:** `usePermissions.ts`, `usePosPermissions.ts`, `src/types/pos.ts`, POS RLS migrations; member-wide tax/capital policies; audit §§6–7, 10/D2, 13/S4.

**Planned actions**

- Approve a minimal capability/action/scope matrix using existing roles as presets. No custom policy-builder framework.
- Audit all reachable tables/RPCs/Edge Functions for reads, inserts, updates, deletes, exports and AI access. Include tax/capital `FOR ALL` policies that permit nominal viewers to write.
- Enforce same-tenant parent/account/product/location/dimension relationships with scoped validation and tenant-qualified constraints where appropriate, after checking legacy data.
- Expose cashier-safe product/sale projections; do not fetch cost fields and merely hide them.
- Enforce selected branch scope server-side; decide treatment of unassigned records and legitimate organisation-wide roles.
- Close direct cashier ledger/document mutation only after safe commands and compatible clients exist. During transition, do not advertise the old broad path as least-privilege.

**Acceptance**

- Every denied matrix cell is exercised through direct requests as well as UI navigation.
- A row with tenant A's `business_id` cannot reference tenant B's parent, account, branch, product or location.
- Cashier cannot read costs/company journals or change POS settings/another cashier's shift; viewer cannot mutate tax/capital records.
- Assigned branch manager cannot read, write, export or ask AI about other branches; unknown scope fails closed.

### R05 — Make the financial core reproducible and trustworthy

**Evidence:** `JournalRepository.ts`, `journalService.ts`, `quickSaveService.ts`, quick-save RPC migrations, assumed integrity triggers; audit §§3, 10/D1–D5.

**Planned actions**

- Verify existing live guarantees before adding triggers or commands: duplicate balance-maintenance mechanisms can double-post.
- Version the required balance, period-lock, posting-state, payment-lifecycle and tenant-reference invariants.
- Map each enabled document/payment/journal workflow to a trusted command. Reuse existing RPCs where possible rather than introduce a new application backend.
- Derive actor identity server-side. Validate required monetary fields, currency/rate, totals and allowed account usage; do not treat “debits equal credits” as complete validation.
- Make accepted operations idempotent. A retry with the same key and different financial intent must be rejected or explicitly resolved, not silently return an unrelated result.
- Define posting completeness and durable failure state. Do not swallow a required posting failure and report success.

**Acceptance**

- Fresh migration-only database and staging enforce the same supported invariants.
- Unbalanced, closed-period, cross-tenant and unauthorized posted edits fail via direct access.
- Invoice/expense/payment/payroll/manual journal paths included in the launch scope produce approved journals and settle correctly.
- Lost responses and simultaneous retries do not duplicate documents, payments or postings.
- Failure injection leaves either a complete posting or a visible recoverable operation—not an unexplained half-posted success.

### R06 — Correct inventory and POS sale posting

**Evidence:** `InventoryRepository.ts`, `inventoryJournalService.ts`, `inventoryValuation.ts`, `post_pos_sale`, `_ledgr_complete_pos_sale`; audit §4 and §10/D1.

**Planned actions**

- Version one authoritative stock-movement→balance mechanism and test concurrent sales/receipts. Do not install a second updater alongside an unknown live trigger.
- Use actual branch/location balances and functional-currency weighted-average costs; remove the stock-100 placeholder.
- Validate allowed prices, discounts, tax, tenders, products, location and caller/shift association at the server boundary.
- Correct the COGS exception/replay gap: stock-exists must not imply COGS-complete. Surface errors rather than returning unconditional empty warnings.
- Make unknown/missing cost, location or tender-account mapping explicit exceptions or approved policy outcomes, not silent zero-cost/cash substitutions.

**Acceptance**

- Known-cost purchase→sale moves quantities, valuation and COGS exactly once and reconciles to the GL.
- Service/nonstock sales do not require inventory effects.
- Cash, bank, mobile-money recording, split tender, credit and discounts produce expected settlements. Labels do not imply gateway confirmation.
- Concurrent sale of the final unit follows the approved stock policy.
- Retrying after a COGS failure completes missing effects without duplicating prior effects.

### R07 — Make approval, refunds and voids safe

**Evidence:** `PosManagerApprovalModal.tsx`, `PosPage.handleManagerApproved`, `posService.processReturn/processVoid`, quantity constraints; audit §4.3.

**Planned actions**

- Remove the false approval guarantee immediately through an approved containment release; replace it with actual server-verified authority before enabling restricted actions.
- Bind approval to the operation, tenant, amount/discount and authenticated approver, with expiry and replay protection. Do not merely validate a four-character PIN in the browser.
- Implement correction commands using the existing document/journal model, preserving original currency, tax and inventory cost.
- Track cumulative quantities/amounts already returned; distinguish an unpaid cancellation, credit note and paid refund.
- Keep nonnegative quantity constraints where appropriate; represent credit direction intentionally rather than removing constraints simply to accept today's negative payload.

**Acceptance**

- Fabricated/reused/cross-tenant approvals fail; authorized approvals are audited.
- Full/partial returns and repeated requests reverse correct revenue, VAT, receivable/cash and COGS/stock effects exactly once.
- Over-return and refund-above-original-settlement are rejected or routed through a documented authorized exception.
- Void does not leave payment, inventory or drawer totals inconsistent.

**Scope option:** omit self-service refunds/voids temporarily only with server blocking and a tested authorized support correction process. Do not launch a till with no safe way to correct a genuine error.

### R08 — Establish trustworthy till context and shift reporting

**Evidence:** `PosPage.tsx`, `PosRepository.ts`, `posReportService.ts`, `InvoiceRepository.LIST_SELECT`; audit §§4, 9.

**Planned actions**

- Configure a real tenant branch and stock location; replace the UI-only register identity with the minimum durable terminal association needed for the offered deployment.
- Persist POS sale/channel/shift association without making every finance invoice a POS sale.
- Prevent duplicate open shifts according to the approved terminal/cashier policy.
- Build history/close reports from complete authorized records and tenders, not the latest 30 generic invoices or omitted list fields.
- Make cash movements/concurrent shift totals reliable; preserve closed reports and record late arrivals separately.

**Acceptance**

- Non-POS invoices are excluded from shift totals.
- Report totals, per-method receipts, refunds and expected drawer reconcile to complete underlying records.
- Cashier and branch scopes are enforced by the query, not a client filter.
- Restart, duplicate shift open, late sale, refund and cash movement scenarios cannot silently overwrite a signed close.

### R09 — Secure local data and recover offline operations

**Evidence:** `vite.config.ts`, `src/main.tsx`, `queryPersister.ts`, `src/offline/*`, `useSyncQueue.ts`; audit §12.

**Planned actions**

- Review every cache layer, not only TanStack Query: Workbox responses, IndexedDB, drafts, browser storage and in-flight requests.
- Partition or safely invalidate by identity/tenant/permission changes. Decide whether sensitive financial HTTP responses should be cached at all for the launch scope.
- Bind queue operations to authenticated originator/tenant/device context while preserving their original idempotency key and evidence. Server derives the replay actor and verifies authority; stored client actor fields are not trusted authorization.
- Quarantine legacy ambiguous ownership for assisted recovery rather than assigning it to whoever logs in next.
- Introduce a safe cross-tab claim/lease and crash recovery; replay only authorized partitions.
- Preserve incomplete operations visibly and apply approved stock/quota/closed-shift policies. Existing accepted business facts must not be silently deleted by logout, upgrade or plan enforcement.

**Acceptance**

- User/account/role switch cannot reveal prior users' cached costs, reports or documents.
- Another user cannot silently replay or inspect an earlier user's queue; an authorized recovery path exists for legitimate orphaned work.
- Two tabs, app termination after server commit, expired session and revoked membership do not duplicate or misattribute operations.
- Offline accepted sale→reconnect→ledger/stock/payment reconciliation passes; conflicts remain visible until resolved.
- App update and queue migration retain original keys and recoverability. No promise of background posting with all browser clients closed.

### R10 — Protect subscription revenue without losing customer records

**Evidence:** `src/lib/billing/plans.ts`, `UsageService.ts`, usage RPCs, subscription Edge Functions and tier-change trigger; audit §14.

**Planned actions**

- Protect plan expiry and commercial fields, not only upward tier changes; retain authorized paid/manual transitions.
- Centralize an effective entitlement decision including expiry, with equivalent enforcement on high-value backend features.
- Verify gateway status, expected amount, currency and reference. Treat transient verification failure as retryable/unresolved rather than irrevocably failed payment.
- Define quota semantics, then enforce them consistently through trusted paths. Use transactionally safe organisation-period consumption/reservation for exact online limits; do not blindly add independent counters to each feature.
- Separate paid-feature enforcement from financial recovery. Make offline overage/reconciliation bounded, authenticated and metered so it cannot become an arbitrary client-asserted quota bypass.
- Reconcile plan catalogue and customer messaging; do not move roles to Enterprise solely because current copy says so.

**Acceptance**

- Direct owner/admin updates cannot extend expiry or fabricate an upgrade.
- Duplicate/out-of-order callbacks do not extend incorrectly or activate the wrong plan; amount/currency mismatch cannot activate a subscription.
- Delayed expiry cron cannot grant indefinite paid capability.
- Concurrent saves at the quota boundary follow DEC-05; retries are not double-counted.
- Backdated/future/draft/void/credit/import/payroll/manual journal treatment matches the approved definition, rather than accidental date-query behavior.
- Existing accepted offline transactions can be reconciled without silently losing the sale or granting unrestricted new use.

### R11 — Make AI a safe, accountable optional layer

**Evidence:** `src/lib/ai/*`, `supabase/functions/ai-chat`, `support-agent`, `suggest-bank-matches`, `v_ai_*`; audit §§8–9.

**Planned actions**

- Build authorized contexts with finance/branch scope; separate support help from business intelligence.
- Reconcile AI definitions with reports: document sales are not necessarily GL revenue/profit; identify forecast assumptions, currency and as-of time.
- Use shared deterministic calculations where practical; do not give the model arbitrary SQL/service-role tools.
- Meter organisation usage/provider cost atomically enough for the selected budget; fail safely for expensive AI calls while preserving non-AI finance functionality.
- Record minimal privacy-aware provenance: model/prompt version, authorized scope, metric basis/timestamp and outcome. Define retention and provider data handling before broad use.

**Acceptance:** denied roles cannot infer excluded data through alternate questions; numbers match their named metric basis; unavailable/stale data is labeled; cost limits work under concurrent users; no autonomous mutations occur.

**Scope option:** keep remote financial AI server-disabled while core subscriptions launch; local/support features must still respect confidentiality.

### R12 — Make API and webhooks truthful and safe

**Evidence:** `supabase/functions/api`, `create-api-key`, `webhook-dispatcher`, `retry-failed-webhooks`; `public/openapi.json`; audit §11.

**Planned actions**

- Match documentation to supported endpoints; do not advertise disabled invoice/expense creation as operational.
- Enforce paid entitlement, meaningful integration permissions, revocation and tenant binding. Add only required endpoints through the trusted commands.
- Establish explicit pagination/completeness and retry-safe write contracts; correct shared-IP versus authenticated rate-limit behavior.
- Stop signing browser-authored financial event claims as authoritative events. Record trusted events with stable IDs alongside the originating transaction; use a small Postgres outbox rather than a new messaging platform.
- Consolidate delivery/retry authentication and completion semantics; retain signature/HTTPS/private-network protections.

**Acceptance:** Free/expired/revoked/incorrectly scoped keys are denied; list extraction is complete; duplicate writes/events are safe; members cannot forge signed financial events; job retries authenticate correctly and do not endlessly redeliver completed events.

**Scope option:** disable customer integrations server-side and defer this package if they are not promised or actively used.

### R13 — Make release evidence reproducible

**Evidence:** `tests/database/*`, `vitest.config.ts`, `.github/workflows/ci.yml`; audit §18.

**Planned actions**

- Make existing database tests portable and reproducible instead of relying on an external `/tmp/pgtest` setup, absolute repository paths or undeclared dependencies.
- Include migration replay, effective grants/RLS and posting tests in the actual release gate; retain existing useful unit tests.
- Test real role/JWT behavior; service-role setup is acceptable for fixtures, not for proving RLS denial.
- Exercise representative browser/offline and failure scenarios, not only mocked repositories.

**Acceptance:** a clean CI environment can run the declared suite; intentional forbidden access and partial-posting regressions make the gate fail; evidence identifies the exact revision and environment. Necessary test tooling is a later implementation decision, not installed by this plan.

### R14 — Make operation and recovery credible

**Evidence:** job migrations, `scripts/verify-backup.sh`, existing loggers/Sentry; audit §§2, 11, 14, 18.

**Planned actions**

- Verify and monitor actual job execution, not merely scheduled definitions. Replace deployment placeholders through approved configuration procedures, without recording secrets in source.
- Test backup restoration including the database definitions, grants and business reconciliation; document how auth identities, storage objects and provider configuration are restored or re-established.
- Distinguish a complete operational backup from a capped customer CSV/JSON export.
- Monitor incomplete postings, reconciliation variance, queue age, failed subscription verification, job lag, repeated webhook delivery and authorization anomalies.
- Add support runbooks for paid-but-not-active, duplicate/lost-response sale, stale queue, closed-shift late sale, inventory discrepancy and suspected unauthorized access.
- Validate optional recurring invoice/reminder automation end-to-end or disable it; rows in a delivery-events table are not proof of delivery.

**Acceptance:** approved recovery objectives are demonstrated in a disposable environment; jobs have last-success/failure evidence and an owner; alerts reach a responsible person; sensitive data is not copied into logs/tickets.

### R15 — Reconcile historical data and run a controlled pilot

**Evidence:** audit §§4, 9–10, 19; existing inventory/statement integrity tools.

**Planned actions**

- Reconcile per tenant before and after correction: document/line totals, payments/settlements, journal balance, stock movement/balance/GL value, POS close totals, subscription state and unresolved offline records.
- Identify duplicates, missing COGS, orphaned documents, invalid tenant references and incomplete reversals. Correct with explicit approved adjustments/recovery commands, not silent deletion or blanket replay.
- Start with a small opt-in cohort representative of the promised release. POS/offline pilots need real operational scenarios and support coverage, not only demo data.
- Produce customer-specific exception lists and support instructions; do not claim all historical records fixed because new writes pass.

**Acceptance:** no unexplained material reconciliation differences; every remaining exception is classified, owned and outside any misleading “complete” report. Product, finance, security and operations sign off before expansion.

---

## 7. Dependency order and parallel work

```text
R00 deployment/exposure baseline ────── R13 reproducible test fixtures
        │                                      │
        ├─ R01 privileged fields               │
        ├─ R02 identity recovery               │
        └─ R03 AI access containment ────────── Gate A

R04 permission/scoping design ↔ R05 trusted finance/invariants
        │                              │
        │                              ├─ R06 inventory/POS sales
        │                              │       ├─ R07 corrections/approvals
        │                              │       └─ R08 shifts/branches/reports
        │                              └─ R12 API/event commands (if enabled)
        └─ final policy narrowing AFTER supported command/client rollout

R09 caches + queue contracts ── coordinates with R05–R08 and R10
R10 billing/entitlements ────── can progress alongside financial hardening
R11 safe AI ────────────────── after R03 + scoped, defined financial metrics
R14 operations/restore ─────── progresses from R00 throughout
R15 reconciliation/pilot ───── after applicable gates; feeds controlled expansion
```

**Do not:** revoke cashier writes before supported clients have an authorized alternative; add a second stock trigger without inspecting the first; replay historical sales wholesale; clear IndexedDB to “fix” queues; or implement a new role/plan matrix independently in four layers.

Containment of a security vulnerability does not wait for full feature remediation. An unsafe feature may have to become temporarily unavailable rather than retain unsafe access for compatibility.

---

## 8. Acceptance test matrix

Use two unrelated tenants, a multi-membership identity, two branches per relevant tenant, real restricted roles and known financial fixtures. Execute against both fresh replay and production-like staging. No destructive security test is proposed against real customer accounts.

| ID | Scenario | Required result | Packages |
|---|---|---|---|
| T01 | Own-profile privileged field update; admin self-promotion | Denied; legitimate profile/team edits still work | R01 |
| T02 | Owner A resets B's phone identity, including never-signed-in/shared user | Denied before identity mutation; no credential returned | R02 |
| T03 | Phone restriction satisfied only by editable profile value | Denied | R02 |
| T04 | Anonymous/null-UID/cross-tenant AI calls, direct and Edge | No unauthorized data | R03, R11 |
| T05 | Cashier reads cost/profit/journals or changes settings; viewer writes tax/capital | Denied via all direct paths | R04 |
| T06 | Mixed-tenant foreign keys and branch manager outside scope | Denied for create/update/read/export/AI | R04 |
| T07 | Unbalanced/closed-period/posted-entry mutation through direct database API | Denied; supported correction succeeds | R05 |
| T08 | Same-key duplicate, concurrent retry, same key/different payload | One intended effect; conflicting intent rejected | R05–R07 |
| T09 | Known-cost receipt→sale→partial return→void/correction | Approved document, tax, cash, stock and GL control totals | R06–R07 |
| T10 | COGS/stock/tender failure, response lost after commit | Recoverable truthful state; no duplicate/missing required effect | R05–R07 |
| T11 | Forged/stale/reused manager approval | Denied; valid approval auditable | R07 |
| T12 | More than 30 sales, non-POS invoices, split payments, concurrent cash movement | Complete shift report; no unrelated invoices; correct per-method totals | R08 |
| T13 | Logout/user switch/role downgrade with cached data | No prior forbidden data disclosed; accepted queue retained safely | R09 |
| T14 | Two tabs replay; app terminated mid-sync; different current user | No duplicate or silent actor substitution | R09 |
| T15 | Two disconnected tills sell last unit; reconnect after quota/shift/expiry boundary | Approved conflict/reconciliation policy, no lost transaction | R06, R08–R10 |
| T16 | Direct plan expiry edit; expired entitlement with cron stopped | Edit denied; effective access correct | R10 |
| T17 | Wrong payment amount/currency, duplicate/out-of-order callback, gateway timeout | No false activation; legitimate payment recoverable | R10 |
| T18 | Concurrent exact-quota saves; document-date/lifecycle edge cases | Matches agreed billable-unit policy; no retry double-count | R10 |
| T19 | AI facts versus GL/document metric, wrong currency, missing/stale data | Correct named basis and scope; assumptions/limitations visible | R11 |
| T20 | Revoked/expired API key, large list, retrying write, forged event | Authorization and completeness correct; no fabricated signed event | R12 |
| T21 | Webhook retry job and duplicated event delivery | Authorized dispatch, stable dedupe identity and completion | R12, R14 |
| T22 | Restore from backup; replay all required migrations; run critical commands | Definitions, permissions and financial controls recover as documented | R13–R14 |
| T23 | Enabled scheduled job fails or misses schedule | Visible failure and actionable alert, no silent entitlement drift | R14 |

Report monetary tolerances must be explicitly approved by the finance reviewer. “Within tolerance” must not hide missing postings, omitted pages or incorrect tax treatment.

---

## 9. Safe migration and existing-data plan

1. **Capture and back up:** approved read-only inventories; verified backup/recovery path before modifying data or invariants.
2. **Measure drift:** locate mixed-tenant references, historical negative/invalid quantities, missing journals/COGS, duplicate keys, mismatched balances and legacy queue formats.
3. **Agree corrective policy:** distinguish corrupted records from supported legacy conventions. Finance approves corrections; security approves any access exceptions.
4. **Prefer additive changes:** new safe command/projection, metadata or guard first. Evaluate lock duration and operational impact before new constraints/indexes.
5. **Backfill deliberately:** tenant-scoped, bounded, restartable and reconciled. Preserve original records and source links. No guessed actor/shift assignment for ambiguous historical sales.
6. **Validate constraints:** legacy violations remain a tracked debt item; adding a `NOT VALID` constraint is not proof existing data is clean. Validate only after reconciliation.
7. **Switch supported clients:** deploy against backward-compatible server interfaces where safe; explicitly handle queued older payloads.
8. **Narrow privileges and retire fallbacks:** after compatibility gates pass, block obsolete write paths. Security containment may require earlier unavailability; never retain a known unsafe path merely to avoid an upgrade prompt.
9. **Reconcile again:** compare control totals and exception counts before and after each batch/release.

All implementation should remain on the session's assigned branch when authorized. Production changes require a separate reviewed rollout; creating this document does not authorize them.

---

## 10. Rollout, rollback and stop conditions

### Rollout sequence

1. Reproduce on isolated fixtures and clean schema.
2. Deploy to staging with realistic role/grant configuration.
3. Obtain backend/security and finance review for applicable changes.
4. Exercise older supported client and pending-queue compatibility.
5. Apply approved production containment/additive changes; run non-destructive authorized smoke checks.
6. Enable for the smallest suitable pilot cohort; monitor a representative operating cycle.
7. Expand only the capabilities whose gate passed.

### Rollback rules

- Roll back a frontend or optional feature only to a **known-safe** version; do not restore privileged grants or vulnerable identity behavior.
- Prefer server-side disablement and forward repair over reversing financial migrations or deleting newly written transactions.
- Preserve unsynced queues and committed operation keys. A frontend rollback must not create a second interpretation of the same sale.
- Restoring a database is a last-resort incident action because it can lose later customer transactions; it requires the recovery procedure, point-in-time assessment and reconciliation of external payments/offline devices.
- Keep a deployment-specific stop/repair runbook before each high-risk database change.

### Immediate stop conditions

- Any unauthorized cross-tenant read/write, credential recovery or privileged escalation.
- A duplicated/lost sale/payment, unexplained unbalanced journal or stock/GL divergence.
- Accepted transactions becoming inaccessible or replayed under the wrong identity.
- Incorrect paid-plan activation, stranded verified payment or manipulated entitlement.
- A required job/restore/monitoring failure that prevents safe recovery.

Pause the affected rollout or operation; preserve evidence, assign an incident owner, reconcile impact and resume only with a verified corrective action. Do not “fix” an accounting incident by suppressing its warning.

---

## 11. Observability and operational evidence

Use existing logging/Sentry and database facilities before buying new infrastructure. Threshold values must be set against the chosen launch workload and support capacity, not invented as an Enterprise SLA.

| Signal | Required response |
|---|---|
| Unauthorized privileged change or cross-tenant probe succeeds | Immediate incident escalation and containment |
| Required posting effect incomplete | Visible operation exception; alert owner; prevent false success/report certification |
| Stock subledger versus GL or payments versus settlement variance | Tenant-scoped reconciliation task with financial owner |
| Queue age/retry/conflict growth | Notify responsible user/support; retain evidence and recovery options |
| Gateway success without plan activation / verification backlog | Billing reconciliation and customer support action |
| Entitlement expiry lag or failed schedule | Effective entitlement still correct; operations fixes the job |
| Missing webhook event or repeated delivery | Stable event tracking and retry/dead-letter ownership |
| AI cost spikes / denied data scope | Cost limiter and security monitoring; core finance remains available |
| Backup/restore verification failure | No expansion/SLA claim until corrected |

Every required operation should be traceable by tenant, authenticated actor, command/client key, command status and affected record IDs. Do not log passwords, invite tokens, API keys, complete financial documents or unrestricted AI contexts to general telemetry.

---

## 12. Release evidence pack and definition of done

Each work package must produce:

- Finding IDs/audit sections addressed and exact affected paths/functions/policies.
- Verified deployed exposure and intended invariant; no assumptions masquerading as facts.
- Reviewed change and any migration/backfill/compatibility notes.
- Automated positive, negative, retry/concurrency tests appropriate to the finding.
- Staging evidence with revision/environment and actual restricted principals.
- Reconciliation results for affected data and approved exception list.
- Deployment, containment/rollback and support instructions.
- Named review/sign-off and remaining limitations.

### Universal production checklist

- [ ] Gate A security exposures resolved or provably server-contained.
- [ ] Enabled operations match the approved tenant/role matrix; disabled surfaces cannot bypass it.
- [ ] Critical schema invariants reproducible on clean replay and verified in deployment.
- [ ] Enabled financial workflows and direct-access denial tests pass.
- [ ] Historical data reconciled; no unexplained material exceptions represented as complete.
- [ ] Paid activation, expiry, protected fields and quota semantics tested.
- [ ] Local cache confidentiality verified for supported device/account flows.
- [ ] Backup restore, job monitoring and incident/support ownership demonstrated.
- [ ] Marketing/plan copy matches enabled behavior; unsupported automation/integrations not promised.
- [ ] Product, security, finance and operations approve the release scope.

Then apply the separate POS/offline/branch/AI/API checklists embodied by their work packages. A finance-only checklist must not be reused as a blanket platform certification.

**Risk acceptance:** no waiver for known account takeover, tenant data leakage, unaudited privileged escalation or unexplained financial loss/duplication. A noncritical issue may be deferred with an owner, customer impact, containment, deadline and retest condition. A conditional feature may remain off rather than block an unrelated safe release.

---

## 13. What follows after readiness—not before it

Once the selected paid scope is stable:

- Consolidate duplicated permissions and calculation definitions as touched areas demand.
- Add small organisation-module settings and expand reporting contracts; preserve existing roles as presets.
- Complete deferred API/AI automation or document/budget capabilities only for validated customer demand.
- Add Projects, NGO/Donor or Procurement one at a time, using the secured shared tenant/ledger/reporting contracts.

**Success is not completing the most tickets. It is making a defined set of workflows safe enough that businesses can subscribe, operate and trust their records—and that Ledgr can support and recover those workflows reliably.**
