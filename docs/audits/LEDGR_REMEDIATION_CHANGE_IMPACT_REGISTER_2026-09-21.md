# Ledgr — R00–R15 Remediation Change-Impact Register

**Date:** 21 September 2026  
**Status:** Analysis and proposed implementation specification only. **Nothing implemented.**  
**Source baseline:** `2e0ede303634d753710357077823eeafb9ecfb7d`, plus the prior audit and plan documents; the relevant paths/symbols were rechecked in the repository for this register.

Related documents:
- [Architecture audit](LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md)
- [Production-readiness plan, including DEC-01–DEC-10](LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md)

## How to use this register

Each of the 16 packages answers the same **13 questions**. This is a change-impact assessment, not authorization to deploy.

**Scope precision:** “Direct targets” identifies existing files/objects expected to require changes. “Inspect/regression consumers” identifies dependencies that may not need edits. Existing migration files are cited as **definition/evidence locations**: do not edit previously applied migration history. Proposed corrections require new forward migrations with filenames assigned when implementation is approved. Newly proposed tables/functions are explicitly labeled **new, design pending**; inventing final names now would imply a schema design that has not been approved.

**Evidence limitations:** production/staging were not accessed. A source defect does not prove deployment, exploitation or historical corruption. Runtime tests below are instructions for a later authorized assessment, **not tests run in this turn**. No dependencies were installed, no test suites or database scripts were executed, and no existing application/configuration/migration files were changed.

### Shared test and rollout rules

- **B0 — Existing baseline:** in an approved isolated environment, run root typecheck, lint, unit tests and build (`npm run verify` with safe build configuration). For gateway changes, run its separate typecheck/test/build. Record existing failures; do not label them regressions from an unimplemented change.
- **DB0 — Database baseline:** replay migrations on a disposable database, inspect effective grants/RLS/functions/triggers, and run relevant database tests through a verified harness. Current `tests/database/*.js` use a separate, nonportable harness and are not included by root Vitest. Do not assume `npm test` runs them. R13 resolves that gap; controlled baseline reproduction can precede permanent harness changes.
- **P0 — Permission fixture:** tenant A and tenant B; a multi-membership user; owner/admin/accountant/cashier/stock clerk/branch manager/viewer; branches A1/A2; actual `anon` and authenticated principals. Service-role fixture setup is not evidence that restricted access works.
- **F0 — Finance fixture:** known opening balances, taxable/non-taxable and foreign-currency documents, payments, tracked/nontracked products, known inventory costs and approved expected journals. Establish rounding/tax expectations with the finance reviewer.
- “Before implementation” means characterize current behavior with existing tests and controlled scenario probes. Some probes are **new test specifications, not existing automated coverage**. Expected failures document the defect; they are not permission to exploit real accounts.
- Never run destructive replay/restore harnesses against production. Review each diagnostic script before use; for example, `scripts/verify-ai-views.sql` creates/drops temporary verification objects and is not a strictly read-only transaction script.
- After implementation, run targeted tests **and** B0/DB0/P0/F0 as applicable. Record revision, environment, actor, expected result and actual result.
- Rollback must not restore known vulnerable grants, delete unsynced sales, reset usage/payment history, or erase later valid transactions. Security containment and financial forward repair take precedence over a literal revert.

## Executive release-blocker matrix

**Universal** means a blocker for new paid production onboarding/expansion. **Conditional** means a blocker wherever the capability is reachable, sold, or needed to support existing records—not merely visible in the UI.

| Package | Release blocker | Migration expectation | Customer-data exposure/change risk | Regression risk |
|---|---|---|---|---|
| R00 | Universal: deployed safety cannot be assumed | No for discovery | Read/metadata exposure if capture is mishandled | Low; operational load/mistargeting |
| R01 | Universal | Yes: grants/policies/guards | Identity/role availability; deliberate correction of privileged records | High |
| R02 | Universal if identity endpoints reachable; otherwise verify containment | Not necessarily for containment; likely for durable identity/recovery contract | Global login credentials, invitations and access | High |
| R03 | Universal if AI RPC reachable; otherwise verify containment | Yes: ACL/function/view definitions | Financial data visibility; no intended ledger rewrite | High |
| R04 | Universal for tenant/role safety; branch rules conditional on branch promise | Yes | Visibility, valid references, invalid legacy rows | High |
| R05 | Universal for enabled finance | Yes | Ledger/document/payment integrity | Very high |
| R06 | Conditional: any inventory/POS use, including existing data | Yes | Stock quantity/value and COGS | Very high |
| R07 | Conditional: POS corrections; safe correction route is mandatory for sold POS | Yes for recommended server commands | Refunds, tax, cash, stock, original/reversal links | Very high |
| R08 | Conditional: POS/shift and branch reporting | Yes | Sale/shift attribution and drawer totals | High |
| R09 | Cache privacy universal where caching is active; offline capture conditional | Local DB yes; server additions conditional | Unsynced transactions and local confidential records | Very high |
| R10 | Universal for paid release | Yes | Entitlements, payments and usage | High |
| R11 | Conditional: financial AI enabled; R03 still universal containment | Yes for full package | AI context/provenance/usage, not accounting facts | Medium–high |
| R12 | Conditional: public API/webhooks enabled or contracted | Yes for full package | Integration access, events and resulting writes | High |
| R13 | Universal for defensible release evidence | No production migration inherently | Disposable fixtures; production only through mistargeting | Medium |
| R14 | Universal for recovery/monitoring; optional jobs conditional | Conditional: schedules/job records/audit instrumentation | Backup coverage, scheduled business writes/deletions | High |
| R15 | Universal for affected customer cohort | Not inherently; data repairs may need controlled scripts/migrations | Explicitly yes: approved historical corrections | Very high |

---

## R00 — Deployment and exposure baseline

### 1. Exact files/tables/functions affected

**Inspection only, not application change targets:**
- `.github/workflows/deploy.yml`, `.github/workflows/capture-staging-schema.yml`, `.github/workflows/backup-verify.yml`.
- `scripts/ci/supabase-link-and-push.sh`.
- `scripts/database/capture-staging-schema.sh`, `capture-staging-schema-via-api.sh`, `capture-staging-schema.sql`, `build-live-inventory.py`, `render-inventory-md.py` (all under `scripts/database/`).
- `supabase/config.toml`, `vite.config.ts`, `vercel.json`, `server/src/index.ts`.
- Historical comparison evidence: `artifacts/database/capture/grants.json`, `policies.json`, `triggers.json`, `functions.json`, `cron_jobs.json`, `storage_policies.json` and `storage_buckets.json` in that same directory.

**Database inventory:** all deployed `public` schema objects, compared by name/signature to repository migrations; `pg_policies`, `pg_proc`, `pg_trigger`, `pg_class`, `pg_default_acl`, `pg_constraint`, `pg_indexes`, `information_schema.role_table_grants`/column grants, migration history in `supabase_migrations.schema_migrations` where available, `cron.job` and job-run history where available, `storage.buckets`/object policies. Critical functions to resolve first: `is_platform_admin`, `ai_context`, `post_pos_sale`, `_ledgr_post_entry`, `_ledgr_complete_pos_sale`, `apply_subscription_payment`, `enforce_plan_tier_change` and the actual stock-balance trigger/function if one exists.

### 2. Current behaviour

The repository contains migration reconstruction, capture artifacts and deployment workflows, but no current deployed-state attestation. Some source paths assume triggers created outside migration history. Migration filenames later than the audit date already exist in the checkout.

### 3. Vulnerability/defect

Deployment drift can make a fix unnecessary, incomplete or dangerous—for example, adding another stock updater and double-counting movements. Historical captures do not establish current effective privileges.

### 4. Proposed change

Produce a sanitized per-environment inventory of versions, grants, triggers, schedules, storage controls and active clients/queues. Classify drift and exposure. Use read-only metadata queries where possible; separate any deeper operational probe into an approved action. Do not export credentials or customer financial payloads into the repository.

### 5. Database migration required?

**No.** Discovery produces evidence. Any discovered correction is assigned to R01–R14 and gets its own reviewed change.

### 6. Risk of making the change

Low code risk; medium operational/privacy risk if capture includes function-embedded secrets, cron headers, customer records or expensive scans. Validate target environment, redact output and avoid broad data dumps for metadata discovery.

### 7. Dependencies

Approved read-only operational access and named environment owners. No dependency on feature work. Urgent containment need not await a complete inventory.

### 8. Tests to run before implementation

Verify capture script behavior, target identity and output redaction against an isolated environment. Compare the checked-in artifacts with the migration inventory. Confirm a capture cannot invoke migration push, restore or data-repair scripts.

### 9. Tests to run after implementation

Re-capture a known fixture and prove deterministic object/signature/grant reporting. Manually verify critical object ACLs against the inventory. Confirm credentials/customer data are absent from retained artifacts; record unknowns rather than filling them by inference.

### 10. Rollback procedure

Stop capture; remove/restrict access to newly generated sensitive artifacts under the retention/incident procedure if necessary. No database rollback should be needed. If accidental writes occurred, treat that as an incident, not normal discovery rollback.

### 11. Release blocker?

**Yes, universal evidence gate.** A full performance inventory can wait, but effective exposure and accounting invariants cannot remain unknown at release.

### 12. Could it affect existing customer data?

Not intentionally. Metadata capture can expose sensitive information or add load; its scope must exclude unnecessary record contents.

### 13. Could existing functionality regress?

Not from a correctly read-only capture. Excessive queries or incorrect target/script selection can affect availability. R00 must not silently become remediation execution.

---

## R01 — Privileged fields and membership transitions

### 1. Exact files/tables/functions affected

**Database direct targets:** `user_profiles`, `business_users`; `is_platform_admin(uuid)`, `can_admin_business_data(uuid)` and the authorization behavior around `user_profiles_own_update`, `business_users_admin_write`, `business_users_admin_update`, `business_users_admin_delete`.

