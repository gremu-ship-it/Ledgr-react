// @vitest-environment jsdom
/**
 * Can a demo visitor actually use the product?
 *
 * The demo business is seeded on a specific plan tier, and the app gates whole
 * modules on that tier (PlanGate) as well as on a monthly transaction count
 * (UsageService). If the seeded tier lacked a capability, a prospect clicking
 * through from the landing page would meet an upgrade wall on Reports,
 * Journals, Tax or the Chart of Accounts — the core of the product. If the
 * seeded month exceeded the tier's transaction limit, every "new" button would
 * be disabled instead.
 *
 * Neither is visible in the dataset tests, which check the books balance
 * rather than what the UI will let you do with them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageService } from '@/lib/billing/UsageService';
import { hasCapability, type PlanCapability } from '@/lib/billing/plans';
import { enterDemoMode, exitDemoMode } from '@/lib/demo/session';
import { clearDemoData } from '@/lib/demo/store';
import { DEMO_BUSINESS_ID, DEMO_PLAN_TIER } from '@/lib/demo/constants';

/**
 * Every capability App.tsx wraps a route in. Keep in step with the PlanGate
 * usages there — a new gated module must be reachable in the demo too.
 */
const GATED_CAPABILITIES: PlanCapability[] = ['accounting_organisation'];

beforeAll(async () => {
  await enterDemoMode();
});

afterAll(() => {
  exitDemoMode();
  clearDemoData();
  window.localStorage.clear();
});

describe('demo plan access', () => {
  it('unlocks every gated module', () => {
    for (const capability of GATED_CAPABILITIES) {
      expect(hasCapability(DEMO_PLAN_TIER, capability), `${DEMO_PLAN_TIER} lacks ${capability}`).toBe(true);
    }
  });

  it('leaves transaction creation enabled for the seeded month', async () => {
    const stats = await usageService.getUsageStats(DEMO_BUSINESS_ID, DEMO_PLAN_TIER);

    // The head that matters: a prospect must be able to create records.
    expect(stats.canCreate, `usage ${stats.currentMonth}/${String(stats.limit)} blocks creation`).toBe(true);

    // ...and the count behind it must be real. getCurrentMonthUsage issues a
    // count-only head request ({ count: 'exact', head: true }); if the demo
    // query builder ignored those options it would report 0 and the usage
    // meter would sit empty next to books full of transactions.
    expect(stats.currentMonth, 'count-only query returned nothing').toBeGreaterThan(0);
    expect(stats.limit).not.toBeNull();
    expect(stats.percentUsed).toBeGreaterThan(0);
    expect(stats.percentUsed).toBeLessThan(100);
  });
});
