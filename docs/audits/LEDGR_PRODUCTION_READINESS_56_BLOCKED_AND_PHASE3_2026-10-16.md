# Ledgr — production-readiness plan for the 56 BLOCKED release checks (57 after the trunk merge), and Phase 3 proposal (2026-10-16)

**Status:** planning and documentation only. **No production or shared database was accessed, no
migration applied, no deployed permission changed, and nothing was deployed.** ADR `INV-CM-001` remains
proposed, not accepted. GL posting remains disabled by construction.

**Baseline this plan is written against** (re-run locally for this document, not copied forward):

| Field | Value |
| --- | --- |
| Command | `npm run test:release` |
| Result (pre-trunk-merge — the requested 56) | `{"PASS": 839, "FAIL": 0, "BLOCKED": 56, "NOT APPLICABLE": 0}` — `.cache/r13/ledgr-r13-UeGK4c/` (895 rows) |
| Result (post-trunk-merge — current head) | `{"PASS": 839, "FAIL": 0, "BLOCKED": 57, "NOT APPLICABLE": 0}` — `.cache/r13/ledgr-r13-nk7CnD/` (896 rows) |
| Evidence properties | sanitized; `environment: "local"`; `productionVerified: false` |
| Commit (pre-merge run) | `32192949712455eb35fa3c1dbc70dc745dee0667` |
| Layer | 127 migrations replayed into embedded PostgreSQL 17.10.0-beta.17; real PG roles/RLS; **synthetic** Auth/Storage; migration-only public grants; pg_cron/pg_net disabled; harness `tests/release/bootstrap.sql` + `tests/release/database.mjs` |

### The 56 → 57 delta, and why this document still enumerates 56

The trunk merged after this checklist was commissioned, adding `tests/database/cron_jobs_apply.test.js`.
The isolated harness does not execute legacy `tests/database/*` suites, so that file registers one new
BLOCKED row, `LEGACY.cron_jobs_apply.test.js`. A row-by-row comparison of the two evidence files shows
**exactly one new row, no removed rows, and no status change on any of the 895 shared rows** — PASS stays
839. So the requested 56 remain the 56, unchanged and correctly grouped below; the 57th belongs to the
same dependency as the others in Group F (the legacy replay contract, nothing else), which is therefore 17
rows on the current head. The count to quote going forward is **57**, and the goal of this plan is to drive
both numbers to zero — by evidence, or by an explicit recorded re-score.

---

## 1. What "BLOCKED" means, and what this evidence is worth

A BLOCKED row is not a failure and not a pass. Each row's setup calls `ready()`, which throws `Blocked`
with the exact missing dependency when the precondition for a faithful test is absent. The harness then
records that reason **instead of inventing a result**. `FAIL: 0` means no probe contradicted a product
claim; `BLOCKED: 56` means 56 specific claims are **unproven** (57 on the current head — see the delta
above), and this document is the plan to prove or
re-score them.

Three things follow, and they are the reason this plan exists rather than a "known issues" list:

1. **Local evidence never becomes deployed evidence.** The 839 PASS rows prove behaviour against a real
   PostgreSQL with the real migrations and real RLS policies, under synthetic identities bound through
   `request.jwt.claim.*`. They do **not** prove GoTrue behaviour, PostgREST request handling, deployed
   grant profiles, Storage policies or Edge runtime behaviour. Every row already carries
   `productionVerificationRequired: true`.
2. **Not all of them are environment gaps.** Some need a *decision*, one is superseded by newer evidence, and
   one group needs a harness-contract choice. Only ~half need a Supabase environment at all — which is
   why this plan groups by dependency rather than by checklist order.
3. **The construction feature adds no row to these 56.** All 56 exactly match the pre-construction run
   (`.cache/r13/ledgr-r13-P8oJsc/`, 834/0/56/0). Construction adds a *new* verification class that these
   56 do not cover — deployed authorisation of the 21 `public.*_construction_*` commands — described in §11.3.

## 2. Dependency summary

