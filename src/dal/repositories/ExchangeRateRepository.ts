import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class ExchangeRateRepository extends BaseRepository<'exchange_rates'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'exchange_rates');
  }

  /**
   * Find the rate for an exact currency pair on an exact date.
   * Returns null if no exact match exists (caller decides fallback behaviour).
   */
  async findExact(
    businessId: string,
    fromCurrency: string,
    toCurrency: string,
    rateDate: string,
  ): Promise<Row<'exchange_rates'> | null> {
    const { data, error } = await this.client
      .from('exchange_rates')
      .select('*')
      .eq('business_id', businessId)
      .eq('from_currency', fromCurrency)
      .eq('to_currency', toCurrency)
      .eq('rate_date', rateDate)
      .maybeSingle();

    if (error) throw toRepositoryError('exchange_rates', error);
    return data;
  }

  /**
   * Find the most recent rate on or before a given date, for use as a
   * stale-but-usable fallback when no exact-date rate exists.
   */
  async findMostRecentBefore(
    businessId: string,
    fromCurrency: string,
    toCurrency: string,
    onOrBeforeDate: string,
  ): Promise<Row<'exchange_rates'> | null> {
    const { data, error } = await this.client
      .from('exchange_rates')
      .select('*')
      .eq('business_id', businessId)
      .eq('from_currency', fromCurrency)
      .eq('to_currency', toCurrency)
      .lte('rate_date', onOrBeforeDate)
      .order('rate_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw toRepositoryError('exchange_rates', error);
    return data;
  }

  /**
   * Insert a rate for a given date. Relies on the DB unique constraint
   * (business_id, from_currency, to_currency, rate_date) — if a rate for
   * that exact date already exists, this throws rather than silently
   * overwriting it. Historical rates are never recalculated (IAS 21).
   */
  async recordRate(rate: InsertDto<'exchange_rates'>): Promise<Row<'exchange_rates'>> {
    const { data, error } = await this.client
      .from('exchange_rates')
      .insert(rate as never)
      .select('*')
      .single();

    if (error) throw toRepositoryError('exchange_rates', error);
    return data;
  }

  /**
   * Fetch all rates for a business within a date range — used by period-end
   * revaluation and reporting.
   */
  async findByDateRange(
    businessId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Row<'exchange_rates'>[]> {
    const { data, error } = await this.client
      .from('exchange_rates')
      .select('*')
      .eq('business_id', businessId)
      .gte('rate_date', fromDate)
      .lte('rate_date', toDate)
      .order('rate_date', { ascending: false });

    if (error) throw toRepositoryError('exchange_rates', error);
    return data ?? [];
  }
}