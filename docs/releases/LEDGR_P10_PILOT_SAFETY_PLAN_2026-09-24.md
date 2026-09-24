# LEDGR CONTROLLED PILOT — Pilot Safety Plan

**Date:** 2026-09-24
**Release:** `LEDGR CONTROLLED PILOT` (`6f5843b`, branch `arena/01a0c215-ledgr-react`)
**Mode:** `PILOT / LIMITED CONTROLLED USERS` — invited cohort only
**Owner authorization:** `GO — Limited Controlled Release` (`6f5843b`)
**Evidence baseline:** `742 PASS / 0 FAIL / 52 BLOCKED / 794` + `807` unit + `tsc -b` PASS + `lint` 0e/3w + `build` PASS

> This plan does not expand scope, does not remediate B/C/D, and does not claim full commercial readiness. The pilot is bounded to the 20 certified capabilities in `LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` §3.

---

## 1. Pilot Audience

**Controlled users only — invited cohort, not public.**

- Do **not** invent customer names here. The actual invited business list is managed out-of-band by the product/release owner (e.g., allowlist in application admin or manual `businesses.subscription_status`/`plan_tier` assignment via owner/admin tooling).
- Invited businesses are expected to be **representative of the certified scope**: POS/till with branches, inventory-tracked products, offline-capable devices, and standard journal/payment flows. They are **not** expected to exercise excluded scope (Storage path isolation, provider-token recovery, browser→PostgREST revalidation, app-wide branch admin create/modify, generic offline conflict/multitab, full Stripe subscription lifecycle).
- Maximum cohort size is **not set by code** in P10 — it is a business decision for PILOT. However, quota (`P0QLT`, `ledgr_monthly_document_count`) is enforced identically for every business regardless of cohort size.
- Each invited business operates in its own tenant (`business_id`); P6 two-business isolation proves no cross-tenant access. No pilot user may be added to two pilot businesses simultaneously for the purpose of cross-tenant testing without owner approval (would test outside certified multi-business isolation contract).

**Entry criteria for a pilot business:**

- Business owner/admin is available for feedback and can be contacted directly (pilot, not anonymous self-serve).
- Business has been briefed that the following are **out of scope / not certified**: Storage isolation, provider-specific auth, browser-real JWT revalidation, app-wide branch admin, full commercial subscription. They must not rely on those claims.
- Business operates within the **15 accepted limitations** (e.g., customers/journal org-wide, reports org-wide except POS shift report branch-enforced — see release candidate §5).

**Exit from pilot:** Remove from invited cohort (revoke access or expire plan tier via owner/admin), no data wipe required; financial history remains immutable.

---

## 2. Scope Controls

**Users must operate only within the certified scope. The product already enforces most boundaries server-side; pilot process adds human guardrails.**

| Control | Mechanism | Where enforced |
|---|---|---|
| **Tenant isolation** | RLS `is_business_member` + separate `pg` clients (P6) | DB RLS + `SECURITY DEFINER` `is_business_member` |
| **POS/till `post_pos_sale` only** | Direct `supabase.from('invoices').insert` for POS is not the certified path; POS must go through `post_pos_sale` | `src/services/posService.ts` `supabase.rpc('post_pos_sale')` |
| **Branch — till family only** | `can_access_branch` DEC-03 fail-closed, checked in `post_pos_sale` + `pos_shifts`/`pos_cash_movements` | DB `can_access_branch` SECURITY DEFINER |
| **Stock `23514` + `FOR UPDATE`** | `trg_stock_movement_apply_balance` row-lock + `stock_nonnegative` | DB trigger + constraint |
| **Quota `P0QLT`** | `_ledgr_assert_usage_limit` `FOR UPDATE` + `P0QLT` on `post_pos_sale`/`save_quick_*` + uniform `BEFORE INSERT` | DB trigger `20261001000000`/`20261006000000` |
| **Offline `RECONCILABLE` only** | `stock-denied`/`policy-denied` only; `branch-denied`/`stale-version`/`unknown-version`/`payload-tampered` quarantined | `src/offline/exceptions.ts` + `reconciliation.ts` + `payloadIntegrity.ts` |
| **Financial immutability** | Corrections add new journals; `pos_shift_closes` immutable `22023` | DB + `R08.CLOSE-IMMUTABLE` |
| **AI read-only** | `ai_context` `security_invoker` + RLS + no `insert/update/delete` on AI path | `src/lib/ai/context.ts` RPC only |

**Human scope controls:**