**Definition/evidence migrations:**
- `supabase/migrations/20260815000003_phase8b_rls_policies.sql`.
- `supabase/migrations/20260726000004_platform_admin_and_reminders.sql`.
- `supabase/migrations/20260728000008_role_aware_master_data_rls.sql`.
- `supabase/migrations/20260809000003_admin_business_directory.sql`.

**Caller/consumer inspection and any necessary adaptation:** `src/pages/settings/TeamManagementPage.tsx`, `src/dal/repositories/BusinessRepository.ts`, `src/hooks/useIsPlatformAdmin.ts`, `src/routes/ProtectedRoute.tsx`, `src/components/i18n/LanguageSwitcher.tsx`; `supabase/functions/invite-team-member/index.ts`, `create-invite-link/index.ts`, `grant-manual-subscription/index.ts`, `request-account-deletion/index.ts`, `cancel-account-deletion/index.ts`, `finalize-account-deletions/index.ts`. The latter paths are all under `supabase/functions/`. Existing provisioning functions `create_business_with_owner`, `invite_member`, `accept_invitation` and `set_user_business_access` need compatibility checks, not automatically rewrites.

### 2. Current behaviour

Own-row profile UPDATE covers the row containing `is_platform_admin`. Captured grants include authenticated table UPDATE. Membership policies permit owner/admin row writes, while stricter role-assignment rules exist in some Edge handlers rather than every write path.

### 3. Vulnerability/defect

Potential self-promotion to platform admin under those effective grants/policies; direct membership mutations can bypass owner-only role-transition rules. Broad profile editing can also mutate fields that should not be self-asserted identity/lifecycle evidence.

### 4. Proposed change

Allow only legitimate self-profile changes; protect platform and lifecycle state through restricted grants/guards and explicit authorized server paths. Enforce owner/admin transitions at the trusted boundary for insert/update as well as invitations. Review privileged assignments against an approved list. Preserve language/name changes and legitimate recovery/deletion operations.

### 5. Database migration required?

**Yes:** effective column/table privileges, policies and/or guards. No financial backfill is required. Correcting existing unauthorized role flags is a separate approved data action.

### 6. Risk of making the change

**High.** Whole-row upserts may fail after column restrictions; provisioning, profile preferences, platform support, manual subscriptions and deletion recovery can break. Overly broad definer bypasses could recreate the vulnerability.

### 7. Dependencies

R00 effective grants; R13/P0 tests. Coordinate R02 identity claims, R04 capability rules and R10 platform-only commercial changes. Restrict escalation before wider refactoring.

### 8. Tests to run before implementation

B0 and DB0; `src/hooks/__tests__/usePermissions.test.ts`, `rlsRoleParity.test.ts`; `src/pages/settings/__tests__/TeamManagementPageRoles.test.tsx`, `roleUiParity.test.ts`; `tests/database/rls_security.test.js`, `rpc_reconstruction.test.js`. In P0, characterize direct self-flag update/admin self-promotion and legitimate profile/provisioning/admin actions. No real-user privilege probe.

### 9. Tests to run after implementation

Direct privileged updates/role assignment denied; own name/language edits allowed; authorized platform administration and manual grant succeed; owner-only transitions enforced; invitation/provisioning and deletion/cancellation remain functional. Confirm attempted denied changes leave no altered rows and no alternate upsert/RPC route works.

### 10. Rollback procedure

Keep security restrictions. If legitimate editing breaks, temporarily disable the affected edit and forward-fix its allowed-field/server path. Restore a previous definition only if it was independently verified safe; never restore broad self-admin write access. Reverse mistaken membership changes only from captured before-state through an audited authorized correction.

### 11. Release blocker?

**Yes, universal.** Owner-only UI or finance-only rollout does not neutralize platform escalation.

### 12. Could it affect existing customer data?

Yes: profile/role availability and deliberate correction of identity state. It should not rewrite ledger records. Unexpected permission loss can prevent legitimate users reaching their data.

### 13. Could existing functionality regress?

Yes: registration, team changes, preferences, partner/platform administration, manual billing and account lifecycle. These are required regression cases, not reasons to retain the unsafe policy.

---

## R02 — Phone recovery and invitation identity

### 1. Exact files/tables/functions affected

**Direct targets:** `supabase/functions/invite-team-member/index.ts` (`findPhoneAccount`, `ensureProfile`, global account-resolution/password-reset branch); `supabase/functions/accept-invite-link/index.ts` (phone-restriction matching); `supabase/functions/_shared/phone.ts`; `src/pages/settings/TeamManagementPage.tsx` (phone invite/reset UI and credential display).

**Inspect/regression consumers:** `supabase/functions/create-invite-link/index.ts`, `list-team-members/index.ts`; `src/lib/phone.ts`, `src/pages/LoginPage.tsx`, `src/pages/AcceptInvitationPage.tsx`, `src/pages/auth/ForgotPasswordPage.tsx`, `src/pages/auth/ResetPasswordPage.tsx`.

**Tables/services:** `phone_accounts`, `user_profiles.phone`, `business_users`, `business_invitations`, Supabase `auth.users` and Admin API `createUser`/`updateUserById`. Evidence: `supabase/migrations/20260924000000_phone_team_members.sql`, `20260925000000_phone_accounts_access.sql`.

### 2. Current behaviour

An owner/admin authorized for the submitted tenant can resolve a phone account globally and reset its password before proving authority over that target identity. Never-signed-in accounts have a similar recovery branch. Invitation restriction can fall back to editable profile phone data. Phone sign-in uses a synthetic email/password identity, not SMS ownership verification.

### 3. Vulnerability/defect

Cross-tenant/global identity takeover; tenant membership must not authorize reset of every other membership's login. An invitation link holder can potentially satisfy phone restriction using a self-edited phone field. Logged invitation tokens also expose bearer-like access material.

### 4. Proposed change

Contain reset/adoption of existing identities first. Separate tenant invitation from global recovery; authorize target recovery before mutation. Adopt DEC-02, including multi-membership handling and restricted temporary credentials. Match restricted invitations to verified/provisioned identity, not editable display data. Redact tokens and credential outputs from logs.

### 5. Database migration required?

**Not necessarily for immediate containment:** Edge checks can block resets. **Likely for the complete approved design:** immutable provisioning/verification provenance, recovery/credential lifecycle state and auditable decisions may require additive fields/tables/guards. Names are **new, design pending**; do not repurpose mutable profile fields as proof.

### 6. Risk of making the change

**High:** account lockout, failure to provision phone-only staff, broken repeat invite/recovery, accidental reset of a shared identity or loss of one-time credential delivery. Password hashes cannot be rolled back from an application snapshot.

### 7. Dependencies

R00, R01, DEC-02. R13 isolated Auth/Edge test setup; R14 recovery runbook. Basic email login is not a substitute for a recovery plan for existing phone users.

### 8. Tests to run before implementation

`src/lib/__tests__/phone.test.ts`, `phoneParity.test.ts`; `src/pages/settings/__tests__/TeamManagementPagePhoneInvite.test.tsx`, `TeamManagementPagePhoneErrors.test.tsx`. Controlled probes: existing/new/never-signed-in/shared identity; owner A targeting B; retry after auth-user creation but before membership; editable-phone invitation matching. Record current session/recovery behavior.

### 9. Tests to run after implementation

Cross-tenant reset denied before any auth mutation; no credentials returned on denied requests; multi-membership recovery follows policy; new provisioning and legitimate repeated requests recover without duplication; profile phone edits cannot satisfy restrictions; login/TOTP/recovery still function; no token/password material in logs. Test concurrency and partial provisioning failure.

### 10. Rollback procedure

Disable the new recovery action if unreliable; keep global unsafe resets disabled. Use the approved identity-verification recovery process to issue a new credential and revoke sessions where necessary. Do not restore previously disclosed passwords or delete a valid user's global identity/memberships. Preserve provisioning/audit state for investigation.

### 11. Release blocker?

**Yes while unsafe endpoints are reachable.** Otherwise full recovery enhancements may follow a finance release, provided affected existing users have a safe support path and containment is verified server-side.

### 12. Could it affect existing customer data?

Yes: authentication credentials and organisation access across all memberships. Financial records should remain untouched, but losing legitimate identity access is a material customer impact.

### 13. Could existing functionality regress?

Yes: phone onboarding/reset, account lookup, repeat invitations, phone-restricted links, credential display and team-list identity formatting.

---

## R03 — AI RPC authorization containment

### 1. Exact files/tables/functions affected

**Direct DB targets:** `ai_context(uuid)` execution ACL and guard; `v_ai_cash_accounts`, `v_ai_cash_movements`, `v_ai_revenue_invoices`, `v_ai_expense_docs`, `v_ai_kpis`, `v_ai_monthly_trend`; dependency review also covers `v_ai_overdue_invoices`, `v_ai_top_expenses`, `v_ai_top_customers`, `v_ai_customer_concentration`, `v_ai_upcoming_receivables`, `v_ai_upcoming_payables`, `v_ai_anomalies`.

**Definition locations:** `supabase/migrations/20260822000000_ai_data_views.sql`, `20260823000003_repair_ai_view_tenant_scope.sql`.

**Direct Edge target:** `supabase/functions/ai-chat/index.ts` (`resolveBusiness`, `buildDataContext`). **Consumers:** `src/lib/ai/context.ts` (`buildAssistantContext`, `fetchAiData`), `src/lib/ai/provider.ts`, `src/pages/AiInsightsPage.tsx`, `src/components/ai/Assistant.tsx`.

**Source tables read:** `businesses`, `business_users`, `accounts`, `journal_entries`, `journal_lines`, `invoices`, `expenses`, `contacts`, payment tables, `payroll_runs`, `tax_returns` as used by the view tree. No intended mutation of those financial tables.

### 2. Current behaviour

The SECURITY DEFINER RPC skips membership rejection when UID is null. Its migrations do not explicitly revoke PUBLIC execution. The Edge endpoint authenticates a JWT and validates active membership but retrieves full business financial context with a service-role client.

### 3. Vulnerability/defect

Under permissive/default function execution privileges, anonymous calls may obtain context; null UID is not proof of trusted service identity. Authenticated membership alone exposes data beyond cashier/payroll/branch permissions. Securing only the Edge URL leaves direct RPC access.

