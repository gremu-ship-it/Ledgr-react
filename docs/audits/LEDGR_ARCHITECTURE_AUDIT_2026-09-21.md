# Ledgr — Architecture and Product-Structure Audit

**Audit date:** 21 September 2026  
**Repository:** `gremu-ship-it/Ledgr-react`  
**Reviewed revision:** `2e0ede303634d753710357077823eeafb9ecfb7d`, checkout branch `arena/01a0c215-ledgr-react`  
**Mode:** Read-only implementation audit. No application code, migrations, configuration, or dependencies changed. This report is the only added deliverable.

## Evidence and limits

The review inventoried 780 tracked files and 85 SQL migrations, then traced the implementation across the React application, repositories/services, Supabase functions, migration history, database capture artifacts, offline queue, gateway, and test/deployment configuration. Existing audit documents were not treated as proof of current behavior. In several important cases, implementation contradicts comments or advertised capabilities.

Evidence labels used below:

- **Implemented:** executable source/schema exists. This does not mean deployed or production-tested.
- **Schema only / partial:** a table, type, screen, or fragment exists, but the complete workflow does not.
- **Confirmed source defect:** the reviewed implementation demonstrates the issue; production exposure still depends on deployment and effective privileges.
- **Deployment verification required:** current database grants, triggers, applied migrations, secrets, jobs, or provider configuration must be inspected before certifying production.
- **Recommended:** future work, not an existing capability.

No production or staging service was accessed. No live data was modified, credentials printed, or exploit executed. The workspace has no installed application dependencies, `psql`, or embedded-Postgres harness. Accordingly, I did **not** run the build, Vitest suite, database replay, browser journeys, or load tests. I ran dependency-free source assertions for 12 central findings and searched migrations for the corresponding missing protections. The checked-in database capture is historical evidence, not a live attestation. A limited tracked-source scan found no private-key blocks, credential-shaped JWT literals, or the provider-token patterns checked; this is not a complete secret/history scan.

**Date caution:** the checkout already contains migrations named `20260922…` through `20260925…`, later than the audit date. They are included in this source audit. Their filenames do not establish that they have been applied anywhere.

---

## 1. Executive Summary

### Verdict

**Ledgr is a finance-first business application with an emerging commerce module—not a retail-only application. Keep the architecture and harden its boundaries. Do not rebuild it.**

The domain model is principally **B: financial/accounting-oriented**, with substantial **C: reusable multi-organisation foundations** and some **D: general business-management breadth**. It is not yet a safely enforced, configurable multi-vertical platform.

The most valuable foundation already exists:

- A business tenant with memberships, branches and departments.
- A chart of accounts, double-entry journal structure, invoices, expenses, separate payment records, tax, payroll, assets and financing.
- Products, location-based inventory, stock movements and transfers alongside—not replacing—the financial model.
- Repositories, reusable financial reporting logic, SQL views and an AI data-context contract.
- An installable frontend, durable semantic offline queue, document idempotency and an increasingly server-side posting path.

### Commercial recommendation

**Continue sales conversations, demonstrations and tightly controlled onboarding; do not aggressively expand paid production use until the security and accounting release gates in Phase 0 pass.** Existing customers should not be forced through a platform rewrite. If affected endpoints are deployed, first contain the narrow risky surfaces while fixing them.

The immediate blockers are not the absence of NGO or construction features. They are:

1. **Privileged access vulnerabilities:** self-profile updates encompass the platform-admin flag; phone-account reset lacks target-tenant authorization; `ai_context` trusts a missing user ID and lacks an explicit PUBLIC execution revoke.
2. **UI restrictions are stronger than server restrictions:** cashiers can still read broad financial data and have broad write paths; branch scope is not enforced.
3. **Financial/inventory invariants are not completely reproducible or enforced:** the repository assumes stock-update and ledger-integrity triggers it does not create; posting has legacy multi-request and partial-success paths.
4. **POS operational correctness is unfinished:** placeholder stock, null branch, unverified manager PIN, inconsistent refunds/voids and incomplete shift reporting.
5. **Entitlement enforcement is incomplete:** feature gates are mostly client-side, quota checks are not universal/serialized, and expiry depends on mutable fields and configured cron.

**No need now:** a new database engine, microservices, a plugin framework, separate applications per vertical, an event-streaming platform, or several autonomous AI agents.

---

## 2. Current Architecture

### 2.1 Implementation map

```text
React/Vite SPA and PWA
  ├─ pages/components, React Router, role/plan gates
  ├─ Zustand: selected business, user/UI state
  ├─ TanStack Query: remote state + IndexedDB persistence
  ├─ repositories + TypeScript posting/reporting services
  ├─ Dexie semantic offline queue → same repository/RPC paths
  └─ Supabase client
       ├─ Auth: sessions, passwords, TOTP
       ├─ PostgREST: direct table/view access governed by RLS
       ├─ PostgreSQL RPCs: provisioning, posting, numbering, AI context
       ├─ Storage: logos and data exports
       └─ Deno Edge Functions
            ├─ AI providers / support / bank-match suggestions
            ├─ subscription payments and PayChangu verification
            ├─ invitations, account lifecycle, exports
            ├─ public /api/v1 and webhook delivery
            └─ cron-invoked jobs

Optional Express gateway → public API Edge Function
Astro website + Zapier adapter: separate ancillary packages
```

### 2.2 Technologies actually present

| Layer | Verified implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, React Router 8, Tailwind 4, Lucide, React Hook Form/Zod, Recharts; `package.json`, `src/App.tsx`, `src/main.tsx` |
| State/data | Zustand, TanStack Query and query persistence; `src/store/useAppStore.ts`, `src/lib/queryClient.ts`, `src/lib/queryPersister.ts` |
| Backend | Supabase PostgreSQL/Auth/PostgREST/Storage, PL/pgSQL and Deno Edge Functions; `supabase/migrations`, `supabase/functions` |
| Optional gateway | Express 5, Helmet, CORS, rate limiting, Sentry, timeout/circuit-breaker support; `server/src/index.ts`. It is not the main accounting backend. Redis packages are dependencies, but the reviewed rate limiters do not instantiate a Redis store. |
| Offline | Dexie/IndexedDB, `vite-plugin-pwa`, Workbox, custom SW event companion |
| Documents/import | jsPDF/html2canvas, PapaParse, document generator and import/export services |
| Observability | Sentry browser/backend code, structured loggers, health routes, Vercel analytics/speed insights |
| Testing/delivery | Vitest and Testing Library; standalone database scripts; GitHub Actions; Vercel frontend, Supabase deployment, optional Railway/Render gateway |

### 2.3 Application and backend organization

`src/App.tsx` lazily loads page routes. `ProtectedRoute`, `isPathAllowedForRole`, `PlanGate`, navigation config and POS permission hooks provide overlapping UI access controls. `src/lib/repositories.ts` constructs domain repositories; `BaseRepository` centralizes CRUD, soft deletion and optional compare-and-set updates.

This is **not** a uniformly layered backend. Browser code both calls repositories and directly uses Supabase. Business rules are divided between pages, TypeScript services, repositories, RLS, triggers, RPCs and Edge Functions. That is workable for the present product, but the browser is not a trusted enforcement boundary.

`save_quick_sale`, `save_quick_expense` and `post_pos_sale` are useful moves toward atomic server commands. Other workflows still perform several browser-to-database writes. The Express gateway does not protect direct browser PostgREST/RPC calls.

### 2.4 Authentication, configuration, jobs, files and notifications

- **Authentication:** Supabase password/session handling; `src/pages/LoginPage.tsx` includes an enrolled-TOTP challenge flow. `MFASetup.tsx`, session management and inactivity controls exist. Phone login is an email/password account behind a synthetic phone-derived address, **not SMS ownership verification**.
- **Settings:** organisation fields on `businesses`; profile preferences on `user_profiles`; chart/tax/currency reference data; `pos_settings`; partner configuration and feature flags. `src/lib/featureFlags.ts` is build-time environment configuration, not organisation module activation.
- **File storage:** `SettingsPage.tsx` uploads business logos. `export-my-data/index.ts` writes private exports and returns signed URLs. `20260815000004_phase8b_storage.sql` recreates `business-logos` (public) and `user-exports` (private). Receipt/payslip/image URL fields do **not** establish a generic document-management module; no general supporting-document entity/upload workflow was found.
- **Jobs:** Edge Functions exist for subscription expiry/reminders, partner invoices, VAT returns, recurring invoice processing/reminder events, webhook retries and account deletion finalization. `pg_cron`/`pg_net` schedules and `scripts/cron-jobs.sql` exist. Some migration schedules contain project/secret placeholders: deployment must prove actual execution. There is no general durable background-job system.
- **Notifications:** Zustand notification store and `src/lib/notifications.ts`; tax alert records; email flows; SW push/click handlers. A SW push handler alone is not a complete push-subscription and server delivery system.
- **“Realtime”:** query invalidation/refetch is implemented; no production `postgres_changes` subscriptions were found in `src`. Dashboard queries have multi-minute stale times. Do not equate this with cross-terminal real-time updates.

---

## 3. Domain/Data Model

### 3.1 Entity relationships

Principal source: `supabase/migrations/20250101000000_base_schema.sql`, subsequent migrations, `src/dal/types/database.generated.ts`, `src/dal/types/database.ts`, and repository methods.

