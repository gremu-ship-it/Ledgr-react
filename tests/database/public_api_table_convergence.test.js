// Pre-deploy verification for the legacy public-API table repair
// (20261018000000_repair_legacy_public_api_tables.sql).
//
// WHY THIS EXISTS
// ---------------
// Production is the LEGACY Ledgr project: `api_keys`, `webhooks` and
// `webhook_deliveries` already existed there when 20260727000001 was deployed,
// so its `create table if not exists` statements never applied and production
// kept the older column set. Regenerating types from production on 2026-10-07
// produced five tsc errors — `webhooks.secret` required on insert,
// `webhooks.last_triggered_at` and `webhook_deliveries.attempt` "does not
// exist", `api_keys.created_at` nullable — none of which are visible against
// staging or a clean replay.
//
// This harness reproduces that database state (the legacy tables are created
// after the base migration, exactly as they already existed in production),
// then asserts:
//
//   1. THE ROOT CAUSE: the legacy shapes really do survive the whole migration
//      set — the drift is a property of `create table if not exists`, not of
//      the client code, which is written against the declared schema.
//   2. THE REPAIR: 20261018000000 converges every drifted column, is
//      idempotent, and the result is column-for-column identical to a clean
//      replay of the entire migration set on a second database. A repair that
//      missed a column fails here instead of on the next `gen types` run.
//   3. THE RUNTIME CONTRACTS the types describe: a browser-shaped webhook
//      insert with no secret (the DB generates it), a delivery-log insert with
//      no attempt (defaults to 1), retry-failed-webhooks' `attempt >= 3`
//      filter, and the dispatcher's last_triggered_at update.
//
// Run: node tests/database/public_api_table_convergence.test.js
// (requires `embedded-postgres` + `pg`, both devDependencies)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const EP = EPkg.default ?? EPkg;
const requireFromHere = createRequire(import.meta.url);

/**
 * Extension dir of the Postgres build this process will actually run: the
 * pg_cron/pg_net stubs below have to land in the same server's sharedir, or
 * `create extension` fails with "extension is not available".
 */
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
const BASE_MIGRATION = '20250101000000_base_schema.sql';
const REPAIR_MIGRATION = '20261018000000_repair_legacy_public_api_tables.sql';

const LEGACY = { label: 'legacy-prod', port: 54341, dir: '/tmp/pgtest-publicapi-legacy/data' };
const FRESH = { label: 'fresh', port: 54342, dir: '/tmp/pgtest-publicapi-fresh/data' };

const TABLES = ['api_keys', 'webhooks', 'webhook_deliveries'];

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

/**
 * The three tables exactly as production has them, reconstructed from the
 * generated types it produced on 2026-10-07:
 *   api_keys            — `created_at: string | null` (nullable, no default),
 *                         no created_by.
 *   webhooks            — Insert type lists only id, business_id, url, events,
 *                         secret (required => no default), is_active,
 *                         consecutive_failures, created_at; no
 *                         last_triggered_at, created_by or updated_at.
 *   webhook_deliveries  — every selected column exists except `attempt`.
 */
const LEGACY_TABLES = `
  create table if not exists public.api_keys (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    name text not null,
    key_hash text not null unique,
    key_prefix text not null,
    last_used_at timestamptz,
    created_at timestamptz,
    revoked_at timestamptz
  );

  create table if not exists public.webhooks (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    url text not null,
    events text[] not null default '{}',
    secret text not null,
    is_active boolean not null default true,
    consecutive_failures integer not null default 0,
    created_at timestamptz not null default now()
  );

  create table if not exists public.webhook_deliveries (
    id uuid primary key default gen_random_uuid(),
    webhook_id uuid not null references public.webhooks(id) on delete cascade,
    event text not null,
    payload jsonb not null,
    status_code integer,
    response_body text,
    delivered_at timestamptz,
    created_at timestamptz not null default now()
  );
`;

/** Every column the migrations declare for the three tables. */
const EXPECTED = [
  ['api_keys', 'created_at', 'timestamp with time zone', 'NO', true],
  ['api_keys', 'created_by', 'uuid', 'YES', false],
  ['webhooks', 'last_triggered_at', 'timestamp with time zone', 'YES', false],
  ['webhooks', 'created_by', 'uuid', 'YES', false],
  ['webhooks', 'updated_at', 'timestamp with time zone', 'NO', true],
  ['webhooks', 'secret', 'text', 'NO', true],
  ['webhook_deliveries', 'attempt', 'integer', 'NO', true],
];

