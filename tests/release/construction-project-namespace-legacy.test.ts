import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite } from './evidence';

const test = evidenceSuite('construction-project-namespace-legacy');
const migration = '20261028000001_construction_projects_namespace.sql';
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
type MigrationHookContext = {
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
  name: string;
  source: string;
};

beforeAll(async () => {
  db = await createDatabaseFixture({
    beforeMigration: async ({ client, name }: MigrationHookContext) => {
      if (name !== migration) return;

      // Simulate the staging state behind SQLSTATE 55000: 20261028000000 is
      // already recorded (so it is skipped), no construction_projects table
      // exists, and the generic public.projects name belongs to an
      // unrelated legacy relation. The old exact-signature guard aborted
      // here and blocked every later migration; the repair must preserve
      // the legacy table and create the feature tables alongside it.
      // No audit feature is present in this legacy-only fixture. Dropping the
      // project table alone leaves a log with its project FK removed by CASCADE;
      // that is an unconfirmed partial shape and must now be refused, not silently
      // repaired. The audit-ownership suite tests that refusal separately.
      await client.query('DROP TABLE public.project_status_log');
      await client.query('DROP TABLE public.construction_projects CASCADE');
      await client.query(`
        CREATE TABLE public.projects (
          id uuid PRIMARY KEY,
          legacy_label text NOT NULL
        );
        INSERT INTO public.projects(id, legacy_label)
        VALUES ('00000000-0000-4000-8000-000000000321', 'preserve legacy table');
      `);
    },
  });
});

afterAll(async () => {
  await db?.cleanup();
});

test({
  id: 'CPA.NAMESPACE.LEGACY-PRESERVED',
  expected: 'An unrelated public.projects table survives the namespace repair while construction_projects and project_status_log are created alongside it',
  source: `supabase/migrations/${migration}`,
  remediation: 'CONSTRUCTION-PHASE-A',
  layer: 'Local PostgreSQL 17 replay with a legacy-named relation and no construction_projects table simulated before the forward migration',
}, async () => {
  const legacy = await db.client.query(
    'select id, legacy_label from public.projects where id=$1',
    ['00000000-0000-4000-8000-000000000321'],
  );
  expect(legacy.rows).toEqual([
    { id: '00000000-0000-4000-8000-000000000321', legacy_label: 'preserve legacy table' },
  ]);

  const relations = await db.client.query(`
    select c.relname, c.relkind
      from pg_class c
     where c.oid in (
       to_regclass('public.construction_projects'),
       to_regclass('public.project_status_log'),
       to_regclass('public.projects')
     )
     order by c.relname
  `);
  expect(relations.rows.map((r: { relname: string; relkind: string }) => [r.relname, r.relkind])).toEqual([
    ['construction_projects', 'r'],
    ['project_status_log', 'r'],
    ['projects', 'r'],
  ]);

  // No compatibility view is created over the legacy name, and the feature
  // table carries the full Phase A core (BOQ adds boq_locked_at later).
  const constructionColumns = await db.client.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='construction_projects'
      order by ordinal_position`,
  );
  expect(constructionColumns.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
    'id', 'business_id', 'name', 'client_name', 'contract_sum', 'retention_pct',
    'budget', 'status', 'start_date', 'end_date', 'created_by', 'created_at',
    'updated_at', 'boq_locked_at',
  ]);
});
