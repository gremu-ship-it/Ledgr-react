# LEDGR — PRE-IMPLEMENTATION ARCHITECTURE GATE

**Date:** 2026-10-06 (Africa/Johannesburg)
**Authorization scope:** evidence / schema baseline ONLY. No implementation of the
frozen multi-business architecture. No migrations added or changed. No production
data read or touched.
**Frozen architecture reference:** `docs/audits/LEDGR_FINAL_MULTIBUSINESS_ARCHITECTURE_DECISIONS_2026-09-27.md`
**Predecessor validation:** `docs/audits/LEDGR_ARCHITECTURE_VALIDATION_2026-09-27.md`

Legend used throughout: **VERIFIED** (directly observed, reproducible), **INFERRED**
(derived, likely but not directly observed), **UNAVAILABLE** (no access path in this
environment), **BLOCKED** (verification step itself cannot be executed here).

---

## 1. Executive status

**GATE VERDICT: BLOCKED — with a bounded, explicit unblock path.**

The migration chain is internally consistent and replays cleanly end-to-end. The
frozen architecture does not collide with any existing security invariant
discovered during this gate. Application code is green on typecheck, lint, unit
tests, release-type checks, and build.

Three facts block a READY verdict:

1. **Exact type regeneration is BLOCKED in this environment.** The approved
   mechanism (`supabase gen types typescript`) requires either live Supabase
   access (unavailable) or Docker for `--db-url` generation (absent in the
   sandbox). The tracked `src/dal/types/database.generated.ts` was therefore
   **not overwritten** (anti-fabrication: it must carry exact CLI output, not a
   hand-built approximation). A catalog-faithful approximation was produced and
   archived so the true shape is quantified today (§5).
2. **The tracked generated types are materially stale against the migration
   chain** — far worse than the prior audit believed: **11 tables, 14 views, 88
   application functions, 9 enums missing entirely**, plus **column-level drift
   on 5 further tables** (§4–§5). Until the exact regeneration lands, consumers
   must not infer non-existence from the generated file.
3. **Live (production) verification is UNAVAILABLE from this sandbox** by design
   (`tests/release/safety.mjs` refuses external DB URLs). POS-tenant population
   evidence for Strategy A (frozen decision) is therefore BLOCKED as a live
   measurement; the signal schema needed for it is fully verified (§7).

Additionally, the existing release harness deterministically reports **5 FAIL**
records. Each is proven — with a two-sided disposable-database probe — to be a
**fixture month-rollover staleness** (`DAY='2026-09-21'`), not a product or
security regression (§11). No test was weakened, rewritten, or reclassified.

---

## 2. Repository commit used

| Item | Value |
|---|---|
| Branch | `arena/01a0e2d8-ledgr-react` |
| HEAD commit | `4d9aa636e6bf4429b98b7634fbba410bfd388cf9` |
| Commit title | Merge pull request #189 from gremu-ship-it/arena/01a0e263-ledgr-react |
| Working tree | Only untracked audit docs + the gate artifacts listed in §14; **no tracked file modified** |

Release-harness evidence records both runs against this exact commit (§11).

---

## 3. Migration baseline (Task A) — VERIFIED

### 3.1 Chain

- **120 migration files**, versions `20250101000000` … `20261015000000`
  (including the incident-containment `ic_*`, owner-decision `od_*`, and
  post-containment hardening files — read-only in this gate; incident separation
  honoured per §12 of the authorization).
- **Replay: VERIFIED clean.** All 120 files applied in filename order against a
  disposable embedded PostgreSQL **17.10** (via the repository's
  `tests/release/database.mjs` harness bootstrap + migrations), zero errors.
  Per-file SHA-256 hashes captured in
  `artifacts/database/gate-2026-10-06-migration-replay-catalog.json`.
- Note — the filename dates up to `20261015` post-date today (2026-10-06); the
  files are real, committed, and applied. No unexplained schema mutation was
  observed during the gate (the replay is deterministic; two independent
  harness runs produced byte-identical outcome sets, §11).

### 3.2 Authoritative catalog (replay-derived)

