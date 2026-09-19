# Posting integrity audit — POS / invoice / quick-save flows

Date: 2026-09-19
Branch: `arena/01a0ba6f-ledgr-react` (follows PR #157, "route offline POS sales
through the app-wide offline queue")
Scope: every ledger write reachable from a till sale, a quick income entry, an
invoice-builder invoice, an expense and a payroll run — plus the retry/queue
machinery that can replay any of them.

Method: read the posting path end to end (service → repository → migration,
and the SQL quick-save RPC), then lock the conclusions with tests. Nothing in
`journalService`, `JournalRepository` or the migrations was changed by this
audit; the fixes below are in `posService`, `queueApi`/`syncEngine` and the
inventory repository.

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| F1 | A discounted POS sale posted **no** ledger entry at all | High | Fixed |
| F2 | A credit POS sale posted **cash received** it never received | High | Fixed |
| F3 | A replayed sale could post the ledger and the stock release twice | High | Guarded (baseline) |
| F4 | A sale abandoned mid-sync stayed invisible on the device forever | Medium | Fixed |
| F5 | POS sales history read `subtotal` as gross after the header fix | Low | Fixed |
| O1 | The retry helper wraps non-idempotent ledger writers | High (open) | Reported |
| O2 | Tender type never reaches the ledger (cash / mobile money / card) | Medium (open) | Reported |
| O3 | Usage-limit guard counts journal entries and runs after the document write | Medium (open) | Reported |
| O4 | POS VAT rate is hard-coded to 0 | Low (open) | Reported |

---

## Verified sound (no change needed)

* **Balanced-entry gate.** `JournalRepository.createBalancedEntry` refuses fewer
  than two lines, refuses anything whose `amount_base` debits and credits differ
  by more than 0.005, and deletes the header row if the line insert fails — so a
  half-written entry cannot survive. `post()` is an atomic conditional update
  (`status = 'draft'` in the WHERE clause) and refuses to re-post or post a
  reversed entry.
* **No silent account substitution.** `getAccountByCode` throws when a code is
  missing. The only fallback (net revenue when 4130 does not exist) is logged
  and gated on a genuine "missing account" error.
* **The quick-save RPC is atomic and idempotent.** `save_quick_sale` /
  `save_quick_expense` de-duplicate on `(business_id, client_key)`, insert the
  document and its lines, post the entries through `_ledgr_post_entry` (same
  two-line minimum and ±0.005 balance rule as the TypeScript path), link
  `journal_entry_id`, release stock and post COGS in a single transaction. A
  retry of an RPC call cannot double-post.
* **Reversal path.** Reversal mirrors the original lines with `is_debit`
  flipped, keeps `source_id`, links `reversal_of`, marks the original
  `reversed` + `reversed_by`, backs the payment out of `amount_paid`/status and
  auto-voids the source document.
* **App-wide invoice arithmetic.** `subtotal + vat_amount = total_amount` and
  `subtotal` = net of discount hold for the invoice builder, the quick-save RPC
  (which asserts it) and — after F1 — the till.

---

## Fixed in this branch

### F1 — A discounted POS sale posted no ledger entry (High)

`commitPosSaleDocuments` passed `Number(createdInvoice.subtotal)` into
`createInvoiceJournalEntry`, and the POS payload stored the **pre-discount**
gross there. `createInvoiceJournalEntry` credits revenue with
`subtotal + discount_amount` (gross disclosure) and debits the discount to
4130, so with a discount the credits exceeded the debits by exactly the
discount: `createBalancedEntry` rejected the entry, `retryNonCritical` demoted
the rejection to a warning, and the sale was committed with **no sales entry
and no receipt entry** — the till's revenue never reached the GL.

The pre-refactor implementation (`7910251:src/services/posService.ts:469`) had
passed `totals.taxable_subtotal`; the rewrite lost that mapping, so this was a
regression introduced with PR #157.

Fix: `buildPosSaleQueuePayload` now stores the app-wide convention —
VAT-exclusive and net of discount (`taxable_subtotal − tax_total`, which equals
the old `taxable_subtotal` at the till's 0% VAT rate) — in both `subtotal` and
`taxable_amount`. That also repairs what the Invoices view ("Net Subtotal",
gross = subtotal + discount) and the generated documents print for till sales,
and it applies to sales recovered from the retired localStorage queue, because
the migration rebuilds payloads through the same function.

Locked by `src/services/__tests__/posSalePostingIntegrity.test.ts`, which runs
the real `journalService` and asserts the sale entry balances and carries
DR 1131 900 / DR 4130 100 / CR revenue 1,000 for a 1,000 sale with a 10% line
discount.

### F2 — A credit POS sale posted cash it never received (High)

The paid path always posted the auto-receipt (DR 1110 Cash / CR 1131 Debtors).
A credit sale has no payment rows and an invoice left at `status: 'sent'` with
`amount_paid = 0`, so the ledger claimed the money was in the drawer while the
customer's balance said otherwise, and the later settlement would have posted a
second receipt.

Fix: `commitPosSaleDocuments` posts `createInvoiceReceivableEntry`
(DR 1131 / CR revenue / CR discount, posted and linked) for credit sales, i.e.
sales with `isCreditSale` set or with no payment legs. This is the same posting
the Income screen uses for a credit invoice.

### F3 — A replay could double-post the ledger and the stock release (High, guarded)

The invoice and its payment rows are idempotent through `(business_id,
client_key)`, but the two halves derived from them were not:

* the sales entry has no key on `journal_entries` (there is no `client_key`
  column, and the `(source_type, source_id)` index is not unique), and
* `deductStockAndPostCogs` writes movements through `recordMovements`, which
  sets no `client_key` — and the COGS entry is derived from those movements.

A replay therefore duplicated revenue, cash, stock and cost of sales. Guards
added in `commitPosSaleDocuments`:

* the ledger is skipped when the committed invoice already carries a
  `journal_entry_id` (both posting functions stamp it, and `createWithLines`
  returns the stored row on a replay);
* the stock/COGS release is skipped when the invoice already has stock
  movements (`InventoryRepository.hasMovementsForSource`, indexed lookup). A
  replay whose first attempt never reached the stock step still releases it —
  the movement check decides, not the mere presence of the invoice.

This closes the replay paths the queue itself can take. It does **not** close
O1.

### F4 — A sale abandoned mid-sync stayed invisible forever (Medium)

`syncQueue` selects `pending` and `failed` only, `getPendingCount`/the drawer's
live query counted the same two statuses, and the drawer disabled actions for
`syncing` items. A tab closed, reloaded or killed while a sale was being
written left that item `syncing` for good: not retried, not counted, no Retry
button — the one failure mode where an offline sale could be lost with nothing
on screen saying so.

Fix: a claim lease (`STALE_SYNC_CLAIM_MS` = 2 minutes) plus
`recoverStaleSyncClaims()`, run at the start of every pass. Abandoned claims go
back to `pending`, are counted by the badge and the drawer, and can be retried
or discarded. Claims younger than the lease are untouched, so a pass running in
another tab is never disturbed.

### F5 — Sales history gross (Low)

`PosPage` built the history row's `gross_amount` from `inv.subtotal`; with the
header now net of discount it adds `discount_amount` back, so
gross − discount = net still reads correctly.

---

## Open findings (reported, not changed)

### O1 — The retry helper wraps non-idempotent ledger writers (High)

`retryNonCritical` (`src/lib/nonCriticalRetry.ts`, over `withRetry`,
`src/lib/errorHandler.ts`) gives a write two attempts. Its own doc comment says
"anything whose loss would corrupt the ledger's relationship to the document
must NOT use this helper" — yet it wraps `deductStockAndPostCogs`,
`createInvoiceJournalEntry`, `createInvoiceReceivableEntry` and
`createExpenseJournalEntry` in both `posService` and `syncEngine`.

Two attempts are only safe if the write is idempotent. These are not: a lost
response or a client-side timeout *after* the server committed causes the retry
to insert a second sales entry (and, for the stock path, a second movement
batch plus a second COGS entry). The queue guards from F3 do not help, because
the retry happens inside one commit.

Recommended fix: give each posting a deterministic key and let the database
enforce it.

* journal entries — write `reference = 'invoice:<id>:sale'` (and `:receipt`,
  `:settlement`, `expense:<id>:payment`, …) and add a partial unique index on
  `(business_id, reference) where reference is not null`; the posting functions
  then check the key first and become no-ops on retry;
* stock movements — the unique index already exists
  (`20260813000003_add_client_key_idempotency.sql` covers `stock_movements`
  on `(business_id, client_key)`), but the batch writer never sets a key. Pass
  `${clientKey}:mv:<n>` through `recordMovements` and pre-filter existing keys
  in the same round trip.

### O2 — Tender type never reaches the ledger (Medium)

Every sold item is debited to 1110 Cash on Hand, whatever the tender: the
payment rows carry the method (cash / airtel_money / card / other) but the
auto-receipt posts to the cash account only. `bank_account_id` is part of
`PosPaymentSplit` yet never set by the payment modal, so the "bank/mobile money"
accounts that `createInvoiceSettlementEntry` already supports are unreachable
from the till. Cash on hand therefore overstates the drawer for card and mobile
money takings, and the drawer count at shift close cannot be tied to it.

### O3 — Usage-limit guard counts entries, and runs after the document (Medium)

`checkUsageLimit` counts `journal_entries` for the month, so one till sale
consumes two units (sale + receipt) of the plan's monthly allowance. It runs
inside `createInvoiceJournalEntry` — i.e. *after* the invoice row exists — so
tripping it leaves an unposted invoice behind (a warning at the till,
`Accounting journal entry failed` thrown to the Income screen). The
receivable/settlement paths never check it at all. Counting transactions and
checking before the document write would make the limit mean what the pricing
page says.

### O4 — POS VAT rate is hard-coded to 0 (Low)

`PosPage` calls `calculateCartTotals(items, orderDiscount, 0)` and
`normalizePosSale` defaults `defaultTaxRate` to 0, so every POS sale posts
`vat_amount: 0` and no 2121 line. Fine if the till is deliberately VAT-free;
if a VAT-registered business sells through it, those sales under-declare VAT
relative to invoices raised on the Invoices screen. Worth confirming intent.

---

## Test evidence

* `src/services/__tests__/posSalePostingIntegrity.test.ts` (new, 4 tests) —
  real `journalService`, stubbed repositories: discounted sale posts a balanced
  entry with the 4130 discount line; credit sale posts the receivable only and
  no cash; replayed sale posts no second ledger entry; replayed sale releases
  no second batch of stock.
* `src/offline/__tests__/posSaleSync.test.ts` (+2 tests) — an abandoned
  `syncing` claim is counted and retried to `synced`; a claim inside its lease is
  left alone.
* Full suite: 65 files / 557 tests green; `tsc -b` clean; lint 0 errors.
