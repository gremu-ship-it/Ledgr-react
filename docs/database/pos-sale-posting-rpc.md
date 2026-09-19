# Server-side POS sale posting — design and verified prototype

**Status: prototype verified, not wired, not deployed.** The SQL lives in
`docs/database/pos-sale-posting-rpc.prototype.sql` (deliberately *not* in
`supabase/migrations/`). Section 6 is the rollout order; section 7 the reasons
this is a project rather than a patch.

## 1. Why

`20260922000000_pos_role_write_scope.sql` closed the two holes a cashier and a
stock clerk could walk through (expenses, sales documents) but left the ledger
open, because the till writes it from the browser. Closing it needs the sale to
be posted by the database instead.

What the till does today, in `commitPosSaleDocuments`
(`src/services/posService.ts:608`, used by both the online sale and the replay
of a queued offline sale via `src/offline/syncEngine.ts:347`):

| # | Step | Table writes it needs from the cashier's session |
| --- | --- | --- |
| 0 | plan limit | none (RPC/usage counter) |
| 1 | reserve document number | none (`reserve_next_document_number`, SECURITY DEFINER) |
| 2 | resolve/create customer | `contacts` INSERT when the customer is new or was created offline |
| 3 | invoice + lines | `invoices`, `invoice_lines` INSERT |
| 4 | tenders | `invoice_payments` INSERT |
| 5 | stock release | `stock_movements` INSERT |
| 6 | ledger | `journal_entries`, `journal_lines` INSERT |
| 7 | drawer totals | `pos_shifts` UPDATE |
| 8 | audit | none (`log_manual_audit_event`, SECURITY DEFINER) |

Steps 3–6 are the ledger. Refunds (`processReturn`, `posService.ts:1088`) and voids
(`processVoid`, `posService.ts:1232`) need the same tables plus `invoices` UPDATE and
`journal_entries` UPDATE (`JournalRepository.reverse` sets `reversed_by` and
`status='reversed'` on the original entry).

## 2. Scope: three operations, not one

The lockout is only coherent once **every** cashier write to those tables has a
door to go through, so the RPC family is:

| RPC | Covers | Prototype state |
| --- | --- | --- |
| `post_pos_sale(payload)` | sale, including split tender, discount, VAT, credit sale, stock release + COGS | **verified** |
| `post_pos_refund(payload)` | credit note, restock, ledger | not built |
| `post_pos_void(payload)` | invoice void, restock, entry reversal | not built |

Plus `resolveSaleContact` (step 2) must move inside the RPC, otherwise a
cashier still needs `contacts` INSERT.

The good news: each is a variation on the same skeleton, and the shared
helpers already exist — `_ledgr_post_entry`, `_ledgr_account_by_code`,
`_ledgr_post_cogs`, `_ledgr_stock_location`, `_ledgr_assert_usage_limit`
(`20260911000001_quick_save_rpc.sql`), the posting-key unique index
(`20260921000000_journal_posting_key_idempotency.sql`), and
`reserve_next_document_number`.

## 3. Contract

Follows the "hybrid" contract the quick-save RPCs already established: the
client keeps computing policy (accounts, FX, VAT and discount maths, tender
mapping) and the RPC is a transactional **executor** that validates and commits
everything or nothing.

* **Auth**: SECURITY DEFINER with an explicit guard — `can_operate_pos(business_id)`
  (sales-side writer tier: owner, admin, cashier, manager, sales_clerk,
  sales_manager, branch_manager, customer_service_rep). Never `true` for a
  non-member; a stock clerk is rejected with 42501.
* **Idempotency**: `(business_id, client_key)` on `invoices` — a retried sale
  returns the committed document (`idempotent: true`). Derived rows are keyed
  the same way the client keys them today (`client_key` per payment), and each
  ledger entry carries `posting_key` (`invoice:<id>:sale`,
  `invoice:<id>:settlement:<payment_id>`, `invoice:<id>:cogs`), so a replay or a
  crash mid-post resumes rather than duplicates.
* **Validation**: malformed payload, non-positive total, missing contact, or
  tenders that do not settle the total (tolerance 0.01) raise `P0001`; a credit
  sale is exempt from the tender check.
* **Atomicity**: one transaction. The half-posted "sale saved, no ledger entry"
  state that step 0 of the client path exists to avoid cannot occur.
* **Numbering**: the RPC always reserves the number, so an offline placeholder
  (`INV-…-OFFLINE-…`) becomes a real one server-side.

## 4. Lockout this enables

Narrow these policies to `can_write_ledger_directly(business_id)` — the writer
tier **minus cashier and stock_clerk**:

`invoices` (INSERT/UPDATE), `invoice_lines` (INSERT/UPDATE),
`invoice_payments` (INSERT/UPDATE), `journal_entries` (INSERT/UPDATE),
`journal_lines` (INSERT/UPDATE), `stock_movements` (INSERT/UPDATE).

