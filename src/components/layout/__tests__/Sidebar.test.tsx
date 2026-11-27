// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const state = vi.hoisted(() => ({
  models: ['HEALTHCARE'] as string[],
  planTier: 'enterprise',
  role: 'owner',
}));

vi.mock('@/store/useAppStore', () => {
  const store = {
    sidebarOpen: true,
    sidebarWidth: 256,
    setSidebarWidth: () => {},
    density: 'comfortable',
    toggleSidebar: () => {},
    setSidebarOpen: () => {},
    businesses: [],
    currentBusiness: {
      role: state.role,
      business: {
        id: '10000000-0000-0000-0000-000000000001',
        name: 'Blantyre Clinic',
        base_currency: 'MWK',
        plan_tier: state.planTier,
        operating_models: state.models,
      },
    },
  };
  return {
    useAppStore: (selector: (value: typeof store) => unknown) => selector(store),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useUsage', () => ({
  useUsage: () => ({ planTier: state.planTier }),
}));

vi.mock('@/hooks/useBrandTheme', () => ({
  useBrandTheme: () => ({ logoUrl: null, businessName: 'Blantyre Clinic' }),
}));

vi.mock('@/partner/PartnerContext', () => ({
  usePartner: () => ({ isFeatureEnabled: () => true }),
}));

vi.mock('@/hooks/useCapability', () => ({
  useOrganisationCapabilityVisibility: () => () => true,
}));

vi.mock('@/hooks/useIsPlatformAdmin', () => ({
  useIsPlatformAdmin: () => false,
}));

vi.mock('@/lib/notifications', () => ({
  pushUpgradeRequired: () => {},
}));

import { Sidebar } from '../Sidebar';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

function linkPaths(): string[] {
  return screen
    .getAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '');
}

function setModels(models: string[]) {
  state.models.splice(0, state.models.length, ...models);
}

afterEach(() => {
  cleanup();
  setModels(['HEALTHCARE']);
  state.planTier = 'enterprise';
  state.role = 'owner';
});

describe('healthcare sidebar', () => {
  it('renders the five clinical groups and suppresses generic trading modules', () => {
    renderSidebar();

    for (const title of [
      'nav.sections.clinicalOperations',
      'nav.sections.billingAndClaims',
      'nav.sections.clinicFinancials',
      'nav.sections.complianceAndAccounting',
      'nav.sections.intelligenceAndSupport',
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }

    const paths = linkPaths();
    expect(paths).toContain('/healthcare');
    expect(paths).toContain('/healthcare/pharmacy');
    expect(paths).toContain('/healthcare/lab');
    expect(paths).toContain('/banking');
    expect(paths).toContain('/taxation');
    expect(paths).not.toContain('/income');
    expect(paths).not.toContain('/invoices');
    expect(paths).not.toContain('/inventory');
  });

  it('shows the contextual clinical labels', () => {
    renderSidebar();
    expect(screen.getByText('nav.clinicExpenses')).toBeTruthy();
    expect(screen.getByText('nav.medicalEquipment')).toBeTruthy();
    expect(screen.getByText('nav.complianceAudit')).toBeTruthy();
    expect(screen.getByText('nav.clinicalDepartments')).toBeTruthy();
  });

  it('keeps generic inventory for a healthcare + retail hybrid', () => {
    setModels(['HEALTHCARE', 'RETAIL']);
    renderSidebar();

    const paths = linkPaths();
    expect(paths).toContain('/healthcare/pharmacy');
    expect(paths).toContain('/inventory');
    expect(paths).not.toContain('/income');
  });

  it('points the top-left brand at the clinical landing page', () => {
    renderSidebar();
    const brand = screen.getByRole('link', { name: 'Blantyre Clinic' });
    expect(brand.getAttribute('href')).toBe('/healthcare');
  });

  it('keeps the legacy capability-aware sidebar outside enterprise healthcare', () => {
    state.planTier = 'growth';
    renderSidebar();

    const paths = linkPaths();
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/income');
    expect(screen.queryByText('nav.sections.clinicalOperations')).toBeNull();
  });
});