async function column(c, table, name) {
  const { rows } = await c.query(
    `select data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, name],
  );
  return rows[0] ?? null;
}

/** Column set of the three tables, order-insensitive, as comparable strings. */
async function shape(c) {
  const { rows } = await c.query(
    `select table_name, column_name, data_type, is_nullable,
            coalesce(column_default, '') as column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = any($1)
      order by table_name, column_name`,
    [TABLES],
  );
  return rows.map(
    (r) =>
      `${r.table_name}.${r.column_name} ${r.data_type} ${
        r.is_nullable === 'NO' ? 'not null' : 'nullable'
      } default=${r.column_default}`,
  );
}

function migrationFiles() {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(c, file) {
  await c.query(fs.readFileSync(path.join(MIG_DIR, file), 'utf8'));
}

async function replay(c, files, { skip = [] } = {}) {
  for (const file of files) {
    if (skip.includes(file)) continue;
    try {
      await applyMigration(c, file);
    } catch (err) {
      throw new Error(`replay ${file}: ${err.message.split('\n')[0]}`);
    }
  }
}

async function bootstrap(c) {
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
}

/**
 * pg_cron / pg_net stubs. The cron stub carries `jobname` and `unschedule`
 * because 20261017000000_subscription_expiry_enforcement.sql resolves a job by
 * name (`select jobid, jobname from cron.job` / `cron.unschedule(<name>)`),
 * which real pg_cron supports.
 */
function writeExtensionStubs() {
  const EXT = extensionDir();
  assert(fs.existsSync(EXT), `Postgres extension dir not found (looked in ${EXT})`);
  fs.writeFileSync(
    path.join(EXT, 'pg_cron.control'),
    "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n",
  );
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
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text) returns bigint language plpgsql as $$
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
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text, p_username text) returns bigint language sql as $$ select cron.schedule(p_jobname, p_schedule, p_command) $$;
create or replace function cron.unschedule(p_jobname text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = p_jobname;
  return true;
end $$;
create or replace function cron.unschedule(p_jobid bigint) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid = p_jobid;
  return true;
end $$;
`,
  );
  fs.writeFileSync(
    path.join(EXT, 'pg_net.control'),
    "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n",
  );
  fs.writeFileSync(
    path.join(EXT, 'pg_net--1.0.sql'),
    `create schema if not exists net;
create type net.http_response as (status integer, message text, body text);
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;
`,
  );
}

async function newInstance({ port, dir }) {
  const pg = new EP({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: true });
  fs.rmSync(dir, { recursive: true, force: true });
  await pg.initialise();
  await pg.start();
  const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  return { pg, c };
}

