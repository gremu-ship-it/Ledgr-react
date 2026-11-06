# Ledgr Application UX / IA / i18n Audit

Date: 2026-11-04
Branch audited: `arena/16160df9-ledgr-react` (`dfbb269`)
Scope: static source audit of the checked-out branch. No runtime browser/production account was available; route and component behavior below is confirmed from source, not live deployment.

**Total issues: 18 (Critical: 1, High: 5, Medium: 9, Low: 3).** Counts are issue entries, not individual missing translation keys.

## Executive Summary

The most urgent confirmed defect is that `src/i18n/locales/en.json` has no `payroll` root object, while the Payroll navigation and module pages use hundreds of `payroll.*` labels. English users therefore see raw keys in payroll; the i18n resource wiring itself is present and falls back to English, so this is a missing-data problem rather than a namespace initialization bug. The Reports group mixes historical statements with cash forecasting, depreciation posting, FX revaluation, and budget setup; the Settings route is reachable from both the sidebar and account menu, and the account-menu “Profile” action also opens the Settings default tab. Two user-reported claims need correction: posted-run payslips already have a visible styled print action (its label is untranslated), and Payroll PAYE-band configuration is distinct from the generic Tax page rather than a true duplicate. The code has useful skeletons, error handling, empty states and mobile overflow wrappers, but consistency gaps remain; the app has no route-level breadcrumbs or route-specific document title updates.

## Critical Issues (fix before user rollout)

### C1. Payroll renders untranslated i18n keys throughout the module
- **Location:** `src/i18n/locales/en.json` (no top-level `payroll` object); i18n is loaded as `translation` with English fallback in `src/i18n/index.ts:3-31`. Runtime consumers include `src/components/layout/navConfig.ts:103-108`, `src/components/layout/BottomNav.tsx:80-83`, `src/App.tsx:835-878`, and the `src/pages/payroll/*Page.tsx` routes/components (notably Employees `EmployeeListPage.tsx:52-160`, Pay Runs `PayRunListPage.tsx:49-150`, Leave `LeaveRequestsPage.tsx:141-311`, and Pay Run detail `PayRunDetailPage.tsx:125-258`).
- **Severity:** Critical.
- **Impact / evidence:** 264 distinct literal `payroll.*` keys used by non-test source are absent from English resources. Dynamic lookups also produce missing statuses (`draft`, `calculated`, `approved`, `posted`, `reversed`, `pending`, `rejected`, `cancelled`) and feedback/validation messages; examples include ``t(`payroll.${item}`)`` in `PayRunListPage.tsx:83`, status labels in `LeaveRequestsPage.tsx:20-34`, and `t(feedback.key)` at `LeaveRequestsPage.tsx:261`. The sidebar section title and payroll labels therefore also render as raw key strings. The repo has the normal root-resource configuration; there is no `payroll` namespace initialization to repair. None of the five locale files (`en`, `fr`, `ny`, `pt`, `sw`) currently defines a `payroll` root, so every locale falls back to the missing English key.
- **Recommended fix:** Add a complete `payroll` object to `en.json` covering all keys in Appendix A, including dynamic status and error keys. Validate key resolution by rendering each Payroll route with empty, loading, error and populated states; ensure non-English locales receive translations or intentionally fall back to readable English.

## High Issues

### H1. Settings and Profile navigation collide on the same default destination
- **Location:** Sidebar Settings item: `src/components/layout/navConfig.ts:348-351`; header account menu: `src/components/layout/Header.tsx:345-368`; Settings tabs and default selection: `src/pages/SettingsPage.tsx:126-136, 2165-2186, 2227-2252`.
- **Severity:** High.
- **Impact:** “Settings” exists in the desktop sidebar and again as a gear-icon row in the top-right account menu. The adjacent “Profile” row also navigates to `/settings` without `?tab=profile`, so it opens the default Business Profile tab rather than the user profile. This creates duplicate labels and a misleading action, not two independent Settings pages.
- **Recommended fix:** Keep the sidebar Settings destination as the canonical global entry; make the account-menu Profile action target `/settings?tab=profile`, and either remove the duplicate Settings menu row or make it a clearly labeled shortcut to a distinct Settings subsection.

### H2. Reports navigation mixes read-only reports with operational tools and forecasts
- **Location:** Reports group in `src/components/layout/navConfig.ts:299-311`; routes in `src/App.tsx:925-960`.
- **Severity:** High.
- **Impact:** Cash Forecast (`/cash-forecast`) is scenario/forecast workflow; Depreciation (`/reports/depreciation`) previews and posts journal entries; FX Revaluation (`/reports/fx-revaluation`) posts period-end journals; and Budgets (`/reports/budgets`) creates/edits/activates planning data. They do not fit a “read-only historical reports” section. The group also has a `Budgets` parent/workflow label while Budget vs Actual is only reached through a selected budget detail route.
- **Recommended fix:** Move Forecast to Finance → Cash Management; Depreciation to Finance → Fixed Assets; FX Revaluation to Finance → Multi-currency / Period Close; move budget authoring to Finance → Planning, and expose Budget vs Actual as a report entry with a budget selector. Keep the historical statements and analytic reports under Reports.

### H3. A legacy, non-sidebar Payroll application remains mounted at `/payroll`
- **Location:** Route `src/App.tsx:870-873`; implementation `src/pages/PayrollPage.tsx:2190-2289`; current modular Payroll entries are in `src/components/layout/navConfig.ts:103-108` and routes in `src/App.tsx:835-878`.
- **Severity:** High.
- **Impact:** `/payroll` still opens the old tabbed flow over legacy payroll tables, with different employee/run data APIs and extensive hardcoded English, while sidebar users are sent to the newer `/payroll/*` flow. The legacy page is not a sidebar item and is easy to discover only through direct navigation/old links; it can create confusion about which payroll records are canonical.
- **Recommended fix:** Decide and document migration/parity for legacy-only features (notably cost-center allocation and old payroll exports); then redirect `/payroll` to the new Payroll landing/list or retire the legacy page and route once parity is verified. Do not remove it before confirming data and feature parity.

### H4. Hardcoded English bypasses i18n across route-page JSX
- **Location:** Heuristic scan of `src/pages/**/*.tsx` identified 760 candidate text-node occurrences in 39 files; a separate scan of nested POS components found 106 candidates in 14 files. Largest hotspots include `src/pages/PayrollPage.tsx` (134), `src/pages/SettingsPage.tsx` (65), `src/pages/AssetsPage.tsx` (57), `src/pages/IncomePage.tsx` (56), `src/pages/ExpensesPage.tsx` (45), `src/pages/CapitalPage.tsx` (43), `src/pages/ProductsPage.tsx` (38), and POS components `PosZReportModal.tsx` (16), `PosReceiptModal.tsx` (14), `PosOwnerAnalytics.tsx` (13), and `PosSalesHistoryModal.tsx` (11). Additional candidates are summarized in Appendix E.
- **Severity:** High.
- **Impact:** Users selecting Chichewa, Swahili, French or Portuguese can receive English labels and status/errors. Examples: Settings appearance labels `src/pages/SettingsPage.tsx:150-188`; financial setting labels `:704-770`; Business Profile labels `:452-468`; legacy Payroll buttons/errors `src/pages/PayrollPage.tsx:311-313, 536-538, 692-694, 1235, 1389`; Products form labels `src/pages/ProductsPage.tsx:211-239`; POS strings in `src/components/pos/PosZReportModal.tsx:53-93`, `PosReceiptModal.tsx:164-221`, and `PosPaymentModal.tsx:183-202`. Global copy also bypasses i18n in `PartnerPlanGate.tsx:56-61`, `CapabilityGate.tsx:12-52`, and layout components such as `OfflineQueueDrawer.tsx:312-384` and `ThemeToggle.tsx:14-15`. The text-node grep is a heuristic and contains some false positives; candidate counts are not a claim that every match is user-visible text.
- **Recommended fix:** Replace user-visible literals, placeholders, validation text, `aria-label`/`title`, and mutation messages with typed i18n keys; preserve identifiers, examples and data literals as non-translatable. Add a lint/test rule for raw JSX text and render the main routes under all supported locales.

### H5. Approved pay runs can be posted from the detail page without a confirmation step
- **Location:** `src/pages/payroll/PayRunDetailPage.tsx:166-170` calls `postMutation.mutate()` directly when status is `approved`; the new-run flow has a final review/confirmation step with a finality warning and a separate Post button (`src/pages/payroll/PayRunNewPage.tsx:235-263`), but not a modal; the detail page has no comparable review step.
- **Severity:** High.
- **Impact:** Posting is a consequential ledger action, yet navigating to an approved run and clicking “Post Pay Run” commits immediately. This is weaker than the new-run flow’s explicit final review/finality-warning step and creates accidental posting risk. The detail page does handle the response/error after submission.
- **Recommended fix:** Add an accessible confirmation dialog to the detail-page action (or route it through the same final review step); keep copy consistent that posting creates the payroll journal entry and correction requires reversal, and disable duplicate submission while pending.

## Medium Issues

### M1. Additional genuine missing English keys outside Payroll
- **Location:** `src/pages/manufacturing/BomEditorPage.tsx:375` uses missing `manufacturing.bom.removeComponent` as an accessible label; `src/components/reports/ReportHeader.tsx:126` calls missing `reports.addNotes` when notes are closed.
- **Severity:** Medium.
- **Impact:** The BOM remove button’s accessible name and the Reports “Add Notes” toggle can show raw keys. Related scan caveats: `assistant.anomaliesDetected` and `construction.subcontractor.directoryCount` are intentionally backed by `_one`/`_other` plural keys; `common.theme` has a `Theme` fallback; seven `planGuard.*` lookups occur in `src/routes/PlanGuard.tsx` but that component is not referenced by the app router, so they are not currently live-route defects.
- **Recommended fix:** Add the two live keys to English and other locales (or readable English fallback); either remove the unused PlanGuard component or translate its strings before reusing it. Keep plural entries and verify i18next plural resolution rather than adding a misleading base key.

### M2. Payroll PAYE bands are mislabeled like generic Tax Configuration
- **Location:** Payroll item `/payroll/tax-config` in `src/components/layout/navConfig.ts:108`; `TaxConfigPage.tsx:106-165` manages PAYE tax bands. Generic `/tax` is in Taxation via `navConfig.ts:317` and `src/App.tsx:920-923`; `SettingsPage.tsx:704-747` handles financial year, functional currency and VAT registration.
- **Severity:** Medium.
- **Impact:** The code does not show an exact duplicate feature: Payroll Tax Config edits payroll PAYE bands, while Taxation’s Tax page is general tax setup and Settings contains VAT-registration/business financial fields. The similar “Tax Configuration” naming makes them look duplicated, especially while the Payroll label is an untranslated key.
- **Recommended fix:** Keep distinct homes unless product owners confirm overlap. Rename the Payroll item/page to “PAYE Tax Bands” (or similarly explicit) and label `/tax` “Business Tax Setup”; document the canonical owners before removing either route.

### M3. Standard financial reports are incomplete
- **Location:** Report routes/menu inventory: `src/App.tsx:925-934` and `src/components/layout/navConfig.ts:299-319`.
- **Severity:** Medium.
- **Impact:** Present: Trial Balance, General P&L (`/reports/profit-loss`), Balance Sheet, historical Cash Flow Statement, VAT Return and WHT Schedule; Budget vs Actual exists at `/reports/budgets/:id` but is nested under budget management. Missing: General Ledger, Aged Receivables, and Aged Payables. No route or nav entry for those three standard reports was found.
- **Recommended fix:** Add scoped, exportable General Ledger and aging reports when in product scope; make Budget vs Actual discoverable as a report. Keep Cash Flow Statement distinct from Cash Forecast.

### M4. Route-to-sidebar parity has contextual routes and one user-facing orphan
- **Location:** Route declarations in `src/App.tsx:428-1075`; 62 configured sidebar paths in `src/components/layout/navConfig.ts:89-370`. Full route paths without an exact sidebar item are Appendix B.
- **Severity:** Medium.
- **Impact:** No configured sidebar destination was found to be broken: all 62 nav paths match a route, wildcard, or redirect. Most non-matching routes are intentionally nested create/detail/auth/admin/settings aliases. However `/payroll` is an unlinked legacy page (H3), `/manufacturing/dashboard` duplicates `/manufacturing`, and Tools/API/import routes have no desktop sidebar entry and rely on contextual/mobile/command-palette links.
- **Recommended fix:** Keep contextual CRUD routes out of the main sidebar; redirect or retire legacy `/payroll`; either make utility entry points discoverable from a canonical desktop Tools/Settings hub or document that they are intentionally contextual.

### M5. No consistent breadcrumbs on routed pages
- **Location:** Global shell `src/components/layout/AppLayout.tsx` and page routes; source search found no Breadcrumb/Breadcrumbs component or breadcrumb markup in routed pages. Phase 6 pages include `src/pages/FxRevaluationPage.tsx:75-78`, `src/pages/reports/DepreciationRunPage.tsx:174-176`, Payroll pages, and report pages.
- **Severity:** Medium.
- **Impact:** Users have no parent/section context on nested employee, pay-run, construction, manufacturing, budget, and statement-detail routes; detail/new flows rely on bespoke back buttons, if present.
- **Recommended fix:** Add a shared, localized breadcrumb pattern for nested routes, with semantic current-page indication and responsive truncation. Avoid redundant breadcrumbs on simple top-level screens.

### M6. Empty, loading and API-error states are not standardized
- **Location:** Examples: Payroll list uses table skeleton + error alert + `EmptyState` in `EmployeeListPage.tsx:91-105` and `PayRunListPage.tsx:89-101`; payroll tax uses a plain loading paragraph at `TaxConfigPage.tsx:129`; `src/pages/reports/BudgetListPage.tsx:67-72` uses a plain empty paragraph; FX revaluation uses generic loading text and empty copy at `src/pages/FxRevaluationPage.tsx:124-146`; depreciation uses inline empty paragraphs at `src/pages/reports/DepreciationRunPage.tsx:221-257`.
- **Severity:** Medium.
- **Impact:** Similar list experiences vary between skeletons, spinners, plain text and shared empty-state cards. Some have clear CTAs (Employees/Pay Runs/Leave), while Budget and Depreciation empty states do not consistently point to the next action. Query errors are handled on many pages, but some use generic text or missing i18n keys.
- **Recommended fix:** Define shared list-page states (skeleton, retryable error, empty title/description/CTA) and apply them to route-level lists; preserve feature-specific explanations and avoid replacing useful inline report loading indicators unnecessarily.

### M7. Capability and partner gate messages are inconsistent and partly hardcoded
- **Location:** `src/components/billing/PlanGate.tsx:17-61` gives translated plan-upgrade CTA; `PartnerPlanGate.tsx:43-67` builds partner-disabled text in hardcoded English; `CapabilityGate.tsx:11-52` hardcodes capability labels, explanation and “Contact support”; `OperatingModelGate.tsx:17-22` redirects unsupported models. Sidebar gate policy is in `src/components/layout/navConfig.ts:433-500` (comments) and `visibleSectionsFor` logic.
- **Severity:** Medium.
- **Impact:** Plan shortfalls show an upgrade prompt, partner-disabled modules show a contact/support prompt, capability mismatch shows a support prompt, and unsupported operating models redirect. Plan-locked nav items remain visible; partner/role/org-model items may be removed. The distinction is intentional, but hardcoded prompt copy and silent redirect behavior are inconsistent with localized upgrade messaging.
- **Recommended fix:** Localize gate copy and capability names; retain distinct upsell vs partner support wording; give direct-route operating-model redirects a clear message or safe landing explanation, while continuing to hide links for roles/business types that cannot use them.

### M8. Pay-run status filter works; there is no period filter, and only 25 newest runs show per page
- **Location:** `src/pages/payroll/PayRunListPage.tsx:16-40, 73-84, 148-153`; query implementation `src/lib/repositories/payroll.repository.ts:370-377`.
- **Severity:** Medium.
- **Impact / verified:** Initial status is `` (all statuses; no default draft/status filter). Selecting a status is passed to the repository and resets page to 1. Repository returns exact count, orders by `period_end` descending, and paginates 25 rows. Thus historical runs can exist beyond page 1; the code does not prove the reported “one run” account data issue. There is no period/date filter, and live database contents/tenant selection were not available in this static audit.
- **Recommended fix:** Add a clear period/date-range filter if payroll history is a common task; show total count and pagination prominently, preserve “All statuses” default, and investigate a customer’s one-run report against selected business, permissions, backend row count and pagination rather than presuming draft filtering.

### M9. Phase 6 features have routes, but discovery and empty-state readiness vary
- **Location:** FX Revaluation: `/reports/fx-revaluation`, `src/pages/FxRevaluationPage.tsx:75-146`; Budget setup/variance: `/reports/budgets`, `/reports/budgets/:id`, `src/pages/reports/BudgetListPage.tsx:40-72`, `BudgetVsActualPage.tsx:242-309`; Depreciation: `/reports/depreciation`, `DepreciationRunPage.tsx:174-257`; Payroll modular routes in `src/App.tsx:835-878` and nav at `navConfig.ts:103-108`.
- **Severity:** Medium.
- **Impact / verified:** Each feature has a route and nav entry except the old `/payroll` landing route (not in nav). FX has a subtitle, a no-balances message and a manage-exchange-rates path. Budget list explains planning and has a New Budget CTA; variance detail is only reached through a budget. Depreciation explains the workflow but its no-assets state has no direct add-asset CTA. Payroll pages have route descriptions and list CTAs, but all Payroll labels currently fail i18n. No Phase 6 surface has breadcrumbs. Actual backend functionality was not exercised.
- **Recommended fix:** Add an explicit Budget vs Actual discoverability path, a depreciation no-assets CTA to `/assets`, and retain the FX rate setup link; resolve Payroll i18n and legacy route first. Include explanatory landing copy and meaningful empty CTA on each operational workflow.

## Category-by-category evidence notes (non-additive; issues above are counted once)

### Payroll module page-by-page audit

| Route / surface | Findings and observed behavior |
|---|---|
| `/payroll/employees` and `/payroll/employees/new` | `EmployeeListPage.tsx` and `EmployeeNewPage.tsx` use `payroll.*` throughout; all referenced keys are absent. Directory has search/status filters, loading skeleton, error alert, responsive overflow table, empty-state CTA to add an employee, and a New Employee button. |
| `/payroll/employees/:id` | `EmployeeDetailPage.tsx` uses missing keys for personal/employment details, statuses, tabs, pay components, leave balances and actions. It has skeleton/error/empty states, horizontally scrollable components, and save/override/accrual actions. No breadcrumb. |
| `/payroll/pay-runs` | `PayRunListPage.tsx` uses missing keys; the status filter is functional and starts at All Statuses. It displays 25 newest rows per page and paginates. There is no pay-period/date filter. Draft rows are not excluded by default. |
| `/payroll/pay-runs/new` | Period selection, calculation, approval and posting flow is present. Existing-run recalculation warning is confirmed; final posting in this flow has a review/confirmation step with a finality warning and a separate Post button (not a modal). Labels/errors are missing translations. |
| `/payroll/pay-runs/:id` | Posted runs show a **visible `Print Payslips` action** in the top header action row, implemented as `<Button variant="secondary">` (neutral secondary button) next to View Journal Entry and the destructive Reverse Pay Run button (`PayRunDetailPage.tsx:171-179`). It is not hidden or unstyled in source; its displayed label is raw `payroll.printPayslips` because the translation is absent. Print view creates one payslip per pay-run line (`:209-247`) and print CSS hides the app UI (`:249`). Reverse is present and opens an accessible `alertdialog` confirmation (`:251-259`). An approved run can be posted directly without confirmation (`:166-170`; H5). A draft run can be recalculated; the detail page has no fields to edit its period/pay date, so “editable” is limited to recalculation, not inline record editing. |
| `/payroll/leave` | `LeaveRequestsPage.tsx` uses missing keys for the page, filters, statuses, forms, feedback and actions. New Request is discoverable in the header; pending rows expose explicit Approve and Reject buttons in the Actions column (`:223-228`). It has a confirmation-free one-click decision mutation, loading/error states and responsive table. This is a payroll-operator workflow that chooses an employee; it is not an employee self-service portal. |
| `/payroll/tax-config` | `TaxConfigPage.tsx` manages fiscal-year PAYE bands and calculation preview; its title and all labels/errors are untranslated. It is adjacent to, but not identical to, `/tax` general tax setup. Rename to Payroll PAYE Bands rather than remove before confirming product ownership. |