### 4. Proposed change

Explicitly restrict ACL/default exposure and authorize identity/role/tenant/scope at the actual data boundary. Keep trusted service calls explicit and narrow. Temporarily reject unauthorized-role contexts until R11's filtered contexts are ready. Treat view dependencies and alternate direct reads as part of the same boundary.

### 5. Database migration required?

**Yes:** function grants/guards and affected view definitions. No financial data migration. Do not drop/recreate views with CASCADE without reviewing dependent grants and definitions.

### 6. Risk of making the change

**High:** legitimate owner AI can stop loading; service-role context may return empty data; null/empty fallback can misleadingly look like zero revenue. Dependency recreation can drop grants or change view behavior.

### 7. Dependencies

R00 ACL verification; R01 protects platform role; R04 defines permitted finance/branch scopes. R03 containment precedes R11 enhancements and must not wait for them.

### 8. Tests to run before implementation

`src/lib/ai/__tests__/context.test.ts`, `provider.test.ts`, `fallback.test.ts`; `tests/database/view_reconstruction.test.js`; inspect `scripts/verify-ai-views.sql` before controlled use. Probe direct RPC as anonymous, A/B users and cashier, then the Edge endpoint with the same principals; establish owner/service-call baseline and populated versus genuinely empty businesses.

### 9. Tests to run after implementation

Denied direct/Edge calls return no restricted aggregates; owner remains correct; chosen service use is explicit; branch/payroll restrictions hold; hostile requested tenant cannot widen scope; revoked membership fails; no empty-context response masquerades as confirmed zero balances. Inspect effective ACLs after full migration replay.

### 10. Rollback procedure

Keep anonymous execution revoked and disable financial AI server-side if authorized contexts break. Restore a known-safe restricted implementation only; never restore null-UID trust. Retain view dependencies or forward-correct them rather than destructive cascade rollback.

### 11. Release blocker?

**Yes for exposed unsafe RPC/Edge paths, independent of whether AI is sold.** Full AI usefulness can wait if the backend surface is safely disabled.

### 12. Could it affect existing customer data?

Changes visibility, not intended financial records. Mis-scoping can expose data or remove access; that is material even without a row update.

### 13. Could existing functionality regress?

Yes: AI insights, owner context loading, local fallback, forecast inputs and other consumers of the view tree. Non-AI financial recording must remain available.

---

## R04 — Tenant/role/branch enforcement

### 1. Exact files/tables/functions affected

**Direct frontend contracts:** `src/hooks/usePermissions.ts`, `src/hooks/usePosPermissions.ts`, `src/types/pos.ts`, `src/components/rbac/PermissionGate.tsx`, `src/components/layout/navConfig.ts`, `src/App.tsx`. UI changes mirror server rules; they do not enforce security.

**Data consumers needing adaptation/regression:** `src/dal/repositories/BaseRepository.ts`, `InvoiceRepository.ts`, `ExpenseRepository.ts`, `InventoryRepository.ts`, `PosRepository.ts`, `BranchRepository.ts`, `FinancialStatementRepository.ts` (all under `src/dal/repositories/`); `src/components/reports/BranchPerformanceReport.tsx`; AI targets in R03/R11; API/export targets in R12/R14.

**DB functions:** `is_business_member`, `can_write_business_data`, `can_admin_business_data`, `can_write_sales_data`, `can_write_expense_data`, `can_operate_pos`, `user_has_role`, `can_view_payroll`, `can_write_payroll`, `can_read_audit`.

**Tables requiring policy/relationship review:** `business_users`, `branches`, `departments`, `contacts`, `accounts`, `invoices`, `invoice_lines`, `invoice_payments`, `expenses`, `expense_lines`, `expense_payments`, `journal_entries`, `journal_lines`, `products`, `product_categories`, `inventory_locations`, `inventory_balances`, `stock_movements`, `stock_transfers`, `stock_transfer_lines`, `pos_shifts`, `pos_cash_movements`, `pos_settings`, `bank_statements`, `bank_statement_lines`, `accounting_periods`, `budgets`, `budget_lines`, `tax_configurations`, `paye_bands`, `tax_returns`, `tax_payments`, `tax_alerts`, `loans`, `loan_repayments`, `share_transactions`, `fixed_assets`, `asset_categories`, `depreciation_schedules`, `employees`, `employee_allowances`, `employee_deductions`, `payroll_runs`, `payroll_employee_lines`, `audit_log`.

**Principal policy definition files:** migrations `20260708000000_tax_compliance_module.sql`, `20260723000000_capital_financing.sql`, `20260728000008_role_aware_master_data_rls.sql`, `20260728000009_role_aware_user_has_role.sql`, `20260815000003_phase8b_rls_policies.sql`, `20260920000000_pos_module.sql`, `20260922000000_pos_role_write_scope.sql` under `supabase/migrations/`. Final changed policies must be enumerated from R00; this list does not authorize rewriting them all.

### 2. Current behaviour

UI roles are more restrictive than membership-wide financial reads and broad writer policies. Older tax/capital policies permit member `FOR ALL` access. Optional branch membership does not make branch RLS. UUID FKs generally prove existence, not same-tenant ownership.

### 3. Vulnerability/defect

Cashiers can access sensitive costs/finance via direct data calls; nominal viewers can mutate some modules; branch isolation and approval promises can be bypassed. Mixed-tenant references can corrupt relationships even when a row's own business ID passes RLS.

### 4. Proposed change

Approve a minimal role/action/scope matrix, then implement explicit server read/write rules and safe projections. Validate tenant-qualified relationships. Define unassigned-branch visibility. Complete sale/payment/correction commands before closing the direct access old clients need; unsafe legacy modes remain contained, not represented as safe.

### 5. Database migration required?

**Yes:** policies, grants, helper functions and selected tenant-qualified constraints/indexes. New projections/scoped membership structures only if DEC-03 needs them. Legacy invalid references need a separately approved repair, not guessed relinking.

### 6. Risk of making the change

**High:** empty dropdowns, blocked posting, policy recursion, lost partner/platform support access and performance regressions from per-row membership checks. Correct restrictions will intentionally remove previously available but unauthorized actions.

### 7. Dependencies

R00/R01, DEC-03; coordinate R05–R08 trusted commands and R09 old clients. No cyclic big-bang requirement: design/prove scope first, switch commands, then narrow remaining writes.

### 8. Tests to run before implementation

`tests/database/rls_security.test.js`; `src/hooks/__tests__/usePermissions.test.ts`, `usePosPermissions.test.ts`, `rlsRoleParity.test.ts`; `src/lib/__tests__/rlsIsolation.test.ts`; team role tests. In P0, record every allowed/denied operation including direct writes, exports, product cost reads, branch filters, tax/capital writes and mixed-tenant references. Capture plans for representative list/report queries.

### 9. Tests to run after implementation

Every denied matrix cell fails through direct access; permitted workflows work end-to-end; safe projections omit sensitive columns rather than hiding them. Mixed-tenant references fail on inserts and updates. Branch reports/AI/export share scope. Test joins, memberships, platform/partner support, inactive users and unknown roles; compare latency/query plans.

### 10. Rollback procedure

Pause affected operation or restrict it to a verified safe authorized path. Forward-correct an overly restrictive policy; do not reinstate global member access. Leave additive columns/projections in place. Constraint rollback requires restoring an equivalent server validation boundary first; retain logs of repaired references.

### 11. Release blocker?

**Universal for tenant and role safety on reachable functions.** Branch/cashier completeness is conditional on those roles/features, but exposing their unsafe backend paths still blocks release.

### 12. Could it affect existing customer data?

Yes: visibility/write eligibility changes; new constraints can reject invalid historical relationships. Any historical relinking is high-risk customer-data work requiring R15. Ordinary policy changes should not rewrite amounts.

### 13. Could existing functionality regress?

Yes: almost every role-sensitive screen, lookup, report, export and posting workflow. Test legitimate least-privilege work, not only owner access.

---

## R05 — Financial command and database invariants

### 1. Exact files/tables/functions affected

**Direct targets:** `src/services/journalService.ts` (`postKeyedEntry`, invoice/expense receivable/settlement and payroll entry functions); `src/services/quickSaveService.ts`; `src/dal/repositories/JournalRepository.ts` (`createBalancedEntry`, `post`, `reverse`), `InvoiceRepository.ts`/`ExpenseRepository.ts` (document/payment creation), `PayrollRepository.ts`, `PeriodRepository.ts` (`lock`, `unlock`, period validation).

**Inspect/regression consumers:** `src/services/dataImportService.ts`, `src/offline/syncEngine.ts`, `src/services/CapitalJournalService.ts`, `FixedAssetsJournalService.ts`, `FxRevaluationService.ts`; `src/dal/repositories/TaxPaymentRepository.ts`, `TaxReturnRepository.ts`, `FinancialStatementRepository.ts`.

**DB objects:** `accounts`, `journal_entries`, `journal_lines`, `accounting_periods`, `invoices`, `invoice_lines`, `invoice_payments`, `expenses`, `expense_lines`, `expense_payments`, `payroll_runs`, `payroll_employee_lines`, `audit_log`; `save_quick_sale`, `save_quick_expense`, `_ledgr_post_entry`, `_ledgr_assert_account`, `_ledgr_account_by_code`, `increment_amount_paid`, `enforce_invoice_payment_allowed`, `enforce_expense_payment_allowed`, `reserve_next_document_number`, `next_journal_entry_number`, `log_manual_audit_event`. Shared POS and public API callers are covered by R06/R12.

**Definition files:** `20260911000001_quick_save_rpc.sql`, `20260911000002_quick_save_rpc_source_id_uuid.sql`, `20260921000000_journal_posting_key_idempotency.sql`, `20260813000001_fix_increment_amount_paid_backout.sql`, `20260813000002_block_payments_on_cancelled_documents.sql`, `20260817000000_phase10_amount_due_trigger.sql`, `20260815000000_phase8b_reconstruct_rpcs.sql` under `supabase/migrations/`.

### 2. Current behaviour

