import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAV_SECTIONS, isItemLocked, navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import type { BusinessOrganisationProfile, OrganisationCapability } from '@/lib/capabilities/profile';
import type { PlanTier } from '@/lib/billing/plans';

const en = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../i18n/locales/en.json', import.meta.url)), 'utf8'),
) as {
  navigation: { sections: Record<string, string>; items: Record<string, string> };
  manufacturing: { bom: Record<string, unknown>; wo: Record<string, unknown> };
  common: Record<string, string>;
};

const manufacturingBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['MANUFACTURING'],
};

const retailBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['RETAIL'],
};

const fullAccess = { subscription: true, partner: true, role: true };

const orgCapabilitiesFor = (profile: BusinessOrganisationProfile) => (capability: OrganisationCapability) =>
  resolveBusinessCapability(capability, profile, fullAccess);

function navFor(profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') {
  return visibleSectionsFor(() => true, role, orgCapabilitiesFor(profile), planTier).flatMap(
    (section) => section.items,
  );
}

const productionItem = (profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') =>
  navFor(profile, planTier, role).find((item) => item.path === '/manufacturing/production');

describe('manufacturing work order navigation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps the Manufacturing section shaped Dashboard → BOM → Production', () => {
    const section = NAV_SECTIONS.find((s) => s.labelKey === 'navigation.sections.manufacturing');
    expect(section).toBeDefined();
    expect(section?.items.map((i) => i.path)).toEqual([
      '/manufacturing',
      '/manufacturing/bom',
      '/manufacturing/production',
      '/manufacturing/runs',
      '/manufacturing/routings',
      '/manufacturing/work-centres',
    ]);
    // Every entry stays gated by the operating model and sold on Enterprise.
    for (const item of section?.items ?? []) {
      expect(item.requiresOrgCapability).toBe('manufacturing');
      expect(item.minPlan).toBe('enterprise');
    }
  });

  it('exposes Production on the same gates as Bill of Materials', () => {
    const item = navItemForPath('/manufacturing/production');
    expect(item).toMatchObject({
      path: '/manufacturing/production',
      requiresOrgCapability: 'manufacturing',
      minPlan: 'enterprise',
    });
    expect(item?.labelKey).toBe('manufacturing.bom.production');
    expect(en.manufacturing.bom.production).toBe('Production');
    for (const [path, labelKey] of [
      ['/manufacturing/runs', 'navigation.items.manufacturingRuns'],
      ['/manufacturing/routings', 'navigation.items.manufacturingRoutings'],
      ['/manufacturing/work-centres', 'navigation.items.manufacturingWorkCentres'],
    ]) {
      expect(navItemForPath(path)).toMatchObject({ path, labelKey, minPlan: 'enterprise', requiresOrgCapability: 'manufacturing' });
    }
  });

  it('activates Dashboard at the manufacturing root route', () => {
    const dashboard = navItemForPath('/manufacturing');
    expect(dashboard?.labelKey).toBe('manufacturing.bom.dashboard');
    expect(dashboard?.path).toBe('/manufacturing');
    expect(en.manufacturing.bom.dashboard).toBe('Dashboard');
  });

  it('is completely ABSENT for a retail business — no BOM, no production', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(productionItem(retailBusiness, 'enterprise')).toBeUndefined();
    expect(navFor(retailBusiness, 'enterprise').map((i) => i.path)).not.toContain('/manufacturing/bom');
    expect(navFor(retailBusiness, 'enterprise').map((i) => i.path)).not.toContain('/manufacturing/production');
    expect(navFor(retailBusiness, 'enterprise').map((i) => i.path)).not.toContain('/manufacturing');
  });

  it('is present and LOCKED for a manufacturing business on Free — plan gate', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const item = productionItem(manufacturingBusiness, 'free');
    expect(item).toBeDefined();
    expect(item?.locked).toBe(true);
    expect(isItemLocked(item!, 'free')).toBe(true);
  });

  it('is locked on Starter/Growth/Pro and unlocked only on Enterprise', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    for (const tier of ['free', 'starter', 'growth', 'pro'] as PlanTier[]) {
      expect(productionItem(manufacturingBusiness, tier)?.locked).toBe(true);
    }
    expect(productionItem(manufacturingBusiness, 'enterprise')?.locked).toBe(false);
  });

  it('is manager-and-above: manager sees production, stock_clerk and cashier do not', () => {
    expect(isPathAllowedForRole('manager', '/manufacturing/production')).toBe(true);
    expect(isPathAllowedForRole('owner', '/manufacturing/production')).toBe(true);
    expect(isPathAllowedForRole('admin', '/manufacturing/production')).toBe(true);
    // Till and store roles are confined to their own surfaces.
    expect(isPathAllowedForRole('stock_clerk', '/manufacturing/production')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/manufacturing/production')).toBe(false);
    // `viewer` is a read-only role that reaches most surfaces, and the RLS read
    // policy admits every member — the write path is what refuses it (see
    // tests/release/manufacturing-work-orders.test.ts, MFG.WO.RLS.*).
    expect(isPathAllowedForRole('viewer', '/manufacturing/production')).toBe(true);
  });

  it('registers the three work order routes behind the manufacturing capability gate', () => {
    const app = readFileSync(fileURLToPath(new URL('../../../App.tsx', import.meta.url)), 'utf8');
    for (const path of [
      '/manufacturing/production',
      '/manufacturing/production/new',
      '/manufacturing/production/:id',
      '/manufacturing/runs',
      '/manufacturing/routings',
      '/manufacturing/work-centres',
    ]) {
      const route = app.slice(app.indexOf(`path="${path}"`));
      expect(route, `route ${path} must exist`).not.toBe(app);
      // The gate must wrap the page, and the page must be the work order page —
      // not the Phase A "coming soon" dashboard.
      expect(route.slice(0, 400)).toContain('<CapabilityGate capability="manufacturing">');
      expect(route.slice(0, 400)).toMatch(/WorkOrder(List|Create|Detail)Page|ProductionRunsPage|RoutingsPage|WorkCentresPage/);
      expect(route.slice(0, 400)).not.toContain('ManufacturingDashboardPage');
    }
  });

  it('publishes every work order i18n key via en.json', () => {
    const wo = en.manufacturing.wo as Record<string, unknown>;
    expect(wo.title).toBe('Work Orders');
    expect(wo.create).toBe('Create Work Order');
    expect(wo.workOrderNumber).toBe('Work Order');
    expect(wo.outputProduct).toBe('Output Product');
    expect(wo.plannedQuantity).toBe('Planned Qty');
    expect(wo.completedQuantity).toBe('Completed Qty');
    expect(wo.scrappedQuantity).toBe('Scrapped Qty');
    expect(wo.yield).toBe('Yield');
    expect(wo.progress).toBe('Progress');
    expect(wo.plannedStart).toBe('Planned Start');
    expect(wo.plannedEnd).toBe('Planned End');
    expect(wo.actualStart).toBe('Actual Start');
    expect(wo.actualEnd).toBe('Actual End');
    expect(wo.sourceLocation).toBe('Source Location');
    expect(wo.destinationLocation).toBe('Destination Location');
    expect(wo.release).toBe('Release');
    expect(wo.start).toBe('Start Production');
    expect(wo.complete).toBe('Complete');
    expect(wo.close).toBe('Close');
    expect(wo.cancel).toBe('Cancel');
    expect(wo.recordRun).toBe('Record Production Run');
    expect(wo.recordConsumption).toBe('Record Consumption');
    expect(wo.recordReturn).toBe('Record Return');
    expect(wo.runNumber).toBe('Run #');
    expect(wo.outputQty).toBe('Output Qty');
    expect(wo.scrapQty).toBe('Scrap Qty');
    expect(wo.materials).toBe('Materials');
    expect(wo.productionRuns).toBe('Production Runs');
    expect(wo.transactions).toBe('Material Transactions');
    expect(wo.costSummary).toBe('Cost Summary');
    expect(wo.totalConsumed).toBe('Total Material Cost');
    expect(wo.totalReceived).toBe('Finished Goods Value');
    expect(wo.wipBalance).toBe('WIP Balance');
    expect(wo.costPerUnit).toBe('Cost Per Unit');
    expect(wo.planned).toBe('Planned');
    expect(wo.actual).toBe('Actual');
    expect(wo.variance).toBe('Variance');
    expect(wo.overConsumption).toBe('Over-consumed');
    expect(wo.noActiveBom).toBe('No active BOM — create one first.');
    expect(wo.emptyState).toBe('No work orders yet. Create a work order to start a production run.');
    expect(wo.confirmRelease).toBe(
      'Release this work order? The BOM will be locked and materials will be reserved.',
    );
    expect(wo.confirmComplete).toBe('Complete this work order? Remaining materials will be backflushed.');
    expect(wo.confirmCancel).toBe('Cancel this work order? All material movements will be reversed.');
    expect(wo.overproductionWarning).toBe('Output exceeds planned quantity by more than 10%.');

    const status = wo.status as Record<string, string>;
    expect(status.draft).toBe('Draft');
    expect(status.released).toBe('Released');
    expect(status.inProgress).toBe('In Progress');
    expect(status.completed).toBe('Completed');
    expect(status.closed).toBe('Closed');
    expect(status.cancelled).toBe('Cancelled');
  });

  it('does not add French, Chichewa, Portuguese or Swahili work order strings', () => {
    for (const locale of ['fr', 'ny', 'pt', 'sw']) {
      const bundle = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../../../i18n/locales/${locale}.json`, import.meta.url)), 'utf8'),
      ) as { manufacturing?: { wo?: unknown } };
      expect(bundle.manufacturing?.wo, `${locale}.json must not gain a manufacturing.wo block`).toBeUndefined();
    }
  });
});
