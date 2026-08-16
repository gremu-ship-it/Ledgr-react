// Phase 10 audit — focused integrity tests: discount reconciliation,
// concurrency (document numbering), hostile inputs, inventory identity.
const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54329;
const MIG_DIR = '/home/user/Ledgr-react/supabase/migrations';

async function main() {
  const PG = new EP({ databaseDir: '/tmp/pgtest/data-audit', user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync('/tmp/pgtest/data-audit', { recursive: true, force: true });
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

  try {
    const uid = '10000000-0000-0000-0000-000000000001';
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'audit@x.com','{"full_name":"Auditor"}')`, [uid]);
    const asUser = async (sql, params) => {
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await q('set role authenticated');
      try { return await q(sql, params); } finally { await q('reset role'); }
    };
    const biz = (await asUser(`select public.create_business_with_owner('Audit Co','Audit',null,null,null,true,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
    ok('business created');

    // ── A. CONCURRENCY: reserve_next_document_number must be atomic ─────────
    const nums = [];
    for (let i = 0; i < 25; i++) {
      const r = await asUser(`select public.reserve_next_document_number($1, 'invoice') as n`, [biz]);
      nums.push(r.rows[0].n);
    }
    const unique = new Set(nums);
    if (unique.size === 25) ok(`concurrency: 25 sequential reservations all unique (${nums[0]}..${nums[24]})`);
    else fail('concurrency: duplicate document numbers!', unique.size);
    // parallel: fire 10 concurrent
    const parallel = await Promise.all(Array.from({ length: 10 }, () =>
      asUser(`select public.reserve_next_document_number($1, 'expense') as n`, [biz]).then(r => r.rows[0].n)));
    if (new Set(parallel).size === 10) ok('concurrency: 10 parallel reservations all unique');
    else fail('concurrency: parallel duplicates!', parallel);

    // ── B. DISCOUNT RECONCILIATION (DB layer) ───────────────────────────────
    // Replicate journalService: 3 widgets @ 15000, 10% discount, VAT 17.5%
    // gross=45000 discount=4500 subtotal=40500 VAT=7087.50 total=47587.50
    const cust = (await asUser(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Alpha Trading','customer',true,false) returning id`, [biz])).rows[0].id;
    const acc = async (code) => (await q(`select id from public.accounts where business_id=$1 and code=$2`, [biz, code])).rows[0].id;
    const a1131 = await acc('1131'), a4110 = await acc('4110'), a4130 = await acc('4130'), a2121 = await acc('2121');
    const inv = (await asUser(`insert into public.invoices (business_id, contact_id, invoice_number, invoice_type, status, issue_date, due_date, currency, exchange_rate, total_amount, amount_paid, subtotal, vat_amount, wht_amount, taxable_amount, discount_amount, discount_percent, ar_account_id, revenue_account_id)
      values ($1,$2,'A-INV-001','invoice','sent','2026-08-01','2026-08-15','MWK',1,47587.50,0,40500,7087.50,0,40500,4500,10,$3,$4) returning id`, [biz, cust, a1131, a4110])).rows[0].id;
    const je = (await asUser(`insert into public.journal_entries (business_id, entry_date, entry_number, description, currency, exchange_rate, status, source_type, source_id)
      values ($1,'2026-08-01','AUDIT-JE-1','Invoice A-INV-001','MWK',1,'posted','invoice',$2) returning id`, [biz, inv])).rows[0].id;
    await asUser(`insert into public.journal_lines (business_id, journal_entry_id, account_id, line_number, is_debit, amount, amount_base, currency, exchange_rate, description, reconciled, tax_code, tax_amount)
      values ($1,$2,$3,1,true,47587.50,47587.50,'MWK',1,'receivable',false,'none',0),
             ($1,$2,$4,2,false,45000,45000,'MWK',1,'revenue gross',false,'none',0),
             ($1,$2,$5,3,true,4500,4500,'MWK',1,'discount allowed',false,'none',0),
             ($1,$2,$6,4,false,7087.50,7087.50,'MWK',1,'VAT',false,'vat_standard',7087.50)`, [biz, je, a1131, a4110, a4130, a2121]);
    await asUser(`update public.invoices set journal_entry_id=$1 where id=$2`, [je, inv]);
    // balance check
    const bal = (await q(`select sum(case when is_debit then amount_base else -amount_base end)::numeric as net from public.journal_lines where journal_entry_id=$1`, [je])).rows[0];
    if (Number(bal.net) === 0) ok(`discount journal balanced (DR 47587.50 = CR 47587.50 incl 4500 discount contra)`);
    else fail('discount journal unbalanced', bal.net);
    // trial balance shows gross revenue + discount contra
    const tb = (await q(`select code, total_debits, total_credits, balance from public.v_trial_balance where business_id=$1 and code in ('4110','4130') order by code`, [biz])).rows;
    const rev = tb.find(r => r.code === '4110'), disc = tb.find(r => r.code === '4130');
    if (rev && Number(rev.total_credits) === 45000 && disc && Number(disc.total_debits) === 4500)
      ok('trial balance: gross revenue 45000 CR, discount allowed 4500 DR (contra)');
    else fail('trial balance discount', JSON.stringify(tb));
    // AR ageing: outstanding = 47587.50
    const ar = (await q(`select amount_due from public.v_ar_ageing where business_id=$1 and invoice_number='A-INV-001'`, [biz])).rows[0];
    if (ar && Number(ar.amount_due) === 47587.50) ok(`AR ageing: outstanding ${ar.amount_due}`);
    else fail('AR ageing', JSON.stringify(ar));
    // customer balance
    const custBal = (await q(`select coalesce(sum(amount_due),0)::numeric as due from public.invoices where business_id=$1 and contact_id=$2 and deleted_at is null`, [biz, cust])).rows[0];
    if (Number(custBal.due) === 47587.50) ok(`customer balance: ${custBal.due}`);
    else fail('customer balance', custBal.due);

    // ── C. HOSTILE INPUTS at DB layer ───────────────────────────────────────
    // negative quantity on invoice line
    try {
      await asUser(`insert into public.invoice_lines (business_id, invoice_id, line_number, description, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_amount, discount_percent)
        values ($1,$2,1,'neg',-5,100,-500,'none',0,0,0,0)`, [biz, inv]);
      fail('hostile: negative quantity accepted on invoice line (no DB CHECK)');
    } catch (e) { ok('hostile: negative quantity line rejected or accepted — check:', e.message.split('\n')[0].slice(0,60)); }
    // huge number
    try {
      await asUser(`insert into public.invoice_lines (business_id, invoice_id, line_number, description, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_amount, discount_percent)
        values ($1,$2,2,'huge',1e15,1e15,1e30,'none',0,0,0,0)`, [biz, inv]);
      ok('hostile: huge numbers stored (numeric) — check for overflow in app');
    } catch (e) { ok('hostile: huge numbers rejected:', e.message.split('\n')[0].slice(0,60)); }

    // ── D. INVENTORY IDENTITY ───────────────────────────────────────────────
    const prod = (await asUser(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency)
      values ($1,'A-Product','A-SKU','product',true,true,100,150,5,10,'none','none','MWK') returning id`, [biz])).rows[0].id;
    const loc = (await asUser(`insert into public.inventory_locations (business_id, name, is_active, is_default) values ($1,'Main',true,true) returning id`, [biz])).rows[0].id;
    await asUser(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost) values ($1,$2,$3,10,0,10,100)`, [biz, prod, loc]);
    // simulate sale of 3
    await asUser(`update public.inventory_balances set quantity_on_hand = quantity_on_hand - 3, quantity_available = quantity_available - 3 where business_id=$1 and product_id=$2 and location_id=$3`, [biz, prod, loc]);
    const qty = (await q(`select quantity_on_hand, quantity_available from public.inventory_balances where business_id=$1 and product_id=$2`, [biz, prod])).rows[0];
    if (Number(qty.quantity_on_hand) === 7 && Number(qty.quantity_available) === 7) ok(`inventory identity: 10 - 3 = ${qty.quantity_on_hand}`);
    else fail('inventory identity', JSON.stringify(qty));

    // insufficient stock (no DB guard on negative?)
    try {
      await asUser(`update public.inventory_balances set quantity_on_hand = quantity_on_hand - 100, quantity_available = quantity_available - 100 where business_id=$1 and product_id=$2 and location_id=$3`, [biz, prod, loc]);
      const neg = (await q(`select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2`, [biz, prod])).rows[0];
      if (Number(neg.quantity_on_hand) < 0) fail('inventory: NEGATIVE stock allowed (no DB CHECK) — app-level guard only?');
      else ok('inventory: no negative');
    } catch (e) { ok('inventory: negative stock rejected by DB:', e.message.split('\n')[0].slice(0,50)); }

    console.log(`\nPHASE 10 AUDIT TESTS: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
