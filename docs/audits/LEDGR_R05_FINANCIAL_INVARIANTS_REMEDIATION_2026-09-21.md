# LEDGR — R05 Financial Command and Database Invariants: Remediation Report

**Date:** 2026-09-21
**Package:** R05 (register §"R05", Critical priority)
**Class:** Verification + new release coverage. **Zero product changes; zero migrations.**
**Outcome:** Combined release evidence **601 PASS / 3 FAIL / 54 BLOCKED @658 records** — up from the R04-final baseline 593/3/54 @650. All 650 previously-existing records **byte-identical**; exactly 8 new `R05.FINANCE.*` records added, all PASS; deterministic repeat run **0 diffs**.

---

## 1. Scope and Authorization

R05 covers "Financial command and database invariants." The register's R05 text marks the remaining new financial-command behaviors (canonical reversal, universal journal-balance enforcement, accounting-period locks, server-derived audit) as **"new design pending"** behind DEC-04/DEC-09 and finance approval.

Per house rules and the DEC-03 precedent (BRANCH.* deferred-with-proposal, never invented), this package was executed as:

1. **Machine-verified inventory** of which financial-command invariants the existing migration chain actually enforces server-side.
2. **New release-suite coverage** (`tests/release/r05-finance.test.ts`, 8 records) for enforced invariants only — never fabricating coverage for unenforced gaps.
3. **Findings documentation** for the unenforced remainder (§8), with the decision-gated `FINANCE.REVERSAL` contract proposal (§9) left for approval.

No opportunistic fixes were made. `FINANCE.REVERSAL` remains BLOCKED; R06-owned `POS.STOCK` and R12/R14-owned `EDGE.*` FAILs untouched.

## 2. Baseline and Final Evidence

| Run | PASS | FAIL | BLOCKED | Records | Identity |
|---|---|---|---|---|---|
| Baseline (R04 final) — `.cache/r13/ledgr-r13-xkibav` | 593 | 3 | 54 | 650 | integrity reference |
| **R05 final** — `.cache/r13/ledgr-r13-mfWKwy` | **601** | **3** | **54** | **658** | deliverable |
| Deterministic repeat — `.cache/r13/ledgr-r13-LO8mRY` | 601 | 3 | 54 | 658 | 0 diffs vs final |

Integrity comparison against the frozen baseline (full manifest: `.cache/r05/comparison.json`):

- `common_records = 650`, **byte_identical = 650** — zero existing record changed, weakened, or lost.
- `changed = []`, `removed = []`.
- `added = 8` (all `R05.FINANCE.*`, all PASS), `repeat_diffs = []`.
- The 3 remaining FAILs (unchanged, pre-existing): `EDGE.RETRY.no-secret` (R12/R14), `EDGE.WEBHOOK.viewer` (R12), `POS.STOCK` (R06) — each already owned by later register packages.
- `FINANCE.REVERSAL` remains BLOCKED with the same decision-gated cause; see §9.

## 3. Enforcement Inventory (Machine-Verified)

The migration chain today enforces, at the PostgreSQL boundary:

| Invariant | Enforcing migration | Mechanism | SQLSTATE on violation |
|---|---|---|---|
| Journal posting-key uniqueness (idempotency) | `20260921000000_journal_posting_key_idempotency.sql` | partial unique index `journal_entries_posting_key_uidx (business_id, posting_key) where posting_key is not null` | 23505 |
| Payments blocked on cancelled invoices (`void`, `credit_note`) | `20260813000002_block_payments_on_cancelled_documents.sql` | status-guard trigger before insert on `invoice_payments` | 22023 |
| Payments blocked on void expenses | `20260813000002_block_payments_on_cancelled_documents.sql` | status-guard trigger before insert on `expense_payments` | 22023 |
| Non-negative quantities/prices/stock (10 checks) | `20260817000001_phase10_nonneg_quantity_checks.sql` | `chk_*_nonneg` constraints incl. `chk_stock_movements_quantity_nonzero`; `NOT VALID` for legacy rows, enforced on all new writes | 23514 |
| Atomic document-number reservation + role gating | `20260728000011_reserve_document_number_rpc.sql` | SECURITY DEFINER RPC, atomic `businesses` counter update, kinds `invoice/expense/payroll`; 22023 unknown kind, 42501 unauthorized | 22023 / 42501 |
| Journal-entry number sequencing | `20260820000000_ops_hardening_runtime.sql` | `next_journal_entry_number` → `JNL-YYYYMMDD-######` | n/a (uniqueness by construction) |
| Locked bank-statement line immutability | `20260725000000_bank_reconciliation.sql` | `bank_line_locked_guard` trigger on update/delete of `bank_statement_lines` | P0001 `"This bank reconciliation period is locked"` |
| Ledger write-closure (defense in depth) | ACL boundary (no `authenticated` DML grant on `journal_entries` in the migration chain) | even owner direct `INSERT` is denied table permission; journals exist only via SECURITY DEFINER commands | 42501 |

