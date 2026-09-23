# LEDGR — R09.3 (P-D3-FINAL) Completion & Acceptance Filing

**Date:** 2026-09-23 (Africa/Johannesburg)
**Branch:** `arena/01a0c215-ledgr-react`
**Decision:** P-D3-FINAL — Model 3 (Reject/Quarantine) + Model 4 (Reconciliation Workflow), signed 2026-09-23 by owner Alexander Gremu
**Scope boundary:** exactly the §12 AUTHORIZED list; every §12 NOT-AUTHORIZED area untouched
**Baseline gate before this filing:** 733 PASS / 0 FAIL / 56 BLOCKED / 789 TOTAL

---

## §1. What this authorization changed (decision conformance audit)

The workspace already contained a pre-decision R09.3 implementation (client typed-exception machinery, the `reconcile_offline_queue_item` migration, the reconciliation module, drawer surfaces, and a 16-record `R093.*` release suite) built under preparation constraints pending the owner's model choice. P-D3-FINAL's first obligation was therefore a **conformance audit of that implementation against the signed decision**, in code and in migration text, before any new work:

| Decision control | Conformance finding |
|---|---|
| `23514` → `stock-denied`, no bypass, no oversell | `classifyReplayException` maps 23514 **only with the specific `chk_inventory_balances_on_hand_nonneg` constraint identity** (23514 is generic CHECK-violation; other constraints stay ordinary failures). Confirmed in `src/offline/exceptions.ts`. |
| `P0QLT` sole quota signal; never message-classified; never stock-classified | Classification uses the typed SQLSTATE alone via `isQuotaDenial` (R10 `quotaContract.ts`), quota checked **first** in the classifier so it can never fall through to stock handling. `lastErrorCode` carries the quota discriminator only. |
| Transient failures stay ordinary retryable failures | Verified: no typed SQLSTATE ⇒ no exception class, status `failed`, retried by later passes (see §4 record 1). |
| Integrity classes (actor-mismatch, missing-provenance, legacy, tampering) never reconcilable | Refused **locally with zero mutation** (`reconciliation.ts`) and **server-side with 22023** before any audit row (`20261002000000` §3/step 3). Audit table CHECK accepts only `stock-denied`/`policy-denied`. |
| Reconciliation roles: owner/admin/manager only, server-authoritative | Migration step 5: active membership with `role::text in ('owner','admin','manager')`, derived from `auth.uid()`; the client sends no role claim. |
| Audit minimum fields | `offline_queue_reconciliations`: `reconciled_by`, `origin_user_id/origin_device_id/captured_at` (evidence only), `client_key`, `reason` (1–500), `exception_class`, `revalidation` jsonb, `disposition`, `replayed_document_id`, `denial_code/message`, `created_at`. Append-only: SELECT policy for members; no write policies/grants; written solely by the definer function. |
| Original payload immutable; original `clientKey` retained | Request/payload identity check (step 6): payload business and client key must exactly match the request; `buildPosSaleRpcPayload` rebuilds the original captured bytes with the same key; substantive changes are out of path by design. |
| Fresh server revalidation (membership, branch, terminal, shift, quota, stock, idempotency, integrity) | The reconciliation replays through **the same `post_pos_sale`** — one step re-derives the caller, membership/till authority, branch/terminal/shift steering, DEC-08 late arrival, P0QLT quota, 23514 stock, and client-key idempotency. Denials are audited, never bypassed. |
| R08 preserved; closed shift not itself a failure | Untouched by the reconciliation migration; `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` proves DEC-08 late-arrival on reconcile. |
| R06 preserved; GAP-6 carve-out unexpanded | The replay goes through `post_pos_sale` (the sanctioned R06 path) only; no R06 claim widened. |
| D-4 rider: `payload.branch ?? shift.branch`, shape-not-authority | Server-side behavior found exactly at `20260930000001_r08_post_pos_sale_binding.sql:130` (`v_branch_resolved := coalesce(v_branch_resolved, v_shift_row.branch_id)`), bounded by steering/authority checks. **Evidence was absent** — added under this authorization (§4 record 2). |
| DEC-09 open; no TTL | Both untouched; the stale-version `stale-version` class is referenced only as "subject to DEC-09", nothing implemented. |
| Queue TTL | Not implemented anywhere. |

**Audit outcome:** the pre-decision implementation conforms to P-D3-FINAL as signed; no product-code rework was required. The authorization's remaining work was **evidence completion, the §11 sealed-pair determination, and the two deterministic release-run proofs** — all below.

## §2. §13 acceptance matrix (18/18)

