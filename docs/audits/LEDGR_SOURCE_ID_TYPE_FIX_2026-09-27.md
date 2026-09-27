# Repair SQL failed with `uuid = text` (2026-09-27)

## What happened
- The owner ran `20261013000001_ledgr_repair_2026_09.sql` in the Supabase SQL editor and got `42883 operator does not exist: uuid = text` at `sm.source_id = i.id::text`.
- On the database it ran against, `stock_movements.source_id` is **uuid**. In the repository schema it is **text**, and all local tests used the repository schema, so they could not catch this.
- `plan_2026_09` is a `language sql` function, so PostgreSQL type-checks it at creation time. The script has no BEGIN/COMMIT of its own. Whether statements before the failure (`create schema ledgr_repair`, its tables) persisted depends on how the editor batches the script. **Unverified.** They are all `if not exists`, so a re-run is safe.

## Which database? (unresolved)
- `20260911000002` says the live `stock_movements.source_id` and `journal_entries.source_id` (and `created_by`) are uuid.
- Yet the code production runs today (f671656) writes text into `source_id`:
  - `post_pos_sale` writes `p_invoice_id::text`;
  - the R07 void writes composite keys like `<invoice>:<key>`;
  - `save_quick_sale` and `save_quick_expense` (as rewritten in `20261007000000_p5d`) write `v_invoice_id::text` and `v_expense_id::text`.
- On a uuid column, all of those would fail. So either the database that ran this is not the one serving live till sales (it may be staging), or those till and quick-save paths fail there. This is not verified either way; the owner should confirm (see §4).

## Fix (unreleased migrations only; no historical migration edited)
- **Comparisons:** every `source_id` comparison in the unreleased migrations is now `source_id::text = <id>::text`. This works with either column type.
- **Inserts:** unreleased code writes uuid-typed values into `source_id` (for example `p_invoice_id`, `v_key`, `r.object_ref::uuid`). A uuid value fits a uuid column directly and is assigned to a text column automatically. This is the pattern `20260911000002` established.
- **`save_quick_sale`** (redefined in `20261011000001`) is back to the `20260911000002` form, with a uuid `source_id` and `nullif(created_by,'')::uuid`.
- **`created_by` on till and invoice stock releases is left as it was.** Till invoices can carry a `created_by` that is not a uuid. Casting it broke 17 R09 tests, so that change was reverted.

## Test coverage
- New opt-in harness mode: `LEDGR_R13_LIVE_UUID_SHAPE=1`.
  - Before the first unreleased migration, it switches `stock_movements` and `journal_entries` `source_id` and `created_by` to uuid, as `20260911000002` describes production.
  - It is local only; no product migration is edited.
- Three test fixtures that seeded non-uuid `source_id` literals now use `gen_random_uuid()`. This is a fixture change only; no assertions changed.
- Gate results:
  - repo shape: 820 / 0 / 54, run twice, identical record by record (one extra run hit the known-flaky R094.BROWSER.PERSIST-RESTART);
  - uuid shape: 820 / 0 / 54.
- Known limit: in the uuid shape, the existing till void path (composite keys) would still fail. The tests use the repo shape for that path. That path is from before this work and is not changed here.

## 4. Owner actions
1. Which project did you run this in: `hsuhuvuxfuufrlejsatw` (prod) or `bkxzgkurcqvccsdjmqzg` (staging)?
2. On that project, run this read-only query and share the result:
   `select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('stock_movements','journal_entries','invoices') and column_name in ('source_id','created_by');`
3. Don't paste migrations into the SQL editor. Apply them through the reviewed merge/deploy path, then run the size workflow. That keeps the evidence chain intact.

## 5. Update: the owner confirmed the column types (2026-09-27)
The owner's `information_schema` output shows these are all **uuid**: `invoices.created_by`, `journal_entries.source_id`, `journal_entries.created_by`, `stock_movements.source_id` and `stock_movements.created_by`. The project it came from has not been stated yet.

Fixed (unreleased code only):
- `post_pos_sale` now records `created_by` as the signed-in user (`auth.uid()`). With no signed-in user, it takes the payload value only if it is a well-formed uuid, via the new `_ledgr_try_uuid`. The till client used to send the cashier's **display name** there, which a uuid column cannot store.
- The client (`posService`) now sends `cashierId` as `created_by`. Receipt reprints show "Cashier" rather than a raw uuid.
- The stock backfill functions cast `created_by` to uuid.
- The harness's uuid mode now also covers `invoices.created_by` and `invoice_payments.created_by`. The R06 fixture labels now map to fixed uuids (`md5(label)::uuid`).

