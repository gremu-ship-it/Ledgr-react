# Dashboard Audit and Strategy

**Audit date:** 2026-11-06
**Requested filename:** `DASHBOARD_AUDIT_AND_STRATEGY_2026-12.md`
**Scope:** Source-level audit of dashboard-like pages, their routes and gates, data dependencies, presentation states, responsive treatment, overlap, and recommended next steps.
**Audit mode:** Read-only inspection. No application code, routes, navigation, or migrations were changed.

## 1. Executive summary

Ledgr has a useful set of business-specific overviews, but they do not currently behave as one coherent dashboard system:

1. **`/dashboard` is not one consistent experience.** It renders a generic financial overview for most businesses, a different mobile-specific version at phone widths, and the construction executive dashboard whenever the construction capability is enabled. The construction workspace at `/construction` is a separate procurement-control overview, not a duplicate of that executive dashboard.
2. **Manufacturing has a confirmed duplicate route.** Both `/manufacturing` and `/manufacturing/dashboard` render the same `ManufacturingDashboardPage`, with the same query and contents. There is no source evidence of separate intended roles.
3. **Some high-trust figures have scope/freshness risks visible in the client source.** “This month” finance hooks anchor their month to the latest invoice or expense date, rather than necessarily the current calendar month. The six-month trend excludes void expenses but includes drafts, while the monthly-expense total excludes both drafts and voids. POS owner analytics is computed from the latest 30 invoices loaded by `PosPage`, not from an unbounded analytics query. The Z-report modal receives that same history list and its client summary does not filter it to the selected shift.
4. **Mobile is deliberately tailored, but its pull-to-refresh invalidations do not match most dashboard query keys.** Inventory alert refresh is aligned; income, expense, and outstanding-invoice invalidations use different keys from the queries that render the dashboard. The mobile page also omits the desktop chart, cash-flow indicator, journal activity, tax remittance panel and usage meter.
5. **There is no separate inventory dashboard, payroll home dashboard, or consolidated reports landing dashboard.** Inventory is an operational stock list with low-stock warning and reconciliation tools; payroll has run/employee/cost-centre workspaces, with KPIs inside a selected pay-run detail; reports are individual report routes. These should be treated as deliberate coverage gaps or workflow pages, not mislabelled as dashboards.
6. **Partner and platform-admin pages are administration consoles, not tenant business dashboards.** They serve their own admin audiences and have their own different access boundaries.

### Recommended direction

Keep one **global dashboard frame** with a common financial/decision layer and capability-aware vertical modules. Do not replace the common dashboard with a construction-only view when a business has construction capability; expose construction, manufacturing, retail/POS and other enabled modules alongside shared finance. Keep `/construction` operational and procurement-oriented. Canonicalize the duplicate manufacturing URL while preserving a redirect/compatibility alias. Before adding many more cards, fix metric period/scope semantics, shift-report provenance, mobile refresh, and error-versus-empty presentation.

## 2. Evidence rules and limitations

- **Verified** means directly established by route or component source inspected in this checkout. It does not mean the live Supabase database, deployed RPC definitions, production data, or browser behavior was independently exercised.
- **Recommendation / hypothesis** is labeled as such and should not be mistaken for current behavior.
- “Live” below means the component calls a repository, React Query query, Supabase RPC/table, or a local data-derived calculation. It does not assert a real-time subscription or guarantee the backend’s correctness.
- This is a source audit, not a runtime/mobile device, performance, accessibility, or deployed-schema validation. Any item identified as a data-integrity risk should be checked against deployed functions and representative fixtures before remediation.

## 3. Route and access inventory