| Kind | Count | Notes |
|---|---|---|
| Tables | 79 | RLS enabled on all 79 observed in `pg_class.relrowsecurity` for the public tables checked (see POS and businesses detail in §7–§8) |
| Views | 21 | includes `v_ar_ageing`, `v_trial_balance`, `v_cash_flow`, `v_ai_*` (12), `v_inventory_*`, `v_partner_client_usage` |
| Functions | 165 signatures / 162 distinct names | 131 application functions + 31 `pg_trgm` extension-provided artifacts that land in `public` in the disposable replay (on Supabase these live in `extensions` — **INFERRED**; marked so the type-delta is not inflated) |
| Enums | 16 | `user_role` (22 labels), `currency_code`, `account_type`, `account_subtype`, `invoice_status`, `journal_status`, `payment_method`, `stock_movement_type`, `asset_status`, `depreciation_method`, `tax_code`, `tax_alert_*` (3), `tax_return_status`, `payroll_status` |
| Policies | 235 | pg_policies, schema public |
| Triggers | 70 | quota guards, stock-balance writers, period guards, etc. |
| SECURITY DEFINER | 117 of 165 signatures | command-surface design (R01–R08 era) |

### 3.3 Business / organisation / capability / branch surface (explicit)

| Object | Type | First migration | In stale types? | Status |
|---|---|---|---|---|
| `businesses` | table | 20250101000000 | yes | current (35 cols; **no org-type / operating-model / capability / industry column** — Task F) |
| `business_users` | table | 20250101000000 | yes | current (RLS on; 5 policies) |
| `user_profiles` | table | 20250101000000 | yes | current |
| `branches` | table | 20250101000000 | yes | current |
| `inventory_locations` | table | 20250101000000 | yes | current (carries `branch_id`) |
| `partners` | table | 20260727000002 | yes | current |
| `partner_clients` | table | 20260727000002 | yes | current |
| `partner_feature_flags` | table | 20260727000002 | yes | current |
| `subscription_payments` | table | 20260726000002 | yes | current (no separate `subscriptions` table exists — plan state lives on `businesses.plan_tier/plan_expires_at`) |
| `business_terms_acceptances` | table | 20260729000000 | yes | current |
| `business_invitations` | table | 20250101000000 | yes (stale cols, §5.3) | current |
| `projects`, `funding_sources`, `capability_overrides`, anything `organistion*/operating*/industry*` | table | — | n/a | **do not exist** (confirms Task F preconditions) |
| POS tables (9) | table | see §7.1 | 3 of 9 | current in schema, partially untyped |

POS functions (33 application functions): `post_pos_sale` (canonical definition
at `20261012000000_post_containment_hardening.sql`), `_ledgr_complete_pos_sale`
(2 overloads), `open_pos_shift_command`, `close_pos_shift_command`,
`record_pos_cash_movement_command`, `void_pos_sale_command`,
`refund_pos_sale_command`, `pos_stock_availability`, `get_pos_shift_report`,
`request_pos_approval`, `authorize_pos_approval`, `request_pos_price_override`,
`authorize_pos_price_override`, `can_operate_pos`, plus internal `_ledgr_*`
helpers (see catalog JSON for the full list). Inventory functions/triggers:
`record_sale_stock_and_cogs`, `record_inventory_journal_movement`,
`update_inventory_balance`, `_ledgr_apply_stock_movement_balance`,
`_ledgr_apply_stock_movement_delta`, `backfill_and_recalculate_inventory`,
`_ledgr_stock_location`, `_ledgr_pos_stock_location` (+ named triggers in the
catalog). Capability/quota functions: `_ledgr_assert_usage_limit`,
`_ledgr_before_insert_{invoices,expenses,payroll_runs}_quota`,
`enforce_plan_tier_change`, `enforce_partner_client_limit`, `plan_tier_rank`,
`usage_document_count` (20260921000002). Branch helpers: `can_access_branch`,
`can_access_location`.

### 3.4 Versions/names

The exhaustive per-object → first/last-migration mapping (278 rows incl. views,
functions, enums) is machine-produced at
`artifacts/database/gate-2026-10-06-migration-replay-catalog.json` (tables,
views, functions w/ args + SECURITY DEFINER + defaults, enums, 235 policies w/
roles, grants for `anon/authenticated/service_role`, 70 triggers). Summary in
§3.2–§3.3.

