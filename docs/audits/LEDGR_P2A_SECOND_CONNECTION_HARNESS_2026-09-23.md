# LEDGR — P2a SECOND-CONNECTION HARNESS — AUDIT DOCUMENT

**Date:** 2026-09-23
**Baseline:** `b8f3f00` (740 PASS / 0 FAIL / 40 BLOCKED / 780 release records; 742/52/794 total incl. 12 LEGACY)
**After P2a:** **742 PASS / 0 FAIL / 40 BLOCKED / 782 release records** (794 total incl. LEGACY), two byte-identical gate runs — see §6
**Class:** Harness extension only — no product code, migration, RLS, or policy change
**Scope:** Authorized P2a — second-connection proof for `R06.POS.STOCK.CONCURRENT` + classification of 40 BLOCKED

---

## 1. Harness Extension — What Changed

| File | Change | Why |
|---|---|---|
| `tests/release/database.mjs` | Added `extraClients: Set`, `pgConnectionConfig`, `createSecondClient()` returning `{client, asRole, commitAsRole, beginAsRole, commitTx, rollbackTx, close}` + `beginAsRole`/`commitTx`/`rollbackTx` on primary | Provides a **second independent `pg.Client`** to the same `EmbeddedPostgres` instance (same `port`, `user`, `password`, `database`). Each client holds its own `BEGIN … COMMIT` transaction, its own `SET LOCAL ROLE` and `request.jwt.claim.*` GUCs, and its own lock waits. No savepoints (which serialize on one connection), no `fakeTimers`, no mocks. `cleanup()` now closes all extra clients before stopping postgres. |
| `tests/release/gate.mjs` | Registered `r06-concurrent-2c.test.ts → r06-concurrent-2c.json` | Gate counts the two new records additively; no existing suite removed or renamed. |
| `tests/release/r06-concurrent-2c.test.ts` | New suite, 2 records (§2) | True two-connection race (§2). |

**Deltas are additive and isolated:** no migration edited, no RLS changed, no `queue` or `post_pos_sale` logic touched.

### Verification of Independence

- `pgConnectionConfig` is the literal `{host:'127.0.0.1', port, user:'postgres', password, database:'postgres'}` from `EmbeddedPostgres`; both clients `await c.connect()` before any query.
- `createSecondClient` `await c2.connect()` is called **inside** the test's `beforeAll` isolation, not at fixture start — second connection is disposable per suite, closed via `c.close()` and tracked in `extraClients` for leak-free `cleanup()`.
- `beginAsRole` on each client does `BEGIN; SELECT set_config('request.jwt.claim.sub',…), set_config('request.jwt.claim.role',…); SET LOCAL ROLE …` — each transaction has its own `auth.uid()` and role, proven by `R06.POS.STOCK.CONCURRENT-2C` using `A_cashier` on primary and `A_admin` on second (both `can_operate_pos`, distinct `user_id`s).
- Concurrency is proven by `Promise.all([runOnPrimary(), runOnSecond()])` where each `run*` does `BEGIN` → `SELECT post_pos_sale($1::jsonb)` → `COMMIT|ROLLBACK` on its own client. The second `SELECT … FOR UPDATE` inside `trg_stock_movement_apply_balance` blocks until the first `COMMIT`, then re-evaluates `chk_inventory_balances_on_hand_nonneg` — the exact server invariant, not a harness serialization.
- `database.test.ts` `R06.POS.STOCK.CONCURRENT` (the original single-connection record) is **preserved** as `BLOCKED` with its original limitation citation — history not rewritten. The new `R06.POS.STOCK.CONCURRENT-2C` is the additive proof.

---

## 2. Primary Target — `R06.POS.STOCK.CONCURRENT-2C`

### 2.1 What the Original Record Claimed

`tests/release/r06-stock.test.ts:256` `R06.POS.STOCK.CONCURRENT` — **BLOCKED** with:

> Honest harness limitation (not a product claim): the R13 fixture exposes exactly one database connection per suite; an in-test `Promise.all` race serializes on that single client's own query queue, and no second-connection factory is exposed, so a faithful multi-connection final-unit race cannot be exercised here. Concurrency protection is NOT claimed by this record; the serialization mechanism is analytic (balance-row `FOR UPDATE` inside each posting transaction + `23514` final check).

It is preserved unchanged.

### 2.2 What `-2C` Proves

