import { afterAll, beforeAll, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite } from './evidence';
import { identities, seedFixture, DAY } from './fixtures';

// Reproduce only the owner-supplied catalog relationships, with SYNTHETIC rows.
// No production OIDs, business identifiers, row contents or credentials are used.
const test = evidenceSuite('construction-project-existing-chain');
const root = 'supabase/migrations/';
const head = '20261027000000';
const pending = readdirSync(root).filter(name => name.endsWith('.sql') && name.slice(0, 14) > head).sort();
const phaseA = readFileSync(root + '20261028000000_construction_projects.sql', 'utf8');
const namespace = readFileSync(root + '20261028000001_construction_projects_namespace.sql', 'utf8');
const boq = readFileSync(root + '20261030000000_construction_project_boq.sql', 'utf8');
const valuations = readFileSync(root + '20261031000001_construction_progress_valuations.sql', 'utf8');
const normalize = phaseA.match(/DO \$normalize_confirmed_project_lifecycle\$[\s\S]*?\$normalize_confirmed_project_lifecycle\$;/)![0];
const tables = ['construction_projects', 'project_status_log', 'project_boq_lines',
  'project_valuations', 'project_valuation_lines', 'project_retention_ledger'];
const meta = (id: string, expected: string) => ({
  id: `CPA.EXISTING.${id}`, expected, source: pending.map(name => root + name).join(', '),
  remediation: 'CONSTRUCTION-PHASE-A',
  layer: 'Disposable PostgreSQL 17; synthetic lifecycle_state/typed-RPC graph; all nine complete pending files, no history repair',
});
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let projectId: string;

