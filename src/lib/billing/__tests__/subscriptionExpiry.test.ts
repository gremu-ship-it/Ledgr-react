import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeTermEnd, effectivePlanTier, isPlanExpired } from '../plans';

const source = (path: string) => readFileSync(resolve(__dirname, '../../../..', path), 'utf8');

/**
 * Regression cover for the 2026-10-01 report: "monthly subscription has not
 * ended even though this is a new month."
 */
describe('paid term length', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('ends a monthly term on the same day of the next calendar month, not 31 days later', () => {
    // The reported case: bought 1 Sep, still active on 1 Oct under the old
    // fixed 31-day window (it expired 2 Oct).
    expect(iso(computeTermEnd(new Date('2026-09-01T09:00:00Z'), 'monthly'))).toBe('2026-10-01');
    expect(iso(computeTermEnd(new Date('2026-09-15T09:00:00Z'), 'monthly'))).toBe('2026-10-15');
  });

  it('clamps month-end dates instead of rolling into the month after next', () => {
    expect(iso(computeTermEnd(new Date('2026-01-31T09:00:00Z'), 'monthly'))).toBe('2026-02-28');
    expect(iso(computeTermEnd(new Date('2028-01-31T09:00:00Z'), 'monthly'))).toBe('2028-02-29'); // leap year
    expect(iso(computeTermEnd(new Date('2026-08-31T09:00:00Z'), 'monthly'))).toBe('2026-09-30');
  });

  it('keeps the time of day so a term ends exactly when it started', () => {
    expect(computeTermEnd(new Date('2026-09-01T09:30:00Z'), 'monthly').toISOString())
      .toBe('2026-10-01T09:30:00.000Z');
  });

  it('ends an annual term on the same date next year, clamping 29 Feb', () => {
    expect(iso(computeTermEnd(new Date('2026-01-01T09:00:00Z'), 'annual'))).toBe('2027-01-01');
    expect(iso(computeTermEnd(new Date('2028-02-29T09:00:00Z'), 'annual'))).toBe('2029-02-28');
  });

  it('is the arithmetic the checkout function actually uses', () => {
    const checkout = source('supabase/functions/initiate-subscription-payment/index.ts');
    expect(checkout).toContain('computeTermEnd(new Date(), billingCycle)');
    // The old fixed-window maths must not come back.
    expect(checkout).not.toContain("billingCycle === 'annual' ? 365 : 31");
  });
});

describe('effective plan tier', () => {
  const now = new Date('2026-10-01T06:00:00Z');

  it('treats a lapsed paid plan as free, whatever the row still says', () => {
    expect(effectivePlanTier('pro', '2026-09-30T23:59:00Z', now)).toBe('free');
    expect(effectivePlanTier('starter', '2026-10-01T05:59:59Z', now)).toBe('free');
  });

  it('keeps a paid plan whose term is still running', () => {
    expect(effectivePlanTier('pro', '2026-10-02T00:00:00Z', now)).toBe('pro');
    expect(effectivePlanTier('growth', '2026-11-01T00:00:00Z', now)).toBe('growth');
  });

  it('never expires a plan with no end date (free, comped, lifetime)', () => {
    expect(effectivePlanTier('enterprise', null, now)).toBe('enterprise');
    expect(effectivePlanTier('free', null, now)).toBe('free');
    expect(isPlanExpired(null, now)).toBe(false);
    expect(isPlanExpired(undefined, now)).toBe(false);
  });

  it('fails open on an unreadable expiry rather than locking a paying customer out', () => {
    expect(effectivePlanTier('pro', 'not-a-date', now)).toBe('pro');
  });

  it('normalises unknown tiers to free', () => {
    expect(effectivePlanTier('platinum', null, now)).toBe('free');
    expect(effectivePlanTier(undefined, null, now)).toBe('free');
  });
});