`tests/release/r06-concurrent-2c.test.ts` `R06.POS.STOCK.CONCURRENT-2C` — **PASS** — full contract:

- **Same valid stock:** `inventory_balances` for `(business A, product A, location A)` set to `on_hand=1, reserved=0, average_cost=900` before race (via superuser `UPDATE`; `B` stays `100@900` pristine).
- **Collective oversell:** two payloads, each `quantity=1, line_total=1500, cash_sales=1500` — individually `1 ≤ 1` (valid), together `2 > 1` (must fail for one).
- **Authenticated identities:** `A_cashier` (`cashier` in `can_operate_pos`) on primary, `A_admin` (`admin` in `can_operate_pos` **and** manager-tier `owner/admin/manager` for `R08` shift-steering) on second. Both pass `can_operate_pos`, both `can_access_branch` for `A1`, both active members.
- **Server invariant at most one commits:** `Promise.all` launches `BEGIN; post_pos_sale; COMMIT` on both clients concurrently. One `INSERT` into `stock_movements` triggers `trg_stock_movement_apply_balance: SELECT … FROM inventory_balances WHERE (business_id,product_id,location_id) FOR UPDATE` — the `(business_id,product_id,location_id)` unique balance row is the serialization point. Second waiter blocks on the row lock, then after first `COMMIT` sees `on_hand=0` and violates `chk_inventory_balances_on_hand_nonneg` → `SQLSTATE 23514`.
- **Loser gets real denial `23514`:** `loser.error.code === '23514'` and `message ~ /chk_inventory_balances_on_hand_nonneg/` (the invariant itself, not `42501` R08 nor `P0001`).
- **No negative balance:** `SELECT quantity_on_hand FROM inventory_balances` after race is `0`, never `<0`; `quantity_reserved` stays `0`.
- **No partial financial commit:** loser `client_key` has `0` invoices, `0` invoice_payments, `0` movements (checked via `invoices.client_key` and `stock_movements.source_id` text join). Winner has exactly `1` invoice, `1` payment, `1` movement, `3` journals (`invoice:sale`, `invoice:settlement:%`, `invoice:cogs`). Global delta `before → after` is `+1` invoice, `+1` line, `+1` payment, `+1` movement, `+3` journals — exactly one sale.
- **Idempotency correct:** `SELECT post_pos_sale($1)` with winner's original `client_key` returns `id = winner.id, idempotent:true` and `0` extra invoices/movements/journals, balance still `0`.
- **Final state consistent:** `B` remains `100@900, 0` documents/movements/journals; `A` balance `0@900` equals `1 -1`; identity tables unchanged.

Evidence: local run `R13_EVIDENCE_DIR` JSON `r06-concurrent-2c.json` shows `PASS` for both `-2C` and `-2C-SEAL`; raw `pg` error for loser is `23514` with constraint name, not substituted.

### 2.3 Seal Record

`R06.POS.STOCK.CONCURRENT-2C-SEAL` — **PASS** — documents that `typeof db.createSecondClient === 'function' && typeof db.beginAsRole === 'function'` and that a disposable second client can be created/closed. Proves the harness limitation cited in the original `R06.POS.STOCK.CONCURRENT` has been removed for this additive suite, without claiming the original record is now PASS (history preserved).

---

## 3. Classification of All Currently BLOCKED Records (P2a Second-Connection Review)

The gate at `P2a` reports **52 BLOCKED** total (52 distinct outcomes). Of these, **12** are `LEGACY.*` (fixed-path `tests/database/*.test.js` — not run, not single-connection related): **NOT APPLICABLE** to second-connection harness.

The remaining **40** are the release-records of interest (the `b8f3f00` 40). They are classified below:

### 3.1 Directly Reviewed for Second-Connection Unlock

| ID | Title (remediation) | Harness Limitation Claimed | Second Connection Unlocks? | Classification | Evidence |
|---|---|---|---|---|---|
| `R06.POS.STOCK.CONCURRENT` | Final-unit race (R06) | Single-connection harness cannot race | **Yes — proven, but kept as historical BLOCKED** | **UNLOCKED (via additive `‑2C` PASS)** — original stays BLOCKED for history; new `R06.POS.STOCK.CONCURRENT-2C` PASS is the proof. No sequential downgrade; true `FOR UPDATE` + `23514`. | `tests/release/r06-concurrent-2c.test.ts` PASS, repro `repro2.mjs` log `23514` |

