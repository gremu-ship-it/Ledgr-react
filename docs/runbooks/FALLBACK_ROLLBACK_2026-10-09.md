# Multi-business / capability-layer fallback and rollback

**Date:** 2026-10-09  
**Scope:** protect the existing Ledgr platform while the frozen multi-business architecture is implemented and rolled out.  
**Status:** fallback plumbing is prepared; the capability layer itself is **not active or integrated**. This does not clear the programme's Step 1–3 gates.

## 1. The safety model

The frozen architecture composes capabilities as:

```text
EFFECTIVE = SUBSCRIPTION ∧ PARTNER ∧ ORGANISATION ∧ ROLE
```

The organisation layer may narrow access to a module; it must not be placed in RLS or posting rules. For a rollback, turn off **only** the organisation layer and return to the pre-multibusiness composition:

```text
ROLLBACK = SUBSCRIPTION ∧ PARTNER ∧ ROLE
```

This fallback does **not** bypass existing tenant isolation, role checks, plan/partner behaviour, server-side quota checks, or posting/integrity rules. It also does not convert any UI-only plan or partner gate into a server-side security control. Do not disable RLS, `can_operate_pos`, quota assertions, or ledger controls to recover availability.

The resolver prepared in `src/lib/capabilities/resolve.ts` is synchronous and performs no network/database I/O. It preserves the frozen POS compatibility rule: when the organisation layer is enabled, a *missing* `pos` decision fails open, but an explicit `pos: false` still narrows access. Missing non-POS decisions do not fail open. With the kill switch off, the organisation decision is ignored and the other three inputs remain effective.

## 2. What is live today—and what is not

| Mechanism | Verified state | Operational meaning |
|---|---|---|
| `VITE_FEATURE_*` (`src/lib/featureFlags.ts`) | Build-time environment flags; defaults are in source | They are **not** remote/runtime switches. Changing a GitHub Actions variable takes effect on the next build/deploy, not in an already-loaded bundle. |
| `capability_org_layer` | Defaults to **false**; deploy workflow passes an explicit false default for staging and production | Safe-off until the gated architecture rollout opts in. `VITE_FEATURE_CAPABILITY_ORG_LAYER=true` enables it only for a build that consumes the resolver. |
| `resolveCapability()` | Pure helper with unit tests; no production callers yet | Fallback contract is tested, but no current app behaviour changes. Step 5 must route every organisation-capability gate through this resolver/provider. |
| Supabase migrations | Deploy workflow pushes migrations before the frontend; the migration target is verified | New architecture migrations must remain additive and backward-compatible. Turning the frontend layer off does **not** undo a database migration or delete captured organisation data. |
| Client recovery | `ErrorBoundary` shows a retry screen; `chunkRecovery.ts` retries one deployment-related chunk failure per session; the PWA uses `registerType: 'autoUpdate'` and Workbox caching | Helps with render/chunk/network failures and app-shell continuity; it cannot roll back a harmful feature, catch all async errors, or undo a database migration. |
| Build-size signal | The local production build in this checkout passed but Vite warned that `vendor` was 904.41 kB raw / 278.11 kB gzip (>800 kB configured warning threshold) | No pre-change comparison was captured, so this cannot be attributed to the fallback scaffold. Record the same bundle metrics for the prior release before using it as a rollout regression threshold. |
| Sentry / Vercel telemetry | Sentry initialises if `VITE_SENTRY_DSN` is present; Web Analytics and Speed Insights are mounted in `src/main.tsx` | Instrumentation exists, but `docs/ops/SLOs.md` says the dashboards/alerts are not yet wired to the draft SLIs. Do not assume automated performance paging until verified. |

### Environment controls wired into CI

`.github/workflows/deploy.yml` reads these **GitHub Actions Variables** (not secrets) and forwards the selected value to the Vite build:

- `VITE_FEATURE_CAPABILITY_ORG_LAYER_STAGING`
- `VITE_FEATURE_CAPABILITY_ORG_LAYER_PROD`

Both default to `false` if unset. Only set one to `true` for an approved rollout after the programme gates and staging checks pass. Never put credentials or tenant data in these variables.

## 3. Before enabling it

1. Clear programme Steps 1–3 in `docs/audits/LEDGR_MULTIBUSINESS_IMPLEMENTATION_HANDOFF_2026-10-06.md`: exact staging type regeneration/checklist, read-only production POS baseline, and the frozen owner decisions. Keep Strategy A evidence read-only; do not backfill based on guesswork.
2. Keep the feature variable false by default. Turn it on in **staging only** for the first implementation build.
3. Verify tests prove both modes:
   - **off:** outcomes match the pre-architecture subscription/partner/role behaviour;
   - **on:** all four layers compose, organisation can only narrow, and an absent `pos` pin remains available;
   - plan/partner/role denials remain denials with the kill switch off;
   - no change to RLS, posting, or ledger arithmetic.