| Experience | Route(s) and source | Gate / audience established in source | Dashboard-like purpose |
|---|---|---|---|
| Global / finance | `/dashboard` → `DashboardPage` → `GenericDashboard` or `ConstructionDashboard`; `src/App.tsx`, `src/pages/DashboardPage.tsx` | Protected app route with `RoleRoute`; no route-local `PlanGate`. `DashboardPage` selects construction by `useCapability('construction')`. | Business overview and quick access. For construction-enabled businesses, the component selection replaces the generic financial view with project portfolio metrics. |
| Mobile global | Same `/dashboard`; `GenericDashboard` returns `MobileDashboard` when `useIsMobile()` | Same route; capability/plan visibility is used for mobile workspace links and inventory card. | Separate compact, touch-oriented overview rather than a responsive rendering of all desktop widgets. |
| Construction executive | Rendered at `/dashboard` when construction capability is enabled; `ConstructionDashboard` | Selected by capability from the dashboard component; no separate `/construction/dashboard` route was found. | Project portfolio, billing, cost, retention and activity overview. |
| Construction operations | `/construction/*`, default `/construction` → `ConstructionWorkspacePage` and `ConstructionOverviewSection` | Enterprise `PlanGate` plus construction `CapabilityGate`; nested App `ProtectedRoute`/`RoleRoute`. | Procurement controls, holds, receipt/cost-basis/posting status and site material activity. This is different from the executive dashboard. |
| Manufacturing | `/manufacturing` and `/manufacturing/dashboard` → same `ManufacturingDashboardPage` | Enterprise plan and manufacturing capability, inside protected/role-routed app. | Production throughput, yield, WIP, cost variance and production summary. |
| POS / owner analytics | `/pos`; analytics is a view mode within `PosPage` | Retail operating-model gate plus POS capability; redirects non-retail operating models to `/income`. | Retail till plus an owner analytics view. Z-report is a shift-close modal, not a separate route. |
| Payroll | `/payroll`, `/payroll/pay-runs`, `/payroll/pay-runs/:id`, `/payroll/employees`, `/payroll/leave`, `/payroll/tax-config` | Partner plan/capability gates. Base page and employee routes use payroll feature + core-accounting; pay runs and leave use payroll feature + accounting-organisation. | Payroll operations. There is no stand-alone payroll dashboard route; KPI cards are embedded in pay-run detail and cost-centre reporting. |
| Inventory | `/warehouse`, with related `/products` and `/transfers` | Partner inventory feature/capability plus inventory capability; warehouse/transfers also role path checks. | Operational inventory list and reconciliation, not a dedicated dashboard. Mobile global dashboard adds a low-stock summary card. |
| Partner admin | `/partner-admin`, `/partner-admin/partners/:id` and subroutes | `PartnerAdminRoute` + `PartnerAdminLayout`; partner-admin access model. | Partner portfolio/client-capacity overview and partner-level admin detail, not client ERP analytics. |
| AI | `/ai`; `/chat` redirects to `/ai`; same assistant can appear in app drawer | Partner plan feature `ai_advisor` and `ai_insights` capability; assistant internally requires partner feature `ai_agent`, business context and plan capability for AI mode. | Conversational analysis, health/advice, anomalies and forecast from `ai_context`; Support mode is distinct and can remain available when AI mode is unavailable. |
| Reports | Individual `/reports/*` routes; `/cash-forecast` | Protected app routes; several financial statements use accounting-organisation capability; cash forecast is Growth-gated; budgets/FX have capability gates. | Report tools, not a single dashboard landing page. Cash forecast is the most dashboard-like report. |
| Platform admin | `/admin/businesses`, `/admin/billing` | `PlatformAdminRoute` and `AdminLayout`; platform-admin audience. | Cross-tenant business directory and manual subscription grant tool. Not a business tenant’s dashboard. |
| Data import | `/import`, `/data-import`, `/onboarding/import` → same `DataImportPage` | Protected app route and role routing; no separate import-specific plan/capability gate is visible on these routes. | Migration/onboarding wizard, not an analytics dashboard. All three routes use one implementation. |

## 4. Page-by-page findings

### 4.1 Global financial dashboard — `/dashboard`

**Purpose and content.** `src/pages/DashboardPage.tsx` presents a financial overview with five cards: net profit, total income, total expenses, accounts receivable, and VAT accrued. It also contains a six-month income-versus-expense chart, a cash-flow indicator, up to ten recent journal entries, four quick actions (new invoice, record income, record expense, run payroll), a tax remittance panel, a session tax reminder, an onboarding checklist, and a plan-usage meter when the plan has a finite transaction limit. An upgrade modal is mounted but no visible trigger is connected in this page’s current quick-action/card markup.

**Data sources and date semantics.** `src/hooks/useDashboardData.ts` uses income and expense repositories, `FinancialStatementRepository.getProfitOrLoss`, journal/period repositories, and outstanding invoices. Monthly hooks first find the latest date across invoices and expenses, then calculate a calendar month around that date; without any anchor they fall back to the browser month. Consequently, the UI label “this month” can describe the most recent month with any invoice/expense data, not the current month. This may be intentional for future-dated/dev data, as the hook comments explain, but the user-facing label does not disclose that anchor.

The trend query also anchors its six monthly buckets to the latest income/expense date. Its expense reducer excludes `void` but not `draft`, whereas `useMonthlyExpenses` excludes both `void` and `draft`. Thus the trend can disagree with the cash-flow indicator/monthly expense total when draft expense records exist. Verify expected accounting semantics and align the filtering rules.

The VAT card computes output VAT less input VAT. The tax panel separately calls `useVatSummary` and `usePayeSummary` and calculates MRA due dates. It shows a loading skeleton, but after loading it renders zero/placeholder values when summary data is absent; it does not expose an explicit query-error state in the inspected JSX. Keep errors distinguishable from a real zero balance.