- Do **not** invite a pilot user and then ask them to "try to create a branch in another branch" or "test Storage isolation" — those are deferred `D`/`B` and outside pilot certification. If such a test is desired, STOP and request a separate authorization (Future Packages A–F).
- Pilot briefing document (owner-provided) must list **excluded scope** verbatim from `LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` §4 so users do not assume guarantees that were explicitly excluded.
- No pilot user is granted `service_role` or Supabase `auth.admin` — access is `authenticated` only.

**What pilot users must not do (and what happens if they do):**

- Attempting a deferred operation (e.g., raw `branches` insert for another branch, direct Storage path probe, provider-token replay) will either be denied (`42501`/`403`) or succeed under the current org-wide contract (which is documented as not branch-isolated). **Neither outcome is a security regression** under P8 classification — but it must be logged as `OBSERVE → CLASSIFY` (see §4) and not silently treated as proof.

---

## 3. Monitoring

**Define what is monitored during the pilot (representative operating cycle, not demo data).** Use existing observability: Supabase logs, Edge Function logs, Sentry, Vercel Analytics, `audit_log`, `pos_shifts`/`pos_shift_closes`, `offline_queue_reconciliations`, `journal_entries` integrity checks.

### 3.1 Signals

| Signal | Query / source | Threshold / action |
|---|---|---|
| **Failed transactions** | `supabase.rpc('post_pos_sale')` error `code` = `42501` / `23514` / `P0QLT` / `22023` (typed), plus `UsageLimitError` / `StockError` in client | Count by code per day per business. `42501` branch/terminal denial is expected when permission boundary is tested; `23514` is expected when stock insufficient; `P0QLT` is expected at quota edge. Alert on spike vs baseline. |
| **Authorization denials** | `42501` from `post_pos_sale`, `reconcile_offline_queue_item`, `get_pos_shift_report`, `ai_context` | Log `business_id`, `user_id`, `branch_id`, `terminal_id`, `code`. Denial is proof boundary works — not an incident unless denial bypass is suspected (would be `A` defect → STOP). |
| **Stock anomalies** | `inventory_balances` vs `stock_movements` sum, negative `on_hand` (should be `23514`-blocked), `trg_stock_movement_apply_balance` failures | Run `POST_REMEDIATION_VERIFICATION` `stock_movements` integrity check daily. Any negative balance post-`post_pos_sale` = blocker → STOP. |
| **Duplicate postings** | `invoices.client_key` / `offline_queue` `clientKey` idempotency, `journal_entries` count vs expected | Check `REGRESSION.SUCCESS-CLIENTKEY` idempotency: same `client_key` re-play must not double-post. Duplicate with same key = investigate `client_key` reuse. |
| **Queue failures** | `offline_queue` (Dexie) `status` = `failed` / `quarantined` vs `completed`, `lease` exclusive, `provenance` unverifiable sweep | Track `isReconcilable` disposition: `stock-denied`/`policy-denied` are reconcilable; `branch-denied`/`stale-version`/`unknown-version`/`payload-tampered` must remain quarantined/failed, never retried blindly. Alert on growing `quarantined` queue. |
| **Quota failures** | `P0QLT` from `post_pos_sale` / `save_quick_*` / `BEFORE INSERT` vs `UsageService.getCurrentMonthTransactionCount` vs `ledgr_monthly_document_count` RPC | Compare client `isQuotaDenial` typed signal vs server `P0QLT`. Any `P0QLT` is authoritative; client guard is early UX only. Monitor `percentUsed` per business (`getUsageStats`) for plan tier. |
| **Unexpected application errors** | Sentry (`VITE_SENTRY_DSN`), `logger.ts`, `ErrorBoundary` | Any `is_business_member` / `can_access_branch` / `post_pos_sale` regression (A defect) → STOP. Non-certified surface error (e.g., Storage path) → classify as OUT-OF-SCOPE, not P10 blocker, but document. |

### 3.2 Dashboards / ownership

- **Owner + release engineer** review weekly during pilot cycle: transaction success rate, `42501`/`23514`/`P0QLT` breakdown, stock integrity, offline queue depth, quota headroom, Sentry error triage.
- **Pilot businesses** have access to their own POS shift reports (`get_pos_shift_report` branch-enforced) + P&L / balance sheet — no cross-tenant visibility (verified P6).

### 3.3 Data integrity checks (run before/after pilot window)

- `POST_REMEDIATION_VERIFICATION.md` checks: R05 journal invariants (`journal_entries` balanced), R06 stock (`23514` + `FOR UPDATE`), R07 corrections, R08 till/shift, P5-C quota, P6 tenant isolation sample.