**Historical runs investigation:** source confirms no default status filter and no “drafts hidden by default” behavior. The repository selects all business pay runs when no status is passed, sorts by `period_end DESC`, returns a count, and paginates (`src/lib/repositories/payroll.repository.ts:370-377`). One run in a screenshot may reflect actual tenant data, selected business, permissions, or a currently visible page; production row count was not available to this audit.

### Settings page sections and canonical homes

`src/pages/SettingsPage.tsx:126-136, 2227-2297` contains these settings sections/tabs: **Business Profile; Financial Settings; User Profile; Security; Team Members; API & Webhooks; Billing & Plans; Appearance; Privacy; Approvals; Log out.** Recommended canonical homes:

| Concern | Current home | IA recommendation |
|---|---|---|
| Business Profile | Settings → Business Profile | Keep as Settings canonical. |
| User Management | Settings → Team Members (`TeamManagementPage`) | Keep nested under Settings; do not add a duplicate top-level nav item unless roles need it. |
| Chart of Accounts | Accounting → `/accounts` | Keep in Accounting; it is not a Settings tab. |
| Fiscal Year | Settings → Financial Settings (`financial_year_start`); period close/list under Accounting → `/periods` | Keep year-start setup in Settings and accounting periods in Accounting; label the distinction. |
| Currency | Settings → Financial Settings (base/functional currency, locked after onboarding) and Settings → Exchange Rates | Keep base currency and FX rates separate but explain their relationship. |
| General tax setup | Taxation → `/tax`; financial settings also expose VAT registration | Use Taxation as the canonical tax setup/report area; label the VAT-registration flag clearly. |
| Payroll PAYE bands | Payroll → `/payroll/tax-config` | Keep in Payroll, rename “PAYE Tax Bands”; this is not the same as general tax setup. |
| Profile | Header account menu currently points at Settings default tab | Point Profile to `/settings?tab=profile`; keep Settings sidebar item as the canonical Settings entry. |

### Reports section deep audit

| Current Reports item | Classification | Recommended home |
|---|---|---|
| Trial Balance (`/reports/trial-balance`) | True Report — historical/read-only | Reports |
| Profit & Loss (`/reports/profit-loss`) | True Report — historical/read-only | Reports |
| Balance Sheet (`/reports/balance-sheet`) | True Report — historical/read-only | Reports |
| Cash Flow Statement (`/reports/cash-flow`) | True Report — historical/read-only | Reports; keep distinct from forecast |
| Cash Forecast (`/cash-forecast`) | Forecast / scenario workflow | Finance → Cash Management |
| Budgets (`/reports/budgets`) | Operational planning/configuration; nested Budget vs Actual is a report | Budget authoring → Finance → Planning; expose Budget vs Actual under Reports |
| Depreciation (`/reports/depreciation`) | Operational workflow; previews and posts journal entries | Finance → Fixed Assets |
| Revenue Breakdown (`/reports/revenue-breakdown`) | True Report | Reports |
| Changes in Equity (`/reports/changes-in-equity`) | True Report | Reports |
| Branch Performance (`/reports/branch-performance`) | True Report | Reports |
| FX Revaluation (`/reports/fx-revaluation`) | Period-close operational workflow; posts journal entries | Finance → Multi-currency / Period Close |
| VAT Return (`/reports/vat-return`) | Tax report / return schedule | Reports → Tax, or Taxation reporting |
| WHT Schedule (`/reports/wht-schedule`) | Tax report / withholding schedule | Reports → Tax, or Taxation reporting |

Standard requested reports status: **present** Trial Balance, General P&L, Balance Sheet, historical Cash Flow Statement, VAT Return, WHT Schedule, and Budget vs Actual route; **not found** General Ledger, Aged Receivables, Aged Payables. The present Budget vs Actual route requires an existing budget and is not an independent Reports entry.

### Phase 6 discoverability matrix

| Feature | Sidebar / route | Explainer and empty state | Breadcrumbs / notes |
|---|---|---|---|
| FX Revaluation (6A) | Sidebar currently under Reports; `/reports/fx-revaluation` exists and is PlanGate-wrapped. | Subtitle explains revaluing open balances and posting unrealized gain/loss; no-balances message/hint and rate-management link are present. | No breadcrumbs; operation uses native `window.confirm`. |
| Budget vs Actual (6B) | Budgets item `/reports/budgets`; detail `/reports/budgets/:id` is reached through an existing budget. | Budget list explains planning vs actuals and has New Budget CTA; empty-list copy is simple. | No breadcrumbs; report lacks a direct Reports entry/selector. |
| Fixed Asset Depreciation (6C) | Sidebar under Reports; `/reports/depreciation` exists and is growth-gated. | Page explains the posting workflow and shows no-assets/history states, but no direct CTA to add an asset. | No breadcrumbs; accessible custom confirmation dialog exists. |
| Payroll (6D) | Payroll nav group and modular `/payroll/*` routes exist; old `/payroll` route is not in sidebar. | Pages have descriptions and list CTAs; missing translations affect all visible text. | No breadcrumbs; payroll history has status but not period filter. |

### Orphan pages/components and dead-code candidates

- No route page was confidently identified as an entirely unreferenced page module from `src/pages/`; `/payroll` is routed but is a legacy, non-sidebar surface (H3), not an unreferenced file. Nested forms, details, and tab modules are intentionally composed into route pages.
- `src/pages/SettingsPage.tsx::TeamMembersTab` (`SettingsPage.tsx:1131`) has no application reference; a test comment in `src/pages/settings/__tests__/roleUiParity.test.ts:89` says this legacy tab is not rendered, with the live Team tab using `TeamManagementPage`. Recommend remove after checking whether its invitation behavior is still needed.
- A name-reference scan excluding tests found these exported component candidates with no application import/reference outside their defining file; review usages/re-exports before deleting: `src/components/auth/SessionManager.tsx::SessionManager`; `src/components/construction/projects/ProjectBoqEditor.tsx::ProjectBoqEditor` (test-only use found); `src/components/pos/PosSettingsModal.tsx::PosSettingsModal`; `src/components/ui/Button.tsx::PrimaryButton`, `SecondaryButton`, `DestructiveButton`, `GhostButton`; `src/components/ui/EmptyState.tsx::NoInvoicesYet`, `NoCustomersYet`, `NoTransactionsYet`, `NoProductsYet`, `OnboardingEmptyState`, `SearchEmptyState`, `FinanceEmptyState`; `src/components/ui/Skeleton.tsx::CardSkeleton`; and `src/components/ui/VirtualList.tsx::VirtualList`. This is a lexical candidate list, not proof of dead code where barrels/dynamic imports are involved.

## Low Issues

### L1. Document title does not track route/page title
- **Location:** The only app document-title assignment found is branding-specific `src/partner/usePartnerTheme.ts:19`; no routed page or shell updates `document.title` on navigation.
- **Severity:** Low.
- **Impact:** Browser tabs/history and screen-reader navigation keep a generic title (or partner app name), reducing task context.
- **Recommended fix:** Set a localized page title plus product/partner name on route changes; restore the prior title on cleanup and avoid title churn during nested tab state unless useful.

### L2. Dead translation keys cannot be safely classified from exact `t()` calls alone
- **Location:** `src/i18n/locales/en.json` has 3,643 scalar leaves; a direct-literal `t('key')` scan finds 2,331 distinct key arguments and 1,588 defined leaves without an exact literal `t()` match. Static scan also sees dynamic nav label keys in `navConfig.ts`, computed status/error keys, and translation-key maps, so this is an upper-bound candidate set—not a verified dead-key list.
- **Severity:** Low.
- **Impact:** Removing all 1,588 would delete live labels and dynamically selected copy. Conversely, genuine stale text may remain. The source-only audit cannot prove runtime non-use without a key-aware AST/runtime inventory.
- **Recommended fix:** Add an i18n extraction/lint job that understands literal `t`, nav `labelKey`, `Trans`, plural suffixes, keyPrefix and enumerated dynamic families; report candidates for review, then remove only keys with no static or runtime references. No keys are labeled confirmed-dead in this audit.

### L3. Mobile tables are scrollable, but some workflows depend on wide horizontal scrolling
- **Location:** Payroll wrappers at `EmployeeListPage.tsx:105-106`, `PayRunListPage.tsx:101-102`, `LeaveRequestsPage.tsx:187-188`, `TaxConfigPage.tsx:132-133`; construction `SchedulePage.tsx:537-538` (min-width 1250px) and `SubcontractorsPage.tsx:353` (min-width 1040px); POS analytics `src/components/pos/PosOwnerAnalytics.tsx:202-203`.
- **Severity:** Low.
- **Impact / verified:** These tables have horizontal overflow wrappers, so no obvious narrow-screen clipping was found in source. On phones, users still must pan wide schedules, subcontractor data, tax bands and analytics tables rather than viewing prioritized fields/cards.
- **Recommended fix:** Keep the wrappers as a safe fallback; test at 320–390px and consider row cards/column prioritization for the widest operational tables. Avoid claiming a confirmed broken responsive layout absent browser evidence.

## Prioritized Fix Plan

### Phase 1 — remove user-visible blockers
- Add the missing Payroll English key set and validate all current routes, status labels and feedback keys; translate the two additional live missing labels (`manufacturing.bom.removeComponent`, `reports.addNotes`).
- Add an accessible post confirmation to the approved-pay-run detail action.
- Establish Reports vs Finance destinations and move Forecast, Depreciation, FX Revaluation, and budget authoring without removing report access.
- Resolve Settings/Profile navigation collision; preserve the canonical Settings page and point Profile directly to the profile tab.
- Make `/payroll` redirect to the chosen modular Payroll destination or document the legacy page until parity is complete.

### Phase 2 — navigation and report discoverability
- Rename Payroll PAYE bands to distinguish them from general Tax setup; decide canonical tax/setup labels with product owners.
- Add a Budget vs Actual entry/selector, depreciation empty-state CTA, and (when in scope) General Ledger and aging reports.
- Add shared breadcrumbs and normalize empty/loading/error states for list and detail routes.
- Localize gate messages and standardize the plan/partner/capability/operating-model explanation.

### Phase 3 — polish and guardrails
- Localize the hardcoded text hotspots, beginning with Settings and any remaining legacy Payroll code.
- Add route-specific document titles, phone-width table tests and a key-aware dead-key tool.
- Add a date/period filter for payroll history if customer workflows need it; diagnose real “one run” reports against tenant data/count/permissions.

## Appendix A — Full missing Payroll key inventory

The following direct literal keys are referenced by non-test source but are absent from `en.json`. Source paths and line numbers are listed for each. The route-level categories are described above; the path set includes Employee, Pay Run, Leave, Tax Config, journal modal, shared components, nav config, and `App.tsx`.