| Domain | Entities and actual relationship | Assessment |
|---|---|---|
| Organisation | `businesses` → `business_users` → auth user; `(business_id,user_id)` unique | Real tenant concept, reusable for noncommercial organisations despite the name |
| Identity | `user_profiles`, legacy `profiles`, auth users; `phone_accounts`; invitation tables and membership invitation fields | Identity separated from business membership, but duplicate profile/invitation paths and unsafe privileged fields |
| Structure | `branches.business_id`; `departments.business_id`, optional `branch_id`, `cost_centre`; membership has optional `branch_id` | Branches and departments already exist; dimensions are not authorization boundaries yet |
| Accounting | `accounts` with parent, type, subtype and normal balance; `journal_entries` → `journal_lines` → accounts; `accounting_periods` | Genuine financial core, not just transaction categories |
| Sales/income | `invoices` → `invoice_lines`; contact, branch, department, AR/revenue accounts, linked journal; credit-note link | Income is recorded as sales invoices, not a distinct generic `transactions` or `income` table |
| Purchases/expenses | `expenses` → `expense_lines`; supplier/contact, branch, department, AP account, approval metadata, linked journal | Useful beyond retail; approval fields are not a configurable approval workflow |
| Payments | `invoice_payments`, `expense_payments`; document FK, currency/FX, bank account, optional journal | Separated from documents; no single canonical generic payment entity |
| Parties | `contacts`, customer/supplier/both type, AR/AP accounts, tax/contact/credit details | Reusable customer/supplier model. Donor identity is not a first-class role. |
| Catalog | `products`, `product_categories`; product type, optional inventory tracking, account mappings, prices/tax codes | Productless invoice/expense lines and non-stock services are possible |
| Stock | `inventory_locations` → branch; `inventory_balances` unique by business/product/location; `stock_movements`; `stock_transfers` → lines | Location-based stock subledger, not POS-owned stock |
| POS | `pos_shifts`, `pos_cash_movements`, `pos_settings`; sales are ordinary invoices | No durable sale→shift/register relationship in the invoice schema; no persisted terminal registry |
| Budgets | `budgets` → `budget_lines`; lines reference accounts, branch, department; twelve monthly amount columns | **Schema exists**, but no active budget repository/page/workflow found in application source |
| People/payroll | `employees` separate from auth users; branch/department; allowances/deductions; `payroll_runs` → employee lines | Employees need not be application users; useful shared module |
| Assets/financing | `fixed_assets`, `asset_categories`, `depreciation_schedules`; `share_transactions` with shareholder metadata, `loans`, `loan_repayments` | Existing non-POS breadth; financial statement/journal integration; no separate shareholder master table established |
| Tax | `tax_configurations`, `paye_bands`, `tax_returns`, `tax_payments`, `tax_alerts` | Malawi-oriented financial/tax assistance; not verified MRA/EIS submission |
| Banking/FX | `bank_statements` → lines linked to journals; `currencies`, `exchange_rates`; original/functional amounts | CSV reconciliation and IAS-21-oriented fields/services, not live bank feeds |
| Commercial platform | `subscription_payments`, reminder records; `api_keys`, `api_usage`, `webhooks`, deliveries; partners/admins/clients/feature flags/invoices | SaaS/partner concerns separate from customers' accounting data |
| Audit/AI | `audit_log`; AI/support usage tables; `v_ai_*` views and `ai_context` | No persistent AI conversation/insight/provenance domain |
| Documents/reports/projects | URL fields and generated files; computed reports; invoice `project_code` text | **No** generic documents/reports store or project entity; `project_code` is not project accounting |

### 3.2 Financial model

`JournalRepository.createBalancedEntry` validates functional-currency debits versus credits. Posting/reversal services use journal source references and account codes. `FinancialStatementRepository` produces SOFP, P&L, cash flow and changes in equity from accounting data. Receivables/payables, VAT, PAYE, fixed assets, financing and inventory COGS are meaningful accounting features.

Important qualifications:

- `source_type` + text `source_id` is a flexible but non-FK source link, not a complete event model.
- Many postings depend on seeded codes such as `1131`, `4112`, `4130`, `2121`, `1141`, `5100` and `1110`. Configurable charts must preserve or explicitly map these functions.
- Inventory valuation uses weighted-average `average_cost` in functional currency, captured before stock release (`src/services/inventoryValuation.ts`, `inventoryJournalService.ts`); no FIFO/lots/serial-number stock layer was established. New receipts and offline/backdated movements need an explicit costing policy.
- Not every write path enforces balance, period lock, immutability and same-tenant references in PostgreSQL. A sound schema shape is not proof of a trustworthy ledger.
- Opening balances, document totals, amount paid, inventory balances and journal values are multiple representations requiring consistent posting and reconciliation.

### 3.3 Classification and suitability

**Primary classification: B, with a useful C foundation and incomplete D breadth.** Evidence against retail lock-in includes departments/cost centres, budgets, non-product expense lines, payroll, loans, assets, bank reconciliation and double-entry journals. POS-specific fields have not spread throughout every core table.

The stronger coupling today is to **SME commercial accounting and Malawi presentation**, not to POS: invoices as income, customer/supplier party types, fixed account codes, month-column budgets and pervasive MK/MWK labels. These are manageable evolution points, but a grant must not be disguised as a sale just because invoices are the easiest existing input.

---

## 4. POS Architecture Review

### 4.1 Sale data flow

Evidence: `src/pages/PosPage.tsx`, `src/services/posService.ts`, `src/services/posSaleRpc.ts`, `src/dal/repositories/PosRepository.ts`, `20260923000000_post_pos_sale_rpc.sql`.

```text
Cart + customer + tenders
  → normalizePosSale / buildPosSaleQueuePayload
  → postPosSaleViaRpc
  → post_pos_sale
       invoice + invoice_lines
       invoice_payments (one per tender)
       receivable/revenue/discount/VAT journal
       tender settlement journals
       stock movement + COGS journal
       shift aggregate update
  → receipt/UI refresh

Offline: same semantic payload → Dexie pos_sale → replay
Missing RPC/demo backend: commitPosSaleDocumentsLegacy → multiple requests
```

This is the correct **direction**: commerce is a source of financial facts, not the owner of the financial core. Existing document client keys and journal posting keys help prevent duplicate replay across RPC and legacy paths.

### 4.2 What is implemented—and what remains unsafe

| Area | Finding |
|---|---|
| Sale storage | Ordinary invoices/lines and invoice payments. No separate retail-only sales ledger. |
| Accounting | Receivable, sales/discount/VAT and payment settlement entries; tracked products can generate COGS. The RPC validates journal balancing and account tenancy via shared helpers. |
| Payment handling | Cash, bank, card/mobile-money labels and split tenders are recorded; credit sales create receivables. Tender mapping can fall back to cash. **Recording “Airtel Money” does not execute or verify a mobile-money transfer.** |
| Atomicity | The new RPC commits its successful writes together, but deliberately catches COGS failures. The fallback is a multi-request sequence. “Atomic RPC” does not mean every accounting effect is guaranteed. |
| Server validation | Role/tenant guard, positive total/FX, tender sum and quota check exist. Payload still supplies prices, discounts, tax, attribution and dimensions. Server does not fully recompute/authorize pricing, discount approval, branch or cashier ownership. |
| Branch | `PosPage.tsx:58` sets `const branchId = null`. Branch name is the business name. Repository/RPC branch support exists but the active screen is not a genuine branch-configured till. |
| Inventory display | `PosPage.tsx:222–223` maps every catalog product to stock quantity **100**. Cost price is fetched into the browser regardless of whether its UI is hidden. |
| Stock balance | Posting writes movements and assumes a stock-balance trigger. No migration creates that trigger; see §10. Missing location can also skip stock posting. |
| Cashier confidentiality | UI hides reports/profit, but membership-wide financial/product reads remain. Not a safe “POS-only, no profit” role. |
| Manager approval | Modal checks only PIN length; `handleManagerApproved(_managerPin, approverName)` ignores the PIN (`PosPage.tsx:297`). This is **not authentication or approval**. |
| Settings/shifts | POS tables use broad `can_write_business_data` policies; cashier sessions can alter settings/shift rows within the tenant through direct requests. No server-side cashier-owned shift policy. |
| Hardware | Barcode label generation and ESC/POS helpers exist in `src/lib/pos`. A hardware integration surface is not proof of tested terminal/device compatibility. |

### 4.3 Refund, void and replay defects

**Refunds are a release-blocking correctness issue if advertised.** `processReturn` in `posService.ts:1152+`:

- Writes negative invoice-line quantities, conflicting with `chk_invoice_lines_quantity_nonneg` in `20260817000001_phase10_nonneg_quantity_checks.sql`.
- Uses MWK/rate 1 and VAT zero rather than reversing the original tax/FX treatment.
- Returns stock at selling price (`unitPrice`) rather than original inventory cost.
- Does not post a complete refund/VAT/COGS reversal/payment journal in this function.
- Has no robust cumulative-return quantity check or operation idempotency key.

`processVoid` marks the invoice void, restores stock at invoice unit price and reverses only the linked sale journal; it does not systematically unwind all tender/COGS/shift effects. Errors are caught, permitting partial completion; repeated invocation can repeat stock effects. Both return/void ignore their `userRole` options.

**COGS repair gap:** `_ledgr_complete_pos_sale` places COGS posting inside `if not v_moved`. If movements commit but COGS posting is caught as a warning, a subsequent replay sees movements and skips this block. It does not reliably repair the missing COGS half, despite the migration's broader “completes the sale” commentary. `loadCommittedPosSale` additionally returns `warnings: []` on RPC success, so this exception is not faithfully surfaced to the till.

**Shift reporting gap:** sales are not durably linked to shifts/registers. The screen loads the most recent 30 business invoices and maps them into sales history without a POS-channel/shift filter. `InvoiceRepository.LIST_SELECT` also omits subtotal, discount, VAT, payment reference and creator fields that this mapping expects, causing missing/zero history details. `generateZReportSummary` consumes that supplied list; its payment breakdown fills cash from the shift and initializes other methods to zero. It is not an authoritative shift-close report. RPC replay returns before the normal new-sale shift update, and closed-shift late sync needs a reconciliation policy.

### 4.4 Direct answer

**Yes, POS can remain a module on a broader Ledgr platform.** Its reuse of invoices, payments, journals and inventory is structurally appropriate. Finish the trusted posting boundary and add module-owned sale/shift/terminal metadata rather than putting till assumptions into every financial record.