Double-entry validation, numbered documents, posting keys and several atomic RPCs exist. Other workflows use separate browser writes; comments assume universal deferred balance/immutability/period guarantees not established by the migration chain. Audit events are often client-triggered and failures can be swallowed.

### 3. Vulnerability/defect

Direct writes can evade application validation; partial documents/payments/journals can survive failures; posted/closed-period rules are not uniformly trusted. Duplicate replay or a misleading success can produce incorrect books despite a plausible screen.

### 4. Proposed change

Version verified database invariants; converge enabled workflows on authorized/idempotent commands, retaining existing arithmetic/contracts where correct. Derive actors server-side; validate monetary/account/period intent. Define required-effect completion and durable exception status. An idempotency key must be tied to the operation intent, not merely any existing document.

### 5. Database migration required?

**Yes:** trusted commands/guards, grants, state/uniqueness constraints and possibly operation/exception records (**new design pending**). Inventory of existing triggers comes first. Historical data correction is separate R15 work.

### 6. Risk of making the change

**Very high:** accidental double posting, blocking legitimate correction/period close, rounding/tax/FX changes, old client incompatibility and altered report inclusion. A balanced but incorrect journal is still incorrect.

### 7. Dependencies

R00, R01/R04 contracts, DEC-04/09, R13 fixtures, finance approval. Coordinates R06 inventory, R10 quota and R12 API paths.

### 8. Tests to run before implementation

`tests/database/workflow_accounting.test.js`, `posting_integrity_migrations.test.js`, `quick_save_rpc_source_uuid.test.js`, `phase10_integrity.test.js`; `src/services/__tests__/quickSaveService.test.ts`; repository tests `quickSaveRpc.test.ts`, `journalPostFastPath.test.ts`, `paymentGuard.test.ts`, `paymentReversal.test.ts`, `payrollApprovalTaxLinking.test.ts`, `idempotency.test.ts`, `reserveDocumentNumber.test.ts`. Use F0 to characterize each enabled path, direct forbidden mutation, failure between writes and concurrent same-key requests.

### 9. Tests to run after implementation

Clean replay enforces balance/period/state/tenant invariants; enabled invoice/expense/payment/payroll/manual journal flows produce approved journals; reversals preserve traceability; imports/offline/API cannot bypass rules. Inject failures at boundaries, retry identical and changed-intent keys, test quota interactions and compare financial statements/control totals before/after.

### 10. Rollback procedure

Pause affected writes; keep committed records and operation keys. Return only to a compatible known-safe command implementation. Do not undo a migration by deleting new journals/payments. Correct accepted effects through approved idempotent repair/reversal, preserving audit. Database restore is incident recovery only after reconciling later writes and external payment effects.

### 11. Release blocker?

**Yes, universal for every enabled financial workflow.** Optional workflows can be server-disabled, but the underlying ledger must remain reliable.

### 12. Could it affect existing customer data?

Yes, directly: ledger/document/payment balances and correction behavior. Changes should preserve valid historical amounts; any backfill/repair must have finance-approved before/after totals.

### 13. Could existing functionality regress?

Yes: income, expenses, invoicing, payments, payroll, capital/assets/tax postings, imports, period operations and statements. This is the broadest accounting regression surface.

---

## R06 — Inventory and POS sale integrity

### 1. Exact files/tables/functions affected

**Direct targets:** `src/services/posService.ts` (`normalizePosSale`, `buildPosSaleQueuePayload`, `commitPosSaleDocuments`, `commitPosSaleDocumentsLegacy`, `loadCommittedPosSale`); `src/services/posSaleRpc.ts` (`buildPosSaleRpcPayload`, `postPosSaleViaRpc`); `src/services/inventoryJournalService.ts` (`deductStockAndPostCogs`, `postCogsForSale`); `src/dal/repositories/InventoryRepository.ts` (`recordMovement`, `recordMovements`, `hasMovementsForSource`); `src/pages/PosPage.tsx` product/stock mapping.

**Regression consumers:** `src/services/inventoryValuation.ts`, `src/pages/InventoryPage.tsx`, `WarehousePage.tsx`, `TransfersPage.tsx`; `src/dal/repositories/TransferRepository.ts`; `src/offline/syncEngine.ts`.

**DB:** `products`, `inventory_locations`, `inventory_balances`, `stock_movements`, `stock_transfers`, `stock_transfer_lines`, sales/payment/journal tables from R05, `pos_shifts`; `post_pos_sale`, `can_operate_pos`, `_ledgr_complete_pos_sale`, `_ledgr_post_entry_keyed`, `_ledgr_resolve_sale_contact`, `_ledgr_stock_location`, `_ledgr_post_cogs`, `backfill_and_recalculate_inventory`. Actual balance updater name is **unknown until R00**; do not invent one or assume none is deployed.

**Evidence migrations:** `20260923000000_post_pos_sale_rpc.sql`, `20260911000001_quick_save_rpc.sql`, `20260730000005_fix_inventory_backfill_costing_and_authz.sql`, `20260817000001_phase10_nonneg_quantity_checks.sql` under `supabase/migrations/`.

### 2. Current behaviour

POS stores invoices/tenders/journals and stock movements. Weighted-average cost is used. Balance updating depends on an assumed trigger. Catalog shows 100 units per product. COGS failure is caught in the RPC; replay guarded by existing movements can skip missing COGS, while client RPC success returns no warnings.

### 3. Vulnerability/defect

Stock/GL drift, overselling based on fictitious availability, incomplete COGS repair and client-controlled pricing/attribution. An “atomic RPC” can still commit incomplete intended business effects when exceptions are swallowed.

### 4. Proposed change

Establish one versioned balance mechanism; use real location balances; validate sale/tender/discount/stock intent server-side. Record per-effect completion, not “any movement means finished.” Make missing cost/location/mapping outcomes explicit and recoverable. Preserve the common finance/inventory boundary rather than create a retail ledger.

### 5. Database migration required?

**Yes:** RPC corrections, authoritative balance update, associated locks/constraints/idempotency or completion state. Historical quantity/cost reconstruction is separately approved; do not invoke backfill as an installation step.

### 6. Risk of making the change

**Very high:** double stock updates, changed weighted-average valuation, purchase/transfer breakage, rejection of sales previously accepted, and cost changes affecting profit. Concurrent/backdated movements need explicit policy.

### 7. Dependencies

R00, R04/R05, DEC-04/07/09; R08 location/shift contract, R09 offline policy. R13 real PostgreSQL tests and finance reviewer.

### 8. Tests to run before implementation

`tests/database/pos_sale_rpc.test.js`, `workflow_accounting.test.js`; `src/services/__tests__/inventoryValuation.test.ts`, `posSalePostingIntegrity.test.ts`, `posSaleRpcPath.test.ts`, `posIntegration.test.ts`; `src/dal/repositories/__tests__/inventoryBackfill.test.ts`. F0 purchase/sale/transfer, missing trigger/location/cost/account, missing COGS replay, concurrency and nonstock service scenarios. Compare actual balances, not only returned sale ID.

### 9. Tests to run after implementation

Known stock/GL/COGS reconciles exactly once; receipt/transfer/manual movement paths still work; real stock display matches selected location; simultaneous final-unit sales follow policy; lost response/replay repairs missing effects without duplicates; split/credit/VAT/non-VAT/discount/tender mappings are correct; wrong-tenant product/shift/location rejected.

### 10. Rollback procedure

Stop stock-affecting writes if reconciliation fails. Preserve movements and before-state snapshots; disable the defective new updater only while a known-safe single updater is in place or stock writes are paused. Repair quantities/valuation via reviewed tenant-scoped reconciliation. Never run a blanket movement replay or restore stock counters without aligning GL effects.

### 11. Release blocker?

**Yes for inventory or POS use**, including existing customers dependent on accurate stock. Not a blocker for a genuinely nonstock finance release with unsafe stock surfaces disabled.

### 12. Could it affect existing customer data?

Yes: stock quantity, average cost, COGS and profit. Historical recalculation can change previous interpretations; it requires explicit approval and retained evidence.

### 13. Could existing functionality regress?

Yes: purchasing, warehouses/transfers, stock adjustments, nonstock services, ordinary invoice stock posting, POS and inventory/financial reports.

---

## R07 — Returns, voids and real approval

### 1. Exact files/tables/functions affected

**Direct targets:** `src/services/posService.ts` (`processReturn`, `processVoid`); `src/components/pos/PosManagerApprovalModal.tsx`; `src/pages/PosPage.tsx` (`handleManagerApproved` and return/void callbacks); `src/components/pos/PosSalesHistoryModal.tsx`; `src/hooks/usePosPermissions.ts`; `src/types/pos.ts` return/void/approval payloads.

**Shared consumers:** `src/dal/repositories/InvoiceRepository.ts`, `JournalRepository.ts` (`reverse`), `InventoryRepository.ts`, `PosRepository.ts`; `src/services/journalService.ts`, `inventoryJournalService.ts`.

**DB:** `invoices`/`credit_note_for`, `invoice_lines`, `invoice_payments`, `journal_entries` reversal/posting links, `journal_lines`, `stock_movements`, `inventory_balances`, `pos_shifts`, `pos_cash_movements`, `pos_settings`, `audit_log`; `chk_invoice_lines_quantity_nonneg`, payment guards and shared posting helpers. **New server return/void/approval commands and approval/return-allocation state: design pending, not existing RPCs.**

### 2. Current behaviour

Manager modal validates only PIN length and its callback ignores the PIN. Refunds write negative quantities against a nonnegative constraint, fix currency to MWK and VAT to zero, restock at selling price, and lack complete refund/COGS/payment reversal. Voids reverse only part of the sale lifecycle and catch failures.

### 3. Vulnerability/defect

False authorization, blocked/orphaned credit workflows, over-return/repeat-effect risk, wrong tax/FX/cost and inconsistent cash/stock/ledger outcomes.

### 4. Proposed change

Authenticate/authorize approval server-side and bind it to exact intent, tenant, approver and lifetime. Create idempotent return/void commands with cumulative return limits, original cost/tax/FX treatment and complete linked effects. Represent credit direction intentionally; do not remove quantity safeguards merely to accept existing payloads.

