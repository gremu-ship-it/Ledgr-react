// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PlanGate } from '../PlanGate';
import { PartnerPlanGate } from '../PartnerPlanGate';
import type { PlanCapability, PlanTier } from '@/lib/billing/plans';

const state = vi.hoisted(() => ({ tier: 'free' as PlanTier, partnerEnabled: true }));
vi.mock('@/hooks/useUsage', () => ({ useUsage: () => ({ planTier: state.tier }) }));
vi.mock('@/partner/PartnerContext', () => ({
  usePartner: () => ({
    partner: { name: 'Test Partner' }, branding: { appName: 'Ledgr' }, loading: false,
    isFeatureEnabled: () => state.partnerEnabled,
  }),
}));
afterEach(() => { cleanup(); state.partnerEnabled = true; });

describe('subscription page gates', () => {
  it.each<[PlanTier, PlanCapability, boolean]>([
    ['free', 'inventory', false], ['free', 'core_accounting', false],
    ['starter', 'inventory', true], ['starter', 'core_accounting', true],
    ['starter', 'accounting_organisation', false], ['starter', 'bank_reconciliation', false],
    ['growth', 'inventory', true], ['growth', 'core_accounting', true],
    ['growth', 'accounting_organisation', true],
  ])('%s access to %s is %s', (tier, capability, allowed) => {
    state.tier = tier;
    render(<MemoryRouter><PlanGate capability={capability} featureName="Module"><div>Module content</div></PlanGate></MemoryRouter>);
    expect(screen.queryByText('Module content') !== null).toBe(allowed);
    expect(screen.queryByRole('link', { name: 'View plans' }) !== null).toBe(!allowed);
  });

  it('advertises Starter rather than Growth for Free inventory', () => {
    state.tier = 'free';
    render(<MemoryRouter><PartnerPlanGate featureKey="inventory" capability="inventory" featureName="Inventory"><div>Inventory content</div></PartnerPlanGate></MemoryRouter>);
    expect(screen.queryByText('Inventory content')).toBeNull();
    expect(screen.getByText('This feature is available on the Starter plan and above.')).toBeTruthy();
  });

  it('preserves partner restrictions even when Starter unlocks inventory', () => {
    state.tier = 'starter'; state.partnerEnabled = false;
    render(<MemoryRouter><PartnerPlanGate featureKey="inventory" capability="inventory" featureName="Inventory"><div>Inventory content</div></PartnerPlanGate></MemoryRouter>);
    expect(screen.queryByText('Inventory content')).toBeNull();
    expect(screen.getByText('Inventory isn’t part of your Ledgr package')).toBeTruthy();
  });

  it('retains Payroll under Finance for Free', () => {
    state.tier = 'free';
    render(<MemoryRouter><PartnerPlanGate featureKey="payroll" featureName="Payroll"><div>Payroll content</div></PartnerPlanGate></MemoryRouter>);
    expect(screen.getByText('Payroll content')).toBeTruthy();
  });
});
