// Pre-deploy verification for the convergent construction project migrations
// (20261028000000 Phase A, 20261030000000 BOQ, 20261031000001 valuations).
//
// WHY THIS EXISTS
// ---------------
// On 2026-10-18 the production deploy (Deploy #224, run 39118959766) failed on
// the FIRST statement of Phase A and then failed twice more, identically:
//
//   ERROR: relation "projects" already exists (SQLSTATE 42P07)
//
// Production's supabase_migrations.schema_migrations did not record version
// 20261028000000 — `db push` listed the file as pending — yet public.projects
// existed there. The objects had reached that database outside `supabase db
// push`: a hand application (the Supabase SQL editor, or psql) commits every
// statement it manages to run and records no migration version, so the schema
// moved while the history did not. Retrying cannot fix that, which is what the
// three attempts in the log proved.
//
// The migrations were therefore rewritten to CONVERGE: guarded DDL (IF NOT
// EXISTS, DROP ... IF EXISTS, CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS) plus
// additive re-assertion of the declared NOT NULL / DEFAULT / CHECK contracts,
// behind a guard that refuses a public.projects which is not this migration's
// table.
//
// This harness reproduces all three database states that matter and asserts:
//
//   1. HAND-APPLIED (the production case): every object already exists and the
//      version is not recorded, so `db push` re-applies the file. It must
//      succeed and must not change anything — the resulting schema has to be
//      entry-for-entry identical to a clean replay.
//   2. PARTIAL: a hand application that stopped after the CREATE TABLEs — no
//      RLS, no policies, no RPCs, no triggers, no project_id dimensions. The
//      guarded file must finish the job and land on the same schema.
//   3. LEGACY: a DIFFERENT table owns the name `projects` (id integer, a
//      `client` column, live rows). The migration must refuse it with an
//      actionable message and change nothing — silently adopting a foreign
//      table is how a deploy turns into a 3 a.m. incident, and dropping it is
//      not a deploy's decision to make.
//
// Run: node tests/database/construction_projects_convergence.test.js
// (requires `embedded-postgres` + `pg`, both devDependencies)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EP = EPkg.default ?? EPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MIG_DIR = process.env.LEDGR_MIGRATIONS_DIR ?? path.join(ROOT, 'supabase/migrations');
const BOOTSTRAP = path.join(ROOT, 'tests/release/bootstrap.sql');

const SERVER = { port: Number(process.env.LEDGR_CONVERGENCE_PORT ?? 54461), dir: '/tmp/pgtest-construction-convergence/data' };
const DATABASES = {
  clean: 'convergence_clean',
  handApplied: 'convergence_hand_applied',
  partial: 'convergence_partial',
  legacy: 'convergence_legacy',
};

const PHASE_A = '20261028000000_construction_projects.sql';
/** The migrations the 2026-10-18 production push listed as pending. */
const FIRST_PENDING = '20261028000000';

/** Where the hand application in scenario 2 stopped: tables and their indexes,
 *  nothing else (no RLS, no policies, no RPCs, no triggers, no dimensions). */
const PARTIAL_CUT = 'ALTER TABLE public.projects ALTER COLUMN id SET DEFAULT gen_random_uuid();';

/** A table that owns the name but is not ours — the shape a legacy application
 *  would leave behind. `id integer` alone makes every FK in Phase A unusable. */
const LEGACY_PROJECTS = `
  create table public.projects (
    id serial primary key,
    name text not null,
    client text,
    value numeric,
    created_at timestamptz default now()
  );
  insert into public.projects(name, client, value)
  values ('Legacy site one', 'Old client', 1500), ('Legacy site two', null, null);
`;

