// Pre-deploy verification for the pg_cron privilege contract.
//
// WHY THIS EXISTS
// ---------------
// On 2026-10-08 `supabase db push` against production aborted at
// 20261017000000_subscription_expiry_enforcement.sql with
//
//   ERROR: permission denied for table job (SQLSTATE 42501)
//
// The push connects as a role that owns neither the pg_cron extension nor its
// tables, so `update cron.job` (section 3 of that migration — the only statement
// in the whole migration set that writes pg_cron's table directly) is refused.
// Because the push aborted, the migration was never recorded in
// supabase_migrations.schema_migrations and the deploy gate
// (scripts/ci/verify-migration-target.sh) stayed closed.
//
// pg_cron's own entry points (cron.schedule / cron.unschedule / cron.alter_job)
// are SECURITY DEFINER, which is why every other scheduler in this repo works as
// the linked role. Section 3 now tries the UPDATE and falls back to
// cron.alter_job when it is refused.
//
// This harness replays the whole migration set, then re-runs section 3 under a
// role that holds SELECT but not UPDATE on cron.job — production's situation —
// and asserts:
//
//   1. the block completes instead of raising;
//   2. the placeholder job is DEACTIVATED, not deleted (the original semantics);
//   3. doing it the unprivileged way still works when the table write is
//      permitted (a fresh/local database), so both paths are covered;
//   4. a second run is a no-op (the deploy may retry).
//
// Run: node tests/database/cron_placeholder_sweep.test.js
// (requires `embedded-postgres` + `pg`, both devDependencies)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const EP = EPkg.default ?? EPkg;
const requireFromHere = createRequire(import.meta.url);