---

## 4. Generated-type baseline (Task B, before) — VERIFIED

Tracked file: `src/dal/types/database.generated.ts`

| Property | Value |
|---|---|
| SHA-256 (before) | `0f80b6f58614aa41764dd9435e35632eeaa8f7e96ba7b56d515da36544f1b7a8` |
| Lines | 6,769 |
| Coverage (public) | 68 tables · 7 views · 43 functions · 7 enums |
| POS coverage | `pos_cash_movements`, `pos_settings`, `pos_shifts` **only** |
| Backup (preserved) | `artifacts/database/database.generated.pre-regen.ts` — byte-identical (same SHA-256) |

Declared provenance: generated earlier from the legacy database via
`npx supabase gen types typescript --project-id <ref>`
(`docs/database/database-operations.md` §2). It was treated as stale evidence
in the frozen decisions — this gate now **quantifies** that staleness (§5).

---

## 5. Generated-type regeneration result (Task B, after)

### 5.1 Exact regeneration — BLOCKED

- Approved mechanism per `docs/database/database-operations.md`:
  `npx supabase gen types typescript --project-id <ref>` (live) or equivalent.
- **Live Supabase access: UNAVAILABLE** (sandbox carries no staging/production
  credentials; the release harness refuses external DB configuration by design).
- **CLI against the migration-derived disposable DB: BLOCKED by environment** —
  installed `supabase@2.119.0` `--db-url` path shells out to Docker/pg-meta:
  `docker: command not found (podman also not found)`.
- Consequence honoured per authorization: the tracked
  `database.generated.ts` was **NOT overwritten** (exact CLI output must not be
  fabricated). **SHA-256 after gate = identical `0f80b6f5…1b7a8`.**

### 5.2 Catalog-faithful approximation (machine-generated, clearly marked)

Following the repository's own Phase 8A.1 convention
(`artifacts/database/fresh-database.generated.approx.ts`), a full approximation
was generated **from the replayed migration catalog** (not hand-written):

| Property | Value |
|---|---|
| Path | `artifacts/database/database.generated.gate-2026-10-06.approx.ts` |
| SHA-256 | `bd35a80863363b6254709f3619c14b65eb09707ffb7d67b4ac17675b4e54212b` |
| Size | 214,105 bytes |
| Coverage | **79 tables · 21 views · 131 functions · 16 enums** (all migration-defined application objects; trgm artifacts excluded) |
| Well-formedness | `tsc --noEmit --strict` on the standalone file: **clean** |
| Marking | Header comment states: approximate, migration-replay derived, exact CLI regeneration still required; tracked file untouched |

### 5.3 Additions / removals / changes vs the stale generated types

**Additions missing from tracked types (schema → types delta):**

| Kind | Count | Entries |
|---|---|---|
| Tables | **11** | `accounting_period_events`, `invoice_approval_policies`, `invoice_approvals`, `offline_queue_reconciliations`, `phone_accounts`, `pos_approvals`, `pos_corrections`, `pos_price_overrides`, `pos_shift_closes`, `pos_shift_late_adjustments`, `pos_terminals` |
| Views | **14** | `v_ai_anomalies`, `v_ai_cash_accounts`, `v_ai_cash_movements`, `v_ai_customer_concentration`, `v_ai_expense_docs`, `v_ai_kpis`, `v_ai_monthly_trend`, `v_ai_overdue_invoices`, `v_ai_revenue_invoices`, `v_ai_top_customers`, `v_ai_top_expenses`, `v_ai_upcoming_payables`, `v_ai_upcoming_receivables`, `v_inventory_balance_ledger_drift` (stale file already carries `v_ar_ageing`, `v_asset_register`, `v_cash_flow`, `v_inventory_ledger_variance`, `v_partner_client_usage`, `v_reorder_alerts`, `v_trial_balance`) |
| Functions | **88 application** (+31 trgm artifacts) | entire R01–R10/R08/P5 command surface: `post_pos_sale`, `_ledgr_complete_pos_sale`, `create_invoice_with_lines`, `save_quick_sale`, `save_quick_expense`, `pos_stock_availability`, `record_pos_cash_movement_command`, `void_pos_sale_command`, `refund_pos_sale_command`, `open/close_pos_shift_command`, `request/authorize_pos_*`, `reconcile_offline_queue_item`, `close/reopen_accounting_period`, `accept_invitation_membership`, `_ledgr_*` guards (period, invoice, quota, POS), etc. |
| Enums | **9** | `account_subtype`, `asset_status`, `currency_code`, `depreciation_method`, `invoice_status`, `payment_method`, `stock_movement_type`, `tax_code`, `user_role` |
| Column-level drift on shared tables (5) | **5** | `business_invitations`: `phone`, `role_assignment_authorized`; `invoices`: `pos_shift_id`, `payload_hash`, `submitted_by`; `pos_cash_movements`: `command_key`; `pos_shifts`: `terminal_id`, `open_command_key`; `webhooks`: `consecutive_failures` (`business_invitations.phone` etc. each individually re-verified against both sources) |
| Removals (in types but not in schema) | **0** | none in any of tables/views/functions/enums |

