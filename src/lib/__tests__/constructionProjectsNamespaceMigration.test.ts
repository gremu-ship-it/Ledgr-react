import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const phaseA = readFileSync('supabase/migrations/20261028000000_construction_projects.sql', 'utf8');
const namespaceRepair = readFileSync(
  'supabase/migrations/20261028000001_construction_projects_namespace.sql',
  'utf8',
);
const followupMigrations = [
  'supabase/migrations/20261030000000_construction_project_boq.sql',
  'supabase/migrations/20261031000001_construction_progress_valuations.sql',
  'supabase/migrations/20261101000000_construction_project_reporting.sql',
].map((path) => readFileSync(path, 'utf8'));
const projectRepository = readFileSync('src/dal/repositories/ProjectRepository.ts', 'utf8');

describe('construction-project table namespace repair', () => {
  it('uses a dedicated physical table rather than claiming public.projects', () => {
    expect(phaseA).toContain('CREATE TABLE IF NOT EXISTS public.construction_projects');
    expect(phaseA).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)? public\.projects\s*\(/i);
    expect(projectRepository).toContain(".from('construction_projects')");
    expect(projectRepository).not.toContain(".from('projects')");
    for (const sql of followupMigrations) {
      expect(sql).toContain('public.construction_projects');
      expect(sql).not.toMatch(/public\.projects\s*(?:\.|%ROWTYPE)/);
    }
  });

  it('renames only the recognized Phase A table and leaves unrelated legacy relations alone', () => {
    for (const sql of [phaseA, namespaceRepair]) {
      expect(sql).toContain("to_regclass('public.projects')");
      expect(sql).toContain("to_regclass('public.construction_projects')");
      expect(sql).toContain('ALTER TABLE public.projects RENAME TO construction_projects');
      expect(sql).not.toMatch(/DROP TABLE\s+(?:IF EXISTS\s+)?public\.projects/i);
    }
    expect(namespaceRepair).toContain("'get_boq_summary'");
    expect(namespaceRepair).toContain("'generate_invoice_from_valuation'");
    expect(namespaceRepair).toContain("'get_project_pnl'");
  });

  it('identifies Phase A by core definition, not by exact names or object counts', () => {
    // Regression: the previous fingerprint required exactly 13 columns,
    // exactly 9 constraints and projects_* constraint names. A genuine
    // Phase A table that had evolved on staging (boq_locked_at applied
    // out of order, an extra guard check, constraints created under the
    // construction_projects_* names) failed it and raised SQLSTATE 55000,
    // blocking every later migration in the chain.
    for (const sql of [phaseA, namespaceRepair]) {
      expect(sql).not.toContain('= 13');
      expect(sql).not.toMatch(/count\(\*\) FROM pg_constraint WHERE conrelid = c\.oid\) = 9/);
      expect(sql).not.toContain("conname = 'projects_pkey'");
      expect(sql).toContain('pg_get_constraintdef(oid)');
      expect(sql).toContain("attname = 'business_id'");
      expect(sql).toContain("attname = 'created_by'");
    }
  });

  it('preserves an unrelated public.projects instead of aborting the push', () => {
    // The namespace migration previously raised 55000 for this state,
    // which the deploy wrapper retried three times before failing the
    // whole staging deploy mid-chain. It must now warn, leave the legacy
    // relation untouched and create the feature tables alongside it.
    expect(namespaceRepair).not.toContain('Cannot namespace construction projects');
    expect(namespaceRepair).toContain('Preserving public.projects');
    expect(namespaceRepair).toContain('RAISE WARNING');
    expect(namespaceRepair).toContain('CREATE TABLE IF NOT EXISTS public.construction_projects');
    expect(namespaceRepair).toContain('CREATE TABLE IF NOT EXISTS public.project_status_log');
    expect(namespaceRepair).not.toMatch(/DROP TABLE\s+(?:IF EXISTS\s+)?public\.projects/i);
  });

  it('keeps a restricted security-invoker compatibility view only when the old name is free', () => {
    expect(namespaceRepair).toContain("to_regclass('public.projects') IS NULL");
    expect(namespaceRepair).toContain(
      'CREATE VIEW public.projects WITH (security_invoker = true) AS SELECT * FROM public.construction_projects',
    );
    expect(namespaceRepair).toContain('REVOKE ALL ON public.projects FROM PUBLIC, anon, authenticated');
    expect(namespaceRepair).toContain('GRANT SELECT ON public.projects TO authenticated');
    expect(namespaceRepair).toContain('COMMENT ON VIEW public.projects');
    expect(followupMigrations[0]).toContain('refresh_projects_compatibility_view');
    expect(followupMigrations[0]).toContain('boq_locked_at');
    expect(namespaceRepair).toContain("replace(v_definition, 'public.projects', 'public.construction_projects')");
  });
});
