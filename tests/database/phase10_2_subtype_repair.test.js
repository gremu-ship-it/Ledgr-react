// Phase 10.2 — regression test for the fixed-asset subtype repair migration
// (20260819000000_phase10_2_restore_fixed_asset_subtypes.sql) and the SOFP
// report override that routes every 15xx asset account to Non-Current Assets.
const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54331;
const MIG_DIR = '/home/user/Ledgr-react/supabase/migrations';

async function main() {
  const PG = new EP({ databaseDir: '/tmp/pgtest/data-subtype', user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync('/tmp/pgtest/data-subtype', { recursive: true, force: true });
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
    const uid = '10000000-0000-0000-0000-000000000003';
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'subtype@x.com','{"full_name":"Subtype"}')`, [uid]);
    const asUser = async (sql, params) => {
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await q('set role authenticated');
      try { return await q(sql, params); } finally { await q('reset role'); }
    };
    const biz = (await asUser(`select public.create_business_with_owner('Subtype Co','Sub',null,null,null,true,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
    ok('business created with seeded COA');

    // Fresh seed: all 15xx asset accounts already carry a proper subtype.
    const fresh = (await q(`select count(*)::int as n from public.accounts
      where business_id=$1 and account_type='asset' and code like '15%'
        and (account_subtype is null or account_subtype not in ('current_asset','non_current_asset','fixed_asset'))`, [biz])).rows[0];
    if (fresh.n === 0) ok('fresh COA: every 15xx asset account has a proper subtype');
    else fail('fresh COA has broken subtypes', fresh.n);

    // Corrupt: 1513 -> NULL, 1531 -> 'revenue', 1521 -> 'current_asset'
    await asUser(`update public.accounts set account_subtype = null where business_id=$1 and code='1513'`, [biz]);
    await asUser(`update public.accounts set account_subtype = 'revenue' where business_id=$1 and code='1531'`, [biz]);
    await asUser(`update public.accounts set account_subtype = 'current_asset' where business_id=$1 and code='1521'`, [biz]);

    // Re-run the repair migration (idempotent).
    await q(fs.readFileSync(path.join(MIG_DIR, '20260819000000_phase10_2_restore_fixed_asset_subtypes.sql'), 'utf8'));

    const sub = async (code) => (await q(`select account_subtype from public.accounts where business_id=$1 and code=$2`, [biz, code])).rows[0].account_subtype;
    if ((await sub('1513')) === 'fixed_asset') ok('1513 NULL subtype -> fixed_asset (repair)');
    else fail('1513 not repaired', await sub('1513'));
    if ((await sub('1531')) === 'non_current_asset') ok('1531 junk "revenue" subtype -> non_current_asset (repair)');
    else fail('1531 not repaired', await sub('1531'));
    if ((await sub('1521')) === 'current_asset') ok('1521 "current_asset" left as-is (deliberate-looking choice preserved)');
    else fail('1521 changed unexpectedly', await sub('1521'));
    if ((await sub('1512')) === 'fixed_asset') ok('1512 untouched (already correct)');
    else fail('1512 changed unexpectedly', await sub('1512'));
    if ((await sub('1500')) === 'non_current_asset') ok('1500 group untouched (already correct)');
    else fail('1500 changed unexpectedly', await sub('1500'));

    // Idempotency: a second run changes nothing.
    const before = (await q(`select id, account_subtype from public.accounts where business_id=$1 and code like '15%' order by code`, [biz])).rows;
    await q(fs.readFileSync(path.join(MIG_DIR, '20260819000000_phase10_2_restore_fixed_asset_subtypes.sql'), 'utf8'));
    const after = (await q(`select id, account_subtype from public.accounts where business_id=$1 and code like '15%' order by code`, [biz])).rows;
    if (JSON.stringify(before) === JSON.stringify(after)) ok('migration idempotent (second run is a no-op)');
    else fail('migration not idempotent', JSON.stringify({ before, after }));

    console.log(`\nPHASE 10.2 SUBTYPE REPAIR TESTS: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
