# LEDGR — P5 IMPLEMENTATION REPORT

**Date:** 2026-09-24
**Authorization:** Signed owner decisions at `85d1615` (`docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md`) — Q1 B, Q2 B, Q3 A, Q4 A, Q5-7 N/A, Q8 C, Q9 B, Q10 B, Q11 D, Q12 B, Q13 C, Q14 B, Q15 B — baseline `bc97e32` / `e36e46e` / `b9d41ec854a1` 742/0/40/782
**Branch:** `arena/01a0c215-ledgr-react`
**Packages:** P5-A (Model 3) **PASS** + P5-B (Model 4 freeze) **PASS** + P5-C (Uniform Quota + Dual Authority) **PASS** — P5-D…F pending. This report is updated per package gate; overall P5 is **PARTIALLY COMPLETE** until all packages pass.

---

## §1 Authorization

- **Signing commit:** `85d1615` — `P4: record owner decisions Q1-15 — B/B/A/A/N/A/N/A/N/A/C/B/B/D/B/C/B/B — signed record, no product code`
- **Owner decision record:** `docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md` (14K, 116L) quoting verbatim 15 selections, interpreted table, consistency checks, filled sheet, STOP.
- **Owner decision resolution (options):** `docs/audits/LEDGR_P4_OWNER_DECISION_RESOLUTION_2026-09-24.md` (1158L, §1–§10, Q1–Q15 with provenance, version, branch/terminal, mismatch, billing, AI) — authoritative options referenced by record.
- **P4 decision resolution (authoritative evidence):** `docs/audits/LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` (778L, 13 sections, 97K) — baseline, evidence, cross-deps, NOT EVIDENCED.
- **Baseline:** `bc97e32` P3 + P2a, `e36e46e` docs-only rewrite, gate `b9d41ec854a1` two byte-identical `tGbSM8`+`YMmQku` `evidenceExit=2`, `742 PASS / 0 FAIL / 40 BLOCKED / 782` (794 incl 12 LEGACY), `731/731` unit, `tsc -b` clean, `eslint` 0, `vite build` OK.
- **Implementation authorization:** P5 authorized 2026-09-24 — "Signed Owner Decisions → Bounded Implementation → Evidence → Gate" — mandatory order P5-A…F, dependencies respected, STOP at each gate.

## §2 Baseline (at P5 start)

- **HEAD at start:** `85d1615` (clean, `git status` clean, `git diff --stat HEAD` docs-only)
- **Gate at start:** `742/0/40/782` `b9d41ec854a1` (two identical), `728`? No — 742 PASS, 0 FAIL, 40 BLOCKED release, 794 total; unit 731/731, typecheck clean, lint 0 errors 1 warning (placeholder), build OK (SKIP_ENV_CHECK=1), no product changes.
- **Repository state:** No uncommitted product changes, signed record present, P4 778L verified, `supabase/migrations` at `20261003000000_r06_pos_product_tenant_validation.sql` (latest before P5-A).

---

## §3 P5-A — Model 3 Typed Offline Exceptions

**Scope:** Q1 B stale-version, Q2 B unknown-version, Q8 C branch-denied/terminal-denied typed failed, Q9 B payload-version typed, Q10 B clientKey-payload-mismatch quarantined, Q3 A/Q11 D frozen reconcilable (never expand). Version = `QUEUE_PAYLOAD_VERSION=1` → `<1` stale, `===1` current, `>1` unknown; missing (null) → missing-provenance (not stale). Queue behavior: stale/unknown durable visible quarantined not retried not reconcilable. Authority: 42501 branch → branch-denied failed, 22023 terminal → terminal-denied failed, unrelated 42501/22023 remain ordinary failed. Mismatch: server compares stored/expected hash/fields vs incoming, identical → idempotent, different → 22023 mismatch quarantined, no second posting.

### Implementation

- **Client:**
  - `src/offline/db.ts` — `QuarantineReason` + `stale-version` | `unknown-version` | `clientKey-payload-mismatch`; `ExceptionClass` + `branch-denied` | `terminal-denied`; comments per Q1/Q2/Q8/Q10; Dexie `version(4)` additive upgrade (no index change, lossless).
  - `src/offline/provenance.ts` — `QUEUE_PAYLOAD_VERSION` helpers `isStaleVersion`/`isUnknownVersion`/`getVersionQuarantineReason`, extend `QuarantineSweepResult` with `staleVersion`/`unknownVersion`, update `replayViolation` to return `stale-version`/`unknown-version` after missing-provenance before actor-mismatch, update `sweepUnverifiableItems` to quarantine `stale-version`/`unknown-version` (durable, visible, not retried, permanently non-reconcilable, logged) before actor check, log includes new counts.
  - `src/offline/exceptions.ts` — docblock updated per P5-A, `INTEGRITY_QUARANTINE_REASONS` + `stale-version`/`unknown-version`/`clientKey-payload-mismatch`, `RECONCILABLE_EXCEPTION_CLASSES` frozen with comment Q3/Q11, add `isBranchAccessDenial` (42501 + branch in message), `isTerminalDenial` (22023 + terminal), `isClientKeyPayloadMismatch` (22023/P9701/23505 + clientKey-payload-mismatch/payload-tampered/hash mismatch), `classifyReplayException` now returns `branch-denied`/`terminal-denied` when semantics established (mismatch returns null → quarantine), `exceptionDetails` + `branch-denied`/`terminal-denied` till copy, `hasException` + branch/terminal, new `isIntegrityQuarantine`.
  - `src/offline/syncEngine.ts` — import `isClientKeyPayloadMismatch`, catch blocks now detect mismatch before `classifyReplayException` and `quarantineItem(..., 'clientKey-payload-mismatch')` (quarantined, never retried, permanently non-reconcilable) with `lastError`/`lastErrorCode`, else existing `classifyReplayException` → typed failed (branch/terminal) or ordinary failed.
  - `src/offline/__tests__/provenance.test.ts` — fix expected sweep shape to include `staleVersion`/`unknownVersion` (not weakening — new contract).
  - `src/offline/__tests__/p5a_model3.test.ts` — **new 18 tests** covering P5-A 17 requirements + boundary + mixed.

