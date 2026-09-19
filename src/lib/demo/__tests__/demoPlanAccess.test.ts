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
const GATED_CAPABILITIES: PlanCapability[] = ['inventory', 'core_accounting', 'accounting_organisation'];

beforeAll(async () => {
  await enterDemoMode();
});

afterAll(() => {
  exitDemoMode();
  clearDemoData();
  window.localStorage.clear();
});

/** The plan limit, narrowed for the arithmetic assertions below. */
function limitOf(stats: { limit: number | null }): number {
  if (stats.limit === null) throw new Error('the demo plan must have a transaction limit');
  return stats.limit;
}

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

    // ...and the count behind it must be real. The count issues count-only
    // head requests ({ count: 'exact', head: true }) against the document
    // tables; if the demo query builder ignored those options it would report
    // 0 and the usage meter would sit empty next to books full of
    // transactions. A transaction is one document (invoice / expense / payroll
    // run), so the demo month shows the seeded documents and leaves room under
    // the plan.
    expect(stats.currentMonth, 'count-only query returned nothing').toBeGreaterThan(0);
    expect(stats.limit).not.toBeNull();
    expect(stats.currentMonth).toBeLessThan(limitOf(stats));
    expect(stats.remaining).toBe(limitOf(stats) - stats.currentMonth);
    // The meter must not read as untouched in a month that has documents —
    // this is the assertion that catches a count that silently reports 0.
    expect(stats.percentUsed).toBeGreaterThan(0);
    expect(stats.percentUsed).toBeLessThan(100);
  });
});
