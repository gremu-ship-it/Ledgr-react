/**
 * Persists rows validated by the native CSV engine without changing any
 * existing schema or repository. Field names here are the database column
 * names; the parser's friendlier names (unit_price, purchase_cost, etc.) are
 * translated at this boundary only.
 */

import { supabase } from '@/lib/supabase';
import type { InsertDto, UpdateDto } from '@/dal/types/database';
import type { EntityImportType } from '@/lib/csv/nativeCsvParser';

type ValidRow = Record<string, unknown>;

const text = (value: unknown): string | null => {
  const result = value == null ? '' : String(value).trim();
  return result || null;
};

const number = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function assertNoError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function importProducts(businessId: string, rows: ValidRow[]): Promise<number> {
  const { data: existing, error: lookupError } = await supabase
    .from('products')
    .select('id, sku')
    .eq('business_id', businessId)
    .is('deleted_at', null);
  assertNoError(lookupError);

  const bySku = new Map(
    (existing ?? []).filter((product) => product.sku).map((product) => [product.sku as string, product.id]),
  );

  for (const row of rows) {
    const name = text(row.name);
    if (!name) continue;
    const sku = text(row.sku);
    const price = number(row.unit_price);
    const cost = number(row.cost_price);
    const stock = number(row.stock_quantity);

    if (sku && bySku.has(sku)) {
      const update: UpdateDto<'products'> = {
        name,
        sku,
        barcode: text(row.barcode),
        sale_price: price,
        purchase_price: cost,
        cost_price: cost,
        unit_of_measure: text(row.unit_of_measure) ?? 'pcs',
        track_inventory: stock > 0,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('products').update(update).eq('id', bySku.get(sku)!);
      assertNoError(error);
    } else {
      const insert: InsertDto<'products'> = {
        business_id: businessId,
        name,
        sku,
        barcode: text(row.barcode),
        sale_price: price,
        purchase_price: cost,
        cost_price: cost,
        unit_of_measure: text(row.unit_of_measure) ?? 'pcs',
        track_inventory: stock > 0,
        product_type: 'product',
        currency: 'MWK',
        is_active: true,
      };
      const { error } = await supabase.from('products').insert(insert);
      assertNoError(error);
    }
  }

  return rows.filter((row) => Boolean(text(row.name))).length;
}

async function resolveAssetCategoryId(
  businessId: string,
  requestedCategory: string | null,
): Promise<string> {
  const { data: categories, error } = await supabase
    .from('asset_categories')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('is_active', true);
  assertNoError(error);

  const byName = new Map(
    (categories ?? []).map((category) => [category.name.trim().toLowerCase(), category.id]),
  );
  const match = requestedCategory ? byName.get(requestedCategory.toLowerCase()) : undefined;
  if (match) return match;
  if (categories && categories.length > 0) return categories[0].id;

  // A fresh business may not have a category yet; fixed_assets.category_id is
  // required, so create the minimal non-depreciable bucket once.
  const { data: created, error: createError } = await supabase
    .from('asset_categories')
    .insert({
      business_id: businessId,
      name: 'Imported',
      is_active: true,
      is_depreciable: false,
      depreciation_method: 'straight_line',
      useful_life_years: 5,
      residual_percent: 0,
    })
    .select('id')
    .single();
  assertNoError(createError);
  if (!created) throw new Error('Could not create an asset category for the import.');
  return created.id;
}

async function importFixedAssets(businessId: string, rows: ValidRow[]): Promise<number> {
  const categoryIds = new Map<string, string>();
  const inserts: InsertDto<'fixed_assets'>[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    const name = text(row.name);
    if (!name) continue;
    const categoryName = text(row.category);
    if (!categoryIds.has(categoryName ?? '__default__')) {
      categoryIds.set(
        categoryName ?? '__default__',
        await resolveAssetCategoryId(businessId, categoryName),
      );
    }

    const method = String(row.depreciation_method ?? 'straight_line');
    const depreciationMethod = (method === 'reducing_balance' || method === 'declining_balance'
      ? 'reducing_balance'
      : method === 'units_of_production' || method === 'sum_of_years_digits'
        ? method
        : 'straight_line') as InsertDto<'fixed_assets'>['depreciation_method'];
    const acquisitionDate = text(row.purchase_date) ?? today;

    inserts.push({
      business_id: businessId,
      asset_number: text(row.asset_code) ?? `FA-${Date.now().toString().slice(-4)}`,
      name,
      category_id: categoryIds.get(categoryName ?? '__default__')!,
      acquisition_date: acquisitionDate,
      acquisition_cost: number(row.purchase_cost),
      depreciation_start_date: acquisitionDate,
      depreciation_method: depreciationMethod,
      useful_life_years: number(row.useful_life_years, 5),
      residual_value: number(row.salvage_value),
      accumulated_depreciation: 0,
      status: 'active',
      is_active: true,
      is_depreciable: false,
    });
  }

  if (inserts.length === 0) return 0;
  const { error } = await supabase.from('fixed_assets').insert(inserts);
  assertNoError(error);
  return inserts.length;
}

async function importContacts(businessId: string, rows: ValidRow[]): Promise<number> {
  const inserts: InsertDto<'contacts'>[] = rows
    .filter((row) => Boolean(text(row.name)))
    .map((row) => {
      const type = String(row.type ?? 'customer');
      return {
        business_id: businessId,
        name: text(row.name)!,
        contact_type: type === 'supplier' || type === 'both' ? type : 'customer',
        email: text(row.email),
        phone: text(row.phone),
        tpin: text(row.tax_id),
        address_line1: text(row.address),
        credit_limit: number(row.credit_limit),
        currency: 'MWK',
        is_active: true,
      };
    });

  if (inserts.length === 0) return 0;
  const { error } = await supabase.from('contacts').insert(inserts);
  assertNoError(error);
  return inserts.length;
}

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'income', 'expense']);
const ACCOUNT_SUBTYPES = new Set([
  'current_asset', 'contra_ar', 'non_current_asset', 'fixed_asset',
  'current_liability', 'non_current_liability', 'share_capital',
  'retained_earnings', 'reserves', 'revenue', 'other_income',
  'cost_of_sales', 'operating_expense', 'finance_cost', 'tax_expense',
  'depreciation_amortisation',
]);