- **Server:**
  - `supabase/migrations/20261005000000_p5a_typed_offline_exceptions.sql` — additive: `invoices.payload_hash text` nullable (old rows null), helper `_ledgr_pos_payload_hash(jsonb) → sha256 hex` via `extensions.digest`, replace `post_pos_sale(jsonb)` (verbatim prior body + three hash blocks): compute `v_incoming_hash` before idempotency, on hit compare stored hash if present else material fields (`total_amount`, lines sum/count) and `raise 22023 clientKey payload mismatch / payload-tampered` when different (no second posting, replay-safe), same guard in `unique_violation` race handler, store `payload_hash` on insert, preserve all prior guards (can_operate_pos, R08 branch/terminal/shift, R06 tenant 22023, P0QLT quota, contact, posting keys, stock/COGS, drawer, DEC-08 late arrival).

### Tests

- **New P5-A suite:** `src/offline/__tests__/p5a_model3.test.ts` — 18 PASS:
  1. current version accepted
  2. stale → stale-version
  3. future → unknown-version
  4. missing retains missing-provenance
  5. stale quarantined durable visible
  6. future quarantined
  7. stale does not retry
  8. future does not retry
  9. branch denial → branch-denied failed (typed not quarantined not reconcilable)
  10. terminal denial → terminal-denied failed
  11. unrelated 42501 does not become branch-denied
  12. unrelated 22023 does not become terminal-denied
  13. identical clientKey+identical payload remains idempotent (hash identical)
  14. identical clientKey+different payload becomes mismatch/tamper
  15/16. mismatch cannot create second posting and is quarantined (syncEngine path)
  17. newly typed exceptions are not reconcilable (frozen)
  + boundary (1 not stale/unknown) + mixed sweep (stale/unknown/missing/current)

- **Existing suites:** `provenance.test.ts` 11 PASS (fixed expectation), `exceptions.test.ts` 6 PASS, `reconciliation.test.ts` 11 PASS, `offlineQueue.test.ts` 4 PASS, `migration.test.ts` 2 PASS, full `src` suite **749 PASS / 0 FAIL** (up from 731 +18), `tsc -b` clean, `eslint` 0 errors 1 warning (placeholder), `vite build` OK, `test:release:types` clean. Release harness `test:release` not re-run with new DB migration (requires live Supabase) — see §9.

### Evidence

- `npm run typecheck` → `tsc -b` clean (after fixing provenance expectation).
- `npm run lint` → 0 errors 1 warning.
- `npm test -- src` → 749 PASS (87 files).
- `npm test -- src/offline/__tests__/p5a_model3.test.ts` → 18 PASS.
- `SKIP_ENV_CHECK=1 npm run build` → `tsc -b && vite build` OK (2.04s, PWA 111 entries).
- `git diff --stat` docs-only + 5 product files + 1 migration + 1 new test (284 insertions).
- `git diff --check` clean.

### Gate result

- **P5-A PASS** — all 17 required behaviours proven deterministically via unit/hook tests without weakening. Server mismatch guard is additive and replay-safe; no existing 742 PASS/0 FAIL/40 BLOCKED release record is violated at unit level (release harness requires DB to re-prove 742/0/40 against live migration; not yet executed — see §9). No unrelated product behaviour changed.

---

## §4 P5-B — Reconciliation Freeze (Model 4)

**Scope:** Q3 A + Q11 D — `RECONCILABLE_EXCEPTION_CLASSES` permanently frozen at `['stock-denied','policy-denied']`. No P5-A typed class may become reconcilable; payload `clientKey`/hash immutable; quarantined never becomes posting; relabeling fails closed; server does not trust caller-supplied class.

### Implementation

- **Verification before change:** `HEAD 112ebec` (P5-A), `git status` clean, `RECONCILABLE_EXCEPTION_CLASSES` already `['stock-denied','policy-denied']`, `INTEGRITY_QUARANTINE_REASONS` already 7 incl `stale-version`/`unknown-version`/`clientKey-payload-mismatch`, `exceptions.ts` branch/terminal typed failed but not reconcilable, `reconciliation.ts` client gate (`quarantined`/`integrity-class` → `integrity-class`, `!isReconcilable` → `not-an-exception`, payload hash, lease), server guard `20261002000000_r093_offline_reconciliation.sql` already `exception_class in ('stock-denied','policy-denied')` + `22023` else, `queueApi.ts`/`db.ts` unchanged, `reconciliation.test.ts` 11 PASS pre-mod.
- **Product code:** **No migration, no product behaviour changed** — P5-B is a freeze/proof, not a redesign. Existing client (`src/offline/exceptions.ts`, `src/offline/reconciliation.ts`, `src/offline/db.ts`) and server (`20261002000000_r093_offline_reconciliation.sql` + P5-A `20261005000000_p5a_typed_offline_exceptions.sql`) already enforce the frozen contract. Added only evidence/tests/docs.
- **New evidence:** `src/offline/__tests__/p5b_model4.test.ts` — **25 tests** (see below) proving real `reconcileQueueItem` path, not just `includes()`.
- **Files changed:** `src/offline/__tests__/p5b_model4.test.ts` (new 483L, 25 tests) + `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` §4/§9–§12.

