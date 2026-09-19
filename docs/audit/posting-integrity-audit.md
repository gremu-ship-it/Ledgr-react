# Posting integrity audit — POS / invoice / quick-save flows

Date: 2026-09-19
Branch: `arena/01a0ba6f-ledgr-react` (follows PR #157, "route offline POS sales
through the app-wide offline queue")
Scope: every ledger write reachable from a till sale, a quick income entry, an
invoice-builder invoice, an expense and a payroll run — plus the retry/queue
machinery that can replay any of them.

Method: read the posting path end to end (service → repository → migration,
and the SQL quick-save RPC), then lock the conclusions with tests. The fixes
below span `posService`, `queueApi`/`syncEngine`, the inventory repository, the
journal posting functions, `UsageService`, `PosPage` and two migrations.

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| F1 | A discounted POS sale posted **no** ledger entry at all | High | Fixed |
| F2 | A credit POS sale posted **cash received** it never received | High | Fixed |
| F3 | A replayed sale could post the ledger and the stock release twice | High | Guarded (baseline) |
| F4 | A sale abandoned mid-sync stayed invisible on the device forever | Medium | Fixed |
| F5 | POS sales history read `subtotal` as gross after the header fix | Low | Fixed |
| F6 | Derived idempotency keys cannot be stored in the uuid `client_key` columns | High | Fixed (derived uuids) |
| O1 | The retry helper wraps non-idempotent ledger writers | High | Fixed (keyed postings) |
| O2 | Tender type never reaches the ledger (cash / mobile money / card) | Medium | Fixed (tender routing) |
| O3 | Usage-limit guard counts journal entries and runs after the document write | Medium | Fixed (document count, pre-write) |
| O4 | POS VAT rate is hard-coded to 0 | Low | Fixed (business VAT flag) |

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

This closes the replay paths the queue itself can take, and it was the
right-sized fix at the time: a replay either finds both guards hit (fully
committed sale) or neither (nothing written yet). The follow-up change below
tightens both for the paid-sale case, because a sale can also be replayed
*inside* one commit — between the sale entry and its receipts — where "skip
everything" and "post everything" are both wrong: the ledger guard now applies
to credit sales only (a paid sale's halves are keyed individually, so a replay
resumes what is missing), and the stock release is both keyed and checked.

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

## Fixed in the follow-up change

### F6 — Derived idempotency keys could not be stored (High)

Found while verifying O1, by asking what actually happens to these keys at the
database rather than at the mock.

A sale needs more than one idempotency key: the invoice has its `client_key`,
and so does each payment row and each stock movement, because a replay can be
interrupted between them. The keys were spelled out of the parent — 

```ts
`${clientKey}:pmt:${index}`     // a tender leg
`${invoice.id}:mv:${i}`         // a sale line's stock movement
```

— which is readable and deterministic, and cannot be stored. `client_key` is a
**uuid** column (`20260813000003_add_client_key_idempotency.sql`, and the
captured schemas agree: `stock_movements.client_key`, `invoice_payments.client_key`
are `uuid`), and PostgreSQL has no implicit text→uuid cast. PostgREST binds the
JSON body value as an untyped literal and the *column type* decides, so the
insert fails with 22P02 (`invalid input syntax for type uuid`). A uuid whose
text form contains `:pmt:` does not exist, so no amount of SQL-side casting
helps — the value itself has to be a uuid.

The two consequences, both silent to the test suite because the repositories
are mocked:

* **Payments.** The tender row is never inserted, so `recordPayment` throws and
  `commitPosSaleDocuments` raises `PosSalePostCommitError`: the sale is saved,
  the cash it took is not, and the cashier gets a warning to fix up later.
* **Stock.** `recordMovements` throws, `deductStockAndPostCogs` rethrows, and
  the sale's stock release and COGS entry are skipped — with a warning, but
  with inventory and cost of sales wrong until someone reconciles.

Fix: `src/lib/clientKeys.ts` — `deriveClientKey(parentKey, ordinal)` returns a
real, valid uuid, stable for the same inputs and different for every ordinal
(the ordinal occupies the last 12 hex digits, so sub-keys of one document can
never collide; the first 72 bits are a digest of the parent, so two documents
collide only if 72 bits agree, which would surface as a loud unique violation
rather than silent corruption). Both call sites go through it, and a
source-level guard test now fails if any `client_key` write is a template
literal or concatenation again.

This is the class of bug the audit was for: the code reads correctly, the tests
pass, and only the column type knows better — which is why the fix ships with a
test that asserts the key's *shape*, not just its value.

### O1 — Non-idempotent ledger writers, behind a retrying helper (High)

`retryNonCritical` gives a write two attempts, and it wrapped
`deductStockAndPostCogs`, `createInvoiceJournalEntry`,
`createInvoiceReceivableEntry` and `createExpenseJournalEntry`. A lost response
or a client-side timeout *after* the server committed made the second attempt
post the same revenue, cash or cost of sales again — the queue guards from F3
could not help, because the retry happens inside one commit.

Fix: every automatic posting now carries a deterministic key in the new
`journal_entries.posting_key` column, and the posting functions resume rather
than repeat.

* **Migration** `20260921000000_journal_posting_key_idempotency.sql` adds the
  column and a partial unique index on `(business_id, posting_key) where
  posting_key is not null` — the database backstop, so even a race that slips
  past the client-side lookup cannot duplicate an entry. A new column was used
  instead of the existing `reference` because `reference` is free text typed by
  users in the journal-entry form; a unique index on it would reject a second
  manual entry that legitimately repeats a reference.
* **`postKeyedEntry`** (`journalService`, exported for the inventory module)
  looks the key up first: no entry → create and post; posted entry → return it
  (the retry is a no-op); draft entry → post it (a crash between insert and post
  left the ledger half-written, and the retry finishes it). A unique violation
  is unwrapped from the repository error and turned into the same resume, so two
  racing attempts still converge on one entry.
* **Keys**: `invoice:<id>:sale`, `invoice:<id>:receipt`,
  `invoice:<id>:settlement:<paymentId>`, `invoice:<id>:cogs`, `expense:<id>`,
  `expense:<id>:payment:<paymentId>`, `payroll:<runId>`.
* **Stock movements** now carry a key derived from the invoice and the line's
  position (`deriveClientKey(invoice.id, i)` — see F6 for why it is not spelled
  out in words) and `InventoryRepository.recordMovements` pre-filters keys it
  has already recorded (the unique `(business_id, client_key)` index already
  existed from `20260813000003`). Indexing by position in the sale's line list
  means a replay of the same payload rebuilds identical keys.

### O2 — Tender type never reached the ledger (Medium)

Every sold item was debited to 1110 Cash on Hand whatever the tender: the
payment rows carried the method (cash / airtel_money / card / other) but the
auto-receipt posted to the cash account only, and `bank_account_id` — the field
`createInvoiceSettlementEntry` already honours — was never set by the till. Cash
on hand therefore overstated the drawer for card and mobile-money takings, and
the shift's cash count could not be tied to it.

Fix, in `commitPosSaleDocuments`:

* the sale posts as a receivable entry (DR Debtors / CR Revenue [+VAT] / DR
  discount), and each tender then posts its own receipt — DR the account the
  money landed in / CR Debtors;
* `resolveTenderAccountId` decides that account at commit time (an offline till
  has no accounts list, and the sync replay does): the payment's own
  `bank_account_id` when set, cash → 1110, `airtel_money` → 1125,
  `tnm_mpamba` → 1126, card / bank transfer / cheque → the business's first
  bank account. An unresolvable non-cash tender still posts (to cash on hand)
  and says so in a warning, because a misclassified account is a smaller
  problem than a sale with no ledger entry;
* the resolved account is also stamped on the `invoice_payments` row, so the
  sub-ledger shows where the money went.

### O3 — Usage-limit guard counted entries and ran after the document (Medium)

`checkUsageLimit` counted `journal_entries`, so one till sale consumed two or
three units (sale, auto-receipt, COGS) of a plan that is sold in
*transactions*; it ran from the journal posting, i.e. after the invoice row
existed, so tripping it left an unposted invoice behind (a warning at the till,
an error on the Income screen); and the receivable/settlement paths never
checked it at all.

Fix:

* `UsageService` counts **documents** — invoices + expenses + payroll runs
  whose date falls in the month — in both
  `getCurrentMonthTransactionCount` and, server-side,
  `_ledgr_assert_usage_limit` (migration
  `20260921000001_usage_limit_counts_documents.sql`), so the client's usage
  meter and the RPC guard agree. `percentUsed` also keeps one decimal now:
  the lower count exposed that a whole-percent rounding turned a used month
  (8 documents of 2,000) back into "0%", which would have hidden the count
  from both the user and the 80%/100% warnings. The meter still prints a
  rounded label;
* the guard runs **before the document is written**:
  `usageService.assertCanCreateDocument(businessId, clientKey)` is the first
  step of `commitPosSaleDocuments` and runs before `createWithLines` in the
  sync engine's invoice, expense and payroll branches. A sale that hits the
  limit is refused whole rather than half-written, and a queued offline sale
  fails visibly in the offline drawer with the limit message;
* a *replay* of an already-committed document is exempt
  (`InvoiceRepository`/`ExpenseRepository`/`PayrollRepository.findByClientKey`
  — the last two made public for this), so a sale whose ledger half failed is
  never stranded by a limit that filled up in the meantime. The lookup runs
  against the table the key belongs to, so an expense replay is not mistaken
  for an invoice replay;
* the guard was removed from the posting functions: with the count now
  inclusive of the document being posted, checking there would refuse the
  ledger for the very sale that reached the limit.

### O4 — POS VAT rate was hard-coded to 0 (Low)

`PosPage` totalled every cart with `calculateCartTotals(items, discount, 0)`,
so a VAT-registered business's till sales carried `vat_amount: 0` — no 2121 line
and no VAT on the invoice — while the same sale raised on the Income screen
declared VAT. The two halves of one month's VAT return disagreed.

Fix: the page reads the business's `vat_registered` flag (the same rule as
IncomePage, ExpensesPage and the mobile quick-expense sheet) and applies
`VAT_STANDARD_RATE` to the cart. POS prices are VAT-inclusive, so the rate
extracts the tax from the price the customer pays. The shown totals are also
passed to `normalizePosSale` (`totals: cartTotals`), so the queued and offline
paths store exactly the numbers the receipt showed.