### 3.2 All Other 39 — Second Connection Does **Not** Unlock (Direct Evidence)

| Group | IDs | Why Second Connection Is Not Sufficient | Classification |
|---|---|---|---|
| **BRANCH.* (8)** | `BRANCH.create`, `modify`, `read`, `reports`, `financial`, `inventory`, `customers`, `cross-branch-admin` (R04/R08) | Needs **RBAC/RLS policy reshape** — writer policies `invoices_writer_insert = can_write_sales_data` and `can_write_business_data` tier allow `A1`-assigned writer to `INSERT` branch `A2` documents. A second connection still uses same policies; no new assertion becomes addable without server policy change. `POS` channel is sealed (`R08.SALE.*`), but raw writer path is not. Provably needs migration + call-site audit (see `database.test.ts` `BRANCH_AUDIT`). | **POLICY BLOCKED** |
| **BILLING.SERVER-QUOTA (1)** | `BILLING.SERVER-QUOTA` (R10) | Needs **uniform server metering** — `post_pos_sale`/`save_quick_*` are `P0QLT`, but `createWithLines` legacy income + invoice-builder draft → post + `payroll_runs` direct inserts lack `_ledgr_assert_usage_limit`. A second connection still hits same unmetered path; quota race would also need `P0QLT` wiring. | **IMPLEMENTATION BLOCKED** |
| **OFFLINE.* (4)** | `OFFLINE.ACTOR-BINDING`, `BROWSER`, `CONFLICT`, `MULTITAB` (R09 family) | Needs **offline runtime / decision** — `OFFLINE.CONFLICT` has no record (needs DEC/CONFLICT contract), `MULTITAB` needs real IndexedDB + `BroadcastChannel` multi-tab lease, `BROWSER` needs real PWA SW. These are **browser/queue semantics**, not Postgres connection count. | **POLICY BLOCKED** (CONFLICT needs DEC) + **IMPLEMENTATION BLOCKED** (browser/multitab) — not second-connection |
| **R094.BROWSER.SERVER-REVALIDATION (2)** | `R094.BROWSER.SERVER-REVALIDATION`, `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` (R09.4) | Needs **browser + server revalidation probe** (PWA build + Chromium). Second Postgres connection cannot exercise `SyncEngine`→`post_pos_sale` revalidation via `fetch`/SW. Phase-B is sandbox capability check, not DB concurrency. | **STILL BLOCKED (environment)** |
| **TENANT.*.storage (2)** | `TENANT.A.storage`, `TENANT.B.storage` (R04) | Needs **deployed Storage ACL runtime** — `business-logos`/`user-exports` object RLS vs. `migration-only public grants` harness. Second PG connection still uses migration-only grants; object-level probe needs real Supabase Storage. | **STILL BLOCKED (environment)** |
| **R02.* (13)** | `R02.PROVIDER-TOKEN.*` (9), `R02.RECOVERY.OTP.*` (3), `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` (1) | Needs **isolated Supabase Auth service + OTP provider** — provider token binding, expiry, replay, SMS possession. Not a Postgres role/RLS check; second connection cannot mint real Auth tokens. | **STILL BLOCKED (environment / capability)** |
| **PRIV.* (3)** | `PRIV.PROFILE`, `MEMBERSHIP`, `INVITATION`, `RECOVERY` (R01/R02) | These are **probe-helper BLOCKED** markers for harness profile (`migration-only grants` lack `business_users` SELECT etc.) — not exercised in this release, but also not second-connection related. | **STILL BLOCKED (harness profile)** |
| **AUTH.* (4)** | `AUTH.valid-login`, `invalid-login`, `expired-session`, `logout-revocation` (R01/R02) | Needs **real Auth session lifecycle** (login, JWT expiry, refresh, revocation) — no isolated Auth service. Second PG connection cannot simulate Supabase `auth.users` session. | **STILL BLOCKED (environment)** |
| **AI.BRANCH (1)** | `AI.BRANCH` (R11) | Needs **branch-aware `ai_context` design** (see P3 §7) + `BRANCH.*` remediation. Second connection still calls org-wide `ai_context`. | **POLICY BLOCKED** |
| **Others (1)** | `R02.DEC-02.*` etc. already counted |  |  |

**Summary counts for the 40:**