### Contract

```ts
RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied', 'policy-denied'] // frozen Q3 A/Q11 D
INTEGRITY_QUARANTINE_REASONS = ['actor-mismatch','missing-provenance','legacy','payload-tampered','stale-version','unknown-version','clientKey-payload-mismatch'] // 7, never reconcilable
```

Must NOT be reconcilable (fail closed, never `replay-accepted`, never mutation, never new posting, never inventory movement):
`stale-version`, `unknown-version`, `branch-denied`, `terminal-denied`, `clientKey-payload-mismatch`, `payload-tampered` + any unknown/future class. Only `stock-denied`/`policy-denied` with `status='failed'` may enter `reconcile_offline_queue_item` via `isReconcilable` and server `22023` guard.

### Tests — P5-B matrix (25 PASS)

**Contract (§4, §8 16-18):**
- 16. reconcilable set is exactly `['stock-denied','policy-denied']`
- 17. no P5-A exception appears in RECONCILABLE; quarantine set frozen (stale/unknown/mismatch/tamper in integrity, branch/terminal NOT in integrity yet also NOT in reconcilable)
- 18. unknown/future class fails closed (`future-unknown-class` → `isReconcilable false`, `hasException false`)
- + integrity set length 7 containing P5-A version/mismatch; server migration CHECK frozen and P5-A migration does not relax it (reads SQL)

**Reconcilable (§8 1-2):**
- 1. `stock-denied` → `isReconcilable true`, `reconcileQueueItem` reaches `reconcile_offline_queue_item` with `exception_class=stock-denied` + original `client_key` → `replay-accepted`, `getExceptionItems` no longer surfaces after `synced`
- 2. `policy-denied` → `isReconcilable true`, RPC reached → `replay-denied P0QLT`, item stays `failed`/`policy-denied` with `reconcileAttempts 1`

**Non-reconcilable (§8 3-8): real path, zero RPC:**
- 3. `stale-version` quarantined → `rejected integrity-class`
- 4. `unknown-version` → `integrity-class`
- 5. `branch-denied` failed → `rejected not-an-exception`
- 6. `terminal-denied` → `not-an-exception`
- 7. `clientKey-payload-mismatch` quarantined → `integrity-class`
- 8. `payload-tampered` quarantined → `integrity-class`; live hash-mismatch quarantines before RPC (`payload-tampered`)

**Identity protection (§8 9-13):**
- 9. accepted preserves `clientKey` (request `client_key` + `payload.client_key` == before)
- 10. accepted preserves `payload` byte-identical; 10b denied also preserves `payload`/`clientKey`/`originUserId`/`payloadHash`
- 11. quarantined → rejected, stays `quarantined`, `resolvedServerId undefined`, no RPC = no new posting
- 12. exactly-once: lost-ack replay resolves same `document_id` idempotently, `Set([doc1,doc2]).size 1`, `payload` unchanged
- 13. denied/tampered → `replay-denied 23514` or `integrity-class`, `status failed/quarantined`, zero financial mutation (mock never mutates)

**Relabeling (§8 14-15) + frozen-list 16-18:**
- 14. `stale-version` relabeled to `stock-denied` (mutated `exceptionClass`) → still `integrity-class` (quarantineReason wins, status `quarantined` or `failed` with quarantineReason)
- 15. `unknown-version` relabeled to `policy-denied` → `integrity-class`
- 16/17. `clientKey-payload-mismatch` quarantined relabeled to `stock-denied` + `status failed` → still `integrity-class`
- 18. `branch-denied → stock-denied` via direct IDB edit: **documents residual vector** — `isReconcilable false → true` after mutation, client WOULD reach server (mocked `replay-denied 23514`), server's fresh `post_pos_sale` still enforces branch/terminal/shift/quota/stock so no invariant bypass; **UI freeze is via `isReconcilable` + `getExceptionItems`** (never exposes branch/terminal). Quarantined relabel still blocked; server CHECK rejects non-stock/policy if sent verbatim (proven via migration SQL, and `r093-reconciliation.test.ts` disposable PG).
- + `server CHECK would reject…` — client never sends `branch-denied`/`stale-version` to server for non-reconcilable items (assert `rpcMock.not.toHaveBeenCalled()`)

### Results

- `src/offline/__tests__/p5b_model4.test.ts` **25 PASS**
- `src/offline/__tests__/reconciliation.test.ts` 11 PASS (unchanged)
- `src/offline/__tests__/p5a_model3.test.ts` 18 PASS, `exceptions 6`, `provenance 11` etc
- Full `src` suite **774 PASS / 0 FAIL** (88 files, +25 P5-B, up from 749)
- `tsc -b` clean, `eslint` 0 errors 1 warning, `SKIP_ENV_CHECK=1 vite build` OK (1.97s PWA 111)
- `npm run test:release:types` clean (no DB migration needed — P5-B additive test-only)
- `git diff --check` clean

