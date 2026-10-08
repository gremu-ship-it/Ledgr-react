# LEDGR — MULTIBUSINESS ARCHITECTURE: IMPLEMENTATION HANDOFF

**Prepared:** 2026-10-06 · **On branch:** `arena/01a0e2d8-ledgr-react` · **PR:** #198
**Purpose:** read this first when resuming work in a new session. It is a
self-contained map of where the multibusiness architecture programme stands,
what has been proven, what is blocked, and the exact next steps — with pointers
into the detailed evidence so you do not need to re-derive anything.

---

## 0. One-paragraph situation report

The **design is finished and frozen**. The repository's authoritative schema
(120 migrations) has been fully re-baselined and proven to replay cleanly;
generated TypeScript types are **known-stale** by a quantified amount; the
existing capability model, POS surface, and RPC creation contract are verified;
and the full regression stack is green except five harness checks proven to be
a stale test fixture (not a product bug). **No architecture code has been
written.** Two environment-gated items remain before implementation may start:
exact type regeneration (needs Docker or live project access) and a read-only
production POS tenant capture. A handful of owner product confirmations are
also required before the first implementation PR.

---

## 1. Documents & artifacts (read in this order)

| Order | Path | What it gives you |
|---|---|---|
| 1 | `docs/audits/LEDGR_FINAL_MULTIBUSINESS_ARCHITECTURE_DECISIONS_2026-09-27.md` | **The spec.** All frozen architecture decisions, capability vocabulary, POS strategy, test matrix A–O, phased plan (MUST/SHOULD/DEFERRED), pending product questions (§K), implementation contract. |
| 2 | `docs/audits/LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_2026-10-06.md` | **The evidence the spec is sound vs. reality.** Migration re-baseline, RPC verification, capability baseline, wholesale check, contradiction scan (G-1…G-10), regression results, 6 prerequisites. |
| 3 | `docs/audits/LEDGR_PRE_IMPLEMENTATION_ARCHITECTURE_GATE_FOLLOWUP_2026-10-06.md` | **Why the two remaining gates are blocked** (with the exact commands to clear them) and the final classifications. |
| 4 | `docs/audits/LEDGR_ARCHITECTURE_VALIDATION_2026-09-27.md` | Background: C1–C14 validation of the original audit. |
| 5 | `docs/audits/LEDGR_MULTI_ORGANISATION_ARCHITECTURE_AUDIT_2026-09-27.md` | Original 25-point audit (superseded by the frozen decisions; for history). |
| Artifacts | `artifacts/database/` | `gate-2026-10-06-migration-replay-catalog.json` (authoritative schema dump: tables/views/functions w/ defaults+SECURITY DEFINER/enums/235 policies/grants/70 triggers + per-migration SHA-256) · `database.generated.pre-regen.ts` (byte-exact backup of stale types, SHA `0f80b6f5…`) · `database.generated.gate-2026-10-06.approx.ts` (catalog-faithful approximation, **clearly labelled approximate — never substitute for CLI output**, SHA `bd35a808…`) |

---

## 2. The frozen design (do not re-negotiate without owner decision)

- **Organisation type:** column on `businesses` — `FOR_PROFIT | NON_PROFIT | GOVERNMENT | OTHER`. **NGO = NON_PROFIT** (NO `NGO` type). Terminology/billing/COA-flavoured, never RLS/posting.
- **Operating model:** `text[]` on `businesses` — `RETAIL | WHOLESALE | PRODUCT_SALES | SERVICE_SALES | PROJECT_BASED | GRANT_FUNDED` (multi-select). **Forbidden:** `MIXED`, `PRODUCT_AND_SERVICE`.
- **Capability model — Hybrid Option C:** `EFFECTIVE = SUBSCRIPTION ∧ PARTNER ∧ ORGANISATION ∧ ROLE`
  - Derived defaults computed in code from org type + operating models (not stored).
  - Admin override = sparse `capability_overrides jsonb` on `businesses`; override wins where the key exists.
  - Effective capability recomputed on read; organisation layer **only narrows**, never RLS or posting.
  - **Existing tenants PINNED** to their current effective capability set.
