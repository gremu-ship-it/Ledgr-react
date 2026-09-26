# P0 — Production evidence preservation runbook (Incident Containment 2026-09-25)

**Status:** NOT EXECUTED. The agent that wrote this has no production access. An authorised operator must run it.
**Run it BEFORE** deploying the containment migrations `20261011000000`–`20261011000004`. The migrations change function bodies and grants but no data, and the evidence must show the state before any change.
**Nature:** read-only. Every statement is a `SELECT`, `COPY (SELECT …) TO STDOUT` or `pg_dump --schema-only`, or a read-only GitHub, Vercel or Supabase API call. No `UPDATE`, `DELETE`, `TRUNCATE`, DDL or repair.
**Secrets:** use environment variables only. Never paste tokens, passwords or connection strings into tickets, chat or the evidence bundle. The bundle holds data and metadata only. It contains **customer financial data**, so store it encrypted and restrict access to the owner and the investigator.

Production project ref: `hsuhuvuxfuufrlejsatw`. GitHub repo: `gremu-ship-it/Ledgr-react`.

---

## 0. Set up (operator workstation)

```bash
export EVID="ledgr-evidence-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$EVID"/{db,schema,gh,vercel,supabase}; cd "$EVID"
# Direct (not pooled) read-only connection. Get the password from the Supabase dashboard. DO NOT echo it.
export PGHOST=db.hsuhuvuxfuufrlejsatw.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PGSSLMODE=require
read -rs PGPASSWORD; export PGPASSWORD
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=0'
psql -Atc "select now(), current_setting('transaction_read_only')" | tee db/_session.txt   # must print "on"
```

Use one consistent snapshot for all the data tables:

```bash
psql -v ON_ERROR_STOP=1 <<'SQL' > db/_snapshot.log
begin isolation level repeatable read read only;
select pg_export_snapshot() as snapshot_id, now() as snapshot_at \gset
\echo :snapshot_id :snapshot_at
commit;
SQL
```

(Or run section 1 inside a single `begin isolation level repeatable read read only; … commit;` psql session, as the script below does.)

## 1. Financial and stock data (full-table CSV, one consistent read)

```bash
psql -v ON_ERROR_STOP=1 <<'SQL'
begin isolation level repeatable read read only;
\copy (select * from public.inventory_balances order by business_id, product_id, location_id) to 'db/inventory_balances.csv' csv header
\copy (select * from public.stock_movements order by business_id, created_at, id) to 'db/stock_movements.csv' csv header
\copy (select * from public.journal_entries order by business_id, entry_date, id) to 'db/journal_entries.csv' csv header
\copy (select * from public.journal_lines order by journal_entry_id, id) to 'db/journal_lines.csv' csv header
\copy (select * from public.invoices order by business_id, created_at, id) to 'db/invoices.csv' csv header
\copy (select * from public.invoice_lines order by invoice_id, line_number) to 'db/invoice_lines.csv' csv header
\copy (select * from public.invoice_payments order by business_id, created_at, id) to 'db/invoice_payments.csv' csv header
\copy (select * from public.expenses order by business_id, created_at, id) to 'db/expenses.csv' csv header
\copy (select * from public.expense_lines order by expense_id, line_number) to 'db/expense_lines.csv' csv header
\copy (select * from public.expense_payments order by business_id, created_at, id) to 'db/expense_payments.csv' csv header
\copy (select * from public.inventory_locations order by business_id, id) to 'db/inventory_locations.csv' csv header
\copy (select * from public.audit_log order by created_at, id) to 'db/audit_log.csv' csv header
-- Drift view shipped in 20260925000001 (read-only)
\copy (select * from public.v_inventory_balance_ledger_drift) to 'db/v_inventory_balance_ledger_drift.csv' csv header
-- Row counts + checksums so the export can be verified later
\copy (select 'inventory_balances' t, count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.inventory_balances x union all select 'stock_movements', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.stock_movements x union all select 'journal_entries', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.journal_entries x union all select 'journal_lines', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.journal_lines x union all select 'invoices', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.invoices x union all select 'invoice_payments', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.invoice_payments x union all select 'expenses', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.expenses x union all select 'expense_payments', count(*), md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.expense_payments x) to 'db/_counts_checksums.csv' csv header
commit;
SQL
```

