import { afterAll, beforeAll, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite } from './evidence';
import { identities, seedFixture } from './fixtures';

const test = evidenceSuite('construction-project-audit-ownership');
const paths = [
  'supabase/migrations/20261028000000_construction_projects.sql',
  'supabase/migrations/20261028000001_construction_projects_namespace.sql',
];
const migrations = paths.map((path) => readFileSync(path, 'utf8'));
const diagnostics = readFileSync('scripts/database/diagnose-project-status-log.sql', 'utf8');
const sections = diagnostics.split(/^-- @query (\w+)\s*$/m);
const dependencyDiagnosticPath = 'scripts/database/diagnose-project-status-log-dependencies.sql';
const dependencyDiagnostic = readFileSync(dependencyDiagnosticPath, 'utf8');
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;

const meta = (id: string, expected: string) => ({
  id: `CPA.AUDIT.${id}`, expected, source: paths.join(', '),
  remediation: 'CONSTRUCTION-PHASE-A',
  layer: 'Disposable PostgreSQL 17; complete migration files and shared read-only catalog queries',
});

beforeAll(async () => {
  db = await createDatabaseFixture(); // clean replay of the complete chain
  const orgs = await seedFixture(db.client);
  const project = await db.client.query(`
    insert into public.construction_projects(business_id,name,created_by)
    values($1,'Synthetic audit preservation probe',$2) returning id
  `, [orgs.A.business, identities.A_owner.id]);
  await db.client.query(`
    insert into public.project_status_log(project_id,from_status,to_status,changed_by,reason)
    values($1,'tender','active',$2,'Synthetic audit row: preserve unchanged')
  `, [project.rows[0].id, identities.A_owner.id]);
  // The fixture replays product SQL but deliberately has no hosted migration
  // history. Synthetic metadata for exercising the shared SELECTs, not a claim
  // about any remote project's applied versions.
  await db.client.query(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key, name text);
    insert into supabase_migrations.schema_migrations values('20261028000000','synthetic_phase_a');
  `);
});
afterAll(async () => { await db?.cleanup(); });

async function inTransaction(run: () => Promise<void>) {
  await db.client.query('begin');
  try { await run(); } finally { await db.client.query('rollback'); }
}

// Compare catalog state as well as table rows: a refusal may not attach an
// index/policy, revoke someone else's grants, or change a function before exit.
async function snapshot() {
  const state: unknown[] = [];
  for (let i = 1; i < sections.length; i += 2) {
    state.push((await db.client.query(sections[i + 1])).rows);
  }
  state.push((await db.client.query('select * from public.project_status_log order by id')).rows);
  return state;
}

test(meta('EQUIVALENT', 'Equivalent populated audit tables survive complete Phase A and forward replays with rows, OIDs and command boundary intact'), async () => {
  await inTransaction(async () => {
    const before = await db.client.query('select * from public.project_status_log order by id');
    const oid = (await db.client.query("select 'public.project_status_log'::regclass::oid as oid")).rows[0].oid;
    for (const sql of migrations) await db.client.query(sql);
    expect((await db.client.query('select * from public.project_status_log order by id')).rows).toEqual(before.rows);
    expect((await db.client.query("select 'public.project_status_log'::regclass::oid as oid")).rows[0].oid).toBe(oid);
    const boundary = await db.client.query(`
      select relrowsecurity,
             has_table_privilege('authenticated',oid,'SELECT') as can_read,
             has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') as can_write
        from pg_class where oid='public.project_status_log'::regclass
    `);
    expect(boundary.rows).toEqual([{ relrowsecurity: true, can_read: true, can_write: false }]);
  });
});

test(meta('EVOLVED', 'Renamed constraints and an extra nullable column do not reject a genuine audit table'), async () => {
  await inTransaction(async () => {
    await db.client.query(`
      alter table public.project_status_log add column synthetic_extra text;
      alter table public.project_status_log rename constraint project_status_log_pkey to audit_pk_probe;
      alter table public.project_status_log rename constraint project_status_log_project_id_fkey to audit_project_fk_probe;
    `);
    for (const sql of migrations) await db.client.query(sql);
    expect((await db.client.query('select reason from public.project_status_log')).rows).toEqual([
      { reason: 'Synthetic audit row: preserve unchanged' },
    ]);
  });
});

// Two competing lifecycle columns are NOT the supplied, verified alias. Never
// choose one from its name or silently split the existing project/audit graph.
test(meta('LIFECYCLE-AMBIGUOUS', 'Ambiguous lifecycle columns are refused without splitting project/audit data or changing existing dependencies'), async () => {
  await inTransaction(async () => {
    await db.client.query(`
      DROP VIEW public.projects;
      ALTER TABLE public.construction_projects RENAME TO projects;
      ALTER TABLE public.projects RENAME COLUMN status TO lifecycle_state;
      ALTER TABLE public.projects ADD COLUMN status text NOT NULL DEFAULT 'tender';
    `);
    const before = await snapshot();
    const projectRows = (await db.client.query('select * from public.projects order by id')).rows;
    expect(projectRows).toHaveLength(1);
    expect(projectRows[0].lifecycle_state).toBe('tender');
    const projectOid = (await db.client.query("select 'public.projects'::regclass::oid as oid")).rows[0].oid;
    const dependencyReport = (await db.client.query(dependencyDiagnostic)).rows[0].evidence;
    expect(dependencyReport.functions).toContainEqual(expect.objectContaining({
      proname: 'create_project', returns: 'projects',
    }));
    expect(dependencyReport.incoming_foreign_keys).toContainEqual(expect.objectContaining({
      table: 'public.project_status_log', definition: expect.stringContaining('REFERENCES projects(id)'),
    }));
    for (const sql of migrations) {
      await db.client.query('savepoint lifecycle_probe');
      let observed: { code?: string; message?: string } | undefined;
      try { await db.client.query(sql); } catch (error) { observed = error as typeof observed; }
      await db.client.query('rollback to savepoint lifecycle_probe');
      expect(observed?.code).toBe('55000');
      expect(observed?.message).toContain('Construction lifecycle schema mismatch');
      expect(await snapshot()).toEqual(before);
      expect((await db.client.query('select * from public.projects order by id')).rows).toEqual(projectRows);
      expect((await db.client.query("select to_regclass('public.construction_projects') as relation")).rows[0].relation).toBeNull();
      expect((await db.client.query(`
        select confrelid::oid as oid from pg_constraint
        where conrelid = 'public.project_status_log'::regclass
          and contype = 'f' and conname = 'project_status_log_project_id_fkey'
      `)).rows[0].oid).toBe(projectOid);
    }
  });
});

const mismatches = [
  ['FOREIGN', `
    alter table public.project_status_log rename to saved_audit;
    create table public.project_status_log(id integer primary key, legacy_label text);
    insert into public.project_status_log values(1,'preserve legacy row'),(2,'preserve another row');
    grant select,insert on public.project_status_log to authenticated;
  `],
  ['VIEW', `
    alter table public.project_status_log rename to saved_audit;
    create view public.project_status_log as select * from public.saved_audit;
  `],
  ['MISSING-FK', 'alter table public.project_status_log drop constraint project_status_log_project_id_fkey'],
  ['WRONG-TARGET', `
    create table public.synthetic_legacy_projects(id uuid primary key);
    alter table public.project_status_log drop constraint project_status_log_project_id_fkey;
    alter table public.project_status_log add foreign key(project_id) references public.synthetic_legacy_projects(id) not valid;
  `],
  ['WRONG-ACTOR', `
    create table public.synthetic_legacy_users(id uuid primary key);
    alter table public.project_status_log drop constraint project_status_log_changed_by_fkey;
    alter table public.project_status_log add foreign key(changed_by) references public.synthetic_legacy_users(id) not valid;
  `],
  ['WRONG-KEY', `
    alter table auth.users add column synthetic_other_id uuid unique;
    alter table public.project_status_log drop constraint project_status_log_changed_by_fkey;
    alter table public.project_status_log add foreign key(changed_by) references auth.users(synthetic_other_id) not valid;
  `],
  ['WRONG-DELETE', `
    alter table public.project_status_log drop constraint project_status_log_project_id_fkey;
    alter table public.project_status_log add foreign key(project_id) references public.construction_projects(id);
  `],
  ['UNVALIDATED', `
    alter table public.project_status_log drop constraint project_status_log_project_id_fkey;
    alter table public.project_status_log add foreign key(project_id) references public.construction_projects(id) on delete cascade not valid;
  `],
  ['MISSING-DEFAULT', 'alter table public.project_status_log alter column id drop default'],
  ['WRONG-DEFAULT', "alter table public.project_status_log alter column changed_at set default '2000-01-01'::timestamptz"],
  ['NULLABILITY', 'alter table public.project_status_log alter column changed_by drop not null'],
  ['REQUIRED-EXTRA', `
    alter table public.project_status_log add column synthetic_required text not null default 'probe';
    alter table public.project_status_log alter column synthetic_required drop default;
  `],
] as const;
for (const [id, setup] of mismatches) {
  test(meta(id, 'Incompatible live audit objects are refused with 55000; rows, grants, policies, indexes and function definitions remain untouched'), async () => {
    await inTransaction(async () => {
      await db.client.query(setup);
      const before = await snapshot();
      for (const sql of migrations) {
        await db.client.query('savepoint audit_probe');
        let observed: { code?: string; message?: string; hint?: string } | undefined;
        try { await db.client.query(sql); } catch (error) { observed = error as typeof observed; }
        await db.client.query('rollback to savepoint audit_probe');
        expect(observed?.code).toBe('55000');
        expect(observed?.message).toContain('Construction audit schema mismatch');
        expect(observed?.hint).toContain('Do not drop, rename, re-point or mark');
        expect(await snapshot()).toEqual(before);
      }
    });
  });
}

test(meta('CATALOG-READONLY', 'The shared inspection SELECTs execute inside a read-only transaction and expose owner, defaults, FK targets/actions, policies, grants and dependencies'), async () => {
  await db.client.query('begin read only');
  try {
    const results = new Map<string, { rows: Record<string, unknown>[] }>();
    for (let i = 1; i < sections.length; i += 2) {
      results.set(sections[i], await db.client.query(sections[i + 1]));
    }
    expect((await db.client.query('show transaction_read_only')).rows[0].transaction_read_only).toBe('on');
    const audit = results.get('relations')!.rows.find((row) => row.name === 'project_status_log')!;
    expect(audit.owner).toBe('postgres');
    expect(audit.qualified_name).toBe('public.project_status_log');
    expect(audit.columns).toContainEqual(expect.objectContaining({ name: 'id', default: 'gen_random_uuid()' }));
    expect(audit.constraints).toContainEqual(expect.objectContaining({
      columns: ['project_id'], references: 'public.construction_projects', referenced_columns: ['id'],
      on_delete: 'c', validated: true, deferrable: false,
    }));
    expect(audit.grants).toContainEqual(expect.objectContaining({ grantee: 'authenticated', privilege: 'SELECT' }));
    expect(audit.policies).toContainEqual(expect.objectContaining({ name: 'project_log_member_grants' }));
    expect(audit.dependents).toEqual(expect.any(Array));
    expect(results.get('functions')!.rows).toContainEqual(expect.objectContaining({ owner: 'postgres', security_definer: true }));
    expect(results.get('history')!.rows).toEqual([{ version: '20261028000000', name: 'synthetic_phase_a' }]);
  } finally { await db.client.query('rollback'); }
});

test({
  ...meta('DEPENDENCIES-READONLY', 'The SQL-editor dependency report returns one read-only result with RPC definitions/return types, row-type dependents, policies, triggers and incoming FKs'),
  source: dependencyDiagnosticPath,
}, async () => {
  await db.client.query('begin read only');
  try {
    const result = await db.client.query(dependencyDiagnostic);
    expect(Array.isArray(result)).toBe(false); // pg returns an array for multiple statements
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].diagnostic).toBe('LEDGR_DEPENDENCY_CHECK_V1');
    expect(result.rows[0]).not.toHaveProperty('remote_head');
    expect((await db.client.query('show transaction_read_only')).rows[0].transaction_read_only).toBe('on');
    const report = result.rows[0].evidence;
    expect(report.objects).toContainEqual(expect.objectContaining({
      qualified_name: 'public.construction_projects', owner: 'postgres', relpersistence: 'p',
      column_acls: expect.any(Array),
    }));
    expect(report.functions).toContainEqual(expect.objectContaining({
      proname: 'create_project', owner: 'postgres', returns: 'construction_projects',
      definition: expect.stringContaining('RETURNS construction_projects'),
    }));
    expect(report.dependencies).toContainEqual(expect.objectContaining({
      target: 'type construction_projects', object: expect.stringContaining('function create_project('),
    }));
    expect(report.policies).toContainEqual(expect.objectContaining({
      name: 'project_log_member_grants', roles: ['authenticated'], table: 'public.project_status_log',
    }));
    expect(Array.isArray(report.triggers)).toBe(true);
    expect(report.incoming_foreign_keys).toContainEqual(expect.objectContaining({
      table: 'public.project_status_log', definition: expect.stringContaining('REFERENCES construction_projects(id)'),
    }));
  } finally { await db.client.query('rollback'); }
});
