# LEDGR — R10 Typed Quota-Denial Contract (P-D2) — Implementation & Verification Report

- **Date:** 2026-09-22 (Africa/Blantyre)
- **Branch:** `arena/01a0c215-ledgr-react`, parent commit `32e374d` (R09.3 readiness gate)
- **Authorization:** Narrow Implementation Authorization (2026-09-22) — P-D2 **only**
- **Verdict:** **COMPLETE — P-D2 DELIVERED**

---

## 1. Baseline (recorded before implementation)

Server quota denial (pre-R10), verified in repo and against the live fixture:

| Fact | Location | Value |
|---|---|---|
| Authoritative assert (single meter) | `supabase/migrations/20260921000001_usage_limit_counts_documents.sql:70-73` | `raise exception 'Monthly transaction limit reached (%). Please upgrade your plan.', v_limit using errcode = 'P0001';` |
| Metering call sites | `20260930000001_r08_post_pos_sale_binding.sql:188` (`post_pos_sale`, previously `20260923000000:659` superseded), `20260911000002:209` (`save_quick_expense`), `20260911000002:461` (`save_quick_sale`) | all three call `public._ledgr_assert_usage_limit(uuid)` inside their posting transactions |
| Client precheck throw | `src/lib/billing/UsageService.ts:191` | unnamed `Error` with the same English message (free limit 50 documents/month) |
| Boundary exposure | `src/offline/syncEngine.ts` catch loops (main + deferred) | queue item → `status:'failed'` + human `lastError` **only**; no machine discriminator |
| Error propagation | `src/services/quickSaveService.ts:127`, `src/services/posSaleRpc.ts:136` | raw supabase error `{code,message,details,hint}` rethrown intact to the sync catch |

Pre-R10 distinction mechanism: **message-text matching only** — no dedicated SQLSTATE,
no structured payload, nothing the offline layer could classify deterministically.
This was the R09.3 gate blocker `D-2 BLOCKED — P-D2 NOT DELIVERED`.

Audit finding (pre-existing, out of P-D2 scope): invoice and payroll posting flows enforce
the usage limit **client-side only** (UsageService look-ahead); no server-side assert exists
in their RPCs. The contract now makes that client look-ahead typed (`UsageLimitError`, §3),
and the server assert remains the authority where invoked. Any server-side assert for
invoice/payroll RPCs is a future additive decision, not silently changed here.

## 2. Contract enforcement evidence (server)

The sole server meter is `_ledgr_assert_usage_limit`. R10 redefines exactly this one
function (`supabase/migrations/20261001000000_r10_typed_quota_contract.sql`, applied last
in the sorted migration chain; guarded `to_regclass` pattern preserved; grants untouched):

- `errcode = 'P0QLT'` — dedicated SQLSTATE (zero collisions with stdlib, PL/pgSQL,
  integrity violations `23xxx`, RLS `42501`, or generic `P0001`).
- `detail = 'quota_denial plan_limit=… documents_used=… period_start=…'` — structured policy metadata.
- `hint = 'Policy denial (monthly document quota) — not a transient failure. Do not retry without a plan change.'`
- **Human message text unchanged** — operator/client surface preserved byte-for-byte.

Live-fixture evidence (release harness): calling the assert at the free-plan limit
(50 seeded monthly documents) through three different RPC paths all surface
`code = 'P0QLT'` (records `R10.QUOTA.SERVER-POS`, `SERVER-QUICKSAVE-EXPENSE`,
`SERVER-QUICKSAVE-SALE`), with the message text still matching the pre-R10 string
(`SERVER-POS` + `SERVER-QUICKSAVE-EXPENSE` assert the prefix).

## 3. Exact contract + rationale

**Definition.** A *quota denial* is any error whose SQLSTATE is `P0QLT`, raised by
`public._ledgr_assert_usage_limit` from inside the posting transaction; on the client it
is additionally `UsageLimitError` (the UsageService look-ahead carrying the same
discriminator). No other error classifies as quota.

**Single declaration.** The server raise exists in exactly one function; every metering
path inherits it by calling that function. The client mirrors the constant in exactly one
module, `src/lib/billing/quotaContract.ts` (`QUOTA_DENIAL_SQLSTATE`, `UsageLimitError`,
`isQuotaDenial`). No RPC duplicates it; no second usage meter was introduced; authority
stays server-side.

**Rationale for dedicated SQLSTATE (vs. structured payload / detail-only):**

1. SQLSTATE is the one field that survives the real Supabase/PostgREST/RPC boundary
   machine-readably with zero forwarding code: PostgREST maps `RAISE ... USING errcode`
   to the error JSON `code`; supabase-js exposes it as `error.code`; the raw PG driver
   surfaces it as `error.code`. Verified live in both directions (server records by raw
   PG, client records by supabase-shape errors).
