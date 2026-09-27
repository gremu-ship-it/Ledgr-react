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
