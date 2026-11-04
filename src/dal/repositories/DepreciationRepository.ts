import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { AssetRepository } from './AssetRepository';
import { JournalRepository } from './JournalRepository';
import { toRepositoryError } from '../errors/RepositoryError';
import { calculateMonthlyDepreciation } from '@/services/depreciation';

export interface DepreciableAsset {
  asset: Row<'fixed_assets'>;
  category: Row<'asset_categories'>;
  netBookValue: number;
  accumulatedDepreciation: number;
  usefulLifeMonths: number | null;
  annualRatePercent: number | null;
}

export interface DepreciationPreview extends DepreciableAsset {
  periodDepreciation: number;
}

export interface DepreciationRunEntry {
  assetId: string;
  assetName: string;
  charge: number;
  journalEntryId: string;
  journalEntryNumber: string;
}

export interface DepreciationRunSummary {
  assetsProcessed: number;
  totalAmount: number;
  journalEntryIds: string[];
  entries: DepreciationRunEntry[];
  alreadyRun: boolean;
}

export interface DepreciationHistoryRecord {
  id: string;
  assetId: string;
  assetName: string;
  periodStart: string;
  periodEnd: string;
  depreciationCharge: number;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  createdAt: string;
}

export interface DepreciationCategorySummary {
  categoryId: string;
  categoryName: string;
  assetsCount: number;
  totalDepreciation: number;
}

interface DepreciationJournalPort {
  findByPostingKey: JournalRepository['findByPostingKey'];
  createBalancedEntry: JournalRepository['createBalancedEntry'];
  post: JournalRepository['post'];
}

interface DepreciationAssetPort {
  recordDepreciation: AssetRepository['recordDepreciation'];
  markFullyDepreciated: AssetRepository['markFullyDepreciated'];
}

interface DepreciationRepositoryDependencies {
  journal?: DepreciationJournalPort;
  assets?: DepreciationAssetPort;
  nextEntryNumber?: (businessId: string) => Promise<string>;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthsInPeriod(periodStart: string, periodEnd: string): number {
  if (!validDate(periodStart) || !validDate(periodEnd) || periodStart > periodEnd) {
    throw new Error('A valid depreciation period is required.');
  }
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth() + 1;
}

function netBookValue(asset: Row<'fixed_assets'>): number {
  return Math.max(0, Number(asset.net_book_value ?? (asset.acquisition_cost - asset.accumulated_depreciation)));
}

function toDepreciableAsset(
  asset: Row<'fixed_assets'>,
  category: Row<'asset_categories'>,
): DepreciableAsset {
  const usefulLifeYears = asset.useful_life_years ?? category.useful_life_years;
  return {
    asset,
    category,
    netBookValue: netBookValue(asset),
    accumulatedDepreciation: Number(asset.accumulated_depreciation ?? 0),
    usefulLifeMonths: asset.useful_life_months ?? (usefulLifeYears == null ? null : Number(usefulLifeYears) * 12),
    annualRatePercent: asset.depreciation_rate ?? category.mra_depreciation_rate,
  };
}

/** Tenant-scoped fixed-asset depreciation calculation and journal posting. */
export class DepreciationRepository {
  private readonly client: SupabaseClient<Database>;
  private readonly journal: DepreciationJournalPort;
  private readonly assets: DepreciationAssetPort;
  private readonly entryNumberProvider: (businessId: string) => Promise<string>;

  constructor(
    client: SupabaseClient<Database>,
    dependencies: DepreciationRepositoryDependencies = {},
  ) {
    this.client = client;
    this.journal = dependencies.journal ?? new JournalRepository(client);
    this.assets = dependencies.assets ?? new AssetRepository(client);
    this.entryNumberProvider = dependencies.nextEntryNumber ?? ((businessId) => this.nextEntryNumber(businessId));
  }

  async getDepreciableAssets(businessId: string, asOfDate: string): Promise<DepreciableAsset[]> {
    if (!validDate(asOfDate)) throw new Error('A valid as-of date is required.');
    const { data: assets, error } = await this.client
      .from('fixed_assets')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'active')
      .eq('is_active', true)
      .eq('is_depreciable', true)
      .is('deleted_at', null)
      .lte('depreciation_start_date', asOfDate)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('fixed_assets', error);
    if (!assets?.length) return [];

