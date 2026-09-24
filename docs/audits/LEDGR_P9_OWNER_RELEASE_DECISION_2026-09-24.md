# P9 — Owner Release Decision / Scope Acceptance Gate

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)
**Branch:** `arena/01a0c215-ledgr-react`
**HEAD at P9 start:** `dc80e1c` `P8: classify final blocked release evidence` (parent `874c6df` P7, `090870b` P6, `efa8b54` P5 TRIAGE)
**Mode:** **DECISION PREPARATION ONLY** — no `src/` / `supabase/` / `tests/` / migrations / RLS / SECURITY DEFINER / harness / runtime changes. This phase prepares and records an informed owner decision; it does not implement.

> Do **not** implement anything. Do **not** modify source, SQL, migrations, RLS, SECURITY DEFINER, tests, harnesses, schemas, configuration, or runtime behaviour. Do **not** change `LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md`. Do **not** manufacture PASS. If a verification fixture would require changing product behaviour, STOP.

---

## §1 Decision Context

P5 (Model 3/4, R09.4, R11, P0QLT, DEC-03) delivered 5 implementation packages (P5-A/B/C/D/E/F) with 807/807 unit PASS. P6 proved cross-tenant isolation: `R06.POS.STOCK.CROSS-TENANT` and `R093.RECON.CROSS-BUSINESS` are **C — Harness defect**, no genuine tenant bypass, with two-business `authenticated` + separate `pg` clients and `relrowsecurity true` on all tenant tables. P7 normalised the harness (DEC-03 `NULL`→`42501` fail-closed, `42501`/`23514`/`P0QLT` distinction, `payloadVersion` stale-quarantine, `P0QLT` idempotent seed) and re-proved the release: **742 PASS / 0 FAIL / 52 BLOCKED / 794** (`ecFOuO`), `tsc -b` PASS, `lint` 0 errors, `build` PASS, no product changes. P8 classified the remaining 52 BLOCKED: `A 0, B 21, C 15, D 4, E 0, F 12`, with 0 security-critical and 0 financial-integrity blockers for the current till/offline/quota contract, but 21 environment/infrastructure gates and 4 explicit owner-decision items that must be scoped. P9 exists to make the release scope, limitations, and deferrals explicit so the owner can give a **GO / CONDITIONAL GO / NO-GO** for a precisely defined scope.

Owner signed record `LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md` (Q1–Q15: Q1 B stale-version, Q2 B unknown-version, Q3 A never reconcilable, Q4 A indefinite retention, Q8 C typed exception but ordinary failed, Q9 B stale-version, Q10 B clientKey-payload-mismatch, Q11 D never expand RECONCILABLE, Q12 B uniform P0QLT, Q13 C dual authority, Q14 B optional branch filter, Q15 B after BRANCH.* / P8) remains binding and unchanged.

---

## §2 Evidence Baseline

```
HEAD:       dc80e1c  P8: classify final blocked release evidence
Branch:     arena/01a0c215-ledgr-react
Parent P8:  874c6df  P7: normalize release harness and re-prove release
Parent P7:  090870b  P6 audit — Cross-Tenant Isolation Evidence (efa8b54) — C harness
P7 evidence: .cache/r13/ledgr-r13-ecFOuO/evidence.json — 742 PASS / 0 FAIL / 52 BLOCKED / 794
Unit:       npm test — 91 files, 807 PASS / 0 FAIL
Typecheck:  tsc -b — PASS
Lint:       eslint — 0 errors / 3 warnings (unused eslint-disable)
Build:      vite build — PASS (placeholder VITE_SUPABASE_URL)
P8:         A 0, B 21, C 15, D 4, E 0, F 12 — 0 remediation candidates, 0 security-critical blockers, 0 financial-integrity blockers
Git:        git diff --check PASS; git diff --stat since 874c6df = docs/audits only (P8); working-tree clean at P9 start
Do not reinterpret these figures without evidence.
```

Authoritative source documents (primary evidence base):

- `LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md` (15 decisions, signed)
- `LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` + P5-A/B/C/D/E/F evidence
- `LEDGR_P6_CROSS_TENANT_ISOLATION_AUDIT_2026-09-24.md` + `.json` (two-business authenticated isolation)
- `LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.md` + `.json` (67 FAIL → 0 via harness)
- `LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.md` + `.json` (52 BLOCKED A-F, security & financial matrices, per-record evidence_available/next_action)
- Current release evidence `ecFOuO` + exact test source + harness implementation + disposable-DB evidence

If a point is not supported by the evidence, it is marked **unresolved** below.

---

## §3 Proposed Release Scope

**Principle:** Do **not** silently broaden scope. A capability can be `Implemented` (exists in code, works in dev) vs `Release-certified` (proven by P5–P8 evidence for the defined scope) vs `Deferred` (exists but not certified for this release). Do not remove functionality merely because its evidence is incomplete; explicitly state its status.

**Proposed scope for owner review (strictly evidence-derived):**

The evidence supports a release **centered on the tested till/POS + financial recording + inventory/stock + branch till + offline queue/reconciliation + billing/quota + AI reporting (with branch controls) + multi-business tenant isolation** where each capability has a discrete proof (see §4). It does **not** automatically certify every implemented feature merely because the product contains it (see §5 for unverified).

**Included (candidate for `Release-certified`):**

- POS/till operations (sale, till open/close, cash movements)
- Business financial recording (invoices, invoice_lines, journal_entries/journal_lines, payments)
- Inventory/stock integrity (stock balance authority, negative-stock protection, `FOR UPDATE`)
- Branches and branch authorization **for the till family** (pos_shifts/pos_cash_movements/pos_shift_closes + `post_pos_sale` via `can_access_branch` fail-closed per DEC-03)
- Sales and payments
- Customers/suppliers **where currently implemented as org-wide** (see limitations)
- Financial reporting **where currently branch-scoped is POS shift report only** (other reports org-wide intentional)
- POS corrections/refunds/voids and till/shift integrity
- Offline queue/reconciliation **within the established contract** (typed `stock-denied`/`policy-denied` reconcilable; `branch-denied`/`stale-version`/`unknown-version`/`payload-tampered` permanently non-reconcilable per Q3/Q11; lease/provenance)
- Billing/quota enforcement **within the tested contract** (POS/quick `post_pos_sale`/`save_quick_*` + uniform `BEFORE INSERT` `P0QLT`, `isQuotaDenial`, capture-time + authoritative per Q13)
- AI/business reporting **with established branch controls** (optional `branch_id` filter with `can_access_branch`, read-only, non-authoritative, after P8 per Q14/Q15)
- Multi-business tenant isolation (RLS `is_business_member` + `can_access_branch`)

**Explicitly not included for certification in this scope (candidate `Deferred`/`NOT PROVEN`):**

- Full commercial subscription/billing lifecycle beyond the tested POS/quick `P0QLT` (generic canonical billing command — D item `BILLING.SERVER-QUOTA`)
- App-wide branch administration (creation/modification/cross-branch admin for branches/departments/inventory_locations — D items `BRANCH.*`)
- Branch-scoped customers, branch-scoped financials/inventory/reports beyond the till family (accepted per R08.7 audit — C items)
- Storage isolation with real `storage.objects` RLS (requires Storage infrastructure — B)
- Provider-specific AUTH flows (GoTrue `valid-login`/`expired-session`/`PROVIDER-TOKEN.*` — B)
- Browser→PostgREST→JWT→RLS revalidation from a real browser session (needs wire-reachable PostgREST/GoTrue — B)
- Generic offline conflict resolution / generic queue update / generic multitab workers (no contract — C)
- Legacy fixed-bootstrap suites (superseded — F)

