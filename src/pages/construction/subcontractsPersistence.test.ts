import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('subcontract persistence and Enterprise routes', () => {
  const migration = source('supabase/migrations/20261117000000_subcontractor_profiles_and_subcontracts.sql');
  const app = source('src/App.tsx');

  it('reuses supplier contacts and tenant-scopes profiles and project agreements', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.subcontractor_profiles');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.subcontracts');
    expect(migration).toContain('contact_id uuid NOT NULL REFERENCES public.contacts(id)');
    expect(migration).toContain("c.contact_type IN ('supplier', 'both')");
    expect(migration).toContain('AND c.is_active');
    expect(migration).toContain('public.is_business_member(business_id)');
    expect(migration).toContain('public.construction_procurement_capabilities_for(business_id)');
    expect(migration).toContain('_ledgr_validate_subcontract_scope');
    expect(migration).toContain('_ledgr_validate_subcontract_status_transition');
    expect(migration).toContain("WHEN 'active' THEN NEW.status IN ('on_hold', 'completed', 'terminated')");
    expect(migration).not.toContain('ALTER TABLE public.construction_projects');
    expect(migration).not.toContain('ALTER TABLE public.construction_sites');
    expect(migration).not.toContain('grant_construction_procurement_capability');
  });

  it('Enterprise- and capability-gates the subcontractor route and keeps it specific to that URL', () => {
    const start = app.indexOf('path="/construction/subcontractors"');
    expect(start).toBeGreaterThan(-1);
    const route = app.slice(start, app.indexOf('/>', start));
    expect(route).toContain('PlanGate minPlan="enterprise"');
    expect(route).toContain('<CapabilityGate capability="construction">');
    expect(route).toContain('<SubcontractorsPage');
    expect(app).toContain('path="/construction/*"');
  });

  it('adds the agreement section to the existing project detail tabs', () => {
    const detail = source('src/components/construction/projects/ProjectDetail.tsx');
    expect(detail).toContain("'subcontracts'");
    expect(detail).toContain('<ProjectSubcontracts');
  });

  it('keeps new labels in English localization', () => {
    const locale = JSON.parse(source('src/i18n/locales/en.json')) as {
      navigation: { items: Record<string, string> };
      construction: { subcontractor?: Record<string, unknown>; projects: { tabs: Record<string, string> } };
    };
    expect(locale.navigation.items.constructionSubcontractors).toBe('Subcontractors');
    expect(locale.construction.subcontractor).toBeDefined();
    expect(locale.construction.projects.tabs.subcontracts).toBe('Subcontracts');
  });
});