### 5. Database migration required?

**Yes** for trusted commands/permissions and durable operation/approval/allocation records as selected. Retain original transaction links; no destructive replacement of past sales.

### 6. Risk of making the change

**Very high:** double refunds, incorrect tax returns, restoration of too much stock, mistreatment of unpaid cancellations, breaking corrections to older sales with incomplete metadata.

### 7. Dependencies

R04–R06, DEC-03/04, R08 drawer effects, R09 offline compatibility. Finance must approve refund/cancellation semantics. A safe authorized support correction path is required even if self-service is deferred.

### 8. Tests to run before implementation

`src/services/__tests__/posService.test.ts`, `posIntegration.test.ts`, `posSalePostingIntegrity.test.ts`; `src/dal/repositories/__tests__/paymentReversal.test.ts`, `paymentGuard.test.ts`; DB quantity/payment constraints. Reproduce ignored PIN, credit-note quantity failure, partial/full/repeated refund and partial void on F0, comparing every effect.

### 9. Tests to run after implementation

Invalid/stale/replayed/cross-tenant approvals denied; valid approval audited. Full/partial/multiple returns cannot exceed eligible quantity/paid amount; VAT/FX/original-cost reversals correct; repeated/lost-response commands have one effect; unpaid cancel differs from cash refund; COGS/tenders/stock/drawer reconcile; correction of legacy sales has an explicit path.

### 10. Rollback procedure

Disable correction actions if necessary while retaining a tested restricted support process. Keep executed approvals/credit notes/reversals. Use compensating accounting corrections for mistakes; do not delete refunds or re-enable fake PIN approval. An external money refund cannot be reversed by database rollback.

### 11. Release blocker?

**Yes for sold POS correction capability.** Self-service may stay disabled, but POS cannot responsibly launch without a safe way to correct genuine sales errors.

### 12. Could it affect existing customer data?

Yes: previous invoices, tax, settlements, stock, costs and shift balances. Existing credit notes need review rather than automatic reinterpretation.

### 13. Could existing functionality regress?

Yes: sales history, discounts/approval prompts, journal reversal, payments on voided documents, stock returns and tax reports.

---

## R08 — POS branch, terminal and shift reporting

### 1. Exact files/tables/functions affected

**Direct targets:** `src/pages/PosPage.tsx` (`branchId`, register state, sale-history mapping); `src/dal/repositories/PosRepository.ts` (`openShift`, `closeShift`, `updateShiftTotals`, `recordCashMovement`, shift queries); `src/dal/repositories/InvoiceRepository.ts` (`LIST_SELECT`, `findByBusiness` consumer contract); `src/services/posReportService.ts` (`generateZReportSummary`); `src/components/pos/PosHeader.tsx`, `PosShiftModal.tsx`, `PosCashMovementModal.tsx`, `PosSalesHistoryModal.tsx`, `PosZReportModal.tsx`, `PosOwnerAnalytics.tsx`; `src/types/pos.ts`.

**DB:** `branches`, `inventory_locations`, `business_users.branch_id`, `pos_shifts`, `pos_cash_movements`, `invoices`, `invoice_payments`, `journal_entries`; `post_pos_sale` shift association/totals. Definition: `supabase/migrations/20260920000000_pos_module.sql`, `20260923000000_post_pos_sale_rpc.sql`.

**New, design pending:** minimal durable terminal identity and POS sale→shift/channel metadata plus immutable close/late-adjustment representation. A dedicated POS extension table versus optional invoice metadata is not yet decided.

### 2. Current behaviour

Active POS branch is null, register identity is UI state, history is the latest 30 business invoices and uses fields omitted by its slim projection. Shift updates mix SQL increments and browser read-modify-write. Noncash Z-report breakdown is incomplete; sales lack durable shift linkage.

### 3. Vulnerability/defect

Wrong location/branch attribution, unrelated/missing sales in closes, lost concurrent drawer updates, unreliable cashier/terminal ownership and reports that cannot substantiate a signed close.

### 4. Proposed change

Bind till to real branch/location and durable minimum terminal context; persist sale-channel/shift links; enforce open-shift policy. Query complete authorized sale/tender data for history/close; preserve closed snapshots and append late adjustments. Do not force non-POS invoices into a shift.

### 5. Database migration required?

**Yes:** additive linkage/terminal/close records or fields, tenant-qualified constraints, indexes, shift uniqueness and updated posting commands. Historical ambiguous links must remain explicitly unassigned until verified.

### 6. Risk of making the change

**High:** duplicate/open-shift conflicts, unassigned sales disappearing from reports, changed cash expectations, unsupported old queued payloads and incorrect backfills based on names/timestamps.

### 7. Dependencies

R04/R06/R07, DEC-03/08/09, R09 late/offline arrivals. Initial single-terminal scope can simplify implementation but not remove trustworthy shift association.

### 8. Tests to run before implementation

`src/dal/repositories/__tests__/posRepository.test.ts`; `src/services/__tests__/posHardwareAndReports.test.ts`, `posIntegration.test.ts`; `src/lib/__tests__/branchPerformance.test.ts`. Fixtures with >30 sales, ordinary invoices, two shifts/cashiers, mixed tenders, cash movements, closed-shift arrivals; compare close to raw underlying records.

### 9. Tests to run after implementation

Correct branch inventory posting; safe cashier/manager visibility; full pagination/aggregates; per-method totals and opening/cash-in/cash-out/refund arithmetic; concurrent shift/cash updates; duplicate open/close; restart; late sale adjustment; non-POS invoice exclusion. Receipt printing and barcode helpers remain functional.

### 10. Rollback procedure

Pause opening/closing or affected sale intake if context is unsafe. Preserve new linkage/close records; return to a known-safe report or mark reporting unavailable rather than reuse the incomplete 30-row calculation. Correct erroneous attribution through audited adjustments, never guess a historical shift or rewrite signed closes silently.

### 11. Release blocker?

**Yes for POS/shift reporting and branch-scoped promises.** Not inherently for non-POS finance with those surfaces disabled.

### 12. Could it affect existing customer data?

Yes: attribution, drawer totals and close reports. Valid finance records should be preserved. Migration can expose previously unassigned transactions rather than silently allocating them.

### 13. Could existing functionality regress?

Yes: POS startup, shift opening/closing, history/receipts, branch analytics, permissions and old offline sale replay.

---

## R09 — Cache, queue and offline recovery

### 1. Exact files/tables/functions affected

**Direct targets:** `vite.config.ts` (Workbox runtime cache rules), `public/sw-events.js`, `src/main.tsx` logout cleanup, `src/hooks/useAuthListener.ts` (`purgeAllUserData`), `src/lib/queryPersister.ts` (`createIDBPersister`, `clearPersistedCache`), `src/lib/queryClient.ts`; `src/offline/db.ts`, `payloads.ts`, `queueApi.ts` (`enqueue`, `recoverStaleSyncClaims`, pruning), `syncEngine.ts` (`syncQueue`, `syncItem`), `legacyPosQueue.ts` (`migrateLegacyPosQueue`), `OfflineSyncProvider.tsx`, `registerServiceWorker.ts`, `backgroundSync.ts`; `src/hooks/useSyncQueue.ts`, `useOfflineQueue.ts`; `src/components/layout/OfflineQueueDrawer.tsx`.

**Local stores:** IndexedDB `ledgr-offline.queue`, `ledgr-rq-cache.cache`; Workbox `ledgr-api-cache` and relevant static/shell caches; legacy `ledgr_pos_offline_queue`; form draft/session storage. **Server consumers:** commands/tables in R05–R08/R10 for invoices, expenses, payments, payroll and stock; no global server table named “offline queue” is established by the current implementation.

### 2. Current behaviour

Queue is tenant-tagged but not authenticated-originator-bound. Replay selects all pending/failed items; in-memory guard does not provide cross-tab exclusion. Logout clears some query/draft state but not the full HTTP cache/semantic queue. Background sync wakes open clients. Legacy payload recovery and idempotency already exist.

### 3. Vulnerability/defect

Shared-device confidential data persistence, wrong-current-user replay, duplicate side effects under concurrent tabs, incomplete conflict handling and accepted offline sales stranded by quota/shift/stock changes. Clearing storage to fix it would lose business records.

### 4. Proposed change

Partition/invalidate every relevant cache by authorized identity/scope; reconsider sensitive HTTP caching. Add originator/device/payload-version provenance, explicit recovery for ambiguous legacy items, safe cross-tab claims and ownership-aware UI/replay. Server must reauthorize replay and derive the executing actor; local metadata is not authority. Apply accepted offline stock/quota/late-close policy.

### 5. Database migration required?

**Yes locally:** versioned Dexie queue/cache migration. **Server migration conditional:** R05/R08 command/terminal/provenance records may supply required persistence; additional recovery state only if approved. Preserve queue IDs/client keys; do not recreate the local DB empty.

### 6. Risk of making the change

**Very high:** irreversible loss of unsynced sales, migration failure on old browsers, repeated operations, forced logouts with inaccessible queues, degraded offline startup and stale-cache privacy leaks.

### 7. Dependencies

R01/R04 identity/scope; R05–R08 replay-safe commands; R10 quota; DEC-06/07/08/09. Cache containment can proceed before complete offline enhancement. R14 recovery instructions required.

### 8. Tests to run before implementation

`src/offline/__tests__/offlineQueue.test.ts`, `legacyPosQueue.test.ts`, `posSaleSync.test.ts`, `backgroundSync.test.ts`; `src/services/__tests__/posSaleOfflineSync.test.ts`; `src/lib/__tests__/queryInvalidation.test.ts`, `chunkRecovery.test.ts`; relevant `browserHooks.test.tsx`. Browser probes: warm/cold cache, explicit logout/session expiry/user/role switch, two tabs, server commit followed by killed tab, old queue payload and unavailable storage. Use disposable local profiles, not customer devices.

### 9. Tests to run after implementation