---

## 4. Incident Handling

**Do not automatically alter financial records.**

```text
OBSERVE
→ CAPTURE EVIDENCE
→ CLASSIFY
→ CONTAIN
→ ESCALATE
```

### 4.1 OBSERVE

Notice anomaly via monitoring (§3). Keep reporter + timestamp + `business_id` / `user_id` / `branch_id` / `client_key` / `terminal_id` / error `code`.

### 4.2 CAPTURE EVIDENCE

- Screenshot / screen recording
- `supabase` response `{ code, message, details, hint }` verbatim — preserve typed codes `42501`, `23514`, `P0QLT`, `22023`
- Dexie `offline_queue` entry (`localId`, `payload`, `payloadVersion`, `hash`, `provenance`, `attempts`, `exceptionClass`) if offline-related
- Sentry event ID
- `audit_log` entry if relevant
- Git commit (`6f5843b`) + env (`VITE_SUPABASE_URL` hostname, not value) + app version

Do **not** delete the failed/flagged row to "fix" — preserve for `post_pos_sale` / trigger forensic.

### 4.3 CLASSIFY

| Class | Meaning | Example |
|---|---|---|
| **In-scope certified** | Failure in a certified 20 capability — potential blocker | `post_pos_sale` bypass, `is_business_member` cross-tenant read, negative stock without `23514`, `P0QLT` not raised when over limit, `reconcile_offline_queue_item` non-manager succeeds, `ai_context` leaks other tenant |
| **Out-of-scope deferred** | Observation touches an excluded/B/C/D surface | Storage `403`, provider-token replay attempt, `R094` browser revalidation, `BRANCH.create` org-wide write succeeds (expected under current org-wide contract), generic multitab conflict |
| **Operational** | Misconfiguration / network / user error, not product defect | `VITE_SUPABASE_URL` unset → `<ConfigError />`, `navigator.onLine false` offline queue, wrong `plan_tier` for business |

- In-scope classified findings go to `PILOT INCIDENT` register (owner + engineer) with `STOP` assessment (see §4.5).
- Out-of-scope findings are **not** treated as P10 defects — document as `DEFERRED OBSERVATION` in the pilot retrospective, do not fix in P10.

### 4.4 CONTAIN

- **Never** edit `journal_entries`/`journal_lines`/`inventory_balances` directly to "repair" a balance. Use the certified correction path: new reversing journal via correction/refund/void where available, or admin-reviewed migration for data repair (separate authorization).
- If credential/secret suspected leaked, do **not** auto-rotate per P10 §7 hard stop — report as release blocker to owner immediately.
- If pilot business data is at risk, remove business from pilot cohort (revoke access) while preserving data — do not drop `business_id` rows.

### 4.5 STOP conditions (P10 §21 Hard Stops)

Immediately **STOP** pilot and escalate to owner if any of:

1. Approved-scope security property regresses (e.g., cross-tenant read succeeds, `can_access_branch` bypass)
2. Approved-scope financial-integrity test fails (e.g., `23514` not enforced, journal imbalanced, `post_pos_sale` posts without `P0QLT` when over limit)
3. Real secret discovered in client/tracked material
4. Release configuration exposes `service_role` authority to browser
5. Deferred capability becomes enabled accidentally (e.g., `BRANCH.create` reshape slipped into build)
6. Business-logic modification appears necessary to keep pilot alive
7. RLS/`SECURITY DEFINER`/migration change appears necessary
8. Release would exceed P9 certified scope
9. Production deployment requires unavailable authorization
10. Release candidate cannot be honestly described as controlled pilot

Do **not** solve by weakening tests or reclassifying `A`→`C`.

### 4.6 ESCALATE

- Owner + release engineer within **one business day** for in-scope blocker; **immediately** for security/financial-integrity/secret.
- Engineer files `docs/releases/LEDGR_P10_PILOT_INCIDENT_<date>.md` with observe/capture/classify/contain/escalate narrative. No silent fix.

---

## 5. Rollback

**Document the available rollback mechanism based on the actual deployment architecture. Do not invent a capability that does not exist.**

### 5.1 Actual deployment architecture (from `DEPLOYMENT.md` + `.github/workflows/deploy.yml`)

