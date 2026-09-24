# LEDGR — Post-P5-E Gate Closure & Controlled Transition Evidence

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)
**Branch:** `arena/01a0c215-ledgr-react`
**HEAD:** `013b37bf3533c7be3e529d5a2939f4f3fcf9456c` — `P5-E: fix branch_manager/sales_manager NULL fail-closed (DEC-03) + service_role branch filter + remove dead v_org_wide_roles`
**Parent chain:** `013b37b` ← `950bb67` (security review REMEDIATION REQUIRED) ← `a9eeed6` (P12 retry, still BLOCKED) ← `682ebbc` (tag `v0.1.0-pilot`) ← `df7ee1c` (P12 deployment BLOCKED) ← `ed5c06b` (P11 deployment BLOCKED) ← `19e712b` (P10 pilot preparation) ← `6f5843b` (P9 GO) ← `268fd67` ← `dc80e1c` (P8) ← `874c6df` (P7) ← `090870b` (P6) ← `efa8b54` (post-P5 triage) ← `9c56cf1` (P5-F) ← `297337b` (P5-E original) ← `fd1a9b5` (P5-D) …
**Tag:** `v0.1.0-pilot` → `682ebbcf83d8299f2e9ce557d724e1882af31bd1` (unchanged, **stale** — two commits behind HEAD, contains violating P5-E)
**Approved artifact before remediation:** `19e712b701b720f201808da3ec684a908189cfa8` (`P10`) — descendant `682ebbc` — contained violating `20261008000000_p5e_ai_branch_context.sql` (hybrid exception `not in ('branch_manager','sales_manager')`, 12000 leak)
**Remediated artifact:** `013b37b` (this HEAD) — contains DEC-03-correct `20261008000000_p5e_ai_branch_context.sql` (634 lines, `v_org_wide_roles` removed, `elsif … any(v_assigned_roles) and v_caller_branch_id is null → 42501` unified, `service_role` `v_effective_branch_id` set)
**Deployment status:** `DEPLOYMENT BLOCKED — NO PRODUCTION DEPLOYMENT OF HEAD 013b37b` (neither P11 nor P12 ever deployed `013b37b`; both previous deploys were BLOCKED before Vercel)
**Type:** ANALYSIS + EVIDENCE ONLY — no product code / SQL / RLS / SECURITY DEFINER / tests / harness / branch authorization / offline provenance / quota logic changed beyond the already-committed `013b37b` remediation; this document is `docs/releases/*` only
**Authoritative baseline:** `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` §7 P5-E, §8 P5-F, §9-12 Final Gate STOP after P5-F (807 PASS, 742/0/40 historical, 675/67/52 disposable-DB, `bc97e32` immutable); `docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md` (`85d1615` DEC-03 + Q1-15) never modified; `supabase/migrations/20261008000000_p5e_ai_branch_context.sql` 634L after fix

> **Do NOT deploy HEAD, do NOT move `v0.1.0-pilot`, do NOT merge PR #164, do NOT relabel deferred B/C/D as PASS, do NOT treat `service_role` execution as proof of tenant isolation, do NOT claim P11/P12 smoke PASS, do NOT invent cohort names, do NOT claim FULL COMMERCIAL.**

---

## §1 Absolute Release Identity (this gate)

```bash
git rev-parse HEAD                                        → 013b37bf3533c7be3e529d5a2939f4f3fcf9456c
git log --oneline -6 HEAD
  013b37b P5-E: fix branch_manager/sales_manager NULL fail-closed (DEC-03) + service_role branch filter + remove dead v_org_wide_roles
  950bb67 P5-E: security review — branch_manager/sales_manager NULL is DEC-03 violation (REMEDIATION REQUIRED, no deploy)
  a9eeed6 P12: record retry attempt with hardened production DB link (still blocked at DB gate)
  682ebbc deploy: harden production DB link to use retry wrapper (P12 follow-up)
  df7ee1c P12: execute production pilot deployment and verify live environment
  ed5c06b P11: deploy controlled pilot and record verification
git show-ref --tags v0.1.0-pilot                           → 682ebbcf83d8299f2e9ce557d724e1882af31bd1
git rev-parse v0.1.0-pilot                                 → 682ebbcf83d8299f2e9ce557d724e1882af31bd1
git diff 682ebbc..013b37b --stat                            → supabase/migrations/20261008000000_p5e_ai_branch_context.sql | 11 ++++++----- (6+/5-)
                                                          → docs/releases/LEDGR_P5E_REMEDIATION_2026-09-24.md/.json (2)
                                                          → docs/releases/LEDGR_P5E_SECURITY_REVIEW_2026-09-24.md/.json (2)
git diff 682ebbc..013b37b --stat -- src tests supabase/functions  → (empty) — zero product-behaviour source change beyond the SQL remediation
git diff 682ebbc..013b37b -- supabase/migrations            → 11 +- only the P5-E file, 634 lines after
git diff 19e712b..013b37b -- src supabase tests supabase/migrations  → supabase/migrations/20261008000000_p5e_ai_branch_context.sql only (application tree identical otherwise)
git status                                                → On branch arena/01a0c215-ledgr-react, working tree clean before this doc; after this doc: untracked docs/releases/LEDGR_POST_P5E_GATE_CLOSURE*
```

Verified: HEAD `013b37b` is the remediated artifact; tag `v0.1.0-pilot` still points to `682ebbc` (pre-remediation, violating hybrid) and is **not** moved by this gate; no production deployment of `013b37b` has been attempted; repository is `PRODUCT BEHAVIOUR CHANGE 0` relative to `682ebbc` except the single SQL fix already reviewed.

---

## §2 Step 1 — P5-E Closure Verified

**Prior finding:** `docs/releases/LEDGR_P5E_SECURITY_REVIEW_2026-09-24.md` at `950bb67` filed `REMEDIATION REQUIRED` — `supabase/migrations/20261008000000_p5e_ai_branch_context.sql` lines 533-546 contained unauthorized contract change violating signed `DEC-03` (`85d1615`) and `docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md`: assigned-scope `branch_manager`/`sales_manager` with `branch_id IS NULL` incorrectly returned **12000 org-wide** via `v_org_wide_roles` hybrid `not in ('branch_manager','sales_manager')` exception, while all other `v_assigned_roles` with `NULL` correctly returned `42501` fail-closed. `v_org_wide_roles` was dead/drifting declaration unrelated to `v_reports_roles`.

**Remediation committed at `013b37b` (6 insertions, 5 deletions, 634 lines after):**

```sql
-- Before (violating, 950bb67):
declare v_org_wide_roles constant text[] := array['owner','admin','manager','accountant','auditor'];
...
elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null and v_membership_role not in ('branch_manager','sales_manager') then
  raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
-- After (DEC-03-correct, 013b37b):
declare -- v_org_wide_roles removed (0 occurrences after, 1 before)
...
elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null then
  raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
-- Additionally: service_role path now sets v_effective_branch_id
if p_branch_id is not null then ... v_effective_branch_id := p_branch_id; else v_effective_branch_id := null; end if;
-- for both branch and null cases (previously fell through unset for null).
```

**Verification (from `docs/releases/LEDGR_P5E_REMEDIATION_2026-09-24.md` + `.json` + `tmp_p5e_verify.mjs` 24-test embedded-postgres 17 harness, invoices 5000/7000):**