| Group | Rows | Unblocked by | Requires a production change? | Approval owner |
| --- | --- | --- | --- | --- |
| A. Official Supabase Auth + Edge runtime | 19 | Dedicated Supabase project (GoTrue, Edge/Docker) + approved recovery/OTP contract | No (isolated project) | Security/platform owner |
| B. Deployed RLS/ACL grant profile (+ 1 product decision) | 12 | Deployed grant/ACL set in an isolated environment; a branch-scope decision | **Only after review** — grants are security-relevant | Security owner + product owner |
| C. Wire-reachable real backend for browser evidence | 2 | Disposable Supabase stack addressable over HTTP | No (disposable stack) | Platform owner |
| D. Offline client-identity and conflict contracts | 4 | Two approved contracts, then implementation and browser workers | No (client code) | Product + security owners |
| E. Product/approval decisions, no environment gap | 3 | Decisions; two need approved server commands | Yes, once approved | Product/accounting owners |
| F. Legacy standalone suites | 16 requested, **17** on the current head (the trunk merge added one) | A replay/bootstrap contract or formal retirement mapping | No | Engineering owner |

Nothing below is authorised by being written down. Each group's "risk" line states what could change
production data or permissions if it were done carelessly.

---

## 3. Group A — Official Supabase Auth (GoTrue) service and Edge runtime — 19 rows

