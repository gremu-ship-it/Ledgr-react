// Phase 8B.3 — RLS security test matrix (ORG-A / ORG-B cross-tenant).
// CRITICAL: RLS tests run as SET ROLE authenticated (postgres superuser
// bypasses RLS — the earlier version's false pass/fail artifacts).
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
  await c.query(`CREATE SCHEMA IF NOT EXISTS storage; GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;`);
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

  const U = {
    ao: '10000000-0000-0000-0000-000000000001',
    am: '10000000-0000-0000-0000-000000000002',
    au: '10000000-0000-0000-0000-000000000003',
    bo: '20000000-0000-0000-0000-000000000001',
    bu: '20000000-0000-0000-0000-000000000002',
  };

  // asUser(uid) runs a query with SET ROLE authenticated + jwt claims.
  const asUser = (uid) => async (sql, params) => {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await c.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await c.query('set role authenticated');
    try {
      return await c.query(sql, params);
    } finally {
      await c.query('reset role');
    }
  };
  const asAnon = async (sql, params) => {
    await c.query(`select set_config('request.jwt.claim.sub', null, false)`);
    await c.query(`select set_config('request.jwt.claim.role', 'anon', false)`);
    await c.query('set role anon');
    try {
      return await c.query(sql, params);
    } finally {
      await c.query('reset role');
    }
  };

  const expectCount = async (label, run, sql, params, expected) => {
    try {
      const r = await run(sql, params);
      const n = r.rows[0] ? r.rows[0].n : 0;
      if (Number(n) === expected) ok(`${label} (rows=${n})`);
      else fail(`${label} (rows=${n}, expected ${expected})`);
    } catch (e) { fail(`${label} threw`, e); }
  };
  const expectDenied = async (label, run, sql, params) => {
    try {
      const r = await run(sql, params);
      const n = r.rows[0] ? r.rows[0].n : 0;
      if (Number(n) === 0) ok(`${label} (denied: 0 rows)`);
      else fail(`${label} (ALLOWED: ${n} rows!)`);
    } catch (e) { ok(`${label} (denied by error)`); }
  };

  try {
    // ── setup: ORG-A (owner ao, admin am, accountant au), ORG-B (owner bo, viewer bu)
    for (const [uid, email] of [[U.ao, 'a-owner@x.com'], [U.am, 'a-mgr@x.com'], [U.au, 'a-user@x.com'], [U.bo, 'b-owner@x.com'], [U.bu, 'b-user@x.com']]) {
      await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,'{"full_name":"X"}') on conflict (id) do nothing`, [uid, email]);
    }
    const A = await (await asUser(U.ao))(`select public.create_business_with_owner('Org A Co','Org A',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`);
    const B = await (await asUser(U.bo))(`select public.create_business_with_owner('Org B Co','Org B',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`);
    const BIZ_A = A.rows[0].id, BIZ_B = B.rows[0].id;
    // invites + accepts (each org's owner invites; member accepts)
    for (const [owner, uid, email, role, biz] of [[U.ao, U.am, 'a-mgr@x.com', 'admin', BIZ_A], [U.ao, U.au, 'a-user@x.com', 'accountant', BIZ_A], [U.bo, U.bu, 'b-user@x.com', 'viewer', BIZ_B]]) {
      const tok = await (await asUser(owner))(`select public.invite_member($1, $2, $3) as t`, [biz, email, role]);
      await (await asUser(uid))(`select public.accept_invitation($1)`, [tok.rows[0].t]);
    }
    ok(`orgs: A=${BIZ_A} B=${BIZ_B}; memberships: A(owner/admin/accountant) B(owner/viewer)`);

    // seed tenant data (superuser = service_role equivalent)
    await q(`insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'A-Customer','customer',true,false), ($2,'B-Customer','customer',true,false)`, [BIZ_A, BIZ_B]);
    await q(`insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency)
      values ($1,'A-Product','A-SKU','product',true,true,10,20,5,10,'none','none','MWK'), ($2,'B-Product','B-SKU','product',true,true,10,20,5,10,'none','none','MWK')`, [BIZ_A, BIZ_B]);
    const accA = (await q(`select id, code from public.accounts where business_id=$1 and code in ('1110','4112')`, [BIZ_A])).rows;
    const je = await q(`insert into public.journal_entries (business_id, entry_date, entry_number, description, currency, exchange_rate, status)
      values ($1,'2026-07-01','A-JE-1','A entry','MWK',1,'posted') returning id`, [BIZ_A]);
    await q(`insert into public.journal_lines (business_id, journal_entry_id, account_id, line_number, is_debit, amount, amount_base, currency, exchange_rate, description, reconciled, tax_amount, tax_code)
      values ($1,$2,$3,1,true,100,100,'MWK',1,'dr',false,0,'none'), ($1,$2,$4,2,false,100,100,'MWK',1,'cr',false,0,'none')`,
      [BIZ_A, je.rows[0].id, accA[0].id, accA[1].id]);
    await q(`insert into public.employees (business_id, employee_number, first_name, last_name, employment_type, gross_salary, currency, is_active, payment_method, pay_frequency, start_date, tax_exempt)
      values ($1,'E1','Alice','A','full_time',100000,'MWK',true,'bank_transfer','monthly','2025-01-01',false)`, [BIZ_A]);
    ok('tenant data seeded (contacts, products, journal, employee)');

    // ── 1. CROSS-TENANT READ ────────────────────────────────────────────────
    const au = await asUser(U.au); // A accountant
    await expectCount('A-user reads A contacts', au, `select count(*)::int n from public.contacts where business_id=$1`, [BIZ_A], 1);
    await expectDenied('A-user reads B contacts', au, `select count(*)::int n from public.contacts where business_id=$1`, [BIZ_B]);
    await expectCount('A-user reads A products', au, `select count(*)::int n from public.products where business_id=$1`, [BIZ_A], 1);
    await expectDenied('A-user reads B products', au, `select count(*)::int n from public.products where business_id=$1`, [BIZ_B]);
    await expectCount('A-user reads A journal_lines', au, `select count(*)::int n from public.journal_lines where business_id=$1`, [BIZ_A], 2);
    await expectDenied('A-user reads B journal_lines', au, `select count(*)::int n from public.journal_lines where business_id=$1`, [BIZ_B]);
    await expectDenied('A-user reads A invoices (none exist)', au, `select count(*)::int n from public.invoices where business_id=$1`, [BIZ_A], 0);
    const bu = await asUser(U.bu); // B viewer
    await expectDenied('B-user reads A products', bu, `select count(*)::int n from public.products where business_id=$1`, [BIZ_A]);
    await expectCount('B-user reads B products', bu, `select count(*)::int n from public.products where business_id=$1`, [BIZ_B], 1);
    await expectDenied('anon reads A contacts', asAnon, `select count(*)::int n from public.contacts where business_id=$1`, [BIZ_A]);
    await expectDenied('anon reads A products', asAnon, `select count(*)::int n from public.products where business_id=$1`, [BIZ_A]);

    // ── 2. CROSS-TENANT WRITE (must fail) ───────────────────────────────────
    await expectDenied('A-user INSERT into B contacts', au, `with ins as (insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'hack','customer',true,false) returning id) select count(*)::int n from ins`, [BIZ_B]);
    await expectDenied('A-user INSERT into B products', au, `with ins as (insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, purchase_tax_code, sales_tax_code, currency) values ($1,'hack','H','product',true,true,1,1,'none','none','MWK') returning id) select count(*)::int n from ins`, [BIZ_B]);
    await expectDenied('A-user UPDATE B contact', au, `with upd as (update public.contacts set name='hacked' where business_id=$1 returning id) select count(*)::int n from upd`, [BIZ_B]);
    await expectDenied('A-user DELETE B contact', au, `with del as (delete from public.contacts where business_id=$1 returning id) select count(*)::int n from del`, [BIZ_B]);
    await expectCount('A-user INSERT into A contacts (writer)', au, `with ins as (insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'A-Customer2','customer',true,false) returning id) select count(*)::int n from ins`, [BIZ_A], 1);

    // ── 3. ROLE tests ───────────────────────────────────────────────────────
    await expectCount('accountant INSERT A product', au, `with ins as (insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, purchase_tax_code, sales_tax_code, currency) values ($1,'A-P2','A-SKU2','product',true,true,1,1,'none','none','MWK') returning id) select count(*)::int n from ins`, [BIZ_A], 1);
    await expectDenied('viewer INSERT A product', bu, `with ins as (insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, purchase_tax_code, sales_tax_code, currency) values ($1,'x','x','product',true,true,1,1,'none','none','MWK') returning id) select count(*)::int n from ins`, [BIZ_A]);
    await expectDenied('viewer INSERT own B product (viewer not writer)', bu, `with ins as (insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, purchase_tax_code, sales_tax_code, currency) values ($1,'x','x','product',true,true,1,1,'none','none','MWK') returning id) select count(*)::int n from ins`, [BIZ_B]);
    await expectDenied('accountant DELETE A product (admin only)', au, `with del as (delete from public.products where business_id=$1 returning id) select count(*)::int n from del`, [BIZ_A]);
    const ao = await asUser(U.ao);
    await expectCount('owner DELETE A product', ao, `with del as (delete from public.products where business_id=$1 and sku='A-SKU2' returning id) select count(*)::int n from del`, [BIZ_A], 1);

    // ── 4. business_users / user_profiles ───────────────────────────────────
    await expectCount('A-user reads own memberships', au, `select count(*)::int n from public.business_users where user_id=$1 and is_active=true`, [U.au], 1);
    await expectCount('A-user reads A team list', au, `select count(*)::int n from public.business_users where business_id=$1`, [BIZ_A], 3);
    await expectDenied('A-user reads B team list', au, `select count(*)::int n from public.business_users where business_id=$1`, [BIZ_B]);
    await expectCount('A-user reads own profile', au, `select count(*)::int n from public.user_profiles where id=$1`, [U.au], 1);
    await expectCount('A-user reads A-members profiles', au, `select count(*)::int n from public.user_profiles where id in ($1,$2,$3)`, [U.ao, U.am, U.au], 3);
    await expectDenied('A-user reads B-user profile', au, `select count(*)::int n from public.user_profiles where id=$1`, [U.bu]);
    await expectCount('A-user UPDATE own profile', au, `with upd as (update public.user_profiles set preferred_language='ny' where id=$1 returning id) select count(*)::int n from upd`, [U.au], 1);
    await expectDenied('A-user UPDATE B profile', au, `with upd as (update public.user_profiles set preferred_language='en' where id=$1 returning id) select count(*)::int n from upd`, [U.bu]);

    // ── 5. audit_log (immutable + role-gated) ───────────────────────────────
    await (await asUser(U.ao))(`select public.log_manual_audit_event($1, 'test_event', 'products', 'x', null, null, null, 'audit entry')`, [BIZ_A]);
    await expectCount('accountant reads A audit log (can_read_audit)', au, `select count(*)::int n from public.audit_log where business_id=$1`, [BIZ_A], 2);
    await expectDenied('viewer reads B audit log (not auditor)', bu, `select count(*)::int n from public.audit_log where business_id=$1`, [BIZ_B]);
    await expectDenied('owner UPDATE audit row (immutable)', ao, `with upd as (update public.audit_log set notes='forged' where business_id=$1 returning id) select count(*)::int n from upd`, [BIZ_A]);
    await expectDenied('owner DELETE audit row (immutable)', ao, `with del as (delete from public.audit_log where business_id=$1 returning id) select count(*)::int n from del`, [BIZ_A]);
    await expectDenied('owner INSERT audit row directly', ao, `with ins as (insert into public.audit_log (business_id, event_type, resource_type, occurred_at, ip_address) values ($1,'x','x',now(),'0.0.0.0') returning id) select count(*)::int n from ins`, [BIZ_A]);

    // ── 6. payroll isolation ────────────────────────────────────────────────
    await expectCount('accountant reads A employees (payroll tier includes accountant per 20260728000009)', au, `select count(*)::int n from public.employees where business_id=$1`, [BIZ_A], 1);
    await expectDenied('B-viewer reads A employees (cross-tenant)', bu, `select count(*)::int n from public.employees where business_id=$1`, [BIZ_A]);
    await expectDenied('B-viewer INSERT A employee (cross-tenant, outside payroll tier)', bu, `with ins as (insert into public.employees (business_id, employee_number, first_name, last_name, employment_type, gross_salary, currency, is_active, payment_method, pay_frequency, start_date, tax_exempt) values ($1,'E2','Bob','B','full_time',100,'MWK',true,'bank_transfer','monthly','2025-01-01',false) returning id) select count(*)::int n from ins`, [BIZ_A]);
    await expectCount('admin reads A employees (payroll tier)', ao, `select count(*)::int n from public.employees where business_id=$1`, [BIZ_A], 1);

    // ── 7. RPC boundary: non-member cannot use audit RPC on B ───────────────
    await expectDenied('A-user log_manual_audit_event on B (RPC check)', au, `select public.log_manual_audit_event($1,'x','x','x')`, [BIZ_B]);

    console.log(`\n8B.3 RLS SECURITY TESTS COMPLETE: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