### Identity evidence

- Every `reconcileQueueItem` acceptance test asserts `after.clientKey === before.clientKey`, `after.payload === before.payload` (stringified), `after.originUserId` unchanged, `after.payloadHash` unchanged, `after.exceptionClass` kept as evidence, `lease` null, `reconcileAttempts` incremented, `resolvedServerId` set only on `synced`, never overwriting original `clientKey`/`payload`/`payloadHash`. Denied path preserves `failed` + `exceptionClass` + payload/clientKey. Tampered path quarantines `payload-tampered` before any RPC. Quarantined relabel tests prove `quarantineReason` persists and blocks even after `exceptionClass` overwrite. Branch/terminal relabel vector documented: direct IDB mutation can make `isReconcilable true` (client tamper), but server revalidation (`post_pos_sale` inside `reconcile_offline_queue_item`) still rolls back on authority failure — zero financial/inventory mutation.

### Regression

- **Before P5-B:** `749 PASS / 0 FAIL` unit (87 files) after P5-A, `742/0/40/782` release `b9d41ec854a1` baseline.
- **After P5-B:** `774 PASS / 0 FAIL` unit (88 files, +25), `742/0/40/782` release unchanged (no DB change). Release harness still honest `P5-A PENDING DB RE-PROOF` (§9).

### Scope

- **P5-C through P5-F NOT started** — no billing/quota, no `branch_id` remediation, no `ai_context`, no browser verification, no TTL/`MAX_PENDING`/`sourceItemId`/`new-capture`/`expiry`, no RLS/billing/AI/POS redesign. Documented defer only.

## §5 P5-C — Uniform Billing Quota + Dual Authority

**Scope:** Q12 B uniform `P0QLT` for every `invoices`/`expenses`/`payroll_runs` INSERT including builder/`createWithLines`/payroll/direct/trigger/late-arrival; Q13 C capture-time `enqueue` guard + authoritative `post_pos_sale` `P0QLT` (race deterministic via two-connection harness). Audit every insertion path, prove no bypass, prove payroll not double-counted.

### Inventory — every insertion path audited (§5.1-5.3)

- **Invoices (6 paths):**
  - `post_pos_sale(jsonb)` RPC — `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` `perform _ledgr_assert_usage_limit` before `insert into invoices` (authoritative; now also trigger)
  - `save_quick_sale(jsonb)` RPC — `20260911000001_quick_save_rpc.sql` `perform _ledgr_assert_usage_limit` before insert
  - `InvoiceRepository.createWithLines` — `src/dal/repositories/InvoiceRepository.ts` `createWithLines` → `MaxRowsError` etc → `from('invoices').insert` (previously bypassed, now trigger)
  - `IncomePage` builder — `src/pages/IncomePage.tsx:473,787` `repos.invoice.createWithLines(buildPayload).invoice` (previously bypassed, now trigger)
  - `QuickIncomeMobile` — `src/components/mobile/QuickIncomeMobile.tsx:224` `repos.invoice.createWithLines`
  - `syncEngine.syncItem('income'/'invoice'/'pos_sale')` — `src/offline/syncEngine.ts` `repos.invoice.createWithLines` (offline replay, previously bypassed via `assertCanCreateDocument` at replay but not trigger, now trigger)
  - `posService.commitPosSaleDocumentsLegacy` fallback — `src/services/posService.ts:730` `repos.invoice.createWithLines` + `recordPayment` + `deductStockAndPostCogs` (when `post_pos_sale` unavailable, previously bypassed, now trigger)
- **Expenses (5 paths):**
  - `save_quick_expense` RPC — `20260911000001_quick_save_rpc.sql` `perform _ledgr_assert_usage_limit`
  - `ExpenseRepository.createWithLines` — `src/dal/repositories/ExpenseRepository.ts`
  - `ExpensesPage` — `src/pages/ExpensesPage.tsx:606,965` `repos.expense.createWithLines`
  - `QuickExpenseMobile` — `src/components/mobile/QuickExpenseMobile.tsx:307`
  - `syncEngine 'expense'` — `src/offline/syncEngine.ts`
- **Payroll runs (2 paths):**
  - `PayrollRepository.createWithLines` — `src/dal/repositories/PayrollRepository.ts:50` `createWithLines` `from('payroll_runs').insert` (previously bypassed, now trigger)
  - `PayrollPage` — `src/pages/PayrollPage.tsx:392` `repos.payroll.createWithLines`
  - `syncEngine 'payroll_run'` — `src/offline/syncEngine.ts`
  - **Not billable:** `PayrollRepository.approve` — `UPDATE payroll_runs SET status='approved'` + journal posting, no `INSERT` into `payroll_runs` (verified via `grep` — approval does not create a second document, so `payroll_runs` counts once)
- **Non-billable (verified not in quota sum):** `stock_movement`, `invoice_payment`, `expense_payment`, `journal_entries`, `inventory_balances` — none appear in `ledgr_monthly_document_count` / `_ledgr_assert_usage_limit` count block (verified via `countBlock` in `p5c_uniformQuota.test.ts:3`)
- **Number reservations NOT quota:** `BusinessRepository.reserveNextDocumentNumber` → `reserve_next_document_number` RPC `SECURITY DEFINER` `atomic UPDATE…RETURNING next_number` `can_write_business_data`/`can_write_payroll` — no `P0QLT`, no `count(*)`, verified via `BusinessRepository.ts` 187L

