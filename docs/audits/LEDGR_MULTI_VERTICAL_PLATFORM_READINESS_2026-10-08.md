# Ledgr — Multi-Vertical / Business-Type Platform Readiness

**Revision 2 · 2026-10-08** · *Rev 1 was an independent survey written before the
multibusiness programme landed on `main`.* This revision cross-checks that
programme's three documents (merged in PR #198) against the repository and
against Rev 1, records what changed, and withdraws the Rev 1 recommendations
that the frozen design supersedes.

**Revision 2.1 · 2026-10-09** — status update only, no re-survey: Step 4
(fixture dates) is **done** and the release harness is fully green again
(822 PASS / 0 FAIL / 56 BLOCKED, §6); the gate §5.3 checklist counts are
**corrected** (two gate errors found and cross-footed, §4); a gate-A
verification script now automates the Step 1 checklist diff (§7).

**Question asked:** can different users have a different Ledgr "platform"
depending on their type of organisation (NGO, retail, manufacturer, …), and
where do we stand?

**What this document is.** An independent cross-check and status report. The
specification is
`docs/audits/LEDGR_FINAL_MULTIBUSINESS_ARCHITECTURE_DECISIONS_2026-09-27.md`
(the frozen decisions); its evidence is
`LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_2026-10-06.md` plus
`…_GATE_FOLLOWUP_2026-10-06.md`; the resumption map is
`LEDGR_MULTIBUSINESS_IMPLEMENTATION_HANDOFF_2026-10-06.md`. **Where anything
below disagrees with the frozen decisions, the frozen decisions win.**

**Method.** Repo reads only: migrations, the 2026-08-15 live capture
(`artifacts/database/capture/`), `src/**`, `tests/**`, and the programme's own
documents. Every claim is cited; the load-bearing claims of the programme were
re-verified independently (§4 lists what was found wrong, in either direction).

---

## 1. Verdict

1. **The design question is answered and frozen — it is no longer open.** A
   parallel workstream (PR #198) froze the target model: an organisation
   **type** + **operating models** on `businesses`, an **organisation
   capability layer** composed with subscription ∧ partner ∧ role, and a
   bounded NGO foundation (§2).
2. **No architecture code has been written.** The programme's STOP condition
   was honoured: no migrations, RLS, RPCs, org fields or NGO tables exist yet
   (`LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_FOLLOWUP_2026-10-06.md` §5;
   re-verified here — no `organisation_type`/`operating_models`/
   `capability_overrides` anywhere in `supabase/migrations/`).
3. **Implementation is gated**, not blocked by design questions: exact type
   regeneration (was ENVIRONMENT-BLOCKED — now cleared on the owner's machine,
   §6), a live POS baseline read, test-fixture maintenance, and owner product
   confirmations (§K of the frozen doc).
4. **Rev 1's own recommendations are partly superseded and one is withdrawn**
   — see the comparison in §5. In particular: the `business_type` vocabulary
   proposed in Rev 1 is **not** the frozen vocabulary, and Rev 1's
   "module registry table" **conflicts** with the frozen Option C
   (`capability_overrides jsonb`), so it is withdrawn.
5. **Two independent schema drifts exist, and they are different problems.**
   (a) *Production database* vs migrations — `api_keys`/`webhooks`/
   `webhook_deliveries` were missing columns the code writes; repaired by
   PR #197 (`20261017000000` applied to production 2026-10-08;
   `20261018000000` pending). (b) *Generated types* vs migrations — quantified
   by the gate (11 tables, 14 views, 90 application functions, 0 enums, 9
   columns on 5 drifted tables — the gate's own 88/9 counts are corrected in
   §4); the owner regenerated from staging on 2026-10-08, which clears the
   environment blocker but still needs the checklist/SHA/commit steps (§6).

---

## 2. The frozen target architecture (summary — the spec is the linked doc)

