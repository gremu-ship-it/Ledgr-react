// Phase 8B.4 — storage reconstruction test.
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
  // storage stub with foldername + RLS
  await c.query(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text,
      owner uuid,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      last_accessed_at timestamptz,
      metadata jsonb default '{}'::jsonb
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      select string_to_array(name, '/')
    $$;
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
  const asUser = (uid) => async (sql, params) => {
    await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await q('set role authenticated');
    try { return await q(sql, params); } finally { await q('reset role'); }
  };

  try {
    // buckets exist
    const b = (await q(`select id, public from storage.buckets order by id`)).rows;
    const logos = b.find((x) => x.id === 'business-logos');
    const exports_ = b.find((x) => x.id === 'user-exports');
    if (logos && logos.public === true) ok('business-logos bucket exists (public)');
    else fail('business-logos bucket', JSON.stringify(b));
    if (exports_ && exports_.public === false) ok('user-exports bucket exists (private)');
    else fail('user-exports bucket', JSON.stringify(b));

    // policies exist
    const pols = (await q(`select policyname from pg_policies where schemaname='storage' and tablename='objects' order by 1`)).rows.map((r) => r.policyname);
    if (pols.includes('business_logos_insert') && pols.includes('business_logos_update')) ok(`storage policies: ${pols.join(', ')}`);
    else fail('storage policies', pols.join(','));

    // setup: org A owner + org B owner
    const uidA = '10000000-0000-0000-0000-000000000001';
    const uidB = '20000000-0000-0000-0000-000000000001';
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'ao@x.com','{}'), ($2,'bo@x.com','{}')`, [uidA, uidB]);
    const a = await asUser(uidA);
    const bizA = (await a(`select public.create_business_with_owner('A Co','A',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
    const bizB = (await (await asUser(uidB))(`select public.create_business_with_owner('B Co','B',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;

    // A-owner uploads to own business folder (allowed)
    await (async () => {
      const r = await a(`insert into storage.objects (bucket_id, name, owner) values ('business-logos', $1, $2) returning id`, [`${bizA}/logo-1.png`, uidA]);
      if (r.rows.length === 1) ok('A-owner uploads logo to own business folder');
      else fail('A-owner upload own logo', JSON.stringify(r.rows));
    })();

    // A-owner uploads to B's folder (denied)
    await (async () => {
      try {
        const r = await a(`insert into storage.objects (bucket_id, name, owner) values ('business-logos', $1, $2) returning id`, [`${bizB}/logo-evil.png`, uidA]);
        if (r.rows.length === 0) ok('A-owner upload to B folder denied (0 rows)');
        else fail('A-owner upload to B folder ALLOWED', JSON.stringify(r.rows));
      } catch (e) { ok('A-owner upload to B folder denied (error)'); }
    })();

    // A-owner uploads to wrong bucket (denied)
    await (async () => {
      try {
        const r = await a(`insert into storage.objects (bucket_id, name, owner) values ('user-exports', $1, $2) returning id`, [`${bizA}/x.zip`, uidA]);
        if (r.rows.length === 0) ok('A-owner upload to user-exports denied (0 rows)');
        else fail('A-owner upload to user-exports ALLOWED', JSON.stringify(r.rows));
      } catch (e) { ok('A-owner upload to user-exports denied (error)'); }
    })();

    // anonymous cannot upload
    await (async () => {
      await q(`select set_config('request.jwt.claim.sub', null, false)`);
      await q(`select set_config('request.jwt.claim.role', 'anon', false)`);
      await q('set role anon');
      try {
        const r = await q(`insert into storage.objects (bucket_id, name, owner) values ('business-logos', 'anon.png', null) returning id`);
        if (r.rows.length === 0) ok('anon upload denied (0 rows)');
        else fail('anon upload ALLOWED', JSON.stringify(r.rows));
      } catch (e) { ok('anon upload denied (error)'); }
      await q('reset role');
    })();

    // service_role can write user-exports (edge function path)
    await q('set role service_role');
    const r2 = await q(`insert into storage.objects (bucket_id, name, owner) values ('user-exports', $1, $2) returning id`, [`${uidA}/123_ledgr_export.zip`, uidA]);
    if (r2.rows.length === 1) ok('service_role uploads user-export (edge function path)');
    else fail('service_role upload', JSON.stringify(r2.rows));
    await q('reset role');

    console.log(`\n8B.4 STORAGE TESTS COMPLETE: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