describe('expiry is enforced without depending on the nightly job', () => {
  it('resolves client entitlements through the effective tier', () => {
    const useUsage = source('src/hooks/useUsage.ts');
    expect(useUsage).toContain('effectivePlanTier(source?.plan_tier, planExpiresAt)');

    const usageService = source('src/lib/billing/UsageService.ts');
    expect(usageService).toContain("select('plan_tier, plan_expires_at')");
    expect(usageService).toContain('effectivePlanTier(business.data.plan_tier, business.data.plan_expires_at)');
  });

  it('resolves the authoritative server quota through the effective tier too', () => {
    const sql = source('supabase/migrations/20261017000000_subscription_expiry_enforcement.sql');
    expect(sql).toContain('create or replace function public.effective_plan_tier');
    expect(sql).toContain('public.effective_plan_tier(coalesce(b.plan_tier, \'free\'), b.plan_expires_at)');
    // Back-fill for rows that lapsed while the cron job was dead.
    expect(sql).toContain("set plan_tier = 'free'");
  });

  it('deactivates any cron job left holding a deploy-time placeholder', () => {
    const sql = source('supabase/migrations/20261017000000_subscription_expiry_enforcement.sql');
    expect(sql).toContain('update cron.job set active = false');
  });

  it('runs the nightly expiry sweep as in-database SQL, with no URL to go stale', () => {
    const sql = source('supabase/migrations/20261017000000_subscription_expiry_enforcement.sql');
    expect(sql).toContain("cron.schedule(\n    'expire-subscriptions-daily'");
    // The scheduled command itself must be plain SQL — no URL, no secret.
    const job = sql.slice(sql.indexOf("'expire-subscriptions-daily',"));
    expect(job).not.toContain('PROJECT_REF');
    expect(job).not.toContain('net.http_post');
    expect(job).toContain('update public.businesses');
    // The HTTP variant must not be rescheduled under the same job name.
    expect(source('scripts/cron-jobs.sql')).not.toContain('functions/v1/expire-subscriptions');
  });

  it('substitutes and verifies cron placeholders on every deploy', () => {
    const deploy = source('.github/workflows/deploy.yml');
    expect(deploy.match(/bash scripts\/ci\/apply-cron-jobs\.sh/g)).toHaveLength(2); // staging + production
    const script = source('scripts/ci/apply-cron-jobs.sh');
    expect(script).toContain("command like '%<PROJECT_REF>%'");
  });
});

describe('manual (offline) grants keep working', () => {
  it('writes only values the CHECK constraints already allow', () => {
    const fn = source('supabase/functions/grant-manual-subscription/index.ts');
    expect(fn).toContain("billing_cycle: 'custom'");
    expect(fn).toContain("v === 'starter'");

    // 'custom' comes from 20260726000004, 'starter' from 20260919000000.
    expect(source('supabase/migrations/20260726000004_platform_admin_and_reminders.sql'))
      .toContain("check (billing_cycle in ('monthly', 'annual', 'custom'))");
    const starter = source('supabase/migrations/20260919000000_add_starter_plan.sql');
    expect(starter).toContain("check (target_plan_tier in ('starter', 'growth', 'pro', 'enterprise'))");
    expect(starter).toContain("check (plan_tier in ('free', 'starter', 'growth', 'pro', 'enterprise'))");
  });

  it('is untouched by this change beyond expiry resolution', () => {
    const fn = source('supabase/functions/grant-manual-subscription/index.ts');
    expect(fn).toContain('is_platform_admin');
    expect(fn).toContain("admin.rpc('apply_subscription_payment'");
    // Duration stays an explicit day count chosen by the admin — calendar
    // terms apply to self-serve checkout only.
    expect(fn).toContain('durationDays * 24 * 60 * 60 * 1000');
  });

  it('leaves an in-date grant fully entitled', () => {
    const now = new Date('2026-10-01T06:00:00Z');
    const grantedUntil = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(effectivePlanTier('enterprise', grantedUntil, now)).toBe('enterprise');
  });
});