beforeAll(async () => {
  db = await createDatabaseFixture();
  orgs = await seedFixture(db.client);
  await db.client.query(`update public.businesses set operating_models=array['CONSTRUCTION'],
    plan_tier='enterprise', plan_expires_at='2099-01-01' where id=$1`, [orgs.A.business]);
  await db.commitAsRole('authenticated', identities.A_owner.id,
    'select public.provision_construction_defaults($1,$2)', [orgs.A.business, identities.A_owner.id]);
  const project = await db.client.query(`
    insert into public.construction_projects(business_id,name,client_name,contract_sum,retention_pct,budget,status,created_by)
    values($1,'Synthetic existing project','Synthetic client',1000,10,800,'active',$2) returning id
  `, [orgs.A.business, identities.A_owner.id]);
  projectId = project.rows[0].id;
  await db.client.query(`insert into public.project_status_log(project_id,from_status,to_status,changed_by,reason)
    values($1,'tender','active',$2,'Synthetic pre-existing audit row')`, [projectId, identities.A_owner.id]);
  const line = await db.client.query(`
    insert into public.project_boq_lines(project_id,line_number,description,quantity,unit,rate,total_value)
    values($1,'1','Synthetic existing BOQ line',1,'item',1000,1000) returning id
  `, [projectId]);
  const valuation = await db.client.query(`
    insert into public.project_valuations(project_id,valuation_number,valuation_date,gross_amount,retention_amount,net_amount,created_by)
    values($1,1,$2,1000,100,900,$3) returning id
  `, [projectId, DAY, identities.A_owner.id]);
  await db.client.query(`
    insert into public.project_valuation_lines(valuation_id,boq_line_id,cumulative_pct,cumulative_value,period_value)
    values($1,$2,100,1000,1000)
  `, [valuation.rows[0].id, line.rows[0].id]);
  await db.client.query(`
    insert into public.project_retention_ledger(project_id,valuation_id,type,amount,created_by)
    values($1,$2,'withheld',100,$3)
  `, [projectId, valuation.rows[0].id, identities.A_owner.id]);
  await db.commitAsRole('authenticated', identities.A_owner.id,
    'select public.link_site_to_project($1,$2)', [orgs.A.location, projectId]);

  // Synthetic metadata mirrors the supplied head/count only. Product SQL must
  // never write it; normal CLI recording after successful application is out
  // of scope for this replay, and no migration repair command is run.
  await db.client.query(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key, name text)`);
  const recorded = readdirSync(root).filter(name => name.endsWith('.sql') && name.slice(0, 14) <= head).sort();
  expect(recorded).toHaveLength(133);
  for (const name of recorded) await db.client.query(
    'insert into supabase_migrations.schema_migrations values($1,$2)', [name.slice(0, 14), name.slice(15, -4)]);
});
afterAll(async () => { await db?.cleanup(); });

async function transaction(run: () => Promise<void>) {
  await db.client.query('begin');
  try { await run(); } finally { await db.client.query('rollback'); }
}

async function legacyShape() {
  await db.client.query('drop view public.projects; alter table public.construction_projects rename to projects');
  const functions = await db.client.query(`
    select pg_get_functiondef(p.oid) as definition from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and position('public.construction_projects' in p.prosrc)>0
  `);
  for (const row of functions.rows) await db.client.query(row.definition.replaceAll('public.construction_projects', 'public.projects'));
  await db.client.query(`
    alter table public.projects rename column status to lifecycle_state;
    alter index public.construction_projects_business_status rename to projects_business_status;
    alter index public.construction_projects_business rename to projects_business;
  `);
}

async function dataSnapshot(legacy = false) {
  const result: unknown[] = [];
  for (const name of tables) {
    const physical = legacy && name === 'construction_projects' ? 'projects' : name;
    const rows = (await db.client.query(`select to_jsonb(t) as row from public.${physical} t order by id`)).rows;
    result.push(rows.map(({ row }: { row: Record<string, unknown> }) => {
      if (legacy && name === 'construction_projects') {
        const { lifecycle_state, ...rest } = row;
        return { ...rest, status: lifecycle_state };
      }
      return row;
    }));
  }
  result.push((await db.client.query('select project_id from public.inventory_locations where id=$1', [orgs.A.location])).rows);
  result.push((await db.client.query('select * from supabase_migrations.schema_migrations order by version')).rows);
  return result;
}

async function identitySnapshot(legacy = false) {
  const names = tables.map(name => 'public.' + (legacy && name === 'construction_projects' ? 'projects' : name));
  return {
    tables: (await db.client.query(`select oid,reltype,relowner from pg_class
      where oid=any(array(select to_regclass(n) from unnest($1::text[]) n)) order by oid`, [names])).rows,
    fks: (await db.client.query(`select oid,conrelid,confrelid,conkey,confkey,confdeltype,confupdtype from pg_constraint
      where contype='f' and (conrelid=any(array(select to_regclass(n) from unnest($1::text[]) n))
        or confrelid=to_regclass($2)) order by oid`, [names, names[0]])).rows,
    functions: (await db.client.query(`select p.oid,p.prorettype,p.proowner,p.proacl from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and
        (position('public.construction_projects' in p.prosrc)>0 or position('public.projects' in p.prosrc)>0)
      order by p.oid`)).rows,
    indexes: (await db.client.query(`select indexrelid,indrelid,indkey,indisunique,indisvalid,indisready from pg_index
      where indrelid=any(array(select to_regclass(n) from unnest($1::text[]) n)) order by indexrelid`, [names])).rows,
  };
}

async function refuses(sql: string, setup: string, expectedMessage: string) {
  await transaction(async () => {
    await legacyShape();
    await db.client.query(setup);
    const before = await dataSnapshot(true);
    const identitiesBefore = await identitySnapshot(true);
    const definitionsBefore = (await db.client.query(`select oid,prosrc from pg_proc
      where pronamespace='public'::regnamespace order by oid`)).rows;
    await db.client.query('savepoint unsafe_probe');
    let error: { code?: string; message?: string } | undefined;
    try { await db.client.query(sql); } catch (caught) { error = caught as typeof error; }
    await db.client.query('rollback to savepoint unsafe_probe');
    expect(error?.code).toBe('55000');
    expect(error?.message).toContain(expectedMessage);
    expect(await dataSnapshot(true)).toEqual(before);
    expect(await identitySnapshot(true)).toEqual(identitiesBefore);
    expect((await db.client.query(`select oid,prosrc from pg_proc
      where pronamespace='public'::regnamespace order by oid`)).rows).toEqual(definitionsBefore);
    expect((await db.client.query("select to_regclass('public.construction_projects') as name")).rows[0].name).toBeNull();
  });
}

test(meta('FULL-PENDING-CHAIN', 'All nine pending files apply to the populated supplied-shape graph, preserving table/row-type/RPC/index/FK identities and every existing row without writing migration history'), async () => {
  await transaction(async () => {
    expect(pending).toHaveLength(9);
    await legacyShape();
    const before = await dataSnapshot(true);
    const identitiesBefore = await identitySnapshot(true);
    for (const name of pending) await db.client.query(readFileSync(root + name, 'utf8'));
    expect(await dataSnapshot()).toEqual(before);
    expect(await identitySnapshot()).toEqual(identitiesBefore);
    expect((await db.client.query(`select relkind,reloptions from pg_class
      where oid='public.projects'::regclass`)).rows[0]).toEqual({ relkind: 'v', reloptions: ['security_invoker=true'] });
    const stale = await db.client.query(`select p.proname from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and (position('public.projects' in p.prosrc)>0 or position('lifecycle_state' in p.prosrc)>0)`);
    expect(stale.rows).toEqual([]);
    for (const sql of [phaseA, namespace, boq, valuations]) await db.client.query(sql);
    expect(await dataSnapshot()).toEqual(before);
    expect(await identitySnapshot()).toEqual(identitiesBefore);
  });
});

test(meta('RPC-AND-RLS', 'Existing typed RPCs and reports work after normalization; lifecycle transitions append audit once, linked rows persist, and browser direct writes remain denied'), async () => {
  await transaction(async () => {
    await legacyShape();
    for (const name of pending) await db.client.query(readFileSync(root + name, 'utf8'));
    await db.client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [identities.A_owner.id]);
    await db.client.query('set local role authenticated');
    const transition = await db.client.query("select * from public.transition_project_status($1,'practical_completion','Synthetic post-upgrade transition')", [projectId]);
    expect(transition.rows[0].status).toBe('practical_completion');
    expect(transition.rows[0]).not.toHaveProperty('lifecycle_state');
    expect((await db.client.query('select * from public.get_project_pnl($1)', [projectId])).rows[0].status).toBe('practical_completion');
    expect((await db.client.query('select * from public.get_portfolio_summary($1)', [orgs.A.business])).rows).toHaveLength(1);
    expect((await db.client.query('select * from public.get_dashboard_metrics($1,6)', [orgs.A.business])).rows).toHaveLength(1);
    for (const name of tables) {
      const privileges = (await db.client.query(`select has_table_privilege('authenticated',$1,'SELECT') as can_read,
        has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') as can_write`, ['public.' + name])).rows[0];
      expect(privileges).toEqual({ can_read: true, can_write: false });
    }
    expect((await db.client.query('select count(*)::integer as n from public.project_status_log where project_id=$1', [projectId])).rows[0].n).toBe(2);
    await db.client.query('reset role');
  });
});