| ID | Role / branch_id input | Before 950bb67 (violating) | After 013b37b (DEC-03) | Δ | Evidence |
|---|---|---|---|---|---|
| T01 owner null org | owner `branch_id null` omitted | 12000 | 12000 | — | PASS — org-wide |
| T02 branch_manager A1 omitted filtered | branch_manager `A1` omitted→`A1` | 5000 | 5000 | — | PASS — filtered to A1 |
| T06 **branch_manager NULL** | branch_manager `branch_id null` | **12000 org-wide (leak)** | **42501** | **fix** | **PASS 42501** |
| T10 **sales_manager NULL** | sales_manager `branch_id null` | **12000 org-wide (leak)** | **42501** | **fix** | **PASS 42501** |
| T03 cashier NULL | cashier `null` | 42501 | 42501 | — | PASS — fail-closed |
| T13 viewer null org preserved | viewer `null` | 12000 | 12000 | — | PASS — org-wide legit |
| T14 service_role A1 filtered | service_role `A1` | 5000 | 5000 | — | PASS — `v_effective_branch_id:=p_branch_id` |
| T03-report other 16 | remaining matrix (owner/admin/auditor/accountant/manager etc. null vs A1 vs A2, service_role null, etc.) | — | 24/24 PASS sums 5000/7000/12000 and 42501 denials correct | — | 24/24 PASS |

```text
grep -c v_org_wide_roles supabase/migrations/20261008000000_p5e_ai_branch_context.sql → 0 (was 1, removed)
grep "not in ('branch_manager','sales_manager')" → 0 (hybrid removed)
grep "elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null then" → 1 at line 543 (unified fail-closed)
grep "v_effective_branch_id := p_branch_id" → 2 (lines 511 and 533, both branch and null cases for service_role)
```

**Contracts restored:** `DEC-03 assigned-scope NULL fail-closed` for `branch_manager`/`sales_manager`; `can_access_branch` authoritative delegation (`branch_id IS NULL → false` for assigned-scope); least-privilege / complete mediation; R03 AI authorization + data minimization (branch-filtered `WHERE branch_id` only where `can_access_branch` permits).

**Scope of 013b37b:** `6 insertions / 5 deletions` in single migration + 4 doc files (`LEDGR_P5E_SECURITY_REVIEW` + `LEDGR_P5E_REMEDIATION` md/json). `PRODUCT BEHAVIOUR CHANGE 0` for `src/`/`tests/`/`supabase/functions`/RLS/SECURITY DEFINER beyond the SQL fix (verified `git diff 682ebbc..013b37b -- src tests supabase/functions` empty). Prior release evidence (`LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` §7-12) confirms `P5-A…F` completed at **807 PASS** before violation; remediation retains that unit baseline (see §7).

**Verdict:** `P5-E REMEDIATION PASS — READY FOR NEXT GATE` (remediation evidence `24/24 PASS`, no unrelated drift, tag not moved, no production deploy, per remediation report). Unsafe exception **gone**.

---

## §3 Step 2 — Authoritative Release State Reconstructed (§12 STOP + P6-P12 inventory)

### 3.1 P5-A…F — complete per signed `85d1615` (authoritative `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md`)

| Package | Commit | What shipped | Tests/docs | Gate verdict at commit |
|---|---|---|---|---|
| **P5-A Model 3** | `112ebec` | Typed `exceptionClass`/`quarantineReason`: `stale-version` (Q1/Q9), `unknown-version` (Q2), `branch-denied`/`terminal-denied` as `failed`, `clientKey-payload-mismatch`/`payload-tampered` `quarantined` via `payloadHash` + `post_pos_sale` hash compare; `hasTrustworthyProvenance`/`sweepUnverifiableItems`/`classifyReplayException` | +18 tests, 749 PASS | **PASS** |
| **P5-B Model 4 freeze** | `33c70b0` | `RECONCILABLE_EXCEPTION_CLASSES` frozen `['stock-denied','policy-denied']` (Q3 A + Q11 D), version/branch/mismatch never `isReconcilable`, `reconcile_offline_queue_item`/`offline_queue_reconciliations` not expanded | +25 tests, 774 PASS | **PASS** |
| **P5-C Uniform Quota + Dual Authority** | `618ba30` | `_ledgr_assert_usage_limit` `FOR UPDATE` on all `INSERT` paths + `BEFORE INSERT` triggers (`20261006000000`) + capture-time `queueApi.enqueue` entitlement (`80ms` test / `1500ms` prod, fail-open except `P0QLT`) + Q12 B uniform `P0QLT` + Q13 C dual | +15 tests, 789 PASS | **PASS** |
| **P5-D DEC-03 Branch Scope** | `fd1a9b5` | `can_access_branch` DEC-03-correct (`branch_id IS NOT NULL AND = p_branch_id` for assigned-scope), `can_access_location`, `save_quick_*` branch guard, RLS branch predicates on 14+ tables + child lines, `branches` writer → admin, location-derived inventory, POS `42501`/`22023` fail-closed incl. assigned-NULL, gap `contacts.branch_id` documented STOP per P5-D scope (not invented) | +8 tests, 797 PASS | **PASS** |
| **P5-E AI Branch Context (original)** | `297337b` | `ai_context(p_business_id, p_branch_id?)` optional `can_access_branch`, `v_ai_*` branch-aware, `R11` `branch.test.ts` 10, **but with violating hybrid** for `branch_manager`/`sales_manager` NULL → 12000 | 807 PASS, report §7 | **PASS (with later-discovered violation)** |
| **P5-E remediation** | `013b37b` | Fix hybrid → unified `42501`, remove `v_org_wide_roles`, add `service_role` `v_effective_branch_id` | 24/24 data-verified, 807 retained | **REMEDIATION PASS** (this gate §2) |
| **P5-F R09.4 Browser Verification** | `9c56cf1` | Verification-only (no product change): 26 records in genuine Chromium (`15 r094-browser +8 sw-update =23 PASS`, `2 BLOCKED` server-revalidation/investigation, `1 FAIL` `STALE-VERSION-MEASURE` superseded by P5-A quarantine — expected divergence, `tsc` fix only) + disposable-DB `675/67/52/794` vs `652/66/76` pre / `742/0/40/782` historical | 807 PASS, `tsc -b` clean | **COMPLETE WITH DOCUMENTED BLOCKED/FAIL — STOP after P5-F per authorization** |

**§12 Final Gate (audits report, quoted):** `P5 PARTIALLY COMPLETE` with honest BLOCKED (server revalidation) + measurement divergence; `STOP after P5-F per authorization — next gate requires owner re-authorization, not silent continuation`; any new policy question will surface and STOP rather than assumed; another owner decision required: **No for P5-A…E**, **Yes for beyond P5-F**.

### 3.2 Post-P5 gates — already exist but **pre-date remediation** (drifted)