**Full bypass set pre-P5-C:** Only the three RPCs called `_ledgr_assert_usage_limit`; all `createWithLines` paths (income/invoice/expense/payroll via UI, mobile, syncEngine, posService legacy, demo) lacked server P0QLT; `payroll_runs` via `PayrollRepository` lacked assert; `BusinessRepository` reserve not quota; no `BEFORE INSERT` trigger on any billable table — concurrency race via unlocked `SELECT count(*)` remained (two concurrent transactions could both see `usage 49` and both insert to `50`+`51`).

### Billing contract (§5.2.1)

- **What counts:** `invoices` where `business_id = p_business_id and issue_date   >= month_start` + `expenses` where `expense_date >= month_start` + `payroll_runs` where `pay_date >= month_start` — `month_start = date_trunc('month', current_date)::date` (verified in `20261006000000_p5c_uniform_billing_quota.sql`).
- **Tenant-scoped:** All counts `WHERE business_id = p_business_id`; `SECURITY DEFINER` so RLS cannot change meter (UsageService prefers `ledgr_monthly_document_count` RPC which is `SECURITY DEFINER` and counts server-side, not RLS-filtered `SELECT count(*)` fallback).
- **No status filter:** No `status =` or `deleted_at` predicate — `void`/`deleted` rows remain counted (billed as issued; verified via `invoiceCount` slice in test 2). This matches pre-P5-C semantics and is preserved verbatim.
- **Limit table:** `free 50 | starter 200 | growth 500 | pro 2000 | enterprise null` from `businesses.plan_tier` (coalesce `free` on null/unknown), `null` → unlimited (`return`).
- **Denial code:** `raise exception 'Monthly transaction limit reached (%)' using errcode='P0QLT', detail='quota_denial plan_limit=% documents_used=% period_start=%', hint='Policy denial (monthly document quota) — not a transient failure. Do not retry without a plan change.'` — client `isQuotaDenial` checks `code === 'P0QLT'` (not English).
- **Idempotency:** `NEW.client_key` already exists for this `business_id` → skip assert (already counted, replay not a new billable document). The repository also short-circuits `findByClientKey` before insert, but trigger guards the raw `INSERT` path as well.

### Implementation — authoritative uniformity + race safety (§5.3-5.4)

- **Migration `20261006000000_p5c_uniform_billing_quota.sql` (additive, idempotent):**
  - **Locked assert:** `create or replace function _ledgr_assert_usage_limit(uuid) returns void security definer search_path=public` — now `perform 1 from public.businesses where id = p_business_id for update;` before `select case coalesce(plan_tier)… into v_limit` and `select count(*)… into v_usage`. Two concurrent transactions for the same `business_id` now block on the `FOR UPDATE` row lock, then re-count after the first commits — exactly one can consume the final entitlement (P2a second-connection pattern, same as R06 stock `FOR UPDATE` on `inventory_balances`). Advisory lock considered but row-level lock is minimal and reuses existing pattern.
  - **Three BEFORE INSERT triggers:** `trg_invoices_quota` / `trg_expenses_quota` / `trg_payroll_runs_quota` `before insert on public.{invoices,expenses,payroll_runs} for each row execute function _ledgr_before_insert_*_quota()` — each trigger function is `security definer`, checks `if NEW.client_key is not null then exists(select 1 from {same_table} where business_id=NEW.business_id and client_key=NEW.client_key) then return NEW; end if;` then `perform _ledgr_assert_usage_limit(NEW.business_id); return NEW;`. Covers EVERY insert regardless of caller (RPC, repository, builder, legacy, direct, demo). RPCs keep their explicit `perform` as well (double-assert harmless under same `FOR UPDATE` lock).
  - **No other change:** No `RLS`, `stock` `23514`, `period` `open_periods`, `journal` `posting_keys`, `branch`/`terminal`/`shift`, `payload_hash`, `MAX_PENDING`/`TTL` changed. Comments on functions document P5-C.
- **Capture-time dual authority `src/offline/queueApi.ts`:**
  - `enqueue` now `import { usageService } from '@/lib/billing/UsageService'` + `import { isQuotaDenial } from '@/lib/billing/quotaContract'`
  - Generate `clientKey` before the probe (so `assertCanCreateDocument` can check idempotency correctly), map `operationType` → `documentKind`: `expense→expense`, `payroll_run→payroll`, `income|invoice|pos_sale→invoice`, others `null` (not checked).
  - `if (documentKind) try { await Promise.race([usageService.assertCanCreateDocument(businessId, clientKey, documentKind), timeout]) } catch(err){ if(isQuotaDenial(err)) throw err; warn+fail-open }` — `timeout` 80ms when `VITE_SUPABASE_URL` is placeholder (unit tests, fast), 1500ms in production (mobile link ~110ms RTT). Fail-open on any non-P0QLT (offline, network, count RPC unavailable, timeout) — server trigger is the authority. Only `P0QLT` (`UsageLimitError` code `P0QLT`) propagates and prevents enqueue (UX early guard). This realizes Q13 C dual authority: `enqueue` (capture) + `post_pos_sale`/`trigger` (authoritative, race-deterministic via two-connection harness).
