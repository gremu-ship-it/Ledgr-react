import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('construction persistence migration and routes', () => {
  const migration = source('supabase/migrations/20261020000000_construction_projects_and_sites.sql');
  const app = source('src/App.tsx');
  const subcontractMigration = source('supabase/migrations/20261021000000_subcontractor_profiles_and_subcontracts.sql');

  it('extends the existing project table and preserves legacy statuses and the grant model', () => {
    expect(migration).toContain('ALTER TABLE public.construction_projects');
    expect(migration).toContain("'draft'::text");
    expect(migration).toContain("'on_hold'::text");
    expect(migration).toContain("'completed'::text");
    expect(migration).toContain("'tender'::text");
    expect(migration).toContain("'practical_completion'::text");
    expect(migration).toContain("'defect_liability'::text");
    expect(migration).toContain("'closed'::text");
    expect(migration).toContain("_ledgr_construction_actor(v_row.business_id, 'procurement.master.manage')");
    expect(migration).toContain('construction_projects_validate_status');
    expect(migration).not.toContain('grant_construction_procurement_capability');
    expect(migration).not.toContain('DROP POLICY IF EXISTS projects_member_grants');
  });

  it('creates project sites with optional inventory locations and tenant-scoped grant policies', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.construction_sites');
    expect(migration).toContain('location_id uuid NULL');
    expect(migration).toContain('public.is_business_member(business_id)');
    expect(migration).toContain('public.construction_procurement_capabilities_for(business_id)');
    expect(migration).toContain('_ledgr_validate_construction_site_scope');
  });

  it('Enterprise-gates the dashboard, detail paths, and the legacy draft URL', () => {
    const gateStart = app.indexOf('<Route element={<PlanGuard minPlan="enterprise" />}>');
    expect(gateStart).toBeGreaterThan(-1);
    const catchAllEnd = app.indexOf('path="/construction/*"', gateStart);
    const routeGroup = app.slice(gateStart, app.indexOf('</Route>', catchAllEnd));
    expect(routeGroup).toContain('path="/construction"');
    expect(routeGroup).toContain('path="/construction/projects/:projectId"');
    expect(routeGroup).toContain('path="/construction/*"');
    expect(routeGroup).toContain('path="/projects-funding-sources/construction-draft"');
    expect(routeGroup).toContain('element={<Navigate to="/construction" replace />}');
  });

  it('adds subcontractor profiles and project agreements while reusing supplier contacts', () => {
    expect(subcontractMigration).toContain('CREATE TABLE IF NOT EXISTS public.subcontractor_profiles');
    expect(subcontractMigration).toContain('CREATE TABLE IF NOT EXISTS public.subcontracts');
    expect(subcontractMigration).toContain('contact_id uuid NOT NULL REFERENCES public.contacts(id)');
    expect(subcontractMigration).toContain("c.contact_type IN ('supplier', 'both')");
    expect(subcontractMigration).toContain('public.is_business_member(business_id)');
    expect(subcontractMigration).toContain('public.construction_procurement_capabilities_for(business_id)');
    expect(subcontractMigration).toContain('AND c.is_active');
    expect(subcontractMigration).toContain('_ledgr_validate_subcontract_scope');
    expect(subcontractMigration).toContain('_ledgr_validate_subcontract_status_transition');
    expect(subcontractMigration).toContain("WHEN 'active' THEN NEW.status IN ('on_hold', 'completed', 'terminated')");
    expect(subcontractMigration).not.toContain('ALTER TABLE public.construction_projects');
    expect(subcontractMigration).not.toContain('ALTER TABLE public.construction_sites');
    expect(subcontractMigration).not.toContain('grant_construction_procurement_capability');
  });

  it('Enterprise-gates the subcontractor route without changing existing construction URLs', () => {
    const gateStart = app.indexOf('<Route element={<PlanGuard minPlan="enterprise" />}>');
    expect(gateStart).toBeGreaterThan(-1);
    const constructionStart = app.indexOf('path="/construction"', gateStart);
    const routeGroup = app.slice(gateStart, app.indexOf('</Route>', app.indexOf('path="/construction/*"', constructionStart)));
    expect(routeGroup).toContain('path="/construction/subcontractors"');
    expect(routeGroup).toContain('path="/construction/projects/:projectId"');
    expect(routeGroup).toContain('path="/construction/*"');
  });

  it('keeps all new construction labels in the English locale', () => {
    const locale = JSON.parse(source('src/i18n/locales/en.json')) as Record<string, unknown>;
    expect(locale.construction).toBeDefined();
    expect(locale.planGuard).toBeDefined();
    const construction = locale.construction as Record<string, unknown>;
    expect(construction.status).toBeDefined();
    expect(construction.sites).toBeDefined();
    expect(construction.validation).toBeDefined();
    expect(construction.subcontractor).toBeDefined();
    const navigation = locale.navigation as { items: Record<string, unknown> };
    expect(navigation.items.constructionSubcontractors).toBe('Subcontractors');
  });
});
