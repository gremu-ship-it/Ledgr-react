// Phase 10 remediation — regression tests for findings A-02 (backfill),
// A-03 (amount_due trigger) and A-04 (non-negative quantity/stock CHECKs).
// Runs against a disposable PostgreSQL replay of ALL migrations.
const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54330;
const MIG_DIR = '/home/user/Ledgr-react/supabase/migrations';

async function main() {
  const PG = new EP({ databaseDir: '/tmp/pgtest/data-rem', user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync('/tmp/pgtest/data-rem', { recursive: true, force: true });
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
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron; create table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true); create sequence if not exists cron.jobid_seq; create or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net; create type net.http_response as (status integer, message text, body text); create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
    set search_path = "$user", public, extensions;`);

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
  const readMig = (name) => fs.readFileSync(path.join(MIG_DIR, name), 'utf8');

  try {
    const uid = '10000000-0000-0000-0000-000000000002';
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'rem@x.com','{"full_name":"Remediation"}')`, [uid]);
    const asUser = async (sql, params) => {
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await q('set role authenticated');
      try { return await q(sql, params); } finally { await q('reset role'); }
    };
    const biz = (await asUser(`select public.create_business_with_owner('Rem Co','Rem',null,null,null,true,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
    ok('business created (fresh COA incl. discount accounts)');

    const cust = (await asUser(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Beta Traders','customer',true,false) returning id`, [biz])).rows[0].id;
    const acc = async (code) => (await q(`select id from public.accounts where business_id=$1 and code=$2`, [biz, code])).rows[0].id;
    const a1131 = await acc('1131'), a4110 = await acc('4110'), a2121 = await acc('2121');

    // ── A-03: amount_due trigger + backfill ────────────────────────────────
    const inv = (await asUser(`insert into public.invoices (business_id, contact_id, invoice_number, invoice_type, status, issue_date, due_date, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, taxable_amount, discount_amount, discount_percent, ar_account_id, revenue_account_id)
      values ($1,$2,'R-INV-001','invoice','sent','2026-08-01','2026-08-15','MWK',1,47587.50,0,40500,7087.50,0,40500,4500,10,$3,$4) returning id, amount_due`, [biz, cust, a1131, a4110])).rows[0];
    if (Number(inv.amount_due) === 47587.50) ok(`A-03: INSERT without amount_due → trigger sets amount_due = ${inv.amount_due}`);
    else fail('A-03: insert did not set amount_due', inv.amount_due);

    await asUser(`select public.increment_amount_paid('invoices', $1, 10000)`, [inv.id]);
    const afterPay = (await q(`select amount_due, amount_paid from public.invoices where id=$1`, [inv.id])).rows[0];
    if (Number(afterPay.amount_due) === 37587.50 && Number(afterPay.amount_paid) === 10000)
      ok('A-03: payment 10000 → amount_due 37587.50');
    else fail('A-03: payment did not maintain amount_due', JSON.stringify(afterPay));

    await asUser(`select public.increment_amount_paid('invoices', $1, -10000)`, [inv.id]);
    const afterBack = (await q(`select amount_due from public.invoices where id=$1`, [inv.id])).rows[0];
    if (Number(afterBack.amount_due) === 47587.50) ok('A-03: payment back-out -10000 → amount_due restored to 47587.50');
    else fail('A-03: back-out did not restore amount_due', afterBack.amount_due);

    // legacy-row backfill: simulate a pre-fix NULL row, re-run migration
    await q(`update public.invoices set amount_due = null where id=$1`, [inv.id]);
    await q(readMig('20260817000000_phase10_amount_due_trigger.sql'));
    const afterBackfill = (await q(`select amount_due from public.invoices where id=$1`, [inv.id])).rows[0];
    if (Number(afterBackfill.amount_due) === 47587.50) ok('A-03: backfill migration repairs legacy NULL amount_due');
    else fail('A-03: backfill did not repair NULL', afterBackfill.amount_due);

    // customer balance query (the audit query that returned 0)
    const custBal = (await q(`select coalesce(sum(amount_due),0)::numeric as due from public.invoices where business_id=$1 and contact_id=$2 and deleted_at is null`, [biz, cust])).rows[0];
    if (Number(custBal.due) === 47587.50) ok(`A-03: customer balance = ${custBal.due} (was 0 pre-fix)`);
    else fail('A-03: customer balance', custBal.due);

    // ── A-04: CHECK constraints ────────────────────────────────────────────
    const expectCheckViolation = async (label, sql, params) => {
      try { await asUser(sql, params); fail(label, 'insert/update unexpectedly succeeded'); }
      catch (e) {
        if (e.code === '23514') ok(label);
        else fail(label, `expected SQLSTATE 23514, got ${e.code}: ${e.message.split('\n')[0].slice(0, 80)}`);
      }
    };
    await expectCheckViolation('A-04: negative invoice line quantity rejected (23514)',
      `insert into public.invoice_lines (business_id, invoice_id, line_number, description, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_amount, discount_percent)
       values ($1,$2,1,'neg',-5,100,-500,'none',0,0,0,0)`, [biz, inv.id]);
    await expectCheckViolation('A-04: negative invoice line unit_price rejected (23514)',
      `insert into public.invoice_lines (business_id, invoice_id, line_number, description, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_amount, discount_percent)
       values ($1,$2,2,'neg',1,-100,-100,'none',0,0,0,0)`, [biz, inv.id]);
    const exp = (await asUser(`insert into public.expenses (business_id, contact_id, expense_number, expense_type, status, expense_date, currency, exchange_rate, rate_is_stale, total_amount, amount_paid, subtotal, vat_amount, wht_amount, discount_amount, discount_percent)
      values ($1,$2,'R-EXP-001','expense','approved','2026-08-01','MWK',1,false,1000,0,1000,0,0,0,0) returning id`, [biz, cust])).rows[0].id;
    await expectCheckViolation('A-04: negative expense line quantity rejected (23514)',
      `insert into public.expense_lines (business_id, expense_id, line_number, description, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_amount, discount_percent)
       values ($1,$2,1,'neg',-2,100,-200,'none',0,0,0,0)`, [biz, exp]);

    const prod = (await asUser(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency)
      values ($1,'R-Product','R-SKU','product',true,true,100,150,5,10,'none','none','MWK') returning id`, [biz])).rows[0].id;
    const loc = (await asUser(`insert into public.inventory_locations (business_id, name, is_active, is_default) values ($1,'Main',true,true) returning id`, [biz])).rows[0].id;
    await asUser(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost) values ($1,$2,$3,10,0,10,100)`, [biz, prod, loc]);
    await expectCheckViolation('A-04: negative inventory quantity_on_hand rejected (23514)',
      `update public.inventory_balances set quantity_on_hand = quantity_on_hand - 100, quantity_available = quantity_available - 100 where business_id=$1 and product_id=$2 and location_id=$3`, [biz, prod, loc]);
    await expectCheckViolation('A-04: negative inventory quantity_reserved rejected (23514)',
      `update public.inventory_balances set quantity_reserved = -1 where business_id=$1 and product_id=$2 and location_id=$3`, [biz, prod, loc]);
    // stock_movements: zero is invalid, NEGATIVE is a legal direction encoding
    await expectCheckViolation('A-04: zero stock_movement quantity rejected (23514)',
      `insert into public.stock_movements (business_id, product_id, location_id, movement_date, movement_type, quantity, unit_cost, total_cost, reference)
       values ($1,$2,$3,'2026-08-01','sale',0,100,0,'zero')`, [biz, prod, loc]);
    try {
      await asUser(`insert into public.stock_movements (business_id, product_id, location_id, movement_date, movement_type, quantity, unit_cost, total_cost, reference)
        values ($1,$2,$3,'2026-08-01','sale',-3,100,-300,'issue')`, [biz, prod, loc]);
      ok('A-04: negative stock_movement quantity allowed (direction encoding, as app writes)');
    } catch (e) { fail('A-04: negative stock movement wrongly rejected', e.message.split('\n')[0]); }

    // ── A-02 (part 2): discount-account backfill for legacy businesses ─────
    const d4130 = await acc('4130'), d4260 = await acc('4260'), d5175 = await acc('5175');
    const p4100 = await acc('4100'), p4200 = await acc('4200'), p5000 = await acc('5000');
    // simulate legacy: business missing the discount accounts (leaves — safe to delete)
    await q(`delete from public.accounts where id in ($1,$2,$3)`, [d4130, d4260, d5175]);
    await q(readMig('20260817000002_phase10_backfill_discount_accounts.sql'));  // idempotent re-run
    const n4130 = (await q(`select a.id, a.name, a.normal_balance, a.account_type, a.account_subtype, a.is_group, a.parent_id, p.code as parent_code
      from public.accounts a left join public.accounts p on p.id = a.parent_id where a.business_id=$1 and a.code='4130'`, [biz])).rows[0];
    if (n4130 && n4130.parent_code === '4100' && n4130.normal_balance === 'debit' && n4130.account_type === 'income' && n4130.account_subtype === 'revenue' && n4130.is_group === false)
      ok('A-02: backfill recreates 4130 Sales Discounts under 4100 with seed attributes');
    else fail('A-02: backfill 4130 wrong', JSON.stringify(n4130));
    const n4260 = (await q(`select a.parent_id, p.code as parent_code from public.accounts a join public.accounts p on p.id = a.parent_id where a.business_id=$1 and a.code='4260'`, [biz])).rows[0];
    const n5175 = (await q(`select a.parent_id, p.code as parent_code from public.accounts a join public.accounts p on p.id = a.parent_id where a.business_id=$1 and a.code='5175'`, [biz])).rows[0];
    if (n4260 && n4260.parent_code === '4200' && n5175 && n5175.parent_code === '5000')
      ok('A-02: backfill recreates 4260 (under 4200) and 5175 (under 5000)');
    else fail('A-02: backfill 4260/5175', JSON.stringify({ n4260, n5175 }));
    // existing account untouched (id identical)
    const still4100 = (await q(`select id from public.accounts where business_id=$1 and code='4100'`, [biz])).rows[0].id;
    if (still4100 === p4100 && (await q(`select id from public.accounts where business_id=$1 and code='5000'`, [biz])).rows[0].id === p5000 && (await q(`select id from public.accounts where business_id=$1 and code='4200'`, [biz])).rows[0].id === p4200)
      ok('A-02: backfill leaves existing parent accounts untouched');
    else fail('A-02: backfill mutated existing accounts');

    console.log(`\nPHASE 10 REMEDIATION TESTS: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