Retail/wholesale counter sales are the closest fit. Restaurants need orders/tables/kitchen/recipes; agro-dealers may need batch/expiry/UOM controls; those are future commerce extensions, not reasons to rewrite the financial core.

---

## 5. Multi-Vertical Scalability Review

**Configuration-only** below means existing supported screens/reference data, not hand-inserting unused schema rows or repurposing labels into unsupported workflows.

### A. NGO / donor-funded organisation

1. **Already supported:** organisation/users, departments/cost-centre labels, branches, chart of accounts, expenses/payments, payroll/assets, general journals, financial reports; budgets have schema but not an operational module.
2. **Configuration only:** account naming, departments, currencies, contacts, financial year and tax configuration. Basic unrestricted-fund bookkeeping can be done; these settings do not deliver grant management.
3. **New modules:** donors/grants, award conditions, project activities, advances/liquidation, budget approvals/revisions, expenditure eligibility and donor reports; supporting-document workflow.
4. **Database changes:** projects, funding sources/grants, allocation links at document/line level, budget versions/periods, advance/settlement entities, approval decisions and document links. Connect to existing journals rather than replacing them.
5. **Architectural changes:** enforce project/fund-scoped authorization and budget/approval commands server-side; reusable dimensions/report scope; restricted-fund accounting rules validated with users/accountants. Shared-database tenancy is still suitable.
6. **Debt traps:** donor as only a supplier; grant as invoice revenue regardless of recognition rules; project as free-text `project_code`; every grant encoded as duplicated account trees; department renamed “project”; approvals stored only in notes.

**Readiness:** useful generic bookkeeping substrate; not a donor-compliance product today.

### B. Construction company

1. **Already supported:** suppliers, purchase expenses/payments, invoices, inventory locations/transfers, employees/payroll, assets and general financial reporting.
2. **Configuration only:** material catalog, cost accounts, real departments/locations and customers. A site can be represented by a stock location, but that does not create project profitability.
3. **New modules:** project/job costing, procurement requisitions/orders/receipts, commitments, labour allocation, subcontractors, variations, retention and progress claims as demand requires.
4. **Database changes:** projects, project budgets, line allocations, procurement documents, commitments and project-specific payment/claim metadata.
5. **Architectural changes:** connect procurement/material/labour events to shared stock and ledger commands; distinguish committed, accrued and paid costs; use permission-aware project reporting.
6. **Debt traps:** treating every site as an independent tenant; branch = project; issuing materials as retail sales; using notes for all job codes; summing cash payments as project cost while ignoring accruals and retention.

**Readiness:** base business finance and materials recording, not complete construction management.

### C. Statutory/public organisation

1. **Already supported:** departments with `cost_centre`, branch dimension, users, expenditure/payments, accounts, assets/payroll, financial reports and explicit audit-event API. Budgets are schema-only.
2. **Configuration only:** department/account setup and fiscal preferences; existing roles can approximate duties but cannot safely implement selective record access.
3. **New modules:** budget execution, delegated approvals, procurement, commitments, segregation-of-duties workflows and retention controls.
4. **Database changes:** budget versions/appropriation lines, approval matrices and decisions, procurement records, scoped assignments and durable supporting documents.
5. **Architectural changes:** server-enforced approval/period rules, complete transaction audit, reliable backups and least-privilege access. Specific public-sector accounting/reporting requirements require validation, not assumptions of compliance.
6. **Debt traps:** hard-coded “director can see everything”; audit events written only by UI; mutable posted data; treating existing approval columns as a full approval engine.

**Readiness:** not presently appropriate for a strict-control public-sector rollout without the foundational hardening and validated workflows.

### D. Service / professional organisation

1. **Already supported:** customers, invoices without inventory products, payment recording, expenses, users/employees/payroll, journals and profitability reports.
2. **Configuration only:** service catalog with inventory tracking disabled, account mappings, invoice branding/terms, tax settings and departments.
3. **New modules:** only if needed—time capture, engagements, milestones, scheduling and richer recurring billing. Existing recurring-invoice automation is partial, not full subscription billing for customers.
4. **Database changes:** none required merely to record service revenue/expenses; project/time/milestone entities only for those new requirements.
5. **Architectural changes:** no vertical-specific rewrite; same Phase 0 security/posting controls as everyone else.
6. **Debt traps:** forcing a POS shift to record income, inventing stock for services, duplicating accounting for each service category.

**Readiness:** the strongest near-term non-POS customer segment.

### Other target types

Wholesalers/distributors can reuse customers, credit invoices, suppliers and stock locations, but order fulfilment, UOM conversion and delivery controls are not established. Multi-branch businesses have schema/reporting foundations but not branch security or a working branch-configured POS screen. Restaurants and regulated/batch-sensitive agro-dealers need explicit module additions. None requires a separate application solely because of organisation type.

---

## 6. Organisation/Tenant Architecture

### 6.1 Is it genuinely multi-tenant?

**Yes in data structure and intended access model; not yet safe enough to certify tenant isolation without fixes.** This is shared-schema tenancy: most business records contain `business_id`; RLS uses `is_business_member`, role helpers and selective platform/partner access. It is more than a frontend business selector.

`business_users` allows multiple memberships; `BusinessSwitcher` and `set_user_business_access` support that direction. Historical migrations and some provisioning functions also encode single-active-business behavior. Audit all onboarding/invitation/admin paths before promising multi-business membership semantics; do not infer a one-business-per-user invariant from one helper.

### 6.2 Important isolation weaknesses

- RLS often validates only the row's `business_id`, not whether its `contact_id`, `branch_id`, `department_id`, parent document, product or account belongs to the same tenant. Base FKs are generally single-ID FKs. A FK to `branches(id)` does not prove `branches.business_id = invoices.business_id`.
- Shared RPC helpers validate posting accounts in several paths—keep that—but not all linked IDs on all paths.
- `BaseRepository.findById/update` rely on RLS rather than a tenant parameter. That is valid only if RLS and relationship integrity are correct. A user with multiple legitimate memberships can also accidentally select/update a record in the wrong active tenant if UI scope is not explicit.
- Service-role Edge Functions bypass RLS and must authorize **each operation and target**, not just authenticate a caller. The phone-reset defect is a concrete example.
- Platform/partner access intentionally crosses tenants. The platform-admin flag must be protected before those policies can be trusted.
- Public logos are deliberately publicly readable; they must never be reused as private evidence-document storage.

### 6.3 Can one organisation safely have these features?

| Requirement | Current position |
|---|---|
| Multiple branches | Data model yes; branch reporting yes; branch access isolation no; POS branch wiring incomplete |
| Multiple departments | Data model and management screens yes; department-scoped authorization/report suite no |
| Multiple projects | No project domain; invoice text code is insufficient |
| Multiple users | Yes, membership/invitation flows; phone reset and privileged field protections need urgent fixes |
| Different roles | Yes as hard-coded roles; not reliably least-privilege or branch/project scoped |
| Different modules | Plan/partner/build-time gates exist; no complete organisation-module entitlement model |
| Different organisation types | Shared database/application is appropriate; type-specific workflow modules can be added incrementally |

**Recommendation:** retain `businesses` as the tenant root. Calling it “Organisation” in product language does not require renaming every table. Add enforceable capability/scope checks and same-tenant references before adding vertical complexity.

---

## 7. Roles & Permissions

### 7.1 Actual permission architecture

- **Role-based:** enum-backed `business_users.role`; original finance roles, many operational roles and newer `cashier`, `manager`, `stock_clerk`.
- **Hard-coded:** `src/hooks/usePermissions.ts`, `src/types/pos.ts`, `src/hooks/usePosPermissions.ts`, route/nav logic, SQL role helper lists and Edge Function checks.
- **Feature-based:** UI plan capabilities and POS permission strings; `pos_settings.custom_role_permissions` influences UI checks, not a comprehensive backend capability engine.
- **Organisation-based:** meaningful RLS enforcement for membership, with platform/partner exceptions.
- **Branch-based:** optional membership `branch_id`, but broad table policies do not constrain by it.
- **Record-based/project-based:** not a general implemented policy model.

`20260922000000_pos_role_write_scope.sql` narrows sales/expense writes for some POS roles but **deliberately leaves reads business-wide**. It also leaves ledger writes broad. `20260923000000_post_pos_sale_rpc.sql` is additive; no subsequent “stage 3” policy migration closes direct accounting access.

Some older policies are broader still: `20260723000000_capital_financing.sql` grants member-based `FOR ALL` access to loans, loan repayments and share transactions; `20260708000000_tax_compliance_module.sql` does the same for tax returns/payments/alerts. No later replacement was found for these policies. With normal table write grants, even a nominally read-only viewer can mutate those modules. Conversely, payroll has explicit `can_view_payroll` / `can_write_payroll` policies in `20260728000009_role_aware_user_has_role.sql`—a useful example of stronger module-level control that other areas lack.

### 7.2 Scenario outcomes

| Scenario | UI behavior versus actual assurance |
|---|---|
| Cashier: POS only, no profit/company reports | UI routes and booleans attempt this. Database member reads include invoices, expenses, journals, products/costs and accounts. AI also exposes broader information. **Not enforceable as promised today.** |
| Branch manager: own branch only | Role and branch column exist; row-level branch restrictions do not. **Not safe branch isolation.** |
| Owner: all branches/finance/AI | Broad intended access exists, subject to plan UI. This is the nearest match. |
| NGO finance officer | Accountant role approximates finance access; budgets/NGO workflows absent; capability/record constraints insufficient. |
| Project officer | No project assignment or project-domain policy. Cannot safely deliver selected project financial visibility by configuration. |
| Finance manager | Accountant/admin can approximate access, but no reusable approval/segregation-of-duties mechanism. |
| Director | Board/viewer-style routes can approximate read-only dashboards; broad member-read and AI context may expose more than high-level information. |

### 7.3 Privilege escalation and policy drift