The owner must explicitly approve this scope in §12 Q1 (see §13 consequence matrix).

---

## §4 Proven Capabilities

For the **proposed limited scope** above, each capability is **Release-certified** (PROVEN) with direct evidence:

| Capability | Evidence | Status |
|---|---|---|
| **Tenant isolation** | P6 two-business `authenticated` + separate `pg` clients (A User `13000000-...-0005` vs B User `...-0105`, Branch A1/B1, Terminal, Location, Product), RLS `relrowsecurity true` + `is_business_member` on `invoices/stock_movements/inventory_balances/inventory_locations/products/offline_queue_reconciliations`, SECURITY DEFINER `is_business_member`/`can_access_branch`/`post_pos_sale`/`reconcile_offline_queue_item` with `auth.uid()` + `request.jwt.claim.sub`/`role` | **PROVEN** |
| **POS sales** | R06/P6/P7 — `post_pos_sale` `can_operate_pos` `42501`, `can_access_branch`, product tenant `22023`, `23514` on-hand, P6 zero-mutation cross-tenant, P7 `742/0` | **PROVEN** |
| **Inventory** | R06 `trg_stock_movement_apply_balance` `FOR UPDATE` `23514`, `R06.POS.STOCK.*` 9 PASS + `REPLAY`/`ATOMIC`, P7 `742/0` | **PROVEN** |
| **Branch authorization** | P5-D `20261007000000` `can_access_branch` fail-closed DEC-03, P7 `A_cashier→A1`/`A_branch_manager→A2` matrix `U805 false,false`, `R08.SHIFT.BRANCH-SCOPED-READ` till family sealed | **PROVEN within tested contract** — till family only (see §8 for app-wide) |
| **Till/shift** | R08 `SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE` `22023`/`BYPASS-CLOSED` 0-rows/`REPORT-AUTHORITY`/`RECONCILES-TENDERS` | **PROVEN** |
| **POS corrections** | R07 `POS correction/refund/void` + R08 `REFUND.*`/`LATE-ARRIVAL` | **PROVEN** |
| **Offline reconciliation (within contract)** | P5-B `reconcile_offline_queue_item` manager-tier `42501`/`22023` + `isReconcilable` `stock-denied|policy-denied` only (Q3/Q11), P6 `R093.RECON.*` 9 PASS, P7 `742/0`, `R093.EXCEPTION.*` + `TAMPER` 0 mutation | **PROVEN within contract** |
| **Billing/quota (within tested contract)** | P5-C Q12 B uniform `P0QLT` `20261001000000` on `post_pos_sale`/`save_quick_*` + `BEFORE INSERT` + `ledgr_monthly_document_count`, Q13 C dual authority (capture-time `queueApi` + authoritative), `R10.QUOTA.*` 5 PASS + `REGRESSION.SUCCESS-CLIENTKEY`, `isQuotaDenial` | **PROVEN within tested contract** — POS/quick only (see §8 D4) |
| **AI branch scope** | P5-E `ai_context(business_id, branch_id?)` optional `can_access_branch` check, read-only, after P8 per Q14/Q15 | **PROVEN within contract** (non-authoritative, deferred until after P8) |
| **Multi-business** | P6 two-business isolation + P7 `TENANT.A/B.*` 10 PASS (pos/read/update/delete) | **PROVEN** (excluding Storage — see §5) |

Do not mark a capability PROVEN merely because an adjacent capability was tested — each row cites its own evidence.

---

## §5 Unverified Capabilities

| Capability | Evidence | Status | Relevant blocker | In intended limited release? |
|---|---|---|---|---|
| Storage isolation (`storage.objects` RLS, path, signed URL) | P8 `TENANT.*.storage` 2× `B` — DB RLS proven separately, Storage infrastructure not provisioned | **NOT independently proven** | `B` — `TENANT.A/B.storage` requires real Supabase Storage + effective `business_users` grants | **No** — exclude Storage-dependent claims |
| Provider authentication (GoTrue `valid-login`/`expired-session`/`PROVIDER-TOKEN.*` 9) | P8 `AUTH.*` 4 + `R02.PROVIDER-TOKEN.*` 9 × `B` — mock `getUser` only, no isolated Auth service | **NOT independently proven** | `B` — needs isolated GoTrue + delivery | **No** — exclude provider-specific claims; tenant membership proven via `authenticated` `pg` mock-JWT instead |
| Browser/server revalidation | P8 `R094.BROWSER.SERVER-REVALIDATION` 2× `B` CRITICAL — needs wire-reachable PostgREST/GoTrue/JWT; sandbox embedded-postgres process-local | **NOT independently proven** | `B` — needs Docker Supabase stack | **No** — rely on P6 DB authority + stub client-path; do not claim browser→JWT→RLS proven |
| Full commercial billing lifecycle | P8 `BILLING.SERVER-QUOTA` `D` — generic canonical command not defined (POS/quick `P0QLT` is proven) | **NOT proven** | `D` — canonical command/approval/entitlement per Q12/Q13 | **No** — limited to tested POS/quick `P0QLT`; full subscription deferred |
| App-wide branch admin (create/modify/cross-branch-admin) | P8 `BRANCH.create`/`modify`/`cross-branch-admin` `D` — writer `can_write_sales_data`/`can_write_business_data` org-wide, till family sealed but branches/inventory_locations not | **NOT proven** | `D` — needs `can_access_branch` reshape + direct-API audit | **No** — till operations are certified; app-wide admin deferred |
| Branch-scoped customers/financial/inventory/reports beyond till | P8 `BRANCH.customers`/`financial`/`inventory`/`read`/`reports` `C` — R08.7 audit: org-wide intentional, till family sealed | **NOT proven** (intentionally org-wide) | `C` — accepted limitation per R08.7 | **No** — org-wide is current contract (see §8) |

Nothing in this section is a product defect per P8 (`E 0`).

---

## §6 Build the Release Scope Matrix (per §6 spec)

| Capability | Evidence | Status | Relevant blocker | In intended limited release? |
|---|---|---|---|---|
| Tenant isolation | P6 two-business `authenticated` + separate clients, RLS `is_business_member` | **PROVEN** | None — P6/P7 | **Yes** — till/POS/offline/quota multi-tenant certified |
| POS sales | R06/P6/P7 `post_pos_sale` `42501`/`23514`/`P0QLT` | **PROVEN** | None | **Yes** |
| Inventory | R06 `trg_stock_movement_apply_balance` `23514` | **PROVEN** | None (concurrent is `C` harness) | **Yes** — sequential proven; concurrent `R06.CONCURRENT` is `C` honest harness |
| Branch authorization | P5-D `can_access_branch` DEC-03 + P7 `742/0` till family | **PROVEN** | None for till family; app-wide admin is `D` (see below) | **Yes** — till family only |
| Till/shift | R08 `SINGLE-OPEN`/`CLOSE-IMMUTABLE`/`BYPASS-CLOSED` | **PROVEN** | None | **Yes** |
| POS corrections | R07 + R08 `REFUND.*` | **PROVEN** | None | **Yes** |
| Offline reconciliation | P5-B `reconcile_offline_queue_item` + P6 `R093.RECON.*` + P7 | **PROVEN within contract** (`stock-denied`/`policy-denied` reconcilable only per Q11) | See P8 `B` browser revalidation (deferred) | **Yes** — within `RECONCILABLE` contract |
| Billing/quota | P5-C `P0QLT` uniform + dual authority + `R10.QUOTA.*` | **PROVEN within tested contract** (POS/quick) | `D` `BILLING.SERVER-QUOTA` generic command deferred | **Yes** — POS/quick only |
| AI branch scope | P5-E `ai_context` optional `branch_id` + `can_access_branch` | **PROVEN within contract** (read-only) | `C` `AI.BRANCH` deferred until after P8 per Q15 | **Yes** — after P8, non-authoritative |
| Storage isolation | P8 `TENANT.*.storage` | **NOT independently proven** | `B` — needs Storage infrastructure | **No** — exclude |
| Provider authentication | P8 `AUTH.*`/`R02.PROVIDER-TOKEN.*` | **NOT independently proven** | `B` — needs GoTrue | **No** — exclude |
| Browser/server revalidation | P8 `R094` 2× `B` | **NOT independently proven** | `B` — needs wire-reachable PostgREST/GoTrue | **No** — DB authority + stub client-path instead |