**Loading, empty and refresh.** KPI cards show skeletons and a localized error message; chart, cash-flow and recent-transaction areas are wrapped in section error boundaries and receive query loading/error states. A no-business-selected state is shown. A dedicated desktop refresh control/date-range selector is not present in the inspected dashboard. Query staleness is defined in the hooks (five minutes for most monthly values, ten minutes for trend); no dashboard-specific refresh action was found.

**Navigation and interaction.** The desktop KPI cards are buttons that copy their displayed full value to the clipboard; they do not drill into the income, expense, receivable or tax detail that a user might expect. Quick actions do navigate to their workflows. Recommendation: make KPI cards semantic links to filtered detail/report views, retaining copy only as a clearly named secondary action if desired.

**Mobile variant.** `src/components/mobile/MobileDashboard.tsx` has a greeting/business header, search and appearance-settings buttons, screen-rotation control, a net-profit hero with hide/show amount, onboarding checklist, four financial stats (income, expenses, outstanding invoices, VAT), customizable up-to-four quick actions, low-stock alerts when inventory is enabled, and expandable workspace navigation with optional pins. It has loading skeletons for the hero/cards and low-stock card, plus a low-stock “OK” empty state. It intentionally omits the desktop trend chart, cash-flow indicator, recent journal list, tax-remittance panel, and usage meter.

The mobile pull-to-refresh handler invalidates `['monthly_income']`, `['monthly_expenses']`, and `['outstanding_invoices']`, but the dashboard hooks use `['income','monthly',businessId]`, `['expenses','monthly',businessId]`, and `['invoices','outstanding',businessId]`; the monthly profit/loss and expense-VAT queries are not invalidated either. The inventory `['reorder_alerts', businessId]` key does match. This is a verified refresh-key mismatch in source and should be fixed before treating pull-to-refresh as a dashboard refresh. The mobile dashboard’s invoice/outstanding shortcut routes are useful drill-downs; the summary date range is still implicit.

### 4.2 Construction executive overview and operational workspace

**Executive view.** `src/components/construction/dashboard/ConstructionDashboard.tsx`, reached through `/dashboard` for businesses with construction capability, offers 3-, 6-, 12-month and all-time ranges. It combines project listing/metrics and `ProjectRepository` calls: `get_dashboard_metrics`, `get_project_valuation_trend` per active project, `get_cost_breakdown_by_project`, `get_retention_aging`, and `get_valuation_history` for recent activity. Visible widgets include six KPIs (active projects/average completion, contract value, billed and paid this period, outstanding receivables, retention held, projects over budget), cumulative billing trend, status distribution, top-five project cost-vs-budget comparison, retention-aging table, and recent valuations/invoices.

Loading and project/metrics failures have explicit states; no-projects and no-valuations states are also explicit. Ancillary query failures are less clear: cost-breakdown and retention queries are defaulted to empty arrays in rendering, and valuation-history failures are caught per project as empty lists. A failed ancillary read may therefore look like “no costs/retention/activity” instead of an error. The dashboard has responsive card grids and horizontally scrollable tables; no separate mobile construction dashboard is implemented or verified.

**Operational view.** `/construction` is a different product surface: `ConstructionWorkspacePage` performs a capability check and renders `ConstructionOverviewSection` for the root path. Its server-backed overview includes open holds, accepted lines awaiting cost basis/posting, outstanding supplier claims, posting policy status, project sites/material-issued information, PO counts by status and lists of holds/cost-basis/posting/claim items. It has explicit loading, error and empty components and wraps its tables horizontally. The route is Enterprise + construction gated. The source explicitly says its displayed figures are server reads and not browser-estimated.

**Recommendation.** Preserve both views, but label them unambiguously and cross-link them. Keep the executive project portfolio under the global overview (or a clearly named `/construction/dashboard` alias if product navigation requires it); keep `/construction` as the operational procurement workspace. Do not merge away its audited procurement queues in favor of a chart-only dashboard. In the global shell, show the executive view as a construction module rather than suppressing shared financial widgets.

### 4.3 Manufacturing — duplicate dashboard routes

`/manufacturing` and `/manufacturing/dashboard` are both Enterprise- and manufacturing-capability-gated in `src/App.tsx` and both render the same `ManufacturingDashboardPage`. The sidebar points to `/manufacturing`; the inspected tests expect that path as the manufacturing dashboard. No source-backed difference in purpose or widget set exists between the URLs.

The page’s single React Query read (`getManufacturingDashboard`) fans out to seven RPCs: `manufacturing_dashboard_metrics` for the selected and previous ranges, `manufacturing_throughput_trend`, `manufacturing_yield_by_product`, `manufacturing_wip_aging`, `manufacturing_cost_variance`, and `manufacturing_production_summary`. It offers week/month/quarter/year/custom ranges and period comparisons. Widgets are active work orders, output this period and trend, average yield, WIP value; throughput/output and scrap trend; yield by product; aging WIP with drill-through to work orders; work-order cost variance; and a product production summary.

