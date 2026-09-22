# LEDGR — WHOLE-APPLICATION SECURITY & READINESS COVERAGE REVIEW

**Date:** 2026-09-22 (Africa/Blantyre)
**Branch / commit:** `arena/01a0c215-ledgr-react` @ `7fe7ae1` (R10 typed quota contract; parent `32e374d` R09.3 readiness gate)
**Mode:** DISCOVERY, EVIDENCE MAPPING, GAP IDENTIFICATION, ROADMAP PLANNING ONLY — no implementation occurred.
**Evidence snapshot:** release harness re-run on this exact tree: **PASS 678 / FAIL 2 / BLOCKED 53 / NOT APPLICABLE 0 (733 records)** — byte-identical in totals and per-record outcomes to the two R10-phase runs; the 2 FAILs remain `EDGE.RETRY.no-secret` and `EDGE.WEBHOOK.viewer` (R12), unchanged.

---

# WHOLE-APPLICATION COVERAGE VERDICT

**PARTIAL COVERAGE — MATERIAL DOMAINS REMAIN**

| Domain                     | Status | Key evidence | Main gap |
|---|---|---|---|
| Authentication             | PARTIALLY VERIFIED | R01.INVITE/ACCEPT, R02.* | Runtime/browser proofs BLOCKED (AUTH.* ×4, R02.PROVIDER-TOKEN ×9, OTP ×3); DEC-02 phone-recovery unresolved |
| Tenant security            | PARTIALLY VERIFIED | R01.CURRENT/CONTRACT/CREATE (430), TENANT.* ×10 PASS, R02.ISOLATION ×4 | `TENANT.A/B.storage` BLOCKED ×2; public bucket |
| Roles/branches             | BLOCKED           | R04.CONTACTS ×9, ROLE.* write-matrix ×7 PASS | `BRANCH.*` ×8 entirely BLOCKED — branch-level access model never proven at runtime |
| Accounting                 | PARTIALLY VERIFIED | R05.FINANCE ×8, FINANCE.* ×4, DB ×4 | Period-lock lifecycle, manual-adjustment bounds, journal deletion path not in evidence |
| Invoicing                  | PARTIALLY VERIFIED | R10 quota, FINANCE.NONPOS-INCOME, R05 payment guards, EDGE.send-invoice | Non-POS edit/cancel paths thin; receipt dispatch BLOCKED (R07.RECEIPT.DISPATCH) |
| Expenses                   | PARTIALLY VERIFIED | R10.QUOTA.SERVER-QUICKSAVE-EXPENSE, R05 void/deletion guards | Direct-write edit paths; offline expense sync partially proven (queue yes, runtime no) |
| Payroll/tax                | PARTIALLY VERIFIED | R01 role-matrix rows for payroll_manager; can_write_payroll RLS helper | No payroll-posting release records; VAT-return generation DEFERRED (R14); payroll server quota assert absent (R10 finding) |
| Inventory                  | PARTIALLY VERIFIED | R06.POS ×6 (invariant, oversell, replay, weighted cost) | Direct-write stock_transfers/transfer deletes bypass the authoritative propagation function — unbounded by R06 evidence |
| Procurement                | PARTIALLY VERIFIED | R04.CONTACTS tier-grants, quick-expense stock-line paths | No dedicated purchase-order surface exists (absent = OUT OF SCOPE); supplier-side mutations thin |
| Customers/suppliers        | PARTIALLY VERIFIED | R04.CONTACTS ×9 (anon-denied, cross-org, writer matrix, tier grants) | Branch-scoped contact visibility unproven (BRANCH.customers BLOCKED) |
| Banking/reconciliation     | PARTIALLY VERIFIED | R05.FINANCE.BANK-LINE-LOCK, EDGE.suggest-bank-matches ×2 | Statement import/match/mutation cycle has invariant-level only; reconciliation authority boundaries unaudited |
| Reporting                  | PARTIALLY VERIFIED | get_pos_shift_report server-authoritative (R08), 20 RLS-scoped views | Statement/register exports, tax returns, consolidated reports: no release records; PDF/export surface unmeasured |
| AI                         | PARTIALLY VERIFIED | R03.AI ×16, AI.ANON/ROLE, EDGE.ai-chat | `AI.BRANCH` BLOCKED; R11 (metric consistency) not executed |
| POS                        | VERIFIED           | R06 ×6, R07 ×19, R08 ×22 — state-machine, actor, idempotency proofs | None unresolved in-plane; R09.2 seals (2 BLOCKED) touch offline receipt replay |
| Offline                    | PARTIALLY VERIFIED | R09.1 cache ×6, R09.2 queue ×18, R10 ×8 (boundary) | Browser evidence outstanding (R09.4); OFFLINE.* ×6 + R09 seals BLOCKED |
| Storage                    | BLOCKED           | Policies in migration; `TENANT.*.storage` records exist but BLOCKED | Bucket is public; cross-tenant object access never proven negative |
| Edge/webhooks              | PARTIALLY VERIFIED | EDGE.* ×58 PASS, catalog classified ×23+ | **FAIL ×2 open** (RETRY.no-secret, WEBHOOK.viewer); signed-secret proofs absent |
| Notifications/integrations | PARTIALLY VERIFIED | send-invoice, webhook-dispatcher, retry-failed-webhooks, paychangu-webhook | Receipt dispatch BLOCKED (historical carry); retry-without-secret FAIL |
| Deployment/CI              | PARTIALLY VERIFIED | R00 baseline; CI release-evidence job runs harness (FAIL/BLOCKED → nonzero, no continue-on-error) | Gate currently RED by design (2 FAIL + 53 BLOCKED); restore/PITR R14 deferred |

---

# 1. Executive Summary

