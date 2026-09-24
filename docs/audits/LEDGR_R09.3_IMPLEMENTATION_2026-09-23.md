# LEDGR — R09.3 IMPLEMENTATION REPORT

**Date:** 2026-09-23
**Package:** R09.3 — Offline Queue Replay / Reconciliation
**Authorization:** P-D3-FINAL = **Model 3 + Model 4** (owner: Alexander Gremu, 2026-09-23)
**Baseline commit:** `194a8f4` (tree clean at start; decision package `docs/audits/LEDGR_R09.3_DECISION_PACKAGE_2026-09-23.md`)
**Scope:** R09.3 only. No out-of-scope package (Part L) was modified.

### Baseline reconciliation (§1 of the authorization)

The authorization restates the verified decision-package baseline as `0e6e1e8`
with **684 PASS / 0 FAIL / 53 BLOCKED / 737**. Commit chain disclosure — no
substitution occurred:

```text
0e6e1e8   R12 COMPLETE (684/0/53/737 measured)
   │  Δ = docs/audits/LEDGR_R09.3_DECISION_PACKAGE_2026-09-23.md ONLY
   │     (git diff 0e6e1e8..194a8f4 --stat: 1 file changed, +220/-0; zero code,
   │      migration, test, CI or evidence delta — the 684/0/53/737 measurements
   │      apply bit-for-bit to both commits; decision-package §15 records this)
   ▼
194a8f4   R09.3 implementation baseline for this work
   │  Δ = R09.3 implementation (16 files, +2029/−9 — see §2)
   ▼
2b01054   R09.3 implementation complete (700/0/53/753, validated)
   │  Δ = audit-trail only (this report incl. this disclosure; zero code,
   │     migration, test or evidence delta — measured outcomes apply unchanged)
   ▼
(final tip: audit-report disclosure commit)
```

Both owner authorization forms (the detailed authorization of 2026-09-23 and
its original issue) select **Model 3 + Model 4** with the same non-negotiable
controls; the implementation below satisfies both. No clause required
rework after a clause-by-clause conformance check against the restated form
(§§4–18 of the authorization vs. the delivered evidence in §§3–11 here).

---

## 1. Authorization

- **Decision:** P-D3-FINAL = Model 3 (durable typed exceptions for replay-time business/policy denials) **+** Model 4 (authorized manager-tier reconciliation). Model 4 is dependent on Model 3; no standalone Model 4 exists.
- **Owner decision:** signed authorization document dated 2026-09-23, scope R09.3 only; non-negotiable controls Part B §1–§7 honored verbatim.
- **Baseline:** `194a8f4`, working tree clean (verified `git status --porcelain` = ∅; `git ls-remote` == local).
- **Stop conditions (Part M):** none triggered. No new policy decision was required; no R06/R08/R10 contract was changed; no second quota meter; no weakening of R09.2 actor binding; no automatic recovery of integrity quarantines; no stale-version or queue-TTL policy was invented; no original-transaction financial meaning was changed; no unrelated package was modified; no production/customer data was used (R13 synthetic fixtures only).

## 2. Files changed (complete exact list)

**Added:**
1. `supabase/migrations/20261002000000_r093_offline_reconciliation.sql` — audit table `public.offline_queue_reconciliations` + SECURITY DEFINER command `public.reconcile_offline_queue_item(jsonb)`. Additive, idempotent (create-if-not-exists / create-or-replace), backward-safe (no existing object altered).
2. `src/offline/exceptions.ts` — Model 3 classification (`classifyReplayException`, `isStockInvariantDenial`, reconcilable/integrity sets, till-safe detail texts).
3. `src/offline/payloadIntegrity.ts` — canonical-JSON SHA-256 payload hash + verification.
4. `src/offline/reconciliation.ts` — Model 4 client gate (`reconcileQueueItem`, `getExceptionItems`, `isReconcilable`).
5. `tests/release/r093-reconciliation.test.ts` — 16 release records (`R093.*`).
6. `src/offline/__tests__/exceptions.test.ts` — 6 unit tests.
7. `src/offline/__tests__/payloadIntegrity.test.ts` — 5 unit tests.
8. `src/offline/__tests__/reconciliation.test.ts` — 11 unit tests.