- **POS — Strategy A:** `pos = true` for all **existing** businesses (backfill as pin); fail-open when the `pos` key is absent (clean rollback). New businesses derive from operating models.
- **Capability gates today:** subscription plans (`src/lib/billing/plans.ts`, tiers free/starter/growth/pro/enterprise, `PlanCapability` has **no `pos` key**) + partner features (`PartnerFeatureKey`, `partner_feature_flags`) + role allowlists (`src/hooks/usePermissions.ts`). POS nav is currently un-gated — adding the org gate is the planned delta.
- **NGO foundation (SHOULD phase):** tables `projects`, `funding_sources`; **memo-only** `project_id`/`funding_source_id` on `journal_entries` + `expenses` (never touch debit/credit/account/balance); `npo` COA template applied **at creation only** (never re-seed existing charts). Do NOT expand into donor reporting / fund automation (DEFERRED).
- **Wholesale:** AR ageing is a **primitive** (`v_ar_ageing` view + `ContactRepository.getArAgeing()` + `days_overdue`; no `.tsx` consumer, no Reports tab). SHOULD-phase: wire a report screen over the existing view. Do not claim wholesale is complete before that.
- **RPC contract:** `create_business_with_owner` = 18 positional params, 0 defaults, `security definer`. Extend **only by appending SQL-defaulted params**; update the `REVOKE/GRANT ON FUNCTION …(signature)` statements in the same migration.

## 3. Verified facts you can rely on (don't re-verify)