Loading is a page skeleton; failure of any Promise in the combined query produces a visible error and retry. Empty datasets have dedicated messages. Table regions use horizontal scrolling and minimum widths; summary cards/charts adapt through CSS grids. Refetch-on-window-focus is disabled, a five-minute stale time is set, and no explicit refresh control is shown. Metric cards link active work orders and WIP aging; work-order tables link to detail. This is a good domain-specific starting point, but the global `/dashboard` does not expose manufacturing metrics merely because manufacturing is enabled (only the construction capability currently changes its dashboard branch).

**Recommendation.** Make `/manufacturing` canonical; retain `/manufacturing/dashboard` as a redirect or compatibility alias unless product discovery supplies a distinct purpose. If both routes must remain active, assign and test distinct jobs before keeping both.

### 4.4 POS analytics and shift Z-reports

`PosPage` is a Retail-operating-model and POS-capability-gated till with sales, analytics, history and settings view modes. Its source loads products/customers/shift and `repos.invoice.findByBusiness(businessId, undefined, 30)`; those up-to-30 invoices are mapped into the local `salesHistory` state. New sales are prepended to this state. `PosOwnerAnalytics` then computes gross/net revenue, average ticket, discounts, return count and cashier leaderboard in memory with today/7-day/30-day/all-time filters and a branch selector. The selector and date filters are client-side; no dedicated server aggregate or independent analytics pagination is used by this component. The “real-time multi-branch” subtitle therefore exceeds what the bounded source read alone proves. The displayed cashier metrics derive from mapped invoice fields and the loaded sample, not necessarily a complete POS sale ledger.

Loading/error behavior is inherited from the POS page load, whose product-loading state is not an analytics-specific loading/error boundary. The analytics view has a no-sales empty message. Its table scrolls horizontally, but analytics cards use a single-column mobile grid at the smallest breakpoint.

`PosZReportModal` is opened after closing a shift or from POS controls. Closing calls `repos.pos.closeShift`, then fetches `repos.pos.getShiftReport` to obtain the immutable server report number. The displayed summary, however, is generated in `src/services/posReportService.ts` in the browser from `shift` plus `salesHistory`. It loops over the supplied sales without checking `shift_id`, date window, or cashier, and the modal receives the same recent-invoice history list described above. Thus the displayed sales summary is not demonstrably shift-scoped; the server-provided number and client-computed report body have different sources. Email dispatch is explicitly unavailable and the UI says nothing is sent; print is available. The modal body shows sales totals, taxes/refunds, cash-in/out and drawer reconciliation but does not render the service’s payment breakdown. The report-number fallback is generated client-side when the server number is absent, despite the normal signed-close path preferring the server number.

**Recommendation.** Treat the server shift report as the canonical, immutable report payload (number, shift-scoped sales/tenders/refunds/cash movements and reconciliation), render that payload in the modal and print output, and make analytics use a server query/RPC with explicit range, branch and completeness. Avoid describing a capped invoice-history calculation as real-time all-branch analytics. This is a data-provenance recommendation, not a claim that backend shift-report data is wrong.

### 4.5 Payroll

`/payroll` is a tabbed payroll operating area, not a dashboard landing page. The page defaults to Employees and offers Payroll Runs (when plan capabilities permit), Employees, and Cost Centers. Pay-run list data comes from `repos.payroll.findByBusiness`; a selected run loads its lines with `findWithLines`, while employee, branch and department references support filters and allocation. The selected-run detail includes beneficiary count, gross paid, deductions/PAYE/pension, net paid, disbursement channels and branch/cost-centre rollups. The Cost Centers tab contains its own “Cost Center & Branch Payroll Report” and KPI cards from the active staff master allocation or a selected historical run, depending on its scope selector.

These are repository-backed calculations, not sample widgets. Loading/error treatment varies by tab and query; the run list exposes loading/error state, and the cost-centre report has a live-master vs run selector, filters, headcount and CSV export. Tables are horizontally scrollable. Direct mobile runtime behavior was not tested; source uses responsive grids and table overflow in some report sections.

**Recommendation.** Do not create a generic payroll “dashboard” by duplicating employee/pay-run tables. Add a small payroll snapshot to the global dashboard only when it can answer a decision (next/overdue run, committed net payroll, PAYE/pension due date, missing employee assignment), with links to the authoritative payroll workflow and clear period/status.

### 4.6 Inventory

No dedicated inventory dashboard route was found. `/warehouse` is an operational stock list with location filter, search, stock-receive action, stock sync/duplicate-receipt repair/reconciliation panels, and a low-stock count. It queries inventory locations, balances with details and trackable products. Desktop rows show on-hand/reserved/available, average cost, stock value and status; mobile uses stock cards and loading/empty views. The low-stock count is computed from the currently filtered rows (including current search and location filtering), so it is not necessarily an organisation-wide alert count.