## 4. New Release Suite

`tests/release/r05-finance.test.ts` — 8 evidence records, all PASS, plus gate registration in `tests/release/gate.mjs` (`'r05-finance.test.ts': 'r05-finance.json'`).

1. **R05.FINANCE.POSTING-KEY-UNIQUE** — owner direct ledger INSERT denied 42501 (command-only ledger proof); observer-position duplicate `(business_id, posting_key)` insert raises 23505; distinct key, other tenant, and NULL key remain free; catalog index definition verified.
2. **R05.FINANCE.CANCELLED-INVOICE-PAYMENT** — paid invoice accepts payment; `void` invoice payment → 22023 (`/void/`); `credit_note` invoice payment → 22023 (`/credit_note/`).
3. **R05.FINANCE.VOID-EXPENSE-PAYMENT** — paid expense accepts payment; `void` expense payment → 22023 (`/void expense/`).
4. **R05.FINANCE.NONEG-LINES** — negative invoice-line quantity → 23514; negative unit price → 23514; negative `inventory_balances.quantity_on_hand` update → 23514; seeded balance (100) untouched; catalog confirms all ten phase-10 constraints present.
5. **R05.FINANCE.NUMBER-RESERVATION** — two invoice reservations distinct with `INV`/… prefixes; expense kind `EXP`; unknown kind → 22023; viewer reservation → 42501; branch_manager payroll reservation → 42501 (payroll-role gating).
6. **R05.FINANCE.JOURNAL-NUMBER-UNIQUENESS** — two consecutive `next_journal_entry_number` calls match `^JNL-\d{8}-\d{6}$` and differ.
7. **R05.FINANCE.BANK-LINE-LOCK** — line editable before lock; after `is_locked=true`, both UPDATE and DELETE of the line raise P0001 /`/locked/`; (insert of new lines remains allowed — the invariant's name "line change" is honored exactly: existing reconciled lines become immutable).
8. **R05.FINANCE.DATA-UNCHANGED** — all probe tables empty after the suite (`journal_entries`, `invoices`, `invoice_payments`, `expense_payments`, `bank_statements` = 0 rows), fixture identity tables unchanged (contacts = 2, business_users = 14).

### Methodology notes (harness-consistent)

- The migration-replay ACL grants DML only to the four master-data tables; tenant-facing financial tables are write-closed to roles without a SECURITY DEFINER command. The suite therefore (a) proves ledger write-closure directly with an owner 42501 probe, and (b) exercises constraint/trigger invariants from the privileged-observer position inside the same rolled-back transaction (`reset role`) — the technique the harness's own `POS.SALE` statement already uses to observe command effects. RLS/ACL behavior is separately and exclusively verified through `db.asRole`.
- Each expected denial runs under a **savepoint** that is rolled back immediately after the SQLSTATE is asserted, keeping every probe transaction clean and deterministic.
- Denials pin the guard's real SQLSTATE (22023 / 23505 / 23514 / 42501 / P0001) — never "any failure."
- Zero overlap with `POS.SALE`'s existing replay/idempotency assertions; no duplication of R03/R04 statements.

## 5. Determinism and Integrity Protocol

1. Suite-only verification: 8/8 PASS (plus `test:release:types` clean).
2. Full `npm run test:release` (real PostgreSQL 17, full migration replay): **601/3/54 @658** → `.cache/r13/ledgr-r13-mfWKwy`.
3. Repeat full run: **601/3/54 @658** → `.cache/r13/ledgr-r13-LO8mRY`; record-level fingerprint comparison: **0 diffs**.
4. Baseline integrity vs `ledgr-r13-xkibav` (R04 final): **650/650 byte-identical**, 0 changed, 0 removed, +8 R05.* (manifest `.cache/r05/comparison.json`).

## 6. Regression Stack (All Green)

- Root unit suite: **76 files / 658 tests PASS** (`npx vitest run`).
- `tsc -b`: exit 0.
- `eslint .`: 0 errors (1 pre-existing warning, unchanged from R04).
- `node --check` on all `tests/release/*.mjs`: clean.
- Edge-function bundles: **esbuild 26/26 OK**.
- Placeholder production build: success.
- `git diff --check`: clean.

## 7. R05 Coverage Surface vs Evidence

| Anchored expectation | Status before | Status after |
|---|---|---|
| FINANCE.ORACLE | PASS | PASS (byte-identical) |
| FINANCE.POSTING-TOTALS | PASS | PASS (byte-identical) |
| FINANCE.NONPOS-INCOME | PASS | PASS (byte-identical) |
| POS.SALE (replay + ledger effects) | PASS | PASS (byte-identical) |
| FINANCE.REVERSAL | BLOCKED (decision-gated) | **BLOCKED — unchanged, proposed contract in §9** |

## 8. Findings: Not Yet Enforced at the DB Boundary (Programme Findings — No Fixes Made)

1. **Universal deferred journal-balance guard.** No migration installs a constraint/deferred trigger enforcing Σdebit = Σcredit per journal entry against *all* write paths. Balance is currently guaranteed only by the transaction logic of the SECURITY DEFINER posting commands (e.g., `post_pos_sale`), and verified behaviorally by `FINANCE.POSTING-TOTALS` on those paths. A direct/DML path bypass (or a future command bug) would not be caught by the database itself. *Owner: R05/DEC-04 — finance/engineering design approval required before implementing.*
2. **General accounting-period lock for journals.** Only bank-reconciliation statements have a lock guard (`20260725000000`). Journal entries themselves are not period-locked; back-dated posting is constrained only by command logic where implemented. *Owner: R05/DEC-04 — period model (open/close, authority to reopen) must be approved first.*
3. **Server-derived audit actor.** Audit columns (`created_by` etc.) remain client-writable text fields; no migration binds them to the authenticated identity server-side, and no client-triggered audit event log exists for posting actions beyond what commands record. *Owner: R05/DEC-09 lineage.*

These were **not** patched in this package: register §5 marks them "new design pending," and inventing them would repeat precisely the failure class this programme eliminated in R03/R04.

## 9. FINANCE.REVERSAL — Proposed Contract (Decision-Gated, Unimplemented)

Mirroring the DEC-03/BRANCH.* precedent, the following contract is **proposed for approval; nothing was built**:

1. `reverse_posting_command(payload)` — single SECURITY DEFINER RPC; idempotent by caller-supplied `reversal_key` (unique per business, replay returns the existing reversal).
2. Validations: target journal entry exists, belongs to the caller's business, is `posted`, has not already been reversed (lineage pointers `reversed_entry_id` / `reversal_of_id` both-ways), and caller holds the finance-role tier (DEC-04 to name the role set).
3. Effects: creates a mirror entry (`reversal_of_id = target`), opposite signed lines, same currency/exchange rate, new `JNL-…` number, `posting_key` derived from `reversal_key` (covered by the existing unique index for replay protection).
4. Out of scope until approved: partial reversals, multi-currency revaluation, period-lock interaction (depends on finding §8.2).

`FINANCE.REVERSAL` stays BLOCKED in the release evidence with cause: *canonical reversal command/approval/entitlement contract not yet approved or implemented.*

## 10. Risks Accepted

- **Observer-position coverage** relies on the harness's established `reset role` observer technique (same as `POS.SALE`); it verifies DB invariants, not tenant-path ACLs — ACL behavior for financial DML is intentionally verified only through `db.asRole`, and the suite records ledger write-closure as additional evidence of the command-only posting surface.
- **Embedded-PostgreSQL replication** disclaimers from R13/R00 remain in force for the release suite as a whole (unchanged records carry the same layer strings).

## 11. Verification Artifacts

- `tests/release/r05-finance.test.ts` (new suite, 8 records)
- `tests/release/gate.mjs` (registration added: `'r05-finance.test.ts': 'r05-finance.json'`)
- `.cache/r13/ledgr-r13-xkibav` (frozen R04 baseline, 593/3/54 @650)
- `.cache/r13/ledgr-r13-mfWKwy` (R05 final, 601/3/54 @658)
- `.cache/r13/ledgr-r13-LO8mRY` (repeat, 601/3/54 @658, 0 diffs)
- `.cache/r05/comparison.json` (integrity manifest: 650/650 byte-identical; +8 added; 0 changed/removed)

## 12. Commit-Ready Change List

| Path | Change |
|---|---|
| `tests/release/r05-finance.test.ts` | New R05 verification suite (8 evidence records) |
| `tests/release/gate.mjs` | Map suite → `r05-finance.json` artifact |

(No migrations; no `src/`; no edge functions; no production data. Fail state: none new, none changed.)

## 13. Result

R05 is **complete** as chartered: the financial-invariant surface is machine-verified, all enforced invariants now carry dedicated release-suite coverage (8/8 PASS), previously-existing evidence is byte-for-byte preserved, repeat determinism holds, and the approval-gated remainder (FINANCE.REVERSAL contract + §8 findings) is documented for decision without any invented enforcement.

## 14. Handover

- Next register package: **R06** (POS command surface; owns the remaining `POS.STOCK` FAIL).
- Outstanding decisions carried forward: **BRANCH.*** (DEC-03 contract, R04 report §8/§9), **FINANCE.REVERSAL** (§9 above), R05 findings (§8), TENANT.*.storage (R00/R13 bootstrap parity).
