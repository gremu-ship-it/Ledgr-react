import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, TaxCode } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class TaxRepository extends BaseRepository<'tax_configurations'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'tax_configurations');
  }

  /**
   * Fetch all currently active tax configurations for a business.
   *
   * FIX [effective_to date filter]:
   * tax_configurations has effective_from / effective_to columns.
   * A config with is_active=true but future effective_from, or past effective_to,
   * must not be returned. Added date-range filter using today's date.
   */
  async findActiveByBusiness(businessId: string, asOf?: string): Promise<Row<'tax_configurations'>[]> {
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('tax_configurations')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .lte('effective_from', date)
      .or(`effective_to.is.null,effective_to.gte.${date}`)
      .order('tax_code', { ascending: true });
    if (error) throw toRepositoryError('tax_configurations', error);
    return data ?? [];
  }

  /**
   * Fetch a business's whole tax schedule: every stored period, including
   * future-dated and closed ones, oldest first per tax code.
   *
   * This is the read the tax-configuration screen needs (a schedule is not
   * visible through findActiveByBusiness, which answers only for one date), and
   * the read src/lib/tax/taxConfiguration.ts resolves a single date from. It is
   * not filtered by `is_active`: a period a business has switched off is still
   * something it must be able to see and correct.
   */
  async findScheduleByBusiness(businessId: string): Promise<Row<'tax_configurations'>[]> {
    const { data, error } = await this.client
      .from('tax_configurations')
      .select('*')
      .eq('business_id', businessId)
      .order('tax_code', { ascending: true })
      .order('effective_from', { ascending: true });
    if (error) throw toRepositoryError('tax_configurations', error);
    return data ?? [];
  }

  /**
   * Fetch the active, currently effective tax configuration for a specific
   * tax code.
   *
   * FIX [effective_to date filter]: same as findActiveByBusiness.
   *
   * `maybeSingle` is deliberate: from migration 20261022000000 a business
   * cannot hold two periods of one tax code covering the same date, so a single
   * answer is the only possible one. A schedule stored before that migration can
   * still be ambiguous, and then this call fails loudly rather than picking one
   * of the two rates — resolve it with src/lib/tax/taxConfiguration.ts, which
   * reports that state as `ambiguous`.
   */
  async findByCode(
    businessId: string,
    taxCode: TaxCode,
    asOf?: string,
  ): Promise<Row<'tax_configurations'> | null> {
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('tax_configurations')
      .select('*')
      .eq('business_id', businessId)
      .eq('tax_code', taxCode)
      .eq('is_active', true)
      .lte('effective_from', date)
      .or(`effective_to.is.null,effective_to.gte.${date}`)
      .maybeSingle();
    if (error) throw toRepositoryError('tax_configurations', error);
    return data ?? null;
  }

  /**
   * The stored standard VAT rate for a date, as a PERCENTAGE (17.5), or null
   * when this business has no stored period for it.
   *
   * Note for callers: null means "this business has not configured a rate for
   * that date" — it does not mean the rate is zero, and it does not say what a
   * NEW document should use. Use `src/lib/tax/taxConfiguration.ts`
   * (`findScheduleByBusiness` + `resolveTaxRate`) when the caller needs to know
   * whether the rate came from the business, from the supported schedule, or
   * from nowhere at all; that is also the only path that reports an ambiguous
   * stored schedule rather than throwing.
   */
  async getVatRate(businessId: string, asOf?: string): Promise<number | null> {
    const config = await this.findByCode(businessId, 'vat_standard', asOf);
    return config ? Number(config.rate) : null;
  }

  async getWhtRate(
    businessId: string,
    tier: Extract<TaxCode, 'wht_10' | 'wht_15' | 'wht_20'>,
    asOf?: string,
  ): Promise<number | null> {
    const config = await this.findByCode(businessId, tier, asOf);
    return config ? Number(config.rate) : null;
  }

  async findPayeBands(businessId: string, fiscalYear: string): Promise<Row<'paye_bands'>[]> {
    const { data, error } = await this.client
      .from('paye_bands')
      .select('*')
      .eq('business_id', businessId)
      .eq('fiscal_year', fiscalYear)
      .order('band_from', { ascending: true });
    if (error) throw toRepositoryError('paye_bands', error);
    return data ?? [];
  }

  async calculatePaye(businessId: string, fiscalYear: string, taxableIncome: number): Promise<number> {
    if (taxableIncome <= 0) return 0;
    const bands = await this.findPayeBands(businessId, fiscalYear);
    if (bands.length === 0) return 0;
    let remaining = taxableIncome;
    let totalPaye = 0;
    for (const band of bands) {
      if (remaining <= 0) break;
      const bandFrom = Number(band.band_from);
      const bandTo = band.band_to !== null ? Number(band.band_to) : null;
      const bandWidth = bandTo !== null ? bandTo - bandFrom : Infinity;
      const taxableInBand = Math.min(remaining, bandWidth);
      totalPaye += taxableInBand * (Number(band.rate) / 100);
      remaining -= taxableInBand;
    }
    return Math.round(totalPaye * 100) / 100;
  }
}