Do not mark a capability PROVEN merely because an adjacent capability was tested — each row cites its discrete evidence.

---

## §7 Class B — 21 Environment Blockers (per §7)

Review all 21 individually. For every item: what the test would prove / why it could not be executed / whether missing evidence affects intended limited release / whether it is a security boundary / whether owner can reasonably accept / whether it must be completed before expanding scope. Do **not** label the 21 as harmless simply because they are environmental.

**Categories: `R094` 2 + `TENANT.storage` 2 + `AUTH` 4 + `PRIV` 4 + `R02.PROVIDER-TOKEN` 9 = 21**

| Test ID | What the test would prove | Why it could not be executed | Affects intended limited release? | Security boundary? | Can owner reasonably accept for this limited release? | Must be completed before expanding scope? |
|---|---|---|---|---|---|---|
| `R094.BROWSER.SERVER-REVALIDATION` | Browser session → real HTTPS → real PostgREST → real JWT (`request.jwt.claim.sub`/`role` + `SET LOCAL ROLE authenticated`) → real `reconcile_offline_queue_item` RLS/SECURITY DEFINER (manager-tier `42501`) from a real browser. Proves the *browser* layer, not just `pg`. | No disposable Supabase harness for browser traffic in this sandbox: no Docker, embedded-postgres process-local not network-addressable, stub only models HTTP shape (P5-F investigation 2026-09-23). | **No** for current till/offline/quota DB authority — P6 `R093.RECON.*` 9 PASS already proves DB authority via real disposable PG as `authenticated` + separate clients; browser client-path proven via `R094.BROWSER.RECONCILE-CLIENTPATH` etc. via stub. | **Yes** — browser→JWT→RLS is a security path, but the *DB* path is the authoritative security check; browser is the integration surface. | **Yes** — owner can accept `B` and rely on P6 DB authority + stub client-path for this limited release, with explicit acknowledgement that “browser→JWT→RLS” is not independently proven in this environment. | **Yes** — before claiming “browser→JWT→RLS proven” or expanding to browser-dependent compliance. |
| `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` | Investigation outcome that a wire-reachable REAL backend cannot be provided. | Same — Phase-B probing confirmed no acceptable official backend stack (no Docker). | No | No — meta-evidence | Yes | No — informational |
| `TENANT.A.storage` | `storage.objects` RLS + path isolation + signed URL for Tenant A (object read/write/path/signed-URL) | No real Supabase Storage (S3/MinIO) + `storage.buckets`/`storage.objects` RLS not provisioned; migration-only `authenticated` lacks `business_users` UPDATE so own-logo positive control denied in fixture. | **No** for POS/offline/journal (DB RLS proven separately via P6 two-business). | **Yes** — storage is a tenant boundary, but not exercised by current till/offline/quota contract. | **Yes** — if Storage-dependent capabilities are excluded from certified scope (see §3). | **Yes** — before certifying Storage-dependent features. |
| `TENANT.B.storage` | Same for Tenant B | Same | Same | Same | Same | Same |
| `AUTH.expired-session` | GoTrue `auth.users` + `amr`/`aud` JWT expiry → `getUser`/`getSession` revocation | No isolated Supabase Auth service (GoTrue) configured; only `pg` `request.jwt.claim.sub` mock-JWT; mock `getUser` is not expiry evidence. | No — tenant/branch/POS proven via `pg` mock-JWT + RLS, not GoTrue. | No — provider integration, not `post_pos_sale` RLS bypass. | Yes — provider integration deferred. | Yes — before provider-auth-dependent scope. |
| `AUTH.invalid-login` | GoTrue invalid login | Same | Same | Same | Yes | Same |
| `AUTH.logout-revocation` | GoTrue logout revocation | Same | Same | Yes (token replay) but still provider-token surface | Yes | Same |
| `AUTH.valid-login` | GoTrue valid login | Same | Same | Same | Yes | Same |
| `PRIV.INVITATION` | Real `invite-team-member` → `accept-invite-link` lifecycle + profile-phone fallback with Auth Admin + delivery | No isolated Auth Admin + phone verification + delivery (Edge functions). | No — R01 `ROLE.*write` + `TENANT.*` RLS proven for invitation privilege via `is_business_member`/`can_admin_business_data`; lifecycle is provider integration. | Yes — invitation is privilege boundary, but RLS part is PASS; delivery part is provider. | Yes | Yes — before certifying invitation delivery. |
| `PRIV.MEMBERSHIP` | Effective `business_users` UPDATE grant (migration-only ACL lacks `business_users` UPDATE) | Migration-only `authenticated` lacks granular `business_users` UPDATE; deployed column grants differ; no effective grant in fixture. | No — not exercised by POS/offline. | No — ACL artefact. | Yes | Yes — before membership UPDATE scope. |
| `PRIV.PROFILE` | Benign `profiles` UPDATE | Same — migration-only lacks benign profile UPDATE | No | No | Yes | Same |
| `PRIV.RECOVERY` | Global recovery authority + verified phone proof via Auth Admin | Needs Auth Admin + verified phone proof | No for current recovery (DEC-02 single-owner, no SMS/OTP per P4) | Yes — recovery authority is security, but current product has no SMS/OTP and single-owner model per DEC-02 (see `R02.DEC-02`). | Yes | Yes — before phone-based recovery. |
| `R02.PROVIDER-TOKEN.consumed` | Recovery token consumed | No isolated Supabase Auth recovery service/delivery + stateful Edge admin | No — recovery via OTP not built | Yes — provider token replay is security, but OTP not in current contract (P4 accepted no SMS). | Yes | Same |
| `R02.PROVIDER-TOKEN.expired` | Token expired | Same | Same | Same | Yes | Same |
| `R02.PROVIDER-TOKEN.identity-changed-after-issuance` | Token identity-changed after issuance | Same | Same | Same | Yes | Same |
| `R02.PROVIDER-TOKEN.invalid` | Token invalid | Same | Same | Same | Yes | Same |
| `R02.PROVIDER-TOKEN.malformed` | Token malformed | Same | Same | Same | Yes | Same |
| `R02.PROVIDER-TOKEN.missing` | Token missing | Same | Same | Same | Yes | Same |
| `R02.PROVIDER-TOKEN.replay` | Token replay | Same | Same | Yes — token replay is security, but via provider surface | Yes | Same |
| `R02.PROVIDER-TOKEN.substituted` | Token substituted | Same | Same | Same | Yes | Same |
| `R02.PROVIDER-TOKEN.valid-own-identity` | Token valid own identity | Same | Same | Same | Yes | Same |

The owner must understand exactly what remains unverified. Do not label the 21 as harmless — they are **genuine infrastructure gaps**, but they are **not security-critical for the defined limited scope** (till/POS/offline/quota DB authority) per §10.

---

## §8 Class C — 15 Accepted Limitations

Review each: capability limited / current contract / affects normal use / security / financial integrity / acceptable for proposed scope / must be revisited.

