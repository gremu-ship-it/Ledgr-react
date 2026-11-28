// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function renderSidebar(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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
    expect(paths).not.toContain('/income');
    expect(paths).not.toContain('/invoices');
    expect(paths).not.toContain('/inventory');

    // Finance workspaces are collapsed accordions until the operator opens them.
    for (const parent of [
      'nav.patientBilling',
      'nav.staffPayroll',
      'nav.banking',
      'nav.generalLedger',
      'nav.taxation',
      'nav.clinicReports',
    ]) {
      expect(screen.getByRole('button', { name: parent })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'nav.banking' }));
    expect(linkPaths()).toEqual(expect.arrayContaining([
      '/banking',
      '/banking?tab=statements',
      '/banking?tab=reconcile',
      '/banking?tab=deposits',
      '/banking?tab=currencies',
    ]));
  });

  it('auto-expands a parent and highlights the exact tab child', () => {
    renderSidebar(['/payroll?tab=leave']);

    const parent = screen.getByRole('button', { name: 'nav.staffPayroll' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(parent.getAttribute('data-active')).toBe('true');
    const leave = screen.getByRole('link', { name: 'nav.sub.payroll_leave' });
    expect(leave.getAttribute('href')).toBe('/payroll?tab=leave');
    expect(leave.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'nav.sub.payroll_payruns' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps the accordion open after a tab redirect settles on its canonical route', () => {
    renderSidebar(['/payroll/leave']);

    const parent = screen.getByRole('button', { name: 'nav.staffPayroll' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(parent.getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('link', { name: 'nav.sub.payroll_leave' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'nav.sub.payroll_payruns' }).getAttribute('aria-current')).toBeNull();
  });

  it('highlights the exact report tab under Financial & Clinic Reports', () => {
    renderSidebar(['/reports?tab=pnl']);

    const parent = screen.getByRole('button', { name: 'nav.clinicReports' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(parent.getAttribute('data-active')).toBe('true');

    const pnl = screen.getByRole('link', { name: 'nav.sub.profitAndLoss' });
    expect(pnl.getAttribute('href')).toBe('/reports?tab=pnl');
    expect(pnl.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'nav.sub.trialBalance' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'nav.sub.balanceSheet' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps a deep-linked canonical child expanded and highlighted', () => {
    renderSidebar(['/banking?tab=deposits']);

    const parent = screen.getByRole('button', { name: 'nav.banking' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(parent.getAttribute('data-active')).toBe('true');
    const deposits = screen.getByRole('link', { name: 'nav.sub.banking_deposits' });
    expect(deposits.getAttribute('aria-current')).toBe('page');
  });

  it('expands a parent when a child is opened from the accordion', () => {
    renderSidebar();
    const parent = screen.getByRole('button', { name: 'nav.generalLedger' });
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(parent);
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'nav.sub.gl_journals' }).getAttribute('href')).toBe('/accounting?tab=journals');
    fireEvent.click(parent);
    expect(parent.getAttribute('aria-expanded')).toBe('false');
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
