import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLANS, PLAN_TIER_ORDER, computePriceMWK, hasCapability, normalizePlanTier, planRequiredFor } from '../plans';
import { UsageService } from '../UsageService';
import { NAV_SECTIONS, isItemLocked, navItemForPath, planMeetsMin, planRequiredForItem } from '@/components/layout/navConfig';

const source = (path: string) => readFileSync(resolve(__dirname, '../../../..', path), 'utf8');

afterEach(() => vi.restoreAllMocks());

describe('Starter pricing and access', () => {
  it('adds a 200-transaction tier between Free and Growth for MK 50,000/month', () => {
    expect(PLAN_TIER_ORDER).toEqual(['free', 'starter', 'growth', 'pro', 'enterprise']);
    expect(normalizePlanTier('starter')).toBe('starter');
    expect(normalizePlanTier('unknown')).toBe('free');
    expect(PLANS.starter.transactionLimit).toBe(200);
    expect(computePriceMWK('starter', 'monthly')).toBe(50_000);
    // No annual discount was specified for the new tier.
    expect(computePriceMWK('starter', 'annual')).toBe(600_000);
    expect(planMeetsMin('starter', 'free')).toBe(true);
    expect(planMeetsMin('starter', 'growth')).toBe(false);
    expect(planMeetsMin('growth', 'starter')).toBe(true);
  });

  it('keeps all capabilities cumulative without changing existing limits or prices', () => {
    PLAN_TIER_ORDER.slice(1).forEach((tier, index) => {
      for (const capability of PLANS[PLAN_TIER_ORDER[index]].capabilities) {
        expect(hasCapability(tier, capability)).toBe(true);
      }
    });
    expect(['free', 'growth', 'pro', 'enterprise'].map((tier) => {
      const plan = PLANS[normalizePlanTier(tier)];
      return [plan.priceMWK, plan.transactionLimit];
    })).toEqual([[0, 50], [100000, 500], [200000, 2000], [500000, null]]);
  });

  it('leaves Finance unlocked for Free and locks all other business-module navigation', () => {
    for (const section of NAV_SECTIONS) {
      const available = ['overview', 'finance', 'support'].some((name) => section.labelKey.endsWith(`.${name}`));
      for (const item of section.items) {
        expect(isItemLocked(item, 'free'), item.path).toBe(!available);
      }
    }
  });

  it.each(['/products', '/inventory', '/warehouse', '/transfers', '/accounts', '/tax', '/assets', '/capital', '/reports'])(
    'unlocks %s starting at Starter', (path) => {
      const item = navItemForPath(path)!;
      expect(item).toBeDefined();
      expect(isItemLocked(item, 'free')).toBe(true);
      expect(isItemLocked(item, 'starter')).toBe(false);
      expect(planRequiredForItem(item)?.tier).toBe('starter');
    },
  );

  it.each(['/journals', '/periods', '/audit', '/bank-reconcile', '/contacts', '/branches', '/departments', '/ai'])(
    'keeps %s on its existing higher tier', (path) => {
      expect(isItemLocked(navItemForPath(path)!, 'starter')).toBe(true);
    },
  );

  it('recommends the cheapest eligible tier for locked features', () => {
    expect(planRequiredFor('inventory')?.tier).toBe('starter');
    expect(planRequiredFor('core_accounting')?.tier).toBe('starter');
    expect(planRequiredFor('accounting_organisation')?.tier).toBe('growth');
    expect(planRequiredFor('bank_reconciliation')?.tier).toBe('growth');
    expect(planRequiredFor('ai_insights')?.tier).toBe('pro');
  });

  it.each([
    [199, true, 1], [200, false, 0], [201, false, 0], [0, true, 200],
  ])('enforces Starter usage at %i transactions', async (count, canCreate, remaining) => {
    const service = new UsageService();
    vi.spyOn(service, 'getCurrentMonthUsage').mockResolvedValue(Number(count));
    const stats = await service.getUsageStats('business-id', 'starter');
    expect(stats).toMatchObject({ limit: 200, canCreate, remaining, isUnlimited: false });
  });
});

describe('plan catalogue integration parity', () => {
  it('keeps the public website prices, limits and new features in sync', () => {
    const website = source('website/src/data/pricing.ts');
    expect([...website.matchAll(/tier: '([^']+)',/g)].map((match) => match[1])).toEqual(PLAN_TIER_ORDER);
    for (const tier of PLAN_TIER_ORDER) {
      const block = website.split(`tier: '${tier}',`)[1].split('\n  },')[0];
      const plan = PLANS[tier];
      expect(block).toContain(`name: '${plan.name}'`);
      for (const field of ['priceMWK', 'annualDiscount', 'transactionLimit'] as const) {
        const value = block.match(new RegExp(`${field}: ([\\d_]+|null)`))?.[1].replaceAll('_', '');
        expect(value, `${tier}.${field}`).toBe(String(plan[field]));
      }
      if (tier === 'free' || tier === 'starter') {
        for (const feature of plan.features) expect(block).toContain(`'${feature}'`);
      }
    }
  });

  it('accepts Starter for checkout and manual activation and prices it server-side', () => {
    const checkout = source('supabase/functions/initiate-subscription-payment/index.ts');
    expect(checkout).toContain('starter: 50_000');
    expect(checkout).toContain('starter: 0');
    for (const name of ['initiate-subscription-payment', 'grant-manual-subscription']) {
      expect(source(`supabase/functions/${name}/index.ts`)).toContain("v === 'starter'");
    }
  });

  it('migrates persisted tiers, upgrade ranks and the quick-save usage guard', () => {
    const sql = source('supabase/migrations/20260919000000_add_starter_plan.sql');
    expect(sql).toContain("check (plan_tier in ('free', 'starter', 'growth', 'pro', 'enterprise'))");
    expect(sql).toContain("check (target_plan_tier in ('starter', 'growth', 'pro', 'enterprise'))");
    PLAN_TIER_ORDER.forEach((tier, index) => {
      expect(sql).toContain(`when '${tier}' then ${index}`);
    });
    const usage = sql.slice(sql.indexOf('function public._ledgr_assert_usage_limit'));
    for (const tier of PLAN_TIER_ORDER) {
      expect(usage).toContain(`when '${tier}' then ${PLANS[tier].transactionLimit}`);
    }
    expect(usage).toContain('if v_usage >= v_limit then');
    expect(usage).toContain('security definer');
    expect(usage).toContain('set search_path = public');
  });

  it('gates all inventory URLs and precisely the five core-accounting pages', () => {
    const app = source('src/App.tsx');
    expect(app.match(/featureKey="inventory" capability="inventory"/g)).toHaveLength(4);
    for (const name of ['Chart of Accounts', 'Tax', 'Assets', 'Capital', 'Reports']) {
      expect(app).toContain(`capability="core_accounting" featureName="${name}"`);
    }
    for (const name of ['Journals', 'Period Management', 'Audit Log', 'Contacts', 'Branches', 'Departments']) {
      expect(app).toContain(`capability="accounting_organisation" featureName="${name}"`);
    }
    expect(app).toContain('<PartnerPlanGate featureKey="payroll" featureName="Payroll">');
  });
});