What a cashier keeps directly, because it is their job and shaped by no
accounting policy: `pos_shifts` (open/close, drawer totals), `pos_cash_movements`
(cash in/out), and read access at the business-wide member tier.

Result: a cashier session can produce a sale, a refund and a void — and cannot
write an ad-hoc journal entry, invoice, expense or stock movement. Direct
PostgREST calls with their own token get 42501.

## 5. Verification (embedded Postgres, all 82 migrations replayed)

Harness per `docs/database/database-operations.md`. Probes run as
`SET ROLE authenticated` with a real `cashier` membership.

**Lockout holds** (policies narrowed as in section 4, prototype loaded):

```
cashier direct INSERT invoice        -> ERROR: new row violates row-level security policy for table "invoices"
cashier direct INSERT journal entry  -> ERROR: new row violates row-level security policy for table "journal_entries"
stock_clerk RPC post_pos_sale        -> ERROR: You do not have permission to record sales for this business.
accountant direct INSERT invoice     -> OK  (bookkeeping path unchanged)
```

**And the till still works** — `post_pos_sale` called as that same cashier:

```
invoice=1  lines=1  payments=1  ledger_entries=3  stock_movements=1
unbalanced_entries=0   shift cash=1500  shift total=1500
replay (same client_key) -> idempotent=true, invoices=1, ledger_entries=3
```

**Edge cases:**

```
split tender (1000 cash + 500 Airtel) -> payments=2, settlement debits 1110,1125
discount + VAT (net 1000, disc 100, VAT 148.5, total 1148.5)
   sale entry  -> 1131:DR  4112:CR  4130:DR  2121:CR   (all entries balanced)
credit sale   -> payments=0, ledger_entries=2, amount_paid=0, status=sent
```

The split-tender result matters beyond the lockout: each tender now debits the
account the money landed in, which is the shape that fixes a card sale showing
up as notes in the till.

## 6. Rollout — each stage independently safe

1. **Land the RPC (additive).** Nothing calls it; policies unchanged. Reversible
   by dropping the functions.
2. **Switch `commitPosSaleDocuments` to it**, keeping the existing path as the
   fallback exactly as the quick-save RPCs do (`save_quick_expense` unavailable →
   legacy path: `ExpensesPage.tsx:599`, `QuickExpenseMobile.tsx:302`,
   `syncEngine.ts:243`). Both paths are idempotent on the same `client_key`, so a
   fallback after a *successful* RPC call cannot double-post.
3. **Narrow the policies** in section 4. This is the moment a cashier loses
   ledger access; everything they legitimately do is by then already served by
   the RPCs.
4. Repeat 1–3 for refund and void before stage 3 for those tables.

Stages 1 and 2 can ship together; stage 3 must not precede them.

## 7. Residual risks and open questions

* **The fallback weakens the lockout.** While the legacy path remains, a
  cashier whose RPC call fails plausibly could still need direct writes. Resolve
  by removing the fallback (after a soak period) and only then applying stage 3
  — the order in section 6 keeps production safe at every step.
* **Offline queue.** Queued sales replay through `commitPosSaleDocuments`, so a
  queue item written by the old code still posts through whichever path stage 2
  leaves in place. Items created by a cashier *before* stage 2 are unaffected by
  the switch.
* **COGS posting tolerance.** The prototype mirrors `_ledgr_post_cogs`'s
  behaviour of downgrading a COGS failure to a warning. That keeps a sale
  unblockable, but it also means a stock/valuation problem stays invisible to
  the cashier; the reconciliation panel is still the place it surfaces. Worth a
  deliberate decision rather than an inherited default.
* **Refund/void idempotency.** The sale path is keyed end to end; the refund
  and void paths are not (their guards are "does the invoice already have a
  credit note / is it already void"). They need equivalent keys before stage 3
  covers their tables.
* **Two implementations of the ledger shape.** Until the legacy path is deleted,
  `journalService.createInvoiceReceivableEntry` and the RPC both implement the
  same entries. `20260911000001` already carries this cost for quick save/income;
  the mitigation is parity assertions (account codes, order, balance tolerance)
  in the DB test file, which is how the existing quick-save RPC is guarded.

## 8. Cost to finish

Rough shape, informed by the prototype: refund and void RPCs (~1.5× the sale
one, reusing its skeleton), contact resolution inside the RPC, the client
switch plus fallback removal, offline-queue tests, and the policy migration with
its assertions in `tests/database/rls_security.test.js`. The sale RPC itself is ~230
lines of SQL (364 with the prototype banner and comments) and was verified end
to end; the risk is concentrated in stages 2–3,
not in the SQL.
