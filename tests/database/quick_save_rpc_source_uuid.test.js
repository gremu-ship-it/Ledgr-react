// Regression test: quick-save RPCs vs uuid-shaped source_id columns.
//
// Reports from production (Quick Expense Entry) showed:
//
//   column "source_id" is of type uuid but expression is of type text
//   Nothing was saved — it is safe to try again.
//
// The repository base migration declares journal_entries.source_id and
// stock_movements.source_id as TEXT, and a fresh replay therefore never
// caught the bug: 20260911000001_quick_save_rpc.sql inserts text-typed
// expressions (p_source_id / v_expense_id::text / v_invoice_id::text) into
// those columns, which works on TEXT but fails with SQLSTATE 42804 on the
// live database where the columns are UUID (PostgreSQL has no implicit
// text→uuid cast for INSERT; uuid→text IS a valid assignment cast).
//
// This harness replays every migration except the fix
// (20260911000002_quick_save_rpc_source_id_uuid.sql), exercises
// save_quick_expense / save_quick_sale on BOTH column shapes, then applies
// the fix and re-exercises both. It fails if any phase deviates from:
//
//   A. TEXT columns (repo/staging shape)  — RPCs succeed before the fix
//   B. UUID columns (production shape)    — RPCs fail with 42804 before
//                                           the fix, succeed after it
//   C. TEXT columns again (round-trip)    — RPCs still succeed after it
//
// Run: node tests/database/quick_save_rpc_source_uuid.test.js
// (requires `embedded-postgres` + `pg`, e.g. npm i -D embedded-postgres pg)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// embedded-postgres ships CJS (`exports.default`) — normalize for both
// interop shapes so the import works under ESM and require alike.
const EP = EPkg.default ?? EPkg;

import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 54332;
const DATA_DIR = '/tmp/pgtest-qsu/data';
const MIG_DIR = path.resolve(__dirname, '../../supabase/migrations');
const FIX_FILE = '20260911000002_quick_save_rpc_source_id_uuid.sql';

let pass = 0, failN = 0;
const ok = (l) => { pass++; console.log('  PASS', l); };
const fail = (l, e) => { failN++; console.log('  FAIL', l, '::', (e && (e.message || e)) || ''); };