Forbidden prior-user data inaccessible through all cache layers; queue preserved but access-controlled; cross-tab claim/recovery safe; identity changes quarantine inappropriate replay; stale claims recover; original keys survive app/DB upgrade. Test last-stock-unit offline conflict, quota/expiry/closed-shift boundary, dependency order, browser eviction warning/recovery and no open-client background-sync limitation.

### 10. Rollback procedure

Pause auto-sync on the affected build and preserve local stores. Use a forward-compatible reader/recovery release rather than downgrading Dexie destructively. Export/quarantine queue evidence through an approved private support process. Roll back only to a cache-safe compatible client; never bulk-delete IndexedDB or replay unverified payloads under the next signed-in user.

### 11. Release blocker?

**Cache confidentiality: yes wherever active. Offline capture: yes if sold/enabled or existing queues need recovery.** Finance-only online release still needs safe cached-data handling.

### 12. Could it affect existing customer data?

Yes, especially records that exist **only on a customer's device** and are not in server backups. Privacy and queue-retention risks are direct customer-data risks.

### 13. Could existing functionality regress?

Yes: PWA startup/update, cached browsing, login/logout, business switching, form drafts, connectivity recovery and every queued operation type.

---

## R10 — Subscription, payments and metering

### 1. Exact files/tables/functions affected

**Direct targets:** `src/lib/billing/plans.ts`, `UsageService.ts`; `src/hooks/useUsage.ts`; `src/services/billing/SubscriptionPaymentService.ts`; `supabase/functions/initiate-subscription-payment/index.ts`, `paychangu-webhook/index.ts`, `verify-subscription-payment/index.ts`, `grant-manual-subscription/index.ts`, `expire-subscriptions/index.ts`, `send-renewal-reminders/index.ts`.

**Consumers to align:** `src/components/billing/BillingTab.tsx`, `CheckoutModal.tsx`, `UsageMeter.tsx`, `PlanGate.tsx`; `src/routes/PlanGuard.tsx`; `src/components/layout/navConfig.ts`; R11/R12 backend capabilities. Existing `src/hooks/usePaymentReturnStatus.ts` and `useRenewalReminder.ts` need regression coverage.

**DB:** `businesses.plan_tier`, `plan_expires_at`, `plan_updated_at`; `subscription_payments`, `subscription_reminders_sent`; document tables counted for usage; `apply_subscription_payment`, `enforce_plan_tier_change`, `plan_tier_rank`, `_ledgr_assert_usage_limit`, `ledgr_monthly_document_count`. Evidence migrations: `20260726000002_subscription_payments.sql`, `20260919000000_add_starter_plan.sql`, `20260921000001_usage_limit_counts_documents.sql`, `20260921000002_usage_document_count_rpc.sql` under `supabase/migrations/`.

**New, design pending:** shared effective-entitlement helper and durable organisation-period usage/reservation contract. Existing partner commercial rules must be included if partner plans are in the release scope, not silently overridden by the direct-plan catalogue.

### 2. Current behaviour

Business plans/payment activation exist and raising tier is guarded. Expiry remains broadly editable; effective access generally trusts tier/cron. Quota checks count document dates from month start with no upper bound and are not universal/serialized. UI gates are stronger than backend feature checks. Verification does not compare expected amount/currency and has problematic failure handling.

### 3. Vulnerability/defect

Paid access bypass, manipulated expiry, concurrent quota overshoot, backdate/future-date miscount, inconsistent advertised features and legitimate payments/accepted offline records stranded by failure paths.

### 4. Proposed change

Protect all commercial state; retain restricted paid/manual grants. Define and centralize effective entitlement and DEC-05 metering across trusted paths. Verify amount/currency/reference/provider result with recoverable transient failures. Make offline recovery bounded and authorized rather than trusting client timestamps. Align catalogue/UI/messages without repricing.

### 5. Database migration required?

**Yes:** guards, entitlement/count/consumption functions, concurrency-safe usage state and possible payment lifecycle refinements. Existing successful payments must not be re-applied or usage recounted as new events during migration.

### 6. Risk of making the change

**High:** customers unexpectedly downgraded/blocked, duplicate subscription extension, double charging if checkout retries are mishandled, inconsistent partner contracts and changed quota semantics mid-month.

### 7. Dependencies

R01 privileged administration, R05 canonical commands, DEC-05/06, R09 recovery, R14 schedules/alerts. Product must approve treatment of current subscriptions and usage before rollout.

### 8. Tests to run before implementation

`src/lib/billing/__tests__/plans.test.ts`, `usageGuard.test.ts`; `src/components/billing/__tests__/PlanGate.test.tsx`; usage-related database/POS tests. Controlled provider sandbox/mocked server scenarios: success/pending/failure/timeout, wrong amount/currency, duplicate/out-of-order callbacks, existing manual grants, direct expiry update, missed cron, concurrent quota-boundary saves, date/lifecycle edges and old client offline replay.

### 9. Tests to run after implementation

Commercial edits denied; authorized grants remain auditable; exact verified payment activates intended plan once; transient failures recover; expiry is correct without timely cron. Organisation quota handles concurrent channels and retries per approved policy, bounded dates/timezone and all selected document types. Paid backend capabilities enforce the same entitlement; partner/legacy paid accounts retain approved terms.

### 10. Rollback procedure

Stop new checkout initiation if unsafe while retaining verified-payment reconciliation; do not disable a working callback blindly or issue duplicate charges. Freeze disputed entitlement changes and use audited support grants where authorized. Preserve payment/usage event IDs; forward-correct counters/expiry from verified records. Never restore self-editable commercial fields or reset counters to zero as rollback.

### 11. Release blocker?

**Yes for paid production release.** A fair, documented temporary quota policy can be approved, but billing state manipulation and false paid activation cannot be waived.

### 12. Could it affect existing customer data?

Yes: subscription access, expiry, usage history and payment outcomes. It must not mutate customers' accounting records to enforce a commercial cap.

### 13. Could existing functionality regress?

Yes: checkout/return verification, manual subscriptions, renewal notices, expiry, usage meter, plan-gated pages, API/AI and offline sales at boundaries.

---

## R11 — Permission-aware AI and metric consistency

### 1. Exact files/tables/functions affected

**Direct targets:** `src/lib/ai/context.ts` (`buildAssistantContext`, `fetchAiData`, `normaliseAiData`), `provider.ts` (`getProvider`, `remoteProvider`, `rulesProvider`, `buildSystemPrompt`), `types.ts`, `forecast.ts` (`forecast`), `advisor.ts` (`advise`), `format.ts`; `supabase/functions/ai-chat/index.ts` (`buildDataContext`, `buildForecast`, `buildAdvice`, `buildSystemPrompt`, `checkRateLimit`, `callProvider`).

**Consumers/adjacent AI:** `src/components/ai/Assistant.tsx`, `src/pages/AiInsightsPage.tsx`, `src/lib/supportAgent.ts`; `supabase/functions/support-agent/index.ts`, `suggest-bank-matches/index.ts`. Metrics to compare: `src/dal/repositories/FinancialStatementRepository.ts`, `src/hooks/useDashboardData.ts`, `src/lib/branchPerformance.ts`, `revenueBreakdown.ts`.

**DB:** R03's full named AI view tree/`ai_context`; `ai_insights_usage`, `support_agent_usage`; new scope-aware usage/provenance records/functions **design pending**. Financial source tables remain read sources, not model-write targets.

### 2. Current behaviour

Fixed-context LLM and local rules/providers exist; finance calculations are partly duplicated between SQL/client/Edge. Broad context is not role-scoped, AI revenue/profit basis can differ from GL, prompts impose MK formatting and usage counters are race-prone per-user minute buckets. No durable answer/source/prompt-version audit exists.

### 3. Vulnerability/defect

Forbidden summaries, inconsistent financial advice, incorrectly labeled currency, weak cost control and inability to explain/reproduce what data an answer used. Prompt instructions cannot substitute for access control or correct metrics.

### 4. Proposed change

After R03 containment, provide only authorized contexts; reuse defined metric/calculation contracts, expose basis/as-of/currency/assumptions, and clearly label interpretation. Add minimal privacy-aware provenance and organisation cost control. Keep advisory/read-only behavior; no new autonomous agent framework or unrestricted database tools.

### 5. Database migration required?

**Yes for full package:** scoped view/RPC definitions and metering/provenance persistence. Prompt/formatting fixes alone do not require schema changes. No financial source-data rewrite.

### 6. Risk of making the change

**Medium–high:** previously familiar answers change, owners get incomplete context, fallback uses stale data, cost limits block legitimate use, or provenance logging stores more sensitive data than necessary.

### 7. Dependencies

R03, R04, R05/F0 metric integrity, R10 entitlements, R14 retention/logging. No need to delay unrelated finance release for enhanced AI if its unsafe surfaces are disabled.

### 8. Tests to run before implementation

All five existing suites under `src/lib/ai/__tests__/`: `context.test.ts`, `provider.test.ts`, `fallback.test.ts`, `forecast.test.ts`, `advisor.test.ts`; statement/branch/revenue suites. Compare GL profit, document sales and cash on F0 including journals, depreciation, COGS, credits, FX and empty data. Probe branch/payroll/cashier questions, concurrent rate usage and provider failure without live customer data.

### 9. Tests to run after implementation

Unauthorized facts cannot enter the context via any route; cross-question inference cannot reveal excluded aggregates. Named metrics match their source basis; forecasts show assumptions; currency/as-of/staleness accurate. Multi-user org cost cap works; provider failure has safe local/no-data behavior; provenance sufficient for support but redacted/retained appropriately; no model mutation capability.

### 10. Rollback procedure

Disable remote financial AI or revert to a verified safe deterministic context/response path. Keep R03/R04 restrictions. Retain metering/provenance records under policy; do not erase spending evidence. Do not fall back to a broader full-tenant context to make answers work again.

### 11. Release blocker?

**Conditional on financial AI being enabled or promised.** R03 security containment remains mandatory regardless of marketing.

### 12. Could it affect existing customer data?

No intended accounting mutations. Yes to disclosure/retention of customer data in provider requests or provenance, and to visibility/cost records. Handle provider data policy explicitly.

