import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { visibleSectionsFor, navItemForPath } from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import {
  deriveOrganisationCapabilityDefaults,
  organisationCapabilityDecision,
  type BusinessOrganisationProfile,
} from '../profile';

afterEach(() => vi.unstubAllEnvs());

const fullAccess = { subscription: true, partner: true, role: true };
const pinnedExisting: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: [],
  capability_overrides: {
    sales: true,
    pos: true,
    inventory: true,
    services: true,
  },
};

function visiblePaths(isOrgEnabled: (capability: 'sales' | 'pos' | 'inventory' | 'services') => boolean) {
  return visibleSectionsFor(() => true, 'owner', isOrgEnabled)
    .flatMap((section) => section.items.map((item) => item.path));
}

describe('frozen Phase 1 capability acceptance matrix', () => {
  it('A — preserves the existing retail surface and central POS navigation', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', pinnedExisting, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('services', pinnedExisting, fullAccess)).toBe(true);
    const paths = visiblePaths(() => true);
    expect(paths).toContain('/pos');
    expect(paths).toContain('/products');
    expect(navItemForPath('/pos')?.requiresOrgCapability).toBe('pos');

    const app = readFileSync(fileURLToPath(new URL('../../../../src/App.tsx', import.meta.url)), 'utf8');
    const posRoute = app.match(/<Route path="\/pos" element=\{[\s\S]*?<\/CapabilityGate>\s*\} \/>/);
    expect(posRoute?.[0]).toContain('<CapabilityGate capability="pos">');
    expect(posRoute?.[0]).toContain('<PosPage />');
  });

  it('B — preserves a legacy non-POS business regardless of its prior usage signals', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    // No model/history inference is used for existing businesses: the migration
    // pins the current UI capabilities explicitly, including Strategy-A POS.
    expect(organisationCapabilityDecision('pos', pinnedExisting)).toBe(true);
    expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', pinnedExisting, fullAccess)).toBe(true);
  });

  it('H — keeps POS available for an existing tenant after the pin migration', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess)).toBe(true);
  });

  it('I — an organisation pin cannot bypass the existing role decision', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', pinnedExisting, { ...fullAccess, role: false })).toBe(false);
    expect(resolveBusinessCapability('inventory', pinnedExisting, { ...fullAccess, role: false })).toBe(false);
  });

  it('J — leaves RLS policy definitions untouched by the organisation layer', () => {
    const migration = readFileSync(fileURLToPath(new URL(
      '../../../../supabase/migrations/20261019000001_business_profile_capabilities.sql',
      import.meta.url,
    )), 'utf8');
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
    expect(migration).not.toMatch(/\b(?:journal_entries|journal_lines)\b/i);
  });

  it('K — organisation settings cannot exceed a subscription entitlement', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('inventory', pinnedExisting, {
      ...fullAccess,
      subscription: false,
    })).toBe(false);
  });

  it('L — organisation settings cannot exceed a partner feature flag', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('inventory', pinnedExisting, {
      ...fullAccess,
      partner: false,
    })).toBe(false);
  });

  it('O — a missing POS decision fails open, while an explicit false still narrows', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', undefined, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('pos', {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['SERVICE_SALES'],
    }, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('pos', {
      ...pinnedExisting,
      capability_overrides: { ...pinnedExisting.capability_overrides, pos: false },
    }, fullAccess)).toBe(false);
  });

  it('captures the profile during onboarding and forwards the appended RPC values', () => {
    const onboarding = readFileSync(fileURLToPath(new URL(
      '../../../../src/pages/CreateBusinessPage.tsx',
      import.meta.url,
    )), 'utf8');
    expect(onboarding).toContain('Organisation profile');
    expect(onboarding).toContain('Operating models');
    expect(onboarding).toContain('p_organisation_type: form.organisation_type');
    expect(onboarding).toContain('p_operating_models: form.operating_models');
  });

  it('derives the service-only profile without forcing POS or inventory', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const profile = {
      organisation_type: 'NON_PROFIT',
      operating_models: ['SERVICE_SALES'] as const,
    };
    expect(deriveOrganisationCapabilityDefaults(profile)).toEqual({
      sales: true,
      pos: false,
      inventory: false,
      services: true,
    });
    expect(resolveBusinessCapability('services', profile, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', profile, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('pos', profile, fullAccess)).toBe(false);
    expect(visiblePaths((capability) => capability !== 'inventory' && capability !== 'pos')).not.toContain('/products');
  });

  it('retains the pre-architecture navigation when the build-time rollback switch is off', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    const paths = visibleSectionsFor(() => true, 'owner')
      .flatMap((section) => section.items.map((item) => item.path));
    expect(resolveBusinessCapability('pos', {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['SERVICE_SALES'],
    }, fullAccess)).toBe(true);
    expect(paths).toContain('/pos');
    expect(paths).toContain('/products');
  });
});
