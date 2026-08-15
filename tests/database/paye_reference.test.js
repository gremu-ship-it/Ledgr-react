// Phase 9.2 — PAYE reference-data test.
// Replays all migrations, verifies the approved bands are seeded for every
// business (and custom bands preserved), then computes PAYE from the DB rows
// with the same algorithm as src/lib/paye.ts (annual bands, monthly result).
const EP = require('embedded-postgres').default;
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PORT = 54329;
const MIG_DIR = '/home/user/Ledgr-react/supabase/migrations';

// Same algorithm as src/lib/paye.ts calculatePAYE (annual bands → monthly).
function calculatePAYE(annualGross, bands) {
  const effectiveBands = bands.length === 0 ? [] : bands;
  let tax = 0;
  for (const band of effectiveBands) {
    if (annualGross <= Number(band.band_from)) break;
    const upper = band.band_to == null ? Infinity : Number(band.band_to);
    const taxable = Math.min(annualGross, upper) - Number(band.band_from);
    if (taxable <= 0) continue;
    tax += taxable * (Number(band.rate) / 100);
  }
  return tax / 12;
}

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
    // create two businesses BEFORE the reference-data migration would have run
    // (in the real sequence the migration runs after businesses exist; here it
    // runs during replay, so we create businesses first, then simulate by
    // checking the seeded rows — and one business with a CUSTOM band).
    const uidA = '10000000-0000-0000-0000-000000000001';
    const uidB = '20000000-0000-0000-0000-000000000001';
    await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'a@x.com','{}'), ($2,'b@x.com','{}')`, [uidA, uidB]);
    const asUser = (uid) => async (sql, params) => {
      await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await q('set role authenticated');
      try { return await q(sql, params); } finally { await q('reset role'); }
    };
    // NOTE: the reference-data migration already ran during replay (before any
    // businesses existed → seeded nothing). Simulate the real order: create
    // businesses, then apply the migration's insert manually via its SQL.
    const bizA = (await (await asUser(uidA))(`select public.create_business_with_owner('PAYE A','A',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
    const bizB = (await (await asUser(uidB))(`select public.create_business_with_owner('PAYE B','B',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;

    // give business B a CUSTOM band for 2026/27 (must be preserved)
    await q(`insert into public.paye_bands (business_id, band_from, band_to, band_label, rate, fiscal_year, effective_from)
      values ($1, 0, null, 'custom flat', 12, '2026/27', '2026-01-01')`, [bizB]);

    // apply the approved migration SQL directly (same file, re-run semantics)
    const migSql = fs.readFileSync(path.join(MIG_DIR, '20260816000000_phase9_paye_reference_data.sql'), 'utf8');
    await c.query(migSql);
    ok('approved reference-data migration applied (idempotent re-run)');

    // A: exactly 4 bands, correct values
    const bandsA = (await q(`select band_from, band_to, rate, band_label, fiscal_year, effective_from
      from public.paye_bands where business_id=$1 and fiscal_year='2026/27' order by band_from`, [bizA])).rows;
    if (bandsA.length === 4
      && Number(bandsA[0].band_from) === 0 && Number(bandsA[0].band_to) === 2_040_000 && Number(bandsA[0].rate) === 0
      && Number(bandsA[1].band_from) === 2_040_000 && Number(bandsA[1].band_to) === 18_840_000 && Number(bandsA[1].rate) === 30
      && Number(bandsA[2].band_from) === 18_840_000 && Number(bandsA[2].band_to) === 120_000_000 && Number(bandsA[2].rate) === 35
      && Number(bandsA[3].band_from) === 120_000_000 && bandsA[3].band_to === null && Number(bandsA[3].rate) === 40
      && bandsA[0].effective_from.toISOString().slice(0, 10) === '2025-12-30')
      ok('business A seeded with 4 approved bands (0/30/35/40, effective 2025-12-30)');
    else fail('business A bands', JSON.stringify(bandsA));

    // B: custom band preserved (still 1 row)
    const bandsB = (await q(`select count(*)::int n from public.paye_bands where business_id=$1 and fiscal_year='2026/27'`, [bizB])).rows[0].n;
    if (bandsB === 1) ok('business B custom band preserved (not overwritten)');
    else fail('business B custom band', bandsB);

    // PAYE calculations from DB bands (same algorithm as src/lib/paye.ts)
    const calc = (annual) => calculatePAYE(annual, bandsA);
    const cases = [
      [6_000_000, 99_000, '500,000/mo → 99,000'],
      [24_000_000, 570_500, '2,000,000/mo → 570,500'],
      [144_000_000, 4_170_500, '12,000,000/mo → 4,170,500'],
      [2_040_000, 0, '170,000/mo (threshold) → 0'],
      [1_500_000, 0, '125,000/mo → 0'],
    ];
    for (const [annual, expected, label] of cases) {
      const got = calc(annual);
      if (Math.abs(got - expected) < 0.005) ok(`PAYE ${label} (got ${got})`);
      else fail(`PAYE ${label}`, `got ${got}, expected ${expected}`);
    }

    // open top band: no upper bound
    const top = bandsA[3];
    if (top.band_to === null) ok('top band open-ended (band_to NULL)');
    else fail('top band open-ended', JSON.stringify(top));

    // re-run idempotency: applying again changes nothing
    const before = (await q(`select count(*)::int n from public.paye_bands where business_id=$1 and fiscal_year='2026/27'`, [bizA])).rows[0].n;
    await c.query(migSql);
    const after = (await q(`select count(*)::int n from public.paye_bands where business_id=$1 and fiscal_year='2026/27'`, [bizA])).rows[0].n;
    if (before === after) ok('migration idempotent (re-apply adds no duplicates)');
    else fail('idempotency', `${before} -> ${after}`);

    console.log(`\n9.2 PAYE REFERENCE TESTS COMPLETE: ${pass} passed, ${failN} failed`);
  } catch (e) {
    fail('unexpected', e);
  }
  await c.end();
  await PG.stop();
  process.exit(failN > 0 ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS', e.message); process.exit(2); });
