/**
 * Tests for the exchange-rate resolution cascade in ExchangeRateService.getRate:
 *
 *   1. Same currency            -> identity rate, never touches DB or network
 *   2. Exact cached rate        -> fresh, from the cache
 *   3. Frankfurter-routable     -> live fetch, then cached (unique per date)
 *   4. Frankfurter down         -> most recent cached rate, flagged stale
 *   5. Non-routable (touches MWK/ZMW/TZS/MZN/KES/UGX)
 *                               -> most recent cached rate, flagged stale,
 *                                  or a manual-entry prompt when nothing cached
 *
 * What this protects: the fallback chain that keeps invoice/expense saving
 * alive during an ECB API outage without silently pricing MWK transactions
 * from a hard-coded rate. Both the "cache only if that date is new" rule
 * (IAS 21: historical rates are never recalculated) and the stale flag that
 * lands on journal lines (rate_is_stale) are asserted here.
 *
 * The Frankfurter HTTP client is mocked at the module boundary; the
 * currencies/exchange_rates tables run against the shared filterable stub,
 * so findExact/findMostRecentBefore filtering executes for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { stubSupabaseClient } from '@/test-utils/supabaseStub';

vi.mock('../frankfurterClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../frankfurterClient')>();
  return {
    ...original,
    fetchLatestRate: vi.fn(),
    fetchHistoricalRate: vi.fn(),
  };
});

import { fetchLatestRate, fetchHistoricalRate, FrankfurterApiError } from '../frankfurterClient';
import { ExchangeRateService } from '../exchangeRateService';

const BIZ = 'biz-1';
const TODAY = new Date().toISOString().slice(0, 10);

const CURRENCIES = [
  { code: 'MWK', is_frankfurter_supported: false },
  { code: 'USD', is_frankfurter_supported: true },
  { code: 'EUR', is_frankfurter_supported: true },
];

function makeService(rates: Array<Record<string, unknown>> = []) {
  const { client, inserts } = stubSupabaseClient({ currencies: CURRENCIES, exchange_rates: rates });
  const service = new ExchangeRateService(client as unknown as SupabaseClient<Database>);
  return { service, inserts };
}

function cachedRate(from: string, to: string, rate: number, rateDate: string, source = 'manual') {
  return { business_id: BIZ, from_currency: from, to_currency: to, rate, rate_date: rateDate, source };
}

beforeEach(() => {
  vi.mocked(fetchLatestRate).mockReset();
  vi.mocked(fetchHistoricalRate).mockReset();
});

describe('getRate — identity and exact cache', () => {
  it('returns the identity rate for a same-currency pair without I/O', async () => {
    const { service } = makeService();
    const result = await service.getRate(BIZ, 'MWK', 'MWK', '2026-01-15');
    expect(result).toEqual({ rate: 1, rateDate: '2026-01-15', isStale: false, source: 'identity' });
    expect(fetchLatestRate).not.toHaveBeenCalled();
    expect(fetchHistoricalRate).not.toHaveBeenCalled();
  });

  it('prefers an exact cached rate — no Frankfurter call, not stale', async () => {
    const { service, inserts } = makeService([cachedRate('USD', 'MWK', 825.5, '2026-01-15')]);
    const result = await service.getRate(BIZ, 'USD', 'MWK', '2026-01-15');
    expect(result).toEqual({ rate: 825.5, rateDate: '2026-01-15', isStale: false, source: 'manual' });
    expect(fetchLatestRate).not.toHaveBeenCalled();
    expect(inserts.exchange_rates).toHaveLength(0);
  });
});

describe('getRate — Frankfurter-routable pairs', () => {
  it("fetches today's rate live and caches it", async () => {
    vi.mocked(fetchLatestRate).mockResolvedValue({ rate: 1.0912, rateDate: TODAY });
    const { service, inserts } = makeService();

    const result = await service.getRate(BIZ, 'USD', 'EUR', TODAY);
    expect(result).toEqual({ rate: 1.0912, rateDate: TODAY, isStale: false, source: 'frankfurter' });
    expect(fetchLatestRate).toHaveBeenCalledWith('USD', 'EUR');
    expect(fetchHistoricalRate).not.toHaveBeenCalled();
    expect(inserts.exchange_rates).toHaveLength(1);
    expect(inserts.exchange_rates[0]).toMatchObject({
      from_currency: 'USD', to_currency: 'EUR', rate: 1.0912, rate_date: TODAY, source: 'frankfurter',
    });
  });

  it('fetches a historical rate for a past date', async () => {
    vi.mocked(fetchHistoricalRate).mockResolvedValue({ rate: 1.0755, rateDate: '2026-01-15' });
    const { service, inserts } = makeService();

    const result = await service.getRate(BIZ, 'USD', 'EUR', '2026-01-15');
    expect(result).toMatchObject({ rate: 1.0755, rateDate: '2026-01-15', isStale: false });
    expect(fetchHistoricalRate).toHaveBeenCalledWith('USD', 'EUR', '2026-01-15');
    expect(fetchLatestRate).not.toHaveBeenCalled();
    expect(inserts.exchange_rates).toHaveLength(1);
  });

  it('never overwrites a rate row for a date that is already cached', async () => {
    // Frankfurter settles today's request on yesterday's date (weekend
    // request, Friday's fix) and that date is already on file.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    vi.mocked(fetchLatestRate).mockResolvedValue({ rate: 1.08, rateDate: yesterday });
    const { service, inserts } = makeService([cachedRate('USD', 'EUR', 1.085, yesterday, 'frankfurter')]);

    const result = await service.getRate(BIZ, 'USD', 'EUR', TODAY);
    expect(result).toMatchObject({ rate: 1.08, rateDate: yesterday, isStale: false });
    expect(inserts.exchange_rates).toHaveLength(0);
  });

  it('falls back to the most recent cached rate (stale) when Frankfurter is down', async () => {
    vi.mocked(fetchHistoricalRate).mockRejectedValue(new FrankfurterApiError('HTTP 503', 503));
    const { service } = makeService([
      cachedRate('USD', 'EUR', 1.072, '2026-01-10', 'frankfurter'),
      cachedRate('USD', 'EUR', 1.075, '2026-01-14', 'frankfurter'),
    ]);

    const result = await service.getRate(BIZ, 'USD', 'EUR', '2026-01-15');
    expect(result).toEqual({ rate: 1.075, rateDate: '2026-01-14', isStale: true, source: 'frankfurter' });
  });

  it('rethrows unexpected (non-API) errors from the fetch', async () => {
    vi.mocked(fetchHistoricalRate).mockRejectedValue(new TypeError('Failed to fetch'));
    const { service } = makeService([cachedRate('USD', 'EUR', 1.072, '2026-01-10')]);
    await expect(service.getRate(BIZ, 'USD', 'EUR', '2026-01-15')).rejects.toThrow(TypeError);
  });
});

describe('getRate — pairs touching MWK (manual-rate territory)', () => {
  it('uses the most recent cached rate and flags it stale', async () => {
    const { service } = makeService([
      cachedRate('USD', 'MWK', 810, '2026-01-05'),
      cachedRate('USD', 'MWK', 818.25, '2026-01-12'),
    ]);

    const result = await service.getRate(BIZ, 'USD', 'MWK', '2026-01-15');
    expect(result).toEqual({ rate: 818.25, rateDate: '2026-01-12', isStale: true, source: 'manual' });
    // Frankfurter must never be called for an unroutable pair.
    expect(fetchLatestRate).not.toHaveBeenCalled();
    expect(fetchHistoricalRate).not.toHaveBeenCalled();
  });

  it('throws a manual-entry prompt when no rate is cached at all', async () => {
    const { service } = makeService();
    await expect(service.getRate(BIZ, 'USD', 'MWK', '2026-01-15'))
      .rejects.toThrow(/enter a rate manually/i);
  });
});

describe('recordManualRate', () => {
  it('records a manual rate, preserving the user attribution', async () => {
    const { service, inserts } = makeService();
    const recorded = await service.recordManualRate(BIZ, 'USD', 'MWK', 830, '2026-01-15', 'user-9');
    expect(recorded).toMatchObject({ rate: 830, source: 'manual', created_by: 'user-9' });
    expect(inserts.exchange_rates).toHaveLength(1);
  });

  it('never overwrites an existing rate for the same pair and date', async () => {
    const existing = cachedRate('USD', 'MWK', 825.5, '2026-01-15');
    const { service, inserts } = makeService([existing]);
    const recorded = await service.recordManualRate(BIZ, 'USD', 'MWK', 999, '2026-01-15', 'user-9');
    expect(recorded).toMatchObject({ rate: 825.5 });
    expect(inserts.exchange_rates).toHaveLength(0);
  });
});