| Missing key | Source location(s) |
|---|---|
| `payroll.accrueLeave` | `src/pages/payroll/EmployeeDetailPage.tsx:489` |
| `payroll.actions` | `src/pages/payroll/LeaveRequestsPage.tsx:197`, `src/pages/payroll/TaxConfigPage.tsx:139` |
| `payroll.addBand` | `src/pages/payroll/TaxConfigPage.tsx:122` |
| `payroll.addEmployee` | `src/pages/payroll/EmployeeListPage.tsx:57`, `src/pages/payroll/EmployeeListPage.tsx:99`, `src/pages/payroll/EmployeeNewPage.tsx:140` |
| `payroll.addOverride` | `src/pages/payroll/EmployeeDetailPage.tsx:213`, `src/pages/payroll/EmployeeDetailPage.tsx:422` |
| `payroll.addPayComponentOverride` | `src/pages/payroll/EmployeeDetailPage.tsx:181` |
| `payroll.adjustEmployeeFilters` | `src/pages/payroll/EmployeeListPage.tsx:98` |
| `payroll.adjustPayRunFilters` | `src/pages/payroll/PayRunListPage.tsx:94` |
| `payroll.allStatuses` | `src/pages/payroll/EmployeeListPage.tsx:81`, `src/pages/payroll/PayRunListPage.tsx:81` |
| `payroll.approve` | `src/pages/payroll/LeaveRequestsPage.tsx:224` |
| `payroll.approveFailed` | `src/pages/payroll/PayRunDetailPage.tsx:189`, `src/pages/payroll/PayRunNewPage.tsx:78` |
| `payroll.approvePayRun` | `src/pages/payroll/PayRunDetailPage.tsx:163` |
| `payroll.approveRequiresCalculation` | `src/pages/payroll/PayRunDetailPage.tsx:187` |
| `payroll.approvingPayRun` | `src/pages/payroll/PayRunDetailPage.tsx:163`, `src/pages/payroll/PayRunNewPage.tsx:225` |
| `payroll.backToEmployees` | `src/pages/payroll/EmployeeDetailPage.tsx:342`, `src/pages/payroll/EmployeeDetailPage.tsx:364`, `src/pages/payroll/EmployeeNewPage.tsx:136` |
| `payroll.backToPayRuns` | `src/pages/payroll/PayRunDetailPage.tsx:125`, `src/pages/payroll/PayRunDetailPage.tsx:143`, `src/pages/payroll/PayRunNewPage.tsx:147` |
| `payroll.bandNumber` | `src/pages/payroll/TaxConfigPage.tsx:135` |
| `payroll.bankAccountNumber` | `src/pages/payroll/EmployeeDetailPage.tsx:88`, `src/pages/payroll/EmployeeDetailPage.tsx:239`, `src/pages/payroll/EmployeeNewPage.tsx:218` |
| `payroll.bankDetails` | `src/pages/payroll/EmployeeNewPage.tsx:213` |
| `payroll.bankDetailsDescription` | `src/pages/payroll/EmployeeNewPage.tsx:214` |
| `payroll.bankName` | `src/pages/payroll/EmployeeDetailPage.tsx:88`, `src/pages/payroll/EmployeeDetailPage.tsx:238`, `src/pages/payroll/EmployeeNewPage.tsx:217` |
| `payroll.businessDays` | `src/pages/payroll/LeaveRequestsPage.tsx:300` |
| `payroll.calculateFailed` | `src/pages/payroll/PayRunDetailPage.tsx:188`, `src/pages/payroll/PayRunNewPage.tsx:66` |
| `payroll.calculatePayRun` | `src/pages/payroll/PayRunNewPage.tsx:203` |
| `payroll.calculatingPayRun` | `src/pages/payroll/PayRunNewPage.tsx:203` |
| `payroll.calculationBasis` | `src/pages/payroll/EmployeeDetailPage.tsx:435` |
| `payroll.cancel` | `src/pages/payroll/EmployeeDetailPage.tsx:144`, `src/pages/payroll/EmployeeDetailPage.tsx:212`, `src/pages/payroll/EmployeeNewPage.tsx:228`, `src/pages/payroll/LeaveRequestsPage.tsx:309`, `src/pages/payroll/PayRunDetailPage.tsx:257`, `src/pages/payroll/PayRunNewPage.tsx:276` |
| `payroll.changePeriod` | `src/pages/payroll/PayRunNewPage.tsx:217` |
| `payroll.close` | `src/pages/payroll/EmployeeDetailPage.tsx:184`, `src/pages/payroll/LeaveRequestsPage.tsx:258`, `src/pages/payroll/PayRunJournalEntryModal.tsx:66` |
| `payroll.closeJournalEntry` | `src/pages/payroll/PayRunJournalEntryModal.tsx:30` |
| `payroll.companyName` | `src/pages/payroll/PayRunDetailPage.tsx:225` |
| `payroll.compensationDetails` | `src/pages/payroll/EmployeeNewPage.tsx:198` |
| `payroll.compensationDetailsDescription` | `src/pages/payroll/EmployeeNewPage.tsx:199` |
| `payroll.componentBreakdown` | `src/pages/payroll/payRunComponents.tsx:109` |
| `payroll.componentType` | `src/pages/payroll/EmployeeDetailPage.tsx:434` |
| `payroll.confirmAndApprove` | `src/pages/payroll/PayRunNewPage.tsx:225` |
| `payroll.confirmAndPost` | `src/pages/payroll/PayRunNewPage.tsx:139` |
| `payroll.confirmPosting` | `src/pages/payroll/PayRunNewPage.tsx:235` |
| `payroll.confirmPostingDescription` | `src/pages/payroll/PayRunNewPage.tsx:236` |
| `payroll.confirmReverse` | `src/pages/payroll/PayRunDetailPage.tsx:258` |
| `payroll.credit` | `src/pages/payroll/PayRunJournalEntryModal.tsx:49` |
| `payroll.currency` | `src/pages/payroll/EmployeeDetailPage.tsx:253`, `src/pages/payroll/EmployeeNewPage.tsx:204` |
| `payroll.days` | `src/pages/payroll/EmployeeDetailPage.tsx:510`, `src/pages/payroll/EmployeeDetailPage.tsx:511`, `src/pages/payroll/EmployeeDetailPage.tsx:517` |
| `payroll.daysWorked` | `src/pages/payroll/PayRunDetailPage.tsx:232`, `src/pages/payroll/payRunComponents.tsx:65` |
| `payroll.debit` | `src/pages/payroll/PayRunJournalEntryModal.tsx:48` |
| `payroll.deductions` | `src/pages/payroll/PayRunDetailPage.tsx:236` |
| `payroll.defaultValue` | `src/pages/payroll/EmployeeDetailPage.tsx:436` |
| `payroll.department` | `src/pages/payroll/EmployeeDetailPage.tsx:87`, `src/pages/payroll/EmployeeDetailPage.tsx:246`, `src/pages/payroll/EmployeeListPage.tsx:110`, `src/pages/payroll/EmployeeNewPage.tsx:173` |
| `payroll.earnings` | `src/pages/payroll/PayRunDetailPage.tsx:235` |
| `payroll.editEmployee` | `src/pages/payroll/EmployeeDetailPage.tsx:374` |
| `payroll.effectiveDates` | `src/pages/payroll/EmployeeDetailPage.tsx:438` |
| `payroll.effectiveFrom` | `src/pages/payroll/EmployeeDetailPage.tsx:102`, `src/pages/payroll/EmployeeDetailPage.tsx:203` |
| `payroll.effectiveTo` | `src/pages/payroll/EmployeeDetailPage.tsx:207` |
| `payroll.email` | `src/pages/payroll/EmployeeDetailPage.tsx:87`, `src/pages/payroll/EmployeeDetailPage.tsx:236`, `src/pages/payroll/EmployeeNewPage.tsx:162` |
| `payroll.employee` | `src/pages/payroll/EmployeeDetailPage.tsx:368`, `src/pages/payroll/EmployeeListPage.tsx:109`, `src/pages/payroll/LeaveRequestsPage.tsx:191`, `src/pages/payroll/LeaveRequestsPage.tsx:209`, `src/pages/payroll/LeaveRequestsPage.tsx:271`, `src/pages/payroll/PayRunDetailPage.tsx:216`, `src/pages/payroll/PayRunDetailPage.tsx:229`, `src/pages/payroll/payRunComponents.tsx:59` |
| `payroll.employeeBreakdown` | `src/pages/payroll/PayRunDetailPage.tsx:203` |
| `payroll.employeeBreakdownDescription` | `src/pages/payroll/PayRunDetailPage.tsx:204` |
| `payroll.employeeCount` | `src/pages/payroll/EmployeeListPage.tsx:156`, `src/pages/payroll/PayRunNewPage.tsx:241` |
| `payroll.employeeDateRangeInvalid` | `src/pages/payroll/EmployeeNewPage.tsx:127` |
| `payroll.employeeDetailTabs` | `src/pages/payroll/EmployeeDetailPage.tsx:389` |
| `payroll.employeeDirectoryDescription` | `src/pages/payroll/EmployeeListPage.tsx:53` |
| `payroll.employeeDirectoryFilters` | `src/pages/payroll/EmployeeListPage.tsx:61` |
| `payroll.employeeEmailInvalid` | `src/pages/payroll/EmployeeNewPage.tsx:123` |
| `payroll.employeeLoadFailed` | `src/pages/payroll/EmployeeListPage.tsx:92` |
| `payroll.employeeNotFound` | `src/pages/payroll/EmployeeDetailPage.tsx:343` |
| `payroll.employeeNotFoundDescription` | `src/pages/payroll/EmployeeDetailPage.tsx:343` |
| `payroll.employeeNumber` | `src/pages/payroll/EmployeeDetailPage.tsx:371`, `src/pages/payroll/PayRunDetailPage.tsx:230` |
| `payroll.employeeOverride` | `src/pages/payroll/EmployeeDetailPage.tsx:437` |
| `payroll.employeePayComponentsDescription` | `src/pages/payroll/EmployeeDetailPage.tsx:419` |
| `payroll.employeeRequiredFields` | `src/pages/payroll/EmployeeNewPage.tsx:119` |
| `payroll.employeeSaveFailed` | `src/pages/payroll/EmployeeNewPage.tsx:147` |
| `payroll.employeeUpdateFailed` | `src/pages/payroll/EmployeeDetailPage.tsx:384` |
| `payroll.employeeUpdated` | `src/pages/payroll/EmployeeDetailPage.tsx:381` |
| `payroll.employees` | `src/App.tsx:836`, `src/App.tsx:841`, `src/App.tsx:846`, `src/pages/payroll/EmployeeListPage.tsx:52` |
| `payroll.employmentDetails` | `src/pages/payroll/EmployeeDetailPage.tsx:244`, `src/pages/payroll/EmployeeNewPage.tsx:169` |
| `payroll.employmentDetailsDescription` | `src/pages/payroll/EmployeeNewPage.tsx:170` |
| `payroll.employmentType` | `src/pages/payroll/EmployeeDetailPage.tsx:106`, `src/pages/payroll/EmployeeDetailPage.tsx:250`, `src/pages/payroll/EmployeeNewPage.tsx:177` |
| `payroll.endDate` | `src/pages/payroll/LeaveRequestsPage.tsx:194`, `src/pages/payroll/LeaveRequestsPage.tsx:293` |
| `payroll.entitled` | `src/pages/payroll/EmployeeDetailPage.tsx:510` |
| `payroll.estimatedPaye` | `src/pages/payroll/TaxConfigPage.tsx:164` |
| `payroll.existingRunWarning` | `src/pages/payroll/PayRunNewPage.tsx:274` |
| `payroll.existingRunWarningTitle` | `src/pages/payroll/PayRunNewPage.tsx:273` |
| `payroll.filterByStatus` | `src/pages/payroll/PayRunListPage.tsx:75` |
| `payroll.firstName` | `src/pages/payroll/EmployeeDetailPage.tsx:86`, `src/pages/payroll/EmployeeNewPage.tsx:158` |
| `payroll.fiscalYear` | `src/pages/payroll/TaxConfigPage.tsx:118` |
| `payroll.frequencyBiweekly` | `src/pages/payroll/EmployeeDetailPage.tsx:117`, `src/pages/payroll/EmployeeNewPage.tsx:184` |
| `payroll.frequencyMonthly` | `src/pages/payroll/EmployeeDetailPage.tsx:116`, `src/pages/payroll/EmployeeNewPage.tsx:183` |
| `payroll.frequencyWeekly` | `src/pages/payroll/EmployeeDetailPage.tsx:118`, `src/pages/payroll/EmployeeNewPage.tsx:185` |
| `payroll.functionalCurrencyOnly` | `src/pages/payroll/EmployeeNewPage.tsx:206`, `src/pages/payroll/PayRunNewPage.tsx:200` |
| `payroll.grossOnPage` | `src/pages/payroll/PayRunListPage.tsx:64` |
| `payroll.grossPay` | `src/pages/payroll/PayRunDetailPage.tsx:239`, `src/pages/payroll/payRunComponents.tsx:60` |
| `payroll.grossSalary` | `src/pages/payroll/EmployeeDetailPage.tsx:98`, `src/pages/payroll/EmployeeDetailPage.tsx:252`, `src/pages/payroll/EmployeeListPage.tsx:113`, `src/pages/payroll/EmployeeNewPage.tsx:202` |
| `payroll.hireDate` | `src/pages/payroll/EmployeeDetailPage.tsx:248`, `src/pages/payroll/EmployeeListPage.tsx:112`, `src/pages/payroll/EmployeeNewPage.tsx:175` |
| `payroll.invalidPayPeriod` | `src/pages/payroll/PayRunNewPage.tsx:116` |
| `payroll.jobTitle` | `src/pages/payroll/EmployeeDetailPage.tsx:88`, `src/pages/payroll/EmployeeDetailPage.tsx:247`, `src/pages/payroll/EmployeeListPage.tsx:111`, `src/pages/payroll/EmployeeNewPage.tsx:174` |
| `payroll.journalEntryDate` | `src/pages/payroll/PayRunJournalEntryModal.tsx:39` |
| `payroll.journalEntryDescription` | `src/pages/payroll/PayRunJournalEntryModal.tsx:41` |
| `payroll.journalEntryDetails` | `src/pages/payroll/PayRunJournalEntryModal.tsx:27` |
| `payroll.journalEntryLines` | `src/pages/payroll/PayRunJournalEntryModal.tsx:47` |
| `payroll.journalEntryLoadFailed` | `src/pages/payroll/PayRunJournalEntryModal.tsx:34` |
| `payroll.journalEntryNumber` | `src/pages/payroll/PayRunJournalEntryModal.tsx:38` |
| `payroll.journalEntryStatus` | `src/pages/payroll/PayRunJournalEntryModal.tsx:40` |
| `payroll.lastName` | `src/pages/payroll/EmployeeDetailPage.tsx:86`, `src/pages/payroll/EmployeeNewPage.tsx:159` |
| `payroll.leaveAccrualComplete` | `src/pages/payroll/EmployeeDetailPage.tsx:383` |
| `payroll.leaveAccrualFailed` | `src/pages/payroll/EmployeeDetailPage.tsx:385` |
| `payroll.leaveAccrualScope` | `src/pages/payroll/EmployeeDetailPage.tsx:486` |
| `payroll.leaveBalanceLoadFailed` | `src/pages/payroll/EmployeeDetailPage.tsx:492` |
| `payroll.leaveBalanceTab` | `src/pages/payroll/EmployeeDetailPage.tsx:358` |
| `payroll.leaveEmployeesLoadFailed` | `src/pages/payroll/LeaveRequestsPage.tsx:262` |
| `payroll.leaveRequestFilters` | `src/pages/payroll/LeaveRequestsPage.tsx:156` |
| `payroll.leaveRequests` | `src/App.tsx:866`, `src/pages/payroll/LeaveRequestsPage.tsx:141` |
| `payroll.leaveRequestsDescription` | `src/pages/payroll/LeaveRequestsPage.tsx:142` |
| `payroll.leaveRequestsLoadFailed` | `src/pages/payroll/LeaveRequestsPage.tsx:175` |
| `payroll.leaveType` | `src/pages/payroll/EmployeeDetailPage.tsx:506`, `src/pages/payroll/EmployeeDetailPage.tsx:512`, `src/pages/payroll/LeaveRequestsPage.tsx:192`, `src/pages/payroll/LeaveRequestsPage.tsx:212` |
| `payroll.leaveTypesLoadFailed` | `src/pages/payroll/LeaveRequestsPage.tsx:263` |
| `payroll.leaveUsedProgress` | `src/pages/payroll/EmployeeDetailPage.tsx:512` |
| `payroll.leaveYear` | `src/pages/payroll/EmployeeDetailPage.tsx:481` |
| `payroll.loadingEmployees` | `src/pages/payroll/LeaveRequestsPage.tsx:269` |
| `payroll.loadingLeaveTypes` | `src/pages/payroll/LeaveRequestsPage.tsx:280` |
| `payroll.loadingTaxBands` | `src/pages/payroll/TaxConfigPage.tsx:129` |
| `payroll.lowerBound` | `src/pages/payroll/TaxConfigPage.tsx:136`, `src/pages/payroll/TaxConfigPage.tsx:144` |
| `payroll.monthlyGross` | `src/pages/payroll/TaxConfigPage.tsx:160` |
| `payroll.nationalId` | `src/pages/payroll/EmployeeDetailPage.tsx:86`, `src/pages/payroll/EmployeeDetailPage.tsx:234`, `src/pages/payroll/EmployeeNewPage.tsx:160` |
| `payroll.netOnPage` | `src/pages/payroll/PayRunListPage.tsx:68` |
| `payroll.netPay` | `src/pages/payroll/PayRunDetailPage.tsx:241`, `src/pages/payroll/payRunComponents.tsx:64` |
| `payroll.newEmployeeDescription` | `src/pages/payroll/EmployeeNewPage.tsx:141` |
| `payroll.newLeaveRequestDescription` | `src/pages/payroll/LeaveRequestsPage.tsx:256` |
| `payroll.newPayRun` | `src/pages/payroll/PayRunListPage.tsx:54`, `src/pages/payroll/PayRunListPage.tsx:95`, `src/pages/payroll/PayRunNewPage.tsx:151` |
| `payroll.newPayRunDescription` | `src/pages/payroll/PayRunNewPage.tsx:152` |
| `payroll.newRequest` | `src/pages/payroll/LeaveRequestsPage.tsx:146`, `src/pages/payroll/LeaveRequestsPage.tsx:181`, `src/pages/payroll/LeaveRequestsPage.tsx:255` |
| `payroll.next` | `src/pages/payroll/EmployeeListPage.tsx:163`, `src/pages/payroll/LeaveRequestsPage.tsx:243`, `src/pages/payroll/PayRunListPage.tsx:151` |
| `payroll.nextPage` | `src/pages/payroll/EmployeeListPage.tsx:162` |
| `payroll.noActiveEmployees` | `src/pages/payroll/LeaveRequestsPage.tsx:274` |
| `payroll.noComponentDetails` | `src/pages/payroll/PayRunDetailPage.tsx:235`, `src/pages/payroll/PayRunDetailPage.tsx:236`, `src/pages/payroll/payRunComponents.tsx:127` |
| `payroll.noEmployeesDescription` | `src/pages/payroll/EmployeeListPage.tsx:98` |
| `payroll.noEmployeesIncludedWarning` | `src/pages/payroll/PayRunNewPage.tsx:221` |
| `payroll.noEmployeesMatch` | `src/pages/payroll/EmployeeListPage.tsx:97` |
| `payroll.noEmployeesYet` | `src/pages/payroll/EmployeeListPage.tsx:97` |
| `payroll.noJobTitle` | `src/pages/payroll/EmployeeDetailPage.tsx:371` |
| `payroll.noLeaveBalances` | `src/pages/payroll/EmployeeDetailPage.tsx:494` |
| `payroll.noLeaveBalancesDescription` | `src/pages/payroll/EmployeeDetailPage.tsx:494` |
| `payroll.noLeaveRequests` | `src/pages/payroll/LeaveRequestsPage.tsx:179` |
| `payroll.noLeaveRequestsDescription` | `src/pages/payroll/LeaveRequestsPage.tsx:180` |
| `payroll.noLeaveRequestsMatch` | `src/pages/payroll/LeaveRequestsPage.tsx:179` |
| `payroll.noLeaveRequestsMatchDescription` | `src/pages/payroll/LeaveRequestsPage.tsx:180` |
| `payroll.noPayComponents` | `src/pages/payroll/EmployeeDetailPage.tsx:427` |
| `payroll.noPayComponentsDescription` | `src/pages/payroll/EmployeeDetailPage.tsx:427` |
| `payroll.noPayRunEmployees` | `src/pages/payroll/payRunComponents.tsx:51` |
| `payroll.noPayRunsDescription` | `src/pages/payroll/PayRunListPage.tsx:94` |
| `payroll.noPayRunsMatch` | `src/pages/payroll/PayRunListPage.tsx:93` |
| `payroll.noPayRunsYet` | `src/pages/payroll/PayRunListPage.tsx:93` |
| `payroll.noTaxBands` | `src/pages/payroll/TaxConfigPage.tsx:130` |
| `payroll.noUpperLimit` | `src/pages/payroll/TaxConfigPage.tsx:145` |
| `payroll.notAvailable` | `src/pages/payroll/TaxConfigPage.tsx:165` |
| `payroll.openEmployee` | `src/pages/payroll/EmployeeListPage.tsx:134` |
| `payroll.openPayRun` | `src/pages/payroll/PayRunListPage.tsx:112` |
| `payroll.openPayRunForPeriod` | `src/pages/payroll/PayRunListPage.tsx:129` |
| `payroll.otherDeductions` | `src/pages/payroll/payRunComponents.tsx:63` |
| `payroll.overrideAdded` | `src/pages/payroll/EmployeeDetailPage.tsx:382` |
| `payroll.overrideAmount` | `src/pages/payroll/EmployeeDetailPage.tsx:195` |
| `payroll.overrideDescription` | `src/pages/payroll/EmployeeDetailPage.tsx:182` |
| `payroll.overrideFailed` | `src/pages/payroll/EmployeeDetailPage.tsx:385` |
| `payroll.overrideRatePercent` | `src/pages/payroll/EmployeeDetailPage.tsx:199` |
| `payroll.overviewTab` | `src/pages/payroll/EmployeeDetailPage.tsx:356` |
| `payroll.pageOf` | `src/pages/payroll/EmployeeListPage.tsx:158`, `src/pages/payroll/LeaveRequestsPage.tsx:240`, `src/pages/payroll/PayRunListPage.tsx:148` |
| `payroll.payComponent` | `src/pages/payroll/EmployeeDetailPage.tsx:188`, `src/pages/payroll/EmployeeDetailPage.tsx:433` |
| `payroll.payComponentsLoadFailed` | `src/pages/payroll/EmployeeDetailPage.tsx:425` |
| `payroll.payComponentsTab` | `src/pages/payroll/EmployeeDetailPage.tsx:357`, `src/pages/payroll/EmployeeDetailPage.tsx:418` |
| `payroll.payDate` | `src/pages/payroll/PayRunDetailPage.tsx:151`, `src/pages/payroll/PayRunDetailPage.tsx:231`, `src/pages/payroll/PayRunListPage.tsx:107`, `src/pages/payroll/PayRunNewPage.tsx:196`, `src/pages/payroll/PayRunNewPage.tsx:215` |
| `payroll.payFrequency` | `src/pages/payroll/EmployeeDetailPage.tsx:114`, `src/pages/payroll/EmployeeDetailPage.tsx:251`, `src/pages/payroll/EmployeeNewPage.tsx:182` |
| `payroll.payRunFilters` | `src/pages/payroll/PayRunListPage.tsx:73` |
| `payroll.payRunForPeriod` | `src/pages/payroll/PayRunDetailPage.tsx:148` |
| `payroll.payRunLoadFailed` | `src/pages/payroll/PayRunDetailPage.tsx:128` |
| `payroll.payRunNotFound` | `src/pages/payroll/PayRunDetailPage.tsx:127` |
| `payroll.payRunPosted` | `src/pages/payroll/PayRunDetailPage.tsx:193`, `src/pages/payroll/PayRunNewPage.tsx:250` |
| `payroll.payRunSteps` | `src/pages/payroll/PayRunNewPage.tsx:157` |
| `payroll.payRunSummaries` | `src/pages/payroll/PayRunListPage.tsx:58` |
| `payroll.payRuns` | `src/App.tsx:851`, `src/App.tsx:856`, `src/App.tsx:861`, `src/pages/payroll/PayRunListPage.tsx:49` |
| `payroll.payRunsDescription` | `src/pages/payroll/PayRunListPage.tsx:50` |
| `payroll.payRunsInResults` | `src/pages/payroll/PayRunListPage.tsx:60` |
| `payroll.payRunsLoadFailed` | `src/pages/payroll/PayRunListPage.tsx:89` |
| `payroll.payeAmount` | `src/pages/payroll/payRunComponents.tsx:62` |
| `payroll.payeBandsTitle` | `src/pages/payroll/TaxConfigPage.tsx:117` |
| `payroll.paymentBankTransfer` | `src/pages/payroll/EmployeeDetailPage.tsx:137`, `src/pages/payroll/EmployeeNewPage.tsx:220` |
| `payroll.paymentCash` | `src/pages/payroll/EmployeeDetailPage.tsx:139`, `src/pages/payroll/EmployeeNewPage.tsx:222` |
| `payroll.paymentMethod` | `src/pages/payroll/EmployeeDetailPage.tsx:135`, `src/pages/payroll/EmployeeDetailPage.tsx:240`, `src/pages/payroll/EmployeeNewPage.tsx:219` |
| `payroll.paymentMobileMoney` | `src/pages/payroll/EmployeeDetailPage.tsx:138`, `src/pages/payroll/EmployeeNewPage.tsx:221` |
| `payroll.payslip` | `src/pages/payroll/PayRunDetailPage.tsx:224` |
| `payroll.payslipFooter` | `src/pages/payroll/PayRunDetailPage.tsx:243` |
| `payroll.period` | `src/pages/payroll/PayRunListPage.tsx:105` |
| `payroll.periodAlreadyProcessed` | `src/pages/payroll/PayRunNewPage.tsx:128` |
| `payroll.periodCheckFailed` | `src/pages/payroll/PayRunNewPage.tsx:133` |
| `payroll.periodEnd` | `src/pages/payroll/PayRunNewPage.tsx:192` |
| `payroll.periodStart` | `src/pages/payroll/PayRunListPage.tsx:106`, `src/pages/payroll/PayRunNewPage.tsx:188` |
| `payroll.personalDetails` | `src/pages/payroll/EmployeeDetailPage.tsx:232`, `src/pages/payroll/EmployeeNewPage.tsx:154` |
| `payroll.personalDetailsDescription` | `src/pages/payroll/EmployeeNewPage.tsx:155` |
| `payroll.phone` | `src/pages/payroll/EmployeeDetailPage.tsx:87`, `src/pages/payroll/EmployeeDetailPage.tsx:237`, `src/pages/payroll/EmployeeNewPage.tsx:163` |
| `payroll.postFailed` | `src/pages/payroll/PayRunDetailPage.tsx:190` |
| `payroll.postPayRun` | `src/pages/payroll/PayRunDetailPage.tsx:169`, `src/pages/payroll/PayRunNewPage.tsx:261` |
| `payroll.postSuccessWithJournal` | `src/pages/payroll/PayRunDetailPage.tsx:194`, `src/pages/payroll/PayRunNewPage.tsx:251` |
| `payroll.postingIsFinal` | `src/pages/payroll/PayRunNewPage.tsx:246` |
| `payroll.postingPayRun` | `src/pages/payroll/PayRunDetailPage.tsx:169`, `src/pages/payroll/PayRunNewPage.tsx:261` |
| `payroll.previewCalculation` | `src/pages/payroll/TaxConfigPage.tsx:156` |
| `payroll.previewCalculationDescription` | `src/pages/payroll/TaxConfigPage.tsx:157` |
| `payroll.previous` | `src/pages/payroll/EmployeeListPage.tsx:160`, `src/pages/payroll/LeaveRequestsPage.tsx:242`, `src/pages/payroll/PayRunListPage.tsx:150`, `src/pages/payroll/PayRunNewPage.tsx:223`, `src/pages/payroll/PayRunNewPage.tsx:259` |
| `payroll.previousPage` | `src/pages/payroll/EmployeeListPage.tsx:159` |
| `payroll.printPayslips` | `src/pages/payroll/PayRunDetailPage.tsx:174` |
| `payroll.printablePayslips` | `src/pages/payroll/PayRunDetailPage.tsx:210` |
| `payroll.rate` | `src/pages/payroll/TaxConfigPage.tsx:138`, `src/pages/payroll/TaxConfigPage.tsx:146` |
| `payroll.reason` | `src/pages/payroll/LeaveRequestsPage.tsx:304` |
| `payroll.recalculatePayRun` | `src/pages/payroll/PayRunDetailPage.tsx:157`, `src/pages/payroll/PayRunNewPage.tsx:277` |
| `payroll.recalculatingPayRun` | `src/pages/payroll/PayRunDetailPage.tsx:157` |
| `payroll.reject` | `src/pages/payroll/LeaveRequestsPage.tsx:227` |
| `payroll.remaining` | `src/pages/payroll/EmployeeDetailPage.tsx:516` |
| `payroll.removeBand` | `src/pages/payroll/TaxConfigPage.tsx:147` |
| `payroll.reversalEntryUnavailable` | `src/pages/payroll/PayRunDetailPage.tsx:116` |
| `payroll.reverseConfirmationDescription` | `src/pages/payroll/PayRunDetailPage.tsx:255` |
| `payroll.reverseConfirmationTitle` | `src/pages/payroll/PayRunDetailPage.tsx:254` |
| `payroll.reversePayRun` | `src/pages/payroll/PayRunDetailPage.tsx:177` |
| `payroll.reverseSuccess` | `src/pages/payroll/PayRunDetailPage.tsx:100`, `src/pages/payroll/PayRunDetailPage.tsx:198` |
| `payroll.reviewPayRun` | `src/pages/payroll/PayRunNewPage.tsx:214` |
| `payroll.reviewResults` | `src/pages/payroll/PayRunNewPage.tsx:139` |
| `payroll.saveBands` | `src/pages/payroll/TaxConfigPage.tsx:125` |
| `payroll.saveChanges` | `src/pages/payroll/EmployeeDetailPage.tsx:145` |
| `payroll.saveEmployee` | `src/pages/payroll/EmployeeNewPage.tsx:231` |
| `payroll.savingBands` | `src/pages/payroll/TaxConfigPage.tsx:125` |
| `payroll.searchEmployees` | `src/pages/payroll/EmployeeListPage.tsx:64`, `src/pages/payroll/EmployeeListPage.tsx:70` |
| `payroll.selectEmployee` | `src/pages/payroll/LeaveRequestsPage.tsx:267`, `src/pages/payroll/LeaveRequestsPage.tsx:269` |
| `payroll.selectLeaveType` | `src/pages/payroll/LeaveRequestsPage.tsx:278`, `src/pages/payroll/LeaveRequestsPage.tsx:280` |
| `payroll.selectPayPeriod` | `src/pages/payroll/PayRunNewPage.tsx:182` |
| `payroll.selectPayPeriodDescription` | `src/pages/payroll/PayRunNewPage.tsx:183` |
| `payroll.selectPeriod` | `src/pages/payroll/PayRunNewPage.tsx:139` |
| `payroll.startDate` | `src/pages/payroll/LeaveRequestsPage.tsx:193`, `src/pages/payroll/LeaveRequestsPage.tsx:289` |
| `payroll.status` | `src/pages/payroll/EmployeeDetailPage.tsx:122`, `src/pages/payroll/EmployeeDetailPage.tsx:254`, `src/pages/payroll/EmployeeListPage.tsx:75`, `src/pages/payroll/EmployeeListPage.tsx:114`, `src/pages/payroll/EmployeeNewPage.tsx:187`, `src/pages/payroll/LeaveRequestsPage.tsx:196`, `src/pages/payroll/PayRunListPage.tsx:111`, `src/pages/payroll/payRunComponents.tsx:66` |
| `payroll.statusActive` | `src/pages/payroll/EmployeeDetailPage.tsx:124`, `src/pages/payroll/EmployeeListPage.tsx:82`, `src/pages/payroll/EmployeeNewPage.tsx:188` |
| `payroll.statusOnLeave` | `src/pages/payroll/EmployeeDetailPage.tsx:125`, `src/pages/payroll/EmployeeListPage.tsx:83`, `src/pages/payroll/EmployeeNewPage.tsx:189` |
| `payroll.statusSuspended` | `src/pages/payroll/EmployeeDetailPage.tsx:127`, `src/pages/payroll/EmployeeListPage.tsx:85`, `src/pages/payroll/EmployeeNewPage.tsx:191` |
| `payroll.statusTerminated` | `src/pages/payroll/EmployeeDetailPage.tsx:126`, `src/pages/payroll/EmployeeListPage.tsx:84`, `src/pages/payroll/EmployeeNewPage.tsx:190` |
| `payroll.submitRequest` | `src/pages/payroll/LeaveRequestsPage.tsx:311` |
| `payroll.taxConfig` | `src/App.tsx:876`, `src/pages/payroll/TaxConfigPage.tsx:106` |
| `payroll.taxConfigDescription` | `src/pages/payroll/TaxConfigPage.tsx:107` |
| `payroll.taxConfigLoadFailed` | `src/pages/payroll/TaxConfigPage.tsx:110` |
| `payroll.taxConfigSaveFailed` | `src/pages/payroll/TaxConfigPage.tsx:111` |
| `payroll.taxConfigSaved` | `src/pages/payroll/TaxConfigPage.tsx:112` |
| `payroll.taxId` | `src/pages/payroll/EmployeeDetailPage.tsx:87`, `src/pages/payroll/EmployeeDetailPage.tsx:235`, `src/pages/payroll/EmployeeNewPage.tsx:161` |
| `payroll.taxablePay` | `src/pages/payroll/payRunComponents.tsx:61` |
| `payroll.terminationDate` | `src/pages/payroll/EmployeeDetailPage.tsx:131`, `src/pages/payroll/EmployeeDetailPage.tsx:249`, `src/pages/payroll/EmployeeNewPage.tsx:176` |
| `payroll.title` | `src/App.tsx:871` |
| `payroll.toggleComponentDetails` | `src/pages/payroll/payRunComponents.tsx:86` |
| `payroll.totalDays` | `src/pages/payroll/LeaveRequestsPage.tsx:195`, `src/pages/payroll/LeaveRequestsPage.tsx:300` |
| `payroll.totalDeductions` | `src/pages/payroll/PayRunDetailPage.tsx:240`, `src/pages/payroll/payRunComponents.tsx:31` |
| `payroll.totalEmployees` | `src/pages/payroll/PayRunListPage.tsx:108`, `src/pages/payroll/payRunComponents.tsx:29` |
| `payroll.totalEmployerCost` | `src/pages/payroll/payRunComponents.tsx:33` |
| `payroll.totalGross` | `src/pages/payroll/PayRunListPage.tsx:109`, `src/pages/payroll/payRunComponents.tsx:30` |
| `payroll.totalNetPay` | `src/pages/payroll/PayRunListPage.tsx:110`, `src/pages/payroll/payRunComponents.tsx:32` |
| `payroll.typeCasual` | `src/pages/payroll/EmployeeDetailPage.tsx:110`, `src/pages/payroll/EmployeeNewPage.tsx:180` |
| `payroll.typeContract` | `src/pages/payroll/EmployeeDetailPage.tsx:109`, `src/pages/payroll/EmployeeNewPage.tsx:179` |
| `payroll.typePermanent` | `src/pages/payroll/EmployeeDetailPage.tsx:108`, `src/pages/payroll/EmployeeNewPage.tsx:178` |
| `payroll.unnamedComponent` | `src/pages/payroll/PayRunDetailPage.tsx:219`, `src/pages/payroll/payRunComponents.tsx:117` |
| `payroll.upperBound` | `src/pages/payroll/TaxConfigPage.tsx:137`, `src/pages/payroll/TaxConfigPage.tsx:145` |
| `payroll.used` | `src/pages/payroll/EmployeeDetailPage.tsx:511` |
| `payroll.viewJournalEntry` | `src/pages/payroll/PayRunDetailPage.tsx:175`, `src/pages/payroll/PayRunDetailPage.tsx:195`, `src/pages/payroll/PayRunNewPage.tsx:253` |
| `payroll.viewPayRun` | `src/pages/payroll/PayRunNewPage.tsx:254` |
| `payroll.viewReversalEntry` | `src/pages/payroll/PayRunDetailPage.tsx:182` |