(Numbers for views: catalog 21 − stale 7 = 14 missing; matches delta output.)

`journal_entries.source_id`, `journal_entries.created_by` and five sibling
columns are **text in migrations but (owner-confirmed) uuid on production**
(harness env `LEDGR_R13_LIVE_UUID_SHAPE=1`, `tests/release/database.mjs:64`).
This live-shape divergence is carried unchanged and must be reproduced with
that toggle when replaying against live shape; it does not affect object
presence, so it does not change any classification in this report.

---

## 6. `create_business_with_owner` signature verification (Task C) — VERIFIED

Authoritative (replay catalog, `pg_get_function_identity_arguments`):

| Property | Value |
|---|---|
| Overloads in schema | **exactly 1** |
| Parameters | **18** — `p_name, p_trading_name, p_registration_number, p_tpin, p_vat_number (all text)`, `p_vat_registered boolean`, `p_base_currency, p_financial_year_start, p_timezone, p_address_line1, p_city, p_country, p_phone, p_email, p_brand_color, p_invoice_prefix, p_expense_prefix, p_payroll_prefix (all text)` |
| Parameter order | exactly as listed above |
| Defaults | **0** (`pronargdefaults = 0`) |
| Returns | `uuid` |
| Options | `language plpgsql`, `security definer`, `set search_path = public` — VERIFIED |
| Grants | EXECUTE to `authenticated`, `service_role`; not to `anon` — VERIFIED |
| Defining migration | `20260815000000_phase8b_reconstruct_rpcs.sql` (only migration that defines it; earlier live-legacy version dropped in the same file) |

Call sites (complete):

| Site | Call form | Signature dependence |
|---|---|---|
| `src/pages/CreateBusinessPage.tsx:478–499` | `supabase.rpc('create_business_with_owner', { …18 named args… })` | named-argument JSON object — order-independent |
| `tests/release/fixtures.ts:55` | positional `select public.create_business_with_owner($1,…18 literals)` | full 18-arg positional |
| `tests/release/r01-security.test.ts:165` | positional `select public.create_business_with_owner('R01 business',…18 literals)` | full 18-arg positional |
| `src/dal/types/database.generated.ts:6250` | typed entry (all 18 args, `Returns: string`) | type-only |

**Compatibility verdict: appending defaulted parameters is technically
compatible. VERIFIED.** PostgreSQL allows adding parameters after the 18th only
with defaults (no existing param has a default, so no reorder constraint is
violated); the named-args HTTP caller (`CreateBusinessPage`) tolerates new
optional params unchanged; both positional harness callers pass the complete
existing 18 and hit the appended defaults. Caveats the implementation must
carry: (a) `REVOKE/GRANT ON FUNCTION …(18-signature)` statements must be
updated to the new signature in the same migration; (b) the stale in-code
comment at `CreateBusinessPage.tsx:475` claims the RPC "isn't in the generated
Functions" — the generated types **do** contain it (line 6250); that comment is
a DOCUMENTATION-GAP, not a code fault.

No STOP condition triggered; no caller depends on a different signature.

---

## 7. Existing business / POS baseline (Task D)

### 7.1 Signal schema — VERIFIED (replay catalog)

