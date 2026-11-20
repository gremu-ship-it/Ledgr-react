// Regression test: `post_financial_journal` vs both shapes of
// journal_entries.source_id.
//
// Reported from production (Issue shares, loans, expenses, invoices):
//
//   column "source_id" is of type uuid but expression is of type text
//
// The repository base schema declares journal_entries.source_id / created_by /
// posted_by as TEXT, so every replay and release probe passed; the live
// database declares them UUID (see 20260911000002 and 20261014000001), and
// 20261225000001 wrote the text parameter straight into the column. PostgreSQL
// has no implicit text→uuid assignment, so the INSERT raised 42804 and the
// whole posting rolled back.
//
// This harness replays every migration except the fix
// (20261225000002_fix_journal_source_id_uuid_cast.sql), then:
//
//   A. TEXT columns (repo/staging shape) — the shipped command posts, keeps a
//      uuid source id, a composite (non-uuid) key, '' and NULL.
//   B. UUID columns (production shape)   — the shipped command fails with 42804
//                                          (the reported bug), proving the
//                                          harness reproduces it.
//   C. Applies the fix — uuid / '' / NULL / non-uuid source ids all post on the
//      uuid shape, created_by and posted_by are written, the draft→posted
//      command works, and the cost-centre command works.
//   D. TEXT columns again — nothing regressed.
//
// Run: node tests/database/post_financial_journal_source_uuid.test.js
// (requires `embedded-postgres` + `pg`)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EP = EPkg.default ?? EPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 54334;
const DATA_DIR = '/tmp/pgtest-journal-source/data';
const MIG_DIR = path.resolve(__dirname, '../../supabase/migrations');
const FIX_FILE = '20261225000002_fix_journal_source_id_uuid_cast.sql';
// `@embedded-postgres/linux-x64` does not export ./package.json, so locate the
// bundled PostgreSQL extension directory from the repository root instead.
const EXT = path.resolve(
  __dirname, '../../node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension',
);

let pass = 0;
let failN = 0;
const ok = (l) => { pass += 1; console.log('  PASS', l); };
const fail = (l, e) => { failN += 1; console.log('  FAIL', l, '::', (e && (e.message || e)) || ''); };