**Additional computed Payroll keys** (also absent because the root object is absent): sidebar label `payroll.leave`; dynamic pay-run statuses `payroll.draft`, `payroll.calculated`, `payroll.approved`, `payroll.posted`, `payroll.reversed`; leave statuses `payroll.pending`, `payroll.approved`, `payroll.rejected`, `payroll.cancelled`; and dynamic feedback keys `payroll.leaveSubmitted`, `payroll.leaveApproved`, `payroll.leaveRejected`, `payroll.leaveRequestFailed`, `payroll.insufficientBalance`, `payroll.invalidLeaveDates`, plus posting error keys `payroll.postMissingExpenseAccount`, `payroll.postMissingLiabilityAccount`, `payroll.postInvalidComponentAccount`, `payroll.postNoTaxBands`, `payroll.postDeductionsExceedGross`, `payroll.postMissingBankAccount`, `payroll.postMissingPensionAccount`, `payroll.postNoEmployees`. Sources: `src/pages/payroll/PayRunListPage.tsx:83`, `payRunComponents.tsx:21`, `PayRunJournalEntryModal.tsx:40`, `LeaveRequestsPage.tsx:20-34, 106-116`, and `payRunUtils.ts:28-40`.

### Other key scan results

- Genuine live gaps: `manufacturing.bom.removeComponent` — `src/pages/manufacturing/BomEditorPage.tsx:375`; `reports.addNotes` — `src/components/reports/ReportHeader.tsx:126`.
- Not live missing-key defects: `assistant.anomaliesDetected` (`Assistant.tsx:588`) and `construction.subcontractor.directoryCount` (`SubcontractorsPage.tsx:352`) use the existing `_one`/`_other` plural resources; `common.theme` (`BottomNav.tsx:241`) supplies the fallback `Theme`. `planGuard.availableOnPlan`, `free`, `includes`, `perMonth`, `price`, `upgradeTo`, `viewPlansUpgrade` are absent but only occur in the currently unreferenced `src/routes/PlanGuard.tsx:40-70`.

## Appendix B — Routes without an exact sidebar item

Found 58 route declarations without an exact path match in `NAV_SECTIONS`. “No exact nav item” is not synonymous with a defect: most are auth/admin routes, nested create/detail routes, redirects, contextual utilities or aliases. No broken configured sidebar link was found.

### Public/auth/admin/partner routes
`/login`, `/register`, `/forgot-password`, `/terms-and-conditions`, `/demo`, `/demo/enter`, `/reset-password`, `/accept-invitation`, `/create-business`, `/admin/billing`, `/admin/businesses`, `/partner-admin`, `/partner-admin/partners/:id`, `/partner-admin/partners/:id/settings`, `/partner-admin/partners/:id/clients`, `/partner-admin/partners/:id/billing`.

### Contextual create/detail routes (expected not to be top-level nav items)
`/construction/rfis/new`, `/construction/rfis/:id`, `/construction/change-orders/new`, `/construction/change-orders/:id`, `/construction/itps/new`, `/construction/itps/:id`, `/construction/ncrs/new`, `/construction/ncrs/:id`, `/construction/hse-incidents/new`, `/construction/hse-incidents/:id`, `/construction/toolbox-talks/new`, `/construction/schedule/:projectId`, `/construction/*`, `/manufacturing/bom/new`, `/manufacturing/bom/:id`, `/manufacturing/bom/:id/edit`, `/manufacturing/production/new`, `/manufacturing/production/:id`, `/manufacturing/dashboard`, `/payroll/employees/new`, `/payroll/employees/:id`, `/payroll/pay-runs/new`, `/payroll/pay-runs/:id`, `/reports/budgets/new`, `/reports/budgets/:id`, `/cash-deposits/new`, `/cash-deposits/:id`, `/bank-reconciliation/statements/:id`, `/bank-reconciliation/reconcile/:statementId`.

### Other utility, alias, or potential orphan routes
`/payroll`, `/api-docs`, `/api-keys`, `/zapier`, `/chat`, `/settings/approvals`, `/settings/repair-coa`, `/tools`, `/import`, `/data-import`, `/onboarding/import`.

- **Actionable user-facing orphan:** `/payroll` (legacy full Payroll page, `App.tsx:870-873`), addressed in H3.
- `/manufacturing/dashboard` is a duplicate dashboard route; `/tools`, `/api-docs`, `/api-keys`, `/zapier`, and import aliases are contextual/utility routes, but lack a canonical desktop sidebar entry. `/chat` redirects to `/ai`; `/settings/approvals` and `/settings/repair-coa` are settings subroutes.

## Appendix C — Current sidebar structure (all configured items)

- **Overview:** Dashboard (`/dashboard`); POS (`/pos`).
- **Finance:** Income (`/income`); Expenses (`/expenses`); Invoices (`/invoices`).
- **Payroll:** Employees (`/payroll/employees`); Pay Runs (`/payroll/pay-runs`); Leave (`/payroll/leave`); Tax Configuration (`/payroll/tax-config`).
- **Inventory:** Products (`/products`); Warehouse (`/warehouse`); Transfers (`/transfers`).
- **Construction:** Workspace (`/construction`); Subcontractors (`/construction/subcontractors`); Payment Certificates (`/construction/certificates`); RFIs (`/construction/rfis`); Change Orders (`/construction/change-orders`); ITPs (`/construction/itps`); NCRs (`/construction/ncrs`); HSE Incidents (`/construction/hse-incidents`); Toolbox Talks (`/construction/toolbox-talks`); Schedule (`/construction/schedule`); Retention Register (`/construction/retention-register`).
- **Manufacturing:** Manufacturing dashboard (`/manufacturing`); BOM (`/manufacturing/bom`); MRP Workbench (`/manufacturing/mrp`); Production (`/manufacturing/production`); Production Runs (`/manufacturing/runs`); Routings (`/manufacturing/routings`); Work Centres (`/manufacturing/work-centres`).
- **Accounting:** Chart of Accounts (`/accounts`); Journals (`/journals`); Periods (`/periods`).
- **Reports:** Trial Balance (`/reports/trial-balance`); Profit & Loss (`/reports/profit-loss`); Balance Sheet (`/reports/balance-sheet`); Cash Flow Statement (`/reports/cash-flow`); Cash Forecast (`/cash-forecast`); Budgets (`/reports/budgets`); Depreciation (`/reports/depreciation`); Revenue Breakdown (`/reports/revenue-breakdown`); Changes in Equity (`/reports/changes-in-equity`); Branch Performance (`/reports/branch-performance`); FX Revaluation (`/reports/fx-revaluation`).
- **Taxation:** Tax Configuration (`/tax`); VAT Return (`/reports/vat-return`); WHT Schedule (`/reports/wht-schedule`).
- **Banking:** Cash Deposits (`/cash-deposits`); Bank Accounts (`/bank-reconciliation/accounts`); Bank Statements (`/bank-reconciliation/statements`); Reconcile (`/bank-reconciliation/reconcile`).
- **Assets & Capital:** Fixed Assets (`/assets`); Capital & Equity (`/capital`).
- **Organisation:** Contacts (`/contacts`); Branches (`/branches`; hidden for pure construction/manufacturing sites vocabulary); Locations / Sites (`/locations`); Departments (`/departments`).
- **Settings:** Settings (`/settings`); Exchange Rates (`/settings/exchange-rates`).
- **Audit:** Audit Log (`/audit`).
- **AI:** Ledgr AI (`/ai`).
- **Support:** Support (`/support`).

Total: 16 groups / 62 configured item paths. Runtime visibility is conditional on role, partner feature, plan, organisation capability and operating model; locked plan entries may remain visible with an upgrade prompt, while role/partner/business-type-ineligible entries can be hidden.

## Appendix D — i18n and static scan methodology

- Extracted direct literal `t('key')` calls from non-test `.ts`/`.tsx` under `src`, flattened scalar keys from `src/i18n/locales/en.json`, then cross-referenced. This found 2,331 distinct literal key arguments and 276 absent exact key paths; after excluding legitimate i18next plural families, fallback-protected `common.theme`, and unreferenced PlanGuard, the confirmed live absent keys are 266 (264 Payroll + the two listed in M1).
- Dynamic keys (`t(key)`, template interpolation, nav `labelKey`, data-driven enums) were inspected separately for high-risk routes; runtime screen snapshots were not available. Do not use a raw `comm` result as proof that a key is dead or missing without accounting for plural and fallback behavior.
- Source hardcoded text heuristic searched `>Capitalized text<` across `src/pages/**/*.tsx`; this is useful for finding hotspots but includes non-text false positives and does not exhaust strings in attributes, alerts, components or generated messages.
- Repository route inventory is source-based. The audit did not access production data, verify a customer’s payroll rows, execute the app in a browser, or prove backend behavior/deployment status.

## Appendix E — Hardcoded JSX candidate hotspot counts

Candidate occurrence count by page file (heuristic; not all candidates are confirmed user-visible copy):

