// Phase 8B.5+8B.6 — application workflow + accounting integrity tests.
// Exercises the app's DB-backed flows with fake data on a fresh replay,
// verifying DEBITS = CREDITS for every transaction type.
const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54329;
const MIG_DIR = '/home/user/Ledgr-react/supabase/migrations';

async function main() {
  const PG = new EP({ databaseDir: '/tmp/pgtest/data', user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync('/tmp/pgtest/data', { recursive: true, force: true });
  await PG.initialise();
  await PG.start();
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
  END $$; GRANT anon, authenticated, service_role TO authenticator;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role; GRANT SELECT ON auth.users TO anon, authenticated, service_role;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE IF NOT EXISTS storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ select string_to_array(name, '/') $$;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;
    GRANT ALL ON storage.buckets TO anon, authenticated, service_role;`);
  const EXT = '/tmp/pgtest/node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension';
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron;\ncreate table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true);\ncreate sequence if not exists cron.jobid_seq;\ncreate or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);

  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try { await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')); }
    catch (e) { console.log('REPLAY FAIL', f, '::', e.message.split('\n')[0]); process.exit(1); }
  }
  console.log('replay OK:', files.length, 'migrations');

  let pass = 0, failN = 0;
  const ok = (l) => { pass++; console.log('  PASS', l); };
  const fail = (l, e) => { failN++; console.log('  FAIL', l, '::', (e && (e.message || e)) || ''); };
  const q = (sql, params) => c.query(sql, params);

  try {
    // ── setup: owner + accountant + org ─────────────────────────────────────
    const ownerId = '10000000-0000-0000-0000-000000000001';
    const acctId = '10000000-0000-0000-0000-000000000002';
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'owner@x.com','{"full_name":"Owner"}'), ($2,'acct@x.com','{"full_name":"Acct"}')`, [ownerId, acctId]);
    const asUser = (uid) => async (sql, params) => {
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await q('set role authenticated');
      try { return await q(sql, params); } finally { await q('reset role'); }
    };
    const owner = await asUser(ownerId);
    const acct = await asUser(acctId);
    const biz = (await owner(`select public.create_business_with_owner('Workflow Co','Workflow',null,null,null,true,'MWK','07-01','Africa/Blantyre',null,'Blantyre','Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
    const tok = (await owner(`select public.invite_member($1, 'acct@x.com', 'accountant') as t`, [biz])).rows[0].t;
    await (await asUser(acctId))(`select public.accept_invitation($1)`, [tok]);
    ok('workflow: user registers, creates business, invites member, member accepts');

    // master data (workflow 3-6)
    const branch = (await owner(`insert into public.branches (business_id, name, is_active) values ($1,'HQ',true) returning id`, [biz])).rows[0].id;
    const dept = (await owner(`insert into public.departments (business_id, name, is_active) values ($1,'Ops',true) returning id`, [biz])).rows[0].id;
    const loc = (await owner(`insert into public.inventory_locations (business_id, name, is_active, is_default) values ($1,'Main',true,true) returning id`, [biz])).rows[0].id;
    const cust = (await owner(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Customer A','customer',true,false) returning id`, [biz])).rows[0].id;
    const supp = (await owner(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Supplier A','supplier',true,false) returning id`, [biz])).rows[0].id;
    const prod = (await owner(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency, cogs_account_id, inventory_account_id, sales_account_id)
      select $1,'Widget','WID','product',true,true,100,150,5,10,'none','vat_standard','MWK', (select id from public.accounts where business_id=$1 and code='5100'), (select id from public.accounts where business_id=$1 and code='1141'), (select id from public.accounts where business_id=$1 and code='4110') returning id`, [biz])).rows[0].id;
    ok('workflow: branch, department, location, customer, supplier, product created');

    // account codes
    const acc = async (code) => (await q(`select id from public.accounts where business_id=$1 and code=$2`, [biz, code])).rows[0].id;
    const acc1110 = await acc('1110'), acc1131 = await acc('1131'), acc1135 = await acc('1135');
    const acc2111 = await acc('2111'), acc2121 = await acc('2121'), acc2122 = await acc('2122');
    const acc1141 = await acc('1141'), acc2114 = await acc('2114'), acc5100 = await acc('5100');
    const acc6110 = await acc('6110'), acc2131 = await acc('2131'), acc4110 = await acc('4110');

    // helper: post a balanced journal entry (as the app's repos do)
    const postJournal = async (run, entry_number, entry_date, source_type, lines) => {
      const je = (await run(`insert into public.journal_entries (business_id, entry_date, entry_number, description, currency, exchange_rate, status, source_type, source_id)
        values ($1, $2, $3, $4, 'MWK', 1, 'posted', $5, $6) returning id`, [biz, entry_date, entry_number, entry_number, source_type, null])).rows[0].id;
      let i = 1;
      for (const [accountId, isDebit, amount] of lines) {
        await run(`insert into public.journal_lines (business_id, journal_entry_id, account_id, line_number, is_debit, amount, amount_base, currency, exchange_rate, description, reconciled, tax_amount, tax_code)
          values ($1,$2,$3,$4,$5,$6,$6,'MWK',1,$7,false,0,'none')`, [biz, je, accountId, i++, isDebit, amount, entry_number]);
      }
      return je;
    };

    // ── workflow 7: purchase (stock receipt) — DR inventory 1000 / CR GRNI 1000
    const jePur = await postJournal(owner, 'JE-PUR-1', '2026-07-05', 'stock_receipt', [[acc1141, true, 1000], [acc2114, false, 1000]]);
    await owner(`insert into public.stock_movements (business_id, product_id, location_id, movement_date, movement_type, quantity, unit_cost, total_cost, reference, source_type, source_id)
      values ($1,$2,$3,'2026-07-05','purchase',10,100,1000,$4,'stock_receipt',$5)`, [biz, prod, loc, 'PO-1', jePur]);
    ok('workflow 7: purchase recorded (stock receipt journal + stock movement)');

    // ── workflow 8: sale — DR COGS 700 / CR inventory 700 + DR AR 1500 / CR revenue 1500 (+ VAT)
    const jeCogs = await postJournal(owner, 'JE-SALE-COGS-1', '2026-07-10', 'inventory_cogs', [[acc5100, true, 700], [acc1141, false, 700]]);
    await owner(`insert into public.stock_movements (business_id, product_id, location_id, movement_date, movement_type, quantity, unit_cost, total_cost, reference, source_type, source_id)
      values ($1,$2,$3,'2026-07-10','sale',7,100,700,$4,'inventory_cogs',$5)`, [biz, prod, loc, 'SO-1', jeCogs]);
    const jeRev = await postJournal(owner, 'JE-SALE-REV-1', '2026-07-10', 'invoice', [[acc1131, true, 1500], [acc4110, false, 1250], [acc2121, false, 250]]);
    await owner(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost)
      values ($1,$2,$3,3,0,3,100)`, [biz, prod, loc]);
    ok('workflow 8: sale recorded (COGS + revenue journals)');

    // ── workflow 9: invoice + payment — invoice row + payment journal + increment RPC
    const inv = (await owner(`insert into public.invoices (business_id, contact_id, invoice_number, invoice_type, status, issue_date, due_date, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, taxable_amount, discount_amount, discount_percent, journal_entry_id, ar_account_id, revenue_account_id)
      values ($1,$2,'INV-0001','invoice','partially_paid','2026-07-10','2026-07-25','MWK',1,1500,0,1250,250,0,1250,0,0,$3,$4,$5) returning id`, [biz, cust, jeRev, acc1131, acc4110])).rows[0].id;
    const jePay = await postJournal(owner, 'JE-PAY-1', '2026-07-20', 'invoice', [[acc1110, true, 500], [acc1131, false, 500]]);
    await owner(`insert into public.invoice_payments (business_id, invoice_id, amount, payment_date, payment_method, currency, exchange_rate, journal_entry_id)
      values ($1,$2,500,'2026-07-20','bank_transfer','MWK',1,$3)`, [biz, inv, jePay]);
    await owner(`select public.increment_amount_paid('invoices', $1, 500)`, [inv]);
    ok('workflow 9-10: invoice created, payment recorded + increment_amount_paid RPC');

    // ── workflow 11: expense + payment — DR expense / CR cash
    const jeExp = await postJournal(owner, 'JE-EXP-1', '2026-07-12', 'expense', [[acc6110, true, 300], [acc1110, false, 300]]);
    const exp = (await owner(`insert into public.expenses (business_id, contact_id, expense_number, expense_type, expense_date, status, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, rate_is_stale, journal_entry_id, ap_account_id)
      values ($1,$2,'EXP-0001','general','2026-07-12','approved','MWK',1,300,300,300,0,0,false,$3,$4) returning id`, [biz, supp, jeExp, acc2111])).rows[0].id;
    await owner(`insert into public.expense_payments (business_id, expense_id, amount, payment_date, payment_method, currency, exchange_rate, journal_entry_id)
      values ($1,$2,300,'2026-07-12','cash','MWK',1,$3)`, [biz, exp, jeExp]);
    ok('workflow 12: expense + payment recorded');

    // ── workflow 13: bank reconciliation — statement + matched journal line
    const stmt = (await owner(`insert into public.bank_statements (business_id, account_id, statement_date, opening_balance, closing_balance)
      values ($1,$2,'2026-07-31',0,500) returning id`, [biz, acc1110])).rows[0].id;
    const jl = (await q(`select id from public.journal_lines where business_id=$1 and journal_entry_id=$2 limit 1`, [biz, jePay])).rows[0].id;
    await owner(`insert into public.bank_statement_lines (business_id, statement_id, transaction_date, description, debit_amount, credit_amount, is_reconciled, journal_line_id, match_method)
      values ($1,$2,'2026-07-20','Payment received',0,500,true,$3,'manual')`, [biz, stmt, jl]);
    await owner(`update public.journal_lines set reconciled = true where id=$1`, [jl]);
    ok('workflow 14: bank reconciliation (statement + matched line)');

    // ── workflow 15: payroll — DR salary expense / CR payables
    const emp = (await owner(`insert into public.employees (business_id, employee_number, first_name, last_name, employment_type, gross_salary, currency, is_active, payment_method, pay_frequency, start_date, tax_exempt, salary_account_id, paye_liability_account_id)
      select $1,'E1','John','Doe','full_time',400,'MWK',true,'bank_transfer','monthly','2025-01-01',false, a1.id, a2.id from public.accounts a1, public.accounts a2 where a1.business_id=$1 and a1.code='6110' and a2.business_id=$1 and a2.code='2122' returning id`, [biz])).rows[0].id;
    const jePayroll = await postJournal(owner, 'JE-PAYROLL-1', '2026-07-31', 'payroll_run', [[acc6110, true, 400], [acc2131, false, 400]]);
    const pr = (await owner(`insert into public.payroll_runs (business_id, run_number, payroll_period, period_start, period_end, pay_date, status, total_gross, total_net, total_paye, total_other_deductions, journal_entry_id)
      values ($1,'PR-0001','2026-07','2026-07-01','2026-07-31','2026-07-31','approved',400,400,0,0,$2) returning id`, [biz, jePayroll])).rows[0].id;
    await owner(`insert into public.payroll_employee_lines (business_id, payroll_run_id, employee_id, basic_salary, gross_pay, net_pay, paye_deduction, paye_taxable_income, other_deductions, total_allowances, total_deductions, pension_employee, pension_employer, payslip_generated, payment_method)
      values ($1,$2,$3,400,400,400,0,400,0,0,0,0,0,false,'bank_transfer')`, [biz, pr, emp]);
    ok('workflow 15-16: payroll run + lines');

    // ── accounting integrity: EVERY journal entry balances ──────────────────
    const unbalanced = (await q(`
      select je.entry_number,
        sum(case when jl.is_debit then jl.amount_base else 0 end) as d,
        sum(case when not jl.is_debit then jl.amount_base else 0 end) as c
      from public.journal_entries je
      join public.journal_lines jl on jl.journal_entry_id = je.id
      where je.business_id = $1 and je.status = 'posted'
      group by je.id, je.entry_number
      having abs(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)) > 0.005
    `, [biz])).rows;
    if (unbalanced.length === 0) ok('ACCOUNTING INTEGRITY: all 6 journal entries balance (DEBITS = CREDITS)');
    else fail('ACCOUNTING INTEGRITY: unbalanced entries', JSON.stringify(unbalanced));

    // trial balance equation
    const tb = (await q(`select sum(total_debits) d, sum(total_credits) c from public.v_trial_balance where business_id=$1`, [biz])).rows[0];
    if (Number(tb.d) === Number(tb.c) && Number(tb.d) > 0) ok(`trial balance: ${tb.d} = ${tb.c}`);
    else fail('trial balance equation', JSON.stringify(tb));

    // ── workflows 17-19: reports via views ──────────────────────────────────
    const ageing = (await q(`select count(*)::int n, coalesce(sum(amount_due),0)::numeric due from public.v_ar_ageing where business_id=$1`, [biz])).rows[0];
    if (ageing.n === 1 && Number(ageing.due) === 1000) ok(`workflow 18: AR ageing (1 open invoice, due ${ageing.due})`);
    else fail('AR ageing', JSON.stringify(ageing));
    const reg = (await q(`select count(*)::int n from public.v_asset_register where business_id=$1`, [biz])).rows[0].n;
    if (reg === 0) ok('workflow 19: asset register (no assets, empty)');
    else fail('asset register', reg);
    const alerts = (await q(`select count(*)::int n from public.v_reorder_alerts where business_id=$1`, [biz])).rows[0].n;
    if (alerts === 1) ok('workflow 20: reorder alert (7 left <= 10)');
    else fail('reorder alerts', alerts);

    // ── workflows 23: audit log + chain ─────────────────────────────────────
    await owner(`select public.log_manual_audit_event($1, 'invoice_paid', 'invoices', $2, 'INV-0001', null, '{"amount":500}'::jsonb, null)`, [biz, inv]);
    const chain = (await owner(`select * from public.verify_audit_chain($1)`, [biz])).rows;
    if (chain.length >= 2 && chain.every((r) => r.chain_valid)) ok(`workflow 24: audit chain intact (${chain.length} entries, all valid)`);
    else fail('audit chain', JSON.stringify(chain.map((r) => r.chain_valid)));

    // ── workflows 25: API/webhook objects (service-role paths) ──────────────
    await q('set role service_role');
    const usage = (await q(`select public.consume_api_rate_limit($1, $2, now()) as allowed`, ['test-bucket', 100])).rows[0];
    const linesJson = JSON.stringify([
  { line_number: 1, account_id: acc1110, amount: 50, amount_base: 50, is_debit: true },
  { line_number: 2, account_id: acc4110, amount: 50, amount_base: 50, is_debit: false },
]);
const apiJe = (await q(`select public.create_api_journal_entry($1, $2::jsonb, $3::jsonb) as ok`, [biz, '{"entry_number":"API-0001","entry_date":"2026-08-01","description":"webhook entry","source_type":"api"}', linesJson])).rows[0];
if (apiJe && apiJe.ok) ok('workflow 26: API journal entry created (balanced)');
else fail('API journal entry', JSON.stringify(apiJe));
    await q('reset role');
    ok('workflow 26: API rate-limit + webhook journal RPCs execute (service role)');

    console.log(`\n8B.5+8B.6 WORKFLOW & ACCOUNTING TESTS COMPLETE: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