test(meta('CANONICAL-FORWARD', 'A separately pending namespace migration can normalize the same verified lifecycle variant in place'), async () => {
  await transaction(async () => {
    await legacyShape();
    const before = await dataSnapshot(true);
    const ids = await identitySnapshot(true);
    await db.client.query(namespace);
    expect(await dataSnapshot()).toEqual(before);
    expect(await identitySnapshot()).toEqual(ids);
  });
});

const aliasRefusals = [
  ['AMBIGUOUS', "alter table public.projects add column status text not null default 'tender'", 'lifecycle schema mismatch'],
  ['DEFAULT', "alter table public.projects alter column lifecycle_state set default 'active'", 'lifecycle schema mismatch'],
  ['VOCABULARY', "alter table public.projects drop constraint construction_projects_status_check", 'lifecycle schema mismatch'],
  ['EXCLUSION', "alter table public.projects add constraint synthetic_exclusion exclude using gist (numrange(contract_sum,contract_sum,'[]') with &&)", 'lifecycle schema mismatch'],
  ['EXTRA-STATE-CHECK', "alter table public.projects add constraint synthetic_extra_state check(lifecycle_state <> 'closed')", 'lifecycle schema mismatch'],
  ['OPTIONAL-LOCK-TYPE', 'alter table public.projects alter column boq_locked_at type text', 'lifecycle schema mismatch'],
  ['OWNER', 'alter table public.projects owner to service_role', 'Unverified construction lifecycle relation'],
  ['AUDIT-FK', 'alter table public.project_status_log drop constraint project_status_log_project_id_fkey', 'audit schema mismatch'],
  ['AUDIT-GRANT', 'grant insert on public.project_status_log to authenticated', 'audit schema mismatch'],
  ['AUDIT-POLICY', 'create policy synthetic_broader_audit on public.project_status_log for select to authenticated using (true)', 'audit schema mismatch'],
  ['RPC-IDENTITY', 'alter function public.create_project(uuid,text,text,numeric,numeric,numeric,date,date) security invoker', 'RPC identity'],
  ['TEXT-CALLER', `create function public.synthetic_lifecycle_caller() returns text language plpgsql as $$
    declare s text; begin select lifecycle_state into s from public.projects limit 1; return s; end $$`, 'still requires lifecycle_state'],
] as const;
for (const [id, setup, message] of aliasRefusals) {
  test(meta('REFUSE-' + id, 'Unverified lifecycle variants are refused before renaming or changing rows, FK targets, RPC definitions, grants or history'), async () => {
    await refuses(normalize, setup, message);
  });
}