| File | Candidate count | Example source lines |
|---|---:|---|
| `src/pages/PayrollPage.tsx` | 134 | 156: `Add Employee`, 166: `First Name`, 171: `Last Name` |
| `src/pages/SettingsPage.tsx` | 65 | 150: `Appearance`, 151: `Customize how Ledgr looks and feels.`, 156: `Data Density` |
| `src/pages/AssetsPage.tsx` | 57 | 299: `Useful Life (years)`, 630: `All required GL accounts are linked.`, 634: `Status` |
| `src/pages/IncomePage.tsx` | 56 | 124: `All branches / no branch`, 152: `No department`, 283: `No income recorded yet` |
| `src/pages/ExpensesPage.tsx` | 45 | 241: `No cost centre`, 276: `No department`, 417: `No expenses recorded yet` |
| `src/pages/CapitalPage.tsx` | 43 | 264: `Principal:`, 265: `Interest Rate:`, 266: `Term:` |
| `src/pages/AuditLogPage.tsx` | 42 | 60: `TAMPERED`, 72: `No data`, 86: `Field` |
| `src/pages/ProductsPage.tsx` | 38 | 211: `Type`, 214: `Physical Product`, 224: `SKU (optional)` |
| `src/pages/TaxPage.tsx` | 28 | 326: `Tax Payable Account (Liability)`, 342: `Tax Receivable Account (Asset, optional)`, 358: `Description (optional)` |
| `src/pages/InvoicesPage.tsx` | 27 | 226: `Invoice`, 232: `Total`, 236: `Already Paid` |
| `src/pages/AccountsPage.tsx` | 20 | 131: `Promise`, 278: `Code already in use`, 307: `Subtype` |
| `src/pages/TransfersPage.tsx` | 20 | 163: `New Stock Transfer`, 176: `From Location`, 184: `To Location` |
| `src/pages/settings/TeamManagementPage.tsx` | 18 | 563: `Add by`, 593: `Person registers at`, 600: `Ledgr creates their login and shows you a one-time passw` |
| `src/pages/DataImportPage.tsx` | 17 | 145: `Drop your CSV file here`, 276: `No business selected.`, 319: `Business created successfully!` |
| `src/pages/TermsAndConditionsPage.tsx` | 16 | 13: `Terms and Conditions`, 19: `These Terms and Conditions govern your use of Ledgr and `, 23: `You must provide accurate, current and complete informat` |
| `src/pages/CreateBusinessPage.tsx` | 14 | 247: `VAT registered`, 267: `Organisation profile`, 268: `This helps Ledgr tailor the workspace. You can select mo` |
| `src/pages/WarehousePage.tsx` | 14 | 92: `Receive Stock`, 143: `Product`, 157: `Quantity` |
| `src/pages/admin/AdminBillingPage.tsx` | 13 | 164: `Search business by name`, 277: `Grant plan`, 290: `Starter` |
| `src/pages/JournalsPage.tsx` | 11 | 90: `No business selected.`, 99: `Journals`, 119: `From` |
| `src/pages/PeriodManagementPage.tsx` | 11 | 124: `No business selected.`, 133: `Period Management`, 171: `Failed to load periods.` |
| `src/pages/partner-admin/PartnerClientsPage.tsx` | 9 | 35: `Clients`, 57: `Business`, 58: `Plan` |
| `src/pages/partner-admin/PartnerBillingPage.tsx` | 7 | 99: `Billing`, 117: `Invoices`, 144: `Invoice` |
| `src/pages/DemoPage.tsx` | 6 | 68: `Public sample`, 119: `Financial overview`, 162: `Income vs expenses` |
| `src/pages/ToolsPage.tsx` | 6 | 96: `Tools`, 97: `Discover everything Ledgr can do`, 142: `Pinned tools` |
| `src/pages/admin/AdminBusinessesPage.tsx` | 6 | 50: `Businesses`, 75: `No businesses match your search.`, 82: `Business` |
| `src/pages/partner-admin/PartnerOverviewPage.tsx` | 6 | 65: `Partner not found.`, 116: `Enabled modules`, 141: `Data isolation` |
| `src/pages/partner-admin/PartnerSettingsPage.tsx` | 6 | 141: `Partner not found.`, 149: `Branding & features`, 340: `No staff linked yet.` |
| `src/pages/ApiDocumentationPage.tsx` | 5 | 100: `Responses follow JSON:API: resources are returned as`, 101: `Rate limit:`, 111: `Method` |
| `src/pages/ContactsPage.tsx` | 3 | 24: `Delete contact?`, 166: `No business selected.`, 175: `Contacts` |
| `src/pages/admin/AdminLayout.tsx` | 3 | 44: `Back to app`, 45: `Back to app`, 50: `Platform admin` |
| `src/pages/partner-admin/PartnerAdminDashboard.tsx` | 3 | 49: `Partners`, 154: `No partners yet`, 213: `New partner` |
| `src/pages/DashboardPage.tsx` | 2 | 89: `Copied!`, 105: `Copied!` |
| `src/pages/RepairCoaPage.tsx` | 2 | 101: `Repair Chart of Accounts`, 111: `Note:` |
| `src/pages/manufacturing/WorkOrderDetailPage.tsx` | 2 | 812: `Promise`, 926: `Promise` |
| `src/pages/ForgotPasswordPage.tsx` | 1 | 49: `Check your spam folder if it doesn't arrive.` |
| `src/pages/bank-reconciliation/BankAccountsPage.tsx` | 1 | 16: `Promise` |
| `src/pages/cash-deposits/CashDepositsPages.tsx` | 1 | 30: `Promise` |
| `src/pages/manufacturing/BomListPage.tsx` | 1 | 208: `Components` |
| `src/pages/partner-admin/PartnerAdminLayout.tsx` | 1 | 54: `Ledgr Partner Admin` |

### Full heuristic text-node candidate occurrences

Every candidate matched by the simple JSX text heuristic is listed below to make review reproducible. Entries can include false positives (for example, code-generated names such as `Promise`); they are not automatically translation defects.