---

## Known limitations / follow-ups

* **Per-line VAT on a POS invoice.** The header carries the right `vat_amount`
  and `subtotal` (both conventions verified: `subtotal + VAT = total`, VAT
  extracted from inclusive prices), but the till's invoice lines still carry
  `tax_amount: 0` and `tax_code: 'none'` because the cart applies a single
  business-level rate rather than a per-product one. Line-level VAT split is
  the remaining piece for VAT returns that analyse by line.
* **Usage metric is a product decision.** Counting documents lowers every
  business's reported monthly usage relative to the old journal-entry count
  (the demo month goes from 13 to 8). The pricing page has always said
  "transactions", so this aligns the number with the promise — but if any
  plan was sized against the old, inflated number, the tier limits should be
  revisited rather than silently re-priced.
* **`client_key` is a uuid, and that constrains key spelling.** Anything that
  wants a legible compound key (`invoice:<id>:line:3`) has to derive a uuid
  from it (see `src/lib/clientKeys.ts`) or add a text column; the ledger's new
  `posting_key` is `text` precisely so the journal keys can stay readable. The
  captured schemas (`artifacts/database/fresh-schema.json`,
  `staging-schema-inventory.json`) are what the type contract was checked
  against; `tests/database/` can exercise it against a real Postgres
  (`npm i -D embedded-postgres pg`) but is not wired into CI.