`user_profiles_own_update` permits own-row updates without excluding `is_platform_admin`; captured table grants include authenticated UPDATE. No protective trigger or column-specific revoke was found. This undercuts the platform-wide read/admin boundaries.

`business_users_admin_update/insert` uses owner/admin business checks without field-level role-transition constraints. Edge invitation code restricts who can assign owner/admin, but direct membership writes do not mirror those restrictions. Add role-assignment invariants, including preventing an admin from promoting itself to owner if owner-only billing/governance is intended.

**Practical evolution:** define a small server capability/scope vocabulary, keep existing roles as presets, and test parity. Do not build a general visual policy designer now. Price entitlements, user authorization and workflow approvals are separate checks and must remain separate concepts.

---

## 8. AI Agent Architecture

### 8.1 What exists

`src/lib/ai/{context,types,provider,forecast,advisor,knowledge,format}.ts` provides a useful modular seam. `Assistant.tsx`, `AiInsightsPage.tsx` and support UI use it.

- Deterministic local rules/advice/forecast logic can answer from available context and product knowledge.
- `ai-chat` verifies a user JWT, validates business membership server-side, rebuilds context through `admin.rpc('ai_context', …)`, computes forecast/advice, and calls a configured LLM provider.
- Providers include Groq, Gemini, OpenRouter and Anthropic. Keys are read from backend environment secrets, not sent to the frontend.
- `support-agent` is a separate help/error/compliance assistant with structured response output; it is not a database command agent.
- `suggest-bank-matches` sends bounded bank/ledger data supplied by the client to a model for suggestions, not autonomous posting.

### 8.2 Data, permissions, calculations and auditability

| Question | Evidence-based answer |
|---|---|
| What data? | `ai_context` composes business metadata, financial KPIs, monthly trends, overdue invoices, customers/concentration, expense categories, anomalies, receivable/payable schedules, including payroll/tax-derived outflows. |
| How retrieved? | Predefined SQL views and an RPC; server-side data refresh for remote chat. The model does not author arbitrary SQL. |
| Unrestricted database access? | The model has no general database tool or write tool. The Edge Function's service-role client is broadly privileged; its fixed query path must enforce caller scope. |
| Authorization? | Active business membership, not fine-grained finance/branch/project access or subscription capability, is the decisive AI guard. |
| Can it answer outside a role? | Yes within the member's tenant: a cashier or payroll-restricted member can request wider financial context. `ai_context` is SECURITY DEFINER and checks membership, not the caller's financial permissions. |
| Cross-tenant risk? | Authenticated nonmembers are rejected, but a missing UID bypasses the membership check. No explicit PUBLIC execute revoke is present; under PostgreSQL default function privileges this can expose the RPC to anonymous callers. Must verify and lock down effective grants immediately. |
| Calculations? | SQL aggregates + deterministic TS forecasts/advice. Remote function duplicates parts of the frontend forecast/advice logic. Model instructions cannot guarantee numeric fidelity. |
| Live? | Remote context is rebuilt on request; local/offline answers depend on whatever context is available. No continuous live-data feed. A fresh offline launch is not guaranteed to have financial AI context. |
| Facts vs interpretation? | Structured source numbers and forecast assumptions/confidence exist. LLM prose is not a typed, source-linked fact/interpretation contract. Hardcoded forecast weights and collection assumptions are assumptions, not facts. |
| Audit? | Usage counters exist; no persistent prompt/version, scoped dataset, response, sources or action decision log. |
| Prompts? | Chat prompt in the Edge Function, support prompt elsewhere, client knowledge/rules separately. Not one versioned domain prompt registry. |
| Geographic assumptions? | Remote prompt mandates MK formatting and Malawi compliance guidance even though company currency is available. This limits trustworthy broader-currency responses. |

The anonymous-RPC issue is distinct from the correctly JWT-authenticated `ai-chat` HTTP endpoint. Securing only the Edge Function does not secure a directly callable database RPC.

### 8.3 Evolution toward domain agents

**Yes, without a major rewrite.** Keep the provider interface, typed context, deterministic calculators and read-only posture. Add small permission-aware context/tool providers for finance, commerce, inventory and later projects/grants/procurement. A “Management Intelligence Agent” can compose authorized summaries from those providers.

Before automation, require:

1. Capability + organisation + branch/project scope checked on every retrieval/tool execution.
2. Server-owned prompt templates and trusted context schemas; treat names/notes/help text as untrusted data.
3. Report/calculation IDs, as-of timestamps, currency, source references and explicit forecast assumptions.
4. A versioned AI request/provenance log with appropriate retention and redaction.
5. Organisation/provider/token usage metering; current read-modify-write user-minute counters are race-prone and fail open.
6. Approval-bound, idempotent domain commands for any future action. Never give an LLM unrestricted service-role SQL access.

Do not build seven agents now. First make the current assistant safe and financially consistent.

---

## 9. Reporting Architecture

### 9.1 Existing paths

| Report family | Implementation and scope |
|---|---|
| Financial statements | `FinancialStatementRepository.ts`: SOFP, P&L, cash flow, changes in equity, integrity checks; organisation/date scope, chart/subtype logic, pagination in central balance loading |
| Branch performance | `BranchPerformanceReport.tsx` queries journal data; `src/lib/branchPerformance.ts` calculates branch P&L, including unassigned branch. Report filtering is not authorization. |
| Revenue analysis | `RevenueBreakdownReport.tsx`, `src/lib/revenueBreakdown.ts` |
| Dashboard | `useDashboardData.ts` combines income/expense/document and statement calculations; multiple queries with distinct freshness rules |
| Inventory | balances, movements, reorder and inventory-to-ledger variance/reconciliation logic and views |
| Tax | tax return repositories, page/panel components and separate scheduled VAT calculations |
| POS | `posReportService.ts`, Z-report and owner analytics components; operate on supplied sale arrays and shift aggregates, with the completeness gaps in §4 |
| AI | `v_ai_*`, `ai_context`, client/server forecast/advice calculations; primarily document-oriented revenue/expense summaries rather than exactly the statement repository definition |
| Exports | `src/lib/documents/documentGenerator.ts`, `src/lib/reportExports.ts`; generated PDF/CSV, not a stored report engine |

Reports are **hard-coded but partly reusable**, not a configurable report designer. Organisation/date parameters exist; branch performance exists; project/donor/procurement reporting does not.

### 9.2 Material reporting risks

- A balanced ledger can still omit inventory or payment effects after partial posting. AI cannot repair missing facts by interpreting them.
- Document-based AI revenue/expenses can differ from GL statements because journals, COGS, depreciation, accruals, reversals and opening balances have different inclusion rules. Define and label “sales”, “cash collected”, “revenue” and “profit” separately.
- POS history is bounded to 30 business invoices and not a durable shift query. Do not certify its current totals as a fiscal/audited close.
- `FinancialStatementRepository` centralizes substantial logic but is large and includes account-code fallbacks. Some other aggregate queries still need explicit pagination/data-size testing.
- Multi-step browser aggregation can combine different database moments under concurrent writes. It is not a transactionally consistent report snapshot.
- No generic department/project/fund dimension reporting API; no saved report definitions or versioned donor templates.

### 9.3 Consolidation that is justified

Keep the tested statement presentation and arithmetic. Incrementally expose common server/read services for ledger balances, sales, settlements, inventory valuation and scoped dimensions. Make dashboards, exports and AI consume those contracts, with the basis and timestamp visible. Move high-volume aggregation into indexed SQL/RPCs when measurements justify it; do not move every report merely for stylistic uniformity.

A future reporting layer can serve all requested domains if future modules post through the shared ledger and publish their own properly scoped operational facts. A generic reporting framework is not required before the next paying SME.

---

## 10. Database Review

### 10.1 Strengths to preserve

- Tenant IDs are widespread, with explicit membership helpers and RLS on business data.
- Relational financial documents/lines/payments and journals/lines/accounts are sensibly separated.
- Branch and department dimensions already appear on documents and journal records.
- Document numbers have an atomic reservation RPC; journal posting keys and client keys have unique indexes.
- Payment status guards, amount-due maintenance, inventory quantity checks and exchange-rate/functional-currency work exist.
- `20260911000000_hot_path_indexes.sql` and `20260913000000_performance_list_queries.sql` improve list/search paths. The database is not wholly unindexed.

### 10.2 Highest-risk database issues

**D1 — Runtime invariants are not fully represented in migrations.**  
`InventoryRepository.recordMovement` explicitly relies on a trigger updating `inventory_balances`. `20260911000001_quick_save_rpc.sql` explicitly avoids updating balances because of an assumed out-of-band trigger. No migration creates that stock-maintenance trigger. The checked-in `artifacts/database/capture/triggers.json` also lacks it. The same source/capture review does not substantiate the deferred journal-balance/posted-immutability/period-lock trigger guarantees described in repository comments.

This is not proof that a particular production database lacks them; it is proof that **the repository cannot reproduce or certify them**. Capture live definitions, reconcile behavior and version the required triggers/RPC guarantees. A fresh deployment must maintain stock and ledger correctness without undocumented setup.

**D2 — Same-tenant relational integrity is weak.**  
Rows commonly have both `business_id` and FKs to independent UUIDs, without composite tenant-qualified FKs. A writer may reference another tenant's parent/product/branch if it knows an ID. Some RPC account checks protect specific paths, not the whole schema. Prioritize document→lines/payments, account, product/location and dimension relationships. Audit existing mismatches before constraints are added.

**D3 — Posted financial state remains broadly writable.**  
`20260815000003_phase8b_rls_policies.sql` permits broad writer INSERT/UPDATE on journal tables and allows admin DELETE. `JournalRepository` guards balanced creation/post/reversal in the client; direct PostgREST calls can bypass those checks. No universal posting-state integrity protection is evidenced in the migration chain.

