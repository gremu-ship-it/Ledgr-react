import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import { hasCapability, PLANS, type PlanTier } from '@/lib/billing/plans';
import {
  deriveOrganisationCapabilityDefaults,
  OPERATING_MODELS,
  ORGANISATION_CAPABILITIES,
  OPERATING_MODEL_LABELS,
  type BusinessOrganisationProfile,
} from '../profile';

/**
 * Manufacturing Phase A — the organisation-layer half of the vertical.
 *
 * These cover the profile → defaults → resolver chain, and the plan tier the
 * manufacturing capability is sold on. The SQL half (constraints, provisioning,
 * the WIP Inventory account) is covered against a real PostgreSQL in
 * tests/release/manufacturing-provisioning.test.ts.
 */

afterEach(() => vi.unstubAllEnvs());

const fullAccess = { subscription: true, partner: true, role: true };

const manufacturingBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['MANUFACTURING'],
};

const retailBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['RETAIL'],
};

const constructionBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['CONSTRUCTION'],
};

describe('MANUFACTURING operating model vocabulary', () => {
  it('is part of the operating-model enum, with a label', () => {
    expect(OPERATING_MODELS).toContain('MANUFACTURING');
    expect(OPERATING_MODEL_LABELS.MANUFACTURING).toBe('Manufacturing');
  });

  it('registers the manufacturing organisation capability', () => {
    expect(ORGANISATION_CAPABILITIES).toContain('manufacturing');
  });
});

describe('MANUFACTURING capability defaults', () => {
  it('turns on sales, inventory and manufacturing — and nothing else', () => {
    // The spec's intent: sales true, inventory true, manufacturing true;
    // pos false, services false, construction false.
    expect(deriveOrganisationCapabilityDefaults(manufacturingBusiness)).toEqual({
      sales: true,
      pos: false,
      inventory: true,
      services: false,
      construction: false,
      manufacturing: true,
    });
  });

  it('does not grant POS or services to a manufacturer', () => {
    // Explicitly asserted because a manufacturer is neither a till operator nor
    // a service business, and both are independent defaults that must stay off.
    const defaults = deriveOrganisationCapabilityDefaults(manufacturingBusiness);
    expect(defaults.pos).toBe(false);
    expect(defaults.services).toBe(false);
    expect(defaults.construction).toBe(false);
  });

  it('unions rather than replaces: a manufacturer that also retails keeps POS', () => {
    const both = deriveOrganisationCapabilityDefaults({
      organisation_type: 'FOR_PROFIT',
      operating_models: ['MANUFACTURING', 'RETAIL'],
    });
    expect(both.pos).toBe(true);
    expect(both.inventory).toBe(true);
    expect(both.manufacturing).toBe(true);
  });

  it('keeps the other verticals’ defaults unchanged (no regression)', () => {
    expect(deriveOrganisationCapabilityDefaults(retailBusiness)).toMatchObject({
      pos: true,
      inventory: true,
      manufacturing: false,
    });
    // Construction keeps its own services default; manufacturing does not share it.
    expect(deriveOrganisationCapabilityDefaults(constructionBusiness)).toMatchObject({
      services: true,
      construction: true,
      manufacturing: false,
    });
    expect(deriveOrganisationCapabilityDefaults(manufacturingBusiness).services).toBe(false);
  });

  it('treats manufacturing as trading, so a manufacturing non-profit is not "pure grant"', () => {
    const grantFundedManufacturer = deriveOrganisationCapabilityDefaults({
      organisation_type: 'NON_PROFIT',
      operating_models: ['GRANT_FUNDED', 'MANUFACTURING'],
    });
    expect(grantFundedManufacturer.sales).toBe(true);
    expect(grantFundedManufacturer.manufacturing).toBe(true);
  });

  it('leaves a purely grant-funded non-profit without manufacturing', () => {
    const pureGrant = deriveOrganisationCapabilityDefaults({
      organisation_type: 'NON_PROFIT',
      operating_models: ['GRANT_FUNDED'],
    });
    expect(pureGrant.manufacturing).toBe(false);
    expect(pureGrant.sales).toBe(false);
  });
});

describe('manufacturing is profile-gated on both kill-switch states', () => {
  it('resolves from the profile with the organisation layer ON', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('manufacturing', manufacturingBusiness, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('manufacturing', retailBusiness, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('manufacturing', constructionBusiness, fullAccess)).toBe(false);
  });

  it('is STILL profile-gated with the organisation layer OFF', () => {
    // This is the whole point of ALWAYS_PROFILE_GATED: an Enterprise retail
    // business must not inherit a manufacturing workspace from its plan tier
    // alone, even while the layer is switched off.
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    expect(resolveBusinessCapability('manufacturing', manufacturingBusiness, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('manufacturing', retailBusiness, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('manufacturing', constructionBusiness, fullAccess)).toBe(false);
  });

  it('fails closed for a business with no profile at all', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    expect(resolveBusinessCapability('manufacturing', null, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('manufacturing', undefined, fullAccess)).toBe(false);
    // A profile that carries no operating-model decision is not a manufacturer.
    expect(resolveBusinessCapability('manufacturing', { organisation_type: 'FOR_PROFIT' }, fullAccess)).toBe(false);
  });

  it('is narrowed by the other layers, never widened by them', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    // A perfect plan/partner/role cannot manufacture a capability the profile denies.
    expect(resolveBusinessCapability('manufacturing', retailBusiness, fullAccess)).toBe(false);
  });

  it('honours an explicit capability override in both directions', () => {
    const denied: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['MANUFACTURING'],
      capability_overrides: { manufacturing: false },
    };
    const granted: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['RETAIL'],
      capability_overrides: { manufacturing: true },
    };
    expect(resolveBusinessCapability('manufacturing', denied, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('manufacturing', granted, fullAccess)).toBe(true);
  });
});

describe('manufacturing is an Enterprise module', () => {
  it('is a plan capability held only by Enterprise', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'growth', 'pro', 'enterprise'];
    const withManufacturing = tiers.filter((tier) => hasCapability(tier, 'manufacturing'));
    expect(withManufacturing).toEqual(['enterprise']);
    expect(PLANS.enterprise.capabilities).toContain('manufacturing');
  });

  it('is sold on the same terms as construction, which is still there too', () => {
    expect(PLANS.enterprise.capabilities).toContain('construction');
    expect(hasCapability('pro', 'manufacturing')).toBe(false);
    expect(hasCapability('pro', 'construction')).toBe(false);
  });
});