| Signal | Object | Key columns (verified present) | In stale types? |
|---|---|---|---|
| Shift usage | `pos_shifts` (20260920000000) | `business_id, branch_id, cashier_id, opened_at, status, terminal_id, open_command_key` | yes (missing `terminal_id`, `open_command_key`) |
| Terminal register | `pos_terminals` (20260930000000) | `business_id, name, branch_id, preferred_location_id, is_active` | **no** |
| POS invoices | `invoices.pos_shift_id` (+ `payload_hash`, `submitted_by`) | added by `20260930000000_r08_till_context.sql` | **no (all three)** |
| POS journal link | `journal_entries.posting_key = 'invoice:<id>:sale'`, `source_type='pos_void'` for corrections | `20260923000000` / `20260928000002` / `20261014000001` | n/a (rows, not schema) |
| Offline replay link | `offline_queue_reconciliations.operation_type='pos_sale'` | `20261002000000` | **no (table untyped)** |
| ⚠️ correction | `audit_log.event_type='pos_sale'` | **NOT VERIFIED** — no canonical SQL path (RPC or trigger) writes that event; `audit_log` is written via `log_manual_audit_event`/manual inserts only | — |

**Correction to the frozen decisions document:** `audit_log.event_type =
'pos_sale'` was listed as an authoritative POS-us**age signal; no code path in
the current migration chain produces it. The reliable tenant-level signals
are `pos_shifts` ∪ `pos_terminals` ∪ `invoices.pos_shift_id` (∪ journal
posting-key pattern). Classification: DOCUMENTATION-GAP (G-7 below).

`pos_settings` — re-**VERIFIED** to contain only configuration
(`enabled_payment_methods, cashier/manager_max_discount_percent,
require_approval_for_void/refund, receipt_*, show_tax_on_receipt,
custom_role_permissions`): **no enable/used flag; must not be used as a
Strategy-A usage discriminator.**

### 7.2 Tenant population — BLOCKED (live), synthetic-only (local)

- **Which existing businesses use POS (shifts / terminals / POS invoices / audit): UNAVAILABLE** — requires production read access; the sandbox deliberately has none. No measurement was fabricated.
- Local fixture evidence (synthetic, explicitly not production): the R13
  release fixture seeds exactly 2 businesses (orgs A, B), each with one
  `pos_shifts` row, one `pos_terminals` row and a POS sale flow
  (`tests/release/fixtures.ts:75-79`). This proves command paths, not tenant
  population.
- Contradictory-signal analysis (e.g., terminal without shift): UNAVAILABLE for
  the same reason; the read-only query shape is provisioned in §13
  (prerequisites) to be run under live access.

No `businesses` rows, `pos_settings` rows, or capability data were created or
modified anywhere.

---

## 8. Capability baseline (Task E) — VERIFIED (code + catalog)

Current implementation = **three** conjunctive gates, no organisation layer:

| Layer | Mechanism | Evidence |
|---|---|---|
1. **Subscription** | `PlanTier = free/starter/growth/pro/enterprise`; `PlanCapability = bank_reconciliation \| ai_insights \| api_access \| webhooks \| custom_branding \| inventory \| core_accounting \| accounting_organisation`; cumulative per-plan lists; `hasCapability()` = membership check; metered quotas (`transactionLimit` 50/200/500/2000/null) enforced server-side by `_ledgr_assert_usage_limit` + insert-time `_ledgr_before_insert_*_quota` triggers | `src/lib/billing/plans.ts`; migrations R10/P5C |
2. **Partner** | `PartnerFeatureKey = ai_advisor \| payroll \| inventory \| multi_currency \| bank_reconciliation`; `partner_feature_flags` table; `PartnerContext.isFeatureEnabled()` | `src/types/partners.ts`, `src/partner/`, migration 20260727000002 |
3. **Role** | 22-label `user_role` enum; path allowlist `isPathAllowedForRole()`; per-item `partnerFeature`/`requiresCapability`/`minPlan` gates in nav | `src/hooks/usePermissions.ts`, `src/components/layout/navConfig.ts` |

**Hard-coded gates / conflicts with the frozen Option C:**