async function main() {
  const PG = new EP({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await PG.initialise();
  await PG.start();
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  // ── Supabase-flavoured environment (roles, auth schema, extension stubs) ──
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
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
  // pg_cron / pg_net stubs (platform extensions unavailable under embedded PG)
  const EXT = '/tmp/node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension';
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron;\ncreate table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true);\ncreate sequence if not exists cron.jobid_seq;\ncreate or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);
  await c.query('set search_path = "$user", public, extensions');

  // ── Replay every migration EXCEPT the fix (reproduce the shipped state) ──
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && f !== FIX_FILE).sort();
  for (const f of files) {
    try { await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')); }
    catch (e) { fail(`replay ${f}`, e.message.split('\n')[0]); await teardown(c, PG); process.exit(1); }
  }
  console.log('replay OK:', files.length, 'migrations (fix held back)');

  const q = (sql, params) => c.query(sql, params);

  // ── Seed: owner, business, chart, product, stock, customer ────────────────
  const ownerId = '10000000-0000-0000-0000-0000000000aa';
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'owner@x.com','{"full_name":"Owner"}')`, [ownerId]);
  const asUser = (uid) => async (sql, params) => {
    await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await q('set role authenticated');
    try { return await q(sql, params); } finally { await q('reset role'); }
  };
  const owner = await asUser(ownerId);
  const biz = (await owner(`select public.create_business_with_owner('Uuid Co','Uuid',null,null,null,true,'MWK','07-01','Africa/Blantyre',null,'Blantyre','Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
  const loc = (await owner(`insert into public.inventory_locations (business_id, name, is_active, is_default) values ($1,'Main',true,true) returning id`, [biz])).rows[0].id;
  const cust = (await owner(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Customer A','customer',true,false) returning id`, [biz])).rows[0].id;
  const prod = (await owner(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency, cogs_account_id, inventory_account_id, sales_account_id)
    select $1,'Widget','WID','product',true,true,500,750,5,10,'none','none','MWK', (select id from public.accounts where business_id=$1 and code='5100'), (select id from public.accounts where business_id=$1 and code='1141'), (select id from public.accounts where business_id=$1 and code='4110') returning id`, [biz])).rows[0].id;
  const acc = async (code) => (await q(`select id from public.accounts where business_id=$1 and code=$2`, [biz, code])).rows[0].id;
  const acc1141 = await acc('1141'), acc1131 = await acc('1131'), acc4110 = await acc('4110');
  // Opening stock so save_quick_sale can read an average cost.
  await owner(`insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost)
    values ($1,$2,$3,10,0,10,500)`, [biz, prod, loc]);
  console.log('seed OK');

  // Client-shaped payloads (mirrors ExpensesPage/IncomePage buildPayload).
  const key = () => crypto.randomUUID();
  const expensePayload = () => ({
    business_id: biz,
    client_key: key(),
    expense: {
      business_id: biz, expense_type: 'receipt', status: 'paid', expense_date: '2026-09-01',
      currency: 'MWK', exchange_rate: 1, original_currency: 'MWK', original_amount: 1000,
      functional_currency: 'MWK', functional_amount: 1000, rate_date: '2026-09-01', rate_is_stale: false,
      subtotal: 1000, vat_amount: 0, wht_amount: 0, total_amount: 1000, amount_paid: 1000,
      reference: null, notes: null, branch_id: null, department_id: null, created_by: null,
    },
    lines: [{
      line_number: 1, description: 'Widgets for resale', quantity: 2, unit_price: 500,
      tax_code: 'none', tax_rate: 0, tax_amount: 0, line_total: 1000,
      account_id: acc1141, product_id: prod,
    }],
    allocations: [{ account_id: acc1141, amount: 1000, description: 'Widgets for resale' }],
    vat_amount: 0,
    stock_lines: [{ product_id: prod, quantity: 2, unit_cost: 500 }],
  });
  const salePayload = () => ({
    business_id: biz,
    client_key: key(),
    invoice: {
      business_id: biz, invoice_type: 'invoice', status: 'paid', contact_id: cust,
      issue_date: '2026-09-02', due_date: '2026-09-02', currency: 'MWK', exchange_rate: 1,
      original_currency: 'MWK', original_amount: 1500, functional_currency: 'MWK', functional_amount: 1500,
      rate_date: '2026-09-02', rate_is_stale: false, subtotal: 1500, discount_amount: 0,
      discount_percent: 0, taxable_amount: 1500, vat_amount: 0, wht_amount: 0,
      total_amount: 1500, amount_paid: 1500, ar_account_id: acc1131, notes: null,
      branch_id: null, department_id: null, created_by: null,
    },
    lines: [{
      line_number: 1, description: 'Widgets', quantity: 2, unit_price: 750, discount_percent: 0,
      tax_code: 'none', tax_rate: 0, tax_amount: 0, line_total: 1500,
      product_id: prod, account_id: acc4110,
    }],
    subtotal: 1500,
    vat_amount: 0,
    stock_lines: [{ product_id: prod, quantity: 2 }],
  });

  const callExpense = () => owner(`select public.save_quick_expense($1::jsonb) as r`, [JSON.stringify(expensePayload())]);
  const callSale = () => owner(`select public.save_quick_sale($1::jsonb) as r`, [JSON.stringify(salePayload())]);

  const verifySaved = async (label, r, kind) => {
    if (!r || !r.id) throw new Error(`${label}: no id returned (${JSON.stringify(r)})`);
    const docTable = kind === 'expense' ? 'expenses' : 'invoices';
    const docCol  = kind === 'expense' ? 'expense_number' : 'invoice_number';
    const doc = (await q(`select id, ${docCol} as number, journal_entry_id from public.${docTable} where id=$1`, [r.id])).rows[0];
    if (!doc) throw new Error(`${label}: document row missing`);
    if (!doc.journal_entry_id) throw new Error(`${label}: journal_entry_id not linked`);
    const je = (await q(`select source_type, source_id from public.journal_entries where id=$1`, [doc.journal_entry_id])).rows[0];
    if (!je || je.source_id !== r.id) throw new Error(`${label}: journal_entries.source_id ≠ document id (${je && JSON.stringify(je)})`);
    if (kind === 'expense' && je.source_type !== 'expense') throw new Error(`${label}: wrong source_type ${je.source_type}`);
    if (kind === 'sale' && je.source_type !== 'invoice') throw new Error(`${label}: wrong source_type ${je.source_type}`);
    const sm = (await q(`select source_id from public.stock_movements where source_id=$1 and business_id=$2 limit 1`, [r.id, biz])).rows[0];
    if (!sm) throw new Error(`${label}: stock_movements.source_id not recorded`);
    const bal = (await q(`select coalesce(sum(case when is_debit then amount_base else -amount_base end),0) as s from public.journal_lines where journal_entry_id=$1`, [doc.journal_entry_id])).rows[0];
    if (Math.abs(Number(bal.s)) > 0.005) throw new Error(`${label}: journal entry unbalanced (${bal.s})`);
    return doc;
  };

  try {
    // ── Phase A: repo/staging shape (source_id TEXT) — shipped code works ──
    let r;
    try { r = (await callExpense()).rows[0].r; await verifySaved('A quick expense', r, 'expense'); ok('A (text columns): save_quick_expense succeeds pre-fix'); }
    catch (e) { fail('A (text columns): save_quick_expense succeeds pre-fix', e); }
    try { r = (await callSale()).rows[0].r; await verifySaved('A quick sale', r, 'sale'); ok('A (text columns): save_quick_sale succeeds pre-fix'); }
    catch (e) { fail('A (text columns): save_quick_sale succeeds pre-fix', e); }

    // ── Phase B: production shape (source_id UUID) — shipped code fails ────
    await q(`alter table public.journal_entries alter column source_id type uuid using nullif(source_id, '')::uuid`);
    await q(`alter table public.stock_movements alter column source_id type uuid using nullif(source_id, '')::uuid`);
    ok('B: columns altered to uuid (production shape)');

    let err = null;
    try { await callExpense(); } catch (e) { err = e; }
    if (err && /column "source_id" is of type uuid but expression is of type text/i.test(err.message)) {
      ok('B (uuid columns): save_quick_expense reproduces the production 42804 error');
    } else {
      fail('B (uuid columns): save_quick_expense reproduces the production 42804 error', err || new Error('unexpectedly succeeded'));
    }
    let nothingSaved = null;
    try { nothingSaved = (await q(`select count(*)::int as n from public.expenses where expense_number like 'EXP-%'`)).rows[0].n; } catch (e) { nothingSaved = 'err'; }
    // Phase A created one expense; the failed Phase B save must not add another.
    if (nothingSaved === 1) ok('B (uuid columns): failed save rolled back completely (nothing was saved)');
    else fail('B (uuid columns): failed save rolled back completely', `expenses count = ${nothingSaved}, expected 1`);

    err = null;
    try { await callSale(); } catch (e) { err = e; }
    if (err && /column "source_id" is of type uuid but expression is of type text/i.test(err.message)) {
      ok('B (uuid columns): save_quick_sale reproduces the production 42804 error');
    } else {
      fail('B (uuid columns): save_quick_sale reproduces the production 42804 error', err || new Error('unexpectedly succeeded'));
    }

    // ── Apply the fix ───────────────────────────────────────────────────────
    try { await c.query(fs.readFileSync(path.join(MIG_DIR, FIX_FILE), 'utf8')); ok('fix migration applied cleanly onto live-shaped schema'); }
    catch (e) { fail('fix migration applied cleanly onto live-shaped schema', e.message.split('\n')[0]); }

    try { r = (await callExpense()).rows[0].r; await verifySaved('B-fixed quick expense', r, 'expense'); ok('B (uuid columns): save_quick_expense succeeds after fix'); }
    catch (e) { fail('B (uuid columns): save_quick_expense succeeds after fix', e); }
    try { r = (await callSale()).rows[0].r; await verifySaved('B-fixed quick sale', r, 'sale');
      if (!r.cogs_entry_id) throw new Error('COGS entry missing from RPC result');
      const cogs = (await q(`select source_id from public.journal_entries where id=$1`, [r.cogs_entry_id])).rows[0];
      if (!cogs || cogs.source_id !== r.id) throw new Error('COGS entry not linked to the invoice');
      ok('B (uuid columns): save_quick_sale succeeds after fix (journal + receipt + COGS + stock)');
    } catch (e) { fail('B (uuid columns): save_quick_sale succeeds after fix', e); }

    // ── Phase C: back to TEXT columns — the fix must not regress staging ───
    await q(`alter table public.stock_movements alter column source_id type text using source_id::text`);
    await q(`alter table public.journal_entries alter column source_id type text using source_id::text`);
    try { r = (await callExpense()).rows[0].r; await verifySaved('C quick expense', r, 'expense'); ok('C (text columns): save_quick_expense still succeeds after fix'); }
    catch (e) { fail('C (text columns): save_quick_expense still succeeds after fix', e); }
    try { r = (await callSale()).rows[0].r; await verifySaved('C quick sale', r, 'sale'); ok('C (text columns): save_quick_sale still succeeds after fix'); }
    catch (e) { fail('C (text columns): save_quick_sale still succeeds after fix', e); }

    console.log(`\nQUICK-SAVE SOURCE_ID UUID TESTS COMPLETE: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await teardown(c, PG);
  process.exit(failN > 0 ? 1 : 0);
}

async function teardown(c, PG) {
  try { await c.end(); } catch {}
  try { await PG.stop(); } catch {}
}

main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