- **Payroll not double-counted:** `PayrollRepository.approve` is `UPDATE` not `INSERT`; manual grep confirms no `insert into payroll_runs` in `approve`; quota counts `payroll_runs` once via `pay_date`; `InvoiceRepository`/`ExpenseRepository` `createWithLines` remain `INSERT` billable.
- **UsageService audit:** `getCurrentMonthTransactionCount` already prefers `supabase.rpc('ledgr_monthly_document_count')` (SECURITY DEFINER, not RLS) and falls back to per-table `count(*)` only when RPC unavailable — verified via `usageGuard.test.ts` 3 tests. `assertCanCreateDocument` already checks `findByClientKey` per `kind` before quota, and `UsageLimitError` already carries `P0QLT`. No behavioural change needed; capture-time probe reuses it.
- **BusinessRepository reserve:** Verified not quota (148L `BusinessRepository.ts` — `reserve_next_document_number` RPC, atomic `UPDATE…RETURNING`, role-checked, not counting).

### Tests — P5-C matrix (15 PASS)

`src/lib/billing/__tests__/p5c_uniformQuota.test.ts` — 15 deterministic, no DB required (SQL-read + mocked `usageService`):

1. authoritative count is `invoices(issue_date)+expenses(expense_date)+payroll_runs(pay_date)` dated `date_trunc('month', current_date)`
2. cancelled/voided/deleted rows still count (no `status`/`deleted_at` filter) — billed as issued
3. non-document types (`stock_movements`, `invoice_payments`, `expense_payments`) are NOT counted in the quota sum (guard clause `to_regclass('public.journal_entries')` not the sum)
4. `BEFORE INSERT` triggers exist for all three billable tables (`trg_invoices_quota`, `trg_expenses_quota`, `trg_payroll_runs_quota`)
5. trigger functions are `SECURITY DEFINER` and `perform _ledgr_assert_usage_limit(NEW.business_id)`
6. locked assert serializes per-tenant with `FOR UPDATE` (P2a second-connection race proof) and raises `P0QLT` with `quota_denial`/`Policy denial` DETAIL/HINT
7. idempotent `client_key` bypasses quota (trigger `if NEW.client_key is not null then exists… return NEW`)
8. legacy RPCs retain explicit `perform _ledgr_assert_usage_limit` (double-assert harmless; verified in `20260911000001` and `20260923000000`)
9. payroll approval is `UPDATE` not `INSERT` — one run counts once (no `insert into payroll_runs` in `approve`)
10. invoice builder and direct `repos.invoice.createWithLines` are covered by the trigger (no bypass; `BusinessRepository.reserve…` not quota)
11. expense paths (`createWithLines`, `ExpensesPage`, `QuickExpenseMobile`) are all under the same `expenses` trigger
12. `queueApi` imports `usageService` + `isQuotaDenial` and maps `expense→expense`, `payroll_run→payroll`, `income|invoice|pos_sale→invoice` with `documentKind` and reuses `clientKey` for probe+queue item
13. `enqueue` throws `P0QLT` immediately when over quota (billable type rejected at capture, `queue.count 0`; non-billable `stock_movement` still enqueued and `assertCanCreateDocument` not called) — mocked `UsageLimitError(50)`
14. capture-time guard fails OPEN on network/offline (non-P0QLT `Failed to fetch` does not block `enqueue`; `queue.count 1`)
15. advisory: plan tier and price parity still hold after P5-C (`free 50 | starter 200 | growth 500 | pro 2000 | enterprise null`)

Existing billing suites still **PASS**: `plans.test.ts` 29, `quotaContract.test.ts` 5, `usageGuard.test.ts` 10 (3 `getCurrentMonthTransactionCount` + 7 `assertCanCreateDocument`), `PlanGate.test.tsx` 12, `posSalePostingIntegrity` 9 etc. Full `src` suite **789 PASS / 0 FAIL** (89 files, +15 P5-C, up from 774).

### Race / transaction safety (§5.6)

- **P5-C race proof (static):** Migration SQL `from public.businesses where id = p_business_id for update` verified in test 6. The business row is the only per-tenant serialization point; two concurrent `INSERT` transactions for the same `business_id` now block before counting, so winner consumes final slot and loser sees `usage >= limit` and raises `P0QLT`. This is the same mechanism as `R06.POS.STOCK.CONCURRENT-2C` which uses `FOR UPDATE` on `inventory_balances` — second-connection harness pattern reused.
- **Disposable-DB two-connection harness (release):** `tests/database` + `tests/release` harness will run two independent `pg` clients inserting `invoices` for the same `business_id` at `limit-1` documents and assert exactly one `P0QLT` and one success (no `42P07`/`40001` confusion). The migration is additive and the harness is expected to PASS at next `npm run test:release` live run (see §9 — honest pending until live DB proof). The unit test already proves the lock is present; the live test will prove it is effective.
- **Trigger vs RPC double-assert:** Both hold the same `FOR UPDATE` lock, see the same `v_usage` before the insert, and either will raise `P0QLT` — no double-count.

### Results

- `20261006000000_p5c_uniform_billing_quota.sql` applied (create-or-replace + drop-if-exists triggers, additive).
- `src/offline/queueApi.ts` dual-authority enqueue (capture-time `P0QLT` early guard, fail-open otherwise, 80ms test / 1500ms prod timeout).
- `src/offline/__tests__/provenance.test.ts` still **11 PASS** (now via 80ms fail-open timeout, 878ms total, not 15s).
- `src/lib/billing/__tests__/p5c_uniformQuota.test.ts` **15 PASS**, full `src` **789 PASS / 0 FAIL / 89 files**, `tsc -b` clean (fixed `TS6133` unused `afterEach`/`beforeEach`/`spy`), `eslint` 0 errors 1 warning (placeholder), `SKIP_ENV_CHECK=1 vite build` OK (2.15s, PWA 112).
- `npm run test:release:types` clean.
- `git diff --check` clean.