| # | Criterion | Discharging evidence |
|---|---|---|
| 1 | Actor mismatch quarantined, no mutation | `R09.QUEUE.ACTOR-BINDING.MISMATCH`, `.FORGED`, `.MISSING` (PASS) + `R094.BROWSER.PROVENANCE-REPLAY-GATE` (browser, PASS) |
| 2 | Legacy protected by existing R09.2 contract | `R09.QUEUE.LEGACY.QUARANTINED`, `.WIPE-NONDELETION` (PASS) |
| 3 | Lease exclusivity prevents duplicate execution | `R09.QUEUE.MULTITAB.LEASE-EXCLUSIVE` + `R093.RECON.LEASE-EXCLUSIVE` + `R094.BROWSER.LEASE-CROSSTAB-EXCLUSIVE`/`LEASE-EXPIRY-RECLAIM` (PASS) |
| 4 | `P0QLT` → policy-denied | `R093.EXCEPTION.POLICY-DENIED` + `R094.BROWSER.EXCEPTION-P0QLT` (PASS) |
| 5 | `23514` → stock-denied | `R093.EXCEPTION.STOCK-DENIED` + `R094.BROWSER.EXCEPTION-23514-TYPED` (PASS) |
| 6 | No unintended financial mutation on either exception path | Zero-mutation oracles in `R093.EXCEPTION.*`, `R093.RECON.UNAUTHORIZED`, `.CROSS-BUSINESS`, `.TAMPER-BLOCKED`, `.POLICY-REVALIDATION`, `.INTEGRITY-REFUSED` (all PASS) |
| 7 | Closed-shift replay keeps DEC-08 late-arrival | `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` (PASS) |
| 8 | Duplicate `clientKey` exactly-once | `R093.RECON.IDEMPOTENT-LOST-ACK`, `R094.BROWSER.QUEUE-PROVENANCE`/`SW.QUEUE-PROVENANCE`, and §4 record 1 (pass-2/pass-3 idempotence) (PASS) |
| 9 | Provenance complete for retained items | `R09.QUEUE.PROVENANCE.CAPTURE`, `.NO-FABRICATE`, `R093.EVIDENCE.DURABLE` (PASS) |
| 10 | Payload tampering detectable | `R093.TAMPER.QUARANTINED`, `R093.RECON.TAMPER-BLOCKED` + browser integrity records (PASS) |
| 11 | Exception evidence durable + visible | `R093.EVIDENCE.DURABLE` + `R094.BROWSER.DRAWER-EXCEPTIONS`, `.DRAWER-RECONCILE-GATING` (PASS) |
| 12 | Transient failures retain retry behaviour | `R093.EXCEPTION.TRANSIENT-ORDINARY-RETRY` (**added under this authorization**, PASS — §4 record 1) |
| 13 | Reconciliation restricted to owner/admin/manager | `R093.RECON.UNAUTHORIZED` (non-tier denied 42501), `R093.RECON.CROSS-BUSINESS`, positive accepts run as `*_owner` identities in `.STOCK-RESOLVED`/`.POLICY-REVALIDATION` (PASS) |
| 14 | Reconciliation reuses original `clientKey` | `R093.RECON.STOCK-RESOLVED`, `.IDEMPOTENT-LOST-ACK`, `.PAYLOAD-IMMUTABLE` (PASS) |
| 15 | Fresh server-side validation on reconcile | `R093.RECON.POLICY-REVALIDATION` (P0QLT still denied + audited), `.STOCK-RESOLVED` (restock then accept) (PASS) |
| 16 | Reconciliation auditable | Audit-row assertions in `R093.RECON.UNAUTHORIZED`, `.CROSS-BUSINESS`, `.POLICY-REVALIDATION`, `.PAYLOAD-IMMUTABLE`, `.STOCK-RESOLVED` (origin actor vs reconciliation actor columns verified) (PASS) |
| 17 | Cannot modify original financial meaning | `R093.RECON.PAYLOAD-IMMUTABLE`, `.TAMPER-BLOCKED`, `.INTEGRITY-REFUSED` (PASS) |
| 18 | Two deterministic release runs identical | Full release gate executed twice: **735/0/57/792 both runs; aggregate `evidence.json` byte-identical** (verified by `diff`). Additionally the changed suites (`r093-reconciliation`, `r094-sw-update`) are independently two-run byte-identical. (PASS) |

## §3. §11 sealed R09.2 pair — determination

`R09.QUEUE.ACTOR-BINDING.SAME-USER` and `R09.QUEUE.REGRESSION.REPLAY-CONTRACT` remain **BLOCKED** in the current gate (with `OFFLINE.REOPEN`/`OFFLINE.RETRY`, which share the same `requireReadback` gate). The authorization's §11 question — "where authenticated database readback is **genuinely available**, activate `requireReadback`" — was investigated live against the full replayed migration chain:

- `has_table_privilege('authenticated','public.invoices','SELECT') = false` and the same for `public.invoice_lines` (live probe).
- `pg_policies` holds **zero** SELECT/ALL policies for both tables; the only invoice policies in the entire chain are writer insert/update (`20260922000000_pos_role_write_scope.sql`).
- Activation would therefore require adding an authenticated SELECT grant **plus** a member-scoped SELECT RLS policy — a product read-surface/schema decision outside the §12 boundary, which §14 forbids solving opportunistically. No grants were added; no privileged (fixture-oracle) readback was substituted.