**Found, NOT fixed. This code is already in production (f671656).** On a database shaped like this, these fail with `uuid = text` or text→uuid errors:
- `close_pos_shift_command` (20260930000003);
- `refund_pos_sale_command` and `void_pos_sale_command` (20260928000002), which compare text with uuid, write `auth.uid()::text`, and write composite `<invoice>:<key>` keys into `source_id`;
- `save_quick_sale` and `save_quick_expense` as rewritten by 20261007000000.

If this is the live production database, closing shifts, refunds, voids and quick-save would be failing today. Before rewriting the R07/R08 commands, the owner must confirm which project this is and whether those features work (see the chat for the read-only queries). The R07/R08 behaviour itself will not change; only the types need correcting.

## 6. Production diagnostics (owner, 2026-09-27, project hsuhuvuxfuufrlejsatw, read-only)
- **Production runs the repository's function bodies.** `pg_get_functiondef` shows `_ledgr_complete_pos_sale`, `refund_pos_sale_command`, `void_pos_sale_command` and `save_quick_sale` with the same text-typed `source_id`/`created_by` writes as the repo. `accounting_periods.closed_by` is uuid.
- **On a uuid-shaped database those functions cannot complete** (42883/42804). The data is consistent with that, but that is not proof of cause:
  - `pos_shifts`: no shift has ever been closed (`max(closed_at)` is null);
  - no `pos_void` or `pos_refund` stock movements in 30 days.
- **Invoices and stock movements (last 14 days):**
  - 50 invoices, dated 13–22 Sep; 48 of them have stock movements;
  - **no invoice dated after 22 Sep**; the last `invoice` stock movement is 2026-09-23 10:06 UTC.

  Whether that means no trading or saves failing is **unknown**; it needs confirmation from staff and the Supabase API/Postgres logs. The deploy of f671656 was 2026-09-25, after this gap began, so it is not assumed to be the cause.
- **No periods are closed.** The period lock changes nothing on deploy.
- **Stock locations:** about 25 locations across several businesses, including several "Main Warehouse" defaults. A branch-level "Head Office" location shows −2 units. Branches named "Lilongwe Branch" and "Blantyre Branch" exist both **with** locations (with 25 and 18,008 units) and **without** them. Presumably these are same-named branches in different businesses; a business-scoped check is pending.

## 7. Fix: `20261014000001_live_uuid_shape_pos_commands.sql`
Five functions are re-issued from their latest definitions, with type-only edits (see the migration header):
- `void_pos_sale_command`
- `refund_pos_sale_command`
- `close_pos_shift_command`
- `get_pos_shift_report`
- `save_quick_expense`

R07 correction keys move from `source_id` (`<invoice>:<key>`, which cannot be stored in a uuid column) to `notes` (`correction key K`). One test query in r08 was made type-agnostic. The till, correction and shift suites pass in both shapes (146 in each).

## 8. Business-scoped results (owner, 2026-09-27)
- **Branches without a stock location:** "Lilongwe Branch" (2 invoices ever, last 2026-09-01) and "Blantyre Branch" (0 invoices), both in the **Ledgr Technologies** business. No trading customer is affected, so this is **not a deploy blocker**. A location can be added in the app at any time.
- **Last invoice created, per business:**
  - Eagle Nova Horizon Holdings: 319 invoices, last on **2026-09-23 10:06 UTC**;
  - Eagle Nurseries: 90 invoices, last on **2026-09-23 09:37 UTC**;
  - Demo company Ltd: 2026-09-11;
  - Ledgr Technologies: 2026-09-01;
  - 8 other businesses have no invoices.
- Both trading businesses stopped recording invoices within 30 minutes of each other, on the morning of 23 Sep. Before that they recorded invoices on most days.
- **Hypothesis, NOT established:** production's `_ledgr_complete_pos_sale` writes `p_invoice_id::text` into the uuid `stock_movements.source_id`. If till sales started reaching that path around 23 Sep, every till sale containing a stock item would fail (42804) and roll back, invoice included. Test it against the Postgres logs and with staff before acting on it. Timing alone is not treated as proof of cause.