- `AUTH.expired-session` — src/lib/supabase.ts
- `AUTH.invalid-login` — src/lib/supabase.ts
- `AUTH.logout-revocation` — src/lib/supabase.ts
- `AUTH.valid-login` — src/lib/supabase.ts
- `PRIV.INVITATION` — supabase/functions/accept-invite-link/index.ts
- `PRIV.RECOVERY` — supabase/functions/invite-team-member/index.ts
- `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` — supabase/functions/invite-team-member/index.ts
- `R02.PROVIDER-TOKEN.consumed` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.expired` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.identity-changed-after-issuance` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.invalid` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.malformed` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.missing` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.replay` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.substituted` — src/pages/auth/ResetPasswordPage.tsx
- `R02.PROVIDER-TOKEN.valid-own-identity` — src/pages/auth/ResetPasswordPage.tsx
- `R02.RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` — supabase/functions/invite-team-member/index.ts
- `R02.RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED` — supabase/functions/invite-team-member/index.ts
- `R02.RECOVERY.OTP.WRONG-DENIED` — supabase/functions/invite-team-member/index.ts

**Exact verification required.** With real GoTrue: (a) valid login issues a session, and an expired,
revoked or logged-out session is refused on the next authenticated request; (b) invalid credentials are
refused without leaking which factor was wrong; (c) recovery/invitation flows bind the resulting mutation
to the verified subject — nine `R02.PROVIDER-TOKEN.*` rows assert that a consumed, expired, malformed,
missing, replayed, substituted or identity-changed proof cannot authorise a credential change; (d) the
three OTP rows assert one-phone-one-user behaviour, a denied wrong OTP, and a denied substituted target.

**Environment and permissions required.** A **dedicated, disposable** Supabase project (or an approved
preview branch) with its own URL and anon/service keys; permission to create and delete test users
(Auth admin) and to deploy nothing except the existing Edge handlers under test. Deno is needed for the
Edge handlers (`PRIV.INVITATION`, `PRIV.RECOVERY`, `AI.BRANCH` currently run in a local Node VM against
mocked Auth/DB — `AI.BRANCH` is in Group E because its blocker is a contract, not a runtime).
**Never a production project, never real phone numbers or e-mail addresses.**

**Evidence needed to mark a row verified.** Per-row captured output from a harness run tagged with the
target project ref and the commit, showing the assertion observed against the real service; teardown
confirmation (test users deleted); and a note that no production project was contacted. Evidence label
must read *isolated deployed Supabase*, never "production".

**Risk.** Test-user creation in a shared project would notify real addresses and consume quotas;
recovery flows pointed at real numbers would send real messages; using production service keys would
grant full credential authority to a test. Any grant of `auth.admin` capability to a tenant
administrator would be a security regression and is out of scope.

## 4. Group B — Deployed RLS/ACL grant profile — 12 rows

- `BRANCH.create` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.cross-branch-admin` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.customers` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.financial` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.inventory` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.modify` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.read` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `BRANCH.reports` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `PRIV.MEMBERSHIP` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `PRIV.PROFILE` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `TENANT.A.storage` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `TENANT.B.storage` — supabase/migrations/20260815000003_phase8b_rls_policies.sql

**Exact verification required.** Replay the migrations **plus the deploy-time grant/ACL set** into an
isolated environment, then re-run the probes: (a) `PRIV.MEMBERSHIP` — a viewer cannot promote their own
membership; (b) `PRIV.PROFILE` — an ordinary user cannot change `is_platform_admin`; (c) both storage
rows — a business's own logo is visible and a foreign logo is hidden by the storage object policies;
(d) the eight `BRANCH.*` rows — an A1-only user cannot reach A2 data while an explicitly all-branch role
retains access.

**A decision is required first for the `BRANCH.*` rows.** Their current recorded reason is that the
branch scope is *by design* limited to the till family (`pos_shifts`, `pos_cash_movements`,
`pos_shift_closes`, `pos_shift_late_adjustments` use `can_access_branch`), while core tables
(invoices, contacts, journal_entries, products, inventory…) keep org-wide `is_business_member` SELECT
policies. So `BRANCH.read` is not a missing-grant problem: it is an unanswered question — *should an
A1-assigned user be able to read A2 invoices?* Until that is answered and implemented, these rows should
stay BLOCKED rather than be "verified" against a behaviour no one has approved.

**Environment and permissions required.** The deployed grant profile is not derivable from the
migration files alone — the local run's `databaseProfile` says exactly that ("migration-only public
grants"). Capturing it requires read-only access to a deployed project's ACLs (`supabase migration list
--linked`, and a read-only catalog dump of `pg_class`/`pg_proc`/`pg_policy`/storage policy definitions),
or an owner-supplied ACL snapshot. Applying anything requires an approved, reviewed security change.

**Evidence needed.** A recorded diff between migration-only ACLs and the deployed ACLs, plus the probe
outcomes in an environment carrying the deployed profile; for the branch rows, a written product/security
decision and the migration that implements it, with the expectation updated in the same commit.

**Risk.** This is the group with real production exposure. Grant changes are tenant-wide security
changes: a wrong grant on `business_users`, `profiles` or storage objects can expose every tenant's data.
Nothing here may be applied to a shared or production project without explicit, recorded approval.

## 5. Group C — A wire-reachable real backend for browser-driven evidence — 2 rows

- `R094.BROWSER.SERVER-REVALIDATION` — src/offline/{db,queueApi,provenance,payloadIntegrity,lease,exceptions,syncEngine,reconciliation}.ts, src/lib/cacheWipe.ts, src/lib/queryPersister.ts, src/components/layout/OfflineQueueDrawer.tsx, dist (real Vite production build) — executed in real Chromium; harness in tests/browser/*
- `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` — live sandbox probing 2026-09-23 (process/dependency/network capability checks); tests/release/database.mjs fixture source; supabase/migrations/*rpc*.sql; no HTTP layer invented; no backend mocked

**Exact verification required.** A browser session driving a **real** backend over the wire must show
that the reconcile RPC revalidates server-side: DB-side actor-versus-origin check, DB-side `client_key`
idempotency, and snapshot-versus-server raster. The accompanying `…INVESTIGATION` row is a limitation
record: a live probe on 2026-09-23 found no way to stand up network-addressable, disposable Supabase
services in this sandbox (no Docker; the embedded-PostgreSQL fixture is process-local and not a
PostgREST/GoTrue stack).

**Environment and permissions required.** A disposable Supabase stack reachable over HTTP for browser
traffic — Docker locally, an ephemeral hosted project, or an approved preview branch — plus a headless
browser runner. Read/write only to disposable data; no production endpoints from a browser session.

**Evidence needed.** Browser-driven run logs against that backend, with server-side instrumentation of
the actor origin and the idempotency decision, tagged with the environment and commit.

**Risk.** None to production if genuinely disposable. The real danger is the inverse: marking this
verified by pointing the browser at a stub, which the row explicitly refuses ("no server truth
fabricated"). A stub result must not become a PASS.

## 6. Group D — Offline client-identity and conflict contracts — 4 rows

- `OFFLINE.ACTOR-BINDING` — src/offline/syncEngine.ts
- `OFFLINE.BROWSER` — src/offline/syncEngine.ts
- `OFFLINE.CONFLICT` — src/offline/syncEngine.ts
- `OFFLINE.MULTITAB` — src/offline/syncEngine.ts

**Exact verification required.** Two contracts must exist first, because the rows refuse to invent them:
a durable originating-user/device identity for queued operations (so per-user queue isolation is a real
property, not an assumption), and an approved conflict-resolution rule for a queued operation whose
server state moved (the generic queue currently has a timestamp but no approved update operation).
Then: real browser/service-worker lifetime evidence for cache claims, and cross-tab lease evidence.

**Environment and permissions required.** Client-side implementation plus a real browser runtime (this
exists — the R09.4 work already runs a real Chromium with real IndexedDB/CacheStorage/BroadcastChannel/
service worker; `OFFLINE.BROWSER`'s "no browser runner" reason is now stale, see §8). No database
permission changes.

**Evidence needed.** The two approved contracts (referenced by decision id), plus browser-run output
covering queue isolation, conflict handling, multi-tab leases and a genuine process restart.

**Risk.** The offline queue carries POS/payment operations. A weakly-specified client identity could
allow one user's queued sale to be attributed to another, or a duplicate to be posted after a conflict.
Treat as payments-adjacent: review, don't rush.

## 7. Group E — Product/approval decisions with no environment gap — 3 rows

- `AI.BRANCH` — supabase/functions/ai-chat/index.ts
- `BILLING.SERVER-QUOTA` — supabase/migrations/20260815000003_phase8b_rls_policies.sql
- `R06.POS.STOCK.CONCURRENT` — supabase/migrations/20260928000001_r06_stock_balance_authority.sql

This group is the one most often mistaken for an environment problem. It is not: nothing external is
missing except a decision.

- **`R06.POS.STOCK.CONCURRENT`** — the recorded blocker is a harness limitation (the suite that owns the
  row has one connection). A second-connection factory exists and two other rows (`…CONCURRENT-2C`,
  `…CONCURRENT-2C-SEAL`) already PASS true two-connection evidence for the same mechanism, so this row's
  recorded reason is **stale**. Recommendation: re-score it as superseded with an explicit pointer to the
  2C rows, and in the same change confirm no assertion is lost. (Re-scoring is engineering work with no
  production risk; it is listed here rather than in Group F because it needs a human decision about
  duplication, not a new environment.)
- **`BILLING.SERVER-QUOTA`** — needs a canonical server command/approval/entitlement contract. Client
  scenarios already run; the server-side concurrent denial cannot be proven until the command exists.
- **`AI.BRANCH`** — needs a durable branch-assignment and field-permission contract and design approval.
  Currently an Edge handler in a local Node VM with mocked Auth/DB.

**Environment and permissions required.** None beyond the repository and the approval itself; two of the
three become command/implementation work once approved.
**Evidence needed.** The approved contract, then DB-suite rows proving denial under concurrency
(billing), branch/field scoping (AI), or the explicit supersession record (R06).
**Risk.** Implementing billing entitlements or AI field permissions wrongly affects *enforcement* of
what customers paid for or what staff may see. Both are approval-gated; neither is a "just add a grant"
change.

## 8. Group F — Legacy standalone suites — 16 requested rows, 17 on the current head

- `LEGACY.backfill_reconcile_inventory.test.js` — tests/database/backfill_reconcile_inventory.test.js
- `LEGACY.cron_placeholder_sweep.test.js` — tests/database/cron_placeholder_sweep.test.js
- `LEGACY.paye_reference.test.js` — tests/database/paye_reference.test.js
- `LEGACY.phase10_2_subtype_repair.test.js` — tests/database/phase10_2_subtype_repair.test.js
- `LEGACY.phase10_integrity.test.js` — tests/database/phase10_integrity.test.js
- `LEGACY.phase10_remediation.test.js` — tests/database/phase10_remediation.test.js
- `LEGACY.pos_sale_rpc.test.js` — tests/database/pos_sale_rpc.test.js
- `LEGACY.posting_integrity_migrations.test.js` — tests/database/posting_integrity_migrations.test.js
- `LEGACY.public_api_table_convergence.test.js` — tests/database/public_api_table_convergence.test.js
- `LEGACY.quick_save_rpc_source_uuid.test.js` — tests/database/quick_save_rpc_source_uuid.test.js
- `LEGACY.rls_security.test.js` — tests/database/rls_security.test.js
- `LEGACY.rpc_reconstruction.test.js` — tests/database/rpc_reconstruction.test.js
- `LEGACY.stock_movement_balance_trigger.test.js` — tests/database/stock_movement_balance_trigger.test.js
- `LEGACY.storage_reconstruction.test.js` — tests/database/storage_reconstruction.test.js
- `LEGACY.view_reconstruction.test.js` — tests/database/view_reconstruction.test.js
- `LEGACY.workflow_accounting.test.js` — tests/database/workflow_accounting.test.js
- `LEGACY.cron_jobs_apply.test.js` — tests/database/cron_jobs_apply.test.js *(added by the trunk merge; same dependency as the rest of this group)*

**Exact verification required.** A decision about the `tests/database/*.test.js` suites, which are present
in the repository (17 files on the current head) but "not executed" because they expect a fixed/shared bootstrap, broad
grants, or shared cleanup that the isolated harness deliberately does not provide. Three honest options
per suite: (a) port the suite onto the release harness's disposable fixture (adopting its bootstrap,
never broadening grants to make it run); (b) run it against its own disposable environment with a
documented bootstrap; or (c) formally retire it and record the replacement evidence id — only where the
scenarios are genuinely covered elsewhere ("selected scenarios reused in new suites" is the current note,
which is not the same as full coverage).

**Environment and permissions required.** Repository and a disposable database only. Option (c) requires
the replacement evidence id to be named; "[the file] is old" is not a reason.
**Evidence needed.** Either a portable run output, or a suite-by-suite mapping: legacy suite →
replacement evidence id → what, if anything, is no longer asserted.
**Risk.** None to production data, but real coverage risk: retiring a suite that covers something the new
rows do not would quietly reduce assurance. Porting must not weaken assertions to make them pass.

---

## 9. Rows whose recorded blocker looks stale (re-score, don't rebuild)

| Row | Why it looks stale | Suggested action |
| --- | --- | --- |
| `R06.POS.STOCK.CONCURRENT` | `-2C` and `-2C-SEAL` PASS with the same mechanism on two real connections | Re-score as superseded after confirming no assertion is lost (§7) |
| `OFFLINE.BROWSER` | "no browser/service-worker runner" predates the real Chromium runtime built for R09.4 | Re-scope to exactly what remains unproven under that runner (process-restart/cache proof) |

## 10. Rules that do not change while this plan is executed

1. Local/isolated evidence is never described as deployed or production evidence.
2. No migration is applied to a shared or production project, no deployed grant or policy is changed, and
   no production data is read or written, without explicit recorded approval naming the environment.
3. GL posting stays disabled; accepted-stock write-downs, supplier returns and converted-UOM costing stay
   refused until the documented accounting policy and evidence exist.
4. No discount, tax rate, exchange rate or rate date is inferred anywhere in the cost path.
5. `INV-CM-001` stays proposed until its required decision and approval are explicitly recorded.
6. A BLOCKED row may only be re-scored on the strength of *new evidence* or an *explicit decision
   record* — not by relaxing the probe.

---

## 11. Phase 3 proposal

Ordered by value-for-risk. **None of these is started by this document**; items 1–2 are ready to scope
now, item 3 needs an owner decision, item 4 is deliberately last.

### 3.1 Two missing exception-command screens — **DELIVERED 2026-10-16** (item closed)

Implemented in `ConstructionDeliveryNoteForm` (exception mode, opened from `ConstructionPurchaseOrdersSection`)
and `ConstructionBillMatchingSection`; see
[`../architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md`](../architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md)
§7.2b for what each screen does and does not do. The analysis below is kept as the record of what was
scoped. Nothing in this change touches Groups A–C, and no stock, valuation or general-ledger side effect
was added.

**What.** Screens for `record_construction_delivery_note_exception` (a late/duplicate delivery note that
must be recorded against an already-moved document) and
`register_construction_supplier_invoice_reference_exception` (superseding a reference registered by
mistake). Both commands are implemented, guarded and evidenced in the migration; only the UI is missing.

**User value.** Today an operator who mis-registers a supplier reference, or who receives the supplier's
paper after the goods were accepted, has no in-app route: they must ask a DBA or live with the wrong
record. These two screens turn a dead end into an audited correction, which is what the exception
commands were built for.

**Dependencies.** `procurement.exception.authorize` grants; the existing adapter methods
(`ConstructionProcurementRepository.recordDeliveryNoteException`,
`registerSupplierInvoiceReferenceException`) which are already typed and unchanged; the correction
target must be selectable (delivery note id / expense id) and its reason and evidence captured.
Nothing new server-side.

**Risks.** Low, and bounded by design: the commands require a reason, an evidence reference and the id of
the document being corrected, and the originals remain append-only. The main risk is UI framing — an
exception screen must read as a correction of a specific document, never as "create a delivery note" or
"re-register a bill". Ambiguity here is the whole risk; the DB will refuse a bad correction regardless.

**Acceptance criteria.** (1) Only operators holding the exception capability see either screen; everyone
else sees a disabled control with the reason. (2) Both screens require a non-empty reason and evidence
reference, and the target document is shown in full before submission. (3) A successful call shows the
resulting state change and its audit trail (append-only history visible on the affected document).
(4) Both an unbranded refusal (wrong capability) and a documented token (e.g.
`supplier-invoice-reference-duplicate`) render as explained states. (5) Retry after a transient failure
reuses the same `client_key`. (6) jsdom tests cover the gate, the validation, the refusal rendering and
the retry key; a release-suite row is added only if the UI reaches a path the DB rows do not already
cover. (7) No new stock or journal behaviour is introduced — these commands do not move stock.

### 3.2 Dated VAT-rate schedule (small, removes a standing manual dependency)

**What.** A rate-by-date schedule so that a document dated before 1 January 2026 defaults to 16.5% and a
later document to 17.5%, with the evidence for each effective date recorded. `tax_configurations` is the
natural home (it is referenced but not yet defined in the tax module).

**User value.** Today the cost path is safe but manual: it uses **the tax amount actually recorded on the
bill**, and the owner resolved the standard rate to 17.5% effective 1 January 2026 (the 31 December 2025
source is a documented outlier). Without a schedule, every back-dated document depends on someone
remembering the right rate, and the 17.5% cutover stays a piece of tribal knowledge.

**Dependencies.** The owner's explicit instruction to implement a dated schedule (the current code
deliberately records the evidence instead of hard-coding a date); a decision on the table and on whether
the rate is per-business; the existing `src/lib/vat.ts` constant and comment as the starting point.

**Risks.** Medium: a rate schedule is exactly the kind of change that silently restates historical
documents. Guardrails: never restate a posted document (the cost basis is frozen at transaction date),
keep "the recorded tax amount wins", and treat an unknown-date lookup as a refusal rather than a guess.
Also: `src/lib/vat.ts` is display/config only today — the schedule must not become a second tax
authority competing with the amount recorded on the bill.

**Acceptance criteria.** (1) A document dated in each era resolves to the rate evidenced for that date;
(2) a date before the earliest recorded rate returns "no rate recorded" and cannot be posted or priced as
if it had one; (3) no historical cost basis changes when the schedule is added (prove by re-running the
construction cost rows against an unchanged expectation); (4) the schedule carries its evidence reference
per row; (5) tests cover boundary dates (day before / day of / day after each change) and the
unknown-date refusal; (6) the matrix document's §4 VAT note is superseded by a pointer to the schedule.

### 3.3 Official Supabase verification and deployment readiness (large, owner-gated)

**What.** Execute Groups A–C of this document against isolated, disposable Supabase environments, then
Group F's consolidation, and only then consider deployment readiness. Construction adds its own
deployed-authorisation row set (see §1 note 3): the 21 commands' capability checks, four-eyes PO
authorisation, branch/location scope and exact-business membership are proven only against embedded
PostgreSQL with synthetic identities.

**User value.** This is the difference between "works in the harness" and "safe to turn on for a
customer". It is the largest remaining unknown in the whole construction feature, and it is a
precondition for any real deployment, not an optimisation.

**Dependencies.** A dedicated disposable Supabase project (or approved preview branch); Docker or
equivalent for a wire-reachable stack (Group C); the deployed ACL snapshot (Group B); the branch-scope
decision for the eight `BRANCH.*` rows; and — for Construction specifically — the migration actually
applied to that isolated project. **Not** authorised: production, shared staging, or any real customer
data.

**Risks.** The highest in this plan, and asymmetric: Group B touches grants and policies that, applied
wrongly, expose every tenant's data. Mitigations: isolated environment first, ACL diff reviewed before
any apply, no production credentials in the runner, and a written rollback/teardown per environment.
The second risk is evidentiary — a green run against a stub or against a project with relaxed grants
proves nothing; the environment and its ACL profile must be recorded with the results.

**Acceptance criteria.** (1) Every completed row carries the environment id, the commit, the migration
list and the ACL profile; (2) Group A rows show real GoTrue refusals for expired/revoked/replayed
proofs; (3) Group B rows show the deployed grant profile with a recorded diff against migration-only
ACLs, and the `BRANCH.*` rows are either decision-backed or still BLOCKED; (4) Group C shows
browser-to-real-backend traffic; (5) the construction command surface gets its own deployed-authorisation
rows (capability denial, four-eyes, cross-branch, cross-business) — added to the suite, not hand-tested;
(6) teardown is proven and no production project appears anywhere in the evidence; (7) the count of
remaining BLOCKED rows is reported with reasons, not as a bare number.

### 3.4 Additional work justified by actual user needs (to be confirmed, not assumed)

Candidates observed while building the workspace, each needing user confirmation before it becomes a
commitment:

1. **Search and filter across purchase orders, receipts and bills.** The workspace currently lists and
   groups but does not search. Real sites accumulate many documents; this is the most likely first
   complaint. Small: query params plus index review.
2. **Offline behaviour for construction screens.** The rest of Ledgr has an offline queue; the
   construction workspace does not. Deliberately deferred, because receipt posting is not idempotent
   from the operator's point of view and would interact with Group D's unresolved identity contract.
   Do not start before Group D's contract exists.
3. **Project-level material cost reporting beyond the current table.** `construction_project_material_cost`
   already exists; what is missing is a view an operator actually uses (per-site, per-period, with the
   same append-only history).
4. **Supplier claims follow-up workflow.** The open-items report surfaces `outstanding_supplier_claims`
   with ageing, but there is no way to record what was done about one. This edges toward supplier credit
   notes, which are explicitly out of scope (§ construction matrix), so it must be scoped as *tracking
   only* if pursued at all.

---

## 12. Recommended order

| Order | Item | Why now | Gate before starting |
| --- | --- | --- | --- |
| 1 | §3.1 exception screens | Small, no new server behaviour, closes two real dead ends, current code already types the commands | None beyond normal review |
| 2 | §3.2 dated VAT-rate schedule | Small, removes a standing manual dependency, but must not restate history | Owner's instruction to implement the schedule + table decision |
| 3 | Group F consolidation + re-scoring of §9 rows | Cheap, reduces the checklist honestly, no environment needed | Engineering decision on port-vs-retire, no assertion loss |
| 4 | §3.3 official Supabase verification (Groups A→B→C) | The real gate for deployment; Group A is lowest risk (disposable project), Group B highest (grants) | Owner approval of an isolated environment per group; branch-scope decision for `BRANCH.*` |
| 5 | Group D contracts | Needed before any offline construction work; POS/payments-adjacent | Product + security decision on identity and conflict rules |
| 6 | Group E decisions | Two of three need approved commands before any code | Product/accounting approval |
| 7 | §3.4 items | Must be validated by real users first | User confirmation, then normal scoping |

**What not to start yet:** any Group B grant or policy change, Group D implementation before its
contracts exist, Group E code before its contracts exist, and anything that treats local or CI evidence
as deployed verification.

## 13. Verification of this document

This plan was produced by reading the current evidence artifact rather than a prior summary: the blocked
ids in Groups A–F are enumerated directly from a run recording
`{"PASS": 839, "FAIL": 0, "BLOCKED": 56, "NOT APPLICABLE": 0}` at commit
`32192949712455eb35fa3c1dbc70dc745dee0667` (`.cache/r13/ledgr-r13-UeGK4c/`), and the six groups partition
those 56 ids exactly, with no row counted twice and none unassigned. After the trunk merge the same command
records `{"PASS": 839, "FAIL": 0, "BLOCKED": 57, "NOT APPLICABLE": 0}` (`.cache/r13/ledgr-r13-nk7CnD/`);
the single added id, `LEGACY.cron_jobs_apply.test.js`, is listed in Group F, so the partition is still
exact at 57. The stale-blocker observations in §9 were checked against the
current evidence file (for example, `R06.POS.STOCK.CONCURRENT-2C` and `-2C-SEAL` are PASS rows in the
same run), and the "no browser runner" reason in `OFFLINE.BROWSER` was checked against the R09.4 records
in the same file. No production or shared environment was contacted to write it.