async function close({ pg, c }) {
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

async function main() {
  const files = migrationFiles();
  assert(files.includes(REPAIR_MIGRATION), `${REPAIR_MIGRATION} is not in supabase/migrations/`);
  assert(files.includes(BASE_MIGRATION), `${BASE_MIGRATION} is not in supabase/migrations/`);

  writeExtensionStubs();

  console.log(`\n${files.length} migrations in ${MIG_DIR}`);
  console.log(`- ${LEGACY.label}: legacy-shaped tables + every migration (repair last)`);
  console.log(`- ${FRESH.label}: clean replay of every migration\n`);

  const legacy = await newInstance(LEGACY);
  const fresh = await newInstance(FRESH);

  try {
    await bootstrap(legacy.c);
    await bootstrap(fresh.c);

    // ── 1. Reproduce production: the tables exist before 20260727000001 ─────
    await applyMigration(legacy.c, BASE_MIGRATION);
    await legacy.c.query(LEGACY_TABLES);
    await replay(legacy.c, files, { skip: [BASE_MIGRATION, REPAIR_MIGRATION] });

    await check('legacy webhooks survives 20260727000001 (the drift is real)', async () => {
      assert(
        (await column(legacy.c, 'webhooks', 'last_triggered_at')) === null,
        'last_triggered_at exists — production would not have shown that error',
      );
      const secret = await column(legacy.c, 'webhooks', 'secret');
      assert(secret, 'webhooks.secret is missing');
      assert(secret.column_default === null, `secret gained a default: ${secret.column_default}`);
      assert(
        (await column(legacy.c, 'webhooks', 'updated_at')) === null,
        'updated_at exists (expected the legacy column set)',
      );
    });

    await check('legacy webhook_deliveries survives 20260727000001', async () => {
      assert(
        (await column(legacy.c, 'webhook_deliveries', 'attempt')) === null,
        'attempt exists — production would not have shown that error',
      );
    });

    await check('legacy api_keys survives 20260727000001', async () => {
      const created = await column(legacy.c, 'api_keys', 'created_at');
      assert(created, 'api_keys.created_at is missing');
      assert(created.is_nullable === 'YES', `created_at is ${created.is_nullable}, expected nullable`);
      assert(created.column_default === null, `created_at has a default: ${created.column_default}`);
    });

    // ── 2. Apply the repair (twice: the deploy can retry) ──────────────────
    await check('the repair applies cleanly and is idempotent', async () => {
      await applyMigration(legacy.c, REPAIR_MIGRATION);
      await applyMigration(legacy.c, REPAIR_MIGRATION);
    });

    for (const [table, name, dataType, isNullable, hasDefault] of EXPECTED) {
      await check(`after the repair: ${table}.${name}`, async () => {
        const col = await column(legacy.c, table, name);
        assert(col, `${table}.${name} is still missing`);
        assert(col.data_type === dataType, `type is ${col.data_type}, expected ${dataType}`);
        assert(
          col.is_nullable === isNullable,
          `is_nullable is ${col.is_nullable}, expected ${isNullable}`,
        );
        assert(
          (col.column_default !== null) === hasDefault,
          `default is ${col.column_default}, expected ${hasDefault ? 'one' : 'none'}`,
        );
      });
    }

    // ── 3. The runtime writes the types describe ───────────────────────────
    await legacy.c.query(
      `insert into public.currencies (code, name, symbol, decimal_places, is_primary)
       values ('MWK', 'Malawian Kwacha', 'MK', 2, true) on conflict (code) do nothing`,
    );
    const businessId = (
      await legacy.c.query(
        `insert into public.businesses (name, base_currency, coa_template, financial_year_start,
                                        timezone, vat_registered, invoice_next_number,
                                        expense_next_number, payroll_next_number)
         values ('Public API Drift Co', 'MWK', 'gaap', '07-01', 'Africa/Blantyre', false, 1, 1, 1)
         returning id`,
      )
    ).rows[0].id;

    let webhookId = null;
    await check('registerWebhook shape: insert without a secret generates one', async () => {
      const { rows } = await legacy.c.query(
        `insert into public.webhooks (business_id, url, events, is_active)
         values ($1, 'https://example.com/hooks', array['invoice.created'], true)
         returning id, secret, last_triggered_at, updated_at`,
        [businessId],
      );
      webhookId = rows[0].id;
      assert(/^[0-9a-f]{64}$/.test(rows[0].secret), `secret not generated: ${rows[0].secret}`);
      assert(rows[0].last_triggered_at === null, 'last_triggered_at should start null');
      assert(rows[0].updated_at instanceof Date, 'updated_at should default to now()');
    });

    await check('delivery log shape: insert without attempt defaults to 1', async () => {
      const { rows } = await legacy.c.query(
        `insert into public.webhook_deliveries (webhook_id, event, payload, status_code, delivered_at)
         values ($1, 'invoice.created', '{"id":"x"}'::jsonb, 200, now())
         returning attempt`,
        [webhookId],
      );
      assert(rows[0].attempt === 1, `attempt defaulted to ${rows[0].attempt}, expected 1`);
    });

    await check("retry-failed-webhooks' attempt >= 3 filter reads exhausted deliveries", async () => {
      await legacy.c.query(
        `insert into public.webhook_deliveries (webhook_id, event, payload, attempt)
         values ($1, 'invoice.created', '{"id":"y"}'::jsonb, 3)`,
        [webhookId],
      );
      const { rows } = await legacy.c.query(
        `select count(*)::int as n from public.webhook_deliveries where attempt >= 3`,
      );
      assert(rows[0].n === 1, `expected 1 delivery at attempt >= 3, found ${rows[0].n}`);
    });

    await check("dispatcher's last_triggered_at update succeeds", async () => {
      const { rowCount } = await legacy.c.query(
        `update public.webhooks set last_triggered_at = now() where id = $1`,
        [webhookId],
      );
      assert(rowCount === 1, `expected 1 row updated, got ${rowCount}`);
    });

    // ── 4. Clean replay: the repair must be a no-op and land in the same place
    await check(`clean replay of all ${files.length} migrations (repair included)`, async () => {
      await replay(fresh.c, files);
    });

    await check('legacy + repair is identical to a clean replay', async () => {
      const legacyShape = await shape(legacy.c);
      const freshShape = await shape(fresh.c);
      const onlyLegacy = legacyShape.filter((row) => !freshShape.includes(row));
      const onlyFresh = freshShape.filter((row) => !legacyShape.includes(row));
      assert(
        onlyLegacy.length === 0 && onlyFresh.length === 0,
        `column sets differ:\n    only ${LEGACY.label}: ${onlyLegacy.join(' | ') || '(none)'}\n    only ${FRESH.label}: ${onlyFresh.join(' | ') || '(none)'}`,
      );
    });
  } catch (err) {
    fail('harness', err);
  } finally {
    await close(legacy);
    await close(fresh);
  }

  console.log(`\n${pass} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