| Decision | Frozen value | Notes |
|---|---|---|
| **Organisation type** | `businesses.organisation_type`: `FOR_PROFIT`, `NON_PROFIT`, `GOVERNMENT`, `OTHER` | **NGO folds into `NON_PROFIT`** — no `NGO` type; "NGO-ness" is expressed by operating models. Label question is §K.1 |
| **Operating model** | `businesses.operating_models text[]`: `RETAIL`, `WHOLESALE`, `PRODUCT_SALES`, `SERVICE_SALES`, `PROJECT_BASED`, `GRANT_FUNDED` | Multi-select; `MIXED`/`PRODUCT_AND_SERVICE` explicitly forbidden as redundant |
| **Capability layering** | `EFFECTIVE = SUBSCRIPTION ∧ PARTNER ∧ ORGANISATION ∧ ROLE` | Organisation answers *"does this business use this module?"*; **can only narrow**; never in RLS or posting rules |
| **Capability storage** | Hybrid **Option C**: derived defaults in code from type + models; sparse `capability_overrides jsonb` on `businesses` holds only explicit admin decisions | Override wins where the key exists; effective value recomputed on read |
| **Existing tenants** | **Pinned** — the migration writes overrides equal to each tenant's *current* effective capability set (including `pos=true`) | Byte-for-byte behaviour preservation is the acceptance criterion (§G list of 10 invariants) |
| **POS backfill** | **Strategy A**: `pos = true` for every existing business; absent `pos` key ⇒ **fail-open** (rollback safety) | New businesses derive `pos` from operating models (`RETAIL` ⇒ on) |
| **Ledger** | Untouched: one double-entry ledger (`journal_entries`/`journal_lines` via `_ledgr_post_*`), gains only **nullable memo dimensions** | Hard invariant: memo dims never alter debit/credit/account/balance |
| **NGO foundation (SHOULD phase)** | tables `projects` + `funding_sources` (RLS copied from `branches`); memo-only `project_id`/`funding_source_id` on `journal_entries` + `expenses` (header level); `npo` COA template applied **at creation only** | Donor reporting, project budgets, invoice-side structured dims = **DEFERRED** |
| **Wholesale** | Primitive exists (`v_ar_ageing` + `ContactRepository.getArAgeing()`); SHOULD phase wires a report screen over it | No schema change |
| **RPC contract** | `create_business_with_owner` = **18 positional params, 0 defaults**; extend **only by appending SQL-defaulted params** and update the REVOKE/GRANT in the same migration | Re-verified in §4 |

---

## 3. What exists today (independently re-verified for this revision)

| # | Axis | Mechanism | Enforcement | Notes / corrections |
|---|---|---|---|---|
| 1 | **Subscription plan** | `PlanCapability` — **8 keys**: `inventory`, `core_accounting`, `accounting_organisation`, `bank_reconciliation`, `ai_insights`, `api_access`, `webhooks`, `custom_branding` (`src/lib/billing/plans.ts`) | **UI gates** (`PlanGate`, `PlanGuard`, `navConfig`) + **server** only for the monthly document quota (`effective_plan_tier` / `_ledgr_assert_usage_limit`) | **There is no `pos` key** — confirms the frozen doc §A.4 |
| 2 | **Partner white-label** | `partner_feature_flags` — 5 keys (`ai_advisor`, `payroll`, `inventory`, `multi_currency`, `bank_reconciliation`) | UI (`PartnerPlanGate`, `isFeatureEnabled`) + RLS on partner tables | A reseller axis, not a vertical one |
| 3 | **Role** | `user_role` enum — **22 labels** (verified by union of the base enum + `ALTER TYPE … ADD VALUE` across migrations) | **RLS + SECURITY DEFINER command functions** | The frozen doc's diagram says "role (19)"; the gate catalog and the migrations both say 22 — minor doc inconsistency, no impact |
| 4 | **Accounting standard** | `businesses.coa_template` = `gaap` \| `ifrs`; `switchCoaTemplate()` | Service layer + seeded rows | Cosmetic vertical traces already exist: `invoices.template` check `('professional','minimal','ngo','government')` (`20260725000001`) and free-text `invoices.project_code`; `donor_reference` is a UI field key only, **not persisted** |
| — | **Organisation type / modules** | — | — | **Absent**: no `organisation_type`/`operating_models`/`capability_overrides`/`industry`; no `projects`/`funding_sources`; `businesses` = 35 columns, none of them these |

Supporting verified facts: `create_business_with_owner` = **18 params, no
defaults** (§4 correction); `/pos` route sits under `RoleRoute` with no
capability gate and the nav item has no `requiresCapability`; `can_operate_pos()`
guards `post_pos_sale`; **9 POS tables exist, 3 are typed** (`pos_cash_movements`,
`pos_settings`, `pos_shifts`; the other 6 missing); the committed types define
**7 of the 21 views** (all 13 `v_ai_*` + `v_inventory_balance_ledger_drift`
absent); ledger dimensions are **branch + department only** (no
`project_id`/`fund_id` anywhere); `budgets`/`budget_lines` exist in schema with
**no screen** (no `.budget` usage in any `.tsx`); `v_ar_ageing` +
`getArAgeing()` exist and **no `.tsx` consumes them**.

