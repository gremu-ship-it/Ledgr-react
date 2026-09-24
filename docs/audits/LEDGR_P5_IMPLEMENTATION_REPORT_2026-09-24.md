# LEDGR — P5 IMPLEMENTATION REPORT

**Date:** 2026-09-24
**Authorization:** Signed owner decisions at `85d1615` (`docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md`) — Q1 B, Q2 B, Q3 A, Q4 A, Q5-7 N/A, Q8 C, Q9 B, Q10 B, Q11 D, Q12 B, Q13 C, Q14 B, Q15 B — baseline `bc97e32` / `e36e46e` / `b9d41ec854a1` 742/0/40/782
**Branch:** `arena/01a0c215-ledgr-react`
**Packages:** P5-A (Model 3) **PASS** + P5-B (Model 4 freeze) **PASS** — P5-C…F pending. This report is updated per package gate; overall P5 is **PARTIALLY COMPLETE** until all packages pass.

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

*Pending.* Q12 B uniform `P0QLT` for every `invoices`/`expenses`/`payroll_runs` INSERT including builder/`createWithLines`/payroll/direct/trigger; Q13 C capture-time `enqueue` guard + authoritative `post_pos_sale` `P0QLT` (race deterministic via two-connection harness). Audit every insertion path.

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

Do not collapse BLOCKED into FAIL or PASS.

## §10 Remaining Risks / Gaps

- Release harness re-proof pending live Supabase (new `20261005000000` migration not yet applied to disposable DB, so `742/0/40` is pre-P5-A gate; next gate must run two deterministic `tests/release` runs after P5-C or before claiming final 742).
- `R09.4` browser `IndexedDB` real-process persistence, `payloadVersion`/`mismatch` via true offline→online, drawer copy for `stale-version`/`unknown-version`/`clientKey-payload-mismatch` not yet browser-verified.
- Server `payload_hash` text `NULL` on pre-P5-A rows — fallback field comparison guards mismatch for old rows, but hash path only for post-migration rows (documented).
- `branch-denied`/`terminal-denied` classification relies on message containing `branch`/`terminal` (R08 messages do; unrelated 42501/22023 with those words would be typed — acceptable per "server can establish semantics").
- **P5-B residual IDB-tamper vector:** `branch-denied`/`terminal-denied` are `failed` (not `quarantined`), so direct IDB edit `branch-denied → stock-denied` makes `isReconcilable true` client-side and reaches server; server's `post_pos_sale` inside `reconcile_offline_queue_item` still re-validates branch/terminal/shift/quota/stock in sub-transaction — zero financial/inventory mutation if denied — but freeze is enforced at UI/API via `isReconcilable`/`getExceptionItems` (never exposes branch/terminal). Quarantined vectors (`stale-version` etc.) remain blocked even after relabel because `quarantineReason` persists.
- TTL not introduced per Q4 A — queue remains indefinite until `MAX_PENDING 2000`.

## §11 Scope Attestation

- **Product behavior changed:** **Yes — P5-A Model 3 as authorized + P5-B freeze (no new behaviour):** P5-A version quarantine (`stale-version`/`unknown-version`), branch/terminal typed failed, clientKey mismatch quarantined with authoritative hash guard in `post_pos_sale`; P5-B proves `RECONCILABLE` frozen, no product code changed.
- **SQL changed:** **Yes — P5-A additive only** `invoices.payload_hash`, `_ledgr_pos_payload_hash`, `post_pos_sale` replacement (hash/mismatch guard, store hash, race handler) — P5-B **no SQL change**; no other SQL/RLS/policy changed; R08/R06/P0QLT logic preserved verbatim.
- **RLS changed:** No.
- **Edge functions changed:** No.
- **AI behavior changed:** No (Q14/Q15 after P8).
- **Billing behavior changed:** No (P5-C pending).
- **Offline behavior changed:** **P5-A yes** (provenance version, exceptions, syncEngine mismatch quarantine, Dexie v4); **P5-B freeze only** (no queue semantics changed).
- **Tests changed:** **Yes — additive:** `p5a_model3.test.ts` (18) + `p5b_model4.test.ts` (25) + `provenance.test.ts` fix; no weakening.
- **Package/CI changed:** No.

## §12 Final Gate

- **Implementation:** `P5-A COMPLETE` (typed offline exceptions) + `P5-B COMPLETE` (reconciliation freeze). `P5-C`…`P5-F` pending — overall `P5 PARTIALLY COMPLETE` (2/6 packages).
- **Exact commit:** (next commit) — files `src/offline/__tests__/p5b_model4.test.ts`, `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md` (P5-B additive)
- **Exact test counts:** `774 PASS / 0 FAIL` unit (88 files, +18 P5-A +25 P5-B), `742/0/40` release pending DB re-proof, `tsc -b` clean, `eslint` 0/1w, `vite build` OK.
- **Remaining blockers:** P5-C…F not yet implemented; release harness with new migration not yet live-DB-proven; branch/P8 and AI/R11 not yet started.
- **Another owner decision required:** No — P5-B has no open decision; choices remain `85d1615` Q3 A/Q11 D. Any new policy question will be surfaced and STOPPED rather than assumed.

---

## STOP — P5-B gate clean, awaiting next package GO

P5-A (17 requirements) + P5-B (18 checks, 25 tests) satisfy frozen `RECONCILABLE=['stock-denied','policy-denied']` deterministically without weakening. Non-reconcilable P5-A classes fail closed on real `reconcileQueueItem` path, identity preserved, relabeling fails closed (quarantined vectors) or is server-revalidated (branch/terminal tamper docs). Do not start P5-C…F until this gate is reviewed. If a later package exposes a dependency that prevents safe continuation, STOP at that gate and do not weaken the contract.