| Test ID | Capability limited | Current contract | Affects normal intended use? | Affects security? | Affects financial integrity? | Acceptable for proposed limited release? | Must be revisited later? |
|---|---|---|---|---|---|---|---|
| `BRANCH.customers` | Customer (`contacts`) branch isolation | `contacts` RLS org-wide `can_write_business_data`/`is_business_member` (20260728000008); no branch predicate — `contacts.branch_id` out-of-scope per R08.7 and P6 | No — customers are intentionally org-wide in current product | No — P6 shows no path from R06/R093 to customer leakage | No — journal/stock tenant isolation unaffected | **Yes** — owner accepted per R08.7 | Yes, if branch-scoped customers ever required (future package D) |
| `BRANCH.financial` | Financial (`journal_entries`/`journal_lines`) branch dimension | Org-wide RLS (tier-based write, member read); no branch dimension — intentional; POS shift report is branch-enforced (`get_pos_shift_report` `42501` proven) | No — financial is intentionally org-wide; POS report is the branch-certified question | No — financial is org-wide by design | No — journal invariants proven | Yes | Yes, if branch-scoped financial ever required |
| `BRANCH.inventory` | Inventory (`stock_movements`/`inventory_balances`) branch isolation | `inventory_locations` `branch_id` but `stock_movements` org-wide `can_write_business_data`/`is_business_member`; R08.7 escape path | Stocks: normal POS via `can_operate_pos` + `23514` is branch-aware (till), but raw inventory RLS is org-wide | No — POS branch is proven; raw inventory is not a POS security boundary | No — stock `23514` invariant is PASS | Yes per R08.7 scope (till family only) | Yes, if branch-scoped inventory required (package outside R08.7) |
| `BRANCH.read` | App-wide read branch isolation | Core tables org-wide `is_business_member` SELECT per 20260728000008; till family `can_access_branch` only (proven via `R08.SHIFT.BRANCH-SCOPED-READ` + P7 matrix) | Reads: A1-assigned user still reads A2 core data server-side — but product contract is org-wide read for core tables | No — till family is sealed; core read org-wide is intentional | No | Yes — R08.7 do-not-expand; NULL-row reshape out-of-scope | Yes, only if app-wide read is to be sealed (needs reshape + signed NULL-row contract) |
| `BRANCH.reports` | General reports branch scope | POS shift report `42501` proven (`R08.REFUND.SCOPE-ATTACK` etc.); other reports org-wide (no branch dimension) | No — POS report is the only branch-certified report | No — general reports intentionally org-wide | No | Yes | Yes, if general reports become branch-scoped |
| `OFFLINE.ACTOR-BINDING` | Queue actor binding (durable originating-user/device) | No durable `originUserId`/`originDeviceId` contract for generic `businessId` queue; P5-A provenance (`originUserId`/`originDeviceId`/`originTerminalId` + `sweepUnverifiableItems`) is current contract | No — provenance-based actor binding is the contract; generic queue update is not | No — `R09.QUEUE.ACTOR-BINDING.*` + `R093` proven | No | Yes — current provenance is contract | Yes, only if generic queue update contract is defined |
| `OFFLINE.BROWSER` | Browser SW as process shutdown/cache proof | Fake IndexedDB close/reopen is not browser process shutdown; P5-F `R094.BROWSER.SW.*` 8 PASS with fake adapters is current; real browser is `R094` `B` | No — offline financial integrity proven via disposable DB + fake adapters | No | No | Yes | Real browser deferred to `R094` infrastructure |
| `OFFLINE.CONFLICT` | Generic conflict resolution | No approved conflict-resolution contract or generic queue update; P4 Q8 C + Q10 B define typed `branch-denied`/`stale-version`/`payload-tampered` as `failed`/`quarantined`, not generic merge | No — typed exceptions are contract | No | No | Yes | Only if generic merge contract defined |
| `OFFLINE.MULTITAB` | Cross-tab concurrency via browser workers | Needs approved client-identity + workers; lease `R093.LEASE-EXCLUSIVE` + `MATRIX` proven; generic workers are R11 future | No — lease/provenance proven | No | No | Yes | Workers are future R11 |
| `R06.POS.STOCK.CONCURRENT` | Concurrent `post_pos_sale` `FOR UPDATE` stock | `trg_stock_movement_apply_balance` `FOR UPDATE` is contract; harness exposes 1 `pg` client per disposable DB; second authenticated client not wired | No — sequential `ATOMIC`/`CONCURRENT` `23514` single-client proven; concurrent `FOR UPDATE` is honest harness limitation | No — stock `23514` invariant is PASS; concurrency is not a stock-security bypass | No | Yes — honest limitation; future 2-client harness if owner wants concurrent proof |
| `AI.BRANCH` | AI branch filter (optional) | Durable branch assignment and field-permission contract requires design approval per P4 Q14/Q15 B after P8; `ai_context(business_id, branch_id?)` with `can_access_branch` read-only non-authoritative is design | No — AI is read-only, non-authoritative, after P8 | No | No | Yes — after `BRANCH.*`/`P8` per Q15 | After P8, see Future Package F |
| `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` | DEC-02 single-owner phone recovery | DEC-02 single-owner model per owner clarification: phone identifies user; recovery legitimate; no SMS/OTP built per P4 | No — current product has no SMS/OTP; single-owner recovery is legitimate per DEC-02 | No | No | Yes — per P4 accepted | No |
| `R02.RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` | OTP future-valid | Ledgr has no SMS/OTP phone-possession mechanism and none was built at this stage per P4 | No — OTP not in product | No | No | Yes — per P4 | No |
| `R02.RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED` | OTP substituted-target | Same — no OTP | Same | Same | Same | Yes | No |
| `R02.RECOVERY.OTP.WRONG-DENIED` | OTP wrong | Same — no OTP | Same | Same | Same | Yes | No |

Do not describe a limitation as a defect unless P8 classified it that way — none of the above are `A`/`E`.

---

## §9 Class D — 4 Owner Decisions

These four require explicit treatment. Do **not** fix. Do **not** assume presence of a function means capability is release-approved.

### D1 — BRANCH.create

**What currently works:** `post_pos_sale` blocks cross-branch posting at the server for the **till family** (`post_pos_sale` `can_access_branch` → `42501` proven by `R08.SALE.*` / `R08.BRANCH.SERVER-SCOPE` + P7 `742/0`). An assigned `A1` user cannot `can_operate_pos` at `A2` for POS.

**What is not fully evidenced:** Raw `invoices_writer_insert` (`can_write_sales_data` org-wide) + `20260728000008` writer loops allow an `A1`-assigned caller to `INSERT` a document whose `branch_id` targets `A2` via direct `supabase.from('invoices').insert` (not via `post_pos_sale`). The R08.7 audit at `BRANCH.create` documents this as an **ESCAPE PATH**.

**Roles affected:** Assigned-scope (`cashier`/`stock_clerk`/`sales_clerk` with `can_write_sales_data`, `can_write_business_data`) that are `branch_id = A1` can still INSERT branch `A2` via raw writer path; org-wide roles (`owner`/`admin`/`auditor`) legitimately org-wide per DEC-03.

**Normal owner/admin operation:** **Supported** — owner/admin (`can_write_sales_data` org-wide, `NULL` branch) are legitimately org-wide and can create in any branch.

**Matters to proposed limited release?** **No** for the certified scope (POS via `post_pos_sale` is sealed; the escape is the *raw writer* direct-API path, not the POS till). The proposed scope certifies **POS/till via `post_pos_sale`**, not all-branch raw `invoices` writer.

---

### D2 — BRANCH.cross-branch-admin

**Evidence:**