The global mobile dashboard has a separate capability-gated card backed by reorder-alert repository data, showing an alert count and at most two products, or “Stock levels OK.” That card’s empty state is more actionable but does not include stock value, location totals, ageing or movement trends. `/products` and `/transfers` remain operational tools.

**Recommendation.** Add a compact inventory snapshot to the vertical-aware global dashboard (valued on-hand, low-stock count independent of list filters, stockouts and recent adjustments/reconciliation status). Keep the detailed warehouse list and reconciliation/repair controls in `/warehouse`; do not turn that operational page into an unbounded KPI wall.

### 4.7 Partner administration

`/partner-admin` shows partner count, onboarded client count and total client capacity, then partner cards with used/limit progress. Data comes from `PartnerRepository.getAll(true)` for platform admins or partner-admin context for scoped users, plus `getClientCounts()`. `/partner-admin/partners/:id` shows client count/capacity, active clients, total invoice count and journal-entry count, enabled module flags and isolation policy; it also has platform-admin controls. These figures describe partner tenants and usage, not any one tenant’s revenue or performance.

The top-level page shows a loading state for access and (platform-admin) partner list, but the client-count query defaults to `{}` without an explicit error state, which could present zero counts when the count query fails. Partner detail explicitly waits only on the partner record; usage/flags/admin counts default and are not all separately surfaced as loading/error. This is an admin-console reliability issue, not an ERP dashboard gap.

### 4.8 Ledgr AI

`/ai` uses the same `Assistant` component used by the app’s floating drawer, starting in AI mode. AI mode is available only when the partner `ai_agent` feature, a selected business and the `ai_insights` plan capability are all present; otherwise the assistant falls back to Support mode. `buildAssistantContext` calls the `ai_context` RPC with business and optional branch, and computes a three-month forecast client-side from returned context. The AI landing view can show an advised business-health card and up to three anomalies, then chat/suggested prompts. The context includes KPI, trend, overdue invoices, top expenses/customers, concentration, anomalies and receivable/payable schedules; branch selection is included in the query key and server authorization is documented in source.

This is live/context-derived rather than a static dashboard. Context has a five-minute cache, a loading state, and knowledge-base/rules fallback paths when the remote assistant is unavailable. The forecast and advisor are derived from returned data; they should be presented as estimates/interpretations, not as ledger-posted balances. The same assistant appearing both as full-page `/ai` and a floating drawer is intentional component reuse, not duplicate route dashboards.

### 4.9 Reports and cash forecast

There is no `/reports` overview route in the inspected route table. The trial balance, profit and loss, balance sheet, cash flow, changes in equity, revenue breakdown, branch performance, VAT return and withholding-tax schedule are individual report routes, several with accounting-organisation gates. FX revaluation, budgets and depreciation have additional plan/capability gates. This is a report catalogue/workflow rather than a dashboard.

`/cash-forecast` is the most dashboard-like report: it calls `generate_cash_forecast` and reads/saves `cash_forecast_scenarios`; supports 3/6/9/12-month horizon, receivable/payable delays, payroll growth and conditional construction assumptions; and displays shortfall alerts, a closing-balance chart, monthly roll-forward table and source counts/limitations. Loading, query error/retry, saved-scenario error and shortfall states are explicit. It is horizontally scrollable and uses responsive form grids. The server RPC is the source of forecast figures; the UI exposes source counts and caveats, which is a useful model for dashboard transparency.

**Recommendation.** Provide a lightweight report index or dashboard report launcher only if needed for discoverability; do not duplicate report outputs. Use `/cash-forecast` as the pattern for provenance, as-of date, assumptions, shortfall alert and source limitations.

### 4.10 Platform admin and data import

`/admin/businesses` is a platform-admin directory backed by `BusinessAdminRepository.listAll()` (documented as `list_all_businesses()` RPC), with search, owner names/emails, plan and registration date. It has loading, error and no-match states. `/admin/billing` is a manual subscription-grant form, not a billing dashboard; it searches businesses and records payment method/reference/notes via `subscriptionPaymentService` and a server-checked Edge Function. Neither should be merged into tenant dashboards.

`/import`, `/data-import` and `/onboarding/import` all render `DataImportPage`. It is a select/upload/preview/import/result workflow, with CSV templates, validation and import counts/issues. The import service defines templates for chart of accounts, contacts, products, opening balances, trial balance, invoices, bills, fixed assets, inventory opening, bank transactions and employees. The default category selector in the page presents foundation, master data, fixed assets and employees; URL query parameters can preselect a valid supported entity. The preview and result are based on the selected upload and import result, not placeholder analytics. No dashboard-style loading/empty/refresh assessment applies; import result, file parsing and query-backed reference data have workflow states.

