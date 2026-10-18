import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite } from './evidence';

const test = evidenceSuite('construction-project-namespace');
const migration = '20261028000001_construction_projects_namespace.sql';
const signatures = [
  'public._ledgr_project_next_status(text)',
  'public.create_project(uuid,text,text,numeric,numeric,numeric,date,date)',
  'public.update_project(uuid,text,text,numeric,numeric,numeric,date,date)',
  'public.transition_project_status(uuid,text,text)',
  'public.link_site_to_project(uuid,uuid)',
  'public.unlink_site_from_project(uuid)',
  'public.get_project_cost_summary(uuid)',
  'public._ledgr_project_procurement_tag()',
  'public.create_project_purchase_order(jsonb,uuid,uuid)',
  'public.issue_project_materials(jsonb,uuid,uuid)',
  'public.return_project_materials(jsonb,uuid,uuid)',
  'public._ledgr_project_location_guard()',
];
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
type MigrationHookContext = {
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: { definition?: string }[] }> };
  name: string;
  source: string;
};

beforeAll(async () => {
  db = await createDatabaseFixture({
    beforeMigration: async ({ client, name }: MigrationHookContext) => {
      if (name === '20261030000000_construction_project_boq.sql') {
        const { rows } = await client.query(
          "select pg_get_functiondef('public.get_boq_summary(uuid)'::regprocedure) as definition",
        );
        const definition = rows[0]?.definition;
        if (!definition?.includes('public.construction_projects') || definition.includes('public.projects')) {
          throw new Error('The simulated existing BOQ RPC was not rewritten by the namespace migration.');
        }
        await client.query('DROP FUNCTION public.get_boq_summary(uuid)');
        return;
      }
      if (name === '20261028000000_construction_projects.sql') {
        // Simulate a fully formed Phase A table already using the old name,
        // one possible explanation for the reported collision. The migration
        // should adopt it only because its schema signature is exact.
        await client.query(`
          CREATE TABLE public.projects (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
            name text NOT NULL CHECK (length(btrim(name)) > 0),
            client_name text NOT NULL DEFAULT '',
            contract_sum decimal(18,2) NOT NULL DEFAULT 0 CHECK (contract_sum >= 0 AND contract_sum <> 'NaN'::numeric),
            retention_pct decimal(5,2) NOT NULL DEFAULT 0 CHECK (retention_pct BETWEEN 0 AND 100),
            budget decimal(18,2) NOT NULL DEFAULT 0 CHECK (budget >= 0 AND budget <> 'NaN'::numeric),
            status text NOT NULL DEFAULT 'tender' CHECK (status IN ('tender','active','practical_completion','defect_liability','closed')),
            start_date date, end_date date,
            created_by uuid NOT NULL REFERENCES auth.users(id),
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
          );
        `);
        return;
      }
      if (name !== migration) return;

      // Simulate the old Phase A migration already recorded on staging: its
      // public.projects table, original constraint/index names and PL/pgSQL
      // source bodies are present before the namespace forward migration runs.
      await client.query('ALTER TABLE public.construction_projects RENAME TO projects');
      const constraints = [
        ['construction_projects_pkey', 'projects_pkey'],
        ['construction_projects_business_id_fkey', 'projects_business_id_fkey'],
        ['construction_projects_name_check', 'projects_name_check'],
        ['construction_projects_contract_sum_check', 'projects_contract_sum_check'],
        ['construction_projects_retention_pct_check', 'projects_retention_pct_check'],
        ['construction_projects_budget_check', 'projects_budget_check'],
        ['construction_projects_status_check', 'projects_status_check'],
        ['construction_projects_created_by_fkey', 'projects_created_by_fkey'],
        ['construction_projects_check', 'projects_check'],
      ];
      for (const [currentName, oldName] of constraints) {
        const { rows } = await client.query(
          `select 1 from pg_constraint
            where conrelid='public.projects'::regclass and conname=$1`,
          [currentName],
        );
        if (rows.length) {
          await client.query(`ALTER TABLE public.projects RENAME CONSTRAINT ${currentName} TO ${oldName}`);
        }
      }
      await client.query(`
        ALTER INDEX public.construction_projects_business_status RENAME TO projects_business_status;
        ALTER INDEX public.construction_projects_business RENAME TO projects_business;
      `);

      // Evolve the table the way staging can before the repair lands:
      // a later column applied out of order against the old name, an
      // extra guard check, and one constraint that keeps a non-Phase A
      // name. The previous exact-signature fingerprint (13 columns /
      // 9 constraints / projects_* names) rejected this table with
      // SQLSTATE 55000 and blocked the whole push; the repair must
      // recognize it by core definition and adopt it with data intact.
      await client.query(`
        ALTER TABLE public.projects ADD COLUMN boq_locked_at timestamptz;
        ALTER TABLE public.projects
          ADD CONSTRAINT projects_contract_cap CHECK (contract_sum <= 1000000000);
        ALTER TABLE public.projects
          RENAME CONSTRAINT projects_status_check TO construction_status_vocabulary;
      `);

      for (const signature of signatures) {
        const { rows } = await client.query(
          'select pg_get_functiondef(to_regprocedure($1)::oid) as definition',
          [signature],
        );
        const oldSource = rows[0]?.definition;
        if (!oldSource) throw new Error(`Missing simulated Phase A RPC: ${signature}`);
        await client.query(oldSource.replaceAll('public.construction_projects', 'public.projects'));
      }
      // Model a later feature RPC that was already applied on staging: the
      // forward migration must rewrite it now, not leave that source behind.
      await client.query(`
        CREATE FUNCTION public.get_boq_summary(p_project_id uuid) RETURNS text
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
        BEGIN
          PERFORM 1 FROM public.projects WHERE id=p_project_id;
          RETURN 'migration-compat-probe';
        END $$;
      `);
    },
  });
});

afterAll(async () => {
  await db?.cleanup();
});

test({
  id: 'CPA.NAMESPACE.UPGRADE',
  expected: 'A staging database with the original Phase A schema upgrades without data loss or stale RPC references',
  source: `supabase/migrations/${migration}`,
  remediation: 'CONSTRUCTION-PHASE-A',
  layer: 'Local PostgreSQL 17 replay with prior-version table/function names simulated before the forward migration',
}, async () => {
  const relations = await db.client.query(`
    select c.relname, c.relkind, c.reloptions
      from pg_class c
     where c.oid in (to_regclass('public.construction_projects'), to_regclass('public.projects'))
     order by c.relname
  `);
  expect(relations.rows.map((r: { relname: string; relkind: string }) => [r.relname, r.relkind])).toEqual([
    ['construction_projects', 'r'],
    ['projects', 'v'],
  ]);
  expect(
    relations.rows.find((r: { relname: string }) => r.relname === 'projects')?.reloptions,
  ).toContain('security_invoker=true');
  const compatibilityColumns = await db.client.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='projects' and column_name='boq_locked_at'`,
  );
  expect(compatibilityColumns.rows).toHaveLength(1);

  const staleFunctions = await db.client.query(
    `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.oid = any(
          array(select to_regprocedure(signature)::oid from unnest($1::text[]) as sig(signature))
        )
        and position('public.projects' in pg_get_functiondef(p.oid)) > 0`,
    [signatures],
  );
  expect(staleFunctions.rows).toEqual([]);

  const projectIndex = await db.client.query(
    "select to_regclass('public.construction_projects_business_status') as index_name",
  );
  expect(projectIndex.rows[0]?.index_name).toBe('construction_projects_business_status');
});