- `can_write_sales_data` (cashier/stock_clerk/sales_clerk tier) vs `can_write_business_data` (broader tier) vs `can_access_branch` (branch predicate) vs `can_admin_business_data` (owner/admin only, org-wide per DEC-03).

**Review:**

- **Org-wide roles:** `owner`/`admin`/`auditor`/`accountant` — `branch_id IS NULL` legitimately org-wide per DEC-03; they have `can_admin_business_data` (pos_terminals admin) and `can_write_sales_data` org-wide.
- **Assigned-scope roles:** `cashier` `A1`, `branch_manager` `A2`, `stock_clerk` `A1` — fail-closed (`can_access_branch` false) for `can_access_branch`, but writer tiers are org-wide predicates.
- `POS terminal admin` is **sealed**: `pos_terminals` write/update + hard `DELETE` require `can_admin_business_data` (owner/admin), so assigned-scope roles have **zero terminal admin in any branch** (proven).
- `Branches/departments/inventory_locations` writer policies are the **broad `can_write_business_data` tier** (`cashier`/`stock_clerk`/`sales_clerk` included), letting an `A1`-assigned user **create/rename another branch** — cross-branch administration is **NOT sealed app-wide**.

**Deferred capability:** Cross-branch administrative capability for branches/departments/inventory_locations via the broad writer tier.

**Do not assume** pos_terminals sealed means app-wide branch admin sealed — the family is not proven (one sealed + one open ⇒ stays `BLOCKED` with this citation).

---

### D3 — BRANCH.modify

**What is currently permitted:**

- **Branch assignment changes:** `business_users.branch_id` assignment is via `can_admin_business_data` (owner/admin) — P5-D DEC-03 ensures assigned-scope `NULL` fail-closed, but the *assignment* operation itself is admin-only.
- **Branch metadata changes:** `branches`/`departments` UPDATE via `can_write_business_data` org-wide — an `A1` user can UPDATE `A2` branch metadata server-side (same escape as `create`).
- **Cross-branch administrative changes:** As in D2, an `A1` user can create/rename `A2` branch via `can_write_business_data`.

**In/out of proposed scope:**

- **In:** Till `pos_shifts` assignment is branch-enforced (sealed).
- **Out:** General branch metadata cross-branch admin is **outside** the proposed limited release scope (the scope certifies till/POS via `post_pos_sale`, not all-branch admin). The three `BRANCH.*` D items are therefore **deferred**, not certified, for this release.

---

### D4 — BILLING.SERVER-QUOTA

**Review P5-C and P8 — distinguish:**

- **Tested authoritative server quota enforcement:** `P0QLT` `20261001000000` uniform on `post_pos_sale` / `save_quick_sale` / `save_quick_expense` / `execute_pending_payroll_run` + `BEFORE INSERT` + `ledgr_monthly_document_count` vs `head:true` divergence fixed, `FOR UPDATE` race considered, `isQuotaDenial` (`QUOTA_DENIAL_SQLSTATE`), `queueApi` capture-time + authoritative per Q13 — **PROVEN** via `R10.QUOTA.SERVER-*` / `CLIENT-PRECHECK` / `CLIENT-CLASSIFIES` 5 PASS (P5-C, P7, P8).
- **Billing entitlement:** `plan_tier` → `50` free limit + `usageService` + `ledgr_monthly_document_count` security-definer — proven as counting/entitlement, not as commercial subscription state.
- **Subscription state:** `businesses.subscription_status` / `Stripe` / `billing/page.tsx` copy — **not** in P5-C scope; no `STRIPE` tests are `BLOCKED` `B` environment (no Stripe secrets).
- **Canonical billing command/approval:** The *generic* command that would create any billable document outside POS/quick (direct `supabase.from('invoices').insert`, `expenses`, `payroll`, `bills` via generic builder) — **not yet approved or implemented** (`BILLING.SERVER-QUOTA` actual: “Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented.”).
- **Payment/recovery lifecycle:** Stripe payment, recovery, subscription state transitions — **not** in P5-C; `BILLING.SERVER-QUOTA` is not about Stripe.
- **Quota enforcement itself:** **Yes** — `P0QLT` with `detail`/`hint` and `QUOTA_DENIAL_SQLSTATE`, distinct from `P0001`/`42501`/`23514` — proven.

**Intended release is:**

- **PILOT / INVITED USERS** — if the current `P0QLT` for POS/quick + uniform `BEFORE INSERT` is sufficient, and the generic canonical command is not required for the invited-user cohort (owner can invite users, POS/quota is enforced, subscription is manually managed).
- **FULL COMMERCIAL SUBSCRIPTION RELEASE** — if self-serve payment, Stripe, and the generic canonical billing command are required — **not** supported by current evidence (needs `BILLING.SERVER-QUOTA` package).

**Do not make that choice for the owner** — §12 Q5 and §16 Future Package E record the distinction; owner must explicitly choose.

---

## §10 Security Decision

| Security area | Evidence status | Release impact |
|---|---|---|
| Tenant isolation | **PASS** — P6 two-business `authenticated` + separate `pg` clients, `relrowsecurity true` + `is_business_member` on 6 tenant tables, SECURITY DEFINER `post_pos_sale`/`reconcile_offline_queue_item` with `auth.uid()` + `is_business_member` + `can_access_branch`; P6 `C` harness discharged, P7 `742/0` re-proven | **None** — certified for limited scope |
| Branch authorization | **PASS within tested contract** — P5-D `can_access_branch` fail-closed DEC-03, till family `pos_shifts`/`pos_cash_movements` `can_access_branch` proven (P7 matrix `U805 false,false`, `R08.SHIFT.BRANCH-SCOPED-READ`, `R08.SHIFT.*` 22 PASS); core tables org-wide intentional per R08.7 (see D1–D3) | **None for till/POS**; app-wide admin deferred (`D` 3) — not in limited scope |
| POS authorization | **PASS** — `can_operate_pos` `42501`, `can_access_branch`, product tenant `22023`, `R06` `23514`, R08 till/POS | **None** |
| Offline server authorization | **PASS** — `reconcile_offline_queue_item` SECURITY DEFINER manager-tier `42501`, identity-mismatch `22023`, `isReconcilable` frozen `stock-denied|policy-denied` per Q3/Q11, P6 `R093.RECON.*` 9 PASS | **None** — DB authority proven; browser revalidation `B` not required for DB authority |
| AI branch authorization | **PASS within tested contract** — P5-E `ai_context(business_id, branch_id?)` optional `can_access_branch` check, read-only, non-authoritative, after P8 per Q14/Q15 | **None** |
| Invitation authorization | **PASS** — `ROLE.*write` + `TENANT.*` 7 PASS `owner`/`admin` write via `is_business_member`/`can_admin_business_data`; lifecycle delivery is provider integration (`PRIV.INVITATION` `B`) | **None for RLS**; provider delivery deferred |
| Phone recovery containment | **PASS** — R02 `DEC-02` single-owner model, `R02.RECOVERY.OTP` `C` (no SMS/OTP per P4, legitimate recovery per DEC-02) | **None** |
| Storage isolation | **BLOCKED** `B` 2 — `storage.objects` RLS + path not provisioned; DB RLS `is_business_member` proven separately | **Not in limited scope** — exclude Storage claims; `B` environment |
| Browser/server revalidation | **BLOCKED** `B` 2 — `R094` needs wire-reachable PostgREST/GoTrue/JWT | **Not in limited scope** — DB authority `PASS` via P6, browser client-path `PASS` via stub; real browser deferred |
| Provider authentication | **BLOCKED** `B` 21 — `AUTH.*`/`R02.PROVIDER-TOKEN.*`/`PRIV.*` need isolated GoTrue | **Not in limited scope** — tenant membership proven via `pg` mock-JWT + RLS, not GoTrue; provider integration deferred |