**Recommendation.** Keep import and admin routes outside the dashboard taxonomy. Choose one canonical import URL for generated links, but retain the other entry paths for compatibility/onboarding unless route analytics prove they are unused.

## 5. Cross-cutting assessment

### 5.1 Coverage and purpose

| Domain / audience | Current coverage | Assessment |
|---|---|---|
| Shared finance | `/dashboard` generic view; financial reports | Strong first-pass summary, but KPI drill-through is absent on desktop and date semantics need correction/clarification. |
| Construction | Executive project view reached via global dashboard; independent procurement workspace | Two complementary jobs, currently not clearly named or linked; global branch selection hides common financial layer. |
| Manufacturing | Two aliases to one operational dashboard | Good focused widgets, route duplication; not composed into global dashboard. |
| Retail/POS | Till and owner analytics view; shift close report | Useful but analytics completeness and report shift-scope are not established by current client data flow. |
| Payroll | Payroll runs, employee management, cost-centre/run reporting | Operations are covered; no concise portfolio snapshot. |
| Inventory | Warehouse/product/transfer tools and mobile low-stock summary | Operations covered; no central inventory health/value summary. |
| Partner admin | Partner/client capacity and partner usage counters | Correctly isolated from tenant business dashboards. |
| AI | Health/advisor/anomaly/forecast context in AI assistant | Complementary interpretive layer, not the authoritative dashboard ledger. |
| Financial reporting | Separate report routes and cash forecast | Reports exist individually; no unified report launcher/dashboard. |
| Platform admin/import | Admin directory/grant form and import workflow | Not dashboards; keep as separate admin and onboarding tools. |

### 5.2 Consistency findings

- **Metric periods are not consistently explicit.** Global finance labels the month but does not expose its anchor; construction has 3/6/12/all; manufacturing has calendar/custom ranges; POS has today/7/30/all; cash forecast has configurable horizons. Standardize visible “as of / period” context and let relevant cards link to the underlying period-filtered page.
- **Zero, no data and failed reads are not consistently distinguishable.** Global tax summary and ancillary construction queries can present defaults/empty arrays without a visible failure distinction; partner client counts similarly default to empty. Preserve explicit loading/error/empty/success states for every independent query.
- **Currency and data provenance are uneven.** Manufacturing/construction use business currency fields; global finance strings append MWK; POS formatting is explicitly MWK; cash forecast reports base currency and limitations. Show the actual currency/source at dashboard level and do not imply full coverage where a source is capped or a query is client-aggregated.
- **Drill-down behavior is inconsistent.** Manufacturing and construction include several links, mobile financial cards navigate, but desktop global KPI buttons only copy values. POS cards/analytics are mostly display-only; tax panel has no clear report CTA. Establish a common expectation: a KPI is either a link to filtered detail or a non-interactive display, never a button with an unrelated clipboard action.
- **Responsive support varies by experience.** Global dashboard has a separate phone layout; manufacturing and construction use responsive grids and horizontally scrollable tables; POS analytics uses responsive cards/scrolling table; warehouse has mobile stock cards; payroll uses responsive layouts in report sections. This was inferred from responsive classes, not verified on devices. Test long translated labels, touch targets, table navigation and chart readability at narrow widths.
- **“Refresh” has no common contract.** React Query cache/staleness varies; manufacturing disables focus refetch; mobile pull-to-refresh has mismatched keys; no common last-updated indicator is shown across the audited dashboard-like pages.

### 5.3 Duplication and consolidation

- **Confirmed duplication to resolve:** `/manufacturing` and `/manufacturing/dashboard` both render one dashboard. Canonicalize one route and redirect the alias, or document and build distinct purposes before preserving both.
- **Not duplication:** `/dashboard` construction executive view and `/construction` procurement overview are separate jobs with different data. Connect and label; do not collapse them into one.
- **Intentional shared implementation:** `/ai` and the floating AI drawer share `Assistant`; import aliases share `DataImportPage`; POS analytics and Z-report are POS view/modal states, not separate routes.
- **Potential widget duplication:** mobile finance cards and desktop global KPIs overlap by purpose but intentionally use different layouts/data presentation. Standardize metric contract and drill-down even if visual density differs.

## 6. Target strategy: vertical-aware global dashboard

### 6.1 Product model

**Recommendation:** `/dashboard` should remain the single global overview entry point, consisting of:

