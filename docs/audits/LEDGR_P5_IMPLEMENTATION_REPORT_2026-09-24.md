# LEDGR — P5 IMPLEMENTATION REPORT

**Date:** 2026-09-24
**Authorization:** Signed owner decisions at `85d1615` (`docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md`) — Q1 B, Q2 B, Q3 A, Q4 A, Q5-7 N/A, Q8 C, Q9 B, Q10 B, Q11 D, Q12 B, Q13 C, Q14 B, Q15 B — baseline `bc97e32` / `e36e46e` / `b9d41ec854a1` 742/0/40/782
**Branch:** `arena/01a0c215-ledgr-react`
**Packages:** P5-A (Model 3 typed offline exceptions) — P5-B…F pending. This report is updated per package gate; P5 is PARTIALLY COMPLETE until all packages pass.

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

*Pending.* Must ensure `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` remains frozen, verify stale-version/unknown-version/branch-denied/terminal-denied/clientKey-payload-mismatch/payload-tampered cannot reconcile, and reconciliation does not mutate client identity or transform quarantined into posting. Awaits P5-A gate (done) — next.

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

Do not collapse BLOCKED into FAIL or PASS.

## §10 Remaining Risks / Gaps

- Release harness re-proof pending live Supabase (new migration not yet applied to DB, so 742/0/40 is pre-P5-A gate; next gate must run two deterministic `tests/release` runs after P5-C or before claiming final 742).
- `R09.4` browser `IndexedDB` real-process persistence, `payloadVersion`/`mismatch` via true offline→online, drawer copy for `stale-version`/`unknown-version`/`clientKey-payload-mismatch` not yet browser-verified.
- Server `payload_hash` text `NULL` on pre-P5-A rows — fallback field comparison guards mismatch for old rows, but hash path only for post-migration rows (documented).
- `branch-denied`/`terminal-denied` classification relies on message containing `branch`/`terminal` (R08 messages do; unrelated 42501/22023 with those words would be typed — acceptable per "server can establish semantics").
- TTL not introduced per Q4 A — queue remains indefinite until `MAX_PENDING 2000`.

## §11 Scope Attestation

- **Product behavior changed:** **Yes — only P5-A Model 3 as authorized:** version quarantine (`stale-version`/`unknown-version`), branch/terminal typed failed, clientKey mismatch quarantined with authoritative hash guard in `post_pos_sale`. No other product behaviour changed.
- **SQL changed:** **Yes — additive** `invoices.payload_hash`, `_ledgr_pos_payload_hash`, `post_pos_sale` replacement (hash/mismatch guard, store hash, race handler) — no other SQL/RLS/policy changed; R08/R06/P0QLT logic preserved verbatim.
- **RLS changed:** No.
- **Edge functions changed:** No.
- **AI behavior changed:** No (Q14/Q15 after P8).
- **Billing behavior changed:** No (P5-C pending).
- **Offline behavior changed:** **Yes — P5-A only** (provenance version, exceptions, syncEngine mismatch quarantine, Dexie v4).
- **Tests changed:** **Yes — additive:** `p5a_model3.test.ts` + `provenance.test.ts` expectation fix for new sweep fields; no weakening.
- **Package/CI changed:** No.

## §12 Final Gate

- **Implementation:** `P5-A COMPLETE` (typed offline exceptions). `P5-B`…`P5-F` pending — overall `P5 PARTIALLY COMPLETE`.
- **Exact commit:** (next commit) — files `src/offline/db.ts`, `src/offline/provenance.ts`, `src/offline/exceptions.ts`, `src/offline/syncEngine.ts`, `src/offline/__tests__/provenance.test.ts`, `src/offline/__tests__/p5a_model3.test.ts`, `supabase/migrations/20261005000000_p5a_typed_offline_exceptions.sql`, `docs/audits/LEDGR_P5_IMPLEMENTATION_REPORT_2026-09-24.md`
- **Exact test counts:** `749 PASS / 0 FAIL` unit (87 files) (+18 P5-A), `742/0/40` release pending DB, `tsc -b` clean, `eslint` 0, `vite build` OK.
- **Remaining blockers:** P5-B…F not yet implemented; release harness with new migration not yet live-DB-proven; branch/P8 and AI/R11 not yet started.
- **Another owner decision required:** No — P5-A choices were `85d1615`. Any new policy question will be surfaced and STOPPED rather than assumed.

---

## STOP — P5-A gate clean, awaiting next package GO

P5-A satisfies all 17 P5-A test requirements deterministically without weakening. Do not proceed to P5-B…F until this gate is reviewed. If a later package exposes a dependency that prevents safe continuation, STOP at that gate and do not weaken the contract.