function extensionDir() {
  const roots = [];
  try {
    const entry = requireFromHere.resolve('embedded-postgres');
    const marker = `${path.sep}embedded-postgres${path.sep}`;
    const at = entry.lastIndexOf(marker);
    const pkgRoot = at === -1 ? path.dirname(entry) : entry.slice(0, at + marker.length - 1);
    roots.push(
      path.join(pkgRoot, 'node_modules/@embedded-postgres/linux-x64/native'),
      path.join(pkgRoot, '../@embedded-postgres/linux-x64/native'),
    );
  } catch {
    /* fall through to the well-known locations */
  }
  roots.push(
    '/home/user/Ledgr-react/node_modules/@embedded-postgres/linux-x64/native',
    '/tmp/node_modules/@embedded-postgres/linux-x64/native',
  );
  const native = roots.find((dir) => fs.existsSync(path.join(dir, 'bin/postgres')));
  assert(native, `could not find the bundled Postgres (looked in ${roots.join(', ')})`);
  return path.join(native, 'share/postgresql/extension');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR =
  process.env.LEDGR_MIGRATIONS_DIR ?? path.resolve(__dirname, '../../supabase/migrations');
const MIGRATION = '20261017000000_subscription_expiry_enforcement.sql';
const PORT = 54361;
const DATA_DIR = '/tmp/pgtest-cron-sweep/data';

let pass = 0;
let failures = 0;
const ok = (label) => {
  pass += 1;
  console.log('  PASS', label);
};
const fail = (label, err) => {
  failures += 1;
  console.log('  FAIL', label, '::', (err && (err.message || err)) || '');
};
const check = async (label, fn) => {
  try {
    await fn();
    ok(label);
  } catch (err) {
    fail(label, err);
  }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function migrationFiles() {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * The guard under test, taken verbatim from the migration file between its
 * section markers — so the test fails loudly if a future edit reintroduces a
 * privileged write or drops the fallback.
 */
function section(marker, nextMarker) {
  const sql = fs.readFileSync(path.join(MIG_DIR, MIGRATION), 'utf8');
  const start = sql.indexOf(`-- ── ${marker}.`);
  assert(start !== -1, `section ${marker} not found in ${MIGRATION}`);
  const end = nextMarker ? sql.indexOf(`-- ── ${nextMarker}.`) : sql.length;
  assert(nextMarker ? end !== -1 : true, `section ${nextMarker} not found in ${MIGRATION}`);
  return sql.slice(start, end);
}

/**
 * pg_cron stub with the real contract that matters here:
 *   * cron.job is owned by an extension-owner role, not by the role running
 *     migrations (production: supabase_admin);
 *   * cron.schedule / cron.unschedule / cron.alter_job are SECURITY DEFINER and
 *     owned by that role, so they keep working without table privileges.
 */
function writeExtensionStubs() {
  const EXT = extensionDir();
  assert(fs.existsSync(EXT), `Postgres extension dir not found (looked in ${EXT})`);
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(
    path.join(EXT, 'pg_cron--1.0.sql'),
    `create schema if not exists cron;
create sequence if not exists cron.jobid_seq;
create table if not exists cron.job (
  jobid bigint primary key default nextval('cron.jobid_seq'),
  jobname text,
  schedule text,
  command text,
  active boolean default true
);
create unique index if not exists cron_job_jobname_uidx on cron.job (jobname) where jobname is not null;

create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text) returns bigint
language plpgsql security definer as $$
declare v bigint;
begin
  select jobid into v from cron.job where jobname = p_jobname;
  if v is null then
    insert into cron.job (jobname, schedule, command, active)
    values (p_jobname, p_schedule, p_command, true) returning jobid into v;
  else
    update cron.job set schedule = p_schedule, command = p_command, active = true where jobid = v;
  end if;
  return v;
end $$;

create or replace function cron.unschedule(p_jobname text) returns boolean
language plpgsql security definer as $$
begin
  delete from cron.job where jobname = p_jobname;
  return true;
end $$;

create or replace function cron.unschedule(p_jobid bigint) returns boolean
language plpgsql security definer as $$
begin
  delete from cron.job where jobid = p_jobid;
  return true;
end $$;

-- Mirrors pg_cron 1.5+: NULL means "leave this field unchanged".
create or replace function cron.alter_job(
  p_job_id bigint,
  p_schedule text default null,
  p_command text default null,
  p_database text default null,
  p_username text default null,
  p_active boolean default null
) returns bigint
language plpgsql security definer as $$
declare v bigint;
begin
  update cron.job
     set schedule = coalesce(p_schedule, schedule),
         command  = coalesce(p_command, command),
         active   = coalesce(p_active, active)
   where jobid = p_job_id
   returning jobid into v;
  if v is null then
    raise exception 'could not find valid entry for job %', p_job_id using errcode = '42704';
  end if;
  return v;
end $$;
`,
  );
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(
    path.join(EXT, 'pg_net--1.0.sql'),
    `create schema if not exists net;
create type net.http_response as (status integer, message text, body text);
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;
`,
  );
}

const PLACEHOLDER_COMMAND =
  "select net.http_post(url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-renewal-reminders', headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'), body := '{}'::jsonb);";

async function main() {
  const files = migrationFiles();
  assert(files.includes(MIGRATION), `${MIGRATION} is not in supabase/migrations/`);

  const section3 = section(3, 4);
  const section5 = section(5, null);
  assert(
    section3.includes('cron.alter_job'),
    'section 3 no longer has the cron.alter_job fallback for roles without cron.job UPDATE',
  );

  writeExtensionStubs();

  const pg = new EP({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await pg.initialise();
  await pg.start();
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  try {
    // ── Supabase-flavoured bootstrap (same shape as the other harnesses) ────
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
    await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);
    await c.query(`set search_path = "$user", public, extensions`);

    // ── Replay everything ───────────────────────────────────────────────────
    for (const f of files) {
      try {
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
      } catch (err) {
        throw new Error(`replay ${f}: ${err.message.split('\n')[0]}`);
      }
    }
    ok(`replay all ${files.length} migrations`);

    // ── Production's privilege shape ────────────────────────────────────────
    // pg_cron's schema is owned by an extension-owner role; the migration role
    // gets SELECT on cron.job and nothing else. (The superuser session bypasses
    // ACLs, so the assertions below run as the unprivileged role.)
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cron_owner') THEN CREATE ROLE cron_owner NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='db_push_role') THEN CREATE ROLE db_push_role NOLOGIN; END IF;
    END $$;`);
    await c.query(`
      alter schema cron owner to cron_owner;
      alter table cron.job owner to cron_owner;
      alter sequence cron.jobid_seq owner to cron_owner;
      alter function cron.schedule(text, text, text) owner to cron_owner;
      alter function cron.unschedule(text) owner to cron_owner;
      alter function cron.unschedule(bigint) owner to cron_owner;
      alter function cron.alter_job(bigint, text, text, text, text, boolean) owner to cron_owner;
      grant usage on schema cron to db_push_role;
      grant select on cron.job to db_push_role;
      grant execute on all functions in schema cron to db_push_role;`);

    const jobExists = async (name) =>
      (await c.query(`select count(*)::int as n from cron.job where jobname = $1`, [name])).rows[0].n;
    const jobActive = async (name) =>
      (await c.query(`select active from cron.job where jobname = $1`, [name])).rows[0]?.active;

    // ── 1. A placeholder job, exactly as the schedule migrations leave it ────
    await c.query(`select cron.schedule('send-renewal-reminders-daily', '0 8 * * *', $1)`, [
      PLACEHOLDER_COMMAND,
    ]);
    assert((await jobActive('send-renewal-reminders-daily')) === true, 'placeholder job should start active');

    // ── 2. Section 3 as the unprivileged push role ──────────────────────────
    await check('the scenario is genuinely unprivileged (UPDATE is refused)', async () => {
      await c.query('set role db_push_role');
      let code = null;
      try {
        await c.query(`update cron.job set active = false`);
      } catch (err) {
        code = err.code;
      } finally {
        await c.query('reset role');
      }
      assert(
        code === '42501',
        `expected db_push_role to be refused with 42501 (got ${code}) — the fallback assertions below would be vacuous`,
      );
    });

    await check('section 3 completes without cron.job UPDATE privilege', async () => {
      await c.query('set role db_push_role');
      try {
        await c.query(section3);
      } finally {
        await c.query('reset role');
      }
    });

    await check('the placeholder job is deactivated, not deleted', async () => {
      assert(
        (await jobExists('send-renewal-reminders-daily')) === 1,
        'the job row was removed — deactivation must keep it visible in cron.job',
      );
      assert(
        (await jobActive('send-renewal-reminders-daily')) === false,
        'the job is still active — the fallback did not deactivate it',
      );
    });

    await check('section 3 is a no-op on a second run', async () => {
      await c.query('set role db_push_role');
      try {
        await c.query(section3);
      } finally {
        await c.query('reset role');
      }
      assert((await jobActive('send-renewal-reminders-daily')) === false, 'job became active again');
    });

    // ── 3. The privileged path still works (fresh/local databases) ──────────
    await check('with UPDATE permitted, section 3 deactivates the job directly', async () => {
      await c.query(`select cron.schedule('retry-failed-webhooks-daily', '0 6 * * *', $1)`, [
        PLACEHOLDER_COMMAND,
      ]);
      assert((await jobActive('retry-failed-webhooks-daily')) === true, 'job should start active');
      await c.query('set role cron_owner'); // owner: UPDATE allowed
      try {
        await c.query(section3);
      } finally {
        await c.query('reset role');
      }
      assert(
        (await jobActive('retry-failed-webhooks-daily')) === false,
        'the owner path did not deactivate the job',
      );
      assert(
        (await jobExists('retry-failed-webhooks-daily')) === 1,
        'the owner path deleted the job instead of deactivating it',
      );
    });

    // ── 4. Section 5 (the in-database sweep) is privilege-safe too ──────────
    await check('section 5 re-schedules the expiry sweep as the unprivileged role', async () => {
      await c.query('set role db_push_role');
      try {
        await c.query(section5);
      } finally {
        await c.query('reset role');
      }
      const row = (
        await c.query(
          `select active, command from cron.job where jobname = 'expire-subscriptions-daily'`,
        )
      ).rows[0];
      assert(row, 'expire-subscriptions-daily was not scheduled');
      assert(row.active === true, 'the expiry sweep was scheduled inactive');
      assert(
        !row.command.includes('<PROJECT_REF>') && !row.command.includes('<CRON_SECRET>'),
        'the expiry sweep still carries a deploy-time placeholder',
      );
      assert(
        row.command.includes('update public.businesses'),
        'the expiry sweep does not run the in-database update',
      );
    });
  } catch (err) {
    fail('harness', err);
  } finally {
    try {
      await c.end();
    } catch {
      /* already closed */
    }
    try {
      await pg.stop();
    } catch {
      /* already stopped */
    }
  }

  console.log(`\n${pass} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