    const categoryIds = [...new Set(assets.map((asset) => asset.category_id))];
    const { data: categories, error: categoryError } = await this.client
      .from('asset_categories')
      .select('*')
      .eq('business_id', businessId)
      .in('id', categoryIds);
    if (categoryError) throw toRepositoryError('asset_categories', categoryError);
    const categoriesById = new Map((categories ?? []).map((category) => [category.id, category]));

    return assets
      .filter((asset) => Number(asset.net_book_value ?? (asset.acquisition_cost - asset.accumulated_depreciation)) > 0)
      .flatMap((asset) => {
        const category = categoriesById.get(asset.category_id);
        if (!category || !category.is_depreciable || !asset.depreciation_method) return [];
        return [toDepreciableAsset(asset, category)];
      });
  }

  async calculateDepreciation(assetId: string, periodStart: string, periodEnd: string): Promise<number> {
    const asset = await this.getAssetById(assetId);
    const category = await this.getCategory(asset.business_id, asset.category_id);
    return this.calculateFor(toDepreciableAsset(asset, category), periodStart, periodEnd);
  }

  async getDepreciationPreview(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<DepreciationPreview[]> {
    monthsInPeriod(periodStart, periodEnd);
    const assets = await this.getDepreciableAssets(businessId, periodEnd);
    return assets.map((item) => ({
      ...item,
      periodDepreciation: this.calculateFor(item, periodStart, periodEnd),
    }));
  }

  /** Posts one balanced depreciation journal per asset and stores its schedule. */
  async runDepreciation(
    businessId: string,
    periodStart: string,
    periodEnd: string,
    postedBy: string,
  ): Promise<DepreciationRunSummary> {
    const monthCount = monthsInPeriod(periodStart, periodEnd);
    await this.assertPeriodIsOpen(businessId, periodStart, periodEnd);
    const assets = await this.getDepreciableAssets(businessId, periodEnd);
    const { data: existingSchedules, error: scheduleError } = await this.client
      .from('depreciation_schedules')
      .select('*')
      .eq('business_id', businessId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .eq('posted', true);
    if (scheduleError) throw toRepositoryError('depreciation_schedules', scheduleError);
    const existingAssetIds = new Set((existingSchedules ?? []).map((schedule) => schedule.asset_id));
    const currency = await this.getBusinessCurrency(businessId);
    const entries: DepreciationRunEntry[] = [];

    for (const item of assets) {
      if (existingAssetIds.has(item.asset.id)) continue;
      const charge = this.calculateFor(item, periodStart, periodEnd, monthCount);
      if (charge <= 0) continue;

      const expenseAccountId = item.asset.dep_expense_account_id ?? item.category.dep_expense_account_id;
      const accumulatedAccountId = item.asset.accumulated_dep_account_id ?? item.category.accumulated_dep_account_id;
      if (!expenseAccountId || !accumulatedAccountId) {
        throw new Error(`Depreciation accounts are missing for asset ${item.asset.name}.`);
      }

      const postingKey = `depreciation:${item.asset.id}:${periodStart}:${periodEnd}`;
      let journalEntry = await this.journal.findByPostingKey(businessId, postingKey);
      if (!journalEntry) {
        const entryNumber = await this.entryNumberProvider(businessId);
        const description = `${item.asset.name} · ${periodStart} – ${periodEnd}`;
        const { entry } = await this.journal.createBalancedEntry({
          business_id: businessId,
          entry_number: entryNumber,
          entry_date: periodEnd,
          description,
          reference: item.asset.asset_number,
          source_type: 'depreciation',
          source_id: item.asset.id,
          posting_key: postingKey,
          currency,
          exchange_rate: 1,
          status: 'draft',
          branch_id: item.asset.branch_id,
          department_id: item.asset.department_id,
          created_by: postedBy,
        }, [
          {
            line_number: 1,
            account_id: expenseAccountId,
            description,
            is_debit: true,
            amount: charge,
            amount_base: charge,
            currency,
            exchange_rate: 1,
            tax_code: 'none',
            tax_amount: 0,
            reconciled: false,
          },
          {
            line_number: 2,
            account_id: accumulatedAccountId,
            description,
            is_debit: false,
            amount: charge,
            amount_base: charge,
            currency,
            exchange_rate: 1,
            tax_code: 'none',
            tax_amount: 0,
            reconciled: false,
          },
        ]);
        journalEntry = entry;
      }

      if (journalEntry.status === 'draft') {
        journalEntry = await this.journal.post(journalEntry.id, postedBy);
      } else if (journalEntry.status !== 'posted') {
        throw new Error(`The depreciation journal for ${item.asset.name} is not postable.`);
      }

      const accumulatedToDate = roundMoney(item.accumulatedDepreciation + charge);
      const newNetBookValue = roundMoney(Math.max(item.asset.residual_value, item.netBookValue - charge));
      await this.assets.recordDepreciation({
        business_id: businessId,
        asset_id: item.asset.id,
        period_start: periodStart,
        period_end: periodEnd,
        depreciation_charge: charge,
        accumulated_to_date: accumulatedToDate,
        net_book_value: newNetBookValue,
        journal_entry_id: journalEntry.id,
      }, postedBy);
      if (newNetBookValue <= item.asset.residual_value + 0.01) {
        await this.assets.markFullyDepreciated(item.asset.id);
      }
      entries.push({
        assetId: item.asset.id,
        assetName: item.asset.name,
        charge,
        journalEntryId: journalEntry.id,
        journalEntryNumber: journalEntry.entry_number,
      });
    }

    return {
      assetsProcessed: entries.length,
      totalAmount: roundMoney(entries.reduce((sum, entry) => sum + entry.charge, 0)),
      journalEntryIds: entries.map((entry) => entry.journalEntryId),
      entries,
      alreadyRun: assets.length > 0 && entries.length === 0 && existingAssetIds.size > 0,
    };
  }

  async getDepreciationHistory(businessId: string, assetId?: string): Promise<DepreciationHistoryRecord[]> {
    let query = this.client
      .from('depreciation_schedules')
      .select('*')
      .eq('business_id', businessId)
      .eq('posted', true)
      .order('period_end', { ascending: false });
    if (assetId) query = query.eq('asset_id', assetId);
    const { data: schedules, error } = await query;
    if (error) throw toRepositoryError('depreciation_schedules', error);
    if (!schedules?.length) return [];

    const assetIds = [...new Set(schedules.map((schedule) => schedule.asset_id))];
    const { data: assets, error: assetError } = await this.client
      .from('fixed_assets')
      .select('id, name')
      .eq('business_id', businessId)
      .in('id', assetIds);
    if (assetError) throw toRepositoryError('fixed_assets', assetError);
    const names = new Map((assets ?? []).map((asset) => [asset.id, asset.name]));
    const journalIds = [...new Set(schedules.map((schedule) => schedule.journal_entry_id).filter((id): id is string => Boolean(id)))];
    const numbers = new Map<string, string>();
    if (journalIds.length) {
      const { data: journalEntries, error: journalError } = await this.client
        .from('journal_entries')
        .select('id, entry_number')
        .eq('business_id', businessId)
        .in('id', journalIds);
      if (journalError) throw toRepositoryError('journal_entries', journalError);
      for (const entry of journalEntries ?? []) numbers.set(entry.id, entry.entry_number);
    }

    return schedules.map((schedule) => ({
      id: schedule.id,
      assetId: schedule.asset_id,
      assetName: names.get(schedule.asset_id) ?? '',
      periodStart: schedule.period_start,
      periodEnd: schedule.period_end,
      depreciationCharge: Number(schedule.depreciation_charge),
      journalEntryId: schedule.journal_entry_id,
      journalEntryNumber: schedule.journal_entry_id ? numbers.get(schedule.journal_entry_id) ?? null : null,
      createdAt: schedule.created_at,
    }));
  }

  async getDepreciationSummary(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<DepreciationCategorySummary[]> {
    monthsInPeriod(periodStart, periodEnd);
    const { data: schedules, error } = await this.client
      .from('depreciation_schedules')
      .select('asset_id, depreciation_charge')
      .eq('business_id', businessId)
      .eq('posted', true)
      .gte('period_end', periodStart)
      .lte('period_start', periodEnd);
    if (error) throw toRepositoryError('depreciation_schedules', error);
    if (!schedules?.length) return [];
    const assetIds = [...new Set(schedules.map((schedule) => schedule.asset_id))];
    const { data: assets, error: assetError } = await this.client
      .from('fixed_assets')
      .select('id, category_id')
      .eq('business_id', businessId)
      .in('id', assetIds);
    if (assetError) throw toRepositoryError('fixed_assets', assetError);
    const categoryIds = [...new Set((assets ?? []).map((asset) => asset.category_id))];
    const { data: categories, error: categoryError } = await this.client
      .from('asset_categories')
      .select('id, name')
      .eq('business_id', businessId)
      .in('id', categoryIds);
    if (categoryError) throw toRepositoryError('asset_categories', categoryError);

    const categoryById = new Map((categories ?? []).map((category) => [category.id, category.name]));
    const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset.category_id]));
    const totals = new Map<string, { categoryName: string; assetIds: Set<string>; amount: number }>();
    for (const schedule of schedules) {
      const categoryId = assetById.get(schedule.asset_id);
      if (!categoryId) continue;
      const aggregate = totals.get(categoryId) ?? {
        categoryName: categoryById.get(categoryId) ?? '',
        assetIds: new Set<string>(),
        amount: 0,
      };
      aggregate.assetIds.add(schedule.asset_id);
      aggregate.amount += Number(schedule.depreciation_charge);
      totals.set(categoryId, aggregate);
    }
    return [...totals.entries()].map(([categoryId, value]) => ({
      categoryId,
      categoryName: value.categoryName,
      assetsCount: value.assetIds.size,
      totalDepreciation: roundMoney(value.amount),
    })).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }

  private calculateFor(item: DepreciableAsset, periodStart: string, periodEnd: string, monthCount?: number): number {
    const months = monthCount ?? monthsInPeriod(periodStart, periodEnd);
    const charge = calculateMonthlyDepreciation({
      method: item.asset.depreciation_method,
      acquisitionCost: Number(item.asset.acquisition_cost),
      residualValue: Number(item.asset.residual_value),
      usefulLifeYears: item.asset.useful_life_years ?? item.category.useful_life_years,
      usefulLifeMonths: item.usefulLifeMonths,
      accumulatedDepreciation: item.accumulatedDepreciation,
      depreciationRate: item.annualRatePercent,
      netBookValue: item.netBookValue,
    }, months);
    return roundMoney(charge);
  }

  private async getAssetById(assetId: string): Promise<Row<'fixed_assets'>> {
    const { data, error } = await this.client.from('fixed_assets').select('*').eq('id', assetId).maybeSingle();
    if (error) throw toRepositoryError('fixed_assets', error);
    if (!data) throw new Error('Asset was not found.');
    return data;
  }

  private async getCategory(businessId: string, categoryId: string): Promise<Row<'asset_categories'>> {
    const { data, error } = await this.client.from('asset_categories').select('*')
      .eq('business_id', businessId).eq('id', categoryId).maybeSingle();
    if (error) throw toRepositoryError('asset_categories', error);
    if (!data) throw new Error('Asset category was not found.');
    return data;
  }

  private async getBusinessCurrency(businessId: string): Promise<string> {
    const { data, error } = await this.client.from('businesses').select('base_currency').eq('id', businessId).maybeSingle();
    if (error) throw toRepositoryError('businesses', error);
    return data?.base_currency ?? 'MWK';
  }

  private async assertPeriodIsOpen(businessId: string, periodStart: string, periodEnd: string): Promise<void> {
    const { data, error } = await this.client.from('accounting_periods').select('id, is_closed')
      .eq('business_id', businessId).eq('is_closed', true)
      .lte('period_start', periodEnd).gte('period_end', periodStart);
    if (error) throw toRepositoryError('accounting_periods', error);
    if (data?.length) throw new Error('Depreciation cannot be posted into a closed accounting period.');
  }

  private async nextEntryNumber(businessId: string): Promise<string> {
    const rpc = this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc('next_journal_entry_number', { p_business_id: businessId });
    if (error) throw toRepositoryError('journal_entries', error);
    if (typeof data !== 'string' || !data) throw new Error('Could not allocate a journal entry number.');
    return data;
  }
}