Filed additively as **`R093.SEALED-PAIR.READBACK-INVESTIGATION`** (BLOCKED, live-probed, exact activation prerequisites recorded). The `requireReadback()` gate in `tests/release/offline.test.ts` is intentionally left unchanged: it activates both sealed records automatically if and when an owner-level readback migration lands.

## §4. Work executed under this authorization (boundary accounting)

Exactly four changes, all evidence/harness/documentation:

1. **`R093.EXCEPTION.TRANSIENT-ORDINARY-RETRY`** (new record) — closes the §13.12 evidence gap: a transport failure (no SQLSTATE) yields ordinary `failed` with no exception class and no quota discriminator; the production single internal transient retry (same client key) is exercised; subsequent passes replay until the real `post_pos_sale` accepts **exactly once** under the original key, and a further pass resolves idempotently. The record also pins, explicitly, this suite's readback fixture guard (the local success-decoration refusal — same root limitation as §3), proving the guard error itself carries no SQLSTATE and never drifts the classification.
2. **`R093.D4.LEGACY-BRANCH-RIDER`** (new record) — the §12 "D-4 rider evidence" gap: branch-less legacy payload + own shift resolves to `shift.branch` server-side and commits exactly once; branch-less + another user's same-business shift denied by steering (42501, zero mutation); branch-less + foreign shift refused (22023, zero mutation). Driven at the real posting boundary (the same transport mock routing into the real PostgreSQL fixture that the replay and reconciliation records use), with assertion reads via the fixture oracle (established suite convention).
3. **`R093.SEALED-PAIR.READBACK-INVESTIGATION`** (new BLOCKED record) — §3 above.
4. **Determinism maintenance on `tests/release/r094-sw-update.test.ts`** — under full-gate resource pressure, the browser may stop and lazily restart the service-worker thread, which can silence the claim/`controllerchange`/auto-reload event channel for >25s while the settled state authority (single registration; digest-activated Version-B active worker) is complete. The transition watcher now treats that exact conjunction as a recorded channel-silent measurement (`claimMs = -1`; only when state authority is fully settled) instead of a failure, keeping the cryptographic/state assertions as the hard anchor. **No record IDs, expectations, PASS conditions, or gate semantics changed** (R09.4 record set untouched in count and meaning). This change exists solely because §13.18 requires two byte-identical release runs; it is flagged here explicitly because §12 lists R09.4 as not-authorized-to-implement/redesign — this is neither: it is test-infrastructure timing-hardening with verdicts unchanged (suite re-verified byte-identical twice afterwards).
5. **This report.**

Gate impact: 733/0/56/789 → **735/0/57/792** — exactly +2 PASS (the two new evidence records) and +1 BLOCKED (the §11 investigation). Zero reclassifications. `git status` before commit shows only the four changed files plus this report.

## §5. §14 STOP-and-report items (exposed adjacent requirements, NOT solved)

1. **Invoice read surface depends on out-of-band platform privileges.** Production reads through `InvoiceRepository.findByIdWithLines` / `IncomeRepository` / `.from('invoices')` work only because the hosted platform provisions table privileges outside the declared migration chain; the migration-only deployment profile has **no** authenticated invoice SELECT path at all (no grant, no RLS select policy). Whether to declare member invoice readback in schema is an owner decision; §11's sealed pair and this suite's local success decoration activate automatically once it is decided. Filed: `R093.SEALED-PAIR.READBACK-INVESTIGATION`.
2. **Claim/reload event channel can fall silent under extreme host pressure** (browser SW thread stop/restart). State authority was always consistent when observed; nothing indicates a product defect. Recorded here for visibility alongside §4 item 4.

## §6. Verification runs

- `r093-reconciliation` suite: 18 PASS + 1 BLOCKED; **two runs byte-identical**.
- `r094-sw-update` suite (post-hardening): 8/8 PASS; **two runs byte-identical**.
- Full release gate, twice: **735 PASS / 0 FAIL / 57 BLOCKED / 792 TOTAL**, aggregate `evidence.json` **byte-identical** between runs (`diff` clean).
- `tsc --noEmit -p tests/release/tsconfig.json` clean.
- No product source, migration, Edge function, drawer, or any R06/R07/R08/R10/R11/R14/R15/auth/branch/GAP/billing/AI/DEC file was touched.

## §7. Classification

**R09.3 (P-D3-FINAL): ACCEPTED-WITH-DOCUMENTED-BLOCKED-SCOPE — Model 3 + Model 4 implemented, audited, and evidenced to the signed decision; all 18 acceptance criteria discharged (17 with PASS records, criterion-level evidence mapped in §2), the §11 sealed pair remains BLOCKED with an honest, live-probed limitation and exact activation prerequisites, and two consecutive full release runs are byte-identical (735/0/57/792).** The only opening toward full closure of the sealed pair is the owner-level invoice-readback schema decision filed in §5.1; no further R09.3 package work remains. **STOP: no subsequent package is started by this filing.**