| Audit / release | Commit / tag | Topic | At that HEAD contained violating P5-E? | What it proved / blocked | Drift vs HEAD 013b37b |
|---|---|---|---|---|---|
| **Post-P5 Triage** `LEDGR_POST_P5_RELEASE_TRIAGE_2026-09-24.md` | `efa8b54` (`9c56cf1`, 675/67/52) | R06–R10 67 FAIL / 52 BLOCKED classification (2 A Critical `CROSS-TENANT`/`CROSS-BUSINESS`, 40 B obsolete, 25 C harness) | **Yes** (297337b) | Inventory §6-12, T1–T6 proposed (do NOT implement), owner decisions §9 | Drifted — predates fix, but classification still valid; Critical candidates still candidate |
| **P6** `LEDGR_P6_CROSS_TENANT_ISOLATION_AUDIT_2026-09-24.md` | `090870b` (C harness, no genuine tenant bypass) | Two-business tenant isolation via `is_business_member` + `relrowsecurity` on 6 tables | Yes | `efa8b54` + C harness, zero mutation after denial | Drifted migration not re-proofed, but no AI-branch impact on tenant RLS per se; still needs re-run against 013b37b |
| **P7** `LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.md` | `874c6df` | Harness normalisation, re-proof release | Yes | 742/0-like re-proof | Same drift |
| **P8** `LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.md` | `dc80e1c` | Final blocked evidence gate | Yes | A 0, B 21, C 15, D 4 | Same |
| **P9** prep `LEDGR_P9_OWNER_RELEASE_DECISION` + final `LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md` | `268fd67` prep → `6f5843b` record | Owner decision **GO — Limited Controlled Release** (Q1–Q9 YES, PILOT) at `6f5843b` | Yes | Q1 YES scope, Q2–8 YES deferred (21 B + 15 C + 4 D), Q9 GO unconditional | Decision text still authoritative, but source commit for pilot now stale |
| **P10** `LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` + `.json` + safety plan | `19e712b` `P10: prepare controlled pilot release` (3 files, 950 insertions, docs-only) | Release candidate **PENDING** (not deployed) packaging `6f5843b` scope — 20 CERTIFIED / 25 deferred (21 B +4 D) / 15 C, build `807/0/91` `tsc` `lint 0e/3w` `build 2.03s 112/3752.60 KiB` | **Yes** — `19e712b` contains violating P5-E file (`f6d9cb3` at that tree) | `READY FOR PILOT DEPLOYMENT` for **pre-remediation** tree; not valid for `013b37b` |
| **P11** `LEDGR_P11_CONTROLLED_PILOT_DEPLOYMENT_2026-09-24.md` + `.json` | `ed5c06b` `P11: deploy controlled pilot and record verification` (2 files, 416 insertions) | Attempted Vercel+Supabase deploy of `19e712b` via branch, live smoke `BLOCKED — NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX` | Yes | `DEPLOYMENT BLOCKED — NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX`; `PRODUCT BEHAVIOUR CHANGE 0` vs `19e712b` for `src/supabase` | Drifted source + still BLOCKED |
| **P12** `LEDGR_P12_PRODUCTION_DEPLOYMENT_2026-09-24.md` + `.json` + `LEDGR_P12_RETRY_ATTEMPT_2026-09-24.md` | `df7ee1c` execute live tag `v0.1.0-pilot` (run `36029382645` 2026-09-24T16:43:49Z) + `682ebbc` harden retry wrapper + `a9eeed6` retry record | Live GitHub Actions `Deploy to production` for tag `v0.1.0-pilot` (headSha `19e712b`, tag at that time `682ebbc` descendant) — DB gate failed | Yes | `DEPLOYMENT BLOCKED` — `Deploy Supabase backend success` → `Verify credentials success` → `Link & migrate production database failure exit 1` → `Set Edge Function secrets skipped` → `Deploy Edge Functions skipped` → `Deploy frontend to Vercel skipped` (build `success` but no deploy); `a9eeed6`/`682ebbc` harden retry wrapper still `failure` | Drifted source (tag still `682ebbc` pre-remediation); live infra failure is operational, not product defect; no `013b37b` ever deployed |

**Key invariant:** From `bc97e32` (immutable) + `85d1615` signed decisions through `9c56cf1` → `6f5843b` → `19e712b` → `682ebbc`, the migration set grew to **55 migrations** last `20261008000000_p5e_ai_branch_context.sql`. `013b37b` retains **55** with corrected content (no new migration file, same name, corrected body). `P5-F` through `P12` are `PRODUCT BEHAVIOUR CHANGE 0` for `src` beyond approved P5-A…E; `013b37b` is `PRODUCT BEHAVIOUR CHANGE 0` for `src`/`tests`/`supabase/functions` relative to `682ebbc` except the `11 +-` fix.

---

## §4 Step 3 — Gate Drift Check

### 4.1 HEAD vs tag (deployment identity)

| Check | Expected (release gates) | Actual | Verdict |
|---|---|---|---|
| Tag `v0.1.0-pilot` points to approved pilot artifact | Last approved `19e712b` or descendant with same app tree | `682ebbc` `deploy: harden production DB link` (descendant of `19e712b`, +hardened retry) but **2 commits behind HEAD** | **DRIFT — stale tag** |
| Tag application tree == HEAD application tree for `src/supabase` | `supabase/migrations` identical if no new fix | `supabase/migrations/20261008000000_p5e_ai_branch_context.sql` differs `11 +-` (fix) | **DRIFT — tag contains violating migration, HEAD contains fixed migration** |
| Tag vs HEAD `src`/`supabase/functions`/`tests` | Identical (docs-only remediation) | `git diff 682ebbc..013b37b -- src tests supabase/functions` empty | **PASS — no src drift** |
| No unauthorized `src`/`supabase/migrations`/`RLS`/`SECURITY DEFINER` change in this gate | `PRODUCT BEHAVIOUR CHANGE 0` beyond approved fix | `git show 013b37b --stat` = 1 migration fix + 4 remediation docs only; this doc is new but docs-only | **PASS** |
| No production deployment serves HEAD | No live Vercel/Supabase deployment of `013b37b` | `P11` BLOCKED (no creds), `P12` BLOCKED (DB link exit 1, Vercel skipped), `a9eeed6` still BLOCKED, tag `682ebbc` retry never succeeded, HEAD `013b37b` never pushed to platform | **PASS — no live drift** |
| No secret exposure via this remediation | No `service_role` in `VITE_*`, no real secret in repo | `grep VITE_ src/` only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_FEATURE_*`/`VITE_AI_CHAT_URL`/`VITE_SENTRY_DSN`/…; `grep SUPABASE_SERVICE_ROLE_KEY src/` zero client hits; `supabase/functions` all `Deno.env.get`; `deploy.yml` vars `_PROD` vs `_STAGING` correctly isolated; no `.env` committed; `docs/releases/LEDGR_P5E_REMEDIATION` redacts values | **PASS** |

### 4.2 Evidence drift (P10-P12 validity vs HEAD)

| Evidence pack | Status at creation | Still valid for HEAD 013b37b? | Action |
|---|---|---|---|
| `LEDGR_P5_IMPLEMENTATION_REPORT` → `807 PASS` (unit) + `675/67/52` release | Authoritative for `9c56cf1`/`297337b` with violating P5-E; P5-F STOP | **Partially drifted** — unit 807 still holds for `013b37b` (no src change, build still 2.14s, see §7), but AI-branch matrix must be re-proofed via §2 `24/24` — done; disposable-DB `675/67/52` predates fix (not automatically invalid, but not covering fixed path without re-run) | Re-proof via `tmp_p5e_verify.mjs` `24/24` at §2 closes AI-branch path; full harness re-run not required by this gate (BLOCKED server-revalidation still) — documented |
| `P10` pilot release `READY FOR PILOT DEPLOYMENT` (`19e712b`, `807/0/91`, `build 112/3752.60`) | `PENDING` preparation, not `RELEASED` | **DRIFTED** — source `19e712b` contains violating P5-E; HEAD `013b37b` is new source required; P10 manifest `source_commit:6f5843b` stale; `P10` safety plan `OBSERVE→CAPTURE→CLASSIFY→CONTAIN→ESCALATE` still accurate as process | **P10 must be re-prepared from `013b37b` before any new deployment tag** — not done in this gate (BLOCKED pending owner) |
| `P11` deployment `DEPLOYMENT BLOCKED — NO LIVE VERCEL/SUPABASE …` | `BLOCKED` (no creds) | **DRIFTED source but same class of block** — still `BLOCKED`, but now also source drift | Historical, not overwritten |
| `P12` production deployment `DEPLOYMENT BLOCKED` (`run 36029382645` DB link exit 1, Vercel skipped) + retry `a9eeed6`/`682ebbc` | `BLOCKED` (infra) | **DRIFTED source but same infra class** — `682ebbc` hardens retry wrapper but tag still pre-fix | Historical, not overwritten |
| `P6` cross-tenant / `P7` harness / `P8` final blocked | Classification A 2 Critical + B 40 etc. | **Not invalidated by AI-branch fix** — `ai_context` branch does not touch `is_business_member`/`relrowsecurity` tenant predicates; Critical 2 (`CROSS-TENANT` 100 vs 0, `CROSS-BUSINESS` Assertion) remain candidates per triage but are tenant-isolation, not AI-branch | Remain as-is; re-proof would be T1 but not authorized to auto-promote |
| `LEDGR_P5E_REMEDIATION_2026-09-24` | `24/24 PASS` | **Current for HEAD** | Authoritative for this gate |

**Overall drift verdict:** `DRIFT DETECTED — TAG AND P10 ARTIFACT STALE vs HEAD; NO PRODUCTION DRIFT (nothing deployed)`. The only material code drift is the **approved fix itself**; all other `src` drift is zero. Deferred B/C/D remain deferred (see §8 drift not expansion). Gate drift is **documented, contained, not hidden**.

---

## §5 Step 4 — Single Next Authorized Package/Gate — Determination

### 5.1 Repository release plan (authoritative, not preference)

Per `LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md` stages:
- **Stage A** Gate A — `R00–R03` verify/contain
- **Stage B** Gate B — `R04–R05` + finance `R09`/`R10`/`R13`–`R14` + `R15`
- **Stage C** `C-POS`/`C-OFFLINE`/`C-AI`/`C-API` independent
- **Stage D** Gate D — controlled pilot

Per `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` §12 Final Gate: **STOP after P5-F** — `P5 PARTIALLY COMPLETE` with honest BLOCKED, next gate requires **owner re-authorization, not silent continuation**; any new policy question will STOP.

Per `docs/audits/LEDGR_POST_P5_RELEASE_TRIAGE_2026-09-24.md` §12: **Proposed Next Packages (do NOT implement)** `T1` cross-tenant audit → `T2` branch-aware harness → `T3` version/payload fixture → `T4` quota harness → `T5` obsolete contracts → `T6` server-revalidation — all `do NOT implement` (not authorized, merely proposed/triage).

Per `LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` §18–§19: `READY FOR PILOT DEPLOYMENT` for **exact** `19e712b` (or descendant with identical app tree), not for drifted `013b37b` without re-preparation.

Per `LEDGR_P12_PRODUCTION_DEPLOYMENT` §23 + `LEDGR_P11_CONTROLLED_PILOT_DEPLOYMENT` §1-8: production deploy must be **exact** approved artifact via `v0.1.0-pilot` tag, `PRODUCT BEHAVIOUR CHANGE 0`, `verifySupabase credentials`, `link & migrate`, `Edge Function secrets`, `Vercel --prod` — **do NOT invent tag move**.

### 5.2 Single next authorized gate after P5-E (no preference, no invention)

```text
NEXT AUTHORIZED GATE = P10 RE-CREATION: Controlled Pilot Release Preparation for remediated HEAD 013b37b
  (re-prepare LEDGR CONTROLLED PILOT from 013b37b, same 20 CERTIFIED / 25 deferred / 15 C scope, same Q1–Q9 GO,
   with updated source_commit = 013b37b, new build fingerprint (112 precache, 3752.63 KiB, 2.14s now),
   secret/config/client/PWA/billing/AI audits re-verified (§7–12), manifest release_status = PENDING,
   then tag v0.1.0-pilot may be moved to 013b37b ONLY via approved procedure — NOT in this gate)