**D4 — Derived fields can drift.**  
Invoice totals/lines, amount paid/payment rows, stock balances/movements, journals and POS shift totals overlap. Some have triggers/atomic RPCs; others do not. `PosRepository.updateShiftTotals` is read-modify-write, while the new sale RPC uses SQL increments. Cash movements/refunds and concurrent legacy clients still race.

**D5 — RPC business validation is incomplete.**  
The POS executor trusts substantial client pricing and attribution; does not authenticate the purported approver; accepts a caller-supplied shift without full cashier/branch binding; does not verify every product/dimension reference. Authorization and balance checks are necessary but insufficient.

### 10.3 Other debt and migration concerns

- `profiles` versus `user_profiles`; multiple invitation mechanisms; snake_case/camelCase compatibility fields in POS; mismatched default discount/approval settings across SQL/types/hooks/repository. Freeze a canonical contract as each area is touched.
- `created_by`, `manager_id`, `head_user_id` and other actor fields are sometimes text without auth-user FKs; POS sometimes stores a display name as the actor. Preserve display snapshots separately from authenticated actor IDs.
- `pos_shifts.cashier_id` / cash-movement user fields lack strong identity relationships; branch nullable; no terminal FK or unique open-shift-per-terminal constraint.
- `project_code` text, polymorphic `source_id`, and URL-only documents are weak links for future project/donor evidence.
- Budget month columns support a fixed yearly shape, not rolling/custom grant periods or budget versions.
- Type files are not a schema authority. The base migration labels many definitions inferred/conventional; subsequent reconstruction migrations fill gaps. Regenerate types against a verified schema rather than masking mismatch with `as never`/`any`.
- New POS access paths need indexes matching business/branch/cashier/status/opened date. Add based on actual query plans; do not index every column.
- Soft-deletion filters differ among SQL views, browser repositories and public API; quota counting includes rows regardless of lifecycle state. Define each behavior explicitly.

### 10.4 Core versus module ownership

**Existing core foundation:** businesses, identity/membership, branches/departments, accounts, journal entries/lines, accounting periods, party/contact identity, audit, currency/rates, organisation configuration. Billing/entitlements belong to the platform core, not customers' GL.

**Shared finance module:** invoices, expense documents, their lines/payments, bank reconciliation and finance reporting. These remain reusable by services, commerce and projects; do not force every future operational fact into an invoice.

**Commerce module:** products/categories, stock locations/movements/balances/transfers, POS shift/drawer/settings and future terminal/sale metadata. Inventory can also be reused by procurement/construction; it should not require POS to be enabled.

**Other existing modules:** payroll, assets/financing and Malawi tax. **Future shared capabilities:** budget service, supporting documents, approval decisions and scoped reporting. **Future domain modules:** projects, grants/donors and procurement. Budgets and documents should not be NGO-only, but their presence in a target diagram must not be mistaken for complete current implementations.

---

## 11. API & Integration Review

### 11.1 Public API

`supabase/functions/api/index.ts` exposes `/api/v1`; `public/openapi.json`, generated OpenAPI responses, API documentation pages and `zapier/index.js` provide integration surfaces. The optional gateway proxies requests rather than implementing the business domain.

**Good:** API keys are random, hashed for lookup, tenant-bound and revocable. `create-api-key` checks active owner/admin membership. Requests derive tenant from the key, not a supplied business ID. Strict Zod schemas and server-only `create_api_journal_entry` are improvements over unrestricted service-role insert. The API rate counter is atomic and fails closed.

**Limitations:**

- GET invoices/expenses/accounts/journal entries exist. POST journals uses an RPC. **POST invoice and expense creation is deliberately disabled**, despite routes/OpenAPI summaries still advertising creation; it returns a request error.
- Keys have no useful resource/action/branch scopes, expiry or fine-grained integration principal. Compromise gives broad tenant API access.
- Neither API authentication nor key creation consistently enforces paid API entitlement/plan expiry. Key revocation is checked; current creator membership is not the ongoing authority.
- GET lists lack a usable pagination contract in the handler; default database row caps can produce incomplete results with a larger reported count.
- The 10/minute IP limiter runs before authenticated key handling, so authenticated users behind a shared IP are also subject to it despite the 100/minute key limit.
- Public writes and UI/RPC writes do not yet share one complete command/idempotency contract. Public journal creation needs retry semantics and limits explicitly defined.

### 11.2 Webhooks

Server-held secrets, HMAC signatures, HTTPS destination restrictions, DNS/private-network checks, disabled redirects, timeouts and delivery logs are sound features. Remaining issues:

- Browser callers can ask `webhook-dispatcher` to sign allowed event names with arbitrary payloads after only an active-membership check. A signature proves Ledgr sent it, not that the purported financial event occurred.
- Database commit and webhook dispatch are separate; browser failure can lose an event. No transactional event outbox.
- Delivery logic is duplicated in the public API and dispatcher.
- `retry-failed-webhooks` invokes the dispatcher using service-role credentials, but dispatcher requires `auth.getUser()` and membership. That is an integration mismatch, not a proven functioning cron retry path.
- Retry scans old failed delivery rows without a stable event-completion contract, risking repeat redelivery; receivers need event IDs/deduplication.
- DNS validation does not fully eliminate DNS-rebinding between validation and fetch; the source itself notes a future egress-pinning requirement.

### 11.3 Integration readiness by category

| Integration | Current position |
|---|---|
| MRA/EIS | Tax configuration, returns/payment tracking and printable financial documents exist; no verified EIS connector, fiscal signing or automated MRA filing transport found. |
| Payment platforms | PayChangu subscription billing implemented. POS tender labels are bookkeeping, not payment-acquirer integrations. |
| Banks | CSV import/reconciliation and AI match suggestions; no live bank feed connector found. |
| Mobile money | Account/payment metadata and POS methods; no direct Airtel/TNM collection/settlement connector established. |
| External POS devices | UI barcode/receipt helpers, but public API lacks a complete sale command/device identity contract. |
| Payroll/CRM/procurement/donor systems | Reusable tenant core and API foundation; domain endpoints, mapping and event contracts remain to be added. |
| External reporting | Read APIs and CSV/PDF/data exports exist; completeness/pagination and scopes must be improved before relying on automated large extracts. |

Keep Supabase and the versioned API. Add only the endpoints/adapter demanded by an actual customer, using the trusted domain commands instead of duplicating posting logic.

---

## 12. Offline/Synchronisation Review

### 12.1 What is implemented

`src/offline/db.ts` defines queue operations for income, expense, invoice, invoice/expense payment, payroll run, stock movement and POS sale. Income is an invoice flow. `queueApi.ts` assigns sequence/client key, enforces a 2,000-pending-item cap, tracks dependencies and supports stale-sync recovery. `syncEngine.ts` replays through repositories and POS posting. `legacyPosQueue.ts` migrates the older POS queue.

Workbox caches the shell/assets and GET PostgREST responses. TanStack Query persists selected business-data queries to Dexie for 24 hours. `useSyncQueue` triggers on app mount, connectivity return, SW messages and manual retry. The SW **does not post transactions without an open client**; it wakes clients, with replay on next launch otherwise.

### 12.2 What does not reliably work offline

Fresh sign-in, invitations/role changes, payment verification, remote LLM calls, cloud exports/uploads, API calls and scheduled jobs need connectivity. Cached browsing requires prior data. POS data loading uses direct repository calls and network cache rather than a complete terminal-local catalog/stock database. Shift/settings changes and returns/voids are not covered as complete offline semantic operations by the queue union. Do not market every screen as fully offline.

### 12.3 Risks

1. **Not a stock reservation system.** Two disconnected terminals can sell the same last unit. A server-side nonnegative balance check can reject the later sync, but cannot undo money already collected. If the balance-maintenance trigger is absent, that check does not protect sale movements at all.
2. **Current POS stock is placeholder 100.** Even online prevention is not based on actual location availability in the active screen.
3. **Idempotency is useful but incomplete.** Documents/payments/movements have keys; journals have posting keys. Legacy partial-success and refund/void paths are not uniformly atomic/idempotent. An invoice-level “any stock movement exists” test can mask incomplete stock/COGS work.
4. **No cross-tab exclusive queue claim.** `useSyncQueue` has an in-memory ref; the app-wide provider reduces same-page competition, not separate browser tabs. Queue selection and marking syncing are not an exclusive cross-tab lease. Unique keys help but do not make every side effect safe.
5. **Queue is tenant-tagged, not actor-bound.** It has `businessId` but no authenticated creator/device principal field. `syncQueue` processes all pending/failed items, not only a validated current-user partition. RLS may reject another tenant's operation, but same-tenant user changes can replay under the wrong current actor.
6. **Shared-device confidentiality.** `main.tsx` clears persisted query data and some session drafts on SIGNED_OUT; it does not clear/partition the Workbox API cache or semantic queue. Cache keys are URL-oriented, not a verified user+permission partition. Financial responses can survive logout; effective response `Vary` behavior needs testing. Do not silently delete unsynced sales as a “fix”.
7. **Conflict metadata is not a complete policy.** `localUpdatedAt` is documented but not used for a general conflict-resolution protocol by the sync engine. `updateIfUnchanged` is a useful narrow primitive, not application-wide conflict handling.
8. **Usage/closed-shift issues.** An offline sale accepted at the till can hit the organisation quota when synced; a closed shift intentionally does not update. Those cases need visible reconciliation, not endlessly failed queues or altered signed close totals.
9. **No durable multi-terminal identity.** Register objects are UI state; no secure terminal enrolment, terminal sequence or server-side open-shift uniqueness.
10. **Durability limits.** Browser storage can be evicted/cleared; queued data is not a server backup. Cashiers need explicit pending counts, recovery/export paths and bounded expectations.

### 12.4 Commercially proportionate offline policy

Keep Dexie and the semantic queue. For initial rollout, state which operations work offline, show stale-stock/as-of time, keep unsynced evidence, reconcile oversell/late sales, and require a connected close where appropriate. Choose either explicitly allowed oversell/backorder or allocated terminal stock when a paying deployment requires it. Do not promise globally consistent inventory while every terminal is disconnected.