2. A payload-in-`detail` approach would require parse logic at the boundary (a second,
   weaker contract) and detail-forwarding is PostgREST-configuration-sensitive; the
   structured metadata is still emitted *in addition*, for diagnostics, not for classification.
3. Dedicated code avoids regex-on-English classification and cannot collide with other
   application raises (`P0001`, `42501`, `23xxx` stock/RLS surfaces). Record
   `R10.QUOTA.SERVER-DISTINCT` proves exclusivity against a real sibling `P0001` raise
   (malformed payload) and a real `42501` R08 denial in the same fixture session.

The choice is contract-first, not client-convenience-first: the server raise inside the
posting transaction is the only place the denial can be authoritative (TOCTOU-free),
and the client side consumes the signal it emits.

## 4. Metering paths covered

| Path | Server assert site | R10 evidence | Status |
|---|---|---|---|
| `post_pos_sale` (R08 binding) | `_ledgr_assert_usage_limit` @ `20260930000001:188` | `R10.QUOTA.SERVER-POS` ✅ P0QLT through `commitAsRole` | covered |
| `save_quick_expense` | @ `20260911000002:209` | `R10.QUOTA.SERVER-QUICKSAVE-EXPENSE` ✅ | covered |
| `save_quick_sale` | @ `20260911000002:461` | `R10.QUOTA.SERVER-QUICKSAVE-SALE` ✅ (with live superuser setup probe of the declaration itself) | covered |
| Usage count RPC (`20260921000002`) | read-only snapshot; no raise | n/a (not a metering deny path) | unchanged |
| Invoice posting RPCs | **no server assert (pre-existing)** | client look-ahead now typed (`CLIENT-PRECHECK`) | audit finding §1 |
| Payroll run RPCs | **no server assert (pre-existing)** | client look-ahead now typed | audit finding §1 |

Every path that calls `_ledgr_assert_usage_limit` is covered by a server-PASS record.

## 5. RPC-boundary evidence

- Raw PG (release fixture `commitAsRole`): `raise exception ... using errcode='P0QLT'`
  surfaces as `error.code === 'P0QLT'` on the caller — verified against the live fixture
  PostgreSQL in all three server records; message preserved; unrelated raises
  stay distinct (`SERVER-DISTINCT`).
- PostgREST/supabase shape (`{code, message, details, hint}`): consumed at the sync error
  boundary exactly as supabase-js delivers it — `CLIENT-CLASSIFIES-QUOTA` feeds the real
  boundary an error in that shape and asserts the item's machine discriminator.
- Exclusivity at the boundary: `CLIENT-CLASSIFIES-NONQUOTA` proves `42501`-shaped RPC
  failures do **not** set the discriminator; unit tests cover network/transient/unknown
  shapes (`Failed to fetch`, `AbortError`, non-object errors) — all negative.

## 6. Client boundary evidence (offline layer)