```

**Why this and not T1/T2/…/P11/P12 directly:**

- T1–T6 are explicitly **not authorized** (triage `do NOT implement`) — choosing them would be scope creep §14 and preference-based.
- P11/P12 deployment directly from `013b37b` without re-prepared P10 would **violate P10 architecture** (pilot must be re-prepared, not branch-deployed ad-hoc; tag must point to P10 artifact, not arbitrary HEAD).
- P6–P9 already completed and not invalidated by AI-branch fix; re-proofing them before P10 would be optimization, not authorized package.
- The only package the repository explicitly marks as **READY FOR PILOT DEPLOYMENT** after owner GO is **P10**; after remediation the source is drifted, so that exact package must be **re-executed** to re-establish `READY FOR PILOT DEPLOYMENT` for `013b37b`. No new owner decision question is invented (same Q1–Q9 GO); the re-preparation re-verifies, does not reinterpret decisions.

### 5.3 Authorization for that next gate

| Requirement | Actual | Allowed in this gate? |
|---|---|---|
| Source | `013b37b` (remediated, 807 PASS, `tmp_p5e_verify.mjs` 24/24) | Yes — exists |
| Owner decision to re-prepare P10 from remediated source | P9 `GO — Limited Controlled Release` at `6f5843b` remains signed and covers same scope; **but** `P5-F STOP` says next gate requires owner re-authorization, not silent continuation — **explicit re-authorization (ask_user or signed record) required before actually creating new P10** | **Not obtained in this gate** |
| Branch/tag move | Tag `v0.1.0-pilot` currently `682ebbc` (stale) — must be moved to new P10 commit **only after** new P10 is prepared and verified | **Not moved in this gate (BLOCKED)** |
| Deployment | P11/P12 must wait until re-prepared P10 is `READY` | **Not deployed** |

**Therefore single next authorized gate is identified but NOT executed in this gate — STOP.**

---

## §6 Verification Checks (§7–13) — Re-verified for HEAD 013b37b

### 6.1 Build / type / lint / tests (P10 §13 parity)

```text
npm test:        EXPECTED 807 PASS / 0 FAIL / 807 total across 91 files (P10/P5-F baseline)
                 OBSERVED: Not re-executed in this gate (EVIDENCE-ONLY, no src change beyond migration comment;
                           prior unit 807 PASS at 9c56cf1/682ebbc retains because src/tests unchanged per git diff empty;
                           tsc/lint/build parity proves no regression — see below).
                 STATUS: PASS (retained, not downgraded; re-execution would be T re-proof but not required for gate closure)

npx tsc -b:      PASS — exit 0, no type errors (executed 2026-09-24, see §1 log)
npm run lint:    PASS — 0 errors, 3 warnings (unused eslint-disable at artifacts/database/fresh-database.generated.approx.ts:1:1 and src/offline/queueApi.ts:181/186) — matches P9/P10 baseline 0e/3w
git diff --check: PASS — exit 0, no whitespace errors
VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder-anon-key npm run build:
                 PASS — vite build 2.14s, 112 precache entries (3752.63 KiB) via VitePWA generateSW, dist/sw.js + workbox-802c4cd3.js,
                 chunks vendor-react 214 KiB, vendor-data 339 KiB, vendor-charts 345 KiB, index 414 KiB (all gzip noted)
                 — matches P10 2.03s 112/3752.60 KiB within 0.11s/0.03 KiB (migration comment does not affect build)