---

## 4. Cross-check results (what this revision adds or corrects)

**Corrections to Rev 1 (my own errors):**

| Rev 1 claim | Verified truth | Source |
|---|---|---|
| "17 parameters" for `create_business_with_owner` | **18** (my regex missed `p_address_line1` — digit in the name) | `20260815000000_phase8b_reconstruct_rpcs.sql` signature block |
| "Retail/manufacturing/construction as *types*" | Not the frozen model: **types** are `FOR_PROFIT/NON_PROFIT/GOVERNMENT/OTHER`; segment character comes from **operating models** | frozen doc Decisions A/B |
| "Add a `modules` registry + `business_modules` + `effective_modules()`" | **Withdrawn** — conflicts with frozen Option C (code-side defaults + sparse `capability_overrides`); promoting overrides to a table is explicitly DEFERRED | frozen doc, Decision "Capability storage" |

**Programme claims re-verified (independent) — two gate §5.3 counts corrected.**
The stale-type checklist was re-verified in full against the replay catalog,
the committed types and the gate's own approx artifact (all three cross-foot):

- **Confirmed:** 11 missing tables, 14 missing views, 9 drift columns across
  5 drifted tables (all absent from the committed types), 0 removals.
- **Corrected — functions:** the gate's "88 application (+31 trgm artifacts)"
  split is off by two. The stale types already carry 2 of the 31 pg_trgm
  functions (`show_limit`, `show_trgm`), so the real delta is **90 application
  + 29 trgm** (119 total missing, unchanged; 131 application − 41 already
  typed = 90).
- **Corrected — enums:** the gate's "9 missing" is a **parser artifact**: its
  9 are exactly the multi-line-formatted enums in the stale file. All **16
  enums are present with current labels** (`user_role` carries all 22) — the
  real delta is **0**.

Also confirmed: `businesses` = 35 columns with none of the new fields;
`DAY='2026-09-21'` constant present in `tests/release/fixtures.ts` (the
diagnosed cause of the 5 release-harness FAILs — **since fixed**, §6);
`pos_settings` carries no enable flag; POS-usage signals as stated.

**Where this workstream's findings intersect the programme:** production's
`webhooks`/`api_keys`/`webhook_deliveries` tables are drift cases of the *same*
class the gate quantified in the types — and they were **fixed in the database**
(§6), not just documented. Any future "treat migrations as the schema source of
truth" rule (frozen doc §H.4 / handoff §5) now has a worked example of the
opposite direction: a database drifted *ahead of / behind* its migrations, with
the repair pinned by `tests/database/public_api_table_convergence.test.js`.

---

## 5. Segment readiness — reconciled to programme scope

| Segment | Status | Programme position |
|---|---|---|
| **Retail / POS** | Deepest vertical, server-authoritative, tested (retail audit §2/§12/§16) | **MUST phase** adds the `pos` capability + central nav/route gate; Strategy A pins existing tenants; no engine change |
| **Wholesale / distribution** | Credit terms, partial payments, `v_ar_ageing` primitive exist; **no receivables screen** | **SHOULD phase**: wire the ageing report over the existing view — no schema change. Do not claim wholesale complete before that |
| **Service / professional** | Supported by configuration (no stock forced) | **MUST phase**: expose `services` capability; UI-only |
| **NGO / non-profit** | Generic bookkeeping + departments-as-cost-centres + cosmetic `ngo` invoice template and free-text `project_code` | **SHOULD phase, bounded**: `projects` + `funding_sources` + memo dims + `npo` COA (creation-only). Donor reporting / restricted funds / project budgets **DEFERRED** |
| **Manufacturing** | Inventory is buy/sell/transfer + COGS; no BOM/WIP/production model | **Not in the programme at all** — no organisation type or operating model expresses it; would be a new product decision, and Rev 1's "manufacturing type" is withdrawn |
| **Construction** | Suppliers, purchases, stock locations, payroll, assets; no project costing | **Not in the programme** (same as manufacturing) |
| **Public sector** | Departments/branches/audit API; budgets exist as tables only | `GOVERNMENT` exists as a *type* (I&E posture, same as NON_PROFIT in phase 1); budget-execution/procurement workflows remain outside scope |

---

## 6. Programme status — and what changed since the gate