4. Keep capability resolution O(1) and local to already-loaded business state. Resolve once per active business/session; never query `capability_overrides` once per route render, nav item, table row, or component. If the flag is off, the capability provider must skip organisation-only fetches/subscriptions too—bypassing the final boolean while continuing expensive data loads is **not** a performance fallback.
5. Capture a staging baseline before/after: frontend errors, page/route load and Web Vitals, relevant Supabase request count and latency, and business flows for retail/POS, service, and non-profit. The current SLO document is draft; first verify the dashboards actually receive data and alerts.
6. Roll out to a small, explicitly selected pilot before broad production exposure. Keep the prior production deployment identifiable and available; record its deployment URL/ID, commit SHA, migration target, and flag value in the release note.

**Proposed initial performance trigger (owner approval needed before production):** roll back if p95 route/page-load latency is >20% above the same-route baseline for 15 consecutive minutes, or if error rate reaches the existing draft SLO threshold (≥2% for 10 minutes). Any tenant-isolation, permission, posting, or ledger-integrity regression is an **immediate** stop/rollback—do not wait for a percentage threshold. These thresholds are operational proposals, not currently automated alerts.

## 4. Rollback procedure

### A. Whole frontend regression or app-wide performance incident — fastest recovery

1. Stop further rollout and announce the incident to the operator/owner.
2. In the canonical production Vercel project (`ledgr-react`, not the `-prod` project which is staging per `docs/runbooks/VERCEL_PROJECT_CONSOLIDATION.md`), use the Vercel Deployments UI to promote/restore the last known-good frontend deployment, if that control is available for the project. Otherwise redeploy the recorded known-good commit through the existing protected workflow; do not create an ad-hoc build with unknown environment variables.
3. Verify login, business switching, core accounting, POS, and a representative write/read path; inspect Sentry/Vercel telemetry and Supabase logs.
4. Leave already-applied additive migrations in place. Do not delete columns, erase overrides, alter migration history, or attempt a destructive database rollback during incident recovery.

A frontend rollback restores the old client, **not** the old database. This is why every architecture migration must be additive and old-client-compatible. If that cannot be guaranteed, the migration is not ready to ship.

### B. Organisation-capability regression only — disable the layer

1. Set the matching GitHub Actions variable to `false`:
   - staging: `VITE_FEATURE_CAPABILITY_ORG_LAYER_STAGING=false`
   - production: `VITE_FEATURE_CAPABILITY_ORG_LAYER_PROD=false`
2. Run the existing `deploy.yml` `workflow_dispatch` for the affected environment from the approved implementation ref. This rebuilds the bundle with the organisation layer off; the workflow still performs its normal migration-target checks and backend-first deploy sequence.
3. Verify the delivered build/commit and repeat the core-flow smoke checks. Confirm subscription, partner, and role outcomes are unchanged and the organisation-only resolver/data fetch is bypassed.

This is a **build-and-deploy** switch, not an instant server-side toggle. Its scope is the organisation capability layer and organisation-capability-only reads; it does not undo onboarding/profile UI, newly written organisation metadata, or unrelated frontend changes. For those or any broad regression, use procedure A first if that is faster; then deploy with the flag off. Do not tell users that editing a GitHub variable alone changes already-open browser sessions or an already-deployed bundle.

### C. Migration/schema problem

1. Stop the rollout. Confirm the actual migration state with `supabase migration list --linked` on the target project and inspect the deploy evidence; do not infer applied state from a SQL-editor run.
2. Keep the front-end capability flag off or restore the last known-good frontend.
3. If a migration has been applied, use a new forward repair migration after testing under `supabase db push` conditions. Do not edit an applied migration, delete `schema_migrations` records, or drop organisation fields/overrides to simulate a rollback.
4. Regenerate types from staging only after the schema repair is applied, then run the typecheck/release stack.

## 5. Acceptance criteria for the implementation PR

- The flag defaults off in both code and deploy workflow; only an explicit per-environment opt-in activates it.
- Automated tests cover on/off composition, absent and explicit-false POS pins, and prove the kill switch does not bypass subscription/partner/role inputs.
- The app's capability provider short-circuits organisation-only fetches when off and resolves once per business/session; tests or network evidence show no per-render/per-row query multiplication.
- Staging proves the existing flows and database integrity; performance is compared with a recorded baseline before any production opt-in.
- The new migration is additive, old-client-compatible, and validated using the `tests/database/` harnesses and `db push`-condition lessons in `docs/database/database-operations.md` §9.8–9.10.
- Runbook, prior known-good deployment ID, flag value, migration target, and tested rollback are attached to the release record.

## References

- Frozen architecture and rollback semantics: `docs/audits/LEDGR_FINAL_MULTIBUSINESS_ARCHITECTURE_DECISIONS_2026-09-27.md` §G, §J, §O.
- Programme gates and release order: `docs/audits/LEDGR_MULTIBUSINESS_IMPLEMENTATION_HANDOFF_2026-10-06.md`.
- Current monitoring maturity: `docs/ops/SLOs.md`.
- Deployment sequencing/project identity: `.github/workflows/deploy.yml`; `docs/runbooks/VERCEL_PROJECT_CONSOLIDATION.md`.
- Resolver and kill switch: `src/lib/capabilities/resolve.ts`; `src/lib/featureFlags.ts`.