The Ledgr audit record (R00–R13) is materially broader than POS: the largest evidence family (507/733 records) is server-side tenant/role/identity enforcement. However, depth is uneven: POS uniquely received state-machine, actor-binding, idempotency, and invariant-level proofs, while several material non-POS domains rest on invariant-level or presence-level evidence only, and three classes of evidence are structurally unproven at runtime: authentication/recovery flows (13+ records BLOCKED), branch-scope enforcement (BRANCH.* ×8 BLOCKED), and storage tenant isolation (BLOCKED, with a public bucket). Two Edge webhook records remain FAIL and the CI release gate is therefore RED by sanctioned design.

This review discovered additional non-POS financial-mutation surfaces that bypass the authoritative server-side mechanisms the POS work relies on (direct client writes to stock transfers, journals, bank statements, payroll runs, fixed assets, FX revaluations). These are recorded as gaps only — nothing was changed.

# 2. Scope and Authorization

Performed under the whole-application coverage mandate (discovery/evidence/gap/roadmap only). The absolute stop conditions were honored: no application code, migration, RLS, Edge Function, RPC, quota, offline, POS, or CI change; no finding fixed; no policy selected; no audit evidence rewritten; no new control created. The only filesystem artifact added by this review is this report file.

# 3. Baseline Commits / Reports

- Current commit: `7fe7ae1` (feat R10). Parent: `32e374d`. Remote tip verified equal pre- and post-review.
- Audit register treated as authoritative: R00 deployment baseline; R01 security boundary; R02 recovery; R03 AI authorization; R04 tenant/role; R05 financial invariants; R06 POS stock integrity; R07 approvals/corrections; R08 till/shift; R09.1 cache; R09.2 queue provenance/actor/lease/quarantine; R09.3 readiness analysis; R09 decision-consistency & bundle; R10 typed quota contract; R13 harness; R14 (operations/restore/observability/jobs) & R15 (data reconciliation/pilot) defined in the readiness plan as deferred packages.
- Evidence run for this review: `.cache/r13/ledgr-r13-l2PgxJ/evidence.json` (733 outcomes), generated 2026-09-22 on this tree.
- Infrastructure note (documented, not repaired): this session repeatedly observed git-index drift in the sandbox (local HEAD reverting to ancestor `2e0ede3` while the remote tip remained correct). Baseline integrity was therefore verified by content-hash diff against `FETCH_HEAD` from the authoritative remote; worktree/index were realigned to the remote tip and re-verified to zero divergence before and after the review. No project content was altered by this.

# 4. Complete Application Surface Inventory
(Repo-inspected exhaustive list; route map from `src/App.tsx`, pages in `src/pages`, server surface from `supabase/migrations` [63 tables, 20 views, 84 distinct functions — 73 SECURITY DEFINER at latest definition], Edge Functions [27] with the R13 catalog, offline layer, storage, CI.)

- **A. Auth & Identity:** routes `/login /register /forgot-password /reset-password /accept-invitation /create-business`; pages Register/Login/Forgot/Reset/AcceptInvitation/CreateBusiness/Support; Edge accept-invite-link, create-invite-link, invite-team-member, list-team-members, request/cancel/finalize-account-deletion, export-my-data; RPCs invite_member, accept_invitation(_membership), create_business_with_owner; profile surfaces (user_profiles, profiles, phone_accounts); membership tables (business_users, branches assignment).
- **B. Tenant/Organisation:** CreateBusinessPage, BranchesPage, DepartmentsPage, SettingsPage, business switching (store), platform admin routes (admin/billing, admin/businesses, partner-admin*); tables businesses, business_users, branches, departments + is_business_member / can_* helpers; service-role edges (most Edge Functions).
- **C. Accounting:** AccountsPage, JournalsPage, PeriodManagementPage, RepairCoaPage; tables accounts, journal_entries, journal_lines, accounting_periods; RPCs _ledgr_post_entry(-keyed), next_journal_entry_number, reserve_next_document_number; journalService/CapitalJournalService/FixedAssetsJournalService/FxRevaluationService; seed/repair (seedChartOfAccounts, RepairCoaPage).
- **D. Sales/Invoicing:** InvoicesPage, IncomePage; tables invoices, invoice_lines, invoice_payments, recurring_invoices, invoice_delivery_events; RPCs increment_amount_paid, enforce_invoice_payment_allowed (trigger), save_quick_sale, reserve number; Edge send-invoice, invoice-open, process-invoice-automation; corrections via R07 path + non-POS edits by repository.
- **E. POS:** PosPage, posSettings, terminals, shifts, cash movements, approvals, corrections; tables pos_*; RPC command surface (open/close shift, cash movement, refund/void, approvals request/authorize/consume, post_pos_sale binding); positions of R06/R07/R08/R09/R10.
- **F. Inventory:** ProductsPage, InventoryPage, WarehousePage, TransfersPage; tables products, inventory_balances, stock_movements, inventory_locations, stock_transfers(+lines); mechanism _ledgr_apply_stock_movement_balance + _ledgr_post_cogs; chk non-negative constraint; valuation service.
- **G. Procurement/Suppliers:** contacts supplier paths, quick-expense stock-lines (purchase implication), no purchase-orders table (absent by design).
- **H. Customers/Contacts:** ContactsPage; contacts table; can_write_contacts_data tiered grants (R04).
- **I. Banking/Reconciliation:** `/bank-reconcile`, BankReconciliation component; bank_statements(+lines); RPC none (repository direct writes); Edge suggest-bank-matches; R05 line-lock.
- **J. Payroll/Tax:** PayrollPage, TaxPage, AssetsPage depreciation, CapitalPage; payroll_runs, payroll_employee_lines, employees(+allowances/deductions), paye_bands, tax_configurations, tax_returns, fx_*/budget tables; helpers can_write_payroll/can_view_payroll; Edge generate-vat-returns (R14-deferred).
- **K. Reporting:** ReportsPage, AuditLogPage, ApiDocumentationPage; 20 views; get_pos_shift_report; verify_audit_chain; export pathways (tax-return generation, backup service).
- **L. AI:** AiInsightsPage, `/chat`; Edge ai-chat, support-agent, suggest-bank-matches; ai_context RPC; ai_insights_usage/support_agent_usage tables; R03.
- **M. Offline/Browser:** Workbox caches + registerServiceWorker + sw-events.js; React Query persistence; Dexie db v2 (queue/leases/device identity/provenance); legacyPosQueue; syncEngine with usage asserts (invoice/expense/sale paths); offlineSyncContext/banner/provider.
- **N. Storage:** bucket `business-logos` (**public = true**, size/mime unbounded) + companion invoice-artifact bucket per migration; 8 storage policies.
- **O. Edge/webhooks:** 27 functions; catalog classifies all (authenticated / role-restricted / organisation-restricted / server-only); paychangu-webhook (payment provider), webhook-dispatcher + retry-failed-webhooks (outbound), supports CRON-secret jobs.
- **P. Notifications/Integrations:** send-invoice (email/receipt), send-renewal-reminders, paychangu webhook, ZapierIntegrationPage, ApiKeysPage + create-api-key, webhooks table + deliveries, invoice_delivery_events.
- **Q. Deployment/Infra:** Vercel (deploy.yml), Supabase migrations+roles, GitHub Actions (ci.yml incl. release-evidence gate job; backup-verify, keepalive, capture-staging-schema), env check in build, R00.