1. **POS is an un-gated nav item today** (`navConfig.ts:52` — `/pos` carries
   neither `requiresCapability` nor `partnerFeature`; visibility is
   role-allowlist only). `PlanCapability` has **no `pos` key**. The frozen
   architecture introduces POS as an organisation-gated capability — this is
   exactly the planned delta (EXPECTED-PREIMPLEMENTATION, G-5).
2. No `organisation_type` / `operating_models` / `capability_overrides`
   anywhere in schema or code (EXPECTED-PREIMPLEMENTATION).
3. Capability checks are UI/nav-centric; server authority is RLS + SECURITY
   DEFINER guards, independent of capability computation — consistent with the
   frozen rule that the organisation layer only narrows UI and never RLS
   (no conflict found — VERIFIED).
4. No `MIXED` / `PRODUCT_AND_SERVICE` literal exists anywhere (VERIFIED — the
   frozen prohibition is auto-satisfied).
5. No behaviour-driving `industry` field exists (VERIFIED).

Nothing above was implemented or altered.

---

## 9. Wholesale workflow verification (Task F) — VERIFIED

| Claim | Status |
|---|---|
| `v_ar_ageing` view exists (schema) | **VERIFIED** (replay catalog, 21 views; first defined `20260815000002`, recreated in the same file after the drop) |
| `ContactRepository.getArAgeing()` exists | **VERIFIED** (`src/dal/repositories/ContactRepository.ts`) |
| `days_overdue` exists | **VERIFIED** (repository method) |
| No `.tsx` consumer | **VERIFIED** (`grep --include='*.tsx'` → zero; consumers are `src/lib/ai/context.ts` — AI context, not a UI workflow — plus demo and tests) |
| No receivables/ageing tab in `ReportsPage` | **VERIFIED** (`Tab = 'trial' \| 'sofp' \| 'pl-ifrs' \| 'revenue' \| 'cashflow-ifrs' \| 'equity' \| 'branches' \| 'currency'`) |

**Conclusion stands: AR ageing is a primitive, not a complete UI workflow.
Wholesale must not be described as production-ready on this basis.** No
wholesale UI was implemented. All Task-F "do not create" objects
(`projects`/`funding_sources`/journal `project_id`/`npo` template/NGO type/
separate org-profile table) were confirmed absent and **not** created.

---

## 10. Architecture contradiction scan (Task G)

| # | Discrepancy | Classification | Explanation |
|---|---|---|---|
| G-1 | Tracked generated types miss 11 tables / 14 views / 88 fns / 9 enums + 5 tables of column drift | **IMPLEMENTATION-GAP** | Approved-mechanism regeneration pending (env-blocked today, §5). Not a schema contradiction. |
| G-2 | `CreateBusinessPage.tsx:475` comment says RPC not in generated types; it is (line 6250) | **DOCUMENTATION-GAP** | Comment-only staleness. |
| G-3 | Frozen decisions list `audit_log.event_type='pos_sale'` as POS signal; no canonical path writes it | **DOCUMENTATION-GAP** | Signal set corrected in §7.1. |
| G-4 | 5 release-harness FAILs (R10/R09.3 quota family) | **DOCUMENTATION-GAP** | Fixture stale after month rollover (`DAY='2026-09-21'` vs `date_trunc('month', current_date)` server metering); product boundary proven intact by two-sided probe (§11.4). No test modified. |
| G-5 | POS nav un-gated; no `pos` in `PlanCapability` | **EXPECTED-PREIMPLEMENTATION** | Precisely the delta the frozen architecture introduces. |
| G-6 | No org-type / operating-model / capability-override storage or NGO objects exist | **EXPECTED-PREIMPLEMENTATION** | Frozen MUST/SHOULD scope, not yet implemented — and intentionally not created in this gate. |
| G-7 | Wholesale AR ageing primitive without UI workflow | **EXPECTED-PREIMPLEMENTATION** | Frozen SHOULD scope says wire the screen over `v_ar_ageing`; verified gap only (§9). |
| G-8 | 7 columns are `text` in migrations but `uuid` on production (owner-confirmed), bridged by `LEDGR_R13_LIVE_UUID_SHAPE` in the harness | **UNKNOWN→(documented) / EXPECTED-PREIMPLEMENTATION** | Pre-existing repo convention; must stay in effect for live-shaped replays. Not altered. |
| G-9 | Migrations dated after today (`20261010–20261015` incident/repair files) | **EXPECTED-PREIMPLEMENTATION (incident track)** | Part of the separated production-integrity workstream; replayed cleanly; untouched per §12 of the authorization. |
| G-10 | `pos_approvals`, `pos_corrections` have RLS enabled with **0 policies** | **VERIFIED — no conflict** | WRITEs flow only through SECURITY DEFINER commands (R01/R07 design); direct-reader denial is the invariant. Recorded for awareness, not a defect. |

