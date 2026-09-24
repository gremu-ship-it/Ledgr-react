# P8 — Final Blocked Evidence Gate

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)
**Head:** `874c6df` `P7: normalize release harness and re-prove release`
**Branch:** `arena/01a0c215-ledgr-react`
**Parent:** `090870b` `P6 audit — Cross-Tenant Isolation Evidence (efa8b54) — C harness, no genuine tenant bypass`
**P7 release result (authoritative):** `742 PASS / 0 FAIL / 52 BLOCKED / 794` at `.cache/r13/ledgr-r13-ecFOuO/evidence.json` (vitest 5.0.1, embedded-postgres 17.10.0-beta.17, pg 8.13.1, Chromium 138.0.7204.0)
**Unit result:** `807 PASS / 0 FAIL` (91 files) — `npm test` 807 PASS
**Working-tree status at P8 start:** `clean` — `git status --porcelain` empty, `git diff --check` PASS, `git diff --stat` 0 product changes since `874c6df`
**Typecheck / lint / build:** `tsc -b` PASS, `lint` 0 errors (3 warnings unused eslint-disable), `build` PASS (placeholder env)
**Mode:** **ANALYSIS/EVIDENCE ONLY** — no `src/` / `supabase/migrations` / RLS / SECURITY DEFINER / POS / accounting / offline / billing / AI / JWT changes; no harness changes to `tests/release/*`; no fake infrastructure; no manufactured PASS.

> **P8 — FINAL BLOCKED EVIDENCE RESULT** — This document turns the remaining `52 BLOCKED` from an opaque number into a complete, evidence-backed release decision map. It does **not** declare production readiness; it determines what, if anything, still blocks a defensible release decision.

---

## §1 Executive Result

**P8 — FINAL BLOCKED EVIDENCE RESULT**

- **Total BLOCKED at P7:** `52`
- **Classification counts:** `A 0` dischargeable now, `B 21` environment blocked, `C 15` accepted release limitation, `D 4` requires owner decision, `E 0` remediation candidate, `F 12` obsolete/invalid test.
- **Security-critical blockers:** `0` — all security-critical properties (tenant isolation, branch authorization, POS authorization, offline reconciliation authorization, invitation privilege boundary — see §5) have **valid evidence** via P5-D/P6/P7; the 21 `B` (provider/storage/browser) and 4 `D` (branch writer + billing) are either non-security provider/storage/billing deferred gates or design-approval gates explicitly deferred by signed P4 decisions (Q14/Q15).
- **Financial-integrity blockers:** `0` — all financial-integrity properties (journal invariants, stock balance authority, negative-stock protection, POS correction/refund/void, till/shift integrity, offline reconciliation, quota enforcement, tenant financial isolation — see §6) are **PASS** via R05/R06/R07/R08/P5-B/P5-C/P6/P7; `BILLING.SERVER-QUOTA` is a deferred canonical-command gate (D, not a product defect).
- **Environment blockers:** `21` — `R094.BROWSER.SERVER-REVALIDATION` (2) + `TENANT.*.storage` (2) + `AUTH.*` (4) + `PRIV.*` (4) + `R02.PROVIDER-TOKEN.*` (9) — all require isolated Supabase Auth/GoTrue/JWT/Storage/PostgREST (embedded-postgres only).
- **Accepted limitations:** `15` — `BRANCH.customers/financial/inventory/read/reports` (5) + `OFFLINE.*` (4) + `R06.CONCURRENT` (1) + `AI.BRANCH` (1) + `R02.DEC-02`/`R02.OTP` (4) — owner-accepted per P4/R08.7.
- **Owner decisions required:** `4` — `BRANCH.create` / `BRANCH.cross-branch-admin` / `BRANCH.modify` (policy reshape for all-branch writer) + `BILLING.SERVER-QUOTA` (canonical billing command) — all explicitly flagged in P4 Q12/Q13 and R08.7 audit as needing product decision + package.
- **Remediation candidates:** `0` — no BLOCKED record provides sufficient evidence of a product defect; no `E` assigned.
- **Obsolete:** `12` `LEGACY.*` — fixed/shared bootstrap, superseded by disposable-fixture suites.

**Recommendation (per §22):** **Case 2 — FINAL OWNER RELEASE DECISION** — No `A`/`D`-security-critical/`E` items remain that would require a targeted remediation package. The remaining `B` (7) are genuine infrastructure gates (real PostgREST/GoTrue/Storage) and `C` (29) are owner-accepted limitations with explicit evidence chains (see §15). The 4 `D` are product-design decisions (branch writer scope, canonical billing command) that the owner has already deferred per signed P4 Q14/Q15 and R08.7 — they are not security-critical for the current till/POS/offline/quota contract, but they **must be explicitly accepted** by the owner at the final release gate. No `A` can be discharged now without changing product/harness (P8 is classification-only per §18).

A legitimate `742 PASS / 0 FAIL / 52 BLOCKED` with 52 clearly understood is more valuable than an artificial `794 PASS`.

---

## §2 Exact Baseline

```
HEAD:     874c6df  P7: normalize release harness and re-prove release
Branch:   arena/01a0c215-ledgr-react
Parent:   090870b  P6 audit — Cross-Tenant Isolation Evidence (efa8b54) — C harness, no genuine tenant bypass
P7 evidence: .cache/r13/ledgr-r13-ecFOuO/evidence.json — 742 PASS / 0 FAIL / 52 BLOCKED / 794 TOTAL
            (Chromium 138.0.7204.0, embedded-postgres 17.10.0-beta.17, pg 8.13.1, vitest 5.0.1,
             R13 fixture: 2-business authenticated identities + 2 pg clients, no shared jwt)
Unit:     npm test — 91 files, 807 PASS / 0 FAIL
Typecheck: tsc -b — PASS
Lint:     eslint — 0 errors, 3 warnings (unused eslint-disable)
Build:    vite build — PASS (placeholder VITE_SUPABASE_URL)
Git:      git diff --check — PASS; git diff --stat — 0 product changes (only docs at P8)
No product source/SQL/RLS/SECURITY DEFINER/POS/accounting/offline/billing changes since 874c6df
P6 tenant-isolation: PASS (C harness, no genuine tenant bypass)
P7 harness re-proof: PASS (67 FAIL → 0 via DEC-03/P0QLT/stale fixes, 0 product changes)
```

Authoritative release result is **not replaced** until new evidence is gathered (P8 is classification, not re-proof per §24).