# 5. Coverage Matrix (status per domain, with the mandated dimensions)

Dimensions collapsed into rows; "server-authoritative?" refers to whether the authority chain ends at the server (RLS + SECURITY DEFINER + constraints), not at client checks. Statuses per §4 vocabulary only.

| # | Surface | Status | Evidence | Tenant tested? | Role tested? | Financial authority tested? | Cross-tenant? | Cross-branch? | Server-auth? | Offline path? | Runtime/browser? | Remaining gap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Login/logout/session | BLOCKED (runtime) | AUTH.* ×4 BLOCKED | n/a | n/a | n/a | n/a | n/a | server (GoTrue) | n/a | NO — blocked | runtime session-revocation proofs |
| A2 | Signup/onboarding/create-business | PARTIALLY VERIFIED | R01.PROVISION ×3, R01.CREATE-BUSINESS RPC ✓ | ✓ | ✓ | n/a | ✓ | n/a | server | n/a | partial | onboarding tamper variants beyond registry |
| A3 | Password/email recovery | PARTIALLY VERIFIED / DECISION | R02.PRESERVED ✓, RECOVERY.* ✓ server-side; OTP ×3 BLOCKED; DEC-02 unresolved | ✓ | ✓ | n/a | ✓ | n/a | server | n/a | BLOCKED | real-provider end-to-end recovery proofs; phone-recovery policy |
| A4 | Invitations/acceptance/membership | PARTIALLY VERIFIED | R01.INVITE/ACCEPT/MEMBER (43), invite_member RPC + edges ✓; PRIV.* ×4 BLOCKED | ✓ | ✓ | n/a | ✓ | partial | server | n/a | partial runtime | privileged manipulation runtime proofs blocked |
| A5 | Profile/phone identity | PARTIALLY VERIFIED | R01.PROFILE ×12, R02.PHONE ✓; PRIV.PROFILE BLOCKED | ✓ | ✓ | n/a | ✓ | n/a | server | n/a | partial | phone-binding churn flows |
| B1 | Tenant isolation read/write | VERIFIED (server matrix) | R01.CURRENT ×227 (21 roles × tamper registry), R02.ISOLATION ×4, TENANT.* read/pos/delete/update/ ai PASS | ✓ | ✓ | ✓(registry) | ✓ | partial | server | n/a | harness-level | keep RLS drift monitors |
| B2 | Storage tenant isolation | BLOCKED | TENANT.A/B.storage BLOCKED | ✗(blocked) | ✗ | n/a | ✗ | ✗ | policies exist | n/a | NO | negative cross-tenant object proofs; bucket is public |
| B3 | Branch-scope model | BLOCKED | BRANCH.* ×8 BLOCKED (create/read/financial/customers/inventory/reports/modify/cross-branch-admin) | ✗ | ✗ | ✗ | ✗ | ✗ | partial | n/a | NO | entire assigned-scope enforcement proof set |
| B4 | Organisation roles matrix | VERIFIED | R01.CONTRACT ×67 (issuer×target tamper), ROLE.* ×7 write matrix, R04.CONTACTS tiers | ✓ | ✓ | ✓ | ✓ | partial | server | n/a | harness | none in-plane |
| C1 | Chart of accounts | PARTIALLY VERIFIED | R01 rows for accounts via matrix; accounts insert/update direct-write riding RLS; seedChartOfAccounts | ✓ | partial | partial | ✓ | ✗ | RLS | n/a | none | repair-coa page authority diagnostic only |
| C2 | Journal posting engine | PARTIALLY VERIFIED | _ledgr_post_entry-keyed, FINANCE.ORACLE/POSTING-TOTALS/REVERSAL ✓, R05.NUMBER-RESERVATION/POSTING-KEY ✓ | ✓ | partial | ✓ | ✓ | ✗ | server | n/a | no runtime UI path | period-lock interaction; entry-edit/delete boundary |
| C3 | Accounting periods/locks | NOT YET AUDITED (in-lane) | table + RLS exist; PeriodManagementPage | ✗ | ✗ | ✗ | ✗ | ✗ | RLS | n/a | NO | entire lock lifecycle |
| C4 | Journal delete | GAP (§15) | `journal_entries.delete` direct via repo | ? | ? | ? | ? | ? | RLS only | n/a | NO | authorization+audit of deletion |
| D1 | Quick sale (income RPC) | VERIFIED (this-plane) | save_quick_sale SECURITY DEFINER, R10 quota ✓, FINANCE.NONPOS-INCOME ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | server | queued path ✓ | harness | none in-plane |
| D2 | Invoice creation/editing (non-POS builder) | PARTIALLY VERIFIED | InvoiceRepository direct writes riding RLS; R05 payment guards; invoice RLS implicit in matrix rows | ✓ | partial | partial | ✓ | ✗ | RLS | partial (offline queue = legacy) | none | edit/cancel state rules; credit-note lifecycle |
| D3 | Invoice deletion/cancellation | PARTIALLY VERIFIED | `invoices.delete` direct; trigger re guard exists (payments) | ✓ | partial | partial | ✓ | ✗ | RLS+trigger | n/a | none | policy coherence across cancel/void/delete |
| D4 | Invoice payments | VERIFIED in-plane | increment_amount_paid RPC ✓, R05.CANCELLED-INVOICE-PAYMENT ✓, increment audited | ✓ | ✓ | ✓ | ✓ | ✗ | server | n/a | harness | partial-payment reconciliation UI depth |
| D5 | Receipt dispatch (POS receipts) | BLOCKED | R07.RECEIPT.DISPATCH carried BLOCKED since R07 | ✗ | ✗ | ✗ | ✗ | ✗ | n/a | n/a | NO | dispatch pipeline for recorded receipts |
| E1–E9 | POS sales/payments/tenders/shifts/tills/cash/approvals/refunds/voids/reports/late-adjust/offline-pos/corrections | VERIFIED | R06 ×6, R07 ×19, R08 ×22, POS ×6 | ✓ | ✓ | ✓ | ✓ | ✓(shift-boundary) | server | ✓ queue | harness + service-worker register | R09.2 replay seals (2 BLOCKED) for legacy receipts |
| F1 | POS stock invariant | VERIFIED | chk_inventory_balances_on_hand_nonneg; R06.OVERSELL-DENIED/REPLAY/BALANCE-PROPAGATION ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | server constraint | ✓ | harness | — |
| F2 | Stock transfers / adjustments | GAP (§15) | stock_transfers.delete/upsert direct writes; NO propagation-authority binds these paths to _ledgr_apply_stock_movement_balance | ✓RLS | partial | ? | ✓RLS | ? | RLS only (client computed) | n/a | NO | whether transfer/adjustment mutations preserve invariant + cost correctness server-side |
| F3 | Valuation/costing | PARTIALLY VERIFIED | R06.WEIGHTED-AVERAGE-COST ✓ (POS); inventoryValuation service | ✓ | ✓ | ✓ | ✗ | ✗ | server (post_cogs) | n/a | no | non-POS costing entry paths |
| G1 | Purchases via quick-expense + stock | PARTIALLY VERIFIED | quick save expense stock_lines path server-side ✓ R10 | ✓ | ✓ | ✓ | ✓ | ✗ | server | queue ✓ | harness | purchase returns/credit lifecycle |
| H1 | Contacts CRUD/visibility | VERIFIED (tier plane) | R04.CONTACTS ×9 incl. ANON-DENIED/CROSS-ORG/WRITER-MATRIX | ✓ | ✓ | partial | ✓ | ✗ | RLS | n/a | no | branch-scoped visibility (BRANCH.customers BLOCKED) |
| I1 | Bank statements/lines import | PARTIALLY VERIFIED | R05.FINANCE.BANK-LINE-LOCK ✓; bank_statements(+lines) direct writes | ✓ | partial | partial | ✓ | ✗ | RLS | n/a | none | import idempotency; fileless channel |
| I2 | Match suggestion (AI) | PARTIALLY VERIFIED | EDGE.suggest-bank-matches ×2 PASS | ✓ | ✓ | n/a | ✓ | ✗ | server | n/a | partial | match ACCEPT authority path (client direct) |
| I3 | Manual reconciliation entries | NOT YET AUDITED | repository-driven | ✗ | ✗ | ✗ | ✗ | ✗ | RLS | n/a | NO | entire manual recon authority map |
| J1 | Payroll runs/employees | PARTIALLY VERIFIED | R01 matrix rows for payroll role families; payroll_runs insert direct | ✓ | partial | partial | ✓ | ✗ | RLS | n/a | none | payroll posting correctness + correction paths; can_write_payroll binding depth |
| J2 | Tax config/PAYE | PARTIALLY VERIFIED | paye_bands/tax_configurations direct writes riding RLS | ✓ | partial | partial | ✓ | ✗ | RLS | n/a | none | config change audit; effective-dating |
| J3 | VAT-return generation | DEFERRED (R14) | EDGE.generate-vat-returns cataloged server-only R14 | ✓(catalog) | ✓ | n/a | n/a | n/a | server | n/a | no | scheduling + correctness package |
| J4 | Payroll/expense/invoice quota server assert | PARTIALLY VERIFIED → GAP | R10 P0QLT contract covers all paths that CALL the meter; invoice/payroll posting RPCs DO NOT call it (client look-ahead only) | ✓ | ✓ | ✓ | ✓ | ✗ | server (where invoked) | typed precheck ✓ | harness | server-side assert absent on 2 RPC families (R10 §1 finding) |
| K1 | POS/shift reports | VERIFIED | get_pos_shift_report R08 ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | server | ✓ | harness | — |
| K2 | Financial statements & registers | PARTIALLY VERIFIED | 20 views RLS-scoped; aggregated on client/server views | ✓ | partial | partial | ✓ | ✗ | RLS/views | n/a | none | export/download correctness; caller-supplied params on report RPCs absent except shift-report |
| K3 | Audit log & chain | PARTIALLY VERIFIED | audit_chain_hash/verify_audit_chain RPCs; R07.AUDIT fabricate-accepted + cross-tenant-denied ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | server | n/a | harness | **R07.AUDIT.SAME-TENANT-FABRICATED-ACCEPTED** PASS = fabricated same-tenant events accepted by writer surface (documented seam) |
| L1 | AI chat/insights/edge | PARTIALLY VERIFIED | R03.AI ×16, AI.ANON/ROLE ✓; ai_context RPC ✓ | ✓ | ✓ | n/a | ✓ | ✗ | server | n/a | handler-mocked | AI.BRANCH BLOCKED; R11 metric consistency not executed |
| M1 | Caches | VERIFIED (in-plane) | R09.1 ×6 (wipe/re-population/isolation/no-wildcard/repeat-safe/evidence-preserved) | ✓ | ✓ | n/a | ✓ | ✗ | client controls | ✓ | browser pending R09.4 | — |
| M2 | Queue provenance/actor/lease/quarantine | PARTIALLY VERIFIED | R09.2 ×18 PASS + 2 BLOCKED seals (SAME-USER, REPLAY-CONTRACT) | ✓ | ✓ | ✓ | ✓ | ✗ | server (posting) | ✓ | partial | the two seals + R09.3 decisions |
| M3 | Sync boundary rejection contract | VERIFIED in-plane | R10 ×8 (quota vs non-quota vs precheck vs regression) | ✓ | ✓ | ✓ | ✓ | ✗ | server | ✓ | no additional quota paths (J4) |
| N1 | Buckets/objects | BLOCKED | policies ×8; TENANT.*.storage BLOCKED; bucket public | ✗ | ✗ | n/a | ✗ | ✗ | policies | n/a | NO | full negative-coverage set unknown |
| O1 | Edge functions catalog | PARTIALLY VERIFIED | 23 classified + catalog record; EDGE.* ×58 PASS | ✓ | ✓ | ✓ (billing edges) | ✓ | ✗ | mixed | n/a | handler-mocked | 2 FAIL open (RETRY.no-secret, WEBHOOK.viewer); several functions verified at handler level only |
| O2 | Webhook inbound auth | FAILED (1 record) | EDGE.WEBHOOK.viewer FAIL | ✗ | ✗ | n/a | ✗ | ✗ | — | n/a | harness | provider-signature/secret enforcement proof |
| P1 | Outbound webhook deliveries | PARTIALLY VERIFIED | webhook-dispatcher + retry-failed-webhooks ✓; deliveries table | ✓ | ✓ | ✓ | ✓ | ✗ | server | n/a | handler level | retry WITHOUT secret FAIL (O2 twin) |
| P2 | Inbound payment webhook (paychangu) | PARTIALLY VERIFIED | paychangu-webhook ×2 PASS | ✓ | ✓ | ✓ | ✓ | ✗ | server | n/a | handler level | replay/secret-proof depth |
| Q1 | CI release gate | VERIFIED (mechanism) | ci.yml release-evidence job; comment: FAIL & BLOCKED → nonzero; no continue-on-error | n/a | n/a | n/a | n/a | n/a | n/a | harness ✓ | harness | gate is RED today (2 FAIL + 53 BLOCKED) — sanctioned policy needed for closure semantics |
| Q2 | Restore/PITR/observability/jobs | DEFERRED (R14) | readiness plan T21–T23 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | NO | recoverability proof package |
| Q3 | Historical data reconciliation/pilot | DEFERRED (R15) | readiness plan | — | — | — | — | — | — | — | NO | cohort reconciliation |