No BLOCKER-class discrepancy was found. No security-boundary regression, no
unexplained schema mutation, no RPC incompatibility, no conflict between the
frozen architecture and any existing security invariant. **No contradiction
requires a new product decision** at this gate level.

---

## 11. Regression results (Task H)

Environment: Node v22.22.3, `npm ci` fresh install (681 packages),
PostgreSQL 17.10 embedded replay.

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc -b`) | **PASS** (clean) |
| `npm run lint` | **PASS, 0 errors, 4 warnings** — 2 pre-existing (`src/offline/queueApi.ts` unused-disables; `fresh-database.generated.approx.ts`), **1 new from this gate's own approx artifact** (unused `eslint-disable` line 1 — same class as the pre-existing approx artifact; left to match repo convention, documented not hidden) |
| `npm test` (vitest, `src/`) | **PASS — 102 files, 920/920 tests** |
| `npm run test:release:types` | **PASS** (clean) |
| `npm run build` | **PASS** with the CI placeholder env (`VITE_SUPABASE_URL/ANON_KEY=placeholder…`, matching `.github/workflows/ci.yml`); without env the `prebuild` guard exits 2 — environment configuration, not a code defect; PWA precache generated |
| `npm run test:release` — **run 1** | evidence `ledgr-r13-zxysIh/evidence.json`: `{"PASS":817,"FAIL":5,"BLOCKED":54,"NOT APPLICABLE":0}` (exit 1) |
| `npm run test:release` — **run 2** | evidence `ledgr-r13-XQ0BEV/evidence.json`: **identical outcome set** (byte-identical id+status map), same counts, same 5 FAIL ids, exit 1 — **deterministic** |
| Both runs recorded commit | `4d9aa636e6bf4429b98b7634fbba410bfd388cf9` |

### 11.4 The 5 deterministic FAILs — investigated, safely classified

FAIL ids (both runs): `R10.QUOTA.SERVER-POS`,
`R10.QUOTA.SERVER-QUICKSAVE-EXPENSE`, `R10.QUOTA.SERVER-QUICKSAVE-SALE`,
`R093.EXCEPTION.POLICY-DENIED`, `R093.RECON.POLICY-REVALIDATION`.

Root cause — **fixture month-rollover staleness, proven two-sided:**

- `_ledgr_assert_usage_limit` meters `date_trunc('month', current_date)`
  (migrations `20261001000000` / `20261006000000`).
- The fixture seeds usage at hardcoded `DAY = '2026-09-21'`
  (`tests/release/fixtures.ts:2`). On 2026-09-2x (when the suites were authored
  / last green) seeded rows sat in the metered month; today (2026-10-06) they
  sit in the previous month, so quota denial never fires and the assertions
  fail. All 5 FAILs share this cause (R09.3 policy-denied paths derive from the
  same quota denial).
- **Direct probe (disposable replay):**
  - 50 doc rows dated `2026-09-21`, assert called on 2026-10-06 → **no denial**
    (reproduces the 5 FAILs exactly).
  - The same business with 50 additional rows dated in the current month →
    **SQLSTATE `P0QLT`, message `Monthly transaction limit reached (50). Please upgrade your plan.`** — the exact typed contract the suites assert.
- Conclusion: the **billing/quota security boundary is intact**; the harness
  fixture is what is stale. Fixing it means editing the fixture (product-test
  change) which this gate is not authorized to do — it is recorded, not
  reclassified to PASS, and its status in the evidence files remains FAIL.
  Owner sign-off on the fixture date-stability approach is a routine test
  maintenance item.

BLOCKED records (54) are pre-existing harness-declared limitations (no
isolated Auth service, no second-connection concurrency, legacy-suite porting,
branch-scope audits pending approvals) — unchanged from the harness's own
contract.

---

## 12. Blockers and unknowns

**BLOCKERS (must clear before implementation authorization):**

1. **B-1 (gating): Exact type regeneration.** `database.generated.ts` must be
   regenerated via the approved CLI against the live schema (or a Docker-capable
   replay), producing the exact canonical file; expected content delta =
   §5.3 lists (this is now a checklist, not an unknown).
2. **B-2 (live measurement): POS tenant baseline for Strategy A.** Verified
   signal SQL must run against production (read-only):
   `pos_shifts`, `pos_terminals`, `invoices.pos_shift_id`,
   `journal_entries.posting_key LIKE 'invoice:%:sale'` ∪ `source_type='pos_void'`.
   Do **not** use `pos_settings` as usage evidence; do **not** rely on
   `audit_log.event_type='pos_sale'` (no producer exists — G-3).

**UNKNOWNS (informational, no product decision needed at gate level):**

- U-1: Whether production schema still matches the migration chain byte-for-byte
  (a live capture à la Phase 8A.1 would close this; currently UNAVAILABLE).
- U-2: `unit-test` reliance on any stale type shape — unit tests hold
  hand-written fixtures; no failure observed.
- U-3: The 7 text-vs-uuid live columns (G-8) remain a maintained convention.

---

## 13. Exact prerequisites for implementation authorization

1. Run `supabase gen types typescript` (Docker available or live project
   access), replace `src/dal/types/database.generated.ts`, and confirm the diff
   against §5.3 (types must surface the 11 tables incl. `pos_terminals`,
   `pos_approvals`, `pos_corrections`, `pos_price_overrides`,
   `pos_shift_closes`, `pos_shift_late_adjustments`; the 5 column-drift tables;
   9 enums). Commit the regenerated file in the first implementation PR.
2. Obtain a **read-only** production capture of the Strategy-A signals (§7.2 /
   B-2) before any future capability backfill — and re-run all PIN computations
   against that evidence. (Out of scope for this gate: no production changes.)
3. Product confirmations already enumerated as pending in the frozen document
   §K remain per that document (NGO/NON_PROFIT labelling, model array sign-off,
   etc.) — this gate adds none.
4. Address the release-harness fixture staleness (`DAY`) as ordinary test
   maintenance (or accept and document the known-FAIL window) so the
   implementation branch can rely on a green `test:release`.
5. Keep `LEDGR_R13_LIVE_UUID_SHAPE=1` semantics for any live-shaped replay.
6. When appending parameters to `create_business_with_owner`, update the
   `REVOKE/GRANT ON FUNCTION …(signature)` statements in the same migration
   (compatibility otherwise verified, §6).

STOP CONDITIONS outcome: none triggered *except* the environment-imposed
BLOCKED on exact regeneration and live production evidence — both recorded, not
repaired.

## 14. Files changed by this gate

| File | Change | Notes |
|---|---|---|
| `docs/audits/LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_2026-10-06.md` | **new** (this report) | — |
| `artifacts/database/database.generated.pre-regen.ts` | **new** | byte-exact backup of the tracked generated types; SHA-256 `0f80b6f5…1b7a8` |
| `artifacts/database/database.generated.gate-2026-10-06.approx.ts` | **new** | catalog-faithful approximation (§5.2); SHA-256 `bd35a808…e54212b`; clearly marked approximate |
| `artifacts/database/gate-2026-10-06-migration-replay-catalog.json` | **new** | full authoritative replay catalog (tables/views/functions w/ defaults+secdef/enums/235 policies/grants/70 triggers + per-migration SHA-256) |
| `src/dal/types/database.generated.ts` | **unchanged** | SHA-256 before = after = `0f80b6f5…1b7a8` |
| migrations / RLS / grants / RPCs / product code | **unchanged** | zero diffs |
| `.cache/r13/` (gitignored) | new | two sanitized harness evidence directories |
| `node_modules/`, `dist/` (gitignored) | rebuilt | `npm ci` install + build outputs |

**Gate outcome: BLOCKED, narrowly** — everything checkable from the repository
is verified and consistent with the frozen architecture; the block is exactly
the anti-fabrication rule on generated types plus live production evidence, and
both unblock paths are enumerated above.