- `src/pages/AccountsPage.tsx:131` — “Promise”
- `src/pages/AccountsPage.tsx:278` — “Code already in use”
- `src/pages/AccountsPage.tsx:307` — “Subtype”
- `src/pages/AccountsPage.tsx:325` — “Normal Balance”
- `src/pages/AccountsPage.tsx:331` — “Debit”
- `src/pages/AccountsPage.tsx:332` — “Credit”
- `src/pages/AccountsPage.tsx:341` — “Currency”
- `src/pages/AccountsPage.tsx:357` — “Parent Account”
- `src/pages/AccountsPage.tsx:373` — “Description”
- `src/pages/AccountsPage.tsx:384` — “Opening Balance (MWK)”
- `src/pages/AccountsPage.tsx:625` — “Chart of Accounts”
- `src/pages/AccountsPage.tsx:645` — “COA Template”
- `src/pages/AccountsPage.tsx:716` — “All types”
- `src/pages/AccountsPage.tsx:753` — “No accounts found.”
- `src/pages/AccountsPage.tsx:762` — “Code”
- `src/pages/AccountsPage.tsx:763` — “Name”
- `src/pages/AccountsPage.tsx:764` — “Type”
- `src/pages/AccountsPage.tsx:765` — “Balance”
- `src/pages/AccountsPage.tsx:766` — “Postable”
- `src/pages/AccountsPage.tsx:767` — “Status”
- `src/pages/ApiDocumentationPage.tsx:100` — “Responses follow JSON:API: resources are returned as”
- `src/pages/ApiDocumentationPage.tsx:101` — “Rate limit:”
- `src/pages/ApiDocumentationPage.tsx:111` — “Method”
- `src/pages/ApiDocumentationPage.tsx:112` — “Endpoint”
- `src/pages/ApiDocumentationPage.tsx:113` — “Description”
- `src/pages/AssetsPage.tsx:299` — “Useful Life (years)”
- `src/pages/AssetsPage.tsx:630` — “All required GL accounts are linked.”
- `src/pages/AssetsPage.tsx:634` — “Status”
- `src/pages/AssetsPage.tsx:665` — “Residual Value (MWK)”
- `src/pages/AssetsPage.tsx:684` — “Useful Life (years)”
- `src/pages/AssetsPage.tsx:696` — “Serial Number”
- `src/pages/AssetsPage.tsx:702` — “Location”
- `src/pages/AssetsPage.tsx:708` — “Purchase Invoice Ref”
- `src/pages/AssetsPage.tsx:714` — “Description”
- `src/pages/AssetsPage.tsx:719` — “Notes”
- `src/pages/AssetsPage.tsx:785` — “Delete?”
- `src/pages/AssetsPage.tsx:834` — “Capitalise assets to the ledger”
- `src/pages/AssetsPage.tsx:957` — “Run Depreciation”
- `src/pages/AssetsPage.tsx:977` — “No open periods found. Create or unlock a period first.”
- `src/pages/AssetsPage.tsx:997` — “Asset”
- `src/pages/AssetsPage.tsx:997` — “Charge”
- `src/pages/AssetsPage.tsx:1011` — “Asset”
- `src/pages/AssetsPage.tsx:1011` — “Reason”
- `src/pages/AssetsPage.tsx:1078` — “Dispose Asset”
- `src/pages/AssetsPage.tsx:1100` — “Disposal Proceeds (MWK)”
- `src/pages/AssetsPage.tsx:1168` — “Revalue Asset”
- `src/pages/AssetsPage.tsx:1241` — “Depreciation Schedule”
- `src/pages/AssetsPage.tsx:1250` — “No depreciation has been posted for this asset yet.”
- `src/pages/AssetsPage.tsx:1255` — “Period”
- `src/pages/AssetsPage.tsx:1256` — “Charge”
- `src/pages/AssetsPage.tsx:1257` — “Accum. to Date”
- `src/pages/AssetsPage.tsx:1258` — “Net Book Value”
- `src/pages/AssetsPage.tsx:1259` — “Posted”
- `src/pages/AssetsPage.tsx:1346` — “All Statuses”
- `src/pages/AssetsPage.tsx:1424` — “Import CSV”
- `src/pages/AssetsPage.tsx:1454` — “Asset”
- `src/pages/AssetsPage.tsx:1455` — “Category”
- `src/pages/AssetsPage.tsx:1456` — “Cost”
- `src/pages/AssetsPage.tsx:1457` — “Accum. Dep.”
- `src/pages/AssetsPage.tsx:1458` — “Net Book Value”
- `src/pages/AssetsPage.tsx:1459` — “Status”
- `src/pages/AssetsPage.tsx:1460` — “Actions”
- `src/pages/AssetsPage.tsx:1521` — “Depreciation Method:”
- `src/pages/AssetsPage.tsx:1522` — “Useful Life:”
- `src/pages/AssetsPage.tsx:1523` — “Acquisition Date:”
- `src/pages/AssetsPage.tsx:1524` — “Dep. Start Date:”
- `src/pages/AssetsPage.tsx:1525` — “Residual Value:”
- `src/pages/AssetsPage.tsx:1526` — “Last Dep. Date:”
- `src/pages/AssetsPage.tsx:1527` — “Serial Number:”
- `src/pages/AssetsPage.tsx:1528` — “Location:”
- `src/pages/AssetsPage.tsx:1531` — “Disposal Date:”
- `src/pages/AssetsPage.tsx:1532` — “Disposal Proceeds:”
- `src/pages/AssetsPage.tsx:1536` — “Revalued Amount:”
- `src/pages/AssetsPage.tsx:1538` — “Notes:”
- `src/pages/AssetsPage.tsx:1646` — “No asset categories yet”
- `src/pages/AssetsPage.tsx:1657` — “Name”
- `src/pages/AssetsPage.tsx:1658` — “Method”
- `src/pages/AssetsPage.tsx:1659` — “Useful Life”
- `src/pages/AssetsPage.tsx:1662` — “GL Defaults”
- `src/pages/AssetsPage.tsx:1663` — “Actions”
- `src/pages/AssetsPage.tsx:1740` — “No business selected.”
- `src/pages/AssetsPage.tsx:1749` — “Fixed Assets”
- `src/pages/AuditLogPage.tsx:60` — “TAMPERED”
- `src/pages/AuditLogPage.tsx:72` — “No data”
- `src/pages/AuditLogPage.tsx:86` — “Field”
- `src/pages/AuditLogPage.tsx:87` — “Before”
- `src/pages/AuditLogPage.tsx:88` — “After”
- `src/pages/AuditLogPage.tsx:176` — “Hash Chain”
- `src/pages/AuditLogPage.tsx:179` — “Previous hash”
- `src/pages/AuditLogPage.tsx:183` — “Entry hash”
- `src/pages/AuditLogPage.tsx:211` — “Notes”
- `src/pages/AuditLogPage.tsx:344` — “Timestamp”
- `src/pages/AuditLogPage.tsx:344` — “Resource”
- `src/pages/AuditLogPage.tsx:344` — “Action”
- `src/pages/AuditLogPage.tsx:344` — “User”
- `src/pages/AuditLogPage.tsx:345` — “Entry Hash”
- `src/pages/AuditLogPage.tsx:345` — “Chain”
- `src/pages/AuditLogPage.tsx:365` — “Digital Signature (SHA-256 of export):”
- `src/pages/AuditLogPage.tsx:442` — “No business selected.”
- `src/pages/AuditLogPage.tsx:453` — “Access Restricted”
- `src/pages/AuditLogPage.tsx:454` — “You need at least Auditor role to view the audit log.”
- `src/pages/AuditLogPage.tsx:462` — “Audit Log”
- `src/pages/AuditLogPage.tsx:563` — “From Date”
- `src/pages/AuditLogPage.tsx:572` — “To Date”
- `src/pages/AuditLogPage.tsx:581` — “Table”
- `src/pages/AuditLogPage.tsx:587` — “All tables”
- `src/pages/AuditLogPage.tsx:594` — “Action”
- `src/pages/AuditLogPage.tsx:600` — “All actions”
- `src/pages/AuditLogPage.tsx:601` — “INSERT”
- `src/pages/AuditLogPage.tsx:602` — “UPDATE”
- `src/pages/AuditLogPage.tsx:603` — “DELETE”
- `src/pages/AuditLogPage.tsx:604` — “Reversal”
- `src/pages/AuditLogPage.tsx:608` — “User”
- `src/pages/AuditLogPage.tsx:614` — “All users”
- `src/pages/AuditLogPage.tsx:669` — “Failed to load audit log”
- `src/pages/AuditLogPage.tsx:670` — “Try again”
- `src/pages/AuditLogPage.tsx:675` — “No audit entries found”
- `src/pages/AuditLogPage.tsx:676` — “Try adjusting your filters”
- `src/pages/AuditLogPage.tsx:683` — “Timestamp”
- `src/pages/AuditLogPage.tsx:684` — “Resource”
- `src/pages/AuditLogPage.tsx:685` — “Action”
- `src/pages/AuditLogPage.tsx:686` — “User”
- `src/pages/AuditLogPage.tsx:687` — “Hash”
- `src/pages/AuditLogPage.tsx:743` — “IFRS Compliance:”
- `src/pages/CapitalPage.tsx:264` — “Principal:”
- `src/pages/CapitalPage.tsx:265` — “Interest Rate:”
- `src/pages/CapitalPage.tsx:266` — “Term:”
- `src/pages/CapitalPage.tsx:267` — “Start Date:”
- `src/pages/CapitalPage.tsx:268` — “Status:”
- `src/pages/CapitalPage.tsx:279` — “Date”
- `src/pages/CapitalPage.tsx:280` — “Type”
- `src/pages/CapitalPage.tsx:281` — “Principal”
- `src/pages/CapitalPage.tsx:282` — “Interest”
- `src/pages/CapitalPage.tsx:283` — “Total”
- `src/pages/CapitalPage.tsx:284` — “Balance”
- `src/pages/CapitalPage.tsx:293` — “Total Principal”
- `src/pages/CapitalPage.tsx:294` — “Total Interest”
- `src/pages/CapitalPage.tsx:295` — “Total Paid”
- `src/pages/CapitalPage.tsx:450` — “Cancel”
- `src/pages/CapitalPage.tsx:541` — “Cancel”
- `src/pages/CapitalPage.tsx:622` — “Cancel”
- `src/pages/CapitalPage.tsx:738` — “Lender”
- `src/pages/CapitalPage.tsx:739` — “Principal”
- `src/pages/CapitalPage.tsx:740` — “Repaid”
- `src/pages/CapitalPage.tsx:741` — “Outstanding”
- `src/pages/CapitalPage.tsx:742` — “Rate”
- `src/pages/CapitalPage.tsx:743` — “Start”
- `src/pages/CapitalPage.tsx:744` — “Status”
- `src/pages/CapitalPage.tsx:745` — “Action”
- `src/pages/CapitalPage.tsx:792` — “Recent Repayments”
- `src/pages/CapitalPage.tsx:796` — “Date”
- `src/pages/CapitalPage.tsx:796` — “Loan”
- `src/pages/CapitalPage.tsx:796` — “Principal”
- `src/pages/CapitalPage.tsx:796` — “Interest”
- `src/pages/CapitalPage.tsx:796` — “Total”
- `src/pages/CapitalPage.tsx:884` — “Shareholder”
- `src/pages/CapitalPage.tsx:885` — “Type”
- `src/pages/CapitalPage.tsx:886` — “Shares”
- `src/pages/CapitalPage.tsx:887` — “Amount”
- `src/pages/CapitalPage.tsx:888` — “Date”
- `src/pages/CapitalPage.tsx:889` — “Reference”
- `src/pages/CapitalPage.tsx:895` — “No share movements yet.”
- `src/pages/CapitalPage.tsx:902` — “Shares In”
- `src/pages/CapitalPage.tsx:903` — “Shares Out”
- `src/pages/CapitalPage.tsx:946` — “No business selected.”
- `src/pages/CapitalPage.tsx:954` — “Capital & Financing”
- `src/pages/CapitalPage.tsx:955` — “Record loans, repayments and share capital movements. Each entry posts a double-entry journal.”
- `src/pages/ContactsPage.tsx:24` — “Delete contact?”
- `src/pages/ContactsPage.tsx:166` — “No business selected.”
- `src/pages/ContactsPage.tsx:175` — “Contacts”
- `src/pages/CreateBusinessPage.tsx:247` — “VAT registered”
- `src/pages/CreateBusinessPage.tsx:267` — “Organisation profile”
- `src/pages/CreateBusinessPage.tsx:268` — “This helps Ledgr tailor the workspace. You can select more than one operating model.”
- `src/pages/CreateBusinessPage.tsx:284` — “Operating models”
- `src/pages/CreateBusinessPage.tsx:349` — “Other”
- `src/pages/CreateBusinessPage.tsx:406` — “MRA Tax defaults”
- `src/pages/CreateBusinessPage.tsx:413` — “These are configured in the Tax module after setup.”
- `src/pages/CreateBusinessPage.tsx:447` — “Custom”
- `src/pages/CreateBusinessPage.tsx:487` — “Preview”
- `src/pages/CreateBusinessPage.tsx:571` — “Promise”
- `src/pages/CreateBusinessPage.tsx:616` — “Promise”
- `src/pages/CreateBusinessPage.tsx:656` — “Promise”
- `src/pages/CreateBusinessPage.tsx:679` — “Promise”
- `src/pages/CreateBusinessPage.tsx:759` — “Construction workspace not set up”
- `src/pages/DashboardPage.tsx:89` — “Copied!”
- `src/pages/DashboardPage.tsx:105` — “Copied!”
- `src/pages/DataImportPage.tsx:145` — “Drop your CSV file here”
- `src/pages/DataImportPage.tsx:276` — “No business selected.”
- `src/pages/DataImportPage.tsx:319` — “Business created successfully!”
- `src/pages/DataImportPage.tsx:365` — “New to Ledgr? Migrate in minutes”
- `src/pages/DataImportPage.tsx:405` — “Recommended migration order”
- `src/pages/DataImportPage.tsx:455` — “Required columns”
- `src/pages/DataImportPage.tsx:471` — “Example format”
- `src/pages/DataImportPage.tsx:550` — “Preview & Validate”
- `src/pages/DataImportPage.tsx:575` — “Fix these errors before importing:”
- `src/pages/DataImportPage.tsx:597` — “Status”
- `src/pages/DataImportPage.tsx:654` — “Importing data...”
- `src/pages/DataImportPage.tsx:655` — “Please wait while we import your records”
- `src/pages/DataImportPage.tsx:656` — “This may take a few moments for large files”
- `src/pages/DataImportPage.tsx:682` — “Imported”
- `src/pages/DataImportPage.tsx:686` — “Failed”
- `src/pages/DataImportPage.tsx:692` — “Errors:”
- `src/pages/DataImportPage.tsx:737` — “Next steps”
- `src/pages/DemoPage.tsx:68` — “Public sample”
- `src/pages/DemoPage.tsx:119` — “Financial overview”
- `src/pages/DemoPage.tsx:162` — “Income vs expenses”
- `src/pages/DemoPage.tsx:163` — “Monthly cash flow (sample)”
- `src/pages/DemoPage.tsx:173` — “Recent invoices”
- `src/pages/DemoPage.tsx:174` — “Sample customer documents”
- `src/pages/ExpensesPage.tsx:241` — “No cost centre”
- `src/pages/ExpensesPage.tsx:276` — “No department”
- `src/pages/ExpensesPage.tsx:417` — “No expenses recorded yet”
- `src/pages/ExpensesPage.tsx:418` — “Record your first expense to start tracking your business costs.”
- `src/pages/ExpensesPage.tsx:698` — “Quick Expense Entry”
- `src/pages/ExpensesPage.tsx:706` — “Date”
- `src/pages/ExpensesPage.tsx:711` — “Amount (MWK)”
- `src/pages/ExpensesPage.tsx:719` — “Currency”
- `src/pages/ExpensesPage.tsx:773` — “Quantity Purchased”
- `src/pages/ExpensesPage.tsx:782` — “Category”
- `src/pages/ExpensesPage.tsx:817` — “Description”
- `src/pages/ExpensesPage.tsx:825` — “Payment Method”
- `src/pages/ExpensesPage.tsx:832` — “Reference (optional)”
- `src/pages/ExpensesPage.tsx:840` — “Notes (optional)”
- `src/pages/ExpensesPage.tsx:1114` — “New Expense / Supplier Bill”
- `src/pages/ExpensesPage.tsx:1122` — “Supplier (optional)”
- `src/pages/ExpensesPage.tsx:1132` — “Expense Number”
- `src/pages/ExpensesPage.tsx:1140` — “Supplier invoice reference”
- `src/pages/ExpensesPage.tsx:1154` — “Construction procurement bill”
- `src/pages/ExpensesPage.tsx:1163` — “Expense Date”
- `src/pages/ExpensesPage.tsx:1168` — “Due Date (optional)”
- `src/pages/ExpensesPage.tsx:1176` — “Expense Currency”
- `src/pages/ExpensesPage.tsx:1216` — “Line Items”
- `src/pages/ExpensesPage.tsx:1225` — “Product / Service”
- `src/pages/ExpensesPage.tsx:1226` — “Description”
- `src/pages/ExpensesPage.tsx:1227` — “Category”
- `src/pages/ExpensesPage.tsx:1229` — “Unit Price”
- `src/pages/ExpensesPage.tsx:1232` — “Total”
- `src/pages/ExpensesPage.tsx:1305` — “Gross Subtotal”
- `src/pages/ExpensesPage.tsx:1306` — “Less: Purchase Discount”
- `src/pages/ExpensesPage.tsx:1307` — “Net Subtotal”
- `src/pages/ExpensesPage.tsx:1310` — “Subtotal”
- `src/pages/ExpensesPage.tsx:1313` — “Total”
- `src/pages/ExpensesPage.tsx:1318` — “Notes (optional)”
- `src/pages/ExpensesPage.tsx:1451` — “Needs Posting”
- `src/pages/ExpensesPage.tsx:1453` — “Posted”
- `src/pages/ExpensesPage.tsx:1468` — “Date”
- `src/pages/ExpensesPage.tsx:1469` — “Description”
- `src/pages/ExpensesPage.tsx:1470` — “Amount”
- `src/pages/ExpensesPage.tsx:1471` — “Paid”
- `src/pages/ExpensesPage.tsx:1472` — “Status”
- `src/pages/ExpensesPage.tsx:1473` — “Posting”
- `src/pages/ExpensesPage.tsx:1523` — “You've reached the end.”
- `src/pages/ExpensesPage.tsx:1556` — “No business selected.”
- `src/pages/ExpensesPage.tsx:1564` — “Expenses”
- `src/pages/ForgotPasswordPage.tsx:49` — “Check your spam folder if it doesn't arrive.”
- `src/pages/IncomePage.tsx:124` — “All branches / no branch”
- `src/pages/IncomePage.tsx:152` — “No department”
- `src/pages/IncomePage.tsx:283` — “No income recorded yet”
- `src/pages/IncomePage.tsx:548` — “Quick Income Entry”
- `src/pages/IncomePage.tsx:561` — “Date”
- `src/pages/IncomePage.tsx:566` — “Amount”
- `src/pages/IncomePage.tsx:593` — “Leave blank to use a cached/Frankfurter rate where available. Enter the bank rate for MWK/ZMW/TZS/MZN pairs.”
- `src/pages/IncomePage.tsx:613` — “Quantity Sold”
- `src/pages/IncomePage.tsx:650` — “Description”
- `src/pages/IncomePage.tsx:657` — “Payment Method”
- `src/pages/IncomePage.tsx:664` — “Reference (optional)”
- `src/pages/IncomePage.tsx:671` — “Notes (optional)”
- `src/pages/IncomePage.tsx:937` — “New Invoice”
- `src/pages/IncomePage.tsx:951` — “Customer”
- `src/pages/IncomePage.tsx:966` — “Invoice Number”
- `src/pages/IncomePage.tsx:974` — “Issue Date”
- `src/pages/IncomePage.tsx:979` — “Due Date”
- `src/pages/IncomePage.tsx:986` — “Template”
- `src/pages/IncomePage.tsx:986` — “Professional”
- `src/pages/IncomePage.tsx:986` — “Minimal”
- `src/pages/IncomePage.tsx:986` — “NGO / Donor”
- `src/pages/IncomePage.tsx:986` — “Government”
- `src/pages/IncomePage.tsx:987` — “Payment terms”
- `src/pages/IncomePage.tsx:987` — “Net 7”
- `src/pages/IncomePage.tsx:987` — “Net 14”
- `src/pages/IncomePage.tsx:987` — “Net 30”
- `src/pages/IncomePage.tsx:987` — “Net 60”
- `src/pages/IncomePage.tsx:988` — “Project code”
- `src/pages/IncomePage.tsx:989` — “LPO number”
- `src/pages/IncomePage.tsx:990` — “Mobile money”
- `src/pages/IncomePage.tsx:990` — “None”
- `src/pages/IncomePage.tsx:990` — “Airtel Money”
- `src/pages/IncomePage.tsx:990` — “TNM Mpamba”
- `src/pages/IncomePage.tsx:991` — “Till / payment reference”
- `src/pages/IncomePage.tsx:996` — “Invoice Currency”
- `src/pages/IncomePage.tsx:1036` — “None”
- `src/pages/IncomePage.tsx:1080` — “Line Items”
- `src/pages/IncomePage.tsx:1089` — “Product / Service”
- `src/pages/IncomePage.tsx:1090` — “Description”
- `src/pages/IncomePage.tsx:1092` — “Unit Price”
- `src/pages/IncomePage.tsx:1095` — “Total”
- `src/pages/IncomePage.tsx:1162` — “Gross Subtotal”
- `src/pages/IncomePage.tsx:1163` — “Less: Discount”
- `src/pages/IncomePage.tsx:1164` — “Net Subtotal”
- `src/pages/IncomePage.tsx:1167` — “Subtotal”
- `src/pages/IncomePage.tsx:1170` — “Total”
- `src/pages/IncomePage.tsx:1176` — “Notes”
- `src/pages/IncomePage.tsx:1181` — “Terms”
- `src/pages/IncomePage.tsx:1307` — “Date”
- `src/pages/IncomePage.tsx:1308` — “Description / Contact”
- `src/pages/IncomePage.tsx:1309` — “Amount”
- `src/pages/IncomePage.tsx:1310` — “Paid”
- `src/pages/IncomePage.tsx:1311` — “Status”
- `src/pages/IncomePage.tsx:1340` — “You've reached the end.”
- `src/pages/IncomePage.tsx:1371` — “No business selected.”
- `src/pages/IncomePage.tsx:1379` — “Income”
- `src/pages/InvoicesPage.tsx:226` — “Invoice”
- `src/pages/InvoicesPage.tsx:232` — “Total”
- `src/pages/InvoicesPage.tsx:236` — “Already Paid”
- `src/pages/InvoicesPage.tsx:240` — “Outstanding”
- `src/pages/InvoicesPage.tsx:327` — “Leave blank to use the cached closing/transaction-date rate if available.”
- `src/pages/InvoicesPage.tsx:732` — “Invoice”
- `src/pages/InvoicesPage.tsx:766` — “Description”
- `src/pages/InvoicesPage.tsx:768` — “Unit Price”
- `src/pages/InvoicesPage.tsx:770` — “Discount”
- `src/pages/InvoicesPage.tsx:772` — “Total”
- `src/pages/InvoicesPage.tsx:820` — “Gross Subtotal”
- `src/pages/InvoicesPage.tsx:821` — “Less: Discount”
- `src/pages/InvoicesPage.tsx:822` — “Net Subtotal”
- `src/pages/InvoicesPage.tsx:826` — “Subtotal”
- `src/pages/InvoicesPage.tsx:841` — “Total”
- `src/pages/InvoicesPage.tsx:852` — “Notes:”
- `src/pages/InvoicesPage.tsx:868` — “Invoice Total”
- `src/pages/InvoicesPage.tsx:872` — “Amount Paid”
- `src/pages/InvoicesPage.tsx:878` — “Outstanding”
- `src/pages/InvoicesPage.tsx:1167` — “Issue Date”
- `src/pages/InvoicesPage.tsx:1168` — “Due Date”
- `src/pages/InvoicesPage.tsx:1169` — “Total”
- `src/pages/InvoicesPage.tsx:1170` — “Outstanding”
- `src/pages/InvoicesPage.tsx:1171` — “Status”
- `src/pages/InvoicesPage.tsx:1232` — “You've reached the end.”
- `src/pages/InvoicesPage.tsx:1251` — “No business selected.”
- `src/pages/InvoicesPage.tsx:1261` — “Invoices”
- `src/pages/JournalsPage.tsx:90` — “No business selected.”
- `src/pages/JournalsPage.tsx:99` — “Journals”
- `src/pages/JournalsPage.tsx:119` — “From”
- `src/pages/JournalsPage.tsx:167` — “All statuses”
- `src/pages/JournalsPage.tsx:178` — “All types”
- `src/pages/JournalsPage.tsx:205` — “Failed to load journal entries.”
- `src/pages/JournalsPage.tsx:210` — “No journal entries match your filters”
- `src/pages/JournalsPage.tsx:218` — “Date”
- `src/pages/JournalsPage.tsx:220` — “Description”
- `src/pages/JournalsPage.tsx:221` — “Type”
- `src/pages/JournalsPage.tsx:222` — “Status”
- `src/pages/PayrollPage.tsx:156` — “Add Employee”
- `src/pages/PayrollPage.tsx:166` — “First Name”
- `src/pages/PayrollPage.tsx:171` — “Last Name”
- `src/pages/PayrollPage.tsx:179` — “Employee Number”
- `src/pages/PayrollPage.tsx:184` — “Job Title”
- `src/pages/PayrollPage.tsx:192` — “Employment Type”
- `src/pages/PayrollPage.tsx:195` — “Permanent”
- `src/pages/PayrollPage.tsx:196` — “Contract”
- `src/pages/PayrollPage.tsx:197` — “Casual”
- `src/pages/PayrollPage.tsx:198` — “Part Time”
- `src/pages/PayrollPage.tsx:202` — “Gross Monthly Salary (MWK)”
- `src/pages/PayrollPage.tsx:210` — “Start Date”
- `src/pages/PayrollPage.tsx:215` — “Payment Method”
- `src/pages/PayrollPage.tsx:218` — “Bank Transfer”
- `src/pages/PayrollPage.tsx:219` — “Mobile Money”
- `src/pages/PayrollPage.tsx:220` — “Cash”
- `src/pages/PayrollPage.tsx:221` — “Cheque”
- `src/pages/PayrollPage.tsx:229` — “Bank Name”
- `src/pages/PayrollPage.tsx:234` — “Account Number”
- `src/pages/PayrollPage.tsx:244` — “Provider”
- `src/pages/PayrollPage.tsx:248` — “Airtel Money”
- `src/pages/PayrollPage.tsx:249` — “TNM Mpamba”
- `src/pages/PayrollPage.tsx:253` — “Mobile Number”
- `src/pages/PayrollPage.tsx:263` — “Branch (Cost Center)”
- `src/pages/PayrollPage.tsx:266` — “No branch”
- `src/pages/PayrollPage.tsx:273` — “Department”
- `src/pages/PayrollPage.tsx:276` — “No department”
- `src/pages/PayrollPage.tsx:285` — “Salary Expense Account”
- `src/pages/PayrollPage.tsx:293` — “Required before approving payroll. Choose the expense account for this employee's gross pay.”
- `src/pages/PayrollPage.tsx:298` — “National ID (optional)”
- `src/pages/PayrollPage.tsx:303` — “TPIN (optional)”
- `src/pages/PayrollPage.tsx:310` — “Cancel”
- `src/pages/PayrollPage.tsx:442` — “Run Payroll”
- `src/pages/PayrollPage.tsx:453` — “Payroll Period”
- `src/pages/PayrollPage.tsx:458` — “Pay Date”
- `src/pages/PayrollPage.tsx:465` — “Period Start”
- `src/pages/PayrollPage.tsx:470` — “Period End”
- `src/pages/PayrollPage.tsx:481` — “Cancel”
- `src/pages/PayrollPage.tsx:496` — “Employee”
- `src/pages/PayrollPage.tsx:497` — “Gross Pay”
- `src/pages/PayrollPage.tsx:498` — “PAYE”
- `src/pages/PayrollPage.tsx:500` — “Net Pay”
- `src/pages/PayrollPage.tsx:519` — “Totals”
- `src/pages/PayrollPage.tsx:658` — “Pay From Bank or Cash Account”
- `src/pages/PayrollPage.tsx:672` — “TPR Pension Payable Account”
- `src/pages/PayrollPage.tsx:691` — “Cancel”
- `src/pages/PayrollPage.tsx:952` — “All Branches”
- `src/pages/PayrollPage.tsx:958` — “Unassigned Branch”
- `src/pages/PayrollPage.tsx:966` — “All Departments / Cost Centres”
- `src/pages/PayrollPage.tsx:972` — “Unassigned Department”
- `src/pages/PayrollPage.tsx:1013` — “Before statutory deductions”
- `src/pages/PayrollPage.tsx:1031` — “Disbursed to beneficiaries”
- `src/pages/PayrollPage.tsx:1073` — “Branch”
- `src/pages/PayrollPage.tsx:1074` — “Department / Cost Centre”
- `src/pages/PayrollPage.tsx:1075` — “Headcount”
- `src/pages/PayrollPage.tsx:1076` — “Gross Pay”
- `src/pages/PayrollPage.tsx:1077` — “PAYE”
- `src/pages/PayrollPage.tsx:1078` — “Pension”
- `src/pages/PayrollPage.tsx:1079` — “Net Paid”
- `src/pages/PayrollPage.tsx:1131` — “Beneficiary / Employee”
- `src/pages/PayrollPage.tsx:1132` — “Branch & Cost Centre”
- `src/pages/PayrollPage.tsx:1133` — “Payment Channel”
- `src/pages/PayrollPage.tsx:1134` — “Gross Pay”
- `src/pages/PayrollPage.tsx:1135` — “PAYE”
- `src/pages/PayrollPage.tsx:1136` — “Pension (Emp)”
- `src/pages/PayrollPage.tsx:1137` — “Other Ded.”
- `src/pages/PayrollPage.tsx:1138` — “Amount Received (Net)”
- `src/pages/PayrollPage.tsx:1175` — “Unassigned”
- `src/pages/PayrollPage.tsx:1235` — “Failed to load payroll runs.”
- `src/pages/PayrollPage.tsx:1243` — “No payroll runs yet”
- `src/pages/PayrollPage.tsx:1244` — “Run your first payroll to calculate PAYE and net pay for all employees.”
- `src/pages/PayrollPage.tsx:1266` — “All Branches”
- `src/pages/PayrollPage.tsx:1272` — “Unassigned Branch”
- `src/pages/PayrollPage.tsx:1280` — “All Departments / Cost Centres”
- `src/pages/PayrollPage.tsx:1286` — “Unassigned Department”
- `src/pages/PayrollPage.tsx:1318` — “Period”
- `src/pages/PayrollPage.tsx:1319` — “Pay Date”
- `src/pages/PayrollPage.tsx:1320` — “Total Gross”
- `src/pages/PayrollPage.tsx:1321` — “Total PAYE”
- `src/pages/PayrollPage.tsx:1322` — “Total Net”
- `src/pages/PayrollPage.tsx:1323` — “Status”
- `src/pages/PayrollPage.tsx:1389` — “Failed to load employees.”
- `src/pages/PayrollPage.tsx:1397` — “No employees yet”
- `src/pages/PayrollPage.tsx:1398` — “Add or bulk-import employees to start assigning cost centers and running payroll.”
- `src/pages/PayrollPage.tsx:1469` — “All Branches”
- `src/pages/PayrollPage.tsx:1475` — “Unassigned Branch”
- `src/pages/PayrollPage.tsx:1483` — “All Departments / Cost Centres”
- `src/pages/PayrollPage.tsx:1489` — “Unassigned Department”
- `src/pages/PayrollPage.tsx:1533` — “Staff Count:”
- `src/pages/PayrollPage.tsx:1534` — “Filtered View”
- `src/pages/PayrollPage.tsx:1538` — “Filtered Gross:”
- `src/pages/PayrollPage.tsx:1542` — “Est. PAYE:”
- `src/pages/PayrollPage.tsx:1546` — “Est. Net:”
- `src/pages/PayrollPage.tsx:1556` — “No employees match the selected filter”
- `src/pages/PayrollPage.tsx:1576` — “Employee”
- `src/pages/PayrollPage.tsx:1577` — “Cost Center / Branch”
- `src/pages/PayrollPage.tsx:1578` — “Job Title”
- `src/pages/PayrollPage.tsx:1579` — “Type”
- `src/pages/PayrollPage.tsx:1580` — “Gross Salary”
- `src/pages/PayrollPage.tsx:1581` — “Est. PAYE”
- `src/pages/PayrollPage.tsx:1582` — “Est. Net”
- `src/pages/PayrollPage.tsx:1926` — “Cost Center & Branch Payroll Report”
- `src/pages/PayrollPage.tsx:1947` — “Report Scope:”
- `src/pages/PayrollPage.tsx:1953` — “Active Staff Master (Current Live Allocation)”
- `src/pages/PayrollPage.tsx:1965` — “Branch:”
- `src/pages/PayrollPage.tsx:1971` — “All Branches”
- `src/pages/PayrollPage.tsx:1977` — “Unassigned Branch”
- `src/pages/PayrollPage.tsx:1982` — “Department:”
- `src/pages/PayrollPage.tsx:1988` — “All Departments / Cost Centres”
- `src/pages/PayrollPage.tsx:1994` — “Unassigned Department”
- `src/pages/PayrollPage.tsx:2034` — “Base salary commitments”
- `src/pages/PayrollPage.tsx:2052` — “Net salary obligations”
- `src/pages/PayrollPage.tsx:2061` — “Branch-Level Payroll Allocation”
- `src/pages/PayrollPage.tsx:2069` — “Branch”
- `src/pages/PayrollPage.tsx:2070` — “Cost Centres”
- `src/pages/PayrollPage.tsx:2071` — “Headcount”
- `src/pages/PayrollPage.tsx:2072` — “Gross Payroll”
- `src/pages/PayrollPage.tsx:2073` — “PAYE”
- `src/pages/PayrollPage.tsx:2074` — “Pension”
- `src/pages/PayrollPage.tsx:2075` — “Net Payable”
- `src/pages/PayrollPage.tsx:2076` — “Payroll Share”
- `src/pages/PayrollPage.tsx:2103` — “Total All Branches”
- `src/pages/PayrollPage.tsx:2122` — “Department & Cost Centre Rollup”
- `src/pages/PayrollPage.tsx:2130` — “Cost Centre Code”
- `src/pages/PayrollPage.tsx:2131` — “Department Name”
- `src/pages/PayrollPage.tsx:2132` — “Branch”
- `src/pages/PayrollPage.tsx:2133` — “Headcount”
- `src/pages/PayrollPage.tsx:2134` — “Gross Pay”
- `src/pages/PayrollPage.tsx:2135` — “Total Deductions”
- `src/pages/PayrollPage.tsx:2136` — “Net Disbursement”
- `src/pages/PayrollPage.tsx:2137` — “Avg Pay / Staff”
- `src/pages/PayrollPage.tsx:2172` — “Totals”
- `src/pages/PayrollPage.tsx:2210` — “No business selected.”
- `src/pages/PayrollPage.tsx:2217` — “Payroll”
- `src/pages/PeriodManagementPage.tsx:124` — “No business selected.”
- `src/pages/PeriodManagementPage.tsx:133` — “Period Management”
- `src/pages/PeriodManagementPage.tsx:171` — “Failed to load periods.”
- `src/pages/PeriodManagementPage.tsx:175` — “No accounting periods yet”
- `src/pages/PeriodManagementPage.tsx:191` — “Period”
- `src/pages/PeriodManagementPage.tsx:192` — “Date Range”
- `src/pages/PeriodManagementPage.tsx:193` — “Entries”
- `src/pages/PeriodManagementPage.tsx:194` — “Debits”
- `src/pages/PeriodManagementPage.tsx:195` — “Credits”
- `src/pages/PeriodManagementPage.tsx:196` — “Status”
- `src/pages/PeriodManagementPage.tsx:197` — “Action”
- `src/pages/ProductsPage.tsx:211` — “Type”
- `src/pages/ProductsPage.tsx:214` — “Physical Product”
- `src/pages/ProductsPage.tsx:224` — “SKU (optional)”
- `src/pages/ProductsPage.tsx:239` — “Purchase Price (MWK)”
- `src/pages/ProductsPage.tsx:247` — “Unit of Measure”
- `src/pages/ProductsPage.tsx:254` — “Description (optional)”
- `src/pages/ProductsPage.tsx:265` — “Track inventory for this product”
- `src/pages/ProductsPage.tsx:271` — “Reorder Level”
- `src/pages/ProductsPage.tsx:278` — “Reorder Quantity”
- `src/pages/ProductsPage.tsx:356` — “Delete product?”
- `src/pages/ProductsPage.tsx:498` — “Name”
- `src/pages/ProductsPage.tsx:499` — “Type”
- `src/pages/ProductsPage.tsx:501` — “Sale Price”
- `src/pages/ProductsPage.tsx:502` — “Purchase Price”
- `src/pages/ProductsPage.tsx:503` — “Inventory”
- `src/pages/ProductsPage.tsx:504` — “Actions”
- `src/pages/ProductsPage.tsx:523` — “Tracked”
- `src/pages/ProductsPage.tsx:625` — “No tracked products”
- `src/pages/ProductsPage.tsx:626` — “Enable inventory tracking on a product to see stock levels here.”
- `src/pages/ProductsPage.tsx:636` — “Product”
- `src/pages/ProductsPage.tsx:640` — “Total On Hand”
- `src/pages/ProductsPage.tsx:641` — “Avg Cost”
- `src/pages/ProductsPage.tsx:642` — “Status”
- `src/pages/ProductsPage.tsx:676` — “Low Stock”
- `src/pages/ProductsPage.tsx:786` — “Record Stock Movement”
- `src/pages/ProductsPage.tsx:839` — “Unit Cost (MWK)”
- `src/pages/ProductsPage.tsx:843` — “Leave blank to add quantity without changing the average cost.”
- `src/pages/ProductsPage.tsx:847` — “Reference (optional)”
- `src/pages/ProductsPage.tsx:854` — “Notes (optional)”
- `src/pages/ProductsPage.tsx:873` — “Movement History”
- `src/pages/ProductsPage.tsx:884` — “Select a product to view history”
- `src/pages/ProductsPage.tsx:888` — “No movements recorded yet”
- `src/pages/ProductsPage.tsx:894` — “Date”
- `src/pages/ProductsPage.tsx:895` — “Type”
- `src/pages/ProductsPage.tsx:896` — “Location”
- `src/pages/ProductsPage.tsx:898` — “Unit Cost”
- `src/pages/ProductsPage.tsx:899` — “Reference”
- `src/pages/ProductsPage.tsx:947` — “No business selected.”
- `src/pages/RepairCoaPage.tsx:101` — “Repair Chart of Accounts”
- `src/pages/RepairCoaPage.tsx:111` — “Note:”
- `src/pages/SettingsPage.tsx:150` — “Appearance”
- `src/pages/SettingsPage.tsx:151` — “Customize how Ledgr looks and feels.”
- `src/pages/SettingsPage.tsx:156` — “Data Density”
- `src/pages/SettingsPage.tsx:157` — “Choose comfortable for spacious tables or compact for power users.”
- `src/pages/SettingsPage.tsx:172` — “Sidebar Width”
- `src/pages/SettingsPage.tsx:183` — “Reset to 256px”
- `src/pages/SettingsPage.tsx:188` — “Screen Orientation”
- `src/pages/SettingsPage.tsx:210` — “Promise”
- `src/pages/SettingsPage.tsx:222` — “Keyboard Shortcuts”
- `src/pages/SettingsPage.tsx:452` — “Business Profile”
- `src/pages/SettingsPage.tsx:453` — “Update your business information and branding.”
- `src/pages/SettingsPage.tsx:520` — “Preview:”
- `src/pages/SettingsPage.tsx:538` — “Business Logo”
- `src/pages/SettingsPage.tsx:605` — “Operating Model”
- `src/pages/SettingsPage.tsx:704` — “Financial Settings”
- `src/pages/SettingsPage.tsx:705` — “Configure currency, numbering, and accounting preferences.”
- `src/pages/SettingsPage.tsx:764` — “Document Numbering”
- `src/pages/SettingsPage.tsx:767` — “Invoices”
- `src/pages/SettingsPage.tsx:778` — “Expenses”
- `src/pages/SettingsPage.tsx:789` — “Payroll”
- `src/pages/SettingsPage.tsx:845` — “User Profile”
- `src/pages/SettingsPage.tsx:846` — “Manage your personal account information.”
- `src/pages/SettingsPage.tsx:883` — “Sign out”
- `src/pages/SettingsPage.tsx:884` — “End your current session on this device.”
- `src/pages/SettingsPage.tsx:965` — “Security”
- `src/pages/SettingsPage.tsx:966` — “Manage your password and account security.”
- `src/pages/SettingsPage.tsx:973` — “Change Password”
- `src/pages/SettingsPage.tsx:1044` — “Passwords do not match”
- `src/pages/SettingsPage.tsx:1062` — “Two-Factor Authentication (2FA)”
- `src/pages/SettingsPage.tsx:1071` — “Active Session”
- `src/pages/SettingsPage.tsx:1483` — “Team Members”
- `src/pages/SettingsPage.tsx:1484` — “Manage who has access to this business.”
- `src/pages/SettingsPage.tsx:1504` — “Ask the person to create a Ledgr account at”
- `src/pages/SettingsPage.tsx:1505` — “Once they’ve registered, you can add them directly via email.”
- `src/pages/SettingsPage.tsx:1506` — “Alternatively, generate a Shareable Invite Link and send it to them.”
- `src/pages/SettingsPage.tsx:1537` — “Add existing user directly”
- `src/pages/SettingsPage.tsx:1540` — “User’s email (must already be registered)”
- `src/pages/SettingsPage.tsx:1550` — “Role”
- `src/pages/SettingsPage.tsx:1581` — “Create shareable invitation link (Business-scoped only)”
- `src/pages/SettingsPage.tsx:1584` — “Restrict to email (Optional)”
- `src/pages/SettingsPage.tsx:1594` — “Role”
- `src/pages/SettingsPage.tsx:1609` — “Shareable link (expires in 7 days):”
- `src/pages/SettingsPage.tsx:1663` — “Active Shareable Invitation Links”
- `src/pages/SettingsPage.tsx:1668` — “Restriction”
- `src/pages/SettingsPage.tsx:1669` — “Role”
- `src/pages/SettingsPage.tsx:1670` — “Expires”
- `src/pages/SettingsPage.tsx:1671` — “Actions”
- `src/pages/SettingsPage.tsx:1728` — “Member”
- `src/pages/SettingsPage.tsx:1729` — “Role”
- `src/pages/SettingsPage.tsx:1730` — “Joined”
- `src/pages/SettingsPage.tsx:1731` — “Actions”
- `src/pages/SettingsPage.tsx:1833` — “Invitee”
- `src/pages/SettingsPage.tsx:1834` — “Role”
- `src/pages/SettingsPage.tsx:1835` — “Expired”
- `src/pages/SettingsPage.tsx:1836` — “Actions”
- `src/pages/SettingsPage.tsx:1892` — “Member”
- `src/pages/SettingsPage.tsx:1893` — “Role”
- `src/pages/SettingsPage.tsx:1894` — “Actions”
- `src/pages/SettingsPage.tsx:2011` — “Privacy”
- `src/pages/SettingsPage.tsx:2012` — “What we collect, and how it's used.”
- `src/pages/SettingsPage.tsx:2017` — “Data we collect”
- `src/pages/SettingsPage.tsx:2037` — “Cookie preferences”
- `src/pages/SettingsPage.tsx:2083` — “Data retention policy”
- `src/pages/SettingsPage.tsx:2219` — “No business selected.”
- `src/pages/SettingsPage.tsx:2227` — “Settings”
- `src/pages/TaxPage.tsx:326` — “Tax Payable Account (Liability)”
- `src/pages/TaxPage.tsx:342` — “Tax Receivable Account (Asset, optional)”
- `src/pages/TaxPage.tsx:358` — “Description (optional)”
- `src/pages/TaxPage.tsx:382` — “Active”
- `src/pages/TaxPage.tsx:392` — “Effective To (optional)”
- `src/pages/TaxPage.tsx:524` — “Band Label (optional)”
- `src/pages/TaxPage.tsx:558` — “Effective To (optional)”
- `src/pages/TaxPage.tsx:588` — “Delete?”
- `src/pages/TaxPage.tsx:745` — “Unlinked Tax Payable Accounts”
- `src/pages/TaxPage.tsx:769` — “No tax configurations yet”
- `src/pages/TaxPage.tsx:780` — “Tax Code”
- `src/pages/TaxPage.tsx:781` — “Name”
- `src/pages/TaxPage.tsx:782` — “Rate”
- `src/pages/TaxPage.tsx:783` — “Payable Account”
- `src/pages/TaxPage.tsx:784` — “MRA / evidence reference”
- `src/pages/TaxPage.tsx:785` — “Effective From”
- `src/pages/TaxPage.tsx:786` — “Effective To”
- `src/pages/TaxPage.tsx:787` — “Status”
- `src/pages/TaxPage.tsx:788` — “Actions”
- `src/pages/TaxPage.tsx:918` — “Fiscal Year:”
- `src/pages/TaxPage.tsx:937` — “Add MRA PAYE bands for this fiscal year to enable automatic payroll tax calculation.”
- `src/pages/TaxPage.tsx:948` — “Label”
- `src/pages/TaxPage.tsx:949` — “From (MWK)”
- `src/pages/TaxPage.tsx:950` — “To (MWK)”
- `src/pages/TaxPage.tsx:951` — “Rate”
- `src/pages/TaxPage.tsx:952` — “Effective From”
- `src/pages/TaxPage.tsx:953` — “Actions”
- `src/pages/TaxPage.tsx:1014` — “No business selected.”
- `src/pages/TermsAndConditionsPage.tsx:13` — “Terms and Conditions”
- `src/pages/TermsAndConditionsPage.tsx:19` — “These Terms and Conditions govern your use of Ledgr and the business account you create. By ticking the acceptance box when creating a business, you confirm that you have read, understood and agree to be bound by these terms on your own behalf and, where applicable, on behalf of that business. You also confirm that you have authority to accept these terms for that business.”
- `src/pages/TermsAndConditionsPage.tsx:23` — “You must provide accurate, current and complete information, keep your credentials secure, and promptly update information that changes. You are responsible for activity carried out through your account and for ensuring that people you authorise to access your business use Ledgr appropriately. You must notify us promptly if you suspect unauthorised access to your account.”
- `src/pages/TermsAndConditionsPage.tsx:28` — “You must not use Ledgr to facilitate fraud, money laundering, terrorist financing, tax evasion, or any other unlawful activity. We may investigate suspected misuse and suspend access as necessary to protect users, the service, or comply with law.”
- `src/pages/TermsAndConditionsPage.tsx:36` — “You retain your rights in the data that you enter into Ledgr. You grant us the limited rights needed to host, process, back up and display that data in order to provide, secure and improve the service. You confirm that you have the right to provide that data and to invite users to your business.”
- `src/pages/TermsAndConditionsPage.tsx:38` — “You may export data using the features available in Ledgr while your account is active. Following cancellation or termination, data may be retained for a limited period for backup, legal, security, tax or compliance purposes before deletion or anonymisation, subject to applicable law.”
- `src/pages/TermsAndConditionsPage.tsx:42` — “Paid plans, fees, billing intervals and included features are presented when you select a plan. You authorise us and our payment providers to collect applicable charges and taxes using your chosen payment method. Subscriptions renew at the end of each billing period unless cancelled before renewal.”
- `src/pages/TermsAndConditionsPage.tsx:47` — “Ledgr may work with third-party services, including payment providers, banks, email providers, cloud infrastructure providers and integrations. Their services may be subject to separate terms and privacy policies. We are not responsible for third-party services, their availability, their acts or omissions, or information you choose to share with them.”
- `src/pages/TermsAndConditionsPage.tsx:51` — “We aim to keep Ledgr available and secure, but the service may occasionally be unavailable for maintenance, updates or events outside our control. We may update, modify or discontinue features where reasonably necessary. We do not guarantee that the service will be uninterrupted, error-free or suitable for every purpose.”
- `src/pages/TermsAndConditionsPage.tsx:55` — “To the fullest extent permitted by applicable law, Ledgr and its service providers are not liable for indirect, incidental, special, consequential or punitive losses, including lost profits, revenue, data, goodwill or business opportunities, arising from your use of, or inability to use, the service.”
- `src/pages/TermsAndConditionsPage.tsx:56` — “Ledgr is not responsible for losses caused by inaccurate information entered by you or your users, unauthorised access resulting from a failure to protect your account credentials, decisions you make using information in the service, or services, systems or networks operated by third parties. Nothing in these terms excludes or limits liability that cannot legally be excluded or limited, including liability for fraud or fraudulent misrepresentation.”
- `src/pages/TermsAndConditionsPage.tsx:57` — “Where Ledgr is found liable for a claim relating to the service, its total liability will be limited to the amount you paid to Ledgr for the service during the 12 months immediately before the event giving rise to that claim, unless applicable law requires a higher amount.”
- `src/pages/TermsAndConditionsPage.tsx:65` — “We may suspend or terminate access where reasonably necessary to protect the service, comply with law, address a breach of these terms, or where fees remain unpaid. You may stop using Ledgr at any time, subject to any applicable subscription, billing or data-retention obligations. Sections that should reasonably continue after termination, including those on data, liability, indemnity and governing law, will survive termination.”
- `src/pages/TermsAndConditionsPage.tsx:69` — “Neither party is responsible for a delay or failure to perform obligations caused by events beyond its reasonable control, including natural disasters, acts of government, war, civil unrest, labour disputes, power or telecommunications failures, or widespread internet outages. This does not remove your obligation to pay charges already due.”
- `src/pages/TermsAndConditionsPage.tsx:77` — “These terms are governed by the laws of Malawi. Before starting formal proceedings, each party will try in good faith to resolve a dispute by giving the other party written notice and allowing a reasonable opportunity to respond. If the dispute is not resolved, the courts of Malawi will have jurisdiction, except where applicable law requires otherwise.”
- `src/pages/TermsAndConditionsPage.tsx:81` — “If you have a question about these terms, please contact Ledgr support before creating your business account.”
- `src/pages/ToolsPage.tsx:96` — “Tools”
- `src/pages/ToolsPage.tsx:97` — “Discover everything Ledgr can do”
- `src/pages/ToolsPage.tsx:142` — “Pinned tools”
- `src/pages/ToolsPage.tsx:157` — “Recently used”
- `src/pages/ToolsPage.tsx:201` — “Unlock more tools on Growth”
- `src/pages/ToolsPage.tsx:202` — “Inventory, Payroll, Bank Reconciliation and more are available on paid plans.”
- `src/pages/TransfersPage.tsx:163` — “New Stock Transfer”
- `src/pages/TransfersPage.tsx:176` — “From Location”
- `src/pages/TransfersPage.tsx:184` — “To Location”
- `src/pages/TransfersPage.tsx:197` — “Product”
- `src/pages/TransfersPage.tsx:212` — “Cost”
- `src/pages/TransfersPage.tsx:232` — “Notes (optional)”
- `src/pages/TransfersPage.tsx:239` — “Cancel”
- `src/pages/TransfersPage.tsx:292` — “Transfer”
- `src/pages/TransfersPage.tsx:331` — “From”
- `src/pages/TransfersPage.tsx:349` — “Status”
- `src/pages/TransfersPage.tsx:356` — “Dispatched”
- `src/pages/TransfersPage.tsx:362` — “Received”
- `src/pages/TransfersPage.tsx:373` — “Items”
- `src/pages/TransfersPage.tsx:382` — “Requested”
- `src/pages/TransfersPage.tsx:386` — “Dispatched”
- `src/pages/TransfersPage.tsx:399` — “Received”
- `src/pages/TransfersPage.tsx:648` — “No transfers yet”
- `src/pages/TransfersPage.tsx:649` — “Create a transfer to dispatch stock to a branch”
- `src/pages/TransfersPage.tsx:689` — “No transfers yet”
- `src/pages/TransfersPage.tsx:690` — “Create a transfer to dispatch stock to a branch”
- `src/pages/WarehousePage.tsx:92` — “Receive Stock”
- `src/pages/WarehousePage.tsx:143` — “Product”
- `src/pages/WarehousePage.tsx:157` — “Quantity”
- `src/pages/WarehousePage.tsx:165` — “Unit Cost”
- `src/pages/WarehousePage.tsx:192` — “Notes (optional)”
- `src/pages/WarehousePage.tsx:249` — “On Hand”
- `src/pages/WarehousePage.tsx:253` — “Available”
- `src/pages/WarehousePage.tsx:257` — “Value”
- `src/pages/WarehousePage.tsx:405` — “Repair duplicate Receive Stock entries”
- `src/pages/WarehousePage.tsx:719` — “All locations”
- `src/pages/WarehousePage.tsx:738` — “No stock records found”
- `src/pages/WarehousePage.tsx:739` — “Receive stock to start tracking inventory”
- `src/pages/WarehousePage.tsx:780` — “No stock records found”
- `src/pages/WarehousePage.tsx:781` — “Receive stock to start tracking inventory”
- `src/pages/admin/AdminBillingPage.tsx:164` — “Search business by name”
- `src/pages/admin/AdminBillingPage.tsx:277` — “Grant plan”
- `src/pages/admin/AdminBillingPage.tsx:290` — “Starter”
- `src/pages/admin/AdminBillingPage.tsx:291` — “Growth”
- `src/pages/admin/AdminBillingPage.tsx:293` — “Enterprise”
- `src/pages/admin/AdminBillingPage.tsx:298` — “Access duration (days)”
- `src/pages/admin/AdminBillingPage.tsx:311` — “Amount received (MWK)”
- `src/pages/admin/AdminBillingPage.tsx:323` — “Payment method”
- `src/pages/admin/AdminBillingPage.tsx:336` — “Reference (optional)”
- `src/pages/admin/AdminBillingPage.tsx:346` — “Notes (optional)”
- `src/pages/admin/AdminBillingPage.tsx:439` — “Payment / grant history”
- `src/pages/admin/AdminBillingPage.tsx:455` — “Important:”
- `src/pages/admin/AdminBillingPage.tsx:455` — “UUIDs”
- `src/pages/admin/AdminLayout.tsx:44` — “Back to app”
- `src/pages/admin/AdminLayout.tsx:45` — “Back to app”
- `src/pages/admin/AdminLayout.tsx:50` — “Platform admin”
- `src/pages/admin/AdminBusinessesPage.tsx:50` — “Businesses”
- `src/pages/admin/AdminBusinessesPage.tsx:75` — “No businesses match your search.”
- `src/pages/admin/AdminBusinessesPage.tsx:82` — “Business”
- `src/pages/admin/AdminBusinessesPage.tsx:83` — “Owner(s)”
- `src/pages/admin/AdminBusinessesPage.tsx:84` — “Plan”
- `src/pages/admin/AdminBusinessesPage.tsx:85` — “Registered”
- `src/pages/bank-reconciliation/BankAccountsPage.tsx:16` — “Promise”
- `src/pages/cash-deposits/CashDepositsPages.tsx:30` — “Promise”
- `src/pages/manufacturing/BomListPage.tsx:208` — “Components”
- `src/pages/manufacturing/WorkOrderDetailPage.tsx:812` — “Promise”
- `src/pages/manufacturing/WorkOrderDetailPage.tsx:926` — “Promise”
- `src/pages/partner-admin/PartnerAdminDashboard.tsx:49` — “Partners”
- `src/pages/partner-admin/PartnerAdminDashboard.tsx:154` — “No partners yet”
- `src/pages/partner-admin/PartnerAdminDashboard.tsx:213` — “New partner”
- `src/pages/partner-admin/PartnerAdminLayout.tsx:54` — “Ledgr Partner Admin”
- `src/pages/partner-admin/PartnerBillingPage.tsx:99` — “Billing”
- `src/pages/partner-admin/PartnerBillingPage.tsx:117` — “Invoices”
- `src/pages/partner-admin/PartnerBillingPage.tsx:144` — “Invoice”
- `src/pages/partner-admin/PartnerBillingPage.tsx:145` — “Period”
- `src/pages/partner-admin/PartnerBillingPage.tsx:146` — “Clients”
- `src/pages/partner-admin/PartnerBillingPage.tsx:147` — “Amount”
- `src/pages/partner-admin/PartnerBillingPage.tsx:149` — “Status”
- `src/pages/partner-admin/PartnerClientsPage.tsx:35` — “Clients”
- `src/pages/partner-admin/PartnerClientsPage.tsx:57` — “Business”
- `src/pages/partner-admin/PartnerClientsPage.tsx:58` — “Plan”
- `src/pages/partner-admin/PartnerClientsPage.tsx:59` — “Users”
- `src/pages/partner-admin/PartnerClientsPage.tsx:60` — “Invoices”
- `src/pages/partner-admin/PartnerClientsPage.tsx:61` — “Entries”
- `src/pages/partner-admin/PartnerClientsPage.tsx:62` — “Onboarded”
- `src/pages/partner-admin/PartnerClientsPage.tsx:63` — “Last activity”
- `src/pages/partner-admin/PartnerClientsPage.tsx:64` — “Status”
- `src/pages/partner-admin/PartnerOverviewPage.tsx:65` — “Partner not found.”
- `src/pages/partner-admin/PartnerOverviewPage.tsx:116` — “Enabled modules”
- `src/pages/partner-admin/PartnerOverviewPage.tsx:141` — “Data isolation”
- `src/pages/partner-admin/PartnerOverviewPage.tsx:153` — “Danger zone”
- `src/pages/partner-admin/PartnerOverviewPage.tsx:155` — “Ledgr-only controls. Existing SME clients keep all their data and modules either way.”
- `src/pages/partner-admin/PartnerOverviewPage.tsx:216` — “End staff access”
- `src/pages/partner-admin/PartnerSettingsPage.tsx:141` — “Partner not found.”
- `src/pages/partner-admin/PartnerSettingsPage.tsx:149` — “Branding & features”
- `src/pages/partner-admin/PartnerSettingsPage.tsx:340` — “No staff linked yet.”
- `src/pages/partner-admin/PartnerSettingsPage.tsx:378` — “Add staff by email”
- `src/pages/partner-admin/PartnerSettingsPage.tsx:388` — “Role”
- `src/pages/partner-admin/PartnerSettingsPage.tsx:438` — “Let clients see each other”
- `src/pages/settings/TeamManagementPage.tsx:563` — “Add by”
- `src/pages/settings/TeamManagementPage.tsx:593` — “Person registers at”
- `src/pages/settings/TeamManagementPage.tsx:600` — “Ledgr creates their login and shows you a one-time password”
- `src/pages/settings/TeamManagementPage.tsx:604` — “Uses Edge Function”
- `src/pages/settings/TeamManagementPage.tsx:616` — “Success!”
- `src/pages/settings/TeamManagementPage.tsx:626` — “Email address”
- `src/pages/settings/TeamManagementPage.tsx:671` — “Role”
- `src/pages/settings/TeamManagementPage.tsx:693` — “Role permissions:”
- `src/pages/settings/TeamManagementPage.tsx:700` — “How it works (shareable links):”
- `src/pages/settings/TeamManagementPage.tsx:702` — “Select a role and optionally restrict the link to a specific email address.”
- `src/pages/settings/TeamManagementPage.tsx:704` — “Copy and send the URL. The recipient can click, sign in/register, and join.”
- `src/pages/settings/TeamManagementPage.tsx:706` — “Uses Edge Function”
- `src/pages/settings/TeamManagementPage.tsx:724` — “Invitation Link (Expires in 7 days):”
- `src/pages/settings/TeamManagementPage.tsx:797` — “Role”
- `src/pages/settings/TeamManagementPage.tsx:819` — “Role permissions:”
- `src/pages/settings/TeamManagementPage.tsx:1264` — “No active members found.”
- `src/pages/settings/TeamManagementPage.tsx:1598` — “Role permissions”
- `src/pages/settings/TeamManagementPage.tsx:1603` — “Permission”
### Targeted nested POS component scan (separate from page totals)