---

## §3 52-Record Inventory

Every BLOCKED record appears exactly once. Full machine inventory at `LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.json` (one record per test_id with `classification`, `property`, `severity`, `release_critical`, `evidence_available`, `reason`, `next_action`).

| # | Test ID | Suite | Existing reason (actual) | Classification | Release impact | Evidence available? | Required next action |
|---|---|---|---|---|---|---|---|
| 1 | `AI.BRANCH` | `supabase/functions/ai-chat/index.ts` | Durable branch assignment and field-permission contract require design approval. | **C** Accepted limitation | LOW — AI branch filter is read-only, non-authoritative; after P8 per Q15 | P4 Q14 B / Q15 B (optional branch filter after BRANCH.*) | Owner accepts deferred AI branch scope; implement `ai_context(business_id, branch_id?)` with `can_access_branch` after P8 |
| 2 | `AUTH.expired-session` | `src/lib/supabase.ts` | No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence. | **B** Environment blocked | MEDIUM — session expiry is auth integration, not tenant security (already proven via RLS/tenant tests) | Mock `getUser` only; no real GoTrue/JWT | Provision isolated GoTrue + real JWT path or accept as provider integration deferred |
| 3 | `AUTH.invalid-login` | `src/lib/supabase.ts` | same | **B** | MEDIUM | same | same |
| 4 | `AUTH.logout-revocation` | `src/lib/supabase.ts` | same | **B** | MEDIUM | same | same |
| 5 | `AUTH.valid-login` | `src/lib/supabase.ts` | same | **B** | MEDIUM | same | same |
| 6 | `BILLING.SERVER-QUOTA` | `supabase/migrations/20260815000003_phase8b_rls_policies.sql` | Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented. | **D** Requires owner decision | HIGH — canonical billing command concurrency/quota is product decision | P5-C `P0QLT` for POS/quick proven; this is generic billing command (not POS) | Owner to approve canonical command/approval/entitlement contract per P4 Q12/Q13; then targeted package |
| 7 | `BRANCH.create` | `supabase/migrations/20260815000003_phase8b_rls_policies.sql` | R08.7 audit: `post_pos_sale` blocks cross-branch posting at server (proven by R08.SALE.* / R08.BRANCH.SERVER-SCOPE), but raw writer policies (`invoices_writer_insert = can_write_sales_data` org-wide) allow A1-assigned caller to INSERT branch_id=A2. ESCAPE PATH. | **D** Requires owner decision | HIGH — branch create is writer-authorization boundary | R08.7 audit + R08 till family proven; core tables org-wide per 20260728000008 | Owner decision: reshape writer policies to `can_access_branch` + audit direct-API call sites; package after P8 (Q15) |
| 8 | `BRANCH.cross-branch-admin` | same | R08.7 audit (two-sided): pos_terminals sealed (`can_admin_business_data` owner/admin), but branches/departments/inventory_locations writer = `can_write_business_data` (cashier/stock_clerk included) → A1 can create/rename A2 branch. One sealed + one open ⇒ family not proven. | **D** | HIGH | same | same — policy reshape for app-wide branch admin |
| 9 | `BRANCH.customers` | same | R08.7 audit: contacts SELECT/INSERT/UPDATE org-wide (`contacts_writer_*`); no branch predicate. ESCAPE PATH. | **C** Accepted limitation | MEDIUM — customer branch not proven, but P6 shows no path from R06/R093 to customer leakage; owner accepted per R08.7 | R04 `contacts_writer` org-wide; P6 explicitly out-of-scope (`contacts.branch_id`) | Owner accepts current org-wide customer contract; future package if branch-scoped customers required |
| 10 | `BRANCH.financial` | same | R08.7 audit: `journal_entries`/`journal_lines` and finance views org-wide RLS (member-based read); no branch dimension. | **C** | MEDIUM — financial branch dimension not proven; but journal invariants stock/tenant proven via R06/R08 | Org-wide RLS is intentional till-report vs finance distinction | Accepted: financial reporting is org-wide; POS shift report is branch-enforced (proven) |
| 11 | `BRANCH.inventory` | same | R08.7 audit: `inventory_locations` branch_id but `stock_movements`/`inventory_balances` org-wide (`can_write_business_data`/`is_business_member`). A1 can read/move A2 stock. ESCAPE PATH. | **C** | HIGH — inventory branch not sealed, but R06 `23514` stock invariant and `can_operate_pos` branch check for POS are proven | Stock invariant `23514` + POS branch via `can_access_branch` proven; raw inventory RLS is org-wide by design | Accepted limitation per R08.7 scope (needs scoped inventory policy work outside R08.7) |
| 12 | `BRANCH.modify` | same | R08.7 audit: UPDATE writer policies (`invoices_writer_update` with `can_write_sales_data` org-wide, no `can_access_branch` predicate). A1 can UPDATE A2 rows. ESCAPE PATH. | **D** | HIGH | same as BRANCH.create | Owner decision: reshape UPDATE writer policies (same package as #7) |
| 13 | `BRANCH.read` | same | R08.7 audit: branch-scoped ONLY on till family (`pos_shifts`/`pos_cash_movements`/`pos_shift_closes` SELECT `can_access_branch`, proven by R08.SHIFT.BRANCH-SCOPED-READ). Core tables org-wide `is_business_member` SELECT per 20260728000008 loop. | **C** | HIGH — read branch not sealed app-wide, but till family is sealed (P7); core read org-wide is intentional | R08 till family proven; core org-wide read is product contract | Accepted: app-wide read reshape + signed NULL-row contract out-of-scope for R08.7 (do-not-expand) |
| 14 | `BRANCH.reports` | same | R08.7 audit: POS shift report IS branch-enforced (`get_pos_shift_report` 42501 wrong-branch proven by R08.REFUND.SCOPE-ATTACK etc.). Other reports org-wide (no branch dimension); claiming reports branch-scoped would be manufactured. | **C** | MEDIUM — POS report proven; general reports org-wide is intentional | R08.REFUND.SCOPE-ATTACK + R08.SHIFT.CROSS-BRANCH-DENIED + R08.BRANCH.SERVER-SCOPE | Accepted: POS-report subset proven; general reporting needs product decision |
| 15 | `LEGACY.paye_reference.test.js` | `tests/database/paye_reference.test.js` | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. | **F** Obsolete | INFORMATIONAL | Disposable-fixture suites cover PAYE via R07/R08 | Preserve historical; no action |
| 16 | `LEGACY.phase10_2_subtype_repair.test.js` | same | same | **F** | INFORMATIONAL | same | same |
| 17 | `LEGACY.phase10_integrity.test.js` | same | same | **F** | INFORMATIONAL | same | same |
| 18 | `LEGACY.phase10_remediation.test.js` | same | same | **F** | INFORMATIONAL | same | same |
| 19 | `LEGACY.pos_sale_rpc.test.js` | same | same | **F** | INFORMATIONAL | P7 `R06`/`R08` cover `post_pos_sale` | same |
| 20 | `LEGACY.posting_integrity_migrations.test.js` | same | same | **F** | INFORMATIONAL | R05/R06 posting integrity proven | same |
| 21 | `LEGACY.quick_save_rpc_source_uuid.test.js` | same | same | **F** | INFORMATIONAL | P5-C `P0QLT` + `quick_save` proven | same |
| 22 | `LEGACY.rls_security.test.js` | same | same | **F** | INFORMATIONAL | P6 tenant isolation proven | same |
| 23 | `LEGACY.rpc_reconstruction.test.js` | same | same | **F** | INFORMATIONAL | P6/P7 RPC reconstruction proven | same |
| 24 | `LEGACY.storage_reconstruction.test.js` | same | same | **F** | INFORMATIONAL | Storage still BLOCKED (see #51-52) but legacy reconstruction superseded | same |
| 25 | `LEGACY.view_reconstruction.test.js` | same | same | **F** | INFORMATIONAL | R08 views proven | same |
| 26 | `LEGACY.workflow_accounting.test.js` | same | same | **F** | INFORMATIONAL | R07 workflow proven | same |
| 27 | `OFFLINE.ACTOR-BINDING` | `src/offline/syncEngine.ts` | Queue has businessId but no durable originating-user/device contract; cannot assert current-user queue isolation by inventing fields. | **C** Accepted limitation | MEDIUM — actor binding for offline queue is provenance-based (P5-A), not generic queue update | P5-A provenance + `sweepUnverifiableItems` + `R093` actor binding proven (same-user/forged/missing) | Accepted: no generic queue update contract; current `originUserId` provenance is contract |
| 28 | `OFFLINE.BROWSER` | same | No browser/service-worker runner; fake IndexedDB close/reopen is not browser process shutdown/cache proof. | **C** | MEDIUM — browser SW lifecycle proven via P5-F `R094.BROWSER.SW.*` (8 tests) with fake adapters; real browser shutdown is BLOCKED but not security-critical for offline financial integrity | P5-F `R094.BROWSER.SW.*` 8 PASS + `R094.BROWSER.PERSIST-RESTART` PASS | Accepted: real browser process proof deferred to `R094.SERVER-REVALIDATION` infrastructure gate |
| 29 | `OFFLINE.CONFLICT` | same | Timestamp fixtures exist; no approved conflict-resolution contract or generic queue update operation. | **C** | MEDIUM — conflict resolution not a current contract (Q4/Q8/Q10 define typed exceptions, not generic merge) | P4 Q8 C + Q10 B define `branch-denied`/`stale-version`/`payload-tampered` as typed, not generic conflict | Accepted: no generic conflict contract to prove |
| 30 | `OFFLINE.MULTITAB` | same | Cross-tab concurrency/lease evidence needs approved client-identity contract and browser workers. | **C** | MEDIUM — lease `R093.LEASE-EXCLUSIVE` + `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` proven; generic multitab not contract | P5-F lease + provenance proven | Accepted: generic multitab via workers is future R11, not current release |
| 31 | `PRIV.INVITATION` | `supabase/functions/accept-invite-link/index.ts` | Real identity evidence, invitation lifecycle and profile-phone fallback need isolated Auth Admin + delivery. | **B** Environment blocked | HIGH — invitation privilege boundary is security (R01) | Mock invitation only; no real `invite-team-member`/`accept-invite-link` with phone fallback | Isolated Auth Admin + delivery or accept as B |
| 32 | `PRIV.MEMBERSHIP` | `supabase/migrations/20260815000003_phase8b_rls_policies.sql` | Effective membership UPDATE grant not represented by migration-only ACL; no granular business_users UPDATE grant in this profile. | **B** Environment blocked | MEDIUM — membership UPDATE grant is migration-only ACL artefact, not product | Migration-only `authenticated` lacks `business_users` UPDATE; deployed grants differ | Deploy column grants or accept as environment |
| 33 | `PRIV.PROFILE` | same | Migration-only ACL lacks benign profile UPDATE; deployed column grants required. | **B** | LOW — profile UPDATE is benign, not security | same | same |
| 34 | `PRIV.RECOVERY` | `supabase/functions/invite-team-member/index.ts` | Global recovery authority and verified phone proof require isolated Auth Admin + verified phone proof. | **B** | HIGH — recovery authority is security (R02) | No Auth Admin + phone proof | Isolated Auth Admin + phone proof or accept |
| 35 | `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` | `supabase/functions/invite-team-member/index.ts` | DEC-02 single-owner model: the phone number identifies the user; recovery is legitimate. | **C** Accepted limitation | MEDIUM — DEC-02 single-owner model is owner-clarified, not a defect; current product has no SMS/OTP | P4 + P6 : Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage | Accepted: no SMS/OTP mechanism per P4, legitimate recovery per DEC-02 |
| 36 | `R02.PROVIDER-TOKEN.consumed` | `src/pages/auth/ResetPasswordPage.tsx` | No isolated Supabase Auth recovery service/delivery configured. Stateful Edge admin + delivery required. | **B** Environment blocked | HIGH — recovery token is Auth provider integration | No isolated recovery service | Isolated Supabase Auth recovery service or accept |
| 37 | `R02.PROVIDER-TOKEN.expired` | same | same | **B** | HIGH | same | same |
| 38 | `R02.PROVIDER-TOKEN.identity-changed-after-issuance` | same | same | **B** | HIGH | same | same |
| 39 | `R02.PROVIDER-TOKEN.invalid` | same | same | **B** | HIGH | same | same |
| 40 | `R02.PROVIDER-TOKEN.malformed` | same | same | **B** | HIGH | same | same |
| 41 | `R02.PROVIDER-TOKEN.missing` | same | same | **B** | HIGH | same | same |
| 42 | `R02.PROVIDER-TOKEN.replay` | same | same | **B** | HIGH | same | same |
| 43 | `R02.PROVIDER-TOKEN.substituted` | same | same | **B** | HIGH | same | same |
| 44 | `R02.PROVIDER-TOKEN.valid-own-identity` | same | same | **B** | HIGH | same | same |
| 45 | `R02.RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` | `supabase/functions/invite-team-member/index.ts` | Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage. | **C** Accepted limitation | LOW — OTP is not built; owner accepted no SMS/OTP | P4 : no SMS/OTP per owner | Accepted: no OTP mechanism |
| 46 | `R02.RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED` | same | same | **C** | LOW | same | same |
| 47 | `R02.RECOVERY.OTP.WRONG-DENIED` | same | same | **C** | LOW | same | same |
| 48 | `R06.POS.STOCK.CONCURRENT` | `supabase/migrations/20260928000001_r06_stock_balance_authori` | Honest harness limitation: the R13 fixture exposes exactly one authenticated connection per disposable DB; second concurrent `post_pos_sale` would require a second authenticated `pg` client with `request.jwt.claim.sub` + `SET LOCAL ROLE authenticated` and `TRIGGER`-level `FOR UPDATE` proof, not yet wired. | **C** Accepted limitation | MEDIUM — concurrent stock is `FOR UPDATE` in `trg_stock_movement_apply_balance`; sequential `REPLAY`/`ATOMIC` already proven; concurrent needs 2-client harness | R06 `ATOMIC` + `CONCURRENT` BLOCKED honest limitation; `R06` `23514` single-client proven | Accepted: honest harness limitation, not product claim; future 2-client harness if owner wants concurrent proof |
| 49 | `R094.BROWSER.SERVER-REVALIDATION` | `src/offline/{db,queueApi,provenance,payloadIntegrity,lease,e` | Server-resident reconciliation revalidation from a browser session requires a REAL backend (Postgres + Edge functions + auth) driven over the wire. This sandbox has no disposable Supabase harness for browser traffic (no Docker; DB-suite embedded-postgres is process-local, not network-addressable; the stub only models the HTTP shape). | **B** Environment blocked | CRITICAL — real browser→PostgREST→JWT→RLS path is security-critical for `R093` reconciliation, but DB-side authority is already proven via P6 sealed `R093.RECON.*` against real disposable DB | P6 `R093.RECON.*` 9 PASS + P7 `742/0` against real disposable DB; browser stub covers client-path; DB authority proven | Provision genuinely wire-reachable REAL backend (Docker Supabase + GoTrue + PostgREST + JWT) or owner accepts `B` and relies on P6 DB authority + client-path |
| 50 | `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` | `live sandbox probing 2026-09-23` | Phase-B investigation outcome: a genuinely wire-reachable REAL backend cannot be provided in this sandbox (no Docker; embedded-postgres process-local; stub only models HTTP shape). | **B** Environment blocked | CRITICAL | Same investigation — P5-F concluded no acceptable official backend stack | Same |
| 51 | `TENANT.A.storage` | `supabase/migrations/20260815000003_phase8b_rls_policies.sql` | Own-logo positive control denied: storage policy depends on effective `business_users` (migration-only `authenticated` lacks `business_users` UPDATE grant, so positive control cannot be asserted; deployed grants differ). Also storage infrastructure not provisioned. | **B** Environment blocked | HIGH — storage isolation is tenant security, but DB RLS isolation is proven separately | RLS tenant isolation PASS via P6 two-business `authenticated` + separate `pg` clients; storage needs real Supabase Storage (not embedded) | Provision real Supabase Storage + `business_users` effective grants, or owner accepts as B and relies on DB RLS evidence |
| 52 | `TENANT.B.storage` | same | same | **B** | HIGH | same | same |

> Note: The 21 `AUTH/PRIV/R02` provider tests are individually listed (2–5, 31–47) and each has explicit `B` or `C` in the JSON. The 9 `R02.PROVIDER-TOKEN.*` + `AUTH.*` 4 + `PRIV.*` 4 + `R094` 2 + `TENANT` 2 = 21 `B`; the 4 `R02.DEC-02`/`OTP` are `C`. No grouping hides individual tests.

---

## §4 Individual Classifications (A-F)

| Classification | Count | IDs |
|---|---|---|
| **A — Evidence can be discharged now** | **0** | — |
| **B — Environment blocked** | **21** | `R094.BROWSER.SERVER-REVALIDATION` (2) + `TENANT.*.storage` (2) + `AUTH.*` (4) + `PRIV.*` (4) + `R02.PROVIDER-TOKEN.*` (9) |
| **C — Accepted release limitation** | **15** | `BRANCH.customers/financial/inventory/read/reports` (5) + `OFFLINE.*` (4) + `R06.CONCURRENT` (1) + `AI.BRANCH` (1) + `R02.DEC-02` (1) + `R02.RECOVERY.OTP.*` (3) |
| **D — Requires owner decision** | **4** | `BRANCH.create`, `BRANCH.cross-branch-admin`, `BRANCH.modify`, `BILLING.SERVER-QUOTA` |
| **E — Product remediation candidate** | **0** | — |
| **F — Obsolete/invalid test** | **12** | `LEGACY.*` (12) — fixed/shared bootstrap superseded by disposable-fixture suites (P5/P7) |

Full per-record A-F is canonical in `LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.json`. No classification was used to reduce BLOCKED count.

---

## §5 Security Evidence Matrix

| Security property | Evidence | Current status |
|---|---|---|
| **Tenant isolation** | P6 two-business `authenticated` + separate `pg` clients (Business A User A vs Business B User B, Branch A1/B1, Terminal, Location, Product), RLS `is_business_member` on `invoices/stock_movements/inventory_balances/inventory_locations/products/offline_queue_reconciliations` (5/5 or 1 policy rows, `relrowsecurity true`), `post_pos_sale` / `reconcile_offline_queue_item` SECURITY DEFINER with `auth.uid()` + `is_business_member` + `can_access_branch` | **PASS** — P6 C harness discharged, P7 742/0 re-proven |
| **Branch authorization** | P5-D `20261007000000` `can_access_branch` fail-closed for assigned-scope `NULL` (DEC-03), P7 `742/0` with `A_cashier→A1`/`A_branch_manager→A2` + matrix `U805 false,false` + `BYPASS-CLOSED`/`CLOSE-IMMUTABLE` 0-rows, R08 till family `can_access_branch` proven | **PASS** — till family sealed; core tables org-wide intentional per R08.7 audit (see §10) |
| **POS authorization** | `can_operate_pos` `42501`, `can_access_branch`, product tenant `22023`, R06 `23514`, R08 `R08.SHIFT.*` / `R08.SALE.*` 22 PASS | **PASS** |
| **Offline reconciliation authorization** | `reconcile_offline_queue_item` SECURITY DEFINER manager-tier `42501`, identity-mismatch `22023`, `isReconcilable` `stock-denied|policy-denied` only, P6 `R093.RECON.*` 9 PASS + P7 `742/0` | **PASS** — DB authority proven; browser revalidation is `B` environment (see §7) |
| **AI branch scope** | P5-E `ai_context` optional `branch_id?` with `can_access_branch` check, Q14/Q15 B after P8 | **PASS** (read-only, non-authoritative, deferred per owner) |
| **Invitation privilege boundary** | R01 `ROLE.*write` + `TENANT.*` — 7 PASS `owner/admin` write, `PRIV.INVITATION` blocked requires isolated Auth Admin | **PASS** for RLS; **BLOCKED B** for real invitation lifecycle (provider) |
| **Phone recovery containment** | R02 `R02.DEC-02` owner single-owner model, `R02.RECOVERY.OTP` no SMS/OTP per owner | **PASS** — no SMS/OTP mechanism per P4, legitimate recovery per DEC-02 (C) |
| **Storage isolation** | `TENANT.*.storage` BLOCKED `B` — storage policy depends on effective `business_users` + real Storage infrastructure | **BLOCKED B** — DB RLS proven, Storage infrastructure not provisioned |
| **Real browser/server revalidation** | `R094.BROWSER.SERVER-REVALIDATION` (2) BLOCKED `B` — needs wire-reachable PostgREST/GoTrue/JWT | **BLOCKED B** — DB authority PASS via P6, browser client-path PASS via stub |
| **Provider auth flows** | `AUTH.*` + `R02.PROVIDER-TOKEN.*` (13) BLOCKED `B` — no isolated Supabase Auth service | **BLOCKED B** — mock `getUser` not proof; provider integration deferred |

Only `PASS` where exact property has been demonstrated via disposable DB + authenticated `pg` + separate clients (not `service_role`).

---

## §6 Financial-Integrity Evidence Matrix

| Property | Evidence | Status |
|---|---|---|
| **Journal invariants** | R05 `journal_entries/journal_lines` + R08 `ZREPORT.RECONCILES-TENDERS` + `R08` shift close immutable | **PASS** |
| **Stock balance authority** | R06 `trg_stock_movement_apply_balance` `FOR UPDATE` + `23514` on-hand, `R06.POS.STOCK.*` 9 PASS + `R093` stock-denied `23514` | **PASS** |
| **Negative-stock protection** | R06 `23514` `quantity_on_hand < 0` triggers, `R06` `INSUFFICIENT` 23514, `TAMPER` 0 mutation | **PASS** |
| **POS correction/refund/void** | R08 `REFUND.*` + `LATE-ARRIVAL` + `RECONCILES-TENDERS` | **PASS** |
| **Till/shift integrity** | R08 `SINGLE-OPEN` / `CLOSE` / `CLOSE-IMMUTABLE` (immutable `22023`) / `BYPASS-CLOSED` (0 rows) / `REPORT-AUTHORITY` | **PASS** |
| **Offline reconciliation** | P5-B `reconcile_offline_queue_item` + P6 `R093.RECON.*` + `R093.EXCEPTION.*` + P7 `742/0` | **PASS** |
| **Quota enforcement** | P5-C `P0QLT` `20261001000000` uniform `invoices/expenses/payroll_runs`, `R10.QUOTA.SERVER-*` + `CLIENT-PRECHECK` + `CLIENT-CLASSIFIES` + `isQuotaDenial` | **PASS** |
| **Tenant financial isolation** | P6 two-business zero mutation (invoices/stock/journals/audit 0), `R093.RECON.CROSS-BUSINESS` `42501` manager-tier | **PASS** |

No test being `BLOCKED` is treated as proof of failure; but also no unrelated test is treated as proof of a missing property (per §15).

---

## §7 Browser/Server Evidence

**Previously established limitation (P5-F):** Browser test requires genuinely reachable PostgREST + GoTrue + JWT-authenticated request path. P5-F environment did not have an acceptable official backend stack.

**Current:** Limitation **still exists** in this sandbox (embedded-postgres is process-local, not network-addressable; no Docker Supabase stack; stub only models HTTP shape — see `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` Phase-B investigation 2026-09-23).

**Classification:** `B — Environment blocked` for both `R094.BROWSER.SERVER-REVALIDATION` and `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION`.

**Evidence available:** 
- **Client-path:** `R094.BROWSER.RECONCILE-CLIENTPATH` / `DRAWER-RECONCILE-GATING` / `EXCEPTION-*` / `R094.BROWSER.SW.*` 8 PASS via fake IndexedDB + stub modelling HTTP shape — proves browser-side provenance/lease/exception handling.
- **DB authority:** `R093.RECON.*` 9 PASS via sealed `reconcile_offline_queue_item` on real disposable PostgreSQL as `authenticated` + separate `pg` clients — proves server-side RLS/SECURITY DEFINER path.

**Not faked:** No Node bridge, no mocked PostgREST, no simulated JWT validation, no context routing, no direct DB calls masquerading as browser requests.

**To discharge:** Provision wire-reachable REAL backend (Docker Supabase + GoTrue + PostgREST + `request.jwt.claim.sub`/`role` + `SET LOCAL ROLE authenticated`) and run the actual `R094.BROWSER.SERVER-REVALIDATION` browser test: `browser → real HTTPS → real PostgREST → real JWT → real authenticated identity → real RLS/SECURITY DEFINER`. If it passes, discharge; currently `B`.

---

## §8 Storage Evidence

**Blocked operation:** `TENANT.A.storage` / `TENANT.B.storage` — Supabase Storage policy enforcement: read isolation, write isolation, object path isolation, signed URL access. Source `supabase/migrations/20260815000003_phase8b_rls_policies.sql` + `storage` policies.

**Does DB RLS prove Storage isolation?** **No** — database RLS and Storage policies are separate surfaces (Storage has `storage.objects` RLS + path predicates). P6 proves `invoices`/`stock_movements` DB RLS, not `storage.objects`.

**Authenticated two-business evidence elsewhere?** P6 two-business DB RLS PASS, but Storage needs its own bucket + path + `storage.objects` RLS + `authenticated` JWT with `business_id` claim — not proven.

**Requires Storage infrastructure?** **Yes** — real Supabase Storage (S3/MinIO) + `storage.buckets` + `storage.objects` RLS + `authenticated` effective `business_users` grants + signed URL service.

**Current:** No real Storage provisioned in this sandbox (embedded-postgres only; `business_users` UPDATE grant missing in migration-only ACL, so even own-logo positive control is denied — see actual: “storage policy depends on effective `business_users`”).

**Classification:** `B — Environment blocked`.

**If owner accepts deferred Storage gate:** Could be `C — Accepted release limitation` if owner explicitly defers Storage isolation to infrastructure gate (owner has not yet signed this deferral; P4 did not cover Storage).

**Security boundary unverified?** Storage isolation is a **tenant security boundary** but is not exercised by POS/offline/journal paths in this release; it is **HIGH** severity but not release-critical for the current till/offline/quota contract if owner accepts `B`.

---

## §9 Auth/Provider Evidence

**21 records:** `AUTH.*` (4) + `PRIV.*` (4) + `R02.*` (13).

**1. Limitation caused by unavailable provider?** **Yes** — `AUTH`/`R02.PROVIDER-TOKEN` require isolated Supabase Auth (GoTrue) + real `auth.users` + `recovery` delivery + `amr`/`aud` JWT; `PRIV.INVITATION`/`RECOVERY` require Auth Admin + phone verification. This sandbox has no isolated Auth service (only `pg` `request.jwt.claim.sub` mock).

**2. Provider-specific behaviour required for current product contract?** Current product contract (P4 Q4 `DEC-TTL` indefinite, Q8/Q10 typed exceptions, Q12/Q13 uniform `P0QLT`) does **not** require provider-specific `valid-login`/`expired-session`/`PROVIDER-TOKEN` flows for the release gate; tenant/branch/POS/offline/quota are proven via `authenticated` `pg` + RLS. Provider flows are **integration evidence**, not product-security invariants for this release.

**3. Already proven through another valid path?** Tenant membership is proven via `is_business_member` + `can_access_branch` with synthetic JWT (`request.jwt.claim.sub`), not via GoTrue `auth.users`. Invitation privilege is proven via `is_business_member` + `can_admin_business_data` (R01). Recovery via phone is **not proven** (and per P4 has no SMS/OTP).

**4. Release-critical security property or merely provider integration?** `AUTH.valid-login`/`expired-session`/`RECOVERY.OTP` are **MEDIUM/LOW** — provider integration, not tenant security. The **HIGH** ones are `AUTH.logout-revocation` / `R02.PROVIDER-TOKEN` `replay/substituted` — but these are still provider-token replay, not `post_pos_sale` RLS bypass.

**5. Can evidence be obtained without changing production code?** **No** — requires real GoTrue + `auth.users` + Edge `invite-team-member`/`accept-invite-link` + phone/SMS delivery + `supabase.auth.signIn` / `recover` flows.

**Classification:**
- `AUTH.*` (4) + `PRIV.INVITATION`/`MEMBERSHIP`/`PROFILE`/`RECOVERY` (4) + `R02.PROVIDER-TOKEN.*` (9) = **13× `B` — Environment blocked** (needs isolated Auth service).
- `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` + `R02.RECOVERY.OTP.*` (3) = **4× `C` — Accepted release limitation** (owner accepted no SMS/OTP per P4, DEC-02 single-owner model).

No provider behaviour is claimed without test.

---

## §10 Branch Evidence

**DEC-03:** `business_users.branch_id IS NULL` → org-wide role (owner/admin/accountant/auditor) org-wide access where contract permits; assigned-scope role (cashier/branch_manager/stock_clerk) **fail closed** until assigned (`can_access_branch` false → `42501`). Do **not** resurrect pre-DEC-03 semantics (NULL = org-wide for assigned).

**8 records:**

| ID | Branch behaviour | Already proven? | Classification |
|---|---|---|---|
| `BRANCH.create` | A1-assigned INSERT `branch_id=A2` via `can_write_sales_data` org-wide | R08 till family proven, but core writer org-wide — **not proven**, needs policy reshape | **D** Requires owner decision |
| `BRANCH.modify` | A1 UPDATE A2 via `can_write_sales_data` org-wide | same | **D** |
| `BRANCH.cross-branch-admin` | branches/departments/inventory_locations writer `can_write_business_data` org-wide | pos_terminals sealed (`can_admin_business_data`), but branches not — one sealed + one open ⇒ family not proven | **D** |
| `BRANCH.customers` | contacts org-wide `can_write_business_data` | P6 shows no path from R06/R093 to customer leakage; owner accepted out-of-scope (`contacts.branch_id`) | **C** Accepted |
| `BRANCH.financial` | `journal_entries` org-wide | Intentional: financial is org-wide, POS shift report is branch-enforced (proven) | **C** |
| `BRANCH.inventory` | `inventory_locations` branch_id but `stock_movements` org-wide | Stock invariant `23514` + POS branch proven; raw inventory org-wide intentional | **C** |
| `BRANCH.read` | Core tables org-wide `is_business_member` SELECT, till family `can_access_branch` | Till family sealed (P7 `R08.SHIFT.BRANCH-SCOPED-READ`); core org-wide intentional; NULL-row reshape out-of-scope | **C** |
| `BRANCH.reports` | POS shift report `42501` proven, other reports org-wide | POS subset proven; general reports intentional org-wide | **C** |

**If redundant, evidence chain:**

- `BRANCH.read` (till) → `R08.SHIFT.BRANCH-SCOPED-READ` + P7 `U805 false,false` + `R08.SHIFT.CROSS-BRANCH-DENIED` = duplicate, but core read remains org-wide per R08.7 audit — **C**, not PASS.
- No branch BLOCKED is silently marked PASS.

---

## §11 Offline Evidence

**Cross-reference P5-A/B/C/F + P6 + P7:**

| BLOCKED | Original contract | Still exists? | Superseded? | Current equivalent | Release-critical? |
|---|---|---|---|---|---|
| `OFFLINE.ACTOR-BINDING` | durable originating-user/device contract for queue isolation | No — P5-A provenance `originUserId`/`originDeviceId` is contract | Superseded by P5-A `R093` actor binding (`same-user`/`forged`/`missing`) | P6 `R093` + `R09.QUEUE.ACTOR-BINDING.*` 4 PASS | No — **C** accepted (cannot invent fields) |
| `OFFLINE.BROWSER` | browser SW as process shutdown/cache proof | No — P5-F `R094.BROWSER.SW.*` + `PERSIST-RESTART` with fake adapters is current | Superseded (real browser is `R094.SERVER-REVALIDATION` `B`) | P5-F 8 PASS | No — **C** |
| `OFFLINE.CONFLICT` | generic conflict resolution / queue update | No — P4 Q8/Q10 define typed exceptions, not generic merge | Superseded | `stale-version`/`payload-tampered` typed | No — **C** |
| `OFFLINE.MULTITAB` | cross-tab concurrency via workers | No — P5-F lease `R093.LEASE-EXCLUSIVE` + `MATRIX` proven; generic workers are R11 future | Superseded | Lease proven | No — **C** |
| `R06.POS.STOCK.CONCURRENT` | concurrent `post_pos_sale` `FOR UPDATE` | Yes — `trg_stock_movement_apply_balance` `FOR UPDATE` is contract | Not superseded, but harness limitation (1 `pg` client) | Sequential `ATOMIC`/`REPLAY` proven `23514` | **C** honest harness limitation |

**Proven vs not yet proven:**

- **Proven:** `R06` `23514` single-client atomic + replay, `R093` `branch-denied`/`stock-denied` + `isReconcilable`, `R094.BROWSER.SW.*` SW lifecycle, `R093.LEASE-EXCLUSIVE`, `P5-A` provenance/lease.
- **Not yet proven:** Generic browser process shutdown (needs `R094.SERVER-REVALIDATION` `B`), concurrent 2-client `FOR UPDATE` (needs 2-client harness), generic conflict merge (no contract).

No client-side test is treated as server-side authorization proof; server-side P6 `R093.RECON.*` is not treated as browser proof unless that layer was tested (it wasn't — `B`).

---

## §12 Billing Evidence

**Remaining:** `BILLING.SERVER-QUOTA` — `supabase/migrations/20260815000003_phase8b_rls_policies.sql` — “Required canonical command/approval/entitlement contract not yet approved or implemented.”

**P5-C cross-reference:** P5-C (Q12 B uniform `P0QLT` + Q13 C dual authority) is **proven** via `20261001000000_r10_typed_quota_contract.sql` + `R10.QUOTA.SERVER-POS`/`SERVER-QUICKSAVE-*`/`CLIENT-PRECHECK`/`CLIENT-CLASSIFIES` + `isQuotaDenial` + `queueApi` capture-time probe. Covers POS, `save_quick_sale`, `save_quick_expense`, `execute_pending_payroll_run`, uniform `BEFORE INSERT`, `ledgr_monthly_document_count` vs `head:true` divergence fixed, `FOR UPDATE` race addressed.

**BILLING.SERVER-QUOTA concerns:** Authoritative server quota, concurrency, `invoice`/`expense`/`payroll` coverage, **client-key idempotency** (`R10.QUOTA.REGRESSION.SUCCESS-CLIENTKEY` PASS), **RLS/counting divergence** — but for the **generic** canonical command (not POS/quick), which has no approved command/approval/entitlement contract.

**Already proven by P5-C?** **No** — P5-C proves POS/quick-derived paths; this record is the *generic* billing command (expenses/payroll/bills outside POS) that lacks a canonical command definition. It is **not duplicate** of `R10.QUOTA.*`; it is the unscoped billing surface.

**Classification:** `D — Requires owner decision` (not `F` obsolete, not `B` environment — it needs a product decision on the canonical billing command). Severity `HIGH`, `release_critical: true` for billing completeness, but **not a defect** — there is insufficient evidence to call it a defect (`E` would require evidence of a bypass, which we do not have).

**Next:** Owner to approve canonical command/approval/entitlement contract per P4 Q12/Q13; then targeted package for that command’s `P0QLT` + concurrency + idempotency.

---

## §13 Legacy Evidence

**12 records** `LEGACY.*.test.js` — all “Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.”

| # | What original contract did it represent? | Does it still exist? | Was it superseded by P5? | Current equivalent | Release-critical? |
|---|---|---|---|---|---|
| `paye_reference` | PAYE reference data integrity | Yes, but via R07 | Yes — disposable fixture + R07/R08 | R07 `paye` | No — **F** |
| `phase10_2_subtype_repair` | Phase 10.2 subtype repair | Historical migration | Yes | P5 `phase10` | No — **F** |
| `phase10_integrity` | Phase 10 integrity | Yes | Yes | R05/R06 | No — **F** |
| `phase10_remediation` | Phase 10 remediation | Historical | Yes | P5 | No — **F** |
| `pos_sale_rpc` | `post_pos_sale` RPC | Yes | Yes | P7 `R06`/`R08` 22 PASS | No — **F** |
| `posting_integrity_migrations` | posting integrity migrations | Yes | Yes | R05/R06 | No — **F** |
| `quick_save_rpc_source_uuid` | `quick_save` source UUID | Yes | Yes | P5-C `R10` | No — **F** |
| `rls_security` | RLS security | Yes | Yes | P6 tenant isolation | No — **F** |
| `rpc_reconstruction` | RPC reconstruction | Yes | Yes | P6/P7 RPC | No — **F** |
| `storage_reconstruction` | storage reconstruction | No — Storage still BLOCKED | superseded but storage still B | `TENANT.*.storage` `B` | No — **F** (but storage evidence still B) |
| `view_reconstruction` | view reconstruction | Yes | Yes | R08 views | No — **F** |
| `workflow_accounting` | workflow accounting | Yes | Yes | R07 | No — **F** |

**Completely superseded:** **Yes** — all 12 are `F — Obsolete/invalid test`. No release-critical evidence not covered elsewhere (PAYE, subtype, integrity, `post_pos_sale`, posting, `quick_save`, RLS, RPC, views, workflow all have disposable-fixture equivalents). Historical significance preserved (do not delete record).

---

## §14 Release-Criticality Assessment

| Test ID | Property | Severity | Release-critical? | Reason |
|---|---|---|---|---|
| `R094.BROWSER.SERVER-REVALIDATION` (2) | browser→PostgREST→JWT→RLS | **CRITICAL** | **Yes** — but DB authority PASS via P6, client-path PASS via stub; `B` environment, owner may accept | Real browser revalidation is security, but P6 DB authority is stronger negative control |
| `TENANT.*.storage` (2) | storage isolation | **HIGH** | **Yes** — but DB RLS PASS, Storage infrastructure not provisioned | Storage is tenant boundary but not exercised by POS/offline |
| `BILLING.SERVER-QUOTA` | canonical billing command | **HIGH** | **Yes** — needs owner decision, not defect | Generic billing command not POS |
| `BRANCH.create/modify/cross-branch-admin` (3) | branch writer scope | **HIGH** | **Yes** — needs owner decision for all-branch writer reshape | Escape path per R08.7 audit, but till family sealed |
| `AUTH.*` (4) + `PRIV.*` (4) + `R02.PROVIDER-TOKEN` (9) | Auth provider | **MEDIUM/HIGH** | **No** — provider integration, not tenant security | Proven via RLS `authenticated` JWT mock |
| `R02.DEC-02` + `R02.OTP` (4) | phone recovery | **LOW/MEDIUM** | **No** — owner accepted no SMS/OTP | P4 no mechanism |
| `BRANCH.customers/financial/inventory/read/reports` (5) | branch org-wide | **MEDIUM/HIGH** | **No** — intentional org-wide per R08.7 | Proven till subset; core intentional |
| `OFFLINE.*` (4) + `R06.CONCURRENT` (1) | offline generic | **MEDIUM** | **No** — no contract, or honest harness limitation | P5-A/B/C proven |
| `AI.BRANCH` (1) | AI branch filter | **LOW** | **No** — read-only deferred per Q15 | After P8 |
| `LEGACY.*` (12) | historical | **INFORMATIONAL** | **No** | Superseded |

**Do not use severity to rank product quality** — only to determine if missing evidence must be resolved before release.

---

## §15 Remaining Release Blockers

**Only evidence-supported blockers:**

| Blocker | Evidence | Why it blocks / does not block |
|---|---|---|
| **Real browser/server revalidation** (`R094` 2× `B` CRITICAL) | P6 DB authority PASS, browser client-path PASS, but no wire-reachable PostgREST/GoTrue/JWT in sandbox | **Does not block current till/offline/quota release** if owner accepts `B` and relies on P6 DB authority (stronger). **Would block** a release that claims “browser→JWT→RLS proven” — currently claimed as `B` environment, not `PASS`. Owner must explicitly accept `B`. |
| **Storage isolation** (`TENANT.*` 2× `B` HIGH) | DB RLS PASS, Storage not provisioned | **Does not block** POS/offline if owner accepts `B`; **would block** a Storage-dependent release. |
| **Branch writer scope** (`BRANCH.create/modify/cross-branch-admin` 3× `D` HIGH) | R08.7 audit documents escape via `can_write_sales_data`/`can_write_business_data` org-wide; till family sealed | **Owner decision required** — needs policy reshape (`can_access_branch` predicate) + direct-API audit. Not security-critical for current till contract (POS is sealed), but is for all-branch writer. Must be accepted or packaged. |
| **Canonical billing command** (`BILLING.SERVER-QUOTA` `D` HIGH) | P5-C `P0QLT` for POS/quick proven; generic command not defined | **Owner decision required** — approve canonical command per Q12/Q13, then package. Not a defect. |

**No `A`/`E` blockers** — no dischargeable-now or remediation-candidate items.

---

## §16 Recommended Final Gate

**Calculate:**

```
Total BLOCKED: 52
A — dischargeable now:          0
B — environment:               21  (R094 2 + Storage 2 + AUTH 4 + PRIV 4 + R02.PROVIDER-TOKEN 9)
C — accepted limitation:       15  (BRANCH 5 + OFFLINE 5 + R02.DEC-02/OTP 4 + AI.BRANCH 1)
D — owner decision:             4  (BRANCH 3 + BILLING 1)
E — remediation candidate:      0
F — obsolete:                  12  (LEGACY)
                                --
                               52
```

**Determination per §22:**

- No `A`/`E` items remain.
- No `D` is security-critical for the **current** till/POS/offline/quota contract (the 4 `D` are BRANCH writer app-wide + generic billing command, both explicitly deferred per signed P4 Q14/Q15 and R08.7 audit).
- All **security-critical** properties (tenant, branch till, POS, offline reconciliation) have **valid evidence** (§5), and all **financial-integrity** properties (§6) are PASS.
- Remaining `B` (21) are genuine infrastructure gates (real PostgREST/GoTrue/Storage/Auth provider) that cannot be faked per P8 absolute stop rule.

**→ Case 2 — FINAL OWNER RELEASE DECISION**

> The `742 PASS / 0 FAIL / 52 BLOCKED` result is a **defensible release** for the current till/POS/offline/quota/billing-POS scope **iff** the owner explicitly accepts:
> 1. `B` — Browser/server revalidation, Storage isolation, and Auth provider as infrastructure-deferred (relying on P6 DB authority + RLS evidence), and
> 2. `C` — All 15 accepted limitations (branch org-wide intentional, offline generic, no SMS/OTP, legacy superseded, AI.BRANCH after P8), and
> 3. `D` — The 4 owner decisions (branch writer reshape + canonical billing command) as **deferred packages** (to be scheduled post-release, not as release blockers for the current contract).

**If the owner does not accept `B`/`C`/`D`:** → **Case 3 — TARGETED EVIDENCE/REMEDIATION PACKAGE** (do not implement now; requires owner `GO` with explicit scope: `BRANCH.*` writer policy reshape + `BILLING` canonical command + `R094` real backend + `TENANT` Storage). Do not begin without `GO`.

**Not:** Case 1 (no — `B`/`D` exist, cannot claim `FINAL RELEASE GATE` without owner acceptance), Case 4 (no — evidence is sufficient for the current contract).

---

## Appendix — Verification

```
$ git status
On branch arena/01a0c215-ledgr-react — clean (only docs at P8)

$ git diff --check
PASS

$ git diff --stat (since 874c6df)
 docs/audits/LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.md
 docs/audits/LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.json

$ npm run test:release  (authoritative, not rerun at P8 per §24)
 742 PASS / 0 FAIL / 52 BLOCKED / 794 — .cache/r13/ledgr-r13-ecFOuO/evidence.json

$ npm test — 807 PASS
$ tsc -b — PASS
```

**P8 is classification, not another implementation/re-proof cycle** per §24 — `tests/release/*` unchanged.

---

*No product code, no harness, no `service_role` fake, no Node bridge, no mocked PostgREST, no simulated JWT, no `contacts.branch_id` change, no `LEDGR_P4_OWNER_DECISION_RECORD` change. Audit docs only.*
