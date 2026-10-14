// End-to-end verification of the deploy's pg_cron step:
// scripts/ci/apply-cron-jobs.sh + scripts/cron-jobs.sql.
//
// WHY THIS EXISTS
// ---------------
// On 2026-10-14 the staging deploy of bac5694 reported
//
//   MIXED-VERSION — FRONTEND NOT UPDATED
//   migrate / verifyMigrationTarget / edgeFunctions: success, frontend: skipped
//
// because the un-instrumented "Reschedule pg_cron jobs" step between the edge
// functions and the frontend failed with
//
//   Cron jobs on staging still contain unsubstituted placeholders:
//   [{"jobname":"retry-failed-webhooks-daily","schedule":"0 6 * * *","active":false}]
//
// It had failed the same way on every staging deploy since 2026-10-09. Two
// defects, both invisible to the existing tests:
//
//   1. retry-failed-webhooks-daily (migration 20260820000000) was never added
//      to scripts/cron-jobs.sql, so the deploy could not substitute its
//      placeholders. 20261017000000 §3 deactivated it, and the verification
//      (correctly) refuses to pass while it exists.
//   2. cron.schedule() upserts on (jobname, username) and NEVER touches
//      `active` (pg_cron src/job_metadata.c, ScheduleCronJob, through 1.6.8).
//      The jobs §3 deactivated — send-renewal-reminders-daily and
//      generate-partner-invoices-monthly included — kept active = false after
//      cron-jobs.sql fixed their URLs: correct command, never fires, and the
//      placeholder check passed. The pg_cron stub in
//      cron_placeholder_sweep.test.js re-activated on reschedule, which is why
//      no test noticed.
//
// This harness replays the whole migration set on embedded Postgres with a
// pg_cron stub that is faithful on exactly those points (owner = calling
// role, upsert keyed on (jobname, username) leaving `active` alone, alter_job
// limited to the caller's own jobs unless superuser). It then runs the REAL
// scripts/ci/apply-cron-jobs.sh against a local stand-in for the Supabase
// Management API query endpoint, executing as a non-superuser role that owns
// the jobs — the hosted situation, where `supabase db push` and the
// Management API both act as `postgres`, which is not a superuser there.
//
// It asserts:
//   A. the pre-fix cron-jobs.sql reproduces the 2026-10-14 failure, and the
//      new active check also catches the jobs left silently inactive;
//   B. without its re-enable statement, cron-jobs.sql leaves every job §3
//      deactivated inactive, and the script fails instead of passing;
//   C. the current cron-jobs.sql leaves no placeholder anywhere, every job it
//      schedules active with the real URL and secret, the in-database expiry
//      sweep untouched and no duplicate jobs — and the script exits 0;
//   D. re-running it (every deploy does) is a no-op;
//   E. a missing CRON_SECRET fails before anything is sent.
//
// Run: node tests/database/cron_jobs_apply.test.js
// (requires `embedded-postgres` + `pg` (devDependencies) and bash, curl,
// python3 on PATH — the same tools the deploy runner uses)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const EP = EPkg.default ?? EPkg;
const requireFromHere = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MIG_DIR = process.env.LEDGR_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const APPLY_SCRIPT = path.join(ROOT, 'scripts/ci/apply-cron-jobs.sh');
const CRON_SQL = path.join(ROOT, 'scripts/cron-jobs.sql');
const PORT = 54362;
const DATA_DIR = '/tmp/pgtest-cron-apply/data';

// The role the Management API (and `supabase db push`) acts as. Deliberately
// NOT a superuser, so cron.alter_job's ownership rule is exercised.
const API_ROLE = 'ledgr_mgmt_api';
const PROJECT_REF = 'testprojectref01';
const CRON_SECRET = 'test-cron-secret-0123456789';
const ACCESS_TOKEN = 'test-management-api-token';

const MANAGED_JOBS = [
  'send-renewal-reminders-daily',
  'generate-partner-invoices-monthly',
  'retry-failed-webhooks-daily',
];

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
    path.join(ROOT, 'node_modules/@embedded-postgres/linux-x64/native'),
    '/tmp/node_modules/@embedded-postgres/linux-x64/native',
  );
  const native = roots.find((dir) => fs.existsSync(path.join(dir, 'bin/postgres')));
  assert(native, `could not find the bundled Postgres (looked in ${roots.join(', ')})`);
  return path.join(native, 'share/postgresql/extension');
}

