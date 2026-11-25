import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  NAV_SECTIONS,
  isItemLocked,
  navItemForPath,
  visibleSectionsFor,
} from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import type { BusinessOrganisationProfile, OrganisationCapability } from '@/lib/capabilities/profile';
import type { PlanTier } from '@/lib/billing/plans';

const en = JSON.parse(
  readFileSync('src/i18n/locales/en.json', 'utf8'),
) as {
  navigation: { items: Record<string, string> };
  manufacturing: { costing: Record<string, string> };
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
const navFor = (profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') =>
  visibleSectionsFor(() => true, role, orgCapabilitiesFor(profile), planTier, profile.operating_models)
    .flatMap((section) => section.items);

describe('Manufacturing costing & pricing navigation and route', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('registers the route behind both Enterprise and manufacturing gates', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const route = app.split('path="/manufacturing/costing"')[1]?.split('</Route>')[0] ?? '';
    expect(route).toContain('PlanGate minPlan="enterprise"');
    expect(route).toContain('<CapabilityGate capability="manufacturing">');
    expect(route).toContain('<ProductCostingPage />');
  });

  it('adds an Enterprise-only Costing & Pricing item to the Manufacturing section', () => {
    const section = NAV_SECTIONS.find((s) => s.labelKey === 'navigation.sections.manufacturing');
    expect(section?.items.map((item) => item.path)).toContain('/manufacturing/costing');
    expect(navItemForPath('/manufacturing/costing')).toMatchObject({
      labelKey: 'navigation.items.manufacturingCosting',
      requiresOrgCapability: 'manufacturing',
      minPlan: 'enterprise',
    });
    expect(en.navigation.items.manufacturingCosting).toBe('Costing & Pricing');
    expect(en.manufacturing.costing.title).toBe('Product Costing & Pricing Engine');
  });

  it('is hidden from retail businesses and locked below Enterprise', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(navFor(retailBusiness, 'enterprise').map((item) => item.path)).not.toContain('/manufacturing/costing');
    expect(navFor(manufacturingBusiness, 'free').map((item) => item.path)).toContain('/manufacturing/costing');
    expect(isItemLocked(navItemForPath('/manufacturing/costing')!, 'free')).toBe(true);
    expect(isItemLocked(navItemForPath('/manufacturing/costing')!, 'enterprise')).toBe(false);
  });

  it('is manager-and-above, like the rest of the manufacturing workspace', () => {
    expect(isPathAllowedForRole('manager', '/manufacturing/costing')).toBe(true);
    expect(isPathAllowedForRole('stock_clerk', '/manufacturing/costing')).toBe(false);
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(navFor(manufacturingBusiness, 'enterprise', 'stock_clerk').map((item) => item.path))
      .not.toContain('/manufacturing/costing');
  });

  it('publishes the complete costing copy set', () => {
    const keys = [
      'title', 'subtitle', 'selectProduct', 'directMaterials', 'directLabor', 'overhead',
      'totalUnitCost', 'pricingSimulator', 'strategyMargin', 'strategyMarkup', 'targetRate',
      'recommendedPrice', 'grossProfitUnit', 'currentCatalogPrice', 'currentMargin',
      'lowMarginWarning', 'healthyMargin', 'applyToCatalog', 'applySuccess', 'exportPdf',
      'scrapFactor',
    ];
    for (const key of keys) {
      expect(en.manufacturing.costing[key], `manufacturing.costing.${key}`).toBeTruthy();
    }
  });

  it('links to the simulator directly from a BOM detail page', () => {
    const bomDetail = readFileSync('src/pages/manufacturing/BomDetailPage.tsx', 'utf8');
    expect(bomDetail).toContain("to={`/manufacturing/costing?bom=${bom.id}`}");
    expect(bomDetail).toContain("t('manufacturing.costing.analyzeFromBom')");
  });
});