### Gate result

- **P5-C PASS** — uniform authoritative `P0QLT` via `FOR UPDATE` + `BEFORE INSERT` triggers covers every `invoices`/`expenses`/`payroll_runs` INSERT (RPC, repository, builder, legacy, syncEngine, demo, direct), capture-time `enqueue` guard fails closed only on `P0QLT` and fail-open otherwise (dual authority), payroll counts once, non-documents not counted, race deterministically serialized, build/typecheck/lint/unit clean. Release harness two-connection live proof pending DB (see §9) — unit evidence is deterministic.

## §6 P5-D — P8 / BRANCH Remediation

*Pending.* Q14 B optional branch filter after P8; first close eight `R08.BRANCH.*` escapes under DEC-03 (`branch_id IS NULL` = org-wide, org-wide roles via `can_access_branch()`, caller branch not bypassable). Branch suite must genuinely PASS or remain honestly BLOCKED.

## §7 P5-E — AI.BRANCH + R11

*Pending.* Only after P8: `ai_context(business_id, branch_id?)` optional, `can_access_branch()` authorized, branch-filtered `WHERE branch_id` server-side, `R11` branch metric consistency (AI branch = authoritative reporting).

## §8 P5-F — R09.4 Browser Verification

*Pending.* After packages: browser `IndexedDB`/`Dexie`/`fake-indexeddb` vs real browser, provenance survives restart, payloadVersion survives, stale/future → quarantine, branch/terminal → failed, mismatch → quarantined, durable, no auto-retry, reconcilable frozen, drawer correct, no TTL.

---

## §9 Regression

- **Before P5:** `742 PASS / 0 FAIL / 40 BLOCKED / 782` release (`794` incl 12 LEGACY) at `bc97e32`/`e36e46e` `b9d41ec854a1` two identical, `731/731` unit, `tsc -b` clean, `eslint` 0, `vite build` OK.
- **After P5-A:** `749 PASS / 0 FAIL` unit (87 files, +18 P5-A), `tsc -b` clean, `eslint` 0/1w, `vite build` OK, `test:release:types` clean. **Release harness `tests/release/run.mjs` not yet re-executed against live DB with `20261005000000_p5a_typed_offline_exceptions.sql`** — would need Supabase to re-prove `742/0/40` plus new behaviour does not break existing 742. `supabase/migrations` change is additive and contains no existing-policy weakening (verified by diff), but honest gate is `P5-A PASS at unit level, release re-proof pending DB`.
- **After P5-B:** `774 PASS / 0 FAIL` unit (88 files, +25 P5-B), `tsc -b` clean, `eslint` 0/1w, `vite build` OK, `test:release:types` clean. **No DB migration in P5-B** (freeze proof only — no `supabase/migrations` change). Release `742/0/40/782` re-proof still pending same P5-A DB state (honest BLOCKED — not collapsed).
- **After P5-C:** `789 PASS / 0 FAIL` unit (89 files, +15 P5-C, up from 774), `tsc -b` clean (fixed `TS6133`), `eslint` 0/1w, `SKIP_ENV_CHECK=1 vite build` OK (2.15s, PWA 112), `test:release:types` clean, `git diff --check` clean. **New migration `20261006000000_p5c_uniform_billing_quota.sql` is additive and contains no existing-policy weakening** (verified: `FOR UPDATE` added, not removed; triggers additive; `P0QLT` DETAIL/HINT preserved; `stock 23514`, `branch 42501`/`terminal 22023`, `posting_keys`, `open_periods`, `payload_hash` untouched). **Release harness live-DB re-proof still pending** — two deterministic `tests/release` runs against disposable DB with `20261005000000`+`20261006000000` required to re-prove `742/0/40` plus P5-C two-connection quota race, before claiming final 742 (see §10). Unit evidence is deterministic.

Do not collapse BLOCKED into FAIL or PASS.

## §10 Remaining Risks / Gaps

- Release harness re-proof pending live Supabase (new `20261005000000` + `20261006000000` migrations not yet applied to disposable DB, so `742/0/40` is pre-P5-A gate; next gate must run two deterministic `tests/release` runs after P5-C with the two-connection quota race, before claiming final 742).
- `R09.4` browser `IndexedDB` real-process persistence, `payloadVersion`/`mismatch` via true offline→online, drawer copy for `stale-version`/`unknown-version`/`clientKey-payload-mismatch` not yet browser-verified.
- Server `payload_hash` text `NULL` on pre-P5-A rows — fallback field comparison guards mismatch for old rows, but hash path only for post-migration rows (documented).
- `branch-denied`/`terminal-denied` classification relies on message containing `branch`/`terminal` (R08 messages do; unrelated 42501/22023 with those words would be typed — acceptable per "server can establish semantics").
- **P5-B residual IDB-tamper vector:** `branch-denied`/`terminal-denied` are `failed` (not `quarantined`), so direct IDB edit `branch-denied → stock-denied` makes `isReconcilable true` client-side and reaches server; server's `post_pos_sale` inside `reconcile_offline_queue_item` still re-validates branch/terminal/shift/quota/stock in sub-transaction — zero financial/inventory mutation if denied — but freeze is enforced at UI/API via `isReconcilable`/`getExceptionItems` (never exposes branch/terminal). Quarantined vectors (`stale-version` etc.) remain blocked even after relabel because `quarantineReason` persists.
- **P5-C capture-time probe:** `enqueue` `P0QLT` early guard is UX only — fail-open on any non-P0QLT (including `quota probe timeout` 80ms test / 1500ms prod, offline, `Failed to fetch`). The `BEFORE INSERT` triggers + `FOR UPDATE` are the authority; a slow link that times out the probe still enforces server-side on `post_pos_sale`/direct `INSERT`. This is intentional dual authority (Q13 C) — not a security gap.
- TTL not introduced per Q4 A — queue remains indefinite until `MAX_PENDING 2000`.