Additive, minimal changes — no retry/quarantine/reconciliation decisions made (that
policy remains R09.3's open decision):

| Change | File | Nature |
|---|---|---|
| Contract mirror + classifier | `src/lib/billing/quotaContract.ts` (new) | one module, two exports + const |
| Precheck unification | `src/lib/billing/UsageService.ts` | same message; `throw new UsageLimitError(limit)` replaces unnamed `Error` — the precheck now carries the same discriminator instead of relying on text |
| Boundary consumption | `src/offline/syncEngine.ts` | in each queue catch loop: `lastErrorCode: isQuotaDenial(error) ? 'P0QLT' : null` — evidence only, no behavior change |
| Storage | `src/offline/db.ts` | optional `lastErrorCode?: string \| null` on `QueueItem` — plain property, **no Dexie version bump, no index, no migration** |

Records: `CLIENT-CLASSIFIES-QUOTA` (RPC-shape P0QLT → `lastErrorCode='P0QLT'`,
human `lastError` preserved), `CLIENT-PRECHECK` (UsageService `UsageLimitError` → same
signal without any RPC/network text), `CLIENT-CLASSIFIES-NONQUOTA` (other errors →
`lastErrorCode=null`, plain `failed` as before).

## 7. Tests + results

**New release records (8, additive, `R10.QUOTA.*` in `tests/release/offline.test.ts`):**

| Record | Result |
|---|---|
| R10.QUOTA.SERVER-POS | PASS |
| R10.QUOTA.SERVER-QUICKSAVE-EXPENSE | PASS |
| R10.QUOTA.SERVER-QUICKSAVE-SALE | PASS |
| R10.QUOTA.SERVER-DISTINCT (P0001 sibling raise + R08 42501 ≠ quota) | PASS |
| R10.QUOTA.CLIENT-CLASSIFIES-QUOTA | PASS |
| R10.QUOTA.CLIENT-CLASSIFIES-NONQUOTA | PASS |
| R10.QUOTA.CLIENT-PRECHECK | PASS |
| R10.QUOTA.REGRESSION.SUCCESS-CLIENTKEY (success path, clientKey idempotency, no signal) | PASS |

**Unit contract tests** `src/lib/billing/__tests__/quotaContract.test.ts`: 5 specs —
PostgREST-shape positive, UsageLimitError positive, generic `P0001` negative,
integrity/RLS codes negative, network/unknown negatives. Message-text independence is
structural (the classifier never reads `message`).

**Full gate execution (post-implementation):**

| Gate | Result |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| Unit suite `npm run test` | **709/709 pass** (83 files; +5 contract specs over 704 baseline) |
| `npm run test:release:types` | OK |
| Vite build | OK |
| Release harness run 1 | **PASS 678 / FAIL 2 / BLOCKED 53 (733 total)** |
| Release harness run 2 | **PASS 678 / FAIL 2 / BLOCKED 53 (733 total)** — run-1 ≡ run-2 per-record outcomes |

Both runs: deterministic sequencing, identical per-record outcomes. The 2 FAILs are the
pre-existing R12 environmental FAILs (`EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`) —
unchanged, not hidden, not reclassified.

## 8. Preservation / diff (what changed vs pre-R10)

| File | Change |
|---|---|
| `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` | **NEW** — redefines `_ledgr_assert_usage_limit` only (errcode + detail/hint; body otherwise identical; grants untouched) |
| `src/lib/billing/quotaContract.ts` | **NEW** — contract mirror (const, `UsageLimitError`, `isQuotaDenial`) |
| `src/lib/billing/__tests__/quotaContract.test.ts` | **NEW** — 5 classifier specs |
| `src/lib/billing/UsageService.ts` | +1 import; message text unchanged; throw site unified to `UsageLimitError` |
| `src/offline/db.ts` | `QueueItem.lastErrorCode?: string \| null` (additive optional property; no schema/version change) |
| `src/offline/syncEngine.ts` | +1 import; two catch blocks write the discriminator; no sync behavior/ordering/retry changes |
| `tests/release/offline.test.ts` | +8 records + 2 helpers (`quotaMeta`, `seedUsageToLimit`, `quotaErrorOf`, `minimalExpensePayload`); no pre-existing record modified |

Nothing else. No stock, shift, till, financial-authority, quarantine, or posting changes.
No historical release records edited; the two pre-existing BLOCKED/cancel seals
(`SAME-USER.CONTRACT-RECEIPT`, `REGRESSION.REPLAY-CONTRACT`) remain untouched and BLOCKED.

## 9. R06 / R08 / R09.2 unchanged — explicit confirmation

- **R06 stock enforcement:** `chk_inventory_balances_on_hand_nonneg` untouched; no
  controlled-oversell mechanism added; `_ledgr_apply_stock_movement_balance` untouched;
  `InventoryRepository` idempotency unchanged. `23514` remains a *non-quota* classification
  (asserted negative in unit specs).
- **R08 shift/till:** 42501 own-shift steering, closed-shift delegation view, append-only
  `pos_shift_late_adjustments`, branch coalesce all untouched; R08 PACK results unchanged
  in both release runs.
- **R09.2 offline boundary baseline:** 670 PASS records all still PASS (delta is +8
  additive R10 records only); 2 FAIL identical; 53 BLOCKED identical; 725→733 total
  pricing; queue semantics, leases, quarantine, retry-counters, cache wipe records unchanged.
- **R09.3:** implementation **NOT** started; no retry/quarantine/surface policy decided by
  this change (the discriminator is evidence on the failed item only).

## 10. Remaining R09.3 blockers (unchanged by R10)

1. **P-D3-FINAL — REQUIRES DECISION** (unchanged): the signed selection among replay/
   quarantine/reconciliation models is still not present in-repo; R10 changes no queue
   behavior and deliberately stops at exposing the typed signal R09.3's models consume.
2. D-4 rider (run records once the two prerequisites land) remains open.
3. Audit finding (§1): invoice/payroll posting lacks a server-side usage assert;
   client look-ahead is typed but remains a look-ahead. Future additive decision only.

**STOP-list attestations:** no R09.3 implementation; no P-D3 selection; no offline stock
policy change; no oversell tolerance; no `_ledgr_apply_stock_movement_balance` edits; no
R08 shift/till edits; no DEC-08/09 changes; no actor-transfer authority; no new manager
mechanism; no quarantine-semantics change; no legacy branch-less residual closure; no
posting-authority changes; no second usage meter; historical release records untouched;
no report rewrites.

**Final gate classification: COMPLETE — P-D2 DELIVERED** (contract deterministic and
server-authoritative; declared once; boundary-consumable; RPC/PostgREST-surviving
machine-readably; additive to R06/R08; full dual-harness regression parity).