async function importAccounts(businessId: string, rows: ValidRow[]): Promise<number> {
  const { data: existing, error: lookupError } = await supabase
    .from('accounts')
    .select('code')
    .eq('business_id', businessId)
    .is('deleted_at', null);
  assertNoError(lookupError);

  const existingCodes = new Set((existing ?? []).map((account) => account.code));
  const inserts: InsertDto<'accounts'>[] = [];

  for (const row of rows) {
    const code = text(row.code);
    const name = text(row.name);
    if (!code || !name || existingCodes.has(code)) continue;
    const rawType = String(row.type ?? '').toLowerCase();
    const accountType = rawType === 'revenue' ? 'income' : rawType;
    if (!ACCOUNT_TYPES.has(accountType)) continue;

    const subtype = text(row.subtype);
    inserts.push({
      business_id: businessId,
      code,
      name,
      account_type: accountType as InsertDto<'accounts'>['account_type'],
      account_subtype: subtype && ACCOUNT_SUBTYPES.has(subtype)
        ? subtype as InsertDto<'accounts'>['account_subtype']
        : null,
      normal_balance: accountType === 'asset' || accountType === 'expense' ? 'debit' : 'credit',
      currency: 'MWK',
      is_active: true,
      is_system: false,
      is_group: false,
      tax_code: 'none',
    });
    existingCodes.add(code);
  }

  if (inserts.length === 0) return 0;
  const { error } = await supabase.from('accounts').insert(inserts);
  assertNoError(error);
  return inserts.length;
}

/** Imports rows already validated by validateAndMapCsvRows(). */
export async function importValidatedRows(
  businessId: string,
  entityType: EntityImportType,
  rows: ValidRow[],
): Promise<number> {
  if (!businessId) throw new Error('No business selected.');
  switch (entityType) {
    case 'products':
      return importProducts(businessId, rows);
    case 'fixed_assets':
      return importFixedAssets(businessId, rows);
    case 'contacts':
      return importContacts(businessId, rows);
    case 'accounts':
      return importAccounts(businessId, rows);
  }
}
