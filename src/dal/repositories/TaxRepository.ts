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
   * Fetch the active, currently effective tax configuration for a specific
   * tax code.
   *
   * FIX [effective_to date filter]: same as findActiveByBusiness.
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