If a table does not exist on production (for example, if `inventory_balances` has no `id` column there), record the error in `db/_errors.txt` and continue. Do **not** create anything. That difference is itself evidence of out-of-band schema drift.

### 1a. Incident-specific slices (quick triage copies)

```bash
psql -v ON_ERROR_STOP=1 <<'SQL'
\copy (select * from public.stock_movements where movement_type = 'opening_balance' or source_type in ('backfill','recalc','repair') order by created_at) to 'db/slice_opening_backfill_movements.csv' csv header
\copy (select * from public.stock_movements where created_at >= '2026-09-24' order by created_at) to 'db/slice_movements_since_0924.csv' csv header
\copy (select * from public.journal_entries where created_at >= '2026-09-24' order by created_at) to 'db/slice_journals_since_0924.csv' csv header
\copy (select i.* from public.invoices i where not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id)) to 'db/slice_invoices_without_lines.csv' csv header
\copy (select i.id, i.invoice_number, i.total_amount, i.amount_paid, coalesce(sum(p.amount),0) paid_rows from public.invoices i left join public.invoice_payments p on p.invoice_id = i.id group by i.id having abs(i.amount_paid - coalesce(sum(p.amount),0)) > 0.01) to 'db/slice_invoice_amount_paid_mismatch.csv' csv header
\copy (select p.* from public.invoice_payments p where p.journal_entry_id is null) to 'db/slice_payments_without_journal.csv' csv header
\copy (select i.id, i.invoice_number, i.created_at from public.invoices i where i.invoice_type = 'sales' and exists (select 1 from public.invoice_lines l join public.products pr on pr.id = l.product_id where l.invoice_id = i.id and pr.track_inventory) and not exists (select 1 from public.journal_entries j where j.posting_key = 'invoice:' || i.id || ':cogs')) to 'db/slice_stock_sales_without_cogs.csv' csv header
SQL
```

## 2. Schema, migrations, functions, triggers, RLS, grants

```bash
pg_dump --schema-only --no-owner --schema=public --schema=supabase_migrations -f schema/schema_public.sql
psql -v ON_ERROR_STOP=1 <<'SQL'
\copy (select * from supabase_migrations.schema_migrations order by version) to 'schema/schema_migrations.csv' csv header
\copy (select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef security_definer, md5(pg_get_functiondef(p.oid)) def_md5, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 2,3) to 'schema/functions.csv' csv header
\copy (select event_object_table tbl, trigger_name, action_timing, event_manipulation, action_statement from information_schema.triggers where trigger_schema='public' order by 1,2,4) to 'schema/triggers.csv' csv header
\copy (select tgrelid::regclass tbl, tgname, tgenabled, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'pg_%' order by 1,2) to 'schema/triggers_enabled_state.csv' csv header
\copy (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='public' order by 2,3) to 'schema/rls_policies.csv' csv header
\copy (select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1) to 'schema/rls_enabled.csv' csv header
\copy (select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role','PUBLIC') order by 1,2,3) to 'schema/table_grants.csv' csv header
\copy (select p.proname, pg_get_function_identity_arguments(p.oid) args, a.grantee::regrole::text grantee, a.privilege_type from pg_proc p join pg_namespace n on n.oid=p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where n.nspname='public' order by 1,2,3) to 'schema/function_grants.csv' csv header
\copy (select conrelid::regclass tbl, conname, contype, convalidated, pg_get_constraintdef(oid) def from pg_constraint where connamespace='public'::regnamespace order by 1,2) to 'schema/constraints.csv' csv header
SQL
```

**Key checks to record explicitly** (they answer open questions in the crawl):

```sql
-- Which balance writers/triggers are actually live on production (single-writer, 20261009000000)?
select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger where tgrelid in ('public.stock_movements'::regclass,'public.inventory_balances'::regclass) and not tgisinternal;
-- Was 20261010000000 (Eagle Nova data repair) applied, and when?
select version, name, statements is not null has_statements from supabase_migrations.schema_migrations where version >= '20260924000000' order by version;
-- Migration versions on production that are NOT in the repository: compare with `ls supabase/migrations`.
```

To find **out-of-band DDL** (SUSPECTED in the crawl), compare `schema/functions.csv` `def_md5` against a fresh local replay of the repo's migrations at the commit that was deployed. Do not guess provenance from timing.

## 3. Supabase platform logs and metadata (Management API, read-only)