1. **All 120 migrations replay cleanly** end-to-end on Postgres 17.10 (disposable embedded replay via `tests/release/database.mjs`). Authoritative surface: **79 tables · 21 views · 165 function signatures (131 app fns) · 16 enums · 235 RLS policies · 70 triggers**. Full dump: `artifacts/database/gate-2026-10-06-migration-replay-catalog.json`.
2. **`create_business_with_owner` signature** verified live in the catalog (§6 of gate report); all 4 call sites catalogued (app + 2 harness + generated types).
3. **POS-usage signals (for any tenant-evidence work):** use `pos_shifts.business_id` ∪ `pos_terminals.business_id` ∪ `invoices.pos_shift_id IS NOT NULL` ∪ journal evidence (`journal_entries.posting_key LIKE 'invoice:%:sale'`, `source_type='pos_void'`). **Never** use `pos_settings` (config-only, no enable flag — re-verified) or `audit_log.event_type='pos_sale'` (**no canonical producer exists** — frozen doc's signal list was superseded by the gate finding G-3).
4. **`businesses` columns (35)** verified; contains NO org-type / operating-models / capability / industry column today. No `subscriptions` table — plan state is on `businesses.plan_tier`/`plan_expires_at`. No `projects`/`funding_sources`/`capability_overrides` — yet.
5. **Stale generated types quantified** (the checklist for the regen diff): missing **11 tables** (`pos_terminals, pos_approvals, pos_corrections, pos_price_overrides, pos_shift_closes, pos_shift_late_adjustments, offline_queue_reconciliations, phone_accounts, invoice_approvals, invoice_approval_policies, accounting_period_events`), **14 views** (12 `v_ai_*` + `v_ai_*` siblings + `v_inventory_balance_ledger_drift`), **88 app functions**, **9 enums**; column drift on **5 tables** (`invoices`: `pos_shift_id,payload_hash,submitted_by`; `pos_shifts`: `terminal_id,open_command_key`; `pos_cash_movements`: `command_key`; `business_invitations`: `phone,role_assignment_authorized`; `webhooks`: `consecutive_failures`). Details: gate report §5.3.
6. **Regression baseline at `4d9aa636`:** `tsc` clean · eslint 0 errors/4 warnings (2 pre-existing) · **920/920 unit tests** · `test:release:types` clean · build OK · release harness **2× deterministic** `817 PASS / 5 FAIL / 54 BLOCKED` (exit 1). The 5 FAILs = `R10.QUOTA.*`+`R093.*POLICY*` family, **root-caused** to `tests/release/fixtures.ts: DAY='2026-09-21'` being outside `date_trunc('month', current_date)` metering after Oct 1 (gate report §11.4, two-sided DB proof: current-month usage still raises the expected `P0QLT`). Not a product regression; do not delete the tests.
7. **Live-shape convention:** 7 columns are `text` in migrations but `uuid` on production (owner-confirmed); any live-shaped replay must set `LEDGR_R13_LIVE_UUID_SHAPE=1` (handled inside `tests/release/database.mjs`).
8. **RLS/grants:** all POS tables RLS-enabled; `pos_approvals`/`pos_corrections` have **0 policies by design** (SECURITY DEFINER command path only — R01/R07 pattern). Not a defect.

## 4. What remains to be done (acceptance checklist)

### Step 1 — Exact type regeneration (REQUIRED first; ~30 min on a capable machine)
- [ ] On a machine with **Docker** (shadow replay) or **live project access**, run:
      `npx supabase gen types typescript --project-id <ref> > src/dal/types/database.generated.ts`
      (or `supabase db reset` + `--db-url` against a Docker shadow DB).
- [ ] Diff against gate-report §5.3 — must surface all 11 tables / 14 views / 88 fns / 9 enums / 5 column fixes.
- [ ] Record old/new SHA-256 (`0f80b6f5…` is the old one). Commit as its own chore PR.
- [ ] Run `npm run typecheck && npm run lint && npm test && npm run test:release:types && npm run build`.
- **Why from outside the sandbox:** the E2B sandbox has no Docker/podman, no Supabase access token, and the repo-pinned CLI 2.119 requires Docker for `--db-url`. The approximation was deliberately NOT substituted (anti-fabrication rule).
- **Nice-to-have afterwards:** CI drift check that regenerates types and fails on diff, so a full cycle of staleness can't reaccumulate.

### Step 2 — Production POS baseline (required before ANY backfill; read-only, ~15 min)
- [ ] With read-only production access, run the signal query set (see §3.3):
      counts of businesses with pos_shifts / pos_terminals / pos_shift_id invoices / POS journal evidence; total businesses; union; contradictions; no-signal businesses.
- [ ] Produce the evidence artifact described in gate report §13-B-2 / follow-up §5.2. Do **not** modify anything; do **not** backfill.
- [ ] Assess Strategy-A mechanics (pin set = all existing businesses; fail-open on absent key). Do not reopen the decision — report anomalies only.

### Step 3 — Owner product confirmations (from frozen doc §K; no new questions added since)
- [ ] NGO folded into `NON_PROFIT` (label decision) — confirm.
- [ ] Operating-model array shape + dropping `MIXED`/`PRODUCT_AND_SERVICE` — sign off.
- [ ] Capability ↔ subscription tier mapping (which plans get `pos` etc.).
- [ ] `npo` COA template name; tenant pin mechanism (how existing effective capabilities are snapshot).
- [ ] GOVERNMENT posture; memo-dimension granularity (header vs line) re-confirm for foundation phase.
- [ ] Whether the migration-defined schema vs live-shape (7 uuid columns) needs a one-off live re-baseline note in the release plan.

### Step 4 — Test health maintenance (can be done anytime)
- [ ] Fix `tests/release/fixtures.ts` `DAY` staleness (derive current-month date dynamically) so `test:release` returns 822 PASS again. Test-only change; keep evidence note.

### Step 5 — Implementation (MUST phase, per frozen doc §J) — ONLY after Steps 1–3
Order: `businesses` profile columns (+ `organisation_type`, `operating_models text[]`) → pin migration for existing tenants (Strategy A: pos=true) → effective-capability resolver (plan ∧ partner ∧ org ∧ role; fail-open on absent pos key) → POS gate on nav/route → onboarding org-type/models question (extend `create_business_with_owner` by **appended defaulted params only**) → services capability exposure → test matrix A/B/H/I/J/K/L/O. SHOULD/DEFERRED phases follow exactly as frozen.

## 5. Environment & housekeeping notes for the next session

- **Branch/session:** work continues on `arena/01a0e2d8-ledgr-react` (this session is pinned to it). PR #198 carries all audit evidence onto `main`.
- **`node_modules` does NOT persist** in this sandbox between turns — first action in a new turn: `cd /home/user/Ledgr-react && npm ci`.
- **Build needs placeholder env** (matches CI):
  `VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder-anon-key npm run build`.
- **Release harness:** `npm run test:release` (local-only; refuses external DB config by design). Evidence lands in `.cache/r13/ledgr-r13-*/evidence.json`. Non-root required (sandbox user is fine).
- **Schema source of truth order** (per gate authorization): migration chain → RLS/functions → frozen decisions doc → application code → generated types (only after exact regen).
- **The production-integrity incident workstream is separate** (see gate report §12 semantics; migrations `2026101x_ic_*`, `ledgr_repair_2026_09`, etc.). Do not mix historical data repair into architecture work.
- **Files to never fabricate:** exact generated types; production tenant evidence; live-schema captures. Mark unavailable as BLOCKED instead (the no-guessing rule).

## 6. Current gate verdicts (as of this handoff)

| Gate | Status | Clearing action |
|---|---|---|
| Exact type regeneration | **ENVIRONMENT-BLOCKED** | Step 1 (Docker or live access) |
| Live POS tenant baseline | **LIVE-EVIDENCE-BLOCKED** | Step 2 (read-only production access) |
| Strategy-A safety check | **LIVE-EVIDENCE-BLOCKED** | follows Step 2 |
| Frozen-decision contradiction scan | **CLEARED** | none found this gate |
| Regression stack | green (with 5 documented, diagnosed fixture-stale FAILs) | Step 4 restores full green |
| Product confirmations | **OWNER-DECISION-REQUIRED** | Step 3 |
| Architecture implementation readiness | **NOT READY → ready after Steps 1+3** | — |
| POS backfill readiness | **NOT READY → ready after Steps 2 (+1,3)** | — |

**Do not begin implementation until Steps 1–3 are complete. Stop after each
evidence step and record it before proceeding (the programme's no-guessing,
evidence-first rule).**