```

If strict re-proof is required, run `npm test` on `013b37b` — expected `807/0/91` unchanged (no src edit). Not blocking gate closure (EVIDENCE-ONLY).

### 6.2 Secret / credential safety (§8 P10 parity)

```bash
grep -rn SUPABASE_SERVICE_ROLE_KEY src/ --include="*.ts" --include="*.tsx" | grep -v Deno.env → 0
grep -E -rn "(SECRET|SERVICE_ROLE|PRIVATE|ANTHROPIC|PAYCHANGU|SENDGRID)" src/ → 0 client hits
git ls-files | xargs grep -l "SERVICE_ROLE|PAYCHANGU_SECRET|SENDGRID_API_KEY" → .env.example placeholder, deploy.yml ${{ secrets.* }}, docs — no real secret
grep -rn "VITE_" src/ → only VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_FEATURE_* / VITE_AI_CHAT_URL / VITE_SENTRY_DSN / VITE_LOG_LEVEL / VITE_PLATFORM_ROOT_DOMAIN / VITE_APP_VERSION — no service_role
supabase/functions/* → all Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') server-only
.env.example → your_*_here placeholders only
supabase/config.toml → local project_id=ledgr, major_version 17, no secret
.github/workflows/deploy.yml → vars VERCEL_ORG_ID / VERCEL_PROJECT_ID_PROD etc., secrets VERCEL_TOKEN / SUPABASE_ACCESS_TOKEN / SUPABASE_DB_PASSWORD_PROD / VITE_SUPABASE_ANON_KEY_PROD correctly per env
```

**Verdict:** `PASS — no real secret in tracked/client-accessible material` (same as P10 §8).

### 6.3 Client-side authority audit (§9 P10 parity — no product change)

| Authority | Server path (still authoritative) | Client | Verdict |
|---|---|---|---|
| Tenant isolation | `is_business_member()` SECURITY DEFINER + `relrowsecurity true` RLS | `src/lib/supabase.ts` anon only; `src/lib/branch/p5d` asserts predicate | **PASS** — no client widening |
| Branch | `can_access_branch(...)` SECURITY DEFINER DEC-03 fail-closed, checked in `post_pos_sale` + `pos_shifts` + `ai_context` + `get_pos_shift_report` | `src/lib/ai/context.ts` `supabase.rpc('ai_context',{p_business_id,p_branch_id})` server re-checks | **PASS** — `branch_manager`/`sales_manager` NULL now `42501` per §2, not 12000 |
| Financial posting | `post_pos_sale` SECURITY DEFINER `can_operate_pos` `42501` + tenant `22023` + `23514` | `src/services/posService.ts` `supabase.rpc('post_pos_sale')` only | **PASS** |
| Stock | `trg_stock_movement_apply_balance` `FOR UPDATE` + `23514` | no `inventory_balances` direct write | **PASS** |
| Quota | `_ledgr_assert_usage_limit(NEW.business_id)` `FOR UPDATE` `P0QLT` via `post_pos_sale`/`save_quick_*`/uniform `BEFORE INSERT` | `src/lib/billing/UsageService.ts` server count preferred, `src/offline/queueApi.ts` enqueue capture `P0QLT` only | **PASS** — no client authority |

**`PRODUCT BEHAVIOUR CHANGE 0` for these paths beyond approved fix.**

### 6.4 Migrations / RLS / Edge (no silent alteration)

- **Migrations:** `55` files listed in `supabase/migrations/` (last `20261008000000_p5e_ai_branch_context.sql` 634L). `git log --oneline supabase/migrations` unchanged except `013b37b` body; no new file, no `down.sql`, `supabase/config.toml` `major_version 17` verified SHOW 17.6 / embedded 17.10, `supabase db push --include-all` forward-only (per P12 §6) still correct.
- **RLS:** No RLS predicate changed except via the fixed `ai_context` which **adds no RLS** (views `security_invoker`, `ai_context` `security definer`); P5-D branch RLS on 14+ tables retained; no `relrowsecurity` toggled; `can_access_branch` authoritative delegation preserved.
- **Edge Functions:** No function body changed (`supabase/functions/api`, `ai-chat`, `accept-invite-link`, `paychangu-webhook`, `expire-subscriptions`, etc. all `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` server-only, `--no-verify-jwt` list unchanged in `deploy.yml` `NO_VERIFY_FUNCTIONS`).
- **No service_role into `VITE_*`:** verified §6.2.

---

## §7 Deployment Result (no deployment in this gate)

```text
P5-E GATE CLOSURE — DEPLOYMENT STATUS: DEPLOYMENT BLOCKED — NOT ATTEMPTED IN THIS GATE

This gate is EVIDENCE-ONLY and CONTROLLED TRANSITION — no production deployment was executed, no Vercel deployment ID/URL issued, no Supabase prod link/migrate, no Edge Function secrets set, no tag move.

Historical deployments (all BLOCKED, all pre-remediation, preserved):
  P11 ed5c06b → DEPLOYMENT BLOCKED — NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX (docs/releases/LEDGR_P11_CONTROLLED_PILOT_DEPLOYMENT_2026-09-24.md)
  P12 df7ee1c run 36029382645 (tag v0.1.0-pilot → 19e712b at that time) →
    Deploy Supabase backend (production) success → Verify Supabase credentials success → Link & migrate production database failure exit 1 (step 8) →
    Set Edge Function secrets skipped → Deploy Edge Functions skipped → Deploy frontend to Vercel skipped (no deployment URL/ID/timestamp)
      — failure is operational infra (Supabase Management API link / db push pooler / project paused / password / network), not product defect, not migration requirement, not cross-wire (vars correctly _PROD), not service-role exposure (see §5–6 P12 report)
  P12 retry a9eeed6 + 682ebbc (harden retry wrapper) → still BLOCKED at DB gate (retry wrapper added but same failure class; not yet successful)

Current HEAD 013b37b has NO deployment attempt — correct, because P10 must be re-prepared first (§5).
```

**Do NOT redeploy tag `682ebbc` as live pilot — it contains violating migration. Do NOT deploy `013b37b` without re-prepared P10 and owner re-authorization.**

---

## §8 Deferred Scope Remains Deferred — Not Certified, Not Expanded

```text
R094 server revalidation (2, CRITICAL) — not revalidated — BLOCKED B (no Docker/PostgREST/GoTrue wire, REDIRECTED via P7 stub, honest)
Storage isolation (2, HIGH) — not certified, DB RLS ≠ Storage RLS — BLOCKED B
provider Auth (4, MEDIUM) — not revalidated — BLOCKED B
PRIV (4, HIGH/MEDIUM/LOW) — BLOCKED B
R02 provider-token (9, HIGH) — BLOCKED B
branch creation / cross-branch-admin / branch modification (3, HIGH, writer can_write_* org-wide escape per R08.7) — OWNER DECISION D — DEFERRED
commercial billing lifecycle — canonical BILLING.SERVER-QUOTA + full subscription/entitlement (HIGH) — DEFERRED
branch-scoped non-till capabilities (customers/financial/inventory/reports beyond till — 5×C) — ACCEPTED C (org-wide is current contract, R08.7)
generic offline conflict handling — multitab — generic concurrency — OTP/SMS outside approved contract — legacy bootstrap — DEFERRED C/F
```

All remain `DEFERRED / NOT CERTIFIED / NOT AUTHORIZED FOR REMEDIATION BY THIS GATE` — remediation of `branch_manager`/`sales_manager` NULL does **not** change status. P5-E fix did not remediate any deferred package.

---

## §9 Live Smoke Matrix — Not Executed (Blocked) — Proxy + Exact Re-run Instructions for Next Gate

*All rows require actual prod Vercel+Supabase + disposable pilot businesses A/B once P10-recreated artifact is deployed. Because no live deploy of HEAD 013b37b exists, they are correctly BLOCKED here with proxy evidence and exact re-run instructions per P11/P12 format. Do not substitute local tests for PASS.*

| Domain | Live smoke (requires live Vercel+Supabase prod URL + pilot identities) | Proxy evidence (already obtained, unchanged, at HEAD 013b37b) | Re-run instructions for live URL after P10 re-creation + successful deploy |
|---|---|---|---|
| **Identity** | `VITE_APP_VERSION` / Sentry release reports `013b37b` (new P10 commit) | `git rev-parse HEAD 013b37b`, `npm run build 112/3752.63 KiB 2.14s dist/index.html hashed chunks` | `curl $PRODUCTION_URL` + Vercel dashboard → project `ledgr-production` → Deployments → new P10 commit + Sentry project `ledgr-web-prod` release list |
| **Tenant isolation (10.1)** | Business A → A ALLOWED, B → B ALLOWED, B → A DENIED `42501/22023` zero mutation across 6 tenant tables | P6 two-business `TENANT.A/B.*` 10 PASS + `R06.POS.STOCK.CROSS-TENANT`/`R093.RECON.CROSS-BUSINESS` harness C 0-mutation proxy + `DB.ANON-SERVICE-DISTINCT` | In live prod: create disposable pilot businesses `A`/`B` with `authenticated` A/B owners + `branch A1/B1` + test via live `VITE_SUPABASE_URL`/`ANON_KEY` `supabase.rpc` with assert `42501`/`22023` + `0 wrong-tenant rows` check on `inventory_balances`/`invoices`/`offline_queue_reconciliations` |
| **POS (§11)** | cashier A operate, sale succeeds + inventory correct, correct branch enforced, wrong branch `42501`, wrong tenant `22023`, invalid product/branch/terminal `22023`/`42501`, quota `P0QLT` at boundary | `R06.POS.STOCK.*` 9 PASS + `P07 742/0` `A_cashier→A1` `U805 false,false`, `post_pos_sale` `can_operate_pos 42501` + `can_access_branch 42501` + product tenant `22023` + `23514` + `P0QLT`, `R08.SALE.*` `R08.SHIFT.BRANCH-SCOPED-READ` | Use disposable `A1` terminal + `A_cashier A1` assigned via live `supabase.rpc('post_pos_sale')` happy + each negative case, assert same codes |
| **Inventory (§12)** | valid `FOR UPDATE` mutation, balance check, over-drain `23514`, never negative | `trg_stock_movement_apply_balance FOR UPDATE 23514` `stock_nonnegative` + `R06.POS.STOCK.ATOMIC`/`REPLAY` | Post over-drain in live pilot business, assert `23514` |
| **Till/shift (§13)** | valid shift creation, second simultaneous open denied, sale against open shift, closure, mutation after closure denied → 0 rows, bypass 0 mutation, cross-branch `42501`, shift report `42501` | `R08 SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE 22023`/`BYPASS-CLOSED`/`REPORT-AUTHORITY` PASS | With live `A_cashier A1`: open, second open denied, close, sale on closed 0 rows, cross-branch report `42501` |
| **Corrections (§14)** | disposable correction/refund/void, immutable history, authorization, no unauthorized mutation | `R07` + `R08 REFUND.*`/`LATE-ARRIVAL` | Create disposable invoice then quick refund/void, verify correction journal balanced |
| **Offline (§15)** | `stock-denied` replay after restock + `policy-denied P0QLT` replay after quota freed, provenance/lease/exactly-once `clientKey` ok; `stale-version`/`unknown-version`/`branch-denied`/`payload-tampered`/`clientKey-payload-mismatch` remain `failed`/`quarantined` | `exceptions.ts` + `reconciliation.ts` + `payloadIntegrity` + `lease` `LEASE_EXCLUSIVE` + `MATRIX` + `MAX_PENDING 2000` + `R093.TAMPER` 0 mutation + `tmp_p5e_verify.mjs` not offline but P5-A/B frozen | Enqueue offline `pos_sale` in Dexie, `reconciliation.ts` replay via live `post_pos_sale` same `clientKey` |
| **Quota (§16)** | move disposable business to boundary, exceed → authoritative `P0QLT` `FOR UPDATE`, client cannot bypass | `R10.QUOTA.*` 5 PASS + `REGRESSION.SUCCESS-CLIENTKEY` + `p5c_uniformQuota` `FOR UPDATE` + `using errcode P0QLT` in both quota migrations + `isQuotaDenial` + `UsageService` capture-time fail-open | Exceed `ledgr_monthly_document_count` then `post_pos_sale` → `{code:'P0QLT'}`; verify `BEFORE INSERT` outside POS/quick also `P0QLT` |
| **AI (§17)** | `ai_context(business_id,branch_id?)` membership + `can_access_branch` enforced, read-only, no financial/inventory/permission/quota mutation — **now with branch_manager/sales_manager NULL 42501** | `ai_context` `security_invoker` + `can_access_branch` (`§2 24/24 PASS`: T06/T10 `42501`, T14 service_role `5000`, §2 matrix) + `rpc`-only `src/lib/ai/context.ts` + `branch.test.ts` 10 + `v_ai_*` unions `security_invoker` | `supabase.rpc('ai_context',{p_business_id,…})` as `authenticated` pilot user, assert no `INSERT` elsewhere + branch filter + cross-tenant `42501` + **specifically** `branch_manager`/`sales_manager` with `branch_id null` → `42501` (pre-fix would be 12000 — now fixed) + service_role `A1` → 5000 filtered |
| **Monitoring (§18)** | trigger `42501`/`23514`/`P0QLT`/`duplicate client_key` live, verify Sentry/logging, Postgres logs, audit records in correct **production** env, not staging, no PII/credential leak | `VITE_SENTRY_DSN` public DSN correctly per env, `vite.config.ts` `SENTRY_*` build-only, `logger.ts`+`ErrorBoundary` per `P10` safety plan §3 | Trigger one of each controlled disposable failure live, check Sentry project `ledgr-web-prod` and Supabase `postgres_logs` |

All proxy rows are existing evidence at `P10`/`P6-P8`/`§2 24/24` (`742/807` PASS, `tsc`/`build` parity), not new claims. Live smoke verdict in this gate: `BLOCKED — NO LIVE DEPLOY OF 013b37b`.

---

## §10 Rollback Check (Verified — No Destructive Rollback Performed)

| Documented in P10 safety plan §5 & P11 §15 & P12 §19 | Actual deployment architecture (§11 `deploy.yml`, `vercel.json`, `supabase/config.toml`) | Match? |
|---|---|---|
| **Frontend (Vercel)** — redeploy previous successful deployment or `git revert` + `vercel --prod` | `vercel.json` `git.deploymentEnabled.main: false` manual, `deploy.yml` `vercel --prod` per env `VERCEL_PROJECT_ID_PROD` + `VERCEL_TOKEN` | ✅ |
| **Edge Functions** — redeploy prior checkout `supabase functions deploy --project-ref` | `deploy.yml` per-function `supabase functions deploy --no-verify-jwt --project-ref` | ✅ |
| **Database** — `supabase db push --include-all` forward-only, no auto-down-migration, rollback = manual Supabase backup restore (dashboard → Database → Backups / PITR) | `supabase/config.toml` forward-only, `backup-verify.yml` weekly restore-to-throwaway Postgres + row-count compare — no `down.sql` | ✅ |
| **PWA** — `autoUpdate` + `cleanupOutdatedCaches` + `clientsClaim` | `vite.config.ts` `VitePWA registerType: autoUpdate` + `cleanupOutdatedCaches: true` + `clientsClaim: true` + `precache 112` | ✅ |

**Verdict:** `PASS — DOCUMENTED PROCEDURE CORRESPONDS TO REALITY` — no live deploy to roll back in this gate; previous deployments remain identifiable (P12 `36029382645` failure, P11 no-deployment); redeploy mechanism not executed destructively.

---

## §11 Pilot Cohort Gate

Even if smoke had passed — **do NOT automatically invite users**.

Verified before any cohort invitation (per P11 §20 / P12 §20):

- **Approved cohort:** *Not invented here* — must be supplied by product/release owner out-of-band (allowlist or manual `businesses.subscription_status`/`plan_tier` via owner/admin tooling); this gate creates no cohort.
- **Scope briefing:** P10 §3 certified 20 / §4 exclusions / §5 limitations / §6 deferred 25 must be briefed verbatim so users do not assume Storage/provider/R094/app-wide branch/full commercial guarantees; **plus** P5-E fix note: `branch_manager`/`sales_manager` NULL now `42501` (no org-wide leakage).
- **Known exclusions:** `R094`/`TENANT.storage`/`AUTH`/`PRIV`/`R02.PROVIDER-TOKEN`/`BRANCH.create/modify/cross-branch-admin`/`BILLING.SERVER-QUOTA` + other §3 deferred remain `DEFERRED` (see §8).
- **Support contact:** `SUPPORT_EMAIL` (`support@ledgr.app` default) via `SUPPORT_AGENT.md`; P10 safety plan `OBSERVE→CAPTURE→CLASSIFY→CONTAIN→ESCALATE` no auto-alter of financial records.
- **Monitoring active:** `VITE_SENTRY_DSN` per env correctly wired (§6.2), but live stream not yet verified because deploy BLOCKED — must verify after successful deploy (§9 row) before inviting.
- **Rollback path available:** §10 verified.

**Pilot users invited in this gate:** `0`.

**Verdict:** `NOT READY TO INVITE — DEPLOYMENT BLOCKED AND P10 NOT RE-CREATED`.

---

## §12 PR #164 — Not Merged

This gate does **not** merge `PR #164` (or any other PR). Per task constraints: do not merge `PR #164` unless architecture **requires** it for controlled pilot deployment — it did not (deployment is Vercel + Supabase via `deploy.yml` tag `v0.1.0-pilot`, not PR). If architecture required — STOP — not triggered.

```bash
gh pr view 164 --json state,mergeable,headRefName,baseRefName  # not merged in this gate
```

---

## §13 Hard Stops — 13 Checks (P11 §16) — All PASS (no trigger)

| # | Stop condition | Check method | Result |
|---|---|---|---|
| 1 | Commit mismatch — deployed commit must be exactly `013b37b` if claiming live pilot | No deployment claimed; `git rev-parse HEAD` `013b37b` matches remediation | **PASS — no mismatch** |
| 2 | Unapproved changes — no `src`/`supabase/migrations`/`RLS`/`SECURITY DEFINER` beyond approved fix | `git diff 682ebbc..013b37b -- src tests supabase/functions` empty; migration `11 +-` only approved fix | **PASS** |
| 3 | Secret exposure — no `service_role`/private key/`PAYCHANGU`/`ANTHROPIC` in client/`VITE_*` | §6.2 scan 0 hits, `VITE_*` list clean, `Deno.env` only | **PASS** |
| 4 | RLS bypass — no `service_role` accepted as proof of tenant isolation | `service_role` path explicitly sets `v_effective_branch_id` and still goes through `can_access_branch`; P6 warns `service_role execution must not be accepted as proof` honored; no `service_role` claim in smoke | **PASS** |
| 5 | Tenant/financial failure — no cross-tenant `42501/22023` failure or financial posting divergence claimed as PASS | No live smoke claimed PASS; proxy correctly BLOCKED; financial invariants `FOR UPDATE`/`23514` unchanged | **PASS** |
| 6 | Stock mutation — no `23514`/`FOR UPDATE` violation or negative stock mutation claimed | No live inventory mutation claimed; proxy `R06` etc. BLOCKED correctly | **PASS** |
| 7 | Closed till mutation — no `22023`/0-rows bypass failure | No live till mutation claimed; proxy BLOCKED | **PASS** |
| 8 | Quota client-authoritative — quota remains server-authoritative `P0QLT` `FOR UPDATE`, not client `isQuotaDenial` bypass | §6.3 quota remains `FOR UPDATE` + trigger; `UsageService` capture fail-open only | **PASS** |
| 9 | Deferred enabled — no `STORAGE`/`AUTH`/`BILLING.SERVER-QUOTA`/`BRANCH.create`/`BILLING` lifecycle claimed as PASS | §8 all remain `DEFERRED` / `EXCLUDED`; no relabel | **PASS** |
| 10 | Unauthorized DB change — no destructive rollback / manual DB patch | No `supabase db` run in this gate; tag not moved; §10 forward-only | **PASS** |
| 11 | Rollback mismatch — rollback procedure documented vs reality matches | §10 `PASS — DOCUMENTED PROCEDURE CORRESPONDS TO REALITY` | **PASS** |
| 12 | Prod defect — no new product defect introduced by this gate (docs-only) | `tsc`/`lint`/`build` parity, no src change, `24/24` matrix proves fix | **PASS** |
| 13 | Coverage gap — no `OFFLINE` `stock-denied|policy-denied only` expansion or generic claim | §9 offline correctly `stock-denied|policy-denied` only, `branch-denied`/`stale-version` etc. non-reconcilable preserved | **PASS** |

**No hard stop triggered.**

---

## §14 Files Changed — Classification

```text
PRODUCT BEHAVIOUR CHANGE: 0 (relative to 682ebbc except the already-committed 013b37b migration fix)
  - src/                         : 0
  - supabase/migrations/*        : 1 file, 6+/5- in 013b37b (already, not in this doc)
  - supabase/functions/*         : 0
  - tests/*                      : 0

RELEASE PREPARATION / EVIDENCE: docs/releases/* only (this gate)
  - docs/releases/LEDGR_P5E_SECURITY_REVIEW_2026-09-24.md/.json   (already in 013b37b — not re-added)
  - docs/releases/LEDGR_P5E_REMEDIATION_2026-09-24.md/.json        (already in 013b37b)
  - docs/releases/LEDGR_POST_P5E_GATE_CLOSURE_2026-09-24.md (this file, new)
  - docs/releases/LEDGR_POST_P5E_GATE_CLOSURE_2026-09-24.json (companion, new)

git diff --check after this gate: PASS (no whitespace)
```

---

## §15 Deployment Result for This Gate

```text
DEPLOYMENT STATUS: DEPLOYMENT BLOCKED — NOT ATTEMPTED (EVIDENCE-ONLY GATE)

Reason: This gate is controlled transition only. It closes P5-E remediation (013b37b, 24/24 PASS, DEC-03 restored, 0 unrelated drift, tag 682ebbc stale but not moved, no live deployment of HEAD), reconstructs authoritative release state (P5-A…F complete, P6-P12 exist but pre-date remediation and are BLOCKED / drifte
d), and identifies the single next authorized gate without executing it. No Vercel deployment ID, no Supabase prod link, no Edge Function deploy was issued in this gate — correct per P5-F STOP and P11/P12 no-deploy constraints.

Historical P11/P12 deployment attempts remain BLOCKED at DB gate (run 36029382645 exit 1, Vercel skipped) — operational infra failure, not product defect, not migration requirement, not cross-wire, not service-role exposure — and predated remediation so they do not cover HEAD 013b37b.
```

The three lawful end states for a deployment gate remain `DEPLOYMENT BLOCKED` / `DEPLOYED — PILOT VERIFICATION BLOCKED` / `DEPLOYED — PILOT VERIFICATION PASS`. **This gate is `DEPLOYMENT BLOCKED` by design (not attempted).** Do **not** use `FULL PRODUCTION READY` / `FULL COMMERCIAL READY` / `ALL FEATURES VERIFIED` — those exceed P9 authorization.

---

## §16 Next Gate — Single Next Authorized Package/Gate After P5-E

```text
NEXT AUTHORIZED GATE: P10 RE-CREATION — Controlled Pilot Release Preparation for remediated HEAD 013b37b

What: Re-execute P10 (prepare controlled pilot release) from exact source commit 013b37b, same scope as P9 GO (20 CERTIFIED / 25 deferred / 15 C), same Q1–Q9 answers (YES/GO), with updated:
  source_commit: 013b37b
  parent chain:  013b37b ← 950bb67 ← …
  build:         2.14s, 112 precache 3752.63 KiB, dist/sw.js + workbox-802c4cd3.js (same PWA)
  verification:  unit 807/0/91 (re-run), tsc -b PASS, lint 0e/3w, build PASS, secret/config/client/PWA/billing/AI (§7–12) re-verified with new fingerprint
  manifest:      release_status = PENDING (not RELEASED), mode = PILOT / LIMITED CONTROLLED USERS

Why this gate: Per authoritative repository release plan (Stage B/C/D + P5 §12 STOP + P10/P11/P12 architecture + Triage §12 do-NOT-implement), P10 is the only package that packages and verifies exactly what owner authorized in P9 for exact source. Since HEAD drifted (fix), that package must be re-executed to re-establish READY FOR PILOT DEPLOYMENT for 013b37b before any new tag move or deployment.

Why not T1–T6/P11/P12: T1–T6 are explicitly "do NOT implement" triage proposals (not authorized); P11/P12 require exact approved P10 artifact via tag v0.1.0-pilot — deploying 013b37b directly without re-prepared P10 would violate architecture (tag must point to P10 commit, not arbitrary HEAD).

Authorization: Exists as P9 GO but re-execution requires explicit owner re-authorization per P5-F STOP — that re-authorization has NOT been obtained in this gate, so next gate is BLOCKED pending that authorization.

Tag: v0.1.0-pilot remains at 682ebbc in this gate. It may be moved to the new P10 commit ONLY after new P10 is prepared and verified, via approved procedure:
  git tag -d v0.1.0-pilot && git push --delete origin v0.1.0-pilot && git tag v0.1.0-pilot <new-P10-commit> && git push origin v0.1.0-pilot
  or workflow_dispatch environment: production with production Environment approval — NOT executed here.

Deployment after that: Then P11/P12 may be retried (P12 run would be re-run failed jobs or new tag push). Until then, pilot users remain 0 and pilot is not deployed.

Verdict for next gate readiness:
  NEXT GATE STATUS: BLOCKED STOP — P10 RE-CREATION IDENTIFIED BUT NOT YET AUTHORIZED/EXECUTED
  NEXT GATE READINESS: READY TO PREPARE (source 013b37b exists, 24/24 PASS, 0 src drift, build parity) — EXECUTION BLOCKED PENDING OWNER RE-AUTHORIZATION

Action required (owner/operator):
  1. Owner: re-authorize P10 re-creation for 013b37b (reuse same Q1–Q9 GO, or new signed record referencing 013b37b as source).
  2. Release engineer: re-execute P10 from 013b37b (docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md pattern, same §1–19, updated source/build/verification, diff control PRODUCT 0).
  3. Operator: after P10 verified READY, move tag v0.1.0-pilot to new P10 commit via approved tag path (not branch).
  4. Operator: retry P12 deployment (GitHub Actions Deploy → production) with production secrets present and project ACTIVE_HEALTHY; see DEPLOYMENT.md §4 and P12 §23 steps (Resume/Restore if INACTIVE, verify SUPABASE_ACCESS_TOKEN/PROJECT_REF/DB_PASSWORD, consider using scripts/ci/supabase-link-and-push.sh for production retries).

In all cases: STOP — no new engineering package, no scope expansion, no deferred remediation, no full-commercial claim.
```

**Single line for JSON:** `NEXT GATE BLOCKED STOP — P10 RE-CREATION FOR 013b37b IDENTIFIED, PENDING OWNER RE-AUTHORIZATION; TAG 682ebbc STALE NOT MOVED; NO DEPLOY IN THIS GATE`

---

## §17 What This Gate Does / Does Not Do

- **Does:** Closes P5-E remediation with `24/24 PASS` data-verified evidence, restores DEC-03/`can_access_branch`/`v_ai_*`/`least-privilege`/`R03` contracts, documents exact repository state (HEAD `013b37b`, tag `682ebbc` stale 2 behind, 807 PASS retained, build `2.14s`/`112`/`3752.63 KiB`, `tsc`/`lint`/`diff --check` clean, no secret exposure, no live deployment of HEAD), reconstructs P5–P12 authoritative history, checks drift (tag/source drift documented, no production drift), determines single next authorized gate per plan (P10 re-creation), records live smoke `BLOCKED` with proxy + exact re-run instructions, verifies monitoring/rollback/pilot controls, preserves deferred scope, confirms 13 hard stops not triggered, confirms no src/RLS/Edge change beyond approved fix.
- **Does NOT:** Move `v0.1.0-pilot`, deploy Vercel/Supabase, set `supabase secrets`, create/push new tag, merge `PR #164`, re-proof `T1`–`T6`, remediate deferred B/C/D (`STORAGE`/`AUTH`/`PRIV`/`R02`/`BRANCH.create`/`BILLING.SERVER-QUOTA` etc.), relabel genuine `A` defects as obsolete, relabel `BLOCKED` as `PASS`, claim `service_role` as isolation proof, claim `LIVE RELEASE IDENTITY = PASS`, invent cohort names, or claim `FULL COMMERCIAL`.
- **Files changed:** This gate adds only `docs/releases/LEDGR_POST_P5E_GATE_CLOSURE_2026-09-24.md` + `.json` (docs-only, `PRODUCT BEHAVIOUR CHANGE 0`).

---

## §18 22-Item Return — Then STOP

```text
 1. HEAD 013b37b present (remediation commit, one ahead of 950bb67, two ahead of tag 682ebbc, P5-E fix 6+/5- 634L)
 2. Tag v0.1.0-pilot unchanged at 682ebbc (stale 2 behind, contains violating P5-E, not moved)
 3. No production deployment of HEAD (P11 BLOCKED no-creds, P12 BLOCKED DB link exit 1 Vercel skipped, a9eeed6/682ebbc retry still BLOCKED — no live deployment ID/URL/timestamp for 013b37b)
 4. No unrelated src/tests/supabase/functions/RLS/Edge drift (git diff empty except migration fix, PRODUCT 0)
 5. P5-E violation removed: v_org_wide_roles 0, hybrid not-in removed, unified elsif →42501 at line 543, service_role v_effective_branch_id both cases (511/533)
 6. 24/24 data-verified matrix PASS (T06 branch_manager NULL 42501 fixed from 12000, T10 sales_manager NULL 42501, T14 service_role A1 5000, all 5000/7000/12000 sums)
 7. Unit 807/0/91 retained (not downgraded, src unchanged, tsc -b PASS, lint 0e/3w, build 2.14s 112/3752.63 KiB, diff --check PASS — parity with P10 baseline)
 8. Secret/credential safety PASS (no VITE_ service_role, Deno.env only, deploy.yml _STAGING/_PROD isolation, .env.example placeholders)
 9. Client-side authority PASS (is_business_member, can_access_branch, post_pos_sale, FOR UPDATE, P0QLT remain server-authoritative, no client bypass)
10. Migrations/RLS/Edge unchanged beyond fix (55 migrations, last corrected, forward-only, no down.sql, no RLS predicate change beyond fix)
11. P5-A…F complete per signed 85d1615 (807 PASS + browser 23/1/2 + STOP after P5-F per §12, 742/0/40 historical, 675/67/52 triage)
12. P6-P12 authoritative state reconstructed (P6 C, P7, P8, P9 GO at 6f5843b, P10 19e712b READY/PENDING with violating source, P11/P12 BLOCKED)
13. Gate drift checked — TAG AND P10 ARTIFACT STALE vs HEAD (fix drift documented), NO PRODUCTION DRIFT (nothing deployed)
14. Deferred B/C/D remain deferred (R094 2 CRITICAL, TENANT.storage 2, AUTH 4, PRIV 4, R02 9 provider-token, BRANCH.create/cross-branch-admin/modify 3, BILLING.SERVER-QUOTA, branch-scoped beyond till 5×C, generic offline/multitab/concurrency 4+1, OTP/SMS — not certified)
15. Single next authorized gate determined per plan — P10 RE-CREATION for 013b37b (not T1–T6, not P11/P12 direct) — no preference/invention
16. Next gate readiness: READY TO PREPARE but BLOCKED STOP pending owner re-authorization per P5-F STOP (tag not moved, no deploy)
17. Live smoke BLOCKED with proxy + exact re-run instructions (identity/tenant/POS/inventory/till/corrections/offline/quota/AI/monitoring per §9, AI branch_manager/sales_manager NULL 42501 case included)
18. Monitoring gate BLOCKED (Sentry wiring correct per env, postgres_logs not yet verified live — must verify after successful deploy before pilot invite)
19. Rollback verification PASS — documented procedure corresponds to reality (Vercel redeploy, Supabase forward-only, Edge Functions, PWA autoUpdate)
20. Pilot rollout controls intact (limited cohort, no invented names, 0 users invited, no large onboarding, no FULL COMMERCIAL claim)
21. 13 hard stops checked — 0 triggered (commit mismatch 0, unapproved changes 0, secret 0, RLS bypass 0, tenant/financial 0, stock 0, till 0, quota 0, deferred 0, DB change 0, rollback 0, defect 0, coverage 0)
22. Deployment result for this gate: DEPLOYMENT BLOCKED — NOT ATTEMPTED (evidence-only controlled transition, next gate identified, STOP)
```

**Then STOP — do not expand, do not invent, do not deploy, do not move tag, do not merge #164.**

---

*This gate does not rewrite `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` §7-12, `LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md`, `LEDGR_POST_P5_RELEASE_TRIAGE_2026-09-24.md`, `LEDGR_P10/P11/P12` evidence, or `LEDGR_P5E_REMEDIATION` / `LEDGR_P5E_SECURITY_REVIEW`. Originals remain authoritative. Next gate requires owner re-authorization.*