Do not turn this into a ranking — it exposes exactly what is known and unknown.

---

## §11 Financial-Integrity Decision

| Property | Evidence | Status |
|---|---|---|
| Journal invariants | R05 `journal_entries/journal_lines` `check` + trigger `trg_stock_movement_apply_balance` + R08 `ZREPORT.RECONCILES-TENDERS` + `CLOSE-IMMUTABLE` | **PASS** |
| Stock balance authority | R06 `trg_stock_movement_apply_balance` `FOR UPDATE` + `23514` + `R06.POS.STOCK.*` 9 PASS + `REPLAY`/`ATOMIC` + P6 zero-mutation | **PASS** |
| Negative stock | R06 `23514` `quantity_on_hand < 0` triggers, `INSUFFICIENT` `23514`, `TAMPER` 0 mutation | **PASS** |
| POS correction/refund/void | R07 `POS correction/refund/void` + R08 `REFUND.*`/`LATE-ARRIVAL`/`RECONCILES-TENDERS` | **PASS** |
| Till/shift integrity | R08 `SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE` `22023`/`BYPASS-CLOSED` 0-rows/`REPORT-AUTHORITY`/`SINGLE-OPEN` | **PASS** |
| Offline reconciliation | P5-B `reconcile_offline_queue_item` + P6 `R093.RECON.*` 9 PASS + `R093.EXCEPTION.*` + TAMPER 0 mutation + P7 `742/0` | **PASS** |
| Quota enforcement | P5-C `P0QLT` uniform `20261001000000` + `R10.QUOTA.*` 5 PASS + `isQuotaDenial` + `queueApi` capture-time + authoritative (Q13) | **PASS within tested contract** (POS/quick + uniform `BEFORE INSERT`) |
| Cross-tenant financial isolation | P6 two-business zero mutation (invoices/stock/journals/audit 0), `R093.RECON.CROSS-BUSINESS` `42501` manager-tier, P7 `TENANT.*` 10 PASS | **PASS** |

The P8 evidence says there are currently **0 financial-integrity blockers** — **verified** against source documents above; no test being `BLOCKED` is treated as proof of failure, and no unrelated test is treated as proof of a missing property (per P8 §6).

---

## §12 Release Options

Do **not** call one the “best” option.

### OPTION A — LIMITED CONTROLLED RELEASE

**Included (Release-certified per §4/§6):**
Tenant isolation (two-business `authenticated`), POS/till via `post_pos_sale` + branch `can_access_branch` fail-closed, inventory/stock `23514` + `FOR UPDATE`, branches till family, sales/payments, customers/suppliers org-wide, financial reporting org-wide except POS shift report branch-enforced, POS corrections/refunds/voids, till/shift integrity, offline queue/reconciliation within `RECONCILABLE` `stock-denied|policy-denied` contract (Q3/Q11), billing/quota `P0QLT` within tested POS/quick + uniform `BEFORE INSERT` contract (Q12/Q13), AI `ai_context` optional branch filter read-only.

**Excluded (Deferred, not certified, not removed from code):**
Unverified provider-specific Auth flows (`AUTH`/`R02.PROVIDER-TOKEN`), Storage-dependent capabilities (`TENANT.storage`), browser/server revalidation claim (`R094`), deferred cross-branch administration (`BRANCH.create`/`modify`/`cross-branch-admin`), full commercial billing lifecycle (`BILLING.SERVER-QUOTA`), branch-scoped customers/financial/inventory/reports beyond till family (R08.7 `C`), generic offline conflict/multitab workers, legacy fixed-bootstrap suites, `AI.BRANCH` deferred until after P8 (but now after P8, still `C` until implemented).

This is the **evidence-derived** exclusions — not an example.

---

### OPTION B — CONDITIONAL RELEASE

**Included functionality:** Same as Option A (limited scope).

**Explicit accepted limitations:** All 15 `C` — `BRANCH` 5 (customers/financial/inventory/read/reports org-wide intentional), `OFFLINE` 4 (actor/browser/conflict/multitab no contract), `R06.CONCURRENT` 1 (honest harness), `AI.BRANCH` 1 (deferred), `R02.DEC-02`/`OTP` 4 (no SMS/OTP per P4) — see §8.

**Explicit deferred packages:** `D` 4 — `BRANCH.create`/`cross-branch-admin`/`modify` (branch writer reshape) and `BILLING.SERVER-QUOTA` (canonical billing command) — plus `B` infrastructure: `R094` real backend (2), `TENANT.storage` (2), `AUTH`/`PRIV`/`R02` provider Auth (17).

**Infrastructure evidence still outstanding:** `B` 21 — real PostgREST/GoTrue/JWT (`R094` 2 + `AUTH`/`PRIV`/`R02` 17) + real Storage (2) — see §7.

**Conditions before expanding scope:** Owner must explicitly accept `B`/`C`/`D` per §13 Q2–Q8; provision of real Storage/PostgREST/GoTrue + `BRANCH` writer reshape + `BILLING` canonical command is **deferred**, not passed, and must be completed before claiming `Storage`/`browser→JWT→RLS`/`provider Auth`/`all-branch admin`/`full commercial billing` as certified.

Do not imply that deferred evidence has already passed.

---

### OPTION C — HOLD RELEASE

**Specific evidence that must be obtained before any release (only concrete outstanding evidence/owner decisions, not “fix everything”):**

- `R094.BROWSER.SERVER-REVALIDATION` (2) `B` CRITICAL — wire-reachable REAL backend (Docker Supabase + GoTrue + PostgREST + JWT) and browser test (`browser → real HTTPS → real PostgREST → real JWT → real RLS`) — or owner explicit acceptance that DB authority via P6 is sufficient.
- `TENANT.*.storage` (2) `B` HIGH — real Supabase Storage + `storage.objects` RLS + effective `business_users` grants + signed URL — or owner explicit acceptance to exclude Storage claims.
- `BILLING.SERVER-QUOTA` `D` HIGH — canonical command/approval/entitlement contract per Q12/Q13 (owner decision) + `P0QLT` + concurrency + idempotency for that command.
- `BRANCH.create`/`modify`/`cross-branch-admin` (3) `D` HIGH — policy reshape (`can_access_branch` predicate on writer policies) + direct-API call-site audit.
- `AUTH`/`PRIV`/`R02.PROVIDER-TOKEN` (17) `B` — isolated Auth service + `auth.users` + recovery delivery (if provider Auth is in scope).

Do not say “fix everything” — only the above concrete outstanding evidence or owner decisions.

---

## §13 Owner Decision Questions

Prepare explicit YES/NO decisions for the owner. Do **not** select on behalf of owner.

### Q1 — Scope

**Do you approve the proposed release scope as defined in §6 (limited scope: till/POS + financial recording + inventory/stock + branch till family + offline `RECONCILABLE` + billing/quota POS/quick + AI read-only + tenant isolation, with exclusions as listed)?**

- [ ] **YES** — Approved as defined
- [ ] **NO** — Requires modification (specify below)

_Owner response: _______________________________________________________

---

### Q2 — Environment evidence

**Do you accept the 21 environment-blocked items (`R094` 2 + `TENANT.storage` 2 + `AUTH` 4 + `PRIV` 4 + `R02.PROVIDER-TOKEN` 9) as evidence limitations for the proposed limited scope (infrastructure-deferred, relying on P6 DB authority + RLS mock-JWT)?**

- [ ] **YES** — Accepted, remain `B` deferred
- [ ] **NO** — Require real PostgREST/GoTrue/Storage before release