- **Frontend:** Vercel (`vercel --prod` via GitHub Actions `deploy.yml`), per-env `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` via `--build-env` (separate `STAGING` `vars.*_STAGING`/`secrets.*_STAGING` vs `PROD` `*_PROD`), plus `vercel deploy` preview branch.
- **Database:** Supabase `supabase link --project-ref` + `supabase db push --include-all` (55 migrations forward-only, no auto-down-migration). `major_version 17`.
- **Edge Functions:** `supabase secrets set` per env + `supabase functions deploy --no-verify-jwt --project-ref` (per function: `api`, `ai-chat`, `accept-invite-link`, `paychangu-webhook`, `expire-subscriptions`, etc.).
- **PWA:** `vite-plugin-pwa` `generateSW` + `public/sw-events.js`, `dist/sw.js` + `workbox-*`.

### 5.2 Rollback capabilities that exist

| Layer | Rollback |
|---|---|
| **Frontend (Vercel)** | Redeploy previous successful Vercel deployment (Vercel dashboard → Deployments → Redeploy) or `git revert` + re-push to `arena/01a0c215-ledgr-react` → `deploy.yml` `vercel --prod` on next push. `VITE_APP_VERSION` is isolated per build via `vite.config.ts` define. No client DB state to migrate back. |
| **Edge Functions** | Redeploy previous function version (`supabase functions deploy` with prior git checkout). Functions are stateless; no DB migration. |
| **Database migrations** | **No automatic down-migration.** `supabase db push` is forward-only. Rollback requires **manual restore from Supabase backup** (Supabase dashboard → Database → Backups / PITR if enabled) + redeploy prior commit’s migrations. P10 does not ship any P10 migration — so DB rollback risk is low: P10 is docs-only (`git diff --stat` `docs/releases/*`). If a P10 migration had been required, it would have been a hard STOP and required separate authorization. |
| **PWA / clients** | Clients on old `workbox` precache will update on next `autoUpdate` (`VitePWA registerType:autoUpdate`, `cleanupOutdatedCaches`, `clientsClaim`). No forced downgrade needed; new `dist/sw.js` will claim on next load. Offline queue in Dexie (`offlineDB`) is local-only and not wiped by redeploy. |

### 5.3 Rollback procedure for pilot

1. **Decide** — Owner declares pilot unsafe / `PILOT PREPARATION BLOCKED`.
2. **Frontend** — Redeploy prior Vercel prod deployment (or `git revert 6f5843b`-derived P10 if P10 was deployed).
3. **Functions** — Redeploy prior function bundle if changed (not applicable for docs-only P10).
4. **Database** — If any new migration had shipped (none in P10), restore from backup; otherwise no action.
5. **Notify** pilot cohort: app will show `ConfigError` or stale cache until reload; advise hard refresh.
6. **Preserve incident evidence** (`§4.2`) — do not delete failed rows to "clean".

### 5.4 What does not exist (and therefore not claimed)

- No automated DB down-migration script.
- No automatic Stripe subscription rollback for pilot (subscriptions are manually managed; pilot is `PILOT / LIMITED CONTROLLED USERS`).

---

## 6. Pilot Exit Criteria

Pilot is **successful** for the controlled scope if over a representative operating cycle (one full POS day including till open → sales → cash movements → shift close → report, plus one offline→online sync, plus one payroll/expense cycle if applicable):

- Zero `A` security regressions in certified scope
- Zero financial-integrity failures (`23514`, `P0QLT`, journal balance, `22023`, duplicate `client_key` double-post)
- Offline queue `RECONCILABLE` behaviour matches contract (`stock-denied`/`policy-denied` re-playable, `stale-version`/`unknown-version`/`payload-tampered` quarantined)
- No growing `quarantined` backlog, no `MAX_PENDING_QUEUE_ITEMS 2000` hit without sync
- Sentry error rate within pilot baseline (no new `is_business_member`/`can_access_branch` regression)

**Do not** widen to full commercial audience on pilot success alone — that requires Future Package E (`BILLING.SERVER-QUOTA` canonical command) + owner `FULL COMMERCIAL` decision.

---

## 7. References

- Release candidate: `docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md`
- Manifest: `docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.json`
- Authorization: `docs/audits/LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md` + `.json` (`6f5843b`)
- Preparation: `docs/audits/LEDGR_P9_OWNER_RELEASE_DECISION_2026-09-24.md` + `.json` (`268fd67`)
- Evidence: `docs/audits/LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.md` + `dc80e1c`, `LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.md` + `874c6df`
- Deployment: `DEPLOYMENT.md`, `.github/workflows/deploy.yml`, `supabase/config.toml`, `vite.config.ts`, `public/sw-events.js`, `src/lib/supabase.ts`, `scripts/check-env.mjs`