# 6. Financial Mutation Authority Map (§5 requirement)

All tenant identity, and branch identity where bound, is server-derived inside SECURITY DEFINER commands (verified in R07/R08); direct-table mutations rely on RLS predicates (server-derived `auth.uid()` membership).

| Operation | Server command (authoritative) | Client direct write to base table? | Role gate | Server-derived tenant/branch/actor | Idempotent | Correction/reversal controlled | Release evidence | Offline-capable | Reconciliation-fail posture |
|---|---|---|---|---|---|---|---|---|---|
| POS sale post | post_pos_sale (R08 binding) | NO (RPC) | can_operate_pos + shift steering | ✓/✓/✓ | client_key ✓ exactly-once (R06) | refund/void commands ✓ R07 | R06/R07/R08 ✓✓ | YES | failed item typed (quota P0QLT); replay rules per model decision (P-D3-FINAL open) |
| Shift open/close, cash movement | *_command RPC | NO | own-shift steering 42501 | ✓ | keyed | closed-shift append-only late adjustments | R08 ✓ | NO | n/a |
| Refund/void | *_command RPC | NO (not queueable — by design) | approver + tier | ✓ | consume-once tokens | R07 coverage ✓ | R07 ✓ | NO | n/a |
| Quick expense post | save_quick_expense | NO | can_write_business_data | ✓/branch client-supplied/actor ✓ | client_key ✓ | deletion via repo (RLS) | R10/R05 ✓ | YES | failed item typed P0QLT |
| Quick sale post | save_quick_sale | NO | can_write_business_data | ✓/client branch/✓ | client_key ✓ | invoice corrections non-POS — partial | R10/FINANCE ✓ | YES (legacy) | typed |
| Invoice payment increment | increment_amount_paid | NO | membership | ✓/✓/✓ | additive-coalesce ✓ | void evidence R05 ✓ | R05 ✓ | NO | n/a |
| Journal manual post | _ledgr_post_entry(-keyed) | journal_entries/ lines INSERT+UPDATE direct also exist | membership | ✓/partial/✓ | keyed | reversal FINANCE.REVERSAL ✓; edit/delete bounds unproven | FINANCE ×4 ✓ | partial | n/a |
| Journal DELETE | — | **YES (direct)** | RLS only | ✓(RLS)/? | n/a | **unproven** | none | NO | GAP-2 |
| Invoice create/edit/delete (builder) | — | **YES (direct incl. delete)** | RLS (+triggers on payments) | ✓/? | n/a | partial | R05 subset | partial | GAP-1 |
| Expense edit/delete | — | YES (direct) | RLS | ✓/? | n/a | void expense-payment R05 ✓ | R05 subset | YES | typed queue boundary |
| Payroll run insert | — | **YES (direct)** | can_write_payroll RLS | ✓/? | n/a | unproven | none (role matrix only) | NO | GAP-3 |
| Payroll posting to journals | workflow (legacy) | legacy blocked lane | — | — | — | — | LEGACY.workflow_accounting BLOCKED | NO | GAP-3 |
| Bank statement + lines | — | **YES (direct)** | RLS | ✓/? | n/a | line-lock R05 ✓ | R05 subset | NO | GAP-4 |
| Bank match accept | — | YES (direct line update) | RLS | ✓ | n/a | unproven | none | NO | GAP-4 |
| Fixed assets / depreciation | service clients | **YES (direct)** | RLS | ✓ | n/a | unproven | none | NO | GAP-5 |
| FX revaluation | FxRevaluationService | **YES (direct)** | RLS | ✓ | n/a | unproven | none | NO | GAP-5 |
| Stock transfers | — | **YES (direct incl. delete)** | RLS | ✓ | n/a | unproven | none | NO | GAP-6 (bypasses authoritative propagation) |
| Stock adjustments (manual) | repo recordMovement (clientKey-idempotent RPC call to movement cb?) — verify | partial | RLS | partial | client-keyed | partial | R06 POS subset | NO | verify binding to _ledgr_apply_stock_movement_balance for each writer |
| Subscription/payment apply | apply_subscription_payment (edge/service) | NO | service | ✓ | keyed ✓ | n/a | BILLING ×9 ✓ | NO | webhook replay P2 |
| Audit events | log_manual_audit_event | NO | membership | ✓ | n/a | R07.AUDIT seam open (fabricated same-tenant accepted) | R07 ✓ | NO | seam documented |

