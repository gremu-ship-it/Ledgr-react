import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { NotFoundError, toRepositoryError } from '../errors/RepositoryError';

export class AssetRepository extends BaseRepository<'fixed_assets'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'fixed_assets');
  }

  async findByBusiness(businessId: string): Promise<Row<'fixed_assets'>[]> {
    const { data, error } = await this.client
      .from('fixed_assets').select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('asset_number', { ascending: true });
    if (error) throw toRepositoryError('fixed_assets', error);
    return data ?? [];
  }

  async findByCategory(businessId: string, categoryId: string): Promise<Row<'fixed_assets'>[]> {
    const { data, error } = await this.client
      .from('fixed_assets').select('*')
      .eq('business_id', businessId)
      .eq('category_id', categoryId)
      .is('deleted_at', null);
    if (error) throw toRepositoryError('fixed_assets', error);
    return data ?? [];
  }

  async findCategories(businessId: string): Promise<Row<'asset_categories'>[]> {
    const { data, error } = await this.client
      .from('asset_categories').select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('asset_categories', error);
    return data ?? [];
  }

  async findCategoryById(
    businessId: string,
    id: string,
  ): Promise<Row<'asset_categories'> | null> {
    const { data, error } = await this.client
      .from('asset_categories')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw toRepositoryError('asset_categories', error);
    return data;
  }

  async createCategory(
    category: InsertDto<'asset_categories'>,
  ): Promise<Row<'asset_categories'>> {
    const { data, error } = await this.client
      .from('asset_categories')
      .insert(category)
      .select('*')
      .single();
    if (error) throw toRepositoryError('asset_categories', error);
    return data;
  }

  async updateCategory(
    businessId: string,
    id: string,
    category: UpdateDto<'asset_categories'>,
  ): Promise<Row<'asset_categories'>> {
    const { data, error } = await this.client
      .from('asset_categories')
      .update(category)
      .eq('business_id', businessId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError('asset_categories', error);
    // An UPDATE filtered out by RLS returns no error and zero rows. Treat that
    // as a failed save instead of showing a false "Category updated" message.
    if (!data) throw new NotFoundError('asset_categories', id);
    return data;
  }

  async deactivateCategory(
    businessId: string,
    id: string,
  ): Promise<Row<'asset_categories'>> {
    return this.updateCategory(businessId, id, { is_active: false });
  }

  async recordDepreciation(
    // `posted`/`posted_at`/`posted_by` are set by this function (posting the
    // schedule); callers supply the draft schedule fields only.
    schedule: Omit<InsertDto<'depreciation_schedules'>, 'posted' | 'posted_at' | 'posted_by'> & { journal_entry_id: string },
    postedBy: string,
  ): Promise<{ schedule: Row<'depreciation_schedules'>; asset: Row<'fixed_assets'> }> {
    const { data, error } = await this.client
    .from('depreciation_schedules')
    .insert({
      ...schedule,
      posted: true,
      posted_at: new Date().toISOString(),
      posted_by: postedBy,
    } as never)
    .select('*')
    .single();
  if (error) throw toRepositoryError('depreciation_schedules', error);

  const asset = await this.findById(schedule.asset_id);
  const updatedAsset = await this.update(asset.id, {
    accumulated_depreciation: schedule.accumulated_to_date,
    net_book_value: schedule.net_book_value,
    last_depreciation_date: schedule.period_end,
  });
  return { schedule: data, asset: updatedAsset };
}

  /**
   * FIX [#5 Missing business_id on depreciation_schedules]:
   * depreciation_schedules.business_id is NOT NULL.
   * Added businessId parameter and filter.
   */
  async findDepreciationSchedule(
    businessId: string,
    assetId: string,
  ): Promise<Row<'depreciation_schedules'>[]> {
    const { data, error } = await this.client
      .from('depreciation_schedules').select('*')
      .eq('business_id', businessId)   // FIX: was missing
      .eq('asset_id', assetId)
      .order('period_end', { ascending: false });
    if (error) throw toRepositoryError('depreciation_schedules', error);
    return data ?? [];
  }

  async revalue(
    id: string,
    revaluationDate: string,
    revaluedAmount: number,
    revaluationSurplusAccountId: string,
  ): Promise<Row<'fixed_assets'>> {
    return this.update(id, {
      revaluation_date: revaluationDate,
      revalued_amount: revaluedAmount,
      revaluation_surplus_account: revaluationSurplusAccountId,
      net_book_value: revaluedAmount,
    });
  }
  
  async dispose(
    id: string,
    disposalDate: string,
    disposalProceeds: number,
    disposalJournalId?: string,
  ): Promise<Row<'fixed_assets'>> {
    return this.update(id, {
      status: 'disposed',
      disposal_date: disposalDate,
      disposal_proceeds: disposalProceeds,
      disposal_journal_id: disposalJournalId,
      is_active: false,
    });
  }

  async markFullyDepreciated(id: string): Promise<Row<'fixed_assets'>> {
    return this.update(id, {
      status: 'fully_depreciated',
      is_active: false,
    });
  }

  async findAssetRegister(businessId: string): Promise<Row<'v_asset_register'>[]> {
    const { data, error } = await this.client
      .from('v_asset_register').select('*').eq('business_id', businessId);
    if (error) throw toRepositoryError('v_asset_register', error);
    return data ?? [];
  }
}