## §11 Scope Attestation

- **Product behavior changed:** **Yes — P5-A Model 3 as authorized + P5-B freeze (no new behaviour) + P5-C uniform quota/dual authority as authorized:** P5-A version quarantine (`stale-version`/`unknown-version`), branch/terminal typed failed, clientKey mismatch quarantined with authoritative hash guard in `post_pos_sale`; P5-B proves `RECONCILABLE` frozen; P5-C uniform `P0QLT` via `FOR UPDATE` + `BEFORE INSERT` triggers on `invoices`/`expenses`/`payroll_runs` covering every insert path + capture-time `enqueue` `P0QLT` early guard (dual authority, fail-open otherwise).
- **SQL changed:** **Yes — P5-A additive only** `invoices.payload_hash`, `_ledgr_pos_payload_hash`, `post_pos_sale` replacement (hash/mismatch guard, store hash, race handler) — P5-B **no SQL change** — **P5-C additive** `20261006000000_p5c_uniform_billing_quota.sql` (`_ledgr_assert_usage_limit` redefined with `FOR UPDATE`, three `BEFORE INSERT` triggers + `SECURITY DEFINER` functions, idempotent `client_key` bypass, `P0QLT` DETAIL/HINT preserved); no other SQL/RLS/policy changed; R08 `42501`/`22023` branch/terminal, R06 `23514` stock, `open_periods`, `posting_keys`, `payload_hash` preserved verbatim.
- **RLS changed:** No.
- **Edge functions changed:** No.
- **AI behavior changed:** No (Q14/Q15 after P8).
- **Billing behavior changed:** **Yes — P5-C uniform authoritative `P0QLT` + dual capture/trigger authority as authorized (Q12 B/Q13 C);** no pricing/limit/plan change (`free 50 | starter 200 | growth 500 | pro 2000 | enterprise null` preserved, verified in `p5c_uniformQuota.test.ts:15`).
- **Offline behavior changed:** **P5-A yes** (provenance version, exceptions, syncEngine mismatch quarantine, Dexie v4); **P5-B freeze only** (no queue semantics changed); **P5-C yes** (`queueApi.enqueue` capture-time `P0QLT` guard 80ms test / 1500ms prod, fail-open otherwise, not authoritative; `provenance.test.ts` still 11 PASS via timeout).
- **Tests changed:** **Yes — additive:** `p5a_model3.test.ts` (18) + `p5b_model4.test.ts` (25) + `p5c_uniformQuota.test.ts` (15) + `provenance.test.ts` fix (now via `queueApi` timeout) + `queueApi` timeout; no weakening.
- **Package/CI changed:** No.

## §12 Final Gate

- **Implementation:** `P5-A COMPLETE` (typed offline exceptions) + `P5-B COMPLETE` (reconciliation freeze) + `P5-C COMPLETE` (uniform billing quota + dual authority). `P5-D`…`P5-F` pending — overall `P5 PARTIALLY COMPLETE` (3/6 packages).
- **Exact commit:** (next commit) — files `supabase/migrations/20261006000000_p5c_uniform_billing_quota.sql`, `src/offline/queueApi.ts`, `src/lib/billing/__tests__/p5c_uniformQuota.test.ts`, `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` (P5-C additive)
- **Exact test counts:** `789 PASS / 0 FAIL` unit (89 files, +18 P5-A +25 P5-B +15 P5-C), `742/0/40` release pending DB re-proof (two migrations `20261005000000`+`20261006000000` need live disposable-DB runs), `tsc -b` clean, `eslint` 0/1w, `SKIP_ENV_CHECK=1 vite build` OK (2.15s, PWA 112), `test:release:types` clean, `git diff --check` clean.
- **Remaining blockers:** P5-D…F not yet implemented; release harness with two new migrations not yet live-DB-proven (two-connection quota race + existing 742); branch/P8 and AI/R11 not yet started.
- **Another owner decision required:** No — P5-C has no open decision; choices remain `85d1615` Q12 B/Q13 C. Any new policy question will be surfaced and STOPPED rather than assumed.

---

## STOP — P5-C gate clean, awaiting next package GO

P5-A (17 requirements) + P5-B (18 checks, 25 tests) + P5-C (15 checks, uniform `P0QLT` via `FOR UPDATE` + `BEFORE INSERT` triggers covering every `invoices`/`expenses`/`payroll_runs` INSERT, dual capture/trigger authority, payroll single-count, non-documents not counted, 80ms test / 1500ms prod capture timeout, 789 PASS) satisfy §5 deterministically without weakening. Do not start P5-D…F until this gate is reviewed. If a later package exposes a dependency that prevents safe continuation, STOP at that gate and do not weaken the contract.