**Financial mutations outside POS that have NOT received R07/R08-class depth:** journal edit/delete; invoice builder lifecycle (edit/cancel/credit note); payroll posting/corrections; bank match/recon accept; fixed-asset & FX revaluation mutations; stock transfers/adjustments; subscription/invoice automation jobs; contact financial-link mutations (customer balances are derived — medium).

# 7. Client vs Server Authority Review (§6 requirement)

Patterns found knowingly (no changes made):

| Pattern | Example | Classification |
|---|---|---|
| React-only role gating | page-level action visibility mixed across tools | client advisory (server RLS rechecks) — consistent |
| caller-supplied business_id | most repo writes + quick-save payloads | mixed: server can_write_* revalidates ✓; functions authz first ✓ |
| caller-supplied branch_id | invoice/expense builder payloads, transfers | mixed — branch-boundary model exists (R08 shift case) but direct-write tables have no assigned-scope proofs (BRANCH BLOCKED) |
| caller-supplied user_id | profile upsert paths | server authoritative where found (PRIV runtime blocked) |
| caller-supplied account/customer/invoice IDs | journals/payments repos | mixed (RLS + FKs; authority depth per §6 map) |
| direct Supabase table writes (financial) | 19 financial-table direct mutations (journal_entries±lines, invoices, expense_payments, invoice_payments?, payroll_runs, bank*, fixed_assets, fx_revaluations, stock_transfers, accounts, stock_movements×4, expense_payments) | mixed → several GAPS (above) |
| SECURITY DEFINER trust surface | 73 functions; verified authz-first pattern in R01/R03/R06/R07/R08/R10 | mostly server authoritative; unreviewed remainder listed §15 |
| service-role edges | 27; catalog classification enforced by EDGE.CATALOG record ✓ | classified; 2 FAIL open |
| RPC trusting caller parameters | save_quick_* single-payload pattern mirrors client; server revalidates | server authoritative on tests |
| broad authenticated grants | RLS everywhere (63/63 tables) but some UPDATE/DELETE direct | mixed — branch-scope + destructive-bounds |