| Component file | Candidate count | Example lines |
|---|---:|---|
| `src/components/pos/PosZReportModal.tsx` | 16 | 53: `End-of-Day Z-Report & Audit`, 85: `Cashier:`, 89: `Shift Opened:` |
| `src/components/pos/PosReceiptModal.tsx` | 14 | 164: `This sale is queued on this device.`, 212: `Date:`, 216: `Cashier:` |
| `src/components/pos/PosOwnerAnalytics.tsx` | 13 | 111: `All Branches`, 142: `Gross Sales Revenue`, 155: `Average Ticket Value` |
| `src/components/pos/PosSalesHistoryModal.tsx` | 11 | 19: `Promise`, 20: `Promise`, 153: `Recent Sales & Returns Register` |
| `src/components/pos/PosCart.tsx` | 10 | 42: `Promise`, 43: `Promise`, 256: `Change` |
| `src/components/pos/PosHeader.tsx` | 8 | 36: `Promise`, 76: `Ledgr POS`, 84: `Warehouse (default)` |
| `src/components/pos/PosPaymentModal.tsx` | 8 | 34: `Promise`, 183: `Payment Checkout`, 197: `Total Payable` |
| `src/components/pos/PosSettingsModal.tsx` | 7 | 20: `Promise`, 81: `POS System Configuration`, 125: `Read-only view. Store Owner or Manager credentials are ` |
| `src/components/pos/PosBarcodeLabelGenerator.tsx` | 6 | 102: `Barcode & Shelf Price Label Generator`, 131: `Label Format:`, 137: `Thermal Roll (50mm x 30mm)` |
| `src/components/pos/PosShiftModal.tsx` | 6 | 10: `Promise`, 11: `Promise`, 96: `Shift Opened:` |
| `src/components/pos/PosCashMovementModal.tsx` | 2 | 9: `Promise`, 45: `Record Cash In / Out (Petty Cash)` |
| `src/components/pos/PosProductCatalog.tsx` | 2 | 137: `No products found`, 138: `Try a different search term or category filter.` |
| `src/components/pos/PosStockStatusBanner.tsx` | 2 | 19: `Stock levels could not be loaded.`, 35: `This shop has no stock location.` |
| `src/components/pos/PosManagerApprovalModal.tsx` | 1 | 31: `Promise` |

