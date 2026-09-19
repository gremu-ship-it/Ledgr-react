// POS sale posting RPC — behavior matrix for 20260923000000_post_pos_sale_rpc.
//
// Stage 1+2 of docs/database/pos-sale-posting-rpc.md: the till can post a sale
// entirely server-side. These assertions run as SET ROLE authenticated with
// real business_users rows, so they exercise the function's own authorization
// (SECURITY DEFINER bypasses RLS) rather than a superuser's.
//
// What is covered: the happy path end to end, idempotency, COMPLETION of a
// half-posted sale on replay, customer resolution (named / walk-in sentinel),
// validation rejections, authorization for roles that must not sell, and the
// accounting parities (split tender per account, discount + VAT shape, credit
// sale, closed shift untouched).
//
// Requires the disposable-Postgres harness (embedded-postgres + pg); see
// docs/database/database-operations.md. Run:
//   node tests/database/pos_sale_rpc.test.js

const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54330;
const MIG_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

async function main() {
  const PG = new EP({ databaseDir: '/tmp/pgtest/pos/data', user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync('/tmp/pgtest/pos/data', { recursive: true, force: true });
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
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;`);
  const EXT = '/tmp/pgtest/node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension';
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron;\ncreate table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true);\ncreate sequence if not exists cron.jobid_seq;\ncreate or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);
  // Supabase runs migration sessions with `extensions` in the search_path
  // (pgcrypto lives there); mirror that so unqualified pgcrypto calls in
  // existing migrations (e.g. 20260727000001 gen_random_bytes) resolve.
  await c.query('set search_path = "$user", public, extensions');

  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try { await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')); }
    catch (e) { console.log('REPLAY FAIL', f, '::', e.message.split('\n')[0]); process.exit(1); }
  }
  console.log('replay OK:', files.length, 'migrations');

  let pass = 0, failN = 0;
  const ok = (l) => { pass++; console.log('  PASS', l); };
  const bad = (l) => { failN++; console.log('  FAIL', l); };
  const check = (l, cond, detail) => cond ? ok(l) : bad(`${l} :: ${detail}`);
  const q = (sql, params) => c.query(sql, params);
  const asUser = (uid) => async (sql, params) => {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await c.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await c.query('set role authenticated');
    try { return await c.query(sql, params); } finally { await c.query('reset role'); }
  };
  const post = async (run, payload) => {
    try { const r = await run(`select public.post_pos_sale($1::jsonb) as res`, [JSON.stringify(payload)]); return { res: r.rows[0].res }; }
    catch (e) { return { err: (e.message||'').split('\n')[0] }; }
  };
  try {
    const U = { ao:'10000000-0000-0000-0000-000000000001', am:'10000000-0000-0000-0000-000000000002',
                cash:'10000000-0000-0000-0000-0000000000c1', stock:'10000000-0000-0000-0000-0000000000c2',
                view:'10000000-0000-0000-0000-0000000000c3' };
    for (const [uid,email] of [[U.ao,'o@x.com'],[U.am,'m@x.com'],[U.cash,'cash@x.com'],[U.stock,'stock@x.com'],[U.view,'view@x.com']])
      await q(`insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,'{"full_name":"X"}') on conflict (id) do nothing`,[uid,email]);
    const A = await (await asUser(U.ao))(`select public.create_business_with_owner('Till Co','Till',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`);
    const BIZ = A.rows[0].id;
    for (const [uid,email,role] of [[U.am,'m@x.com','admin'],[U.cash,'cash@x.com','cashier'],[U.stock,'stock@x.com','stock_clerk'],[U.view,'view@x.com','viewer']]) {
      const tok = await (await asUser(U.ao))(`select public.invite_member($1,$2,$3) as t`,[BIZ,email,role]);
      await (await asUser(uid))(`select public.accept_invitation($1)`,[tok.rows[0].t]);
    }
    const walkin = (await q(`insert into public.contacts (business_id,name,contact_type,is_active,wht_exempt) values ($1,'Walk-in Customer','customer',true,false) returning id`,[BIZ])).rows[0].id;
    const loc = (await q(`insert into public.inventory_locations (business_id,name,is_default) values ($1,'Main',true) returning id`,[BIZ])).rows[0].id;
    const pid = (await q(`insert into public.products (business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code) values ($1,'Fanta','SKU-1',1500,900,'MWK','product',true,'none','none') returning id`,[BIZ])).rows[0].id;
    await q(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost) values ($1,$2,$3,100,0,900)`,[BIZ,pid,loc]);
    const shift = (await (await asUser(U.ao))(`insert into public.pos_shifts (business_id,cashier_id,cashier_name,opening_cash,status) values ($1,$2,'Cashier',50000,'open') returning id`,[BIZ,U.cash])).rows[0].id;
    const cashier = await asUser(U.cash);

    const mk = (o) => ({
      business_id: BIZ, client_key: o.key, receipt_number: o.receipt || 'REC', shift_id: o.shift === undefined ? shift : o.shift,
      cash_sales: o.cash_sales ?? 0, other_sales: o.other_sales ?? 0, is_credit_sale: o.credit ?? false,
      customer: o.customer ?? { name: 'Walk-in' },
      invoice: { contact_id: o.contact_id === undefined ? walkin : o.contact_id, invoice_type: 'sales',
        status: o.status || (o.credit ? 'sent' : 'paid'), issue_date: '2026-09-19', due_date: '2026-09-19',
        currency: 'MWK', original_currency: 'MWK', exchange_rate: 1, original_amount: o.total, functional_currency: 'MWK',
        functional_amount: o.total, subtotal: o.subtotal ?? o.total, discount_amount: o.discount ?? 0, discount_percent: 0,
        taxable_amount: o.subtotal ?? o.total, vat_amount: o.vat ?? 0, wht_amount: 0, total_amount: o.total,
        rate_date: '2026-09-19', rate_is_stale: false, created_by: 'cashier' },
      lines: [{ line_number: 1, description: 'Fanta', quantity: o.qty ?? 1, unit_price: o.total,
                discount_percent: 0, discount_amount: 0, tax_code: 'none', tax_rate: 0, tax_amount: 0,
                line_total: o.subtotal ?? o.total, product_id: pid }],
      payments: o.payments || [],
    });

    // ── 1. Fresh sale, cashier, one tender, tracked product ─────────────────
    const s1 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000a1', total: 1500, cash_sales: 1500,
      payments: [{ amount: 1500, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:1500, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000a2' }] }));
    if (s1.err) bad(`fresh sale: ${s1.err}`);
    else {
      check('fresh sale returns a number and journal entry', !!s1.res.number && !!s1.res.journal_entry_id, JSON.stringify(s1.res));
      const r = (await q(`select
        (select count(*) from public.invoice_lines where invoice_id=$1) lines,
        (select count(*) from public.invoice_payments where invoice_id=$1) pmts,
        (select count(*) from public.journal_entries where business_id=$2 and posting_key='invoice:'||$1||':sale') sale_keys,
        (select count(*) from public.journal_entries where business_id=$2 and posting_key like 'invoice:'||$1||':settlement:%') settle_keys,
        (select count(*) from public.journal_entries where business_id=$2 and posting_key='invoice:'||$1||':cogs') cogs_keys,
        (select count(*) from public.stock_movements where business_id=$2 and source_type='invoice' and source_id=$1::text) moves,
        (select count(*) from (select je.id from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id
          where je.business_id=$2 and je.posting_key like 'invoice:'||$1||':%' group by je.id
          having abs(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)) > 0.005) x) unbalanced,
        (select cash_sales_amount from public.pos_shifts where id=$3) shift_cash,
        (select expected_cash from public.pos_shifts where id=$3) shift_expected`, [s1.res.id, BIZ, shift])).rows[0];
      check('fresh sale writes lines/tenders/ledger/stock', Number(r.lines)===1 && Number(r.pmts)===1 && Number(r.sale_keys)===1 && Number(r.settle_keys)===1 && Number(r.cogs_keys)===1 && Number(r.moves)===1, JSON.stringify(r));
      check('every ledger entry balances', Number(r.unbalanced)===0, `unbalanced=${r.unbalanced}`);
      check('open shift drawer totals updated', Number(r.shift_cash)===1500 && Number(r.shift_expected)===51500, `cash=${r.shift_cash} expected=${r.shift_expected}`);
    }

    // ── 2. Idempotent replay ────────────────────────────────────────────────
    const s2 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000a1', total: 1500, cash_sales: 1500,
      payments: [{ amount: 1500, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:1500, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000a2' }] }));
    const dup = (await q(`select
      (select count(*) from public.invoices where business_id=$1 and client_key=$2::uuid) inv,
      (select count(*) from public.invoice_payments where business_id=$1 and client_key=$3::uuid) pmts,
      (select count(*) from public.stock_movements where business_id=$1 and reference=(select invoice_number from public.invoices where client_key=$2::uuid)) moves`,
      [BIZ,'00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2'])).rows[0];
    check('replay is idempotent', s2.res && s2.res.idempotent === true && Number(dup.inv)===1 && Number(dup.pmts)===1 && Number(dup.moves)===1,
      `idempotent=${s2.res && s2.res.idempotent} inv=${dup.inv} pmts=${dup.pmts} moves=${dup.moves}`);

    // ── 3. COMPLETION ON REPLAY: a sale whose ledger half never landed ───────
    // Simulates the state commitPosSaleDocuments leaves behind when a follow-up
    // step fails: invoice + lines + tender exist, no journal entry, no stock.
    const orphanKey = '00000000-0000-0000-0000-0000000000b1';
    const orphan = (await q(`insert into public.invoices (business_id,invoice_number,invoice_type,status,contact_id,issue_date,due_date,
        currency,exchange_rate,original_currency,functional_currency,functional_amount,rate_date,rate_is_stale,
        subtotal,discount_amount,discount_percent,taxable_amount,vat_amount,wht_amount,total_amount,amount_paid,client_key,created_by)
      values ($1,'INV-ORPHAN','sales','paid',$2,'2026-09-19','2026-09-19','MWK',1,'MWK','MWK',1500,'2026-09-19',false,
        1500,0,0,1500,0,0,1500,1500,$3,'cashier') returning id`,[BIZ,walkin,orphanKey])).rows[0].id;
    await q(`insert into public.invoice_lines (business_id,invoice_id,line_number,description,quantity,unit_price,discount_percent,discount_amount,tax_code,tax_rate,tax_amount,line_total,product_id)
      values ($1,$2,1,'Fanta',1,1500,0,0,'none',0,0,1500,$3)`,[BIZ,orphan,pid]);
    await q(`insert into public.invoice_payments (business_id,invoice_id,amount,currency,exchange_rate,functional_amount,payment_date,payment_method,client_key)
      values ($1,$2,1500,'MWK',1,1500,'2026-09-19','cash','00000000-0000-0000-0000-0000000000b2')`,[BIZ,orphan]);
    const before = (await q(`select
      (select count(*) from public.journal_entries where business_id=$1 and posting_key like 'invoice:'||$2||'%') entries,
      (select count(*) from public.stock_movements where business_id=$1 and source_id=$2::uuid::text) moves`,[BIZ,orphan])).rows[0];
    const s3 = await post(cashier, mk({ key: orphanKey, total: 1500, shift: null,
      payments: [{ amount: 1500, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:1500, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000b2' }] }));
    const after = (await q(`select
      (select count(*) from public.journal_entries where business_id=$1 and posting_key like 'invoice:'||$2::uuid||'%') entries,
      (select count(*) from public.journal_entries where business_id=$1 and posting_key='invoice:'||$2::uuid||':sale') sale,
      (select count(*) from public.journal_entries where business_id=$1 and posting_key like 'invoice:'||$2::uuid||':settlement:%') settle,
      (select count(*) from public.stock_movements where business_id=$1 and source_id=$2::uuid::text) moves,
      (select journal_entry_id is not null from public.invoices where id=$2::uuid) linked`,[BIZ,orphan])).rows[0];
    check('replay completes a half-posted sale', Number(before.entries)===0 && Number(before.moves)===0 && Number(after.entries)===3 && Number(after.moves)===1 && after.linked===true,
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    check('completion keeps the original invoice', s3.res && s3.res.id === orphan && s3.res.idempotent === true, JSON.stringify(s3.res || s3.err));

    // ── 4. Completion is itself idempotent (a third call changes nothing) ───
    await post(cashier, mk({ key: orphanKey, total: 1500, shift: null,
      payments: [{ amount: 1500, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:1500, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000b2' }] }));
    const third = (await q(`select
      (select count(*) from public.journal_entries where business_id=$1 and posting_key like 'invoice:'||$2::uuid||'%') entries,
      (select count(*) from public.stock_movements where business_id=$1 and source_id=$2::uuid::text) moves`,[BIZ,orphan])).rows[0];
    check('third replay changes nothing', Number(third.entries)===3 && Number(third.moves)===1, JSON.stringify(third));

    // ── 5. Customer resolution ──────────────────────────────────────────────
    const s4 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000c1', total: 500, contact_id: null,
      customer: { name: 'Chikondi Phiri', phone: '+265991234567' },
      payments: [{ amount: 500, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:500, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000c2' }] }));
    if (s4.res) {
      const r = (await q(`select c.name, c.phone, (select contact_id from public.invoices where id=$1)=c.id billed
        from public.contacts c where c.business_id=$2 and c.name='Chikondi Phiri'`,[s4.res.id,BIZ])).rows[0];
      check('named customer created and billed', r && r.billed === true && r.phone === '+265991234567', JSON.stringify(r));
    } else bad(`named customer: ${s4.err}`);

    const s5 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000d1', total: 700,
      contact_id: 'offline_walk_in_customer', customer: { name: '' },
      payments: [{ amount: 700, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:700, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000d2' }] }));
    if (s5.res) {
      const r = (await q(`select contact_id = $2 resolved from public.invoices where id=$1`,[s5.res.id, walkin])).rows[0];
      check('walk-in sentinel resolves to the default customer', r.resolved === true, JSON.stringify(r));
    } else bad(`walk-in: ${s5.err}`);

    // ── 6. Validation ───────────────────────────────────────────────────────
    const v1 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000e1', total: 1500, cash_sales: 1000,
      payments: [{ amount: 1000, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:1000, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000e2' }] }));
    check('under-tendered sale rejected', /do not settle/i.test(v1.err || ''), v1.err);
    const v2 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000f1', total: 1500, credit: true,
      payments: [{ amount: 1500, payment_method: 'cash', currency:'MWK', exchange_rate:1, functional_amount:1500, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000f2' }] }));
    check('credit sale with tenders rejected', /credit sale cannot carry/i.test(v2.err || ''), v2.err);
    const v3 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000a9', total: 0 }));
    check('zero total rejected', /valid sale total/i.test(v3.err || ''), v3.err);

    // ── 7. Authorization ────────────────────────────────────────────────────
    for (const [label, uid] of [['stock_clerk', U.stock], ['viewer', U.view]]) {
      const r = await post(await asUser(uid), mk({ key: '00000000-0000-0000-0000-0000000000' + (label==='stock_clerk'?'9a':'9b'), total: 100,
        payments: [{ amount: 100, payment_method:'cash', currency:'MWK', exchange_rate:1, functional_amount:100, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-00000000009c' }] }));
      check(`${label} cannot post a sale`, /permission/i.test(r.err || ''), r.err || JSON.stringify(r.res));
    }

    // ── 8. Parities: split tender, discount+VAT, credit, closed shift ───────
    const accs = Object.fromEntries((await q(`select code, id from public.accounts where business_id=$1 and code in ('1110','1125','2121','4130')`,[BIZ])).rows.map(r=>[r.code,r.id]));
    const s6 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000aa', total: 1500, cash_sales: 1000, other_sales: 500,
      payments: [
        { amount: 1000, payment_method:'cash', currency:'MWK', exchange_rate:1, functional_amount:1000, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000ab' },
        { amount: 500, payment_method:'airtel_money', currency:'MWK', exchange_rate:1, functional_amount:500, payment_date:'2026-09-19', bank_account_id: accs['1125'], client_key:'00000000-0000-0000-0000-0000000000ac' }] }));
    if (s6.res) {
      const r = (await q(`select string_agg(ac.code, ',' order by ac.code) tenders from public.journal_entries je
        join public.journal_lines jl on jl.journal_entry_id=je.id join public.accounts ac on ac.id=jl.account_id
        where je.business_id=$1 and je.posting_key like 'invoice:'||$2::uuid||':settlement:%' and jl.is_debit`,[BIZ,s6.res.id])).rows[0];
      check('split tender debits each tender account', r.tenders === '1110,1125', r.tenders);
    } else bad(`split tender: ${s6.err}`);

    const s7 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000ad', total: 1148.5, subtotal: 1000, discount: 100, vat: 148.5, cash_sales: 1148.5,
      payments: [{ amount: 1148.5, payment_method:'cash', currency:'MWK', exchange_rate:1, functional_amount:1148.5, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000ae' }] }));
    if (s7.res) {
      const r = (await q(`select string_agg(ac.code||':'||case when jl.is_debit then 'DR' else 'CR' end, ' ' order by jl.line_number) e
        from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.accounts ac on ac.id=jl.account_id
        where je.posting_key='invoice:'||$1::uuid||':sale'`,[s7.res.id])).rows[0];
      check('discount + VAT sale entry matches the TS shape', r.e === '1131:DR 4112:CR 4130:DR 2121:CR', r.e);
    } else bad(`discount+vat: ${s7.err}`);

    const s8 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000af', total: 1500, credit: true, shift: null }));
    if (s8.res) {
      const r = (await q(`select
        (select count(*) from public.invoice_payments where invoice_id=$1) pmts,
        (select count(*) from public.journal_entries where business_id=$2 and posting_key like 'invoice:'||$1::uuid||':%') entries,
        (select status::text from public.invoices where id=$1) status,
        (select amount_paid from public.invoices where id=$1) paid`,[s8.res.id,BIZ])).rows[0];
      check('credit sale posts the receivable only', Number(r.pmts)===0 && Number(r.entries)===2 && r.status==='sent' && Number(r.paid)===0, JSON.stringify(r));
    } else bad(`credit sale: ${s8.err}`);

    await q(`update public.pos_shifts set status='closed' where id=$1`,[shift]);
    const beforeClosed = (await q(`select cash_sales_amount, total_sales_amount from public.pos_shifts where id=$1`,[shift])).rows[0];
    const s9 = await post(cashier, mk({ key: '00000000-0000-0000-0000-0000000000ba', total: 300, cash_sales: 300, shift,
      payments: [{ amount: 300, payment_method:'cash', currency:'MWK', exchange_rate:1, functional_amount:300, payment_date:'2026-09-19', client_key:'00000000-0000-0000-0000-0000000000bb' }] }));
    const afterClosed = (await q(`select cash_sales_amount, total_sales_amount from public.pos_shifts where id=$1`,[shift])).rows[0];
    check('a closed shift is not rewritten', s9.res && beforeClosed.cash_sales_amount === afterClosed.cash_sales_amount && beforeClosed.total_sales_amount === afterClosed.total_sales_amount,
      `before=${JSON.stringify(beforeClosed)} after=${JSON.stringify(afterClosed)}`);

    console.log(`\nPOST_POS_SALE RPC TESTS COMPLETE: ${pass} passed, ${failN} failed`);
  } catch (e) { console.error('FAIL', e.message); failN++; }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
