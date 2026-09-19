import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The plan guard runs before a document is written (POS commit, and the sync
 * engine's invoice / expense / payroll branches), which is what keeps a
 * limit breach from leaving a saved sale with no ledger entry behind.
 *
 * Two properties matter and are asserted here: the breach is refused whole,
 * and a *replay* of a document that already committed is not refused — its
 * key is looked up in the table that key was minted for, so a retry can always
 * finish a half-posted document.
 *
 * `@/lib/supabase` is a Proxy, so `vi.spyOn(supabase, 'from')` would not
 * intercept anything; the module is mocked instead.
 */

const state = vi.hoisted(() => ({
  plan: { tier: 'free' as string | null, error: null as unknown },
  /** `ledgr_monthly_document_count` answer; null data = "RPC unavailable". */
  rpc: { data: null as number | null, error: null as unknown },
  /** Row counts the fallback path reads per table. */
  counts: {} as Record<string, number>,
  countQueries: [] as string[],
}));

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  const planResult = () =>
    state.plan.error
      ? { data: null, error: state.plan.error }
      : { data: state.plan.tier ? { plan_tier: state.plan.tier } : null, error: null };

  /** `supabase.from(table)` — serves the plan lookup and the count queries. */
  const from = (table: string) => {
    const countResult = () => {
      state.countQueries.push(table);
      return { data: null, error: null, count: state.counts[table] ?? 0 };
    };
    const result = () => (table === 'businesses' ? planResult() : countResult());
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    });
    return chain;
  };

  return {
    ...actual,
    supabase: { from, rpc: async () => ({ data: state.rpc.data, error: state.rpc.error }) },
  };
});

const { UsageService } = await import('../UsageService');
const { repos } = await import('@/lib/repositories');
const { PLANS } = await import('../plans');

function serviceAtLimit(tier: keyof typeof PLANS = 'free') {
  const limit = PLANS[tier].transactionLimit;
  if (limit === null) throw new Error('pick a limited tier');
  state.plan.tier = tier;
  state.plan.error = null;

  const service = new UsageService();
  vi.spyOn(service, 'getCurrentMonthTransactionCount').mockResolvedValue(limit);
  return service;
}

afterEach(() => {
  vi.restoreAllMocks();
  state.plan = { tier: 'free', error: null };
  state.rpc = { data: null, error: null };
  state.counts = {};
  state.countQueries = [];
});

describe('UsageService.getCurrentMonthTransactionCount', () => {
  it('uses the server count, so RLS cannot change what the meter shows', async () => {
    // payroll_runs is not readable by every role; the server count is definer
    // rights, so it includes payroll runs the signed-in user cannot select.
    state.rpc = { data: 42, error: null };
    state.counts = { invoices: 100, expenses: 100, payroll_runs: 0 };

    const count = await new UsageService().getCurrentMonthTransactionCount('biz-1');

    expect(count).toBe(42);
    expect(state.countQueries).toEqual([]);
  });

  it('falls back to table counts when the RPC is not there yet', async () => {
    // A deploy that ships the client before migration 20260921000002.
    state.rpc = { data: null, error: { message: 'function does not exist' } };
    state.counts = { invoices: 2, expenses: 3, payroll_runs: 1 };

    const count = await new UsageService().getCurrentMonthTransactionCount('biz-1');

    expect(count).toBe(6);
    expect(state.countQueries.sort()).toEqual(['expenses', 'invoices', 'payroll_runs']);
  });

  it('falls back when the server answers NULL (caller is not a member)', async () => {
    state.rpc = { data: null, error: null };
    state.counts = { invoices: 1, expenses: 1, payroll_runs: 0 };

    expect(await new UsageService().getCurrentMonthTransactionCount('biz-1')).toBe(2);
  });
});

describe('UsageService.assertCanCreateDocument', () => {
  it('refuses a new document once the month is spent', async () => {
    const service = serviceAtLimit();
    const invoiceLookup = vi
      .spyOn(repos.invoice, 'findByClientKey')
      .mockResolvedValue(null as never);

    await expect(service.assertCanCreateDocument('biz-1', 'key-1')).rejects.toThrow(
      /Monthly transaction limit reached \(50\)/,
    );
    // The key was checked — and found nothing, so the save stayed refused.
    expect(invoiceLookup).toHaveBeenCalledWith('biz-1', 'key-1');
  });

  it('does not look for a replay when the caller has no key', async () => {
    const service = serviceAtLimit();
    const invoiceLookup = vi.spyOn(repos.invoice, 'findByClientKey');

    await expect(service.assertCanCreateDocument('biz-1')).rejects.toThrow(/limit reached/);
    expect(invoiceLookup).not.toHaveBeenCalled();
  });

  it('lets a replay of a committed invoice through the limit', async () => {
    const service = serviceAtLimit();
    vi.spyOn(repos.invoice, 'findByClientKey').mockResolvedValue({ id: 'inv-1' } as never);

    await expect(service.assertCanCreateDocument('biz-1', 'key-2')).resolves.toBeUndefined();
  });

  it('looks the replay up in the table its key belongs to', async () => {
    const service = serviceAtLimit('growth');
    const invoiceLookup = vi
      .spyOn(repos.invoice, 'findByClientKey')
      .mockResolvedValue(null as never);
    vi.spyOn(repos.expense, 'findByClientKey').mockResolvedValue({ id: 'exp-1' } as never);

    // An expense replay is recognised without consulting the invoices table...
    await expect(service.assertCanCreateDocument('biz-1', 'key-3', 'expense')).resolves.toBeUndefined();
    expect(invoiceLookup).not.toHaveBeenCalled();

    // ...while an invoice under the same key is not a replay at all.
    await expect(service.assertCanCreateDocument('biz-1', 'key-3')).rejects.toThrow(
      /Monthly transaction limit/,
    );
  });

  it('keeps the limit error when a replay lookup finds nothing', async () => {
    const service = serviceAtLimit();
    vi.spyOn(repos.invoice, 'findByClientKey').mockResolvedValue(null as never);

    await expect(service.assertCanCreateDocument('biz-1', 'key-6')).rejects.toThrow(
      /Monthly transaction limit/,
    );
  });

  it('fails open when the plan cannot be read', async () => {
    const service = new UsageService();
    vi.spyOn(service, 'getCurrentMonthTransactionCount').mockResolvedValue(999);
    state.plan = { tier: null, error: new Error('network is unreachable') };

    await expect(service.assertCanCreateDocument('biz-1', 'key-4')).resolves.toBeUndefined();
  });

  it('does not block an unlimited plan', async () => {
    const service = new UsageService();
    vi.spyOn(service, 'getCurrentMonthTransactionCount').mockResolvedValue(100_000);
    state.plan = { tier: 'enterprise', error: null };

    await expect(service.assertCanCreateDocument('biz-1', 'key-5')).resolves.toBeUndefined();
  });
});