| Gate item | 2026-10-06 verdict | Status at this revision (2026-10-08, updated 2026-10-09) |
|---|---|---|
| **Exact type regeneration** | ENVIRONMENT-BLOCKED (no Docker, no live access in that sandbox) | **Unblocked on the owner's machine**: generated from the **live staging** project (`bkxzgkurcqvccsdjmqzg`) → 9111 lines, `npm run typecheck` clean. Remaining: verify the regenerated file against gate §5.3 (11 tables / 14 views / 90 application fns / 0 enums / 9 columns on 5 drifted tables — counts corrected per §4) — automated by `node scripts/ci/verify-regenerated-types.mjs <file>` (requires the full chain: 79 tables / 21 views / 131 application fns / 16 enums / 9 drift columns; prints the file's SHA-256) — then record old/new SHA-256 (`0f80b6f5…` is the old one), re-run the §8 stack, commit as its own chore PR. Caveat: staging reflects the last staging deploy — if any of the 90 application functions are missing, check `supabase migration list --linked` on staging and top the file up from a project at the repo head |
| **Live POS tenant baseline** (Strategy A evidence) | LIVE-EVIDENCE-BLOCKED | **Still needs one read-only query set** (canonical signals: `pos_shifts` ∪ `pos_terminals` ∪ `invoices.pos_shift_id` ∪ journal evidence; **not** `pos_settings`, **not** `audit_log.event_type='pos_sale'`, per gate G-3). Worth knowing: the repo already documents production POS evidence — the 2026-09-27 retail audit (§13 update 2) reports **no shift was ever opened** in production, with the till path never used; formalising that with the canonical signal set should be a five-minute read, not an open question |
| **Strategy-A safety check** | LIVE-EVIDENCE-BLOCKED | Follows the baseline read |
| **Frozen-decision contradiction scan** | CLEARED | Unchanged; Rev 1's independent survey surfaced no contradiction either |
| **Regression stack** | green except **5 FAILs** proven to be fixture month-rollover staleness (`DAY='2026-09-21'`) | **Closed 2026-10-09 (Step 4 done).** `DAY` now derives from the system date at module load, and a new `PAST` (yesterday) serves the period-lock suites that must close periods ending strictly before `current_date` (`tests/release/fixtures.ts:2`; `pl-period-approval.test.ts` and the H04 record in `ic-containment.test.ts` moved to `PAST`). Full harness re-run on this branch: **822 PASS / 0 FAIL / 56 BLOCKED** (56 = the gate's 54 + 2 LEGACY records for this branch's new `tests/database/` suites); `npm test` 941/941, `typecheck` and `test:release:types` clean. One harness repair was needed first: the release-harness pg_cron stub lacked `cron.unschedule`/`cron.alter_job`, so `20261017000000` aborted the entire replay (SQLSTATE 42883, 621 records BLOCKED) — `tests/release/bootstrap.sql` now provides pg_cron 1.5+-faithful stubs (ops doc §9.9) |
| **Owner product confirmations** | OWNER-DECISION-REQUIRED (frozen doc §K) | Unchanged — 9 items, e.g. NGO label, GOVERNMENT posture, `npo` template name, pin mechanism |
| **Incident/DB workstream (separate)** | — | `20261017000000` **applied + recorded** on production (2026-10-08); `20261018000000` **pending** (PR #197, with its own test harness). Deploy gate target is now `20261018000000` |

---

## 7. Next steps (the programme's order, with current status)

1. **Step 1 — exact types** (mostly done, §6): verify the regenerated file with
   `node scripts/ci/verify-regenerated-types.mjs src/dal/types/database.generated.ts`
   (gate §5.3 checklist with the §4 count corrections; prints the file's
   SHA-256), record old/new SHAs, run the stack, commit as a chore PR. *Do not
   regenerate from production* — `docs/database/database-operations.md` §2
   (amended by PR #197) makes staging the canonical source; production carries
   legacy-only objects.
2. **Step 2 — production POS baseline** (read-only): the canonical signal query
   set; produce the evidence artifact; do not backfill.
3. **Step 3 — owner confirmations** (frozen doc §K, 9 items). Nothing else can
   start before Steps 1–3 per the programme's own rule.
4. **Step 4 — fixture maintenance** (`tests/release/fixtures.ts` DAY): **done
   2026-10-09.** Fixture dates derive from the system clock (`DAY` = today for
   the metered month, `PAST` = yesterday for closable accounting periods); the
   release harness is fully green again — 822 PASS / 0 FAIL / 56 BLOCKED (§6).
5. **Step 5 — MUST phase implementation** in the frozen order: additive
   `businesses` columns + pin migration → capability resolver +
   `useCapability`/`CapabilityGate` (fail-open on absent `pos`) → central POS
   nav/route gate → onboarding capture + appended defaulted RPC params →
   `services` capability → tests A/B/H/I/J/K/L/O.

Two practical notes from this session that belong in Step 5's definition of
done:

- **Every capability that changes behaviour, not just screens, needs a
  server-side assertion.** The frozen rule (capability never in RLS/posting) is
  about not *widening* access; it does not license relying on nav visibility
  where a module's server behaviour differs. Today the only plan-derived rule
  enforced server-side is the document quota — `api_access`/`webhooks` are
  reachable through Edge Functions with no plan check
  (`supabase/functions/create-api-key`, `supabase/functions/api`).
- **Migrations must run under `db push` conditions, not editor conditions.**
  This session's production push failures (a raw `cron.job` write; an
  unqualified `gen_random_bytes`) both worked in the SQL editor and failed under
  `db push`. Any architecture migration should be validated with the new
  harnesses in `tests/database/` (`public_api_table_convergence`,
  `cron_placeholder_sweep`) and documented per `database-operations.md`
  §9.8–9.10.

---

## 8. What not to do (frozen doc + Rev 1, merged)

- No forking of app or database per vertical; no renaming `businesses`; no
  column-per-industry; no free-text project codes as a substitute for the memo
  dimensions; no `MIXED`/`PRODUCT_AND_SERVICE` values; no `NGO` type alongside
  `NON_PROFIT`.
- No capability logic in RLS or posting — the organisation layer narrows UI/
  reachability only; RLS stays role/tenant-based.
- No re-seeding of existing charts (COA templates are creation-only).
- No implementation before Steps 1–3; no fabricated types or tenant evidence
  (the gate's no-guessing rule).
- **No UI-only vertical differentiation presented as a platform.** Rev 1's
  point stands and the frozen design already respects it: the organisation
  layer can only narrow, and modules that change behaviour get server-side
  assertions (§7).

## 9. Owner decisions — mapping Rev 1's questions onto the frozen §K

| Rev 1 question | Status now |
|---|---|
| Commercial priority (NGO vs manufacturing vs construction) | Partly obsolete: NGO = NON_PROFIT + SHOULD-phase foundation is already decided; manufacturing/construction are **not in the programme** and would be a new decision. §K.1/§K.5 remain (NGO label, `npo` name) |
| One-time onboarding choice or switchable setting | Answered by design: defaults derive from the profile, overrides are explicit and sparse — i.e. switchable with admin control. §K.6 (pin mechanism) remains |
| May partners override a tenant's vertical preset? | Answered: partner is an AND layer — it can only narrow. §K.3 (pricing placement of `projects`/`grants` capabilities) remains |
| Plan feature or type feature? | Answered: both — Hybrid Option C composes them |

## Appendix — evidence index

| Claim area | Source |
|---|---|
| Frozen target model, vocabularies, phases, §K, invariants | `docs/audits/LEDGR_FINAL_MULTIBUSINESS_ARCHITECTURE_DECISIONS_2026-09-27.md` |
| Migration replay counts (79 tables / 21 views / 165 signatures / 235 policies / 70 triggers / 22 role labels), stale-type quantification, POS signals G-3, fixture diagnosis | `docs/audits/LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_2026-10-06.md` + `artifacts/database/gate-2026-10-06-migration-replay-catalog.json` |
| Blocked-gate attempts and unblock commands | `docs/audits/LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_FOLLOWUP_2026-10-06.md` |
| Programme steps 1–5, gate table, house rules | `docs/audits/LEDGR_MULTIBUSINESS_IMPLEMENTATION_HANDOFF_2026-10-06.md` |
| Retail depth + production POS usage evidence | `docs/audits/LEDGR_RETAIL_READINESS_2026-09-27.md` §2, §12–13, §16–18 |
| Segment gaps background | `docs/audits/LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` §5–6 |
| Plan capabilities / POS ungated | `src/lib/billing/plans.ts`; `src/App.tsx:242`; `src/components/layout/navConfig.ts:52` |
| 18-param RPC, no defaults | `supabase/migrations/20260815000000_phase8b_reconstruct_rpcs.sql` |
| Types/views/tables drift re-verification (incl. the §4 count corrections), fixture-date fix, gate-A checklist script | `src/dal/types/database.generated.ts`; `artifacts/database/gate-2026-10-06-migration-replay-catalog.json`; `tests/release/fixtures.ts`; `scripts/ci/verify-regenerated-types.mjs` |
| Production DB drift repair (separate workstream) | PR #197; `supabase/migrations/20261018000000_repair_legacy_public_api_tables.sql`; `docs/database/database-operations.md` §9.8–9.10 |
