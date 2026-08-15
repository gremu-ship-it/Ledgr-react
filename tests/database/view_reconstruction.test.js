// Phase 8B.2 — replay all migrations + functional tests of reconstructed views.
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
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role; GRANT SELECT ON auth.users TO anon, authenticated, service_role;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS storage; GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;`);
  const EXT = '/tmp/pgtest/node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension';
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron;\ncreate table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true);\ncreate sequence if not exists cron.jobid_seq;\ncreate or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`);

  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try { await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')); }
    catch (e) { console.log('REPLAY FAIL', f, '::', e.message.split('\n')[0]); process.exit(1); }
  }
  console.log('replay OK:', files.length, 'migrations');

  const ok = (l) => console.log('  PASS', l);
  const fail = (l, e) => { console.log('  FAIL', l, '::', (e && (e.message || e)) || ''); process.exitCode = 1; };
  const q = (sql, params) => c.query(sql, params);

  try {
    // ── seed: business + owner + accounts + journal entries ─────────────────
    await q(`select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false)`);
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111','alice@example.com','{"full_name":"Alice"}')`);
    const biz = (await q(`select public.create_business_with_owner('Test Co','Test Co',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;

    // accounts: cash 1110 (asset, debit-normal), sales 4112 (income, credit-normal)
    const acc = await q(`select id, code from public.accounts where business_id=$1 and code in ('1110','4112','1131','2121')`, [biz]);
    const accMap = Object.fromEntries(acc.rows.map((r) => [r.code, r.id]));
    if (acc.rows.length < 3) fail('seed accounts', acc.rows.length);

    // journal entries: entry1 balanced (1000 debit cash / 1000 credit sales),
    // entry2 (500 debit cash / 500 credit sales)
    const je1 = await q(`insert into public.journal_entries (business_id, entry_date, entry_number, description, currency, exchange_rate, status)
      values ($1, '2026-07-01', 'JE-0001', 'Sale 1', 'MWK', 1, 'posted') returning id`, [biz]);
    const je2 = await q(`insert into public.journal_entries (business_id, entry_date, entry_number, description, currency, exchange_rate, status)
      values ($1, '2026-07-15', 'JE-0002', 'Sale 2', 'MWK', 1, 'posted') returning id`, [biz]);
    await q(`insert into public.journal_lines (business_id, journal_entry_id, account_id, line_number, is_debit, amount, amount_base, currency, exchange_rate, description, reconciled, tax_amount, tax_code)
      values ($1,$2,$3,1,true,1000,1000,'MWK',1,'cash', false, 0, 'none'), ($1,$2,$4,2,false,1000,1000,'MWK',1,'sales', false, 0, 'none')`, [biz, je1.rows[0].id, accMap['1110'], accMap['4112']]);
    await q(`insert into public.journal_lines (business_id, journal_entry_id, account_id, line_number, is_debit, amount, amount_base, currency, exchange_rate, description, reconciled, tax_amount, tax_code)
      values ($1,$2,$3,1,true,500,500,'MWK',1,'cash', false, 0, 'none'), ($1,$2,$4,2,false,500,500,'MWK',1,'sales', false, 0, 'none')`, [biz, je2.rows[0].id, accMap['1110'], accMap['4112']]);

    // ── v_trial_balance ──────────────────────────────────────────────────────
    const tb = (await q(`select * from public.v_trial_balance where business_id=$1 order by code`, [biz])).rows;
    const cash = tb.find((r) => r.code === '1110');
    const sales = tb.find((r) => r.code === '4112');
    if (cash && Number(cash.total_debits) === 1500 && Number(cash.total_credits) === 0 && Number(cash.balance) === 1500) ok('trial balance: cash 1110 (debit 1500, balance +1500 natural)');
    else fail('trial balance cash', JSON.stringify(cash));
    if (sales && Number(sales.total_credits) === 1500 && Number(sales.total_debits) === 0 && Number(sales.balance) === 1500) ok('trial balance: sales 4112 (credit 1500, balance +1500 natural)');
    else fail('trial balance sales', JSON.stringify(sales));

    // The phase's equation: SUM(debits) = SUM(credits)
    const totals = (await q(`select sum(total_debits) d, sum(total_credits) c from public.v_trial_balance where business_id=$1`, [biz])).rows[0];
    if (Number(totals.d) === Number(totals.c) && Number(totals.d) > 0) ok(`trial balance equation: debits ${totals.d} = credits ${totals.c}`);
    else fail('trial balance equation', JSON.stringify(totals));

    // accounts with no activity still appear (zero rows)
    const zero = tb.find((r) => r.code === '2121');
    if (zero && Number(zero.total_debits) === 0 && Number(zero.balance) === 0) ok('trial balance: zero-activity account included (2121)');
    else fail('trial balance zero account', JSON.stringify(zero));

    // ── v_ar_ageing ──────────────────────────────────────────────────────────
    const contact = (await q(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Customer A','customer',true,false) returning id`, [biz])).rows[0].id;
    // open invoice: sent, due 40 days ago, total 1000, paid 400
    const inv = await q(`insert into public.invoices (business_id, contact_id, invoice_number, invoice_type, status, issue_date, due_date, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, taxable_amount, discount_amount, discount_percent)
      values ($1,$2,'INV-0001','invoice','partially_paid','2026-06-01','2026-07-01','MWK',1,1000,400,1000,0,0,1000,0,0) returning id`, [biz, contact]);
    // paid invoice: should NOT appear (status=paid)
    await q(`insert into public.invoices (business_id, contact_id, invoice_number, invoice_type, status, issue_date, due_date, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, taxable_amount, discount_amount, discount_percent)
      values ($1,$2,'INV-0002','invoice','paid','2026-06-01','2026-06-15','MWK',1,500,500,500,0,0,500,0,0)`, [biz, contact]);
    // draft: excluded
    await q(`insert into public.invoices (business_id, contact_id, invoice_number, invoice_type, status, issue_date, due_date, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, taxable_amount, discount_amount, discount_percent)
      values ($1,$2,'INV-0003','invoice','draft','2026-08-01',null,'MWK',1,200,0,200,0,0,200,0,0)`, [biz, contact]);

    const ageing = (await q(`select * from public.v_ar_ageing where business_id=$1`, [biz])).rows;
    const open = ageing.find((r) => r.invoice_number === 'INV-0001');
    if (ageing.length === 1 && open && Number(open.amount_due) === 600 && open.days_overdue > 30 && open.days_overdue <= 60 && open.ageing_bucket === '31-60' && open.contact_name === 'Customer A')
      ok(`ar ageing: 1 open invoice, due ${open.amount_due}, bucket ${open.ageing_bucket} (${open.days_overdue}d), contact ${open.contact_name}`);
    else fail('ar ageing', JSON.stringify(ageing));

    // ── v_reorder_alerts ─────────────────────────────────────────────────────
    const loc = (await q(`insert into public.inventory_locations (business_id, name, is_active, is_default) values ($1,'Main',true,true) returning id`, [biz])).rows[0].id;
    const prod = await q(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency)
      values ($1,'Widget','WID-1','product',true,true,100,150,10,25,'none','none','MWK') returning id`, [biz]);
    await q(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost)
      values ($1,$2,$3,8,1,7,100)`, [biz, prod.rows[0].id, loc]);
    // a product above reorder level → not an alert
    const prod2 = await q(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency)
      values ($1,'Gadget','GAD-1','product',true,true,50,80,5,10,'none','none','MWK') returning id`, [biz]);
    await q(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost)
      values ($1,$2,$3,20,0,20,50)`, [biz, prod2.rows[0].id, loc]);

    const alerts = (await q(`select * from public.v_reorder_alerts where business_id=$1`, [biz])).rows;
    if (alerts.length === 1 && alerts[0].sku === 'WID-1' && Number(alerts[0].quantity_available) === 7 && alerts[0].location_name === 'Main' && Number(alerts[0].estimated_reorder_cost) === 2500)
      ok(`reorder alerts: 1 alert (${alerts[0].product_name} avail 7 <= 10; est cost ${alerts[0].estimated_reorder_cost})`);
    else fail('reorder alerts', JSON.stringify(alerts));

    // ── v_asset_register ─────────────────────────────────────────────────────
    const cat = (await q(`insert into public.asset_categories (business_id, name, is_active, depreciation_method, residual_percent) values ($1,'Vehicles',true,'straight_line',10) returning id`, [biz])).rows[0].id;
    const br = (await q(`insert into public.branches (business_id, name, is_active) values ($1,'HQ',true) returning id`, [biz])).rows[0].id;
    const dept = (await q(`insert into public.departments (business_id, name, is_active) values ($1,'Ops',true) returning id`, [biz])).rows[0].id;
    await q(`insert into public.fixed_assets (business_id, asset_number, name, category_id, branch_id, department_id, acquisition_cost, acquisition_date, residual_value, accumulated_depreciation, depreciation_method, status, is_active, is_depreciable, depreciation_start_date)
      values ($1,'AST-001','Delivery Van',$2,$3,$4,20000,'2025-01-01',2000,5000,'straight_line','active',true,true,'2025-02-01')`, [biz, cat, br, dept]);
    const reg = (await q(`select * from public.v_asset_register where business_id=$1`, [biz])).rows;
    if (reg.length === 1 && reg[0].category === 'Vehicles' && reg[0].branch === 'HQ' && reg[0].department === 'Ops' && Number(reg[0].net_book_value) === 15000)
      ok(`asset register: ${reg[0].name}, NBV ${reg[0].net_book_value}, cat ${reg[0].category}/${reg[0].branch}/${reg[0].department}`);
    else fail('asset register', JSON.stringify(reg));

    console.log('\n8B.2 VIEW FUNCTIONAL TESTS COMPLETE');
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(process.exitCode || 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