```bash
export SUPABASE_ACCESS_TOKEN=…   # read from your secret store; never commit
REF=hsuhuvuxfuufrlejsatw
# Postgres logs (DDL, errors, 42501s) — adjust the window; the Logs Explorer retains a limited period, so run this FIRST
for day in 2026-09-24 2026-09-25; do
  curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    --get "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs.all" \
    --data-urlencode "iso_timestamp_start=${day}T00:00:00Z" --data-urlencode "iso_timestamp_end=${day}T23:59:59Z" \
    --data-urlencode "sql=select timestamp, event_message, metadata from postgres_logs where regexp_contains(event_message, '(?i)(create|alter|drop|grant|revoke|comment on|update public.inventory|42501|backfill_and_recalculate)') order by timestamp" \
    > "supabase/postgres_logs_$day.json"
done
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF" | jq 'del(.. | .database_password?, .anon_key?, .service_role_key?)' > supabase/project.json
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF/functions" | jq '[.[] | {slug, version, status, updated_at, verify_jwt}]' > supabase/edge_functions.json
```

Also export the **Dashboard → Settings → Audit logs** (organisation audit trail: who ran SQL editor queries, changed settings or used the Management API) as CSV for 2026-09-20 → today. Management API `database/query` calls made by the repair workflow appear there as token activity.

## 4. GitHub Actions — repair runs, deploy runs, artifacts

```bash
R=gremu-ship-it/Ledgr-react
gh run list -R $R --workflow repair-eagle-nova-double-count.yml --limit 100 --json databaseId,headSha,event,status,conclusion,createdAt,actor > gh/repair_runs.json
gh run list -R $R --workflow deploy.yml --limit 100 --json databaseId,headSha,event,status,conclusion,createdAt > gh/deploy_runs.json
for id in $(jq -r '.[].databaseId' gh/repair_runs.json gh/deploy_runs.json); do
  gh api repos/$R/actions/runs/$id/jobs > gh/jobs_$id.json
  for job in $(jq -r '.jobs[].id' gh/jobs_$id.json); do
    gh api repos/$R/check-runs/$job/annotations > gh/annotations_${id}_$job.json   # `gh run view --log` returns empty for these runs
    gh api repos/$R/actions/jobs/$job/logs > gh/log_${id}_$job.txt 2>/dev/null || true
  done
  mkdir -p gh/artifacts_$id && gh run download $id -R $R -D gh/artifacts_$id 2>/dev/null || true
done
gh api repos/$R/deployments --paginate > gh/deployments.json
```

**Do not delete or re-run** any workflow run. GitHub keeps logs for a limited time (default 90 days), so download them now.

## 5. Vercel deploy metadata (there are several projects: ledgr-react, -prod, -hp5u)

```bash
export VERCEL_TOKEN=…   # secret store
for p in ledgr-react ledgr-react-prod ledgr-react-hp5u; do
  curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v6/deployments?app=$p&limit=100&since=$(date -d 2026-09-19 +%s)000" \
    | jq '[.deployments[] | {uid, url, state, target, created, meta: {githubCommitSha: .meta.githubCommitSha, githubCommitRef: .meta.githubCommitRef}}]' > vercel/deployments_$p.json
done
# Which project/deployment serves the production domain right now?
curl -sS https://<production-domain>/version.json -o vercel/live_version.json || echo "version.json not yet deployed (pre-containment build)" > vercel/live_version.txt
```

For each failed deployment on 2026-09-24 (19:12 / 19:17 UTC), save the build log: `vercel inspect <url> --logs > vercel/build_<uid>.log` (the Vercel CLI uses `VERCEL_TOKEN`).

## 6. Seal

```bash
cd .. && find "$EVID" -type f -print0 | sort -z | xargs -0 sha256sum > "$EVID.sha256"
tar czf "$EVID.tgz" "$EVID" && gpg --symmetric --cipher-algo AES256 "$EVID.tgz" && shred -u "$EVID.tgz"
```

Record who ran it, when (UTC), from where, and the sha256 of the `.tgz.gpg` in the incident log. Keep the unencrypted directory off shared drives.

## 7. Only after sealing

Deploy the containment package (see the report's §9). Do not run `backfill_and_recalculate_inventory`, the repair workflow, or migration `20261010000000` again. Any data repair needs a separate, owner-authorised package.