/**
 * pg_cron stub, faithful to pg_cron 1.6 on the points this harness is about:
 *   * the job owner is the CALLING role (GetUserId()), and named jobs are
 *     unique per (jobname, username) — constraint jobname_username_uniq;
 *   * cron.schedule() on an existing (jobname, username) rewrites schedule,
 *     command and database ONLY — `active` is left as it was;
 *   * cron.alter_job() / cron.unschedule() act on the caller's own jobs
 *     unless the caller is a superuser;
 *   * writes happen with the extension owner's rights, so callers need no
 *     privileges on cron.job beyond SELECT.
 * A SECURITY DEFINER plpgsql function cannot see its caller's role, so each
 * public entry point is SECURITY INVOKER and passes current_user to a
 * SECURITY DEFINER worker.
 */
function writeExtensionStubs() {
  const EXT = extensionDir();
  assert(fs.existsSync(EXT), `Postgres extension dir not found (looked in ${EXT})`);
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(
    path.join(EXT, 'pg_cron--1.0.sql'),
    `create schema if not exists cron;
create table if not exists cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active   boolean not null default true,
  jobname  text,
  constraint jobname_username_uniq unique (jobname, username)
);

create or replace function cron._is_superuser(p_role text) returns boolean
language sql stable as $$ select coalesce((select rolsuper from pg_roles where rolname = p_role), false) $$;

create or replace function cron._schedule_as(p_owner text, p_jobname text, p_schedule text, p_command text)
returns bigint language plpgsql security definer set search_path = cron, pg_catalog as $$
declare v bigint;
begin
  insert into cron.job (jobname, schedule, command, username, active)
  values (p_jobname, p_schedule, p_command, p_owner, true)
  on conflict on constraint jobname_username_uniq
  do update set schedule = excluded.schedule,
                command  = excluded.command,
                database = excluded.database   -- pg_cron never touches active here
  returning jobid into v;
  return v;
end $$;

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql security invoker as $$
  select cron._schedule_as(current_user::text, job_name, schedule, command)
$$;

create or replace function cron._unschedule_as(p_owner text, p_jobname text, p_jobid bigint)
returns boolean language plpgsql security definer set search_path = cron, pg_catalog as $$
begin
  if p_jobname is not null then
    -- named unschedule is always scoped to the caller's own job
    delete from cron.job where jobname = p_jobname and username = p_owner;
  else
    delete from cron.job where jobid = p_jobid and (cron._is_superuser(p_owner) or username = p_owner);
  end if;
  if not found then
    raise exception 'could not find valid entry for job ''%''', coalesce(p_jobname, p_jobid::text);
  end if;
  return true;
end $$;

create or replace function cron.unschedule(job_name text) returns boolean
language sql security invoker as $$ select cron._unschedule_as(current_user::text, job_name, null) $$;

create or replace function cron.unschedule(job_id bigint) returns boolean
language sql security invoker as $$ select cron._unschedule_as(current_user::text, null, job_id) $$;

-- NULL means "leave this field unchanged" (pg_cron 1.5+).
create or replace function cron._alter_job_as(p_owner text, p_job_id bigint, p_schedule text, p_command text,
                                              p_database text, p_username text, p_active boolean)
returns void language plpgsql security definer set search_path = cron, pg_catalog as $$
begin
  update cron.job
     set schedule = coalesce(p_schedule, schedule),
         command  = coalesce(p_command, command),
         database = coalesce(p_database, database),
         username = coalesce(p_username, username),
         active   = coalesce(p_active, active)
   where jobid = p_job_id
     and (cron._is_superuser(p_owner) or username = p_owner);
  if not found then
    raise exception 'Job % does not exist or you don''t own it', p_job_id;
  end if;
end $$;

create or replace function cron.alter_job(job_id bigint, schedule text default null, command text default null,
                                          database text default null, username text default null,
                                          active boolean default null)
returns void language sql security invoker as $$
  select cron._alter_job_as(current_user::text, job_id, schedule, command, database, username, active)
$$;
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

// ── cron-jobs.sql variants ───────────────────────────────────────────────────
const RETRY_MARKER = '-- Daily dead-letter retry of undelivered webhook deliveries';
const REENABLE_MARKER = '-- ── Re-enable the jobs scheduled above';

function cronSqlVariant(kind) {
  const sql = fs.readFileSync(CRON_SQL, 'utf8');
  if (kind === 'current') return sql;
  const reenable = sql.indexOf(REENABLE_MARKER);
  assert(reenable !== -1, `"${REENABLE_MARKER}" not found in scripts/cron-jobs.sql — update this harness`);
  if (kind === 'no-reenable') return sql.slice(0, reenable);
  // 'pre-fix': what main shipped until 2026-10-14 — the two original jobs,
  // no retry job, no re-enable statement.
  const retry = sql.indexOf(RETRY_MARKER);
  assert(retry !== -1, `"${RETRY_MARKER}" not found in scripts/cron-jobs.sql — update this harness`);
  assert(retry < reenable, 'the retry job is expected before the re-enable statement');
  return sql.slice(0, retry);
}

/** A throwaway "repo" so the real script reads the chosen cron-jobs.sql. */
function stageScript(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgr-cron-apply-'));
  fs.mkdirSync(path.join(dir, 'scripts/ci'), { recursive: true });
  fs.copyFileSync(APPLY_SCRIPT, path.join(dir, 'scripts/ci/apply-cron-jobs.sh'));
  fs.writeFileSync(path.join(dir, 'scripts/cron-jobs.sql'), cronSqlVariant(kind));
  return dir;
}

function runScript(dir, apiUrl, envOverrides = {}) {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? os.tmpdir(),
      SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN,
      SUPABASE_PROJECT_REF: PROJECT_REF,
      CRON_SECRET,
      SUPABASE_ENV_LABEL: 'harness',
      SUPABASE_MANAGEMENT_API_URL: apiUrl,
      ...envOverrides,
    };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn('bash', [path.join(dir, 'scripts/ci/apply-cron-jobs.sh')], { env });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code, output }));
  });
}

/**
 * Stand-in for POST /v1/projects/{ref}/database/query: runs the SQL as
 * API_ROLE in one implicit transaction and answers with the last statement's
 * rows as a JSON array (201), or {"message"} with 400 on a SQL error.
 */
function startManagementApi(db, requests) {
  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.method !== 'POST' || req.url !== `/v1/projects/${PROJECT_REF}/database/query`) {
      return send(404, { message: `unexpected ${req.method} ${req.url}` });
    }
    if (req.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) return send(401, { message: 'Unauthorized' });
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let query;
    try {
      query = JSON.parse(raw).query;
    } catch {
      return send(400, { message: 'invalid JSON body' });
    }
    requests.push(query);
    try {
      await db.query(`set role ${API_ROLE}`);
      const result = await db.query(query);
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      send(201, last?.rows ?? []);
    } catch (err) {
      send(400, { message: err.message });
    } finally {
      await db.query('reset role').catch(() => {});
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  writeExtensionStubs();

  const pg = new EP({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await pg.initialise();
  await pg.start();
  const connect = async () => {
    const client = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
    await client.connect();
    return client;
  };
  const c = await connect();
  const api = await connect();
  let server = null;
  const staged = [];

  try {
    // ── Supabase-flavoured bootstrap (same shape as the other harnesses) ──────
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

    // ── Replay everything ─────────────────────────────────────────────────────
    for (const f of files) {
      try {
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
      } catch (err) {
        throw new Error(`replay ${f}: ${err.message.split('\n')[0]}`);
      }
    }
    ok(`replay all ${files.length} migrations`);

    // ── The hosted ownership shape ────────────────────────────────────────────
    // One non-superuser role both ran the migrations (owns their jobs) and
    // answers Management API queries. It can read cron.job but not write it.
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${API_ROLE}') THEN CREATE ROLE ${API_ROLE} NOLOGIN NOSUPERUSER; END IF;
    END $$;
      grant usage on schema cron, net to ${API_ROLE};
      grant select on cron.job to ${API_ROLE};
      grant execute on all functions in schema cron, net to ${API_ROLE};
      update cron.job set username = '${API_ROLE}';
      create table public._cron_job_after_replay as select * from cron.job;`);

    const jobs = async () =>
      (await c.query(`select jobname, active, command, username from cron.job order by jobname, jobid`)).rows;
    const resetToReplay = () =>
      c.query(`truncate cron.job; insert into cron.job select * from public._cron_job_after_replay;`);

    await check('after the replay, 20261017000000 §3 has deactivated every placeholder job (staging, 2026-10-09)', async () => {
      const rows = await jobs();
      for (const name of MANAGED_JOBS) {
        const row = rows.find((r) => r.jobname === name);
        assert(row, `${name} was not scheduled by the migrations`);
        assert(row.command.includes('<PROJECT_REF>'), `${name} should still hold the migration placeholder`);
        assert(row.active === false, `${name} should have been deactivated by §3`);
      }
      const sweep = rows.find((r) => r.jobname === 'expire-subscriptions-daily');
      assert(sweep?.active === true && !sweep.command.includes('net.http_post'), 'the SQL expiry sweep should be active');
    });

    await check(`the harness's pg_cron stub keeps the real upsert semantics (cron.schedule leaves active alone)`, async () => {
      await c.query(`set role ${API_ROLE}`);
      try {
        await c.query(`select cron.schedule('send-renewal-reminders-daily', '0 8 * * *', 'select 1')`);
      } finally {
        await c.query('reset role');
      }
      const row = (await jobs()).find((r) => r.jobname === 'send-renewal-reminders-daily');
      assert(row.command === 'select 1', 'cron.schedule did not update the existing job in place');
      assert(row.active === false, 'cron.schedule re-activated the job — the stub no longer matches pg_cron');
      assert((await jobs()).length === 4, 'cron.schedule created a duplicate instead of upserting');
      await resetToReplay();
    });

    const requests = [];
    server = await startManagementApi(api, requests);
    const apiUrl = `http://127.0.0.1:${server.address().port}`;

    // ── A. The 2026-10-14 failure, reproduced ─────────────────────────────────
    await check('A. pre-fix cron-jobs.sql: the deploy step fails on retry-failed-webhooks-daily (the incident)', async () => {
      await resetToReplay();
      const dir = stageScript('pre-fix');
      staged.push(dir);
      const { code, output } = await runScript(dir, apiUrl);
      assert(code === 1, `expected exit 1, got ${code}\n${output}`);
      assert(
        /still contain unsubstituted placeholders/.test(output) && output.includes('"jobname":"retry-failed-webhooks-daily"'),
        `the placeholder failure for retry-failed-webhooks-daily was not reported:\n${output}`,
      );
    });

    await check('A. ...and the new active check exposes the jobs it left silently inactive', async () => {
      // Same run as above: the two jobs pre-fix cron-jobs.sql DID reschedule
      // have the real URL now, but are still inactive.
      const rows = await jobs();
      for (const name of ['send-renewal-reminders-daily', 'generate-partner-invoices-monthly']) {
        const row = rows.find((r) => r.jobname === name);
        assert(row.command.includes(`https://${PROJECT_REF}.supabase.co/`), `${name} was not rescheduled`);
        assert(row.active === false, `${name} unexpectedly active — the scenario no longer reproduces the defect`);
      }
    });

    // ── B. Without the re-enable statement ────────────────────────────────────
    await check('B. without its re-enable statement, cron-jobs.sql leaves every job inactive and the step FAILS', async () => {
      await resetToReplay();
      const dir = stageScript('no-reenable');
      staged.push(dir);
      const { code, output } = await runScript(dir, apiUrl);
      assert(code === 1, `expected exit 1, got ${code}\n${output}`);
      assert(/missing or INACTIVE/.test(output), `the inactive jobs were not reported:\n${output}`);
      for (const name of MANAGED_JOBS) {
        assert(output.includes(`"jobname":"${name}"`), `${name} missing from the inactive report:\n${output}`);
      }
      assert(!/still contain unsubstituted placeholders/.test(output), `unexpected placeholder failure:\n${output}`);
    });

    // ── C. The fix ────────────────────────────────────────────────────────────
    let fixOutput = '';
    await check('C. current cron-jobs.sql: the deploy step succeeds and verifies both checks', async () => {
      await resetToReplay();
      requests.length = 0;
      const dir = stageScript('current');
      staged.push(dir);
      const { code, output } = await runScript(dir, apiUrl);
      fixOutput = output;
      assert(code === 0, `expected exit 0, got ${code}\n${output}`);
      assert(/Verified: no pg_cron job on harness contains an unsubstituted placeholder\./.test(output), output);
      assert(
        output.includes(`Verified: all ${MANAGED_JOBS.length} job(s) scheduled by scripts/cron-jobs.sql are active on harness.`),
        output,
      );
      assert(!/::(error|warning)::/.test(output), `unexpected annotation:\n${output}`);
      assert(requests.length === 3, `expected apply + 2 verification queries, saw ${requests.length}`);
      assert(!requests[0].includes('<PROJECT_REF>') && requests[0].includes(CRON_SECRET), 'apply SQL was not substituted');
    });

    await check('C. no cron job anywhere still holds a placeholder', async () => {
      const left = (await jobs()).filter((r) => /<PROJECT_REF>|<CRON_SECRET>/.test(r.command));
      assert(left.length === 0, `placeholder jobs remain: ${left.map((r) => r.jobname).join(', ')}`);
    });

    await check('C. every job cron-jobs.sql schedules is ACTIVE, with the real URL and secret', async () => {
      const rows = await jobs();
      for (const name of MANAGED_JOBS) {
        const matches = rows.filter((r) => r.jobname === name);
        assert(matches.length === 1, `${name}: expected exactly one job, found ${matches.length}`);
        const [row] = matches;
        assert(row.active === true, `${name} is inactive`);
        assert(row.username === API_ROLE, `${name} changed owner to ${row.username}`);
        const fn = name.replace(/-(daily|monthly)$/, '');
        assert(
          row.command.includes(`https://${PROJECT_REF}.supabase.co/functions/v1/${fn}`),
          `${name} does not call functions/v1/${fn}: ${row.command}`,
        );
        assert(row.command.includes(`'x-cron-secret', '${CRON_SECRET}'`), `${name} does not send the cron secret`);
      }
    });

    await check('C. the in-database expiry sweep is untouched and nothing else was created', async () => {
      const rows = await jobs();
      const sweep = rows.find((r) => r.jobname === 'expire-subscriptions-daily');
      assert(sweep?.active === true, 'expire-subscriptions-daily is missing or inactive');
      assert(!sweep.command.includes('net.http_post') && sweep.command.includes('update public.businesses'),
        'expire-subscriptions-daily was replaced by an HTTP job');
      assert(rows.length === MANAGED_JOBS.length + 1, `expected ${MANAGED_JOBS.length + 1} jobs, found ${rows.length}`);
    });

    await check('C. the CRON_SECRET never appears in the step output', async () => {
      assert(!fixOutput.includes(CRON_SECRET), 'the secret leaked into the log');
    });

    // ── D. Every deploy re-runs it ────────────────────────────────────────────
    await check('D. a second run is a no-op (same jobs, still active, exit 0)', async () => {
      const before = await jobs();
      const { code, output } = await runScript(staged[staged.length - 1], apiUrl);
      assert(code === 0, `expected exit 0, got ${code}\n${output}`);
      const after = await jobs();
      assert(JSON.stringify(after) === JSON.stringify(before), 'the second run changed cron.job');
    });

    // ── E. Fails closed without the secret ────────────────────────────────────
    await check('E. a missing CRON_SECRET fails before any query is sent', async () => {
      requests.length = 0;
      const { code, output } = await runScript(staged[staged.length - 1], apiUrl, { CRON_SECRET: undefined });
      assert(code === 1, `expected exit 1, got ${code}`);
      assert(/CRON_SECRET is not configured for harness/.test(output), output);
      assert(requests.length === 0, `${requests.length} request(s) reached the API`);
    });
  } catch (err) {
    fail('harness', err);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const dir of staged) fs.rmSync(dir, { recursive: true, force: true });
    for (const client of [c, api]) {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
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