---

## 13. Security Review

### S1 — Self-escalation through user profile (**Critical**)

**Evidence:** `20260815000003_phase8b_rls_policies.sql:196–199` permits own-row UPDATE. `user_profiles` contains `is_platform_admin`; `is_platform_admin()` reads that flag. Historical `capture/grants.json` includes full authenticated table UPDATE. No migration protects the privileged column.

**Impact:** on a deployment with those grants/policies, a normal account can become a platform administrator through direct data access; platform-wide read and admin functions then become reachable. A UI-hidden field is not a protection.

**Required:** verify effective grants immediately; separate/protect privileged columns and test attempted self-escalation as `authenticated`. Protect deletion lifecycle fields and identity claims similarly. Check whether any unauthorized flag changes occurred if the issue was deployed.

### S2 — Cross-organisation phone account reset (**Critical**)

**Evidence:** `invite-team-member/index.ts:400–545` resolves phone accounts globally and may call `auth.admin.updateUserById(targetUser.id,{password:…})` when a reset is requested or an account has never signed in. Caller owner/admin status is checked for the submitted business, but **target membership/management authority is not checked before reset**. Existing target membership is examined later (`592+`). The new password is returned to the caller.

**Impact:** an administrator of one business can potentially take over a phone-login account associated with another business. “Temporary password” metadata is not enforced password change/ownership proof.

**Required:** contain reset/provision-existing-account behavior until target authority is verified; do not let tenant admins reset a shared global identity solely by knowing a phone number. Use explicit account-recovery policy and audit events. Test cross-tenant and multi-membership cases without real customer accounts.

**Related invitation issue:** `accept-invite-link/index.ts:172–198` can use editable `user_profiles.phone` as evidence that a caller satisfies a phone-restricted invitation. A self-asserted profile phone is not verified ownership; anyone possessing the invite link must not be able to satisfy its restriction merely by changing a profile field. Bind restricted invitations to verified identity or an explicit administrator-provisioned account.

### S3 — Anonymous/null-UID AI RPC and overbroad context (**Critical**)

**Evidence:** latest `ai_context` is SECURITY DEFINER and only rejects unauthorized membership when `auth.uid() is not null` (`20260823000003…:302–320`). AI views similarly treat null UID as privileged. Migrations grant execution to authenticated/service role but never revoke PUBLIC execution on `ai_context`.

**Impact:** default PostgreSQL PUBLIC function EXECUTE can make anonymous context extraction possible. A null UID is not proof of service-role identity. Even authenticated callers get finance/payroll-derived summaries regardless of their role.

**Required:** inspect effective function ACL/default privileges; explicitly deny anonymous execution, require verified role/membership/capability/scope, and test direct RPC calls separately from Edge HTTP authentication. Reuse the safe data context, not the unsafe trust condition.

### S4 — Cashier/branch restrictions are not data restrictions (**Critical for the promised roles**)

Broad member reads, broad journal writes, cashier-writable POS settings and a PIN ignored by the callback mean profit hiding and manager approval are cosmetic. Complete the server sale/refund/void boundary before removing cashier direct ledger writes; then expose safe catalog/history projections without costs or company-wide finance data.

### S5 — Financial integrity and audit coverage (**Critical**)

Posted data is not universally immutable at the trusted layer; period lock/stock update guarantees are not reproducible. `audit_log` denies ordinary direct modification, and the manual audit RPC binds the current user and hashes entries—a useful base. But clients supply event descriptions/old/new values; many call sites swallow audit failures; the hash chain reads the prior entry without serializing all writers; there is no complete DB-trigger audit for every sensitive change. It is neither an exhaustive audit trail nor a guarantee of truthfulness.

### S6 — Local and file data (**High**)

Clear/partition runtime caches on user/permission change; protect unsynced queue ownership without deleting sales. For future supporting documents, use a private tenant-scoped bucket and document metadata/ACLs; do not reuse public logo URLs. Logo policies permit any active member to upload/update, not only branding admins, and bucket definitions leave MIME/size limits unset.

### S7 — Operational/API hardening (**High/Medium**)

- JWT verification, server-side provider keys, signed subscription callbacks, API key hashing, strict public API inputs and webhook SSRF mitigations are positive.
- TOTP login flow exists, but no universal database/Edge assurance-level policy was found for sensitive actions. Client login challenge is not an AAL2 backend requirement.
- Invitation acceptance logs a token in one fallback path (`accept-invite-link/index.ts`); redact bearer-like invitation tokens from logs.
- Service-role job secret configuration, function grants, storage policies and platform support access require live verification.
- No secrets discovered by the limited pattern scan should be interpreted as “no secrets anywhere”; inspect Git history and deployed frontend bundles separately, without copying secret values into reports.

**Security release criterion:** tests must attempt forbidden operations using real `anon`/`authenticated` roles or user JWTs, not service-role test clients. UI tests alone do not demonstrate confidentiality or tenant safety.

---

## 14. Subscription/Usage Architecture

### 14.1 Actual plans differ from the supplied four-tier assumptions

`src/lib/billing/plans.ts` currently defines **Free, Starter, Growth, Pro, Enterprise**. `20260919000000_add_starter_plan.sql` adds the corresponding database tier.

| Plan | Implemented catalogue | Difference/qualification |
|---|---|---|
| Free | 50 documents/month; no paid capabilities; UI copy includes income, expenses, invoices **and payroll** | Broader than income/expenses only |
| Starter | 200/month; inventory + core accounting/reports | Additional tier not in the question |
| Growth | 500/month; Starter + bank reconciliation + accounting/organisation | User/branch/product limits are not modeled; real-time claim is not backed by live subscriptions |
| Pro | 2,000/month; AI insights, API and webhooks | Capabilities primarily UI-gated, not universally server-enforced |
| Enterprise | Unlimited document count + branding; copy lists roles, account manager, SLA | Roles exist below Enterprise; account manager/SLA are service promises, not implemented technical entitlements |

Do not redesign pricing during this audit. First reconcile website, app catalogue, checkout constants and customer promises. Unlimited users must be an intentional commercial choice, not an accidental absence of a meter.

### 14.2 Billing strengths

Business-level `plan_tier`, `plan_expires_at`, `subscription_payments`, PayChangu initiation/webhook/verification, manual grants, expiry and renewal jobs exist. `apply_subscription_payment` is service-role-only and atomically resolves payment/plan changes, with replay protection. `enforce_plan_tier_change` blocks ordinary users raising their own tier; Starter updates the tier rank. These should be retained.

### 14.3 Enforcement gaps

1. **Organisation count is the right level, but not universal enforcement.** `_ledgr_assert_usage_limit` checks quick-sale/expense and POS RPC paths. Other direct writes, imports, payroll/manual/API paths are not covered by one unavoidable server rule. Browser `UsageService` intentionally fails open.
2. **Count then insert is not quota reservation.** Concurrent terminals can all see remaining quota and insert. No serialised organisation-month counter/lock is used.
3. **Definition is document date, not creation/usage time.** Counts are invoices by `issue_date`, expenses by `expense_date`, payroll by `pay_date`, with `>= month_start` but no next-month upper bound. Backdated entries can evade current-month counting; future-dated documents count early. Draft/void/deleted/credit-note treatment is not explicitly excluded. Manual journals are not counted.
4. **Feature gating is mostly presentation.** `PlanGate`, `PlanGuard`, nav capabilities and partner gates do not prevent direct inventory, AI, API or webhook use where backend checks omit the plan.
5. **Expiry is not an effective-entitlement check.** `useUsage` and quota SQL read `plan_tier`, not an expiry-adjusted plan. The expiry cron must work. The tier-change trigger protects upward tier changes but does not protect changing `plan_expires_at`; owners/admins can potentially extend the current tier through broad business UPDATE.
6. **AI usage is user-minute, not organisation monthly consumption/cost.** It can be multiplied by users and races; no token/spend budget.
7. **Payment reconciliation needs strengthening.** Webhook signature verification and server-to-server status lookup are good. Webhook/verify code does not compare the verified amount/currency against the stored checkout expectation. A verify-call failure can be finalized as failed; absent provider secret falls back to trusting signed webhook status. Exercise these error/recovery cases before paid acquisition.
8. **Jobs may only be configured in principle.** Placeholder cron URLs/secrets are not operational entitlement expiry. Prove invocation and failure alerts.

### 14.4 What to measure now—without repricing

Record tenant, actor, channel, timestamp, idempotency/event ID and outcome for:

- Accepted business documents by kind and source, separately from journal entries/lines.
- POS sales, tenders, refunds/voids; active terminals and terminal-days.
- Active branches, users/memberships, products and stock locations.
- Offline pending age, retries, duplicate suppression, stock conflicts and posting exceptions.
- AI requests, provider/model, input/output tokens, estimated cost and denied requests.
- API calls by integration/resource/action; webhook events/deliveries/retries.
- Private/public storage bytes, file counts, export sizes and retention.
- Subscription transitions/payment outcomes, expiry-job lag and metering failures.

Use one effective-entitlement function server-side. Define a fair policy for offline sales already accepted before a quota boundary—do not strand their bookkeeping in order to enforce a commercial limit. Durable usage events/counters can support that policy without changing the price card now.

---

## 15. Architecture Scorecard

**Interpretation:** GREEN = keep the foundation; AMBER = useful but bounded/incomplete; RED = a current correctness/security/commercial promise cannot be safely relied upon. These are separate judgments, not an aggregate product score. Deployment-specific exposures remain subject to the evidence limits above.