1. **A shared business-health strip** available to every eligible tenant: profit/revenue/expense context, cash and receivables/payables, tax due/overdue actions, period and currency, and clear links to source reports.
2. **One or more capability/operating-model modules** derived from enabled business configuration. Construction, manufacturing, retail/POS, inventory and payroll summaries can coexist; capability presence must not force replacement of shared financial content. If a business has multiple vertical capabilities, surface multiple compact modules with sensible ordering rather than selecting only construction.
3. **A role-aware activity/action layer** showing relevant quick actions and exceptions that the viewer can access. Keep authorization at the route/server as well as UI visibility; dashboard visibility is not a substitute for gates.
4. **A consistent desktop/mobile contract.** Mobile may reorder or collapse widgets but should preserve a way to reach the same decision information and a reliable refresh path. Add explicit “view all” links rather than silently removing whole domains.

Keep `/construction` as the construction procurement and control workspace, `/manufacturing` as the production dashboard, `/warehouse` as inventory operations, `/payroll` as payroll operations, and `/ai` as an advisory interface. This avoids turning every module into a second global dashboard.

### 6.2 Proposed widgets by priority

**P0 — trust and decision safety (fix before expansion)**
- Explicit date period/as-of and currency on every monetary KPI.
- Correct global finance period behavior: either use the actual current month or label the selected/latest-data month accurately; keep financial statement, income, expenses, VAT and trend aligned.
- Resolve draft/void transaction inclusion consistently between monthly totals, cash-flow indicator and trend.
- Make mobile pull-to-refresh invalidate the actual dashboard query keys and all displayed query families; show refreshing and last-updated feedback.
- Make Z-report body and printed version derive from one server-authoritative, selected-shift payload. Surface unavailable report details as unavailable rather than substituting unrelated recent invoices.
- For every independent query, distinguish loading, error, no records and a verified zero.

**P1 — common global decision layer**
- Cash balance with reconciliation/as-of state and source-account coverage.
- AR/AP ageing and overdue totals with links to filtered invoices/bills.
- Near-term cash forecast/shortfall and upcoming major cash commitments, linking to `/cash-forecast` with assumptions visible.
- Tax due/overdue list with period, deadline, amount and route to the relevant VAT/PAYE workflow.
- Recent posted business activity with status, not just a transaction amount, and link to source record.
- Shared quick actions role-filtered and capability-aware.

**P1 — vertical summaries**
- **Construction:** active project count and completion, over-budget project count, billed-versus-paid, receivables/retention aging, open procurement holds and accepted receipts awaiting cost/posting. Use `/construction/projects`, `/construction/retention`, and procurement routes as drill-downs.
- **Manufacturing:** current-period output versus previous period, yield/scrap, WIP aging/value, cost variance exceptions and active work orders. Reuse current manufacturing RPCs/cards rather than clone them.
- **Retail/POS:** today’s net sales and order count, payment-channel mix, returns/discounts, drawer variance/shift status, branch comparison and low/zero-stock warnings. Use a complete server data window and current branch context.
- **Inventory:** total stock value and quantity by location, low-stock/stockout count independent of search filters, aged/slow stock and latest reconciliation/adjustment status.
- **Payroll:** next/last pay run state, committed net pay, PAYE/pension due, and employees missing branch/department/bank/payment setup. Use current payroll repositories and avoid exposing salary figures to unauthorized roles.

**P2 — refinement**
- Saved personal/role dashboard layouts only after common metric definitions and query scope stabilize.
- Add a report index with search/favorites only if report navigation telemetry or usability testing establishes a discoverability problem.
- Offer comparisons/targets only where the backend has an authoritative target and period definition; avoid decorative trend percentages without a credible baseline.

### 6.3 Widget interaction and presentation standard

For every card, specify: owner audience, source repository/RPC/table, server scope, calculation, currency, period/as-of, stale time or refresh behavior, error/empty/zero states, role/capability condition, and drill-down target. Prefer server aggregates for cross-branch/high-volume figures. For computed client summaries, record a completeness limit and scope explicitly. Keep tables responsive through responsive summaries or horizontal scrolling; do not make visual chart color the only signal. Provide accessible labels and text summaries for charts.

## 7. Prioritized recommendation backlog