for (const [label, sql, guardName, table, change] of [
  ['BOQ-TYPE', boq, 'construction_boq', 'project_boq_lines', 'alter column quantity type numeric(19,4)'],
  ['BOQ-DEFAULT', boq, 'construction_boq', 'project_boq_lines', 'alter column id drop default'],
  ['VALUATION-FK', valuations, 'construction_valuations', 'project_valuations', 'drop constraint project_valuations_project_id_fkey'],
  ['RETENTION-CHECK', valuations, 'construction_valuations', 'project_retention_ledger', 'drop constraint project_retention_ledger_amount_check'],
] as const) {
  test(meta('REFUSE-' + label, 'Existing BOQ/valuation tables are not adopted from names alone; incompatible contracts fail before any DDL'), async () => {
    await transaction(async () => {
      await db.client.query(`alter table public.${table} ${change}`);
      const before = await dataSnapshot();
      const ids = await identitySnapshot();
      const guard = sql.match(new RegExp(`DO \\$confirm_existing_${guardName}\\$[\\s\\S]*?\\$confirm_existing_${guardName}\\$;`))![0];
      await db.client.query('savepoint table_probe');
      let observed: { code?: string } | undefined;
      try { await db.client.query(guard); } catch (error) { observed = error as typeof observed; }
      await db.client.query('rollback to savepoint table_probe');
      expect(observed?.code).toBe('55000');
      expect(await dataSnapshot()).toEqual(before);
      expect(await identitySnapshot()).toEqual(ids);
    });
  });
}


test(meta('OLD-RETURN-TYPE-CONFLICT', 'A separate replacement table cannot replace the existing typed RPC return type; same-OID adoption avoids the reproducible 42P13 without dropping functions'), async () => {
  await transaction(async () => {
    await legacyShape();
    const before = await dataSnapshot(true);
    const ids = await identitySnapshot(true);
    const definition = (await db.client.query(`select pg_get_functiondef(
      'public.create_project(uuid,text,text,numeric,numeric,numeric,date,date)'::regprocedure) as definition`)).rows[0].definition;
    await db.client.query('savepoint return_type_probe');
    await db.client.query('create table public.construction_projects(id uuid primary key)');
    let error: { code?: string; message?: string } | undefined;
    try { await db.client.query(definition.replace('RETURNS projects', 'RETURNS public.construction_projects')); }
    catch (caught) { error = caught as typeof error; }
    await db.client.query('rollback to savepoint return_type_probe');
    expect(error?.code).toBe('42P13');
    expect(error?.message).toContain('cannot change return type');
    expect(await dataSnapshot(true)).toEqual(before);
    expect(await identitySnapshot(true)).toEqual(ids);
  });
});

test(meta('BOQ-RENAMED-CONSTRAINTS', 'BOQ equivalence uses constraint definitions, not names; an extra nullable column is retained on replay'), async () => {
  await transaction(async () => {
    await db.client.query(`alter table public.project_boq_lines rename constraint project_boq_lines_pkey to synthetic_boq_pk;
      alter table public.project_boq_lines rename constraint project_boq_lines_project_id_fkey to synthetic_boq_fk;
      alter table public.project_boq_lines add column synthetic_optional text`);
    const before = await dataSnapshot();
    const ids = await identitySnapshot();
    await db.client.query(boq);
    expect(await dataSnapshot()).toEqual(before);
    expect(await identitySnapshot()).toEqual(ids);
  });
});

for (const [id, setup] of [
  ['WRONG-INDEX', 'drop index public.project_boq_lines_order; create index project_boq_lines_order on public.project_boq_lines(description)'],
  ['EXTRA-UNIQUENESS', 'create unique index synthetic_boq_description_unique on public.project_boq_lines(description)'],
  ['EXTRA-POLICY', 'create policy synthetic_broader_boq on public.project_boq_lines for select to authenticated using(true)'],
] as const) {
  test(meta('REFUSE-' + id, 'Existing index/uniqueness/policy collisions are refused, never dropped or silently skipped by IF NOT EXISTS'), async () => {
    await transaction(async () => {
      await db.client.query(setup);
      const before = await dataSnapshot();
      const ids = await identitySnapshot();
      await db.client.query('savepoint index_probe');
      let error: { code?: string } | undefined;
      try { await db.client.query(boq); } catch (caught) { error = caught as typeof error; }
      await db.client.query('rollback to savepoint index_probe');
      expect(error?.code).toBe('55000');
      expect(await dataSnapshot()).toEqual(before);
      expect(await identitySnapshot()).toEqual(ids);
    });
  });
}

test(meta('REFUSE-RESERVED-INDEX', 'A missing BOQ table does not authorize stealing an index name from another relation'), async () => {
  await transaction(async () => {
    await db.client.query('alter table public.project_boq_lines rename to synthetic_saved_boq');
    const before = (await db.client.query('select * from public.synthetic_saved_boq order by id')).rows;
    const guard = boq.match(/DO \$confirm_existing_construction_boq\$[\s\S]*?\$confirm_existing_construction_boq\$;/)![0];
    await db.client.query('savepoint reserved_probe');
    let error: { code?: string } | undefined;
    try { await db.client.query(guard); } catch (caught) { error = caught as typeof error; }
    await db.client.query('rollback to savepoint reserved_probe');
    expect(error?.code).toBe('55000');
    expect((await db.client.query('select * from public.synthetic_saved_boq order by id')).rows).toEqual(before);
    expect((await db.client.query("select to_regclass('public.project_boq_lines') as name")).rows[0].name).toBeNull();
  });
});
