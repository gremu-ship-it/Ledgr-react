import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../dal/types/database';
import { ExchangeRateRepository } from '../dal/repositories/ExchangeRateRepository';
import { fetchLatestRate, fetchHistoricalRate, FrankfurterApiError } from './frankfurterClient';
import { toRepositoryError } from '../dal/errors/RepositoryError';

export interface RateResult {
  rate: number;
  rateDate: string;
  isStale: boolean;
  source: 'frankfurter' | 'manual' | 'identity';
}

export class ExchangeRateService {
  private rates: ExchangeRateRepository;
  private client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
    this.rates = new ExchangeRateRepository(client);
  }

  /**
   * Check whether both currencies in a pair are Frankfurter-supported.
   * Frankfurter has zero data for MWK/ZMW/TZS/MZN/KES/UGX on either side
   * of any pair — this must be checked before ever calling the API client.
   */
  private async isFrankfurterRoutable(fromCurrency: string, toCurrency: string): Promise<boolean> {
    if (fromCurrency === toCurrency) return false; // identity, no API call needed
    const { data, error } = await this.client
      .from('currencies')
      .select('code, is_frankfurter_supported')
      .in('code', [fromCurrency, toCurrency]);

    if (error) throw toRepositoryError('currencies', error);
    if (!data || data.length !== 2) return false;
    return data.every((c) => c.is_frankfurter_supported);
  }

  /**
   * The main entry point for every transaction form (invoice, expense,
   * journal entry). Resolution order:
   *
   *   1. Same currency -> rate = 1, not stale.
   *   2. Exact cached rate for this business/pair/date -> use it, not stale.
   *   3. Pair is Frankfurter-routable -> fetch live, cache it, not stale.
   *      (Historical date -> fetchHistoricalRate; today -> fetchLatestRate.)
   *   4. Pair is NOT Frankfurter-routable (touches MWK/ZMW/TZS/MZN/KES/UGX)
   *      -> fall back to the most recent cached rate for this pair, flagged
   *      stale. If nothing is cached at all, throws — caller must prompt
   *      the user for manual entry (see recordManualRate).
   *
   * Per spec: never blocks a transaction save on a Frankfurter outage —
   * falls back to last cached rate + rate_is_stale = true instead.
   */
  async getRate(
    businessId: string,
    fromCurrency: string,
    toCurrency: string,
    date: string, // YYYY-MM-DD, the transaction date
  ): Promise<RateResult> {
    if (fromCurrency === toCurrency) {
      return { rate: 1, rateDate: date, isStale: false, source: 'identity' };
    }

    const exact = await this.rates.findExact(businessId, fromCurrency, toCurrency, date);
    if (exact) {
      return { rate: Number(exact.rate), rateDate: exact.rate_date, isStale: false, source: exact.source as 'frankfurter' | 'manual' };
    }

    const routable = await this.isFrankfurterRoutable(fromCurrency, toCurrency);

    if (routable) {
      try {
        const isToday = date === new Date().toISOString().slice(0, 10);
        const { rate, rateDate } = isToday
          ? await fetchLatestRate(fromCurrency, toCurrency)
          : await fetchHistoricalRate(fromCurrency, toCurrency, date);

        // Cache it — never overwrite an existing rate_date row (unique
        // constraint enforces this at the DB level too).
        const existing = await this.rates.findExact(businessId, fromCurrency, toCurrency, rateDate);
        if (!existing) {
          await this.rates.recordRate({
            business_id: businessId,
            from_currency: fromCurrency,
            to_currency: toCurrency,
            rate,
            rate_date: rateDate,
            source: 'frankfurter',
          } as InsertDto<'exchange_rates'>);
        }

        return { rate, rateDate, isStale: false, source: 'frankfurter' };
      } catch (err) {
        if (err instanceof FrankfurterApiError) {
          // API unreachable/erroring — fall through to stale-cache fallback
          // below rather than blocking the transaction save.
        } else {
          throw err;
        }
      }
    }

    // Not routable via Frankfurter (touches MWK/ZMW/TZS/MZN/KES/UGX), or
    // Frankfurter call failed above — fall back to most recent cached rate.
    const fallback = await this.rates.findMostRecentBefore(businessId, fromCurrency, toCurrency, date);
    if (fallback) {
      return { rate: Number(fallback.rate), rateDate: fallback.rate_date, isStale: true, source: fallback.source as 'frankfurter' | 'manual' };
    }

    throw new Error(
      `No exchange rate available for ${fromCurrency} -> ${toCurrency} on or before ${date}. ` +
      `${routable ? 'Frankfurter is unreachable and no cached rate exists.' : 'This currency pair requires manual rate entry.'} ` +
      `Please enter a rate manually before saving this transaction.`,
    );
  }

  /**
   * Manual rate entry — required for any pair touching MWK/ZMW/TZS/MZN/
   * KES/UGX (spec point: hybrid Frankfurter + manual entry), and also
   * usable as an override for Frankfurter-supported pairs if the business
   * wants to record a bank's actual traded rate instead of the ECB
   * reference rate.
   */
  async recordManualRate(
    businessId: string,
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    rateDate: string,
    userId: string,
  ): Promise<Row<'exchange_rates'>> {
    return this.rates.recordRate({
      business_id: businessId,
      from_currency: fromCurrency,
      to_currency: toCurrency,
      rate,
      rate_date: rateDate,
      source: 'manual',
      created_by: userId,
    } as InsertDto<'exchange_rates'>);
  }

  /**
   * Bulk-fetch and cache today's Frankfurter rates for a business's
   * functional currency against all its Frankfurter-supported currencies
   * in one API call. Intended for a daily scheduled job or a manual
   * "refresh rates" button — NOT called per-transaction (that's getRate's
   * job, which caches lazily on first use per pair/date).
   *
   * Silently skips the business's own functional currency if it happens
   * to not be Frankfurter-supported (which, for every Malawi-based
   * business here, it won't be — MWK is not an ECB currency).
   */
  async refreshDailyRates(businessId: string, functionalCurrency: string): Promise<{ cached: number; skipped: string }> {
    const { data: supportedCurrencies, error } = await this.client
      .from('currencies')
      .select('code')
      .eq('is_frankfurter_supported', true);

    if (error) throw toRepositoryError('currencies', error);

    const isFunctionalCurrencyRoutable = supportedCurrencies?.some((c) => c.code === functionalCurrency);

    if (!isFunctionalCurrencyRoutable) {
      return {
        cached: 0,
        skipped: `Functional currency ${functionalCurrency} is not Frankfurter-supported — ` +
          `rates to/from it require manual entry and were not fetched.`,
      };
    }

    let cached = 0;
    for (const currency of supportedCurrencies ?? []) {
      if (currency.code === functionalCurrency) continue;
      try {
        const result = await this.getRate(businessId, currency.code, functionalCurrency, new Date().toISOString().slice(0, 10));
        if (!result.isStale) cached += 1;
      } catch {
        // Individual pair failure shouldn't stop the whole batch.
        continue;
      }
    }

    return { cached, skipped: '' };
  }
}