const DOMAIN_TABLES = [
  'projects',
  'project_status_log',
  'project_boq_lines',
  'project_valuations',
  'project_valuation_lines',
  'project_retention_ledger',
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

function migrationFiles() {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** `supabase db push` has no pg_cron/pg_net installed by this harness, and the
 *  platform extensions are not what is under test (same substitution as
 *  tests/release/database.mjs). */
function readable(file) {
  return fs
    .readFileSync(path.join(MIG_DIR, file), 'utf8')
    .replace(/create extension if not exists (pg_cron|pg_net)\s*;/gi, '-- platform stub');
}

async function apply(c, file) {
  await c.query(readable(file));
}

async function replay(c, files) {
  for (const file of files) {
    try {
      await apply(c, file);
    } catch (err) {
      throw new Error(`${file}: SQLSTATE ${err.code ?? 'unknown'} — ${err.message.split('\n')[0]}`);
    }
  }
}

/** Everything the construction project domain leaves in the catalog. Compared
 *  entry-for-entry between a clean replay and each converged database. */
async function shape(c) {
  const out = [];
  const q = async (prefix, sql, values, render) => {
    const { rows } = await c.query(sql, values);
    rows.forEach((r) => out.push(`${prefix} ${render(r)}`));
  };
  await q('col', `select table_name, column_name, data_type, is_nullable,
                        coalesce(column_default, '') as d
                   from information_schema.columns
                  where table_schema = 'public' and table_name = any($1)
                  order by 1, 2`, [DOMAIN_TABLES],
    (r) => `${r.table_name}.${r.column_name} ${r.data_type} ${r.is_nullable} ${r.d}`);
  await q('dim', `select table_name from information_schema.columns
                  where table_schema = 'public' and column_name = 'project_id'
                  order by 1`, [], (r) => `${r.table_name}.project_id`);
  await q('idx', `select indexname, indexdef from pg_indexes
                  where schemaname = 'public' and tablename = any($1) order by 1`, [DOMAIN_TABLES],
    (r) => `${r.indexname} ${r.indexdef}`);
  await q('con', `select c.conrelid::regclass::text as t, c.conname, c.contype,
                        pg_get_constraintdef(c.oid) as d
                   from pg_constraint c
                  where c.connamespace = 'public'::regnamespace
                    and (c.conrelid::regclass::text = any($1) or c.confrelid::regclass::text = any($1))
                  order by 1, 2`, [DOMAIN_TABLES], (r) => `${r.t} ${r.conname} ${r.contype} ${r.d}`);
  await q('pol', `select polrelid::regclass::text as t, polname, polcmd,
                        polroles::regrole[]::text as roles,
                        pg_get_expr(polqual, polrelid) as using_expr,
                        pg_get_expr(polwithcheck, polrelid) as check_expr
                   from pg_policy where polrelid::regclass::text = any($1) order by 1, 2`,
    [DOMAIN_TABLES],
    (r) => `${r.t} ${r.polname} ${r.polcmd} ${r.roles} ${r.using_expr} ${r.check_expr}`);
  await q('rls', `select relname, relrowsecurity from pg_class
                  where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
    [DOMAIN_TABLES], (r) => `${r.relname} ${r.relrowsecurity}`);
  await q('trg', `select tgrelid::regclass::text as t, pg_get_triggerdef(oid) as d
                   from pg_trigger where not tgisinternal and tgname like 'project%' order by 1, 2`,
    [], (r) => `${r.t} ${r.d}`);
  await q('fn', `select p.proname, pg_get_function_identity_arguments(p.oid) as args,
                        pg_get_function_result(p.oid) as result, p.prosecdef, p.provolatile,
                        coalesce(array_to_string(p.proconfig, ','), '') as config,
                        md5(coalesce(p.prosrc, '')) as body
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and (p.proname like '%project%' or p.proname like '%valuation%'
                         or p.proname like '%boq%' or p.proname like '%retention%')
                  order by 1, 2`, [],
    (r) => `${r.proname}(${r.args}) -> ${r.result} definer=${r.prosecdef} vol=${r.provolatile} cfg=${r.config} body=${r.body}`);
  await q('grant', `select table_name, grantee, privilege_type
                   from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = any($1)
                    and grantee in ('anon', 'authenticated', 'service_role')
                  order by 1, 2, 3`, [DOMAIN_TABLES],
    (r) => `${r.table_name} ${r.grantee} ${r.privilege_type}`);
  await q('exec', `select p.proname, r.rolname, p.proacl::text
                   from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   join pg_roles r on r.oid = any((select (aclexplode(p.proacl)).grantee))
                  where n.nspname = 'public' and p.proname like '%project%'
                  order by 1, 2`, [], (r) => `${r.proname} ${r.rolname}`);
  return out.sort();
}

function diffShapes(label, reference, actual) {
  const onlyReference = reference.filter((row) => !actual.includes(row));
  const onlyActual = actual.filter((row) => !reference.includes(row));
  assert(
    onlyReference.length === 0 && onlyActual.length === 0,
    `${label}: schema differs from a clean replay\n`
      + `    only in clean replay: ${onlyReference.slice(0, 12).join('\n    ') || '(none)'}\n`
      + `    only in ${label}: ${onlyActual.slice(0, 12).join('\n    ') || '(none)'}`,
  );
}

async function columns(c, table) {
  const { rows } = await c.query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
  return rows;
}

async function main() {
  const files = migrationFiles();
  assert(files.includes(PHASE_A), `${PHASE_A} is not in ${MIG_DIR}`);
  const pending = files.filter((f) => f >= FIRST_PENDING);
  const before = files.filter((f) => f < FIRST_PENDING);
  assert(pending.length >= 4, `expected the pending construction migrations, found ${pending.length}`);

  console.log(`\n${files.length} migrations in ${MIG_DIR}`);
  console.log(`- clean:        replay of every migration (the reference schema)`);
  console.log(`- hand-applied: every migration, then the ${pending.length} pending files again — objects live, version unrecorded`);
  console.log(`- partial:      everything before Phase A, then only its CREATE TABLE/INDEX head, then the pending files`);
  console.log(`- legacy:       a foreign public.projects owns the name before Phase A arrives\n`);

  fs.rmSync(path.dirname(SERVER.dir), { recursive: true, force: true });
  const server = new EP({
    databaseDir: SERVER.dir,
    user: 'postgres',
    password: 'postgres',
    port: SERVER.port,
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1', '-c', 'statement_timeout=60000'],
    onLog() {},
    onError() {},
  });
  await server.initialise();
  await server.start();

  const connect = async (database = 'postgres') => {
    const c = new Client({
      host: '127.0.0.1', port: SERVER.port, user: 'postgres', password: 'postgres', database,
    });
    await c.connect();
    await c.query('set search_path = public, extensions');
    return c;
  };
  const clients = [];

  try {
    // Bootstrap once (it creates cluster-wide roles), then clone it per scenario.
    const template = await connect();
    await template.query(fs.readFileSync(BOOTSTRAP, 'utf8'));
    await template.end();
    const admin = await connect();
    for (const database of Object.values(DATABASES)) {
      await admin.query(`create database ${database} template postgres`);
    }
    await admin.end();

    const dbs = {};
    for (const [key, database] of Object.entries(DATABASES)) {
      dbs[key] = await connect(database);
      clients.push(dbs[key]);
    }

    // ── 1. Reference: a clean replay still works after the rewrite ──────────
    await check(`clean replay of all ${files.length} migrations`, async () => {
      await replay(dbs.clean, files);
    });
    const reference = await shape(dbs.clean);
    await check('the clean replay built the construction domain', async () => {
      assert(reference.length > 100, `only ${reference.length} catalog entries — replay looks truncated`);
      assert(reference.some((row) => row.startsWith('col projects.business_id uuid')), 'projects.business_id is missing');
    });

    // ── 2. Production's state: objects live, version unrecorded ─────────────
    await check('hand-applied objects survive a re-apply of the pending migrations', async () => {
      await replay(dbs.handApplied, files);
      await replay(dbs.handApplied, pending);
    });
    await check('re-applying the pending migrations twice more is still a no-op', async () => {
      await replay(dbs.handApplied, pending);
      await replay(dbs.handApplied, pending);
    });
    await check('hand-applied + re-apply is identical to a clean replay', async () => {
      diffShapes('hand-applied', reference, await shape(dbs.handApplied));
    });

    // ── 3. A hand application that stopped halfway ──────────────────────────
    const phaseA = readable(PHASE_A);
    const cut = phaseA.indexOf(PARTIAL_CUT);
    await check('the partial state is reproducible from the migration text', async () => {
      assert(cut > 1000, `could not find the partial-apply cut marker (${PARTIAL_CUT}) in ${PHASE_A}`);
      await replay(dbs.partial, before);
      await dbs.partial.query(phaseA.slice(0, cut));
      const tables = await dbs.partial.query(
        `select relname, relrowsecurity from pg_class
          where relnamespace = 'public'::regnamespace and relname in ('projects','project_status_log')
          order by 1`,
      );
      assert(tables.rows.length === 2, `expected both Phase A tables, found ${tables.rows.length}`);
      assert(
        tables.rows.every((r) => r.relrowsecurity === false),
        'the partial state must not have RLS yet, or it proves nothing',
      );
      const rpc = await dbs.partial.query(`select to_regprocedure('public.create_project(uuid,text,text,numeric,numeric,numeric,date,date)') as f`);
      assert(rpc.rows[0].f === null, 'the partial state must not have the RPCs yet');
      const dimension = await dbs.partial.query(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and column_name = 'project_id'
            and table_name in ('construction_purchase_orders','construction_material_issues',
                               'construction_material_returns','inventory_locations')`,
      );
      assert(dimension.rows[0].n === 0, 'the partial state must not have the project_id dimensions yet');
    });
    await check('the pending migrations converge on the partial state', async () => {
      await replay(dbs.partial, pending);
    });
    await check('the converged partial database is identical to a clean replay', async () => {
      diffShapes('partial', reference, await shape(dbs.partial));
    });
    await check('convergence finished what the partial apply left out', async () => {
      const security = await dbs.partial.query(
        `select relname, relrowsecurity from pg_class
          where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`,
        [DOMAIN_TABLES],
      );
      assert(
        security.rows.length === DOMAIN_TABLES.length
          && security.rows.every((r) => r.relrowsecurity === true),
        `RLS is not enabled on every domain table: ${JSON.stringify(security.rows)}`,
      );
      const writes = await dbs.partial.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = any($1) and grantee = 'authenticated'
            and privilege_type in ('INSERT','UPDATE','DELETE') order by 1`,
        [DOMAIN_TABLES],
      );
      assert(writes.rows.length === 0, `the command boundary was widened: ${JSON.stringify(writes.rows)}`);
      const checks = await dbs.partial.query(
        `select count(*)::int as n from pg_constraint
          where conrelid = 'public.projects'::regclass and contype = 'c'`,
      );
      assert(checks.rows[0].n === 6, `expected the 6 declared CHECK constraints on projects, found ${checks.rows[0].n}`);
    });

    // ── 4. A foreign table owns the name ────────────────────────────────────
    let refusal = null;
    await check('Phase A refuses a foreign public.projects instead of adopting it', async () => {
      await replay(dbs.legacy, before);
      await dbs.legacy.query(LEGACY_PROJECTS);
      try {
        await dbs.legacy.query(phaseA);
      } catch (err) {
        refusal = err;
      }
      assert(refusal, 'Phase A applied cleanly over a foreign projects table — it would have adopted the wrong shape');
      assert(refusal.code === '42P07', `expected SQLSTATE 42P07, got ${refusal.code}`);
      assert(
        /DIFFERENT table/.test(refusal.message) && /public\.projects\.id is integer/.test(refusal.message),
        `the refusal must name the conflict, got: ${refusal.message.split('\n')[0]}`,
      );
      assert(/owner decision/i.test(refusal.message), 'the refusal must say this is not a deploy retry');
      assert(/ALTER TABLE public\.projects RENAME TO/.test(refusal.message), 'the refusal must show how to move the table aside');
    });
    await check('the refused migration changed nothing', async () => {
      const cols = await columns(dbs.legacy, 'projects');
      assert(
        cols.map((r) => r.column_name).join(',') === 'id,name,client,value,created_at',
        `the legacy table was modified: ${cols.map((r) => r.column_name).join(',')}`,
      );
      const rows = await dbs.legacy.query('select count(*)::int as n from public.projects');
      assert(rows.rows[0].n === 2, `legacy rows were touched: ${rows.rows[0].n}`);
      const sideEffects = await dbs.legacy.query(
        `select (select count(*)::int from information_schema.tables
                  where table_schema = 'public' and table_name = 'project_status_log') as log_table,
                (select count(*)::int from information_schema.columns
                  where table_schema = 'public' and column_name = 'project_id'
                    and table_name in ('construction_purchase_orders','construction_material_issues',
                                       'construction_material_returns','inventory_locations')) as dimensions,
                (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_project') as rpcs`,
        // count(*) is bigint, which node-pg hands back as a string: cast it.
      );
      const s = sideEffects.rows[0];
      assert(
        s.log_table === 0 && s.dimensions === 0 && s.rpcs === 0,
        `the guard fired too late — the migration already created objects: ${JSON.stringify(s)}`,
      );
    });
    await check('a foreign table missing only the audit log is refused too', async () => {
      // The guard covers both Phase A tables: adopting a foreign
      // project_status_log would be the same class of mistake.
      await dbs.legacy.query('drop table public.projects');
      await dbs.legacy.query(
        `create table public.project_status_log (id serial primary key, note text, at timestamptz default now())`,
      );
      let err = null;
      try {
        await dbs.legacy.query(phaseA);
      } catch (e) {
        err = e;
      }
      assert(err, 'Phase A applied over a foreign project_status_log');
      assert(/project_status_log/.test(err.message), `the message must name the table, got: ${err.message.split('\n')[0]}`);
    });
  } catch (err) {
    fail('harness', err);
  } finally {
    for (const c of clients) {
      try {
        await c.end();
      } catch { /* already closed */ }
    }
    try {
      await server.stop();
    } catch { /* already stopped */ }
    fs.rmSync(path.dirname(SERVER.dir), { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