### 13. Could existing functionality regress?

Yes: AI insights/forecasting, local rules, support fallback and bank-match suggestions, as well as report consistency if shared calculations are changed.

---

## R12 — Public API and trusted webhooks

### 1. Exact files/tables/functions affected

**Direct targets:** `supabase/functions/api/index.ts` (`authenticate`, `checkRateLimit`, routing, list handling, `deliverWebhooks`, `openApiSpec`); `supabase/functions/create-api-key/index.ts`; `supabase/functions/webhook-dispatcher/index.ts` (`assertMember`, `deliverWebhooks`); `supabase/functions/retry-failed-webhooks/index.ts`; `src/services/api/ApiKeyService.ts`; `src/services/webhook/WebhookService.ts`, `webhook-triggers.ts`; `supabase/functions/api/webhook-triggers.ts`; `public/openapi.json`.

**Consumers:** `server/src/index.ts` rate limit/proxy path; `src/pages/ApiKeysPage.tsx`, `ApiDocumentationPage.tsx`, `ZapierIntegrationPage.tsx`; `src/components/settings/WebhookSettings.tsx`; `zapier/index.js`; invoice/expense repository webhook calls.

**DB:** `api_keys`, `api_usage`, `webhooks`, `webhook_deliveries`, `consume_api_rate_limit`, `create_api_journal_entry`; existing API read tables `invoices`, `expenses`, `accounts`, `journal_entries`; `journal_lines` for creation. Evidence: `supabase/migrations/20260727000001_public_api_webhooks.sql`, `20260730000002_harden_webhook_secrets.sql`, `20260730000003_atomic_api_rate_limit_and_journals.sql`, `20260815000005_phase8b_fix_api_journal_reconciled.sql`. **New transactional event outbox/scoped-key metadata: design pending.**

### 2. Current behaviour

Tenant-bound hashed/revocable keys, strict journal input and rate limiting exist. Invoice/expense POST routes are advertised but disabled. Lists lack explicit pagination contract. Paid/scoped access is incomplete. Any active member can submit an allowed event with arbitrary payload for signing; delivery/retry implementations diverge and service-role retry does not match dispatcher user-membership authentication.

### 3. Vulnerability/defect

Excessive integration access, incomplete extracts, duplicate writes on retry, signed fabricated financial events, missing post-commit events and broken/repeated retries. Shared IP throttling can defeat the advertised authenticated limit.

### 4. Proposed change

Align docs to supported endpoints; add required resource/action/scope entitlements and retry/pagination contracts. Use R05 trusted commands. Emit stable authoritative events from committed server operations into a small durable outbox; consolidate authorized dispatch/completion/deduplication. Preserve signature and destination controls.

### 5. Database migration required?

**Yes for full package:** scoped key/usage metadata, event/outbox state and updated trusted commands/grants. Honest docs or endpoint containment can be done without schema change.

### 6. Risk of making the change

**High:** breaking external clients/Zapier, changing response/pagination/signature expectations, dropped or duplicated business events, invalidating existing keys and excessive delivery load during catch-up.

### 7. Dependencies

R04/R05, R10 paid access, R14 job monitoring. Agree version/backward-compatibility and receiver deduplication before cutover. Subscription PayChangu callbacks are separate from customer webhooks and must not be disabled accidentally.

### 8. Tests to run before implementation

`tests/database/workflow_accounting.test.js`, `rpc_reconstruction.test.js`, `rls_security.test.js`; gateway baseline. New scenario probes (no comprehensive existing API/Edge suite established): valid/revoked/free/expired keys, A/B tenancy, disabled POST behavior, >default-row-limit extraction, duplicate journal request, forged browser event, webhook timeout/private destination/redirect, service-role retry and multiple users behind one IP.

### 9. Tests to run after implementation

Scope/entitlement/revocation enforced; complete stable pagination; same-key write safe; docs reflect actual behavior. Fabricated events cannot be signed as authoritative; commit→outbox survives crash; delivery retries have stable IDs/completion and authorize correctly; receiver sees supported signature/event contract; SSRF protections hold; gateway cannot widen backend authority.

### 10. Rollback procedure

Pause optional API mutations/dispatch, preserve keys/event/outbox/delivery IDs and drain only through known-safe delivery. Restore a compatible safe read contract if possible; do not re-enable arbitrary browser-signed events. Reconcile recipient acknowledgments before redelivery. Retain existing key revocations and payment callbacks.

### 11. Release blocker?

**Conditional:** integrations enabled/contracted/used by current customers. Otherwise prove server containment and remove unsupported promises; do not mistake UI hiding for API shutdown.

### 12. Could it affect existing customer data?

Yes: API-created journals, external downstream actions, extracts and signed events. A duplicated webhook can trigger external effects that cannot be undone by deleting its local delivery row.

### 13. Could existing functionality regress?

Yes: existing API consumers, Zapier, webhook settings, invoice/expense event delivery, gateway behavior and integration reports.

---

## R13 — Reproducible release test harness

### 1. Exact files/tables/functions affected

**Direct targets:** `package.json`, `package-lock.json` only if approved test dependencies are needed, `vitest.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`; existing standalone files `tests/database/rls_security.test.js`, `rpc_reconstruction.test.js`, `storage_reconstruction.test.js`, `view_reconstruction.test.js`, `workflow_accounting.test.js`, `pos_sale_rpc.test.js`, `posting_integrity_migrations.test.js`, `quick_save_rpc_source_uuid.test.js`, `phase10_integrity.test.js`, `phase10_remediation.test.js`, `phase10_2_subtype_repair.test.js`, `paye_reference.test.js`.

**Related configuration:** `server/package.json`, `server/package-lock.json`, `server/tsconfig.json`, `supabase/config.toml`; unit tests named in R01–R12; `scripts/load/k6-smoke.js` if enabled for measured load checks.

**DB:** disposable `public`, test `auth`/`storage`, roles and migration fixtures; functions under test from R01–R12. New fixture/runner/Edge/browser regression test files are **proposed, paths to be approved**, not present implementations.

### 2. Current behaviour

Root Vitest includes only `src/**/*.test.ts(x)`. Database tests depend on a separate CommonJS/embedded-Postgres setup, fixed filesystem paths and dependencies not declared in root tooling; they are not a routine release gate. Mock tests do not establish real RLS/transaction semantics.

### 3. Vulnerability/defect

False confidence from passing CI; security/posting regressions can deploy without actual-role/database tests. Nonportable setup makes evidence difficult to reproduce and dangerous if aimed at the wrong database.

### 4. Proposed change

Make the existing valuable tests portable, isolate destructive fixtures, include clean replay and real-role security/posting tests in required checks, and add missing targeted browser/Edge failure scenarios. Match production privilege assumptions explicitly rather than silently grant every role everything in test setup.

### 5. Database migration required?

**No production migration inherently.** Test fixture DDL is required in disposable environments. Product migrations discovered missing belong to their owning remediation package, not hidden in a test bootstrap.

### 6. Risk of making the change

**Medium:** slow/flaky CI, fixture contamination, silently weakened assertions and destructive cleanup aimed at non-test data. Workflow edits can deploy without intended gate if dependency configuration is wrong.

### 7. Dependencies

R00 environment baseline; security/finance expected invariants from R01–R12. Start harness work early; individual test cases evolve with approved contracts.

### 8. Tests to run before implementation

Record B0 failures/suite discovery; inspect current DB runner dependencies, fixed ports/directories and role stubs. Verify which CI jobs actually block deployment. Attempt existing harness only in an explicitly disposable environment after setup review; do not claim failed setup means application tests passed.

### 9. Tests to run after implementation

Clean agent reproduces suites with declared tooling; jobs fail on intentionally violated security/accounting fixtures; all expected suites are discovered; concurrent jobs cannot share destructive state; CI/deploy refuses failed required checks; actual anonymous/authenticated/service cases are distinct. Record supported Postgres/runtime versions and elapsed resources.

### 10. Rollback procedure

Pause deployment if the new harness breaks; repair or use the last verified manual gate temporarily with explicit sign-off. Do not remove failing security checks merely to ship. Clean only positively identified disposable databases/directories; no customer-data restoration should be necessary.

### 11. Release blocker?

**Yes for repeatable production-readiness evidence.** Optional broad browser/load coverage can grow later; core tenant/security/posting/replay gates cannot be omitted.

### 12. Could it affect existing customer data?

Not by design. Very high impact if misconfigured test cleanup targets real databases; isolation/target assertion is mandatory.

### 13. Could existing functionality regress?

Indirectly: dependency/runtime changes can break builds, test exclusions can hide regressions, deployment workflow changes can release unverified code. No business behavior should be changed solely for harness convenience.

---

## R14 — Restore, observability and scheduled jobs

### 1. Exact files/tables/functions affected

**Direct operational targets:** `scripts/verify-backup.sh`, `scripts/synthetic-check.sh`, `scripts/cron-jobs.sql`; `.github/workflows/backup-verify.yml`, `deploy.yml`; `src/lib/logger.ts`, `errorCapture.ts`, `notifications.ts`; `server/src/logger.ts`, `server/src/index.ts`. Call-site instrumentation in R05–R12 is reviewed, not a blanket rewrite of logging.

**Job implementations:** `supabase/functions/expire-subscriptions/index.ts`, `send-renewal-reminders/index.ts`, `generate-partner-invoices/index.ts`, `generate-vat-returns/index.ts`, `process-invoice-automation/index.ts`, `retry-failed-webhooks/index.ts`, `finalize-account-deletions/index.ts`. Related delivery/export/lifecycle: `send-invoice/index.ts`, `export-my-data/index.ts`, `request-account-deletion/index.ts`, `cancel-account-deletion/index.ts`, all under `supabase/functions/`.

**Definition files:** `supabase/migrations/20260726000003_schedule_expire_subscriptions.sql`, `20260726000005_schedule_send_renewal_reminders.sql`, `20260727000006_schedule_generate_partner_invoices.sql`, `20260820000000_ops_hardening_runtime.sql`; `src/services/dataBackupService.ts` is a customer export, not the operational restore mechanism.