**Modified:**
9. `src/offline/db.ts` — additive `QueueItem` fields (`exceptionClass`, `exceptionAt`, `exceptionDetails`, `reconcileAttempts`, `lastReconcileAt`, `payloadHash`); `QuarantineReason` += `'payload-tampered'`; Dexie **v3** upgrade writes only defensive defaults for rows where a field is undefined (indexes unchanged; additive, lossless, idempotent — mirrors the v2 precedent).
10. `src/offline/queueApi.ts` — `enqueue` computes the capture-time payload hash; new items carry explicit `exceptionClass: null`, `reconcileAttempts: 0`.
11. `src/offline/provenance.ts` — sweep exemption: an item carrying a typed exception is **not** actor-mismatch-quarantined under another user's session (Model-4 window; see §5). Missing-provenance handling unchanged. R09.2 Case A/B/C semantics otherwise byte-identical.
12. `src/offline/syncEngine.ts` — (a) exception-bearing items are skipped before every gate (no blind retry); (b) payload-hash verification before any network submission (mismatch → `payload-tampered` quarantine), placed before the in-memory FK resolution so dependent payloads can never false-positive; (c) both failure paths classify via `classifyReplayException` and stamp the additive exception fields. **`lastErrorCode` semantics unchanged** (P0QLT-only, `isQuotaDenial` exactly as R10).
13. `src/components/layout/OfflineQueueDrawer.tsx` — exception badges/details, reconcile affordance (manager-tier UX hint only — authority is exclusively server-side), `payload-tampered` quarantine label, synced-with-exception rendering bypass for the post-commit warning.
14. `tests/release/gate.mjs` — suite registration `'r093-reconciliation.test.ts': 'r093-reconciliation.json'` (mandatory for evidence harvest; no gate-logic change).
15. `tests/release/edge.test.ts` — **type-annotation-only hygiene** (2 errors present at baseline `194a8f4`: unused parameter; missing property on an inline filter type). Zero assertion/logic change; all R12 records byte-identical in behavior and outcome (verified PASS in both harness runs).

**Explicitly not touched:** `tests/release/offline.test.ts` (R09/R09.1/R09.2/R10 evidence), all R06/R07/R08/R10 migrations, `20260930000001_r08_post_pos_sale_binding.sql`, `src/services/*`, CI workflows, all prior audit reports.

## 3. Model 3 — durable typed exceptions

- **State realization (owner Part D, smallest safe extension):** additive fields on the queue row; `status` stays `'failed'` so existing R10 evidence (`failed` + `lastErrorCode=P0QLT`) remains bit-true. No new row-status; `quarantined` stays reserved for integrity classes. A live exception = `status:'failed' ∧ exceptionClass ∈ {stock-denied, policy-denied}`. Durable across close/reopen (R093.EVIDENCE.DURABLE).
- **P0QLT handling (Part C):** classified `policy-denied` by typed SQLSTATE only (`isQuotaDenial`; no message-text). Result: not transient (never in the retry loop — R093.EXCEPTION.NO-BLIND-RETRY proves zero network calls over 3 passes), evidence preserved byte-exact, exposed in the drawer with plan-limit copy, retry possible **only** through Model 4, which revalidates quota server-side (R093.RECON.POLICY-REVALIDATION: replay-denied `P0QLT` while the limit stands).
- **23514 handling:** classified `stock-denied` **only** when code = `23514` **and** the on-hand constraint identity `chk_inventory_balances_on_hand_nonneg` appears in message/details/hint — 23514 is generic CHECK-violation; other constraints stay on the ordinary failure path (unit: generic-23514 → null). R06 invariant never bypassed: replay hits the real constraint server-side (R093.EXCEPTION.STOCK-DENIED: zero invoice/tenders/stock, on-hand unchanged).
- **Retry classification:** transient/network failures → ordinary `failed` retry path, unchanged (no exceptionClass). Authority failures `42501`/`22023` → ordinary `failed` evidence, **no** exceptionClass, **no** quota discriminator, never a manager-override surface (R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN: cross-tenant replay 42501 → failed, all classifiers null).
- **Evidence retention:** payload, clientKey, provenance, payloadHash byte-preserved on every exception record; `reconcileAttempts`/`lastReconcileAt` add attempt evidence; quarantine metadata untouched (`null`).