# 8. Tenant / Role / Branch Coverage

- Tenant & role enforcement is the deepest non-POS area: 430 R01 records + contract matrices + write matrices. Residual: storage objects (BLOCKED), branch scope (BLOCKED), and runtime/browser identity proofs (BLOCKED).
- Branch: the entire assigned-scope program is BLOCKED ×8 — the deepest known hole relative to its importance (financial, customers, inventory, reports, modify, cross-branch-admin unproven).

# 9. Offline Coverage

Cache confidentiality VERIFIED in-plane (R09.1 ×6). Queue provenance/actor/lease/quarantine verified with two deliberate seals (SAME-USER, REPLAY-CONTRACT). Boundary rejection contract typed (R10). Outstanding: browser/runtime evidence package (R09.4, OFFLINE.* ×6 BLOCKED: ACTOR-BINDING? — OFFLINE records: REOPEN/FAIL-PRESERVE/STATES etc Partial by evidence), legacy receipts replay policy (P-D3-FINAL).

# 10. Edge/Webhook Coverage

27 functions; catalog enforced by a passing record; every function has classification ×2 handler-level evidence (58 PASS). Open: EDGE.RETRY.no-secret FAIL, EDGE.WEBHOOK.viewer FAIL (explicitly NOT closed per mandate), several R14-marked server-only jobs deferred by scope (invoice automation, VAT returns, renewals, finalizers, partner invoicing, export/deletion flows partially).

# 11. Storage Coverage

Two application buckets; policies: 8 statements tying write paths to caller businesses via path prefix; logo bucket PUBLIC=true (reads unauthenticated by design for logo rendering). No negative cross-tenant object-access proof exists (blocked ×2) — including reads of invoice-artifact bucket objects, signed-URL flow, object deletion bounds, and metadata fields. **Storage is the least-covered material domain.**

# 12. Deployment/CI Coverage

R00 baseline documented exposure (network, env, service role, endpoints). CI runs the full harness with hard gating (FAIL and BLOCKED → nonzero; no continue-on-error) — meaning the pipeline currently goes RED whenever this suite is invoked (2 FAIL + 53 BLOCKED outstanding). Restore/PITR/jobs observability (R14) and staging schema capture exist as workflows but the T22 restore-replay proof is deferred.

# 13. POS vs Non-POS Coverage Concentration (§7 requirement)

Measured on the 733-record universe:

| Domain family | Records |
|---|---|
| Tenant/roles/auth-server (R01/R02/R04/TENANT/ROLE/PRIV/AUTH) | 507 |
| POS core (R06/R07/R08/POS/R10) | 61 (8%) |
| Edge/webhooks | 60 |
| Offline/cache/queue (R09/OFFLINE) | 31 |
| Finance–nonPOS (R05/FINANCE/BILLING) | 22 |
| AI (R03/AI) | 19 |
| Foundation (DB/HARNESS/R12) | 13 |
| Legacy historical packs | 12 |
| Branch | 8 (all BLOCKED) |

**Answer to §7:** By *record volume* the programme is NOT POS-focused (POS = 8%; tenant/identity = 69%). By *proof class*, POS is disproportionately deep: it uniquely holds invariant/oversell, command-state-machine (approvals/refunds/voids), actor-binding, exactly-once idempotency, and shift-boundary proofs. Equivalent proof classes do not exist for any non-POS financial mutation (§6 GAP list). The concentration finding is therefore: **depth-concentration in POS, volume-concentration in tenant/identity; material non-POS business-domain surfaces have shallow or absent evidence.**

# 14. Open Findings Reconciliation (§9 requirement)

| ID | Current status | Evidence | Dependency | Required action | Can block closure? |
|---|---|---|---|---|---|
| R00 deployment baseline | PARTIALLY VERIFIED (documented) | R00 report | R14 ops | rerun post-changes; restore proof | YES (with R14) |
| R09.3 reconciliation readiness | REQUIRES DECISION (+prereq met) | R09.3 report; P-D2 DONE (R10) | P-D3-FINAL signing; D-4 rider | authorized sign-off, then R09.3 impl package | YES |
| R09.4 browser/runtime evidence | BLOCKED (not started) | OFFLINE/AUTH/PRIV BLOCKED sets | browser runner infra | authorized package | YES |
| R12 webhook/edge secrets | FAIL ×2 open | EDGE.RETRY.no-secret, EDGE.WEBHOOK.viewer | implementation package (not authorized here) | remediate + re-evidence | YES (CI red) |
| R13 reproducible harness | VERIFIED | 733-record reproducible runs ×3 | keep green | maintain; migrate LEGACY packs | NO (tooling) |
| R14 ops/restore/jobs | DEFERRED by scope | plan T21–T23 | authorization | future package | YES (before release) |
| R15 reconciliation/pilot | DEFERRED by scope | plan | R14 + cohort | future package | YES |
| BRANCH.* (8) | BLOCKED | evidence IDs | DEC-03 reshape + R09.4-like runtime | decision + package | YES (financial/customer/inventory) |
| TENANT.*.storage (2) | BLOCKED | evidence IDs | storage package design | package | YES |
| R07.RECEIPT.DISPATCH | BLOCKED (historical carry) | R07/R08/R09 reports | dispatch product decision | decision → implement → evidence | YES for POS receipts |
| invoice/payroll server quota assert | GAP (new, documented in R10 §1) | R10 §1 audit finding | future additive migration decision | decision + implement + evidence | MEDIUM (client-side check exists; server authority posture must be decided) |
| LEGACY.* (12) | BLOCKED | evidence IDs | harness migration decision | migrate jest packs into R13 lanes or retire with justification | NO (with rationale) |
| AUTH.* (4), R02.PROVIDER-TOKEN (9), R02.OTP (3), PRIV.* (4) | BLOCKED | evidence IDs | provider/runtime infra | runtime package | YES (auth/recovery = release-critical) |
| R09.2 seals (SAME-USER, REPLAY-CONTRACT) | BLOCKED (by design) | evidence IDs | R09.3/P-D3-FINAL | decided behavior → evidence | YES |
| AI.BRANCH | BLOCKED | evidence ID | branch model (DEC-03) | package | MEDIUM |
| R11 (AI metric consistency) | DEFERRED/catalog-tag only | catalog R11 tag; no lane records | authorization | package | MEDIUM |
| BILLING.SERVER-QUOTA (1) | BLOCKED (superseded by R10 server records — report inconsistency: reconciled via R10.QUOTA.SERVER-* PASS; recommend formal retirement note) | evidence IDs R10.QUOTA.* | R10 evidence file mapping | record-mapping note | NO (if mapped) |

# 15. New Gaps Discovered (not previously registered; describe only — nothing changed)

1. **GAP-1 — Invoice builder mutation bounds:** direct `invoices` delete + edit paths ride RLS; state-machine (cancel/credit-note) coherence with payments/audit unproven. Evidence needed: command-level lifecycle records analogous to R07 for non-POS invoices.
2. **GAP-2 — Journal delete/edit authority:** direct `journal_entries.delete`/`update` exists; no approval/audit/invariant evidence of who may delete posted entries. Needs authority map + correction-path evidence.
3. **GAP-3 — Payroll posting & corrections:** `payroll_runs` insert direct; posting-to-journal flow only in blocked legacy pack; correction/reversal of payroll not evidence-backed anywhere.
4. **GAP-4 — Bank statement/channel:** direct statement+line writes and AI-match accept flows; import idempotency and reconciliation authority unproven.
5. **GAP-5 — Non-POS financial calculators:** fx_revaluations + fixed_assets/depreciation direct insert paths untouched by release evidence.
6. **GAP-6 — Stock transfers/adjustments bypass authoritative propagation:** `stock_transfers.write/delete` direct; no proof these reconcile through `_ledgr_apply_stock_movement_balance` / cost model → R06's invariant protects balances but transfer-level financial consistency is unproven. (R06 explicitly scoped to tested paths; sufficiency for *every* inventory mutation is NOT established — transfers/adjustments are the open class.)
7. **GAP-7 — Delete-bounds for configuration:** paye_bands/tax_configurations deletes by authenticated writer role riding RLS — no change audit evidence.
8. **GAP-8 — CI gate semantics:** hard-red gate vs a living backlog of accepted-risk items is unresolved (no sanctioned "expected" registry; comment explicitly says no continue-on-error). Closure needs either full remediation or a signed expected-state mechanism.
9. **GAP-9 — BILLING.SERVER-QUOTA vs R10 mapping:** historical BLOCKED record should be formally mapped to R10 evidence to prevent double-counting.
10. **GAP-10 — Report/export authority:** report RPCs beyond shift-report + VAT-return scheduling unevidenced (caller-supplied params on statement queries are view-driven only).
11. **GAP-11 — Repair/Tooling surfaces:** RepairCoaPage/DevTools-like routes exist; authorization diagnostics only — runtime invocation consequences unproven.
12. **GAP-12 — Workflow job replay contracts:** process-invoice-automation (cron-secret) and renewal reminders lack idempotency-drift evidence (T23 class).