Full nested POS candidate occurrences:

- `src/components/pos/PosBarcodeLabelGenerator.tsx:102` — “Barcode & Shelf Price Label Generator”
- `src/components/pos/PosBarcodeLabelGenerator.tsx:131` — “Label Format:”
- `src/components/pos/PosBarcodeLabelGenerator.tsx:137` — “Thermal Roll (50mm x 30mm)”
- `src/components/pos/PosBarcodeLabelGenerator.tsx:178` — “Qty:”
- `src/components/pos/PosBarcodeLabelGenerator.tsx:214` — “No Labels Selected”
- `src/components/pos/PosBarcodeLabelGenerator.tsx:215` — “Select items on the left and set quantities to generate barcodes.”
- `src/components/pos/PosCart.tsx:42` — “Promise”
- `src/components/pos/PosCart.tsx:43` — “Promise”
- `src/components/pos/PosCart.tsx:256` — “Change”
- `src/components/pos/PosCart.tsx:282` — “Walk-in Customer (Default)”
- `src/components/pos/PosCart.tsx:354` — “Cart is Empty”
- `src/components/pos/PosCart.tsx:355` — “Scan a barcode or tap products on the left to start sale.”
- `src/components/pos/PosCart.tsx:457` — “Discounts”
- `src/components/pos/PosCart.tsx:475` — “Net Payable”
- `src/components/pos/PosCart.tsx:579` — “Overall Order Discount”
- `src/components/pos/PosCart.tsx:625` — “Add New Customer”
- `src/components/pos/PosCashMovementModal.tsx:9` — “Promise”
- `src/components/pos/PosCashMovementModal.tsx:45` — “Record Cash In / Out (Petty Cash)”
- `src/components/pos/PosHeader.tsx:36` — “Promise”
- `src/components/pos/PosHeader.tsx:76` — “Ledgr POS”
- `src/components/pos/PosHeader.tsx:84` — “Warehouse (default)”
- `src/components/pos/PosHeader.tsx:190` — “Online”
- `src/components/pos/PosHeader.tsx:209` — “Labels”
- `src/components/pos/PosHeader.tsx:234` — “Cash In/Out”
- `src/components/pos/PosHeader.tsx:251` — “Close Shift”
- `src/components/pos/PosHeader.tsx:256` — “Open Shift”
- `src/components/pos/PosManagerApprovalModal.tsx:31` — “Promise”
- `src/components/pos/PosOwnerAnalytics.tsx:111` — “All Branches”
- `src/components/pos/PosOwnerAnalytics.tsx:142` — “Gross Sales Revenue”
- `src/components/pos/PosOwnerAnalytics.tsx:155` — “Average Ticket Value”
- `src/components/pos/PosOwnerAnalytics.tsx:162` — “Per customer basket”
- `src/components/pos/PosOwnerAnalytics.tsx:168` — “Discounts Given”
- `src/components/pos/PosOwnerAnalytics.tsx:175` — “Total promotions applied”
- `src/components/pos/PosOwnerAnalytics.tsx:181` — “Refunds & Returns”
- `src/components/pos/PosOwnerAnalytics.tsx:188` — “Processed customer returns”
- `src/components/pos/PosOwnerAnalytics.tsx:200` — “No sales recorded for the selected period.”
- `src/components/pos/PosOwnerAnalytics.tsx:206` — “Cashier Name”
- `src/components/pos/PosOwnerAnalytics.tsx:207` — “Sales Count”
- `src/components/pos/PosOwnerAnalytics.tsx:208` — “Total Volume”
- `src/components/pos/PosOwnerAnalytics.tsx:209` — “Avg Ticket”
- `src/components/pos/PosPaymentModal.tsx:34` — “Promise”
- `src/components/pos/PosPaymentModal.tsx:183` — “Payment Checkout”
- `src/components/pos/PosPaymentModal.tsx:197` — “Total Payable”
- `src/components/pos/PosPaymentModal.tsx:202` — “Customer”
- `src/components/pos/PosPaymentModal.tsx:254` — “Credit Sale will create an open invoice under customer ledger.”
- `src/components/pos/PosPaymentModal.tsx:358` — “Change Due:”
- `src/components/pos/PosPaymentModal.tsx:458` — “Assigned Total:”
- `src/components/pos/PosPaymentModal.tsx:462` — “Remaining to tender:”
- `src/components/pos/PosProductCatalog.tsx:137` — “No products found”
- `src/components/pos/PosProductCatalog.tsx:138` — “Try a different search term or category filter.”
- `src/components/pos/PosReceiptModal.tsx:164` — “This sale is queued on this device.”
- `src/components/pos/PosReceiptModal.tsx:212` — “Date:”
- `src/components/pos/PosReceiptModal.tsx:216` — “Cashier:”
- `src/components/pos/PosReceiptModal.tsx:221` — “Customer:”
- `src/components/pos/PosReceiptModal.tsx:232` — “Item”
- `src/components/pos/PosReceiptModal.tsx:233` — “Qty x Price”
- `src/components/pos/PosReceiptModal.tsx:234` — “Total”
- `src/components/pos/PosReceiptModal.tsx:258` — “Gross Total:”
- `src/components/pos/PosReceiptModal.tsx:263` — “Discount:”
- `src/components/pos/PosReceiptModal.tsx:268` — “Net Payable:”
- `src/components/pos/PosReceiptModal.tsx:289` — “Paid:”
- `src/components/pos/PosReceiptModal.tsx:296` — “Change Given:”
- `src/components/pos/PosReceiptModal.tsx:304` — “Thank you for shopping with us!”
- `src/components/pos/PosReceiptModal.tsx:305` — “Goods once sold are returnable within 7 days with valid receipt.”
- `src/components/pos/PosSalesHistoryModal.tsx:19` — “Promise”
- `src/components/pos/PosSalesHistoryModal.tsx:20` — “Promise”
- `src/components/pos/PosSalesHistoryModal.tsx:153` — “Recent Sales & Returns Register”
- `src/components/pos/PosSalesHistoryModal.tsx:183` — “No matching sales records.”
- `src/components/pos/PosSalesHistoryModal.tsx:284` — “Return Qty:”
- `src/components/pos/PosSalesHistoryModal.tsx:312` — “Refund Method:”
- `src/components/pos/PosSalesHistoryModal.tsx:318` — “Cash Refund”
- `src/components/pos/PosSalesHistoryModal.tsx:319` — “Store Credit”
- `src/components/pos/PosSalesHistoryModal.tsx:320` — “Original Payment”
- `src/components/pos/PosSalesHistoryModal.tsx:339` — “No Sale Selected”
- `src/components/pos/PosSalesHistoryModal.tsx:340` — “Select a transaction from the left to view items or process a return.”
- `src/components/pos/PosSettingsModal.tsx:20` — “Promise”
- `src/components/pos/PosSettingsModal.tsx:81` — “POS System Configuration”
- `src/components/pos/PosSettingsModal.tsx:125` — “Read-only view. Store Owner or Manager credentials are required to modify settings.”
- `src/components/pos/PosSettingsModal.tsx:151` — “Discounts above this will require manager PIN”
- `src/components/pos/PosSettingsModal.tsx:172` — “Maximum authorization threshold for managers”
- `src/components/pos/PosSettingsModal.tsx:236` — “Allow Negative Stock Sales”
- `src/components/pos/PosSettingsModal.tsx:419` — “All changes take effect immediately across all POS terminals.”
- `src/components/pos/PosShiftModal.tsx:10` — “Promise”
- `src/components/pos/PosShiftModal.tsx:11` — “Promise”
- `src/components/pos/PosShiftModal.tsx:96` — “Shift Opened:”
- `src/components/pos/PosShiftModal.tsx:102` — “Opening Float:”
- `src/components/pos/PosShiftModal.tsx:108` — “Expected Drawer Cash:”
- `src/components/pos/PosShiftModal.tsx:142` — “Reconciliation Variance:”
- `src/components/pos/PosStockStatusBanner.tsx:19` — “Stock levels could not be loaded.”
- `src/components/pos/PosStockStatusBanner.tsx:35` — “This shop has no stock location.”
- `src/components/pos/PosZReportModal.tsx:53` — “End-of-Day Z-Report & Audit”
- `src/components/pos/PosZReportModal.tsx:85` — “Cashier:”
- `src/components/pos/PosZReportModal.tsx:89` — “Shift Opened:”
- `src/components/pos/PosZReportModal.tsx:93` — “Shift Closed:”
- `src/components/pos/PosZReportModal.tsx:106` — “Sales Summary”
- `src/components/pos/PosZReportModal.tsx:108` — “Gross Sales:”
- `src/components/pos/PosZReportModal.tsx:112` — “Total Discounts:”
- `src/components/pos/PosZReportModal.tsx:116` — “Net Sales Revenue:”
- `src/components/pos/PosZReportModal.tsx:121` — “VAT / Tax Collected:”
- `src/components/pos/PosZReportModal.tsx:127` — “Customer Refunds:”
- `src/components/pos/PosZReportModal.tsx:141` — “Opening Float:”
- `src/components/pos/PosZReportModal.tsx:145` — “Cash In (Top-ups):”
- `src/components/pos/PosZReportModal.tsx:149` — “Cash Out (Drops):”
- `src/components/pos/PosZReportModal.tsx:153` — “Expected in Drawer:”
- `src/components/pos/PosZReportModal.tsx:157` — “Actual Counted Cash:”
- `src/components/pos/PosZReportModal.tsx:169` — “Reconciliation Variance:”

POS-only heuristic total: 106 candidates across 14 components. The text-node matcher is intentionally a discovery heuristic, not a proof that every candidate should become a translation key.
Total heuristic candidate matches: 760 across 39 page files. Review text-node candidates in context before changing them; JSX render expressions and table/data labels may require a richer AST-based extractor.
