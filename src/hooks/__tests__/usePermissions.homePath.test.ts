import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHomePathForRole, isPathAllowedForRole } from '../usePermissions';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import type {
  BusinessOrganisationProfile,
  OrganisationCapability,
} from '@/lib/capabilities/profile';

// ── Bug C regression tests: capability-aware home path ──────────────────────
//
// getHomePathForRole used to hard-code /pos for the cashier and manager
// roles, so a construction or service-only business (pos: false) landed its
// till staff on a page the POS capability gate immediately rejected. The fix
// accepts the same organisation-capability predicate navigation uses and
// downgrades a /pos home for a business without POS.

const fullAccess = { subscription: true, partner: true, role: true };

/**
 * The predicate `useOrganisationCapabilityVisibility` hands to navigation and
 * now to the home path, derived from a real profile through the same resolver
 * the app uses — these tests cover profile → capability → home path rather
 * than a hand-written stub.
 */
function predicateFor(profile: BusinessOrganisationProfile) {
  return vi.fn((capability: OrganisationCapability) =>
    resolveBusinessCapability(capability, profile, fullAccess));
}

const retail: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['RETAIL'],
};

const construction: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['CONSTRUCTION'],
};

const serviceOnly: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['SERVICE_SALES'],
};

afterEach(() => vi.unstubAllEnvs());

describe('getHomePathForRole without a capability predicate', () => {
  it('keeps the legacy role-only mapping, byte for byte', () => {
    expect(getHomePathForRole('cashier')).toBe('/pos');
    expect(getHomePathForRole('manager')).toBe('/pos');
    expect(getHomePathForRole('stock_clerk')).toBe('/products');
    expect(getHomePathForRole('sales_clerk')).toBe('/income');
    expect(getHomePathForRole('inventory_manager')).toBe('/products');
    expect(getHomePathForRole('purchasing_officer')).toBe('/expenses');
    expect(getHomePathForRole('owner')).toBe('/dashboard');
    expect(getHomePathForRole(null)).toBe('/dashboard');
  });
});

describe('capability-aware home paths (organisation layer on)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
  });

  it('sends a retail cashier and manager to the till — no regression', () => {
    const predicate = predicateFor(retail);
    expect(predicate).not.toHaveBeenCalled();
    expect(getHomePathForRole('cashier', predicate)).toBe('/pos');
    expect(getHomePathForRole('manager', predicate)).toBe('/pos');
    // Only the pos decision is consulted, and only for a /pos home.
    expect(predicate.mock.calls.flatMap((call) => call[0])).toEqual(['pos', 'pos']);
  });

  it('lands a construction manager on the dashboard instead of the dead till', () => {
    const predicate = predicateFor(construction);
    expect(getHomePathForRole('manager', predicate)).toBe('/dashboard');
  });

  it('lands a construction cashier on /income — the first page its role may open', () => {
    // Cashiers cannot open /dashboard at all (isPathAllowedForRole confines
    // them to the till, sales documents and support). Sending them "home" to
    // /dashboard would make RoleRoute bounce them straight back forever, so
    // the fallback is the first surface the role is allowed to use.
    expect(isPathAllowedForRole('cashier', '/dashboard')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/income')).toBe(true);
    const predicate = predicateFor(construction);
    expect(getHomePathForRole('cashier', predicate)).toBe('/income');
  });

  it('downgrades a service-only business’s till staff too (pos: false)', () => {
    const predicate = predicateFor(serviceOnly);
    expect(getHomePathForRole('manager', predicate)).toBe('/dashboard');
    expect(getHomePathForRole('cashier', predicate)).toBe('/income');
  });

  it('leaves non-POS homes untouched for a business without POS', () => {
    const predicate = predicateFor(construction);
    expect(getHomePathForRole('stock_clerk', predicate)).toBe('/products');
    expect(getHomePathForRole('sales_clerk', predicate)).toBe('/income');
    expect(getHomePathForRole('owner', predicate)).toBe('/dashboard');
    // A /products or /income home never consults the predicate.
    expect(predicate).not.toHaveBeenCalled();
  });

  it('keeps the role definitions themselves unchanged', () => {
    // The fix is the home path, not the role: a manager may still open the
    // dashboard, a cashier still may not, and the till is still route-legal
    // for both — the business simply has no POS to land them on.
    expect(isPathAllowedForRole('manager', '/dashboard')).toBe(true);
    expect(isPathAllowedForRole('cashier', '/pos')).toBe(true);
    expect(isPathAllowedForRole('manager', '/pos')).toBe(true);
  });
});

describe('capability-aware home paths (organisation layer off — kill switch)', () => {
  it('still downgrades the till home for a non-RETAIL business', () => {
    // POS is in ALWAYS_PROFILE_GATED, so its profile decision is honoured
    // with the kill switch off too — the home path downgrades on exactly
    // the same terms as the POS nav item and the /pos route gate, never
    // ahead of them: a non-RETAIL cashier lands on /income, not the
    // gated till, and a non-RETAIL manager on /dashboard.
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    const predicate = predicateFor(construction);
    expect(getHomePathForRole('cashier', predicate)).toBe('/income');
    expect(getHomePathForRole('manager', predicate)).toBe('/dashboard');
  });

  it('keeps /pos as the till home for a retail business while the legacy layer is off', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    const predicate = predicateFor(retail);
    expect(getHomePathForRole('cashier', predicate)).toBe('/pos');
    expect(getHomePathForRole('manager', predicate)).toBe('/pos');
  });
});