async function main() {
  const PG = new EP({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await PG.initialise();
  await PG.start();
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  // ── Supabase-flavoured environment ────────────────────────────────────────
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
  // pg_cron stub: full enough surface (jobname, alter_job, unschedule) for the
  // scheduling migrations to replay. pg_cron is unavailable under embedded PG.
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), `
create schema if not exists cron;
create sequence if not exists cron.jobid_seq;
create table if not exists cron.job (
  jobid bigint primary key default nextval('cron.jobid_seq'),
  schedule text not null,
  command text not null,
  nodename text default 'localhost',
  nodeport integer default 5432,
  database text default current_database(),
  username text default current_user,
  active boolean default true,
  jobname text
);
create unique index if not exists job_jobname_uniq on cron.job (jobname) where jobname is not null;
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  select jobid into v_id from cron.job where jobname = job_name and username = current_user;
  if v_id is not null then
    update cron.job set schedule = $2, command = $3, active = true where jobid = v_id;
    return v_id;
  end if;
  insert into cron.job (schedule, command, jobname, username) values ($2, $3, job_name, current_user) returning jobid into v_id;
  return v_id;
end $$;
create or replace function cron.schedule(schedule text, command text) returns bigint
language sql as $$ select cron.schedule(null::text, $1, $2) $$;
create or replace function cron.unschedule(job_name text) returns boolean
language plpgsql as $$ begin delete from cron.job where jobname = job_name; return found; end $$;
create or replace function cron.unschedule(job_id bigint) returns boolean
language plpgsql as $$ begin delete from cron.job where jobid = job_id; return found; end $$;
create or replace function cron.alter_job(job_id bigint, schedule text default null, command text default null,
  database text default null, username text default null, active boolean default null) returns void
language sql as $$
  update cron.job set
    schedule = coalesce($2, schedule),
    command  = coalesce($3, command),
    database = coalesce($4, database),
    username = coalesce($5, username),
    active   = coalesce($6, active)
  where jobid = $1
$$;
`);
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);
  await c.query('set search_path = "$user", public, extensions');

  // ── Replay everything except the fix ──────────────────────────────────────
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql') && f !== FIX_FILE).sort();
  for (const f of files) {
    try {
      await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    } catch (e) {
      fail(`replay ${f}`, e.message.split('\n')[0]);
      await PG.stop();
      process.exit(1);
    }
  }
  console.log('replay OK:', files.length, 'migrations (fix held back)');

  const q = (sql, params) => c.query(sql, params);

  // ── Seed: owner + business + chart of accounts ───────────────────────────
  const ownerId = '10000000-0000-0000-0000-0000000000ab';
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'owner@journal.test','{"full_name":"Owner"}')`, [ownerId]);
  const asUser = (uid) => async (sql, params) => {
    await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await q('set role authenticated');
    try { return await q(sql, params); } finally { await q('reset role'); }
  };
  const owner = await asUser(ownerId);
  const biz = (await owner(`select public.create_business_with_owner('Journal Source Co','JSC',null,null,null,true,'MWK','07-01','Africa/Blantyre',null,'Blantyre','Malawi',null,null,null,'INV','EXP','PAY') as id`)).rows[0].id;
  const accounts = (await q(
    'select id from public.accounts where business_id=$1 and is_group=false order by code limit 2', [biz],
  )).rows.map((r) => r.id);
  if (accounts.length < 2) throw new Error('seed: chart of accounts missing');
  const branch = (await q(`insert into public.branches (business_id, name, code) values ($1,'Main','M1') returning id`, [biz])).rows[0].id;
  console.log('seed OK');

  const lines = JSON.stringify([
    { account_id: accounts[0], is_debit: true, amount: 100, amount_base: 100, description: 'Debit' },
    { account_id: accounts[1], is_debit: false, amount: 100, amount_base: 100, description: 'Credit' },
  ]);

  // The 14-parameter command, called the way the client calls it.
  const postJournal = (sourceId, extra = {}) => owner(
    `select public.post_financial_journal(
       p_business_id => $1::uuid, p_entry_date => $2::date, p_description => $3,
       p_reference => null, p_source_type => $4, p_source_id => $5,
       p_lines => $6::jsonb, p_currency => 'MWK', p_exchange_rate => 1,
       p_branch_id => null, p_department_id => null, p_status => $7,
       p_entry_number => null, p_posting_key => $8
     ) as id`,
    [biz, '2026-12-25', 'Issue shares', extra.sourceType ?? 'share_issue', sourceId, lines, extra.status ?? 'posted', extra.postingKey ?? null],
  );

  const entryOf = async (id) => (await q(
    'select source_id, source_type, created_by, posted_by, status::text s, posting_key from public.journal_entries where id=$1', [id],
  )).rows[0];

  const expectFailure = async (label, fn, pattern, code) => {
    try {
      await fn();
      fail(label, 'command succeeded but should have failed');
    } catch (e) {
      if (pattern && !pattern.test(e.message)) fail(label, `wrong error: ${e.message}`);
      else if (code && e.code !== code) fail(label, `wrong SQLSTATE ${e.code}: ${e.message}`);
      else ok(label);
    }
  };

  try {
    // ── A. TEXT shape (repo/staging) — shipped command works ────────────────
    const uuidSource = randomUUID();
    const a1 = (await postJournal(uuidSource, { postingKey: `A:${uuidSource}` })).rows[0].id;
    const a1row = await entryOf(a1);
    if (a1row.source_id !== uuidSource) fail('A (text columns): uuid source id stored verbatim', JSON.stringify(a1row));
    else ok('A (text columns): uuid source id stored verbatim');

    // Pre-fix behaviour: the parameter is written verbatim, so '' is stored as
    // ''. The fix normalises it to NULL (asserted in phase D).
    const a2 = (await postJournal('', { postingKey: `A2:${randomUUID()}` })).rows[0].id;
    const a2row = await entryOf(a2);
    if (a2row.source_id !== '') fail('A (text columns): empty string posts as before', JSON.stringify(a2row));
    else ok('A (text columns): empty string posts as before');

    const a3 = (await postJournal(null, { postingKey: `A3:${randomUUID()}` })).rows[0].id;
    if ((await entryOf(a3)).source_id !== null) fail('A (text columns): null source id posts');
    else ok('A (text columns): null source id posts');

    const a4 = (await postJournal('GRN-2026-0001', { sourceType: 'stock_receipt', postingKey: `A4:${randomUUID()}` })).rows[0].id;
    const a4row = await entryOf(a4);
    if (a4row.source_id !== 'GRN-2026-0001') fail('A (text columns): composite key preserved', JSON.stringify(a4row));
    else ok('A (text columns): composite key preserved');

    // ── B. UUID shape (production) — the shipped command reproduces the bug ─
    await q(`alter table public.journal_entries
               alter column source_id type uuid using case when source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then source_id::uuid else null end,
               alter column created_by type uuid using case when created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then created_by::uuid else null end,
               alter column posted_by  type uuid using case when posted_by  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then posted_by::uuid else null end`);
    ok('B: journal_entries.source_id / created_by / posted_by altered to uuid (production shape)');

    await expectFailure(
      'B (uuid columns): shipped command reproduces the reported 42804',
      () => postJournal(randomUUID(), { postingKey: `B:${randomUUID()}` }),
      /is of type uuid but expression is of type text/i,
      '42804',
    );

    // ── C. Apply the fix ────────────────────────────────────────────────────
    await q(fs.readFileSync(path.join(MIG_DIR, FIX_FILE), 'utf8'));
    ok('C: fix migration applied');

    const c1source = randomUUID();
    const c1 = (await postJournal(c1source, { postingKey: `C1:${c1source}` })).rows[0].id;
    const c1row = await entryOf(c1);
    if (c1row.source_id !== c1source) fail('C (uuid columns): uuid source id stored', JSON.stringify(c1row));
    else ok('C (uuid columns): uuid source id stored');
    if (c1row.created_by !== ownerId) fail('C (uuid columns): created_by records the caller', JSON.stringify(c1row));
    else ok('C (uuid columns): created_by records the caller');

    const c2 = (await postJournal('', { postingKey: `C2:${randomUUID()}` })).rows[0].id;
    if ((await entryOf(c2)).source_id !== null) fail('C (uuid columns): empty string posts as NULL');
    else ok('C (uuid columns): empty string posts as NULL');

    const c3 = (await postJournal(null, { postingKey: `C3:${randomUUID()}` })).rows[0].id;
    if ((await entryOf(c3)).source_id !== null) fail('C (uuid columns): null source id posts');
    else ok('C (uuid columns): null source id posts');

    // A composite key cannot live in a uuid column: the posting still succeeds,
    // and the key survives in posting_key where callers match on it.
    const key4 = `C4:${randomUUID()}`;
    const c4 = (await postJournal('GRN-2026-0002', { sourceType: 'stock_receipt', postingKey: key4 })).rows[0].id;
    const c4row = await entryOf(c4);
    if (c4row.source_id !== null || c4row.posting_key !== key4) fail('C (uuid columns): non-uuid key posts, key kept in posting_key', JSON.stringify(c4row));
    else ok('C (uuid columns): non-uuid key posts, key kept in posting_key');

    // Draft → posted: posted_by is a uuid column on this shape.
    const draftId = (await postJournal(randomUUID(), { status: 'draft', postingKey: `C5:${randomUUID()}` })).rows[0].id;
    await owner('select public.post_draft_financial_journal($1::uuid, $2)', [draftId, ownerId]);
    const posted = await entryOf(draftId);
    if (posted.s !== 'posted' || posted.posted_by !== ownerId) fail('C (uuid columns): draft→posted writes posted_by', JSON.stringify(posted));
    else ok('C (uuid columns): draft→posted writes posted_by');

    // Cost centre: reads and compares the uuid-shaped source_id.
    const taggedSource = randomUUID();
    const tagged = (await postJournal(taggedSource, { sourceType: 'invoice', postingKey: `C6:${randomUUID()}` })).rows[0].id;
    await owner('select public.assign_financial_journal_cost_centre($1::uuid, $2::uuid, null)', [tagged, branch]);
    const taggedRow = (await q('select branch_id from public.journal_entries where id=$1', [tagged])).rows[0];
    if (taggedRow.branch_id !== branch) fail('C (uuid columns): cost-centre command works', JSON.stringify(taggedRow));
    else ok('C (uuid columns): cost-centre command works');

    // ── D. Back to TEXT shape — still correct ───────────────────────────────
    await q(`alter table public.journal_entries
               alter column source_id type text using source_id::text,
               alter column created_by type text using created_by::text,
               alter column posted_by type text using posted_by::text`);
    const d1source = randomUUID();
    const d1 = (await postJournal(d1source, { postingKey: `D1:${d1source}` })).rows[0].id;
    if ((await entryOf(d1)).source_id !== d1source) fail('D (text columns): uuid source id still stored');
    else ok('D (text columns): uuid source id still stored');
    const d2 = (await postJournal('GRN-2026-0003', { sourceType: 'stock_receipt', postingKey: `D2:${randomUUID()}` })).rows[0].id;
    if ((await entryOf(d2)).source_id !== 'GRN-2026-0003') fail('D (text columns): composite key still preserved');
    else ok('D (text columns): composite key still preserved');
    const d3 = (await postJournal('', { postingKey: `D3:${randomUUID()}` })).rows[0].id;
    if ((await entryOf(d3)).source_id !== null) fail('D (text columns): empty string normalises to NULL');
    else ok('D (text columns): empty string normalises to NULL');
  } catch (e) {
    fail('unexpected error', e);
  }

  console.log(`\n${pass} passed, ${failN} failed`);
  await PG.stop();
  process.exit(failN === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