# 16. R09.3 Readiness Impact (§11 requirement)

Existing prerequisites preserved: P-D2 **DELIVERED** (R10), P-D3-FINAL **DECISION REQUIRED**, D-4 rider relevant, D-3/oversell-vs-R06 unchanged (no re-decision here), R09.2 actor/quarantine evidence authoritative, R09.4 browser evidence outstanding.

**Additional prerequisites the application-wide findings introduce for any R09.3 rollout (recorded, not implemented):**
1. R09.3's queue-policy decision must account for the typed quota boundary (now visible as `lastErrorCode`) — the P-D3-FINAL model choice should specify expected handling of P0QLT (policy denial vs transient) rather than leaving it implicit.
2. Offline reconciliation coverage today is POS+quick-save centric (R10 quirk: expense path typed); the same guarantee does not exist for invoice-builder/payroll offline writes — an R09.3 scope decision must explicitly accept or reject that asymmetry.
3. GAP-6 (transfers bypassing authoritative propagation) means stock-reconciliation claims inside R09.3 cannot safely generalize beyond tested paths without the transfer package.

# 17. Master Closure Roadmap (§10 requirement; dependency-aware packages, no invented R-numbers)

**P1 — Decision package (blocks everything):** sign P-D3-FINAL (queue policy incl. P0QLT handling), DEC-02 phone-recovery, DEC-03 branch matrix + receipt-dispatch product decision, R12 remediation approach, invoice/payroll server-quota-assert decision, CI expected-state policy (or accept full-remediation).
Prereq: none. Closure: signed decisions committed as release records.

**P2 — R09.3 implementation:** queue replay/quarantine/reconciliation model per P-D3-FINAL; D-4 rider records. Prereq: P1. Surfaces: offline queue/receipts/sync boundary. Impl+runtime: YES.

**P3 — R12 webhook/edge secrets:** retry-secret + viewer webhook authorization fix + re-evidence; reconciles GATE RED (together with P8 policy). Prereq: P1. Surfaces: retry-failed-webhooks, webhook-dispatcher internals. Impl+runtime: YES.

**P4 — Runtime/browser evidence (R09.4-class):** AUTH.* ×4, R02 token/OTP ×12, PRIV.* ×4, OFFLINE.* ×6, BRANCH.* ×8, TENANT.*.storage ×2, receipt dispatch runtime. Prereq: infra + P1 decisions. Runtime-only (no impl unless defects found).

**P5 — Storage tenant-isolation package:** negative cross-tenant proofs, signed URL policy verification, invoice-artifact bucket review; may require policy implementations if gaps confirm. Prereq: P4 infra.

**P6 — Non-POS financial mutation authority package (GAP-1/2/3/4/5/6/7):** introduce/rebind authoritative server paths (or formally accept RLS-direct posture) for invoice lifecycle, journal delete/edit, payroll posting+corrections, bank match/recon accept, FX/depreciation, stock transfers/adjustments, config deletes — each with R07-class evidence (authority, idempotency, correction, audit). Prereq: P1 (which surfaces get commands is a policy fork). Scope decision heavy; largest implementation body.

**P7 — AI consistency (R11) + AI.BRANCH:** after DEC-03. Evidence: metrics-consistency records + branch-context records.

**P8 — CI release-gate closure semantics:** full remediation of remaining FAIL/BLOCKED (P3+P4+P5+seals) OR sanctioned expected-risk registry with sign-off attestation; either way CI must be green-by-truth.

**P9 — R14 operations/restore/jobs:** T21–T23 proofs (backup restore replay, job failure visibility, webhook replay determinism). Prereq: none technical; schedule after P3.

**P10 — R15 reconciliation/pilot + LEGACY pack migration:** cohort reconciliation; migrate or formal-retire the 12 LEGACY jest packs. Prereq: P6/P9.

**P11 — Final regression & closure:** harness full-green or fully-signed; tag release; freeze gate. Prereq: all above.

Package → gaps map: P6 covers GAP 1–7 + J4 decision; P3 covers O2/P1+FAIL pair; P4 covers the 33 blocked identity/branch/runtime records; P5 covers storage; P8 covers GAP-8; P12-ish nothing invented beyond these.

# 18. Evidence Limitations

1. 53 BLOCKED records are real pending evidence — PER RULE, none were marked PASS anywhere in this review.
2. Handler-level (mocked-platform) EDGE evidence does not equal deployed-behavior evidence; R00 documented this exchange explicitly.
3. The harness's embedded PostgreSQL replays migrations verbatim; production Supabase differences (cron, realtime, dashboard-managed objects) are not within its scope (documented in harness design).
4. Git-drift infra artifact documented under §3; baselines verified by remote hash equality.
5. This review enumerates but does not re-execute exploitation attempts; "no exploit observed" was never used as a pass reason.

# 19. Explicit STOP / Authorization Statement

This review produced discovery, evidence mapping, gap registration, and a roadmap ONLY. No code, migration, RLS, Edge Function, RPC, quota, offline, POS, storage, auth, or CI change was made. No finding was fixed, closed, re-scored, re-ranked, or silently resolved. No historical audit artifact was edited. The only repository mutation introduced by this review is the addition of this single report file. Nothing here declares Ledgr release-ready.

---

**Final determination: REQUIRES DECISION**
