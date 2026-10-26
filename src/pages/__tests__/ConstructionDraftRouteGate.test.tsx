// @vitest-environment jsdom
//
// Bug B regression tests: /projects-funding-sources/construction-draft was
// the only construction surface reachable without the construction
// capability — any authenticated user could open it by URL. It now sits
// behind the same CapabilityGate as /construction/*.
//
// The gate is exercised through the real capability chain (organisation
// profile → resolveCapability) exactly as App.tsx composes it, and the
// App.tsx wiring itself is asserted at source level, the same pattern
// constructionWorkspaceNavigation.test.ts uses for the nav config.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/hooks/useUsage', () => ({
  useUsage: () => ({ planTier: 'enterprise' }),
}));

vi.mock('@/partner/PartnerContext', () => ({
  usePartner: () => ({
    partner: null,
    branding: { appName: 'Ledgr' },
    loading: false,
    isFeatureEnabled: () => true,
  }),
}));

import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { ConstructionProjectSetupDraftPage } from '@/pages/ConstructionProjectSetupDraftPage';
import { useAppStore } from '@/store/useAppStore';

const fetchMock = vi.fn();

/** Exactly the route element App.tsx renders for the draft path. */
const GATED_ROUTE = (
  <MemoryRouter>
    <CapabilityGate capability="construction">
      <ConstructionProjectSetupDraftPage />
    </CapabilityGate>
  </MemoryRouter>
);

function selectBusiness(operatingModels: string[]) {
  useAppStore.setState({
    currentBusiness: {
      role: 'owner',
      business: {
        id: '10000000-0000-0000-0000-000000000001',
        name: 'Chirwa Build',
        base_currency: 'MWK',
        organisation_type: 'FOR_PROFIT',
        operating_models: operatingModels,
      },
    } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('construction draft route gate', () => {
  it('App.tsx wraps /projects-funding-sources/construction-draft in the construction CapabilityGate', () => {
    // jsdom's import.meta.url is not a file: URL, so resolve from the
    // vitest working directory (the repo root) instead.
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toMatch(
      /path="\/projects-funding-sources\/construction-draft"\s*element=\{\s*<CapabilityGate capability="construction">/,
    );
    // Same gate component, same capability as the real workspace route.
    const gateCount = app.match(/<CapabilityGate capability="construction">/g)?.length ?? 0;
    expect(gateCount).toBeGreaterThanOrEqual(2);
  });

  it('shows the draft workspace to a construction business', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    selectBusiness(['CONSTRUCTION']);
    render(GATED_ROUTE);
    expect(screen.getByRole('heading', { name: 'Construction workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create project draft' })).toBeTruthy();
  });

  it('blocks a retail business that opens the draft URL directly', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    selectBusiness(['RETAIL']);
    render(GATED_ROUTE);
    expect(screen.getByText('Construction isn’t enabled for this business')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Construction workspace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create project draft' })).toBeNull();
  });

  it('blocks a service business too', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    selectBusiness(['SERVICE_SALES']);
    render(GATED_ROUTE);
    expect(screen.getByText('Construction isn’t enabled for this business')).toBeTruthy();
  });

  it('keeps gating construction by profile even with the kill switch off', () => {
    // Construction is ALWAYS_PROFILE_GATED: the capability resolves from the
    // profile whether or not the organisation layer is enabled, so the gate
    // must bite (and only bite) on the profile in both switch states.
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    selectBusiness(['SERVICE_SALES']);
    const { unmount } = render(GATED_ROUTE);
    expect(screen.getByText('Construction isn’t enabled for this business')).toBeTruthy();
    unmount();

    selectBusiness(['CONSTRUCTION']);
    render(GATED_ROUTE);
    expect(screen.getByRole('heading', { name: 'Construction workspace' })).toBeTruthy();
  });
});