* **`reference` stays free text.** Keyed postings use `posting_key`; the
  user-facing `reference` field and its search in the Journals list are
  untouched.
* **Non-POS journal writers are not keyed.** Manual entries
  (`NewJournalEntryModal`), tax, capital, fixed-asset and FX-revaluation
  postings are user-initiated one-shot writes that are not retried
  automatically, so they keep `posting_key = null`. If any of them ever moves
  behind a retry, it needs a key first. The same goes for the warehouse
  receipt (`stock_receipt`) and stock adjustment postings in
  `inventoryJournalService`: they post through `createBalancedEntry` directly,
  but their callers are one-shot screens and the functions swallow their own
  errors, so they are not reached by `retryNonCritical`.

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
* `src/services/__tests__/posSalePostingIntegrity.test.ts` (7 tests, +3) — a
  tender split settles Airtel Money into 1125 and cash into 1110, each with its
  own balanced receipt; a keyed entry left as a draft is posted rather than
  recreated; a sale over the plan limit is refused before anything is written,
  while the replay of a committed sale is allowed through.
* `src/lib/__tests__/clientKeys.test.ts` (new, 8 tests) — a derived key is a
  uuid, is stable across calls, differs per ordinal and per parent, survives
  parents that are not uuids and ordinals that are junk, fills its whole width
  rather than repeating one hash lane, and a source scan over every non-test
  file in `src` refuses a `client_key` written as a template literal or
  concatenation.
* `src/lib/billing/__tests__/usageGuard.test.ts` (new, 7 tests) — the
  pre-write plan guard: it refuses at the limit, checks the client key before
  refusing, lets a replayed invoice *and* a replayed expense through (each via
  its own table), keeps the refusal when the lookup finds nothing, and fails
  open when the plan cannot be read.
* `src/services/__tests__/posService.test.ts` (11), `posIntegration.test.ts`
  (2), `posSaleOfflineSync.test.ts` (6), `offline/__tests__/posSaleSync.test.ts`
  (4), `lib/billing/__tests__/plans.test.ts` and
  `lib/demo/__tests__/demoPlanAccess.test.ts` — updated for the document-count
  metric and the pre-write guard.
* Full suite: 65 files / 560 tests green; `tsc -b` clean; `npm run lint` 0 errors
  (one pre-existing warning in `artifacts/database/fresh-database.generated.approx.ts`,
  untouched here). Also verified: the two new migrations are the only new files
  under `supabase/migrations/` and the superseded `reference`-based draft is gone.
