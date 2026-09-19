// @vitest-environment jsdom
//
// The mobile bottom bar is the primary navigation for till staff: a cashier's
// home route is /pos and the sidebar is behind a drawer. Two regressions are
// covered here:
//
//   1. Role-restricted tabs. Before, the bar rendered the same tabs for every
//      role, so a cashier tapping Dashboard/Products/Reports was bounced
//      straight back to /pos by RoleRoute.
//   2. No POS entry at all — till staff had no one-tap route back to the till.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const state = vi.hoisted(() => ({
  role: 'owner' as string | null,
  hasBusiness: true,
  inventoryEnabled: true,
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentBusiness: state.hasBusiness
        ? { business: { id: 'biz-1' }, role: state.role }
        : null,
      theme: 'light',
      toggleTheme: () => {},
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useUsage', () => ({
  useUsage: () => ({ planTier: 'growth' }),
}));

vi.mock('@/partner/PartnerContext', () => ({
  usePartner: () => ({
    partner: null,
    branding: { appName: 'Ledgr' },
    loading: false,
    isFeatureEnabled: () => state.inventoryEnabled,
  }),
}));

vi.mock('@/lib/notifications', () => ({ pushUpgradeRequired: () => {} }));

// The quick-entry sheets pull in repositories and Supabase; irrelevant here.
vi.mock('@/components/mobile/QuickExpenseMobile', () => ({
  QuickExpenseMobile: () => null,
}));
vi.mock('@/components/mobile/QuickIncomeMobile', () => ({
  QuickIncomeMobile: () => null,
}));

import { BottomNav } from '../BottomNav';

function tabPaths(): string[] {
  return screen
    .getAllByRole('link')
    .map((el) => el.getAttribute('href') || '');
}

function renderNav() {
  return render(
    <MemoryRouter>
      <BottomNav />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  state.role = 'owner';
  state.hasBusiness = true;
  state.inventoryEnabled = true;
});

describe('mobile bottom navigation', () => {
  it('shows the full workspace set for an owner, still capped at four tabs', () => {
    state.role = 'owner';
    renderNav();
    const paths = tabPaths();
    expect(paths).toEqual(['/dashboard', '/income', '/products', '/reports']);
  });

  it('gives a cashier a POS tab and hides back-office tabs', () => {
    state.role = 'cashier';
    renderNav();
    const paths = tabPaths();

    expect(paths[0]).toBe('/pos');
    expect(paths).toContain('/income');
    expect(paths).not.toContain('/dashboard');
    expect(paths).not.toContain('/products');
    expect(paths).not.toContain('/reports');
  });

  it('leads a POS manager with the till, then its supervised pages', () => {
    state.role = 'manager';
    renderNav();
    const paths = tabPaths();

    expect(paths).toEqual(['/pos', '/dashboard', '/income', '/products']);
  });

  it('keeps a stock clerk off the till and on stock', () => {
    state.role = 'stock_clerk';
    renderNav();
    const paths = tabPaths();

    expect(paths).toEqual(['/products']);
    expect(paths).not.toContain('/pos');
  });

  it('surfaces warehouse and transfers in the More menu for stock roles', () => {
    state.role = 'stock_clerk';
    renderNav();

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }));
    const paths = tabPaths();

    expect(paths).toContain('/warehouse');
    expect(paths).toContain('/transfers');
    // Settings is an owner/admin surface for a stock clerk.
    expect(paths).not.toContain('/settings');
  });

  it('offers a cashier the till-safe quick actions only', () => {
    state.role = 'cashier';
    renderNav();

    fireEvent.click(screen.getByRole('button', { name: 'common.openAddMenu' }));

    // Income is on the cashier's route list; expenses (closed to cashiers at
    // the database level by 20260922000000_pos_role_write_scope) and stock
    // movements are not.
    expect(screen.getByText('New invoice')).toBeTruthy();
    expect(screen.getByText('common.recordIncome')).toBeTruthy();
    expect(screen.queryByText('common.recordExpense')).toBeNull();
    expect(screen.queryByText('Stock movement')).toBeNull();
  });

  it('hides the quick-entry button entirely for a read-only role', () => {
    state.role = 'viewer';
    renderNav();
    expect(screen.queryByRole('button', { name: 'common.openAddMenu' })).toBeNull();
  });

  it('falls back to the unfiltered list before the role has loaded', () => {
    state.hasBusiness = false;
    renderNav();
    expect(tabPaths()).toEqual(['/dashboard', '/income', '/products', '/reports']);
  });
});