## 4. Model 4 — authorized reconciliation

- **Authorized roles (Part E):** existing R08 manager tier — `owner`, `admin`, `manager` — enforced **server-side** in `reconcile_offline_queue_item` step 5 (`business_users`, active membership). No new role; no client role claim is read (the drawer's button is a UX mirror only; R093.RECON.UNAUTHORIZED proves a cashier attempt is denied `42501` with zero mutation and zero audit rows).
- **Command/path:** client gate (`src/offline/reconciliation.ts`) → RPC `reconcile_offline_queue_item(p_request)` → audit row append → authoritative replay via `public.post_pos_sale(original payload)` in a savepoint; accepted/denied dispositions persisted; structured result returned.
- **Server revalidation (fresh, Part E):** the replay **is** `post_pos_sale`, so membership (`can_operate_pos`), DEC-03 branch (`can_access_branch`), terminal/shift trusted-state steering, DEC-08 closed-shift late-arrival, R10 quota (`_ledgr_assert_usage_limit` → P0QLT), R06 stock invariant (23514), and client-key idempotency are all re-executed live. Nothing cached client-side is consulted. `revalidation` jsonb on the audit row records validator, actor source (`auth.uid()`), timestamp.
- **Audit record (minimum fields, all present):** original `client_key`; `origin_user_id`/`origin_device_id`/`captured_at` (evidence, R09.2 — never authority); `reconciled_by` (server-derived `auth.uid()`, never replaces origin); `reason` (mandatory, 1–500); `exception_class`; `revalidation`; `disposition`; `replayed_document_id`/`denial_code`/`denial_message`; `created_at`. Table grants: member READ only; writes exclusively through the definer function (no insert/update/delete policies).
- **Original clientKey:** mandatory and identity-checked against the payload (step 6 → 22023 on mismatch); no replacement key can ever be minted (R093.RECON.PAYLOAD-IMMUTABLE).
- **Idempotency / lost-ack (matrix 12+14):** R093.RECON.IDEMPOTENT-LOST-ACK — reconcile, drop the local ack, reconcile again → same document, `idempotent:true`, exactly 1 invoice / 1 tender / one stock deduction (250→130 for qty 120).
- **Financial immutability:** the payload is hash-verified before dispatch and replayed verbatim; quantity/price/tax/customer/branch/terminal/financial meaning can never be altered by this path (R093.RECON.PAYLOAD-IMMUTABLE byte-equality on denied attempts; R093.RECON.STOCK-RESOLVED on accepted).
- **Lease:** reconciliation claims the same R09.2 cross-tab row lease as replay; a competing holder blocks the attempt locally with zero mutation (R093.RECON.LEASE-EXCLUSIVE).

## 5. R09.2 — preservation + one documented window

- **Actor binding:** preserved. EXCEPTION-WINDOW (the only change): a `failed` item **carrying a typed exception** is exempt from the cross-user sweep quarantine. Justification: such items are already out of every automatic replay path (the engine skips them before all gates), so the Case-B quarantine adds no replay protection — but it would destroy the owner-authorized Model-4 surface, where a manager-tier user reconciles **with the original actor preserved as evidence** (audit: `origin_user_id` vs `reconciled_by` as separate columns). The engine's per-item `replayViolation` guard remains active for everything that does enter the loop, as defense in depth. Existing records prove no regression: R09.QUEUE.ACTOR-BINDING.MISMATCH / FORGED / MISSING, QUARANTINE.DENY-RETRY-DURABLE — all PASS in both harness runs.
- **Provenance:** capture fields unchanged; `payloadHash` added at enqueue as integrity evidence (SHA-256 of canonical JSON). Pre-v3 rows have no hash and verify as "unknown—allowed" (documented limitation; never fabricated retroactively).
- **Lease:** unchanged; reconciliation reuses it.
- **Integrity quarantines:** `actor-mismatch`, `missing-provenance`, `legacy`, and R09.3's additive `payload-tampered` — **never reconcilable**: refused client-side with zero mutation (R093.RECON.INTEGRITY-REFUSED ×3) and server-side (`22023` for any non-`{stock-denied, policy-denied}` class, probed directly for all four). The audit table's CHECK constraint makes an integrity-class row unwritable.
- **Sealed-record activation (Part I):** both records were executed through the repository's required `requireReadback` mechanism:
  - `R09.QUEUE.ACTOR-BINDING.SAME-USER` → **BLOCKED**
  - `R09.QUEUE.REGRESSION.REPLAY-CONTRACT` → **BLOCKED**
  - **Exact limitation:** "Post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile. No fake success or privileged read substituted." No product migration grants `authenticated` table-level SELECT on `public.invoices`/`public.invoice_lines` (verified across all migrations — only `contacts/branches/departments/inventory_locations`, payroll-family and view grants exist), and the R13 bootstrap deliberately excludes grant-all defaults. Establishing readback would require changing the deployed ACL model, which is out of R09.3 scope and explicitly not done. Notably, the R09.3 Model-4 design needs **no** client readback (the server function returns the document id), so all 16 R093 records run at full strength.

## 6. R08 — confirmation

Terminal/shift semantics intact: `post_pos_sale` is unmodified and is the replay vehicle for reconciliation, so terminal authority, branch steering, manager-tier shift steering (42501/22023 classes), and **DEC-08 late arrival** apply verbatim — R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL proves a reconcile against a shift closed meanwhile posts the original sale unchanged with the append-only `pos_shift_late_adjustments` row (`command_key = clientKey||':late'`), never an error, never a rewritten close. All R08 suite records PASS in both runs. D-4 rider: legacy shape tolerance untouched (shape ≠ authority); legacy lineage payloads keep their R09.2 contract.

## 7. R06 — confirmation

The non-negative on-hand invariant remains authoritative and is enforced inside every reconciliation replay (R093.EXCEPTION.STOCK-DENIED, R093.RECON.PAYLOAD-IMMUTABLE: 23514 recorded server-side; no negative balance ever observed; denied attempts leave on-hand byte-identical). No oversell path, no stock override, no client-authorized stock adjustment exists anywhere in the change. All R06 records PASS in both runs.

## 8. R10 — confirmation

`P0QLT` remains the sole typed quota-denial signal: `lastErrorCode` is set by the exact R10 expression (`isQuotaDenial(error) ? 'P0QLT' : null`), untouched. No second SQLSTATE, no second usage meter, no message-text classification, no client-authoritative quota decision — quota revalidation happens server-side inside `post_pos_sale` during reconciliation (R093.RECON.POLICY-REVALIDATION). All 8 R10.QUOTA records PASS in both runs.

## 9. Test evidence

- **Unit suite:** **731/731 PASS** (86 files; baseline 709 + 22 new R09.3 unit tests).
- **Focused R09.3 (Part N.6):** `tests/release/r093-reconciliation.test.ts` — **16/16 PASS**:
  R093.EXCEPTION.STOCK-DENIED, NO-BLIND-RETRY, POLICY-DENIED; R093.TAMPER.QUARANTINED; R093.RECON.STOCK-RESOLVED, IDEMPOTENT-LOST-ACK, PAYLOAD-IMMUTABLE, LEASE-EXCLUSIVE, TAMPER-BLOCKED, UNAUTHORIZED, CROSS-BUSINESS, INTEGRITY-REFUSED, CLOSED-SHIFT-LATE-ARRIVAL, POLICY-REVALIDATION; R093.EVIDENCE.DURABLE; R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN.
- **Validation gates (Part N.1–5):** `tsc -b` clean; ESLint 0 errors (1 pre-existing warning in `artifacts/database/fresh-database.generated.approx.ts`, unrelated); Vite production build clean (PWA generated); `tsc -p tests/release/tsconfig.json` clean.
- **Part J matrix ↔ record map:** cases 3–5 R09.2 records (intact + §5 refusal record); 6–8 R08 records (intact); 10 → POLICY-DENIED; 11 → STOCK-DENIED; 12+14 → IDEMPOTENT-LOST-ACK; 13 → OFFLINE.RETRY (intact); 9 → CLOSED-SHIFT-LATE-ARRIVAL; 15 → §5 window + PAYLOAD-IMMUTABLE origin checks; 16 → LEASE-EXCLUSIVE (+R09.2 multitab records); 17 → DEC-09 tail, **not invented** (§11); 18 → TAMPER.QUARANTINED + TAMPER-BLOCKED; 19 → UNAUTHORIZED; 20 → CROSS-BUSINESS; 1–2 → STOCK-RESOLVED (origin preserved across a different reconciling actor). Every exception record asserts expected state, typed reason, **zero unintended financial mutation** (invoice/tender/stock oracles), evidence retention, and correct retry/reconciliation behavior (Part K).

## 10. Release evidence (Part N.7 — full harness, twice)

| Run | PASS | FAIL | BLOCKED | Total |
|---|---|---|---|---|
| #1 | 700 | 0 | 53 | 753 |
| #2 | 700 | 0 | 53 | 753 |

Deterministic: per-record `id=status` outcome hash identical across runs (`dec39199df7fc141…`). Evidence root: sanitized local JSON (`.cache/r13/ledgr-r13-*/evidence.json`); migration + harness file hashes embedded per record. Baseline delta: 684 PASS → 700 PASS (+16 R093), FAIL 0 → 0, BLOCKED 53 → 53, total 737 → 753. Existing R06/R07/R08/R09.1/R09.2/R10/R12 PASS evidence intact; no historical audit record rewritten. Gate exit status: 2 (BLOCKED present — unchanged R13 gate semantics; the 53 are pre-existing blocked packages, not R09.3).

## 11. Residual limitations (preserved, not concealed)

1. **DEC-09 stale-version acceptance/rejection tail** — open by owner decision; R09.3 invents nothing (matrix case 17). `payloadVersion:1` is the only emitted version; no unsupported-version class is created.
2. **Queue TTL/backlog horizon** — not decided; no TTL introduced (Part M honored).
3. **Sealed R09.2 records remain BLOCKED** — exact limitation in §5 (authenticated readback unavailable in the migration-only profile).
4. **DEC-03 branch remediation gaps** — out of scope; `can_access_branch` semantics unchanged.
5. **GAP-6 transfer carve-out** — transfer dispatch/receive idempotency + caller `unit_cost` into WAC remain outside the R06 safe-claim; untouched.
6. **R09.4 browser evidence** — not started; no authorization requested.
7. **All other pre-existing blocked findings** (53 BLOCKED incl. LEGACY standalone suites, R09.4 pending items, R11/R14/R15 packages, storage, auth/recovery) — unchanged, still BLOCKED, not reclassified.
8. **Model-4 replay surface is `pos_sale`-only** in this revision: it is the sole queue type with a single server-authoritative posting function. Other queue types carrying a policy/stock exception stay durably classified and visible (Model 3 complete); their reconciliation requires a future server-authoritative replay path per type and is refused today with `unsupported-operation-type` (client) / `22023` (server) — zero mutation, never improvised.
9. **Pre-v3 rows unprotected by payload hash** (no capture-time hash exists to compare); they retain full R09.2 provenance protection. Not backfilled — fabricating hashes would fabricate evidence.
10. **Reconciliation requires connectivity to the server** (it is a server-authority action); offline reconciliations are queued nowhere and attempted never.

---

**Outcome:** R09.3 implemented to the authorized contract. **700 PASS / 0 FAIL / 53 BLOCKED / 753 records**, deterministic across two full harness runs. Ledgr remains not release-complete (the 53 pre-existing BLOCKED packages stand; the red release gate is unchanged under current R13 semantics). No subsequent package (R09.4, R11, R14, R15, …) is implied or begun.