_Owner response: _______________________________________________________

---

### Q3 — Accepted limitations

**Do you accept the 15 P8 Class-C limitations (`BRANCH` 5 org-wide intentional + `OFFLINE` 4 no contract + `R06.CONCURRENT` honest harness + `AI.BRANCH` + `R02.DEC-02`/`OTP` 4 no SMS/OTP) for the proposed limited scope?**

- [ ] **YES** — Accepted as current contract
- [ ] **NO** — Require package before release

_Owner response: _______________________________________________________

---

### Q4 — Branch administration

**Do you accept the three deferred branch-management items `BRANCH.create` / `BRANCH.cross-branch-admin` / `BRANCH.modify` (writer `can_write_*` org-wide escape path) as outside the current release scope (till via `post_pos_sale` is certified; all-branch admin deferred)?**

- [ ] **YES** — Accepted, outside current scope (deferred package D after release)
- [ ] **NO** — Require branch writer reshape before release

_Owner response: _______________________________________________________

---

### Q5 — Billing

**Do you accept the current P5-C/P8 billing/quota boundary (POS/quick `P0QLT` uniform + dual authority proven, generic canonical billing command deferred as `BILLING.SERVER-QUOTA` `D`) and defer the full commercial billing/subscription lifecycle decision?**

- [ ] **YES** — Accepted, current quota scope retained; commercial lifecycle deferred (pilot/invited users)
- [ ] **NO** — Require canonical billing command package before release (full commercial subscription)

_Owner response: _______________________________________________________

_If YES, intended release is: [ ] **PILOT / INVITED USERS** / [ ] **FULL COMMERCIAL SUBSCRIPTION RELEASE** (choose one — do not make choice for owner)_

---

### Q6 — Storage

**Do you accept that Storage isolation (`TENANT.A/B.storage` 2× `B` HIGH) remains unverified until genuine Storage infrastructure evidence is available (relying on DB RLS isolation proven via P6)?**

- [ ] **YES** — Accepted, Storage claims excluded/deferred
- [ ] **NO** — Require real Storage verification before release

_Owner response: _______________________________________________________

---

### Q7 — Provider authentication

**Do you accept that provider-specific AUTH (`AUTH.*` 4) / PRIV (4) / R02 provider-token (9) evidence remains environment-blocked (`B` 21) and provider-specific claims are excluded/deferred for this limited release (tenant membership proven via `pg` mock-JWT + RLS instead)?**

- [ ] **YES** — Accepted, provider-specific claims deferred
- [ ] **NO** — Require GoTrue/provider verification before release

_Owner response: _______________________________________________________

---

### Q8 — Browser/server revalidation

**Do you accept the two `R094.BROWSER.SERVER-REVALIDATION` tests (2× `B` CRITICAL) as deferred infrastructure evidence (relying on P6 DB authority `R093.RECON.*` 9 PASS + stub client-path `R094` 4 PASS instead of browser→JWT→RLS)?**

- [ ] **YES** — Accepted, deferred
- [ ] **NO** — Require real backend verification before release

_Owner response: _______________________________________________________

---

### Q9 — Release decision

**Choose exactly one (do not select on behalf of owner):**

- [ ] **GO — for the defined limited scope** (§3/§6) — all `B`/`C`/`D` accepted as deferred per Q2–Q8
- [ ] **CONDITIONAL GO — subject to stated conditions** (specify: _________________________________________)
- [ ] **NO-GO — evidence/decisions insufficient** (specify blocker: ________________________________________)

_Owner signature: _________________________________ Date: _______________

_Do not select the answer on behalf of the owner. Leave fields clearly marked for explicit completion._

---

## §14 Consequence Matrix

| Decision | If ACCEPTED | If NOT ACCEPTED |
|---|---|---|
| Environment blockers (`B` 21: `R094` 2 + `TENANT.storage` 2 + `AUTH`/`PRIV`/`R02` 17) | Remain `B` deferred; release relies on P6 DB authority + `pg` mock-JWT + stub client-path; provider/Storage/browser claims excluded from certified scope | Real infrastructure evidence required: Docker Supabase + GoTrue (`auth.users`) + PostgREST + `request.jwt.claim.sub`/`role` + Storage (`storage.objects`) + wire-reachable browser → JWT → RLS |
| Storage (`B` 2) | Storage claims excluded/deferred; DB RLS isolation is proven and relied upon | Real Storage verification required: `storage.buckets`/`storage.objects` RLS + path + signed URL + effective `business_users` grants |
| Provider auth (`B` 21) | Provider-specific claims (`valid-login`/`expired-session`/`PROVIDER-TOKEN.*`) excluded/deferred; tenant membership via `is_business_member` + RLS is proven | GoTrue/provider verification required: isolated Auth service + `auth.users` + recovery delivery + `supabase.auth.signIn`/`recover` |
| Branch admin (`D` 3: `create`/`cross-branch-admin`/`modify`) | Admin scope limited to till family via `post_pos_sale` + `can_access_branch`; app-wide writer org-wide remains, but outside certified scope | Branch authorization package required: reshape writer policies to `can_access_branch` predicate + audit `supabase.from('invoices').insert` direct-API call sites (package after P8 per Q15) |
| Billing (`D` 1: `BILLING.SERVER-QUOTA`) | Current quota scope retained (`P0QLT` for POS/quick + uniform `BEFORE INSERT` per Q12/Q13); full commercial lifecycle (Stripe, subscription, canonical command) deferred → pilot/invited users | Billing package required: owner approves canonical command/approval/entitlement per Q12/Q13 + `P0QLT` + concurrency + idempotency for that command + Stripe/subscription |
| Browser revalidation (`B` 2) | Browser/server claim remains unverified; `R094` client-path + P6 DB authority is relied upon | Real backend verification required: `browser → real HTTPS → real PostgREST → real JWT → real RLS/SECURITY DEFINER` |

Keep consequences factual — not a ranking.

---

## §15 Do Not Confuse Release Scope with Product Scope

A capability can be `Implemented` (exists in code, works in development, partially tested) vs `Release-certified` (proven by P5–P8 evidence for the defined limited scope) vs `Deferred` (exists but not certified for this release). Do **not** remove functionality merely because its evidence is incomplete; explicitly state its status.

| Capability | Implemented? | Release-certified (for proposed limited scope)? | Deferred? |
|---|---|---|---|
| POS/till, financial recording, inventory/stock, sales/payments, customers org-wide, financial org-wide + POS report branch, corrections/refunds, till/shift, offline `RECONCILABLE`, billing/quota POS/quick, AI read-only, tenant isolation via RLS | **Yes** — in code, works | **Yes** — per §4/§6 (742/0 + 807 unit + typed) | No |
| App-wide branch admin (create/modify/cross-branch-admin), branch-scoped customers/financial/inventory/reports beyond till, Storage, provider Auth, browser→JWT→RLS, generic billing command, generic offline conflict/multitab, legacy bootstrap | **Yes** — in code, works in dev | **No** — not certified for this limited scope (see §5) | **Yes** — deferred to future packages (see §16) |

---

## §16 Future Packages

Do **not** implement future work. Forward-looking package register only — for each: reason / affected capability / evidence needed / whether implementation may eventually be required. Do **not** assign arbitrary dates or promise completion.

### Future Package A — Storage Verification

- **Reason:** `TENANT.A/B.storage` `B` — genuine Storage infrastructure gap; DB RLS does not prove `storage.objects` RLS.
- **Affected capability:** Tenant storage isolation (read/write/path/signed URL).
- **Evidence needed:** Real Supabase Storage (S3/MinIO) + `storage.buckets`/`storage.objects` RLS + `authenticated` effective `business_users` grants + signed URL test with two-business `authenticated` identities + path isolation.
- **Implementation may eventually be required:** **Yes** — before certifying Storage-dependent features.