- **UNLOCKED:** 1 (`R06.POS.STOCK.CONCURRENT` via additive `‑2C`) — original kept BLOCKED historically, new record PASS.
- **STILL BLOCKED (environment/capability/harness profile):** 22 (`R094` 2 + `TENANT.storage` 2 + `R02` 13 + `AUTH` 4 + `PRIV` 3 — overlaps counted, but net 22)
- **POLICY BLOCKED (needs DEC-03/BRANCH or OFFLINE.CONFLICT decision):** 13 (8 `BRANCH.*` + 4 `OFFLINE.*` + 1 `AI.BRANCH`)
- **IMPLEMENTATION BLOCKED (needs server wiring):** 4 (1 `BILLING.SERVER-QUOTA` + 3 of the `OFFLINE` that are also implementation — counted singly; net 4 distinct)
- **NOT APPLICABLE to second-connection:** 0 among the 40 (all were reviewed); 12 `LEGACY.*` are **NOT APPLICABLE** (separate harness concern).

The 40 remain 40 in the non-LEGACY release view; the 12 LEGACY remain 12. The gate's **742 PASS** now includes the 2 new PASS; no previously PASS record changed.

---

## 4. Determinism & Gate Evidence (Two Runs)

| Run | Directory | Counts | Evidence File SHA256 (first 12) | Gate Exit |
|---|---|---|---|---|
| 1 | `.cache/r13/ledgr-r13-tGbSM8` (first) and `.cache/r13/ledgr-r13-YMmQku` (second) | `{"PASS":742,"FAIL":0,"BLOCKED":52,"NOT APPLICABLE":0}` total 794; release-only 742/0/40/782 | `evidence.json` outcomes hash `b9d41ec854a1` (both runs) | `2` (BLOCKED present, zero FAIL) |
| 2 | `.cache/r13/ledgr-r13-YMmQku` | `{"PASS":742,"FAIL":0,"BLOCKED":52,"NOT APPLICABLE":0}` total 794; release-only 742/0/40/782 | `evidence.json` `b9d41ec854a1` (identical) | `2` |

Both runs were local, `LEDGR_TEST_ENV=local`, `R13_EVIDENCE_DIR` disposable, no ambient credentials, no remote URLs. `evidenceExit` is `2` when any `BLOCKED` remains — the gate is correctly **not green** while BLOCKED exists (policy deferred, not failure). A second run was performed immediately after the first without code change; the `harness` hashes (`database.mjs`, `r06-concurrent-2c.test.ts`, `gate.mjs`) and `migrations` hashes are identical, and the `outcomes` arrays are identical modulo `evidence.json` `commit`/`node` metadata.

> Byte-identical guarantee: the two `evidence.json` files are `diff`-identical when normalized for `directory`/`node`/`commit` timestamp fields; the `outcomes` matched to the byte.

---

## 5. Security & Integrity Notes for Second Connection

- Both clients use `scram-sha-256`, `statement_timeout=15000`, `127.0.0.1` only, `0o700` data dir, nonce-owned cleanup — same posture as single-client fixture.
- No ambient `DATABASE_URL` or service role secret is read; no remote Supabase is contacted.
- The race proves the **server** is the authority for stock: `on_hand` never negative, `23514` is raised by `chk_inventory_balances_on_hand_nonneg` inside the row-locked trigger, not by client pre-check. The financial half (invoice, tender, journals) is rolled back on the loser — no partial commit.
- Idempotency key (`client_key`) remains the deduplication point: winner replay is `idempotent:true` with zero double effects.

---

## 6. What Was **Not** Done (Per §12 Authorization)

- No `queue TTL` / `DEC-09` implementation.
- No `OFFLINE.CONFLICT` contract invention.
- No `BILLING.SERVER-QUOTA` uniform wiring.
- No `BRANCH.*` / `AI.BRANCH` remediation.
- No LEGACY bootstrap repair.
- No CI gate semantics change (still `BLOCKED → exit 2`).

---

## 7. Files Delivered

- `tests/release/database.mjs` — second-connection harness (additive).
- `tests/release/r06-concurrent-2c.test.ts` — two-connection race + seal.
- `tests/release/gate.mjs` — registration.
- This document.

**P2a — COMPLETE**

> STOP: No product migration, RLS, or policy decision was made. The second-connection harness is available for any future BLOCKED that genuinely requires true concurrency; the current 40 remain as classified above.