| Priority | Recommendation | Evidence / outcome |
|---|---|---|
| P0 | Align dashboard financial periods and transaction inclusion rules; disclose the date anchor. | Monthly hooks anchor to latest invoice/expense; trend excludes void only while monthly expenses excludes drafts too. Prevent stale-month and inconsistent totals. |
| P0 | Make POS analytics completeness and Z-report shift scope server-authoritative. | POS loads at most 30 invoices for `salesHistory`; analytics uses that list; client report summary loops supplied sales without a shift filter. Prevent incomplete or cross-shift reports. |
| P0 | Repair mobile refresh invalidations and cover all visible dashboard queries. | Most invalidated query keys do not match actual query keys. Ensure pull-to-refresh updates what the user sees. |
| P1 | Adopt explicit error/empty/zero semantics for ancillary query-backed widgets. | Tax, ancillary construction, and partner counts can fall back to zero/empty data. Avoid false “all clear” interpretation. |
| P1 | Change global financial KPIs from clipboard buttons to semantic drill-down links. | Verified desktop cards copy values and do not navigate. Improve task completion and accessibility. |
| P1 | Canonicalize manufacturing dashboard route and preserve alias by redirect. | Both current routes render the exact same gated component and data. Reduce navigation and testing ambiguity. |
| P1 | Build a shared global dashboard shell with additive vertical modules. | Current construction capability replaces the generic financial view; manufacturing/POS/inventory/payroll are not composed into global overview. Retain common finance and surface all enabled modules. |
| P2 | Add concise inventory and payroll decision summaries, not duplicate operations pages. | No dedicated inventory/payroll dashboard route; useful operational data is distributed among `/warehouse` and payroll tabs. |
| P2 | Standardize period/currency/freshness/drill-down and narrow-screen conventions. | Current pages differ in date controls, currencies, refresh behavior, links and responsive presentation. |
| P2 | Consider a report directory only after validating discoverability. | Individual reports exist but no `/reports` landing route. Do not build a second dashboard from report copies without user evidence. |

## 8. File appendix

The following files were inspected or are primary implementation references for this audit. Route line ranges refer to the checked-out `src/App.tsx` and are included to make the audit reproducible.

### Routes, access and global dashboard
- `src/App.tsx` — route table and per-route gates; construction routes around 453–692, manufacturing around 693–821, dashboard/POS around 822–831, payroll/inventory around 835–901, reports around 925–1006, AI/import around 1046–1064, platform/partner admin around 436–449.
- `src/pages/DashboardPage.tsx` — global dashboard branching, generic finance view, KPI cards and quick actions.
- `src/hooks/useDashboardData.ts` — finance query keys, date anchoring, P&L/income/expense/VAT/AR/trend/journal sources and status filters.
- `src/components/mobile/MobileDashboard.tsx` — mobile global dashboard, inventory summary, workspace navigation and pull-to-refresh invalidations.
- `src/components/dashboard/TaxRemittancePanel.tsx` — VAT/PAYE summaries and due-date panel.
- `src/components/dashboard/TaxReminderModal.tsx` — session-level tax reminder.
- `src/components/billing/UsageMeter.tsx` — finite-plan usage meter.
- `src/components/OnboardingChecklist.tsx` — dashboard onboarding progress.

### Construction and manufacturing
- `src/components/construction/dashboard/ConstructionDashboard.tsx` — construction executive dashboard, range filter, portfolio widgets and queries.
- `src/components/construction/ConstructionOverviewSection.tsx` — procurement/workspace overview and server-backed open-item indicators.
- `src/pages/construction/ConstructionWorkspacePage.tsx` — construction workspace shell and path-selected sections.
- `src/dal/repositories/ProjectRepository.ts` — project summary/valuation/retention/cost dashboard RPC methods.
- `src/pages/manufacturing/ManufacturingDashboardPage.tsx` — manufacturing dashboard widgets, period filter, loading/error/empty states and drill-throughs.
- `src/dal/repositories/ManufacturingDashboardRepository.ts` — manufacturing dashboard RPC inventory and query aggregation.

### POS, payroll and inventory
- `src/pages/PosPage.tsx` — POS gate target, loaded invoice history, branch/shift handling, shift close and analytics/Z-report wiring.
- `src/components/pos/PosOwnerAnalytics.tsx` — client-side POS filters and summary metrics.
- `src/components/pos/PosZReportModal.tsx` — shift-close Z-report display and explicit email-unavailable notice.
- `src/services/posReportService.ts` — client-generated Z-report summary calculations.
- `src/pages/PayrollPage.tsx` — payroll tabs, repository data, run detail KPIs and cost-centre report.
- `src/pages/WarehousePage.tsx` — warehouse balances, low-stock warning, responsive stock list and inventory reconciliation panels.

### Partner admin, AI, reports and administration
- `src/pages/partner-admin/PartnerAdminDashboard.tsx` — partner count, client count/capacity and partner cards.
- `src/pages/partner-admin/PartnerOverviewPage.tsx` — partner-level usage counters and admin settings.
- `src/pages/AiInsightsPage.tsx` — full-page assistant wrapper.
- `src/components/ai/Assistant.tsx` — AI/support mode gates, cached context, health/anomaly cards and assistant UI.
- `src/lib/ai/context.ts` — `ai_context` RPC context and client-side forecast preparation.
- `src/pages/reports/CashForecastPage.tsx` — scenario-driven cash forecast dashboard/report.
- `src/pages/admin/AdminBusinessesPage.tsx` — platform-admin business directory.
- `src/pages/admin/AdminBillingPage.tsx` — manual subscription grant workflow.
- `src/pages/DataImportPage.tsx` — import wizard and supported entity selection.
- `src/services/dataImportService.ts` — templates, CSV validation and import execution.