| Area | Status | Evidence | Risk | Recommendation | Priority |
|---|---|---|---|---|---|
| Multi-tenancy | **RED** | Real `business_id`/RLS, but privileged-profile, phone-reset and AI null-UID paths | Cross-tenant access/account takeover | Close those paths; verify effective ACLs and same-tenant relationships | **Critical** |
| Database design | **AMBER** | Useful normalized financial schema; reconstruction gaps, weak tenant-qualified FKs | Drift and invalid references | Verify schema, version invariants, add targeted constraints | **High** |
| POS architecture | **RED** | Reuses finance core, but placeholder stock/null branch/PIN ignored; partial returns | Incorrect sales/controls and loss of trust | Finish server posting lifecycle and wire real till context | **Critical** |
| Financial core | **RED** | Double-entry/services exist; direct mutable writes and missing reproducible guards | Wrong books despite valid-looking screens | DB-backed balance/period/immutability and reconciliation | **Critical** |
| Inventory | **RED** | Movements/location/valuation exist; unversioned balance-trigger dependency; COGS repair gap | Stock and profitability drift | Capture/version balance maintenance, atomic cost effects, exception repair | **Critical** |
| Branches | **AMBER** | Entities, dimensions and branch report exist; no row scope; POS null branch | Wrong stock/report attribution and excessive visibility | Required till branch/location plus scoped access | **High** |
| Roles/permissions | **RED** | Multiple UI/SQL matrices; broad financial reads/writes; fake approval | Cashier access exceeds promise | Server capability/scope enforcement and genuine approval | **Critical** |
| AI architecture | **AMBER** | Typed context, fixed query paths, calculators/providers; unsafe data authorization | Unauthorized financial summaries and inconsistent claims | Secure context first; share metrics/provenance | **Critical** for access; **Medium** for evolution |
| Reporting | **AMBER** | Reusable statements, branch/revenue functions; duplicate definitions/POS incomplete | Conflicting figures and incomplete reports | Shared metric basis and scoped aggregation, retain tested presentation | **High** |
| API/integrations | **AMBER** | Versioning/key hashing/strict schemas; disabled advertised writes, scopes/outbox absent | Integration breakage and signed fabricated events | Align API docs, scopes/entitlements and trusted event emission | **High** |
| Offline capability | **RED** | Durable semantic queue/idempotency; cache/actor/oversell/close gaps | Unsynced accepted sales, data exposure, stock conflict | Actor partition, cross-tab claims, reconciliation policy and tests | **High** |
| Security | **RED** | Specific escalation/reset/RPC defects plus UI-only confidentiality | Tenant compromise and financial abuse | Containment, targeted patches, deny-path integration tests | **Critical** |
| Subscription/usage | **RED** | Business quotas/payment flow; bypass/race/expiry gaps | Lost revenue or wrongly blocked customers | Protect expiry, central entitlements and dependable metering | **High** |
| Maintainability | **AMBER** | Repositories/services/tests; large pages/services and TS/SQL duplicate logic | Divergent fixes and untested fallback behavior | Consolidate only touched command/report contracts; integrate DB tests | **Medium** |
| Scalability | **AMBER** | Postgres, indexes, keyset/list work; browser aggregation/full loads/global counters | Latency and incomplete data at growing volume | Measure, paginate, server aggregates, job/usage indexes | **Medium** |
| Extensibility | **GREEN** foundation | Finance independent of POS; departments/dimensions, providers and repositories | Ad hoc future modules could undo this advantage | Retain modular monolith/shared schema; clear module boundaries | **Medium** |

---

## 16. What NOT to Change

1. **Do not replace React/Vite, Supabase or PostgreSQL.** The critical findings are authorization/invariant defects, not evidence these technologies cannot scale to Ledgr's current market.
2. **Do not turn POS into the product's root domain.** Keep using shared finance/inventory posting; POS remains an input channel.
3. **Do not rename `businesses` across the codebase just to say “organisation”.** Product terminology can evolve independently of a high-risk database rename.
4. **Do not discard the journal/account/document/payment separation.** It is substantially more reusable than a flat retail sales table.
5. **Do not remove the repository layer or rewrite every page for architectural purity.** Its soft-delete, pagination, error and idempotency helpers are valuable. Tighten privileged commands where needed.
6. **Do not discard existing statement, tax, depreciation, currency and inventory-reconciliation logic.** Preserve tested behavior while making its data source reliable. Reconcile duplicated definitions rather than rewrite all calculations.
7. **Do not replace the Dexie queue with a distributed synchronization framework now.** Fix ownership, claims, replay completeness and product policy first.
8. **Do not discard client keys, posting keys or atomic document-number reservation.** They are exactly the foundations needed for offline/API input channels.
9. **Do not replace the AI provider abstraction or deterministic rules engine.** Fix scope and provenance, then extend the context contract.
10. **Do not throw away PayChangu billing, plan-upgrade protection or partner isolation.** Repair specific enforcement gaps and prove operation.
11. **Do not collapse branches, departments, projects and tenants into one generic “group”.** They represent different business concepts and different access scopes.
12. **Do not build NGO, construction, procurement, restaurant operations or several agents before paid demand.** A service SME and a carefully scoped retail deployment can validate the product much sooner.
13. **Do not immediately delete compatibility paths on deployed PWAs.** Inventory active client versions and unsynced queues, migrate them safely, then retire insecure fallbacks behind a supported-version policy.

These are preservation recommendations, not certifications that every implementation inside those areas is defect-free.

---

## 17. Target Architecture

### 17.1 A modular monolith using the current stack

```text
Input channels
  Finance forms | POS | CSV import | Offline replay | External API
                         ↓
Trusted application commands (Supabase RPC / Edge orchestration)
  Authorize actor + tenant + scope
  Check effective entitlement and approval
  Validate business rules, IDs and monetary calculations
  Commit idempotently; record audit and durable integration event
                         ↓
LEDGR CORE
  Organisation / identity / membership / capability + scope
  Branches / departments / financial dimensions
  Parties / currency / accounts / journal / periods
  Shared payments/documents/budgets as their contracts mature
  Audit / configuration / entitlements / usage
                         ↑
Modules
  Finance         Commerce              Future, demand-led
  invoices        products/inventory    projects/job costs
  expenses        POS/shift/terminal    grants/donors
  settlements     sales operations      procurement
  banking/tax     stock transfers       domain-specific workflows
  payroll/assets remain separable adjacent modules
                         ↓
Permission-aware report/metric contracts
  Ledger statements | sales | stock | budgets | project/fund reports
                         ↓
AI intelligence
  Scoped contexts + deterministic calculations + source/provenance
  Optional domain assistants; approved commands only for future automation
```

### 17.2 What exists, what changes, what stays

| Target concern | Exists now | Missing / eventual change |
|---|---|---|
| Tenant/identity core | Businesses, users, memberships, RLS | Protect privileged fields/identity recovery; canonical membership policy |
| Financial foundation | Accounts/journals/periods, documents/payments | Universal trusted invariants and command coverage |
| Commerce boundary | POS components/services/RPC; inventory model | Sale metadata, terminal/shift links, server approvals, branch stock integrity |
| Organisation configuration | Business settings, plan/partner flags | Small tenant-module entitlement registry, enforced on backend as well as UI |
| Dimensions | Branch/department FKs | Scoped assignments; projects/funds only when modules require them; line allocation support |
| Reports | Statement repository, functions/views | Canonical metric semantics, authorized scope and complete aggregation |
| AI | Provider/context/calculator seams | Scoped tools, prompt/response provenance and organisation usage |
| Integration events | Dispatch/delivery history | Trusted transactional outbox with stable event ID; no browser-authored financial truth |
| Supporting documents | URL fields and two storage buckets | Private document entity/links, metadata, authorization and retention |
| Budgets | Budget tables | Usable budget service/UI, revisions and flexible periods as justified |

### 17.3 Decisions to make now

- `business_id` remains the tenant boundary; one organisation may enable zero POS modules.
- All input channels converge on the same trusted business commands. UI permissions are never the security boundary.
- Branch/department/project/fund are distinct dimensions. Do not overload free text or add a column for every future industry to invoices.
- Module enablement, paid entitlement, actor permission and workflow approval are independent checks.
- “Financial transaction” for usage must have an explicit definition separate from journal lines and POS tender legs.
- Every external/offline command has a stable idempotency key, authenticated actor and recoverable result.
- A valid posting either completes its required ledger/subledger effects or records a durable exception with a supported repair path. Silent warnings are not a financial-control strategy.
- AI reads the same authorized, defined metrics as reports; it does not become an alternate accounting system.

No module framework or physical folder reorganization is required to adopt these decisions. Introduce boundaries in the functions/services already being changed.

---

## 18. Prioritised Roadmap

### PHASE 0 — NOW / BEFORE MORE FEATURES

**Goal: make a narrow paid offering safe, not finish a platform vision.**

| Order | Work | Acceptance evidence |
|---|---|---|
| 0.1 | Contain/fix platform-admin self-update, unsafe phone reset and null-UID AI RPC access. If deployed, disable only affected surfaces while correcting. | Authenticated self-escalation denied; owner of A cannot reset B's identity; anonymous/direct AI RPC denied; authorized path still works. |
| 0.2 | Capture deployed schema/ACLs/triggers/applied migrations, compare with clean replay. Version required stock and ledger invariants rather than assuming them. | Fresh database and staging both maintain stock, balance journals, reject closed-period/posted mutation and enforce tenant references. |
| 0.3 | Complete the **currently sold** POS lifecycle. Use real branch/location/catalog stock; remove unverifiable approval claims; make sale/refund/void secure and retry-safe. Restrict/disable incomplete return/void features until correct. | Sale/tender/VAT/stock/COGS/return/void/shift reconciliation passes; no direct cashier financial access; real approval verified server-side. |
| 0.4 | Narrow role access and sensitive projections. Complete server commands before revoking the direct writes old flows need; explicitly manage stale PWA versions. | Cashier cannot read costs, profits, full journals or forbidden AI summaries; branch manager cannot read/write another branch. |
| 0.5 | Prove paid activation and expiry; protect commercial fields; enforce advertised high-value capabilities server-side. Define document-count semantics and safe offline quota handling. | Verified amount/currency/reference, duplicate callback safe, expiry effective without client manipulation, direct paid-feature bypass denied. |
| 0.6 | Reconcile existing financial data and add visible posting exceptions. Fix cache identity boundaries and queue ownership/replay risks for actual offline customers. | No unexplained GL-stock/payment mismatches; accepted sale survives restart/lost response; shared-device account switch cannot leak cached finance. |
| 0.7 | Establish a small production release gate and restore proof. Wire database security/posting tests into normal CI with reproducible dependencies and environment setup. | A/B tenant and restricted-role tests; fresh migration replay; successful backup restore and business reconciliation; alerting on jobs/posting failures. |