### Future Package B — Real PostgREST/GoTrue Browser/Server Revalidation

- **Reason:** `R094.BROWSER.SERVER-REVALIDATION` 2× `B` CRITICAL — P5-F investigation: no acceptable official backend stack for browser traffic.
- **Affected capability:** Browser `→` HTTPS `→` PostgREST `→` JWT `→` RLS/SECURITY DEFINER (reconciliation).
- **Evidence needed:** Docker Supabase + GoTrue + PostgREST + `request.jwt.claim.sub`/`role` + `SET LOCAL ROLE authenticated` + real browser test `browser → real JWT → real RLS` (manager-tier `42501`, identity-mismatch `22023`).
- **Implementation may eventually be required:** **Yes** — before claiming browser→JWT→RLS proven.

### Future Package C — Provider Authentication Verification

- **Reason:** `AUTH.*` 4 + `PRIV.*` 4 + `R02.PROVIDER-TOKEN.*` 9 = 17 `B` — no isolated Supabase Auth service.
- **Affected capability:** GoTrue `valid-login`/`expired-session`/`logout-revocation`, recovery token `consumed`/`expired`/`replay`/`substituted`, invitation lifecycle + phone fallback.
- **Evidence needed:** Isolated Auth service (`auth.users` + `recovery` delivery + phone/SMS where applicable) + `supabase.auth.signIn`/`recover`/`invite` Edge functions with real `Auth Admin`.
- **Implementation may eventually be required:** **Yes** — before provider-auth-dependent scope; currently provider integration is `B` deferred, tenant membership proven via `pg` mock-JWT.

### Future Package D — Branch Administration Authorization Decision/Remediation

- **Reason:** `BRANCH.create`/`modify`/`cross-branch-admin` 3× `D` — writer `can_write_sales_data`/`can_write_business_data` org-wide allows A1-assigned `INSERT`/`UPDATE` `branch_id=A2` via raw writer path (R08.7 audit escape); `pos_terminals` is sealed (`can_admin_business_data`) but branches are not.
- **Affected capability:** App-wide branch create/modify/cross-branch admin (branches/departments/inventory_locations).
- **Evidence needed:** Owner decision per Q14/Q15 + policy reshape (add `can_access_branch` predicate to writer policies) + audit of `supabase.from('invoices').insert` / `branches` direct-API call sites + re-proof via disposable DB as `authenticated` assigned-scope (negative `42501`).
- **Implementation may eventually be required:** **Yes** — before certifying app-wide branch admin (currently outside limited scope; till via `post_pos_sale` is certified).

### Future Package E — Canonical Commercial Billing/Entitlement Lifecycle

- **Reason:** `BILLING.SERVER-QUOTA` `D` — P5-C proves `P0QLT` for POS/quick + uniform `BEFORE INSERT`, but generic canonical billing command (any billable document outside POS/quick via builder/direct `insert`) lacks approved command/approval/entitlement contract per Q12/Q13.
- **Affected capability:** Full commercial subscription release (Stripe, subscription state, `businesses.subscription_status`, generic `invoices`/`expenses`/`payroll`/`bills` metering, concurrency + idempotency for generic command, `ledgr_monthly_document_count` vs `head:true` alignment).
- **Evidence needed:** Owner approval of canonical command/approval/entitlement (Q12 B + Q13 C) + `_ledgr_assert_usage_limit` on generic paths + concurrency (`FOR UPDATE`) + client-key idempotency + `REGRESSION.SUCCESS-CLIENTKEY` for generic command + `head:true` vs `ledgr_monthly_document_count` verification.
- **Implementation may eventually be required:** **Yes** — before full commercial subscription release; pilot/invited users can rely on current POS/quick `P0QLT`.

### Future Package F — Other P8 Deferred Evidence

- **Reason:** `OFFLINE.*` 4 (`ACTOR-BINDING`/`BROWSER`/`CONFLICT`/`MULTITAB`) + `R06.CONCURRENT` + `BRANCH` 5 (customers/financial/inventory/read/reports) + `AI.BRANCH` + `R02.DEC-02`/`OTP` 4 + `LEGACY` 12 (historical) = 15 `C` + 12 `F` — either no approved contract, honest harness limitation, or superseded.
- **Affected capability:** Generic offline conflict/multitab/browser process, concurrent `FOR UPDATE` (needs 2-client harness), branch org-wide intentional, legacy bootstrap.
- **Evidence needed:** Approved conflict-resolution contract (if ever needed), 2-client `FOR UPDATE` harness for concurrent stock, branch `can_access_branch` reshape if app-wide branch ever required (see D), otherwise none (accepted limitations).
- **Implementation may eventually be required:** **Conditionally** — only if product contract expands to those capabilities (e.g., generic conflict merge, app-wide branch-secured customers).

Do not assign arbitrary dates or promise completion.

---

## §15 Owner Decision Record

_Leave the actual owner decision fields clearly marked for explicit completion (see §13 Q1–Q9). Do **not** select on behalf of owner._

**Proposed scope (§3/§6):** Limited controlled release as defined — see §3 included/excluded and §6 matrix.

**Environment blockers (B 21):** `R094` 2 + `TENANT.storage` 2 + `AUTH`/`PRIV`/`R02` 17 — infrastructure-deferred (see §7).

**Accepted limitations (C 15):** `BRANCH` 5 + `OFFLINE` 4 + `R06.CONCURRENT` 1 + `AI.BRANCH` 1 + `R02.DEC-02`/`OTP` 4 — see §8.

**Owner decisions required (D 4):** `BRANCH.create` / `BRANCH.cross-branch-admin` / `BRANCH.modify` / `BILLING.SERVER-QUOTA` — see §9.

**Security assessment:** §10 — all security-critical within limited scope **PASS** (6 PASS, 3 BLOCKED B not in scope).

**Financial-integrity assessment:** §11 — 8/8 **PASS** (0 blockers) per R05/R06/R07/R08/P5-B/P5-C/P6/P7.

**Release options:** §12 — **A** Limited Controlled, **B** Conditional, **C** Hold — see consequences §14.

**Future packages:** §16 — A Storage, B Real PostgREST/GoTrue, C Provider Auth, D Branch admin, E Canonical billing, F Other deferred — see §16.

**Owner decision (to be completed):**

- Q1 Scope: [ ] YES / [ ] NO — Response: _________________________
- Q2 Environment (B 21): [ ] YES / [ ] NO — Response: _________________________
- Q3 Accepted (C 15): [ ] YES / [ ] NO — Response: _________________________
- Q4 Branch admin (D 3): [ ] YES / [ ] NO — Response: _________________________
- Q5 Billing (D 1): [ ] YES / [ ] NO — Intended: [ ] PILOT / [ ] FULL COMMERCIAL — Response: _________________________
- Q6 Storage: [ ] YES / [ ] NO — Response: _________________________
- Q7 Provider auth: [ ] YES / [ ] NO — Response: _________________________
- Q8 Browser revalidation: [ ] YES / [ ] NO — Response: _________________________
- Q9 Release decision: [ ] GO / [ ] CONDITIONAL GO / [ ] NO-GO — Conditions/blocker: _________________________

**Owner signature:** _________________________________ **Date:** _______________

**Reviewer (governance):** _________________________________ **Date:** _______________

---

*Verification: `git diff --stat` since `dc80e1c` — docs/audits only (P9); `git diff --check` PASS; `tests/release/*` unchanged (P8 classification-only). Do not rerun `test:release` unless required to inspect existing evidence.*