**DB/storage:** `cron.job` and available run history; `businesses`, `subscription_payments`, `subscription_reminders_sent`, `partner_invoices`, `tax_returns`, `tax_alerts`, `recurring_invoices`, `invoice_delivery_events`, `invoices`/`invoice_lines`, `webhook_deliveries`, `webhooks`, `user_profiles`, `audit_log`; backup of all required public objects plus explicit Auth/Storage recovery arrangements. Storage buckets `business-logos` and `user-exports`; object contents are not restored by a public-schema SQL dump.

### 2. Current behaviour

Jobs, loggers and a backup check exist, but some schedules contain placeholders and runtime success is unverified. Recurring invoice processing is incomplete; webhook retry auth mismatches dispatcher. `verify-backup.sh` dumps `public` without ownership/privileges, compares selected row counts, and can fall back past restore errors. It does not by itself prove Auth/Storage/ACL recovery or point-in-time financial equivalence.

### 3. Vulnerability/defect

Silent expiry/delivery/automation failures; misleading backup confidence; inability to restore user access/permissions/files; logging may leak tokens/data. Comparing live row counts after a dump can also mismatch simply because production continued writing, not because backup is corrupt.

### 4. Proposed change

Verify actual schedules/secrets by presence and successful invocation; fail visibly on required job/restore errors; distinguish recoverable warnings from missing objects. Compare consistent-snapshot evidence and business control totals, not only later live counts. Define complete Auth/Storage/configuration recovery and RTO/RPO; instrument incomplete operations and owner alerts. Complete optional automation or disable it without losing pending work.

### 5. Database migration required?

**Conditional:** schedule changes and durable job/audit/exception records may require forward SQL migrations; logging/workflow/restore-runbook changes do not inherently require schema changes. Never commit live cron secrets into migrations. R12 owns event delivery state; avoid duplicate job frameworks.

### 6. Risk of making the change

**High:** heavy backups affect availability; mistaken restore target destroys live state; schedules duplicate invoices/notifications; deletion jobs can irreversibly remove access/data; verbose telemetry exposes financial records or credentials.

### 7. Dependencies

R00, DEC-10, R05/R10/R12 operation contracts, R13 isolated restore/testing, named support/on-call owner. Broad recovery evidence precedes SLA claims.

### 8. Tests to run before implementation

Review script flags/targets without executing them against production. Disposable restore of approved sample backup: enumerate missing grants/Auth/Storage/objects and accounting control totals. Provider/job sandbox probes for duplicate invocation, timeout and missing secret. `server/src/__tests__/logger.test.ts`, `src/lib/__tests__/logger.test.ts`; existing database storage reconstruction tests. Confirm alert destinations and log redaction.

### 9. Tests to run after implementation

Disposable full recovery demonstrates login/access, required objects/policies, document/ledger/stock balances and file availability/recovery procedure within agreed objectives. Inject restore/job failures and prove nonzero failure/alert; repeated jobs do not duplicate effects; recurrent invoices include correct lines/lifecycle; actual reminder delivery evidenced; deletion cancellation/grace/retention respected. Public customer exports are not advertised as complete backups.

### 10. Rollback procedure

Disable a newly broken schedule, preserve queued work and restore the last known-safe schedule only after duplicate-run checks. Pause deletion/recurring-write jobs immediately on unintended effects. Restore logging configuration without removing security/error visibility. Never point a test restore at production; any genuine production restore is a separately approved incident action with post-restore external-payment/offline reconciliation.

### 11. Release blocker?

**Yes for backup/recovery, critical billing jobs and actionable monitoring.** Optional recurring/email/webhook automation can remain safely disabled. Customer deletion must still have a compliant supported procedure rather than silently ignored requests.

### 12. Could it affect existing customer data?

Yes: job-generated records, entitlement changes, deletion, backup privacy and restored state. This is operational data processing, not just configuration polish.

### 13. Could existing functionality regress?

Yes: billing expiry/reminders, partner billing, tax generation, recurring invoices, exports, account deletion, notifications, gateway health and observability.

---

## R15 — Historical reconciliation and controlled pilot

### 1. Exact files/tables/functions affected

**Inspection/controlled tools:** `scripts/diagnose-inventory-sofp.sql`, `scripts/diagnose-sales-vs-inventory.sql`, `scripts/diagnose-business-not-found.sql`, `scripts/audit-role-rls.sql`; `src/dal/repositories/FinancialStatementRepository.ts` (`auditStatementIntegrity`, statement methods), `InventoryRepository.ts` (`backfillFromSalesAndPurchases`), `AuditLogRepository.ts` (`verifyChain`); `src/services/inventoryJournalService.ts` (`reconcileInventoryToLedger`, `postInventoryReconciliationAdjustment`); `src/lib/statementIntegrity.ts`; `src/services/posReportService.ts`.

**Relevant DB functions:** `backfill_and_recalculate_inventory`, `verify_audit_chain`, `log_manual_audit_event`, approved correction/posting commands from R05–R08. These are **not all read-only**: backfill/reconciliation adjustments and posting commands mutate records and require specific approval.

**Tables subject to reconciliation:** `businesses`, `business_users`, `accounts`, `invoices`, `invoice_lines`, `invoice_payments`, `expenses`, `expense_lines`, `expense_payments`, `journal_entries`, `journal_lines`, `accounting_periods`, `products`, `inventory_locations`, `stock_movements`, `inventory_balances`, `pos_shifts`, `pos_cash_movements`, `payroll_runs`, `payroll_employee_lines`, `tax_returns`, `tax_payments`, `subscription_payments`, `audit_log`; include loans/assets/FX and related tables where present in the customer's active workflows. Local `ledgr-offline.queue` must be reconciled separately from server data.

**New output, not implemented:** tenant-scoped discrepancy/repair manifests, approved repeat-safe repair scripts and pilot acceptance evidence. Exact repair script/table scope depends on observed discrepancies; no fabricated universal repair is proposed.

### 2. Current behaviour

Diagnostic/reconciliation tools exist; some workflows can leave missing stock/COGS/payment/shift effects. No current live reconciliation has been performed by this audit. Passing new-write tests would not prove historical data is correct.

### 3. Vulnerability/defect

Unknown old inconsistencies may produce misleading reports after fixes. Blind backfill/replay can duplicate financial effects, assign incorrect cost/actor/shift or erase evidence. A pilot without reconciled starting balances cannot establish correctness.

### 4. Proposed change

Take approved consistent before-state evidence, classify discrepancies and determine finance-approved corrections. Run bounded tenant-scoped idempotent repairs through trusted commands; preserve original records/source references and exception ownership. Pilot the exact enabled scope and reconcile after representative cycles before wider acquisition.

### 5. Database migration required?

**Not inherently.** Reconciliation starts with reads. Confirmed historical defects may require reviewed data-repair scripts/migrations or approved adjustment commands; additions for audit/repair manifests are design pending. Never embed an unreviewed full-business recalculation in a schema deployment.

### 6. Risk of making the change

**Very high:** financial history changes, double posting, changed tax/profit, incorrect inventory costs, overwriting valid later activity or affecting the wrong tenant. Historical ambiguity cannot safely be “resolved” by guessing.

### 7. Dependencies

Applicable R01–R14 gates; finance/security/operations approval; tested backup/repair/rollback procedures. Read-only diagnosis can start earlier; repairs/pilot expansion cannot precede trusted commands and a recovery path.

### 8. Tests to run before implementation

Use read-only reconciliations for selected cohort: line/header totals, payment allocations/settlements, balanced journals, stock movement/balance/GL valuation, shift/tender controls and plan/provider state. Dry-run each proposed repair on a sanitized/disposable clone; compare its explicit expected row/amount impact. Check existing tests `FinancialStatementRepository.test.ts`, `inventoryBackfill.test.ts`, `src/lib/__tests__/statementIntegrity.test.ts`, `statementPresentation.test.ts`; review audit-chain anomalies without assuming they prove tampering.

### 9. Tests to run after implementation

Every approved discrepancy is corrected or explicitly unresolved/owned; no unexplained material variance. Repeat repair makes no additional changes. Unaffected tenants/records remain unchanged; document numbering/idempotency links retained; reports/tax/stock/shift values match expected outcomes; pending queues cannot reintroduce old effects. Pilot includes actual-role operations, failure recovery, subscription activation/expiry simulation and supported restore drill evidence.

### 10. Rollback procedure

Stop the repair/pilot expansion; retain repair IDs/before-after evidence. Reverse an erroneous adjustment through approved compensating entries or narrowly restore specific nonfinancial metadata only where no later dependency exists. Never restore an entire tenant/database over subsequent valid transactions without incident approval and full reconciliation. Preserve unsynced local records and external payment facts.

### 11. Release blocker?

**Yes for affected customer-cohort release/expansion.** Unrelated historical improvements can be deferred only if they do not compromise the claimed financial reports or controls and have documented owners/limitations.

### 12. Could it affect existing customer data?

**Yes, explicitly and directly.** Any repair requires tenant-scoped impact approval. Diagnosis alone must not trigger backfill. No claim of historical correction is valid until before/after evidence exists.

### 13. Could existing functionality regress?

Yes: previous statements, tax returns, customer/supplier balances, stock cost, sales history, shift close and subscription access. Valid old workflows/payloads may encounter new constraints; assisted recovery must be ready.

---

## Approval boundary and next decision

This register authorizes **nothing** to run. The next reasonable authorization is a narrow **R00 read-only deployed-state verification and baseline-test preparation**, accompanied by a separately approved containment procedure for any confirmed reachable R01–R03 issue. It is not blanket approval to implement all 16 packages.

Before each package starts, confirm:

1. Direct change targets versus inspection/regression-only targets.
2. Approved invariant and business decision, including any new table/function design.
3. Existing customer impact and supported client/queue versions.
4. Test environment/fixtures and baseline results.
5. Reviewed forward migration/backfill and safe rollback/containment procedure.
6. Release gate owner and evidence required for completion.

**No rebuild, no new vertical modules, no automatic data repair, and no production implementation has been performed.**
