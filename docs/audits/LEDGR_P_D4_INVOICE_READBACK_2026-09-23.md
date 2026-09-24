# LEDGR — P-D4 Invoice Member Readback Declaration — Completion Filing

**Date:** 2026-09-23 (Africa/Johannesburg)
**Branch:** `arena/01a0c215-ledgr-react`
**Decision:** P-D4 (owner authorization, 2026-09-23) — declare the authenticated member invoice read tier that the architecture already assumed
**Scope boundary:** exactly the prerequisite filed in P-D3-FINAL §5.1 / §11; no other §12 NOT-AUTHORIZED areas touched
**Baseline gate before this filing:** 735 PASS / 0 FAIL / 45 BLOCKED / 780 TOTAL (measured on `458ba70`; P-D3-FINAL filing reported 735/57/792 from its own environment — the 12-record delta is an environment-specific count of the same 18-file suite, see §6)

---

## §1. Why P-D4 exists

P-D3-FINAL §11 sealed two R09.2 acceptance records because the migration-declared schema had **zero** authenticated invoice read surface:

- `R09.QUEUE.ACTOR-BINDING.SAME-USER`
- `R09.QUEUE.REGRESSION.REPLAY-CONTRACT`

plus `OFFLINE.REOPEN` / `OFFLINE.RETRY` behind the same `requireReadback()` gate. Live probes showed:

```
has_table_privilege('authenticated','public.invoices','SELECT') = false
has_table_privilege('authenticated','public.invoice_lines','SELECT') = false
pg_policies: zero SELECT/ALL policies for either table
```

Production reads through `InvoiceRepository.findByIdWithLines`, `IncomeRepository`, and `posService.loadCommittedPosSale` nevertheless worked via out-of-band platform privileges not declared in migrations. P-D3-FINAL filed the exact activation shape and forbade opportunistic grants inside R09.3 itself — requiring a separate owner decision.

P-D4 is that decision: declare the member tier explicitly, idempotently, in the migration chain.

---

## §2. Migration

**File:** `supabase/migrations/20261003000000_invoice_member_readback.sql` (63 lines)

```sql
grant select on public.invoices to authenticated;
grant select on public.invoice_lines to authenticated;

drop policy if exists invoices_member_read on public.invoices;
create policy invoices_member_read on public.invoices
  for select using (public.is_business_member(business_id));

drop policy if exists invoice_lines_member_read on public.invoice_lines;
create policy invoice_lines_member_read on public.invoice_lines
  for select using (public.is_business_member(business_id));
```

Properties:

- **Same scope as every other business-scoped table** (house pattern `<table>_member_read` via `is_business_member(business_id)` from `20260728000008`). Active members read their own business's rows; `anon` gets nothing; cross-business reads remain impossible via RLS.
- **Write scope untouched** (`20260922000000` tiers still govern `INSERT`/`UPDATE`/`DELETE`).
- **No new data exposure:** POS posting flows already return the full committed document to the caller through `post_pos_sale`; this makes the assumed tier explicit, auditable, and replayable.
- **Idempotent:** `DROP POLICY IF EXISTS` + `GRANT`/`CREATE POLICY`, touches no data. RLS already `ENABLED` on both tables since `20250101000000_base_schema.sql`.
- **Pre-existing house policies preserved:** the `20260728000008` `*_platform_admin_read` SELECT policies on the same tables remain alongside the new member policies; the verification asserts presence, not exclusivity.

---

## §3. Evidence changes (boundary accounting)

Exactly four evidence/harness files plus this report; **zero product source, Edge function, or other migration changes**:

| File | Change | Rationale |
|---|---|---|
| `tests/release/r093-reconciliation.test.ts` | `R093.SEALED-PAIR.READBACK-INVESTIGATION` rewritten from a BLOCKED-state live probe (not available ⇒ both records stay BLOCKED, no grants added) to a **resolved-state verification**: asserts `has_table_privilege` true for both tables, `pg_policies` contains both `*_member_read` policies (subset check, allowing pre-existing `*_platform_admin_read`), and effective RLS behavior (member of business A reads A succeeds, cross-business read of B yields 0 rows). | P-D4 activation proof; the two-state narrative is retained in the record's `expected` text for audit traceability. |
| `tests/release/offline.test.ts` | `R09.QUEUE.REGRESSION.REPLAY-CONTRACT` tightened: the denied-item half now asserts `status failed`, `exceptionClass null`, `clientKey` distinct, and `pg` oracle `count(*) where client_key = $1` = 0 (zero financial mutation) instead of an unqualified English-match on `lastError`. | The added member grant makes the real `post_pos_sale` path reachable; the record now pins the substantive denial contract while `FAIL-PRESERVE` retains payload/key/timestamp preservation. Previously the test's second-half expectation was `lastError` English matching which the fixture's `simulateFailure` path does not populate with the new typed path. |
| `tests/release/r08-shifts.test.ts` | `R08.BRANCH.SERVER-SCOPE` §(e) "zero leakage" assertion: replaced `deniedInTx(... select count(*) from invoices where business_id = A ...) expect 42501` with direct `expect (select count(*) from invoices where business_id=A)=0` (and added same for `invoice_lines`) plus updated comment. | After P-D4, `B_cashier` has SELECT grant but RLS yields 0 rows for foreign business — same zero-leakage property via RLS rather than grant denial. The previous hard-42501 was accurate only in the migration-only profile without the member grant. |
| `tests/release/vitest.config.ts` | `testTimeout: 30000 → 60000` | Host-pressure hardening: the R09.4 SW harness (`r094-sw-update`) needs up to ~35 s for a single `QUEUE-PROVENANCE` transition and ~56 s total suite time; under full-gate load the 30 s per-test budget timed out intermittently (observed `R094.BROWSER.SW.IDENTITY-CONFIDENTIALITY` then `UPDATE-DETECT-TRANSITION` at 30 s). The 60 s budget is the same class of infrastructure fix as P-D3-FINAL §4 item 4 (claimMs=-1 channel-silent handling) — verdicts unchanged, only the timing budget. |
| This report | — | — |

No `R01`, `R02`, `R05`, `R06`, `R07`, `R10`, `R11`, `R14`, `R15`, `GAP`, `branch`, `auth`, `storage`, or `receipt` files touched.

---

## §4. Verification

- `r093-reconciliation` suite: **19 PASS / 0 BLOCKED** (was 18+1) — two isolated runs byte-identical.
- `offline` suite: **35 PASS / 4 BLOCKED** (was 31+8) — the 4 readback-gated records (`OFFLINE.REOPEN`, `OFFLINE.RETRY`, `R09.QUEUE.ACTOR-BINDING.SAME-USER`, `R09.QUEUE.REGRESSION.REPLAY-CONTRACT`) now PASS; remaining 4 BLOCKED are browser-gated (`OFFLINE.BROWSER`, `ACTOR-BINDING`, `CONFLICT`, `MULTITAB`).
- `r08-shifts` suite: **22 PASS** (rearmed leakage assertion passes).
- `r094-sw-update` suite: **8 PASS** (with 60 s budget).
- Full release gate, twice: **740 PASS / 0 FAIL / 40 BLOCKED / 780 TOTAL**, aggregate `evidence.json` **byte-identical** between runs (`sha256 dd9d1dcc0b71` for the sorted aggregate):
  - `/tmp/gate1` and `/tmp/gate2` per-file JSON byte-identical (all 18 files).
- `tsc --noEmit -p tests/release/tsconfig.json` clean.

Gate impact: `735/45/780 → 740/40/780` — exactly **+5 PASS / -5 BLOCKED** (4 offline + 1 r093), zero reclassifications elsewhere, additive tree (5 files inc. this report).

---

## §5. Classification

**P-D4: ACCEPTED — the sealed R09.2 pair and its two companion offline records are now active and evidenced; the member invoices/invoice_lines read surface is declared in the migration chain; all 780 evidence records are accounted for (740 PASS, 40 remaining BLOCKED are browser/sandbox-gated, not migration-gated).**

No subsequent package is started by this filing; the remaining 40 BLOCKED records await their own owner decisions (browser runtime, R02 recovery, etc.) or remain documented limitations.

---

## §6. Note on prior gate count (735/57/792)

The P-D3-FINAL filing reported `735/57/792` from its own two-run gate. Replaying the identical `458ba70` snapshot in this environment yields `735/45/780` (740/40 after P-D4). The 12-record delta is not a code change — the 18-file suite and `grep -c "test(meta"` counts are identical — and appears to be an environment-specific aggregation difference in that run's evidence collector. The two-run byte-identical proof in §4 is the discharge; the delta is noted here for traceability, not as a reclassification.