**Commercial scope:** sell the reliable subset (particularly service-business finance and controlled counter sales after POS gates), document limitations, and do assisted onboarding. No new vertical module is needed to complete Phase 0. If aggressive acquisition is imminent, privilege escalation, identity takeover and financial correctness outrank all UI polish.

### PHASE 1 — NEXT

- Consolidate capability/scope checks with existing roles as presets; add small organisation-module configuration.
- Make sale, expense, payment, refund/void and journal commands canonical across browser, offline and API paths. Retire legacy fallbacks after supported clients/queues have migrated.
- Add same-tenant composite constraints/validation incrementally, auditing legacy mismatches first.
- Introduce durable POS sale→shift/terminal metadata, reliable shift aggregates and current/closed-shift reconciliation.
- Consolidate reporting definitions used by dashboard, statements and AI; move expensive aggregates server-side based on query measurements.
- Implement a database-backed integration event outbox, scoped API keys, pagination/idempotency and honest OpenAPI descriptions.
- Add AI provenance and organisation-level usage/cost tracking; keep it read-only until command authorization is mature.
- Add supporting-document storage and a small budget workflow only when near-term paying customers need them.
- Make database tests portable: existing standalone scripts use CommonJS `require`, hardcoded `/home/user/Ledgr-react`, `/tmp/pgtest` and undeclared `embedded-postgres`/`pg` dependencies; they are excluded by `vitest.config.ts` and current main CI. Preserve useful tests, fix execution integration.
- Validate cron jobs end-to-end: recurring invoices currently copy header fields without a complete line-copy/posting lifecycle, and reminders create delivery events without evidence of actual reminder email transmission in that function. Do not sell this as complete automation until exercised.

### PHASE 2 — FUTURE / DEMAND-JUSTIFIED

- Projects/job costing and line-level allocations for construction/service engagements.
- Donor/grant restrictions, advances/liquidation, budget revisions and donor report templates.
- Procurement requisition/order/receipt/commitment workflows.
- Restaurant orders/recipes or agro batch/expiry/UOM features.
- Richer approvals, custom role administration, retention and formal SLA features for larger organisations.
- Domain-specific AI tools/agents and approval-bound automation.
- Certified MRA/EIS, bank, mobile-money and external system connectors where requirements and commercial return are known.
- More sophisticated offline stock allocation, terminal enrollment and server aggregation/warehouse infrastructure only at demonstrated scale.

Do not schedule these as an immediate parallel programme. Let customer demand determine which module comes first.

---

## 19. Critical Risks

### 19.1 Five principal risk groups

| Rank | Risk | Why it threatens subscriptions | Immediate containment / proof |
|---|---|---|---|
| **1** | **Tenant/security boundary compromise**: profile-admin escalation, phone-account takeover, AI null-UID access | One compromised tenant or exposed financial dataset overwhelms the value of new features | Restrict vulnerable paths; prove denial with effective production-like ACLs and two separate tenants |
| **2** | **Role/approval promises are false at the trusted layer** | Cashiers can access sensitive information or bypass approval; branch isolation cannot be promised | Server permissions/projections and real approvals; direct REST/RPC tests |
| **3** | **Financial/inventory correctness depends on missing/partial mechanisms** | Customer balances, stock and profit can disagree; migration/restore can silently change behavior | Reproducible triggers/commands, atomic/idempotent effects, exception queue and reconciliation |
| **4** | **POS/offline operational incompleteness** | Placeholder stock, null branch, broken refunds, partial close reports and retry conflicts harm everyday cash operations | Gate incomplete operations; end-to-end sale/refund/void/close/offline recovery tests before broad retail rollout |
| **5** | **Commercial enforcement and recovery are incomplete** | Paid features can be bypassed; expiry/counts can be wrong; legitimate paid users may be mishandled | Protected effective entitlements, payment verification/recovery, job monitoring and consistent usage semantics |

### 19.2 Required verification matrix before aggressive acquisition

These tests are **recommended, not claimed executed**:

- Anonymous versus normal user versus platform support: profile privileged field mutation, `ai_context`, exports and admin functions.
- Owner A versus owner B: phone resets, invitation acceptance, mixed-tenant document/branch/product/account references.
- Cashier/stock clerk/branch manager/owner: direct reads/writes, not only visible routes; AI and cached data included.
- Sale: cash, mobile money, bank, split tender, credit, VAT/non-VAT, discount approval, service/nonstock product, tracked product with known cost.
- Failure after each step: lost response, duplicate key, simultaneous retry, missing account/location, COGS exception, closed shift, revoked membership.
- Refund/void: full and partial, repeated call, over-return, original currency/tax/cost, original and reversal journals, stock and drawer.
- Offline: two terminals sell the final unit, two tabs replay, browser closes mid-sync, different user signs in, month/plan boundary crossed, business switched.
- Billing: exact limit under concurrency, backdated/future/void/draft treatment, invalid amount/currency, duplicate and out-of-order callbacks, expired paid plan with cron delayed, manual grant audit.
- Deployment/restore: migration-only empty database, real effective grants/function ACLs, deployed trigger definitions, secrets configured without exposure, scheduled job success, restored ledger/stock/control totals.

---

## 20. Final Answers to the 11 Questions

### 1. Is the current Ledgr architecture strong enough to continue selling the product now?

**The foundation is strong enough to keep investing in and selling a carefully scoped product, but this revision is not a clean approval for aggressive paid production expansion.** Continue demonstrations and controlled onboarding; remediate/contain the critical security paths and prove financial correctness first. Do not wait for new vertical modules, and do not replace the stack.

### 2. Has adding POS fundamentally made Ledgr a retail-only system?

**No.** POS uses existing invoices, payments, journals and inventory. Departments, payroll, banking, assets, financing, general expenses and financial statements remain non-POS domains. Retail-specific UI assumptions are local defects, not a fundamental retail-only data model.

### 3. Can POS remain a module rather than the definition of Ledgr?

**Yes.** Keep it as a sale-input/shift/terminal module over shared finance and stock commands, independently enabled per organisation. Add POS metadata in its module boundary rather than requiring every income or expenditure record to come from a till.

### 4. Can the current architecture support organisations that do not use POS?

**Yes for ordinary service-business and organisational bookkeeping after the shared safety fixes.** NGO, construction and public-sector needs extend beyond configuration: projects, grants, commitments, budget workflows, approvals and supporting documents are missing or partial. They can be added incrementally without separate applications/databases.

### 5. What are the 5 most important architectural risks right now?

1. Tenant/identity compromise through privileged-profile, phone-reset and AI RPC authorization gaps.
2. Role, branch and approval rules that exist in UI but not equivalently on the server.
3. Unreproducible and non-universal financial/inventory invariants and partial posting.
4. POS/offline operational correctness: stock, branch, refunds/voids, shift closure and replay.
5. Incomplete subscription/capability/usage/expiry enforcement and payment recovery.

### 6. What should I fix BEFORE aggressively acquiring subscribers?

Close the specific security paths; verify/version deployed schema invariants; secure the workflows you actually sell; make POS stock/branch/refunds/voids and role confidentiality real; reconcile existing books; protect billing fields and effective entitlements; prove paid activation/expiry, offline recovery and restore. Run those checks as actual restricted roles in CI/staging. **Do not add NGO/procurement features to solve these problems.**

### 7. What should I deliberately NOT touch right now?

The technology stack, tenant root, financial entity separation, repository foundation, working financial calculations, idempotency/numbering, Dexie queue concept, AI provider/rules abstraction, and basic subscription payment design. Do not rename everything, split into microservices, fork by industry or introduce a plugin framework.

### 8. What architectural decisions should be made now to prevent an expensive rewrite later?

Declare organisation tenancy and distinct branch/department/project/fund dimensions; require all inputs to use trusted authorized/idempotent commands; separate modules, paid capabilities and user permissions; define usage units; keep accounting and inventory invariants server-enforced; make audit/events durable; require reports and AI to share scoped financial definitions. These are contracts, not a mandate for a large refactor.

### 9. Can the AI agent evolve into a broader business intelligence/automation layer?

**Yes.** Typed contexts, deterministic calculations and provider interfaces give a credible starting point. Fix anonymous/role access, unify metrics, add provenance and cost controls. Later expose narrow domain tools with server authorization and approval-bound commands. The current agent advises; it is not already a safe autonomous business operator.

### 10. What should Ledgr's CORE domain be versus future modules?

**Core:** organisation, identity/membership and scopes, branches/departments/dimensions, party identity, currency, accounts/journal/periods, audit, configuration, entitlements/usage and shared document/payment/budget contracts as they mature.

**Modules:** reusable Finance; Commerce/POS and inventory; existing payroll/assets/tax; future Projects, NGO/Donor and Procurement. Reporting and AI are cross-module layers. Not every organisation needs every module, and not every operational record is a financial transaction until properly posted.

### 11. Is the current architecture ready for a multi-vertical future, or does it need foundational restructuring first?

**It has the right reusable data foundation, but needs targeted foundational hardening—not foundational replacement.** Authorization, transactional integrity, schema reproducibility, dimensions and entitlements need to become dependable before complexity increases. Preserve the platform and evolve it through actual paid requirements. The immediate objective remains: **a smaller set of trustworthy workflows that businesses will pay for.**
