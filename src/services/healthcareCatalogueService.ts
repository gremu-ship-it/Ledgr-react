/**
 * healthcareCatalogueService.ts
 *
 * The healthcare vertical's own view of the shared `products` master.
 *
 * A clinic needs three related things in one place: drugs that can be received
 * into FEFO pharmacy batches and later dispensed, consumables/supplies, and
 * services or products that appear on a patient invoice. Rather than fork a
 * second catalogue, this service adds a healthcare vocabulary on top of
 * `products` (migration 20270104) and keeps every read/write tenant-scoped.
 *
 * `products` already carries products_* RLS policies; this service never takes
 * a business id from the browser without putting it in the WHERE clause.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { MedicationBatch } from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

export const CATALOGUE_KINDS = ['drug', 'supply', 'service', 'product'] as const;
export type CatalogueItemKind = (typeof CATALOGUE_KINDS)[number];

export interface HealthcareCatalogueItem {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  kind: CatalogueItemKind;
  product_type: string;
  is_dispensable: boolean;
  strength: string | null;
  dosage_form: string | null;
  unit_of_measure: string;
  sale_price: number;
  purchase_price: number;
  track_inventory: boolean;
  reorder_level: number | null;
  is_active: boolean;
  created_at: string;
}

export interface CatalogueItemInput {
  businessId: string;
  name: string;
  kind: CatalogueItemKind;
  sku?: string | null;
  description?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  unitOfMeasure?: string | null;
  salePrice: number;
  purchasePrice?: number;
  trackInventory?: boolean;
  reorderLevel?: number | null;
  isActive?: boolean;
  currency?: string;
}

export interface CatalogueStockSummary {
  onHand: number;
  nearestExpiry: string | null;
  batchCount: number;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function isCatalogueKind(value: unknown): value is CatalogueItemKind {
  return typeof value === 'string' && (CATALOGUE_KINDS as readonly string[]).includes(value);
}

/** Services occupy no shelf; everything else in the catalogue may be stocked. */
export function defaultTrackInventory(kind: CatalogueItemKind): boolean {
  return kind !== 'service';
}

/** Only drugs may be handed out against a prescription. */
export function defaultDispensable(kind: CatalogueItemKind): boolean {
  return kind === 'drug';
}

/** Map the catalogue vocabulary onto the shared products.product_type column. */
export function productTypeForKind(kind: CatalogueItemKind): string {
  return kind === 'service' ? 'service' : 'trading_good';
}

function normaliseItem(row: Record<string, unknown>): HealthcareCatalogueItem {
  const kind = isCatalogueKind(row.healthcare_item_type)
    ? row.healthcare_item_type
    : row.product_type === 'service'
      ? 'service'
      : 'product';

  return {
    id: String(row.id),
    business_id: String(row.business_id),
    name: String(row.name ?? ''),
    sku: (row.sku as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    kind,
    product_type: String(row.product_type ?? productTypeForKind(kind)),
    is_dispensable: Boolean(row.is_dispensable) || kind === 'drug',
    strength: (row.strength as string | null) ?? null,
    dosage_form: (row.dosage_form as string | null) ?? null,
    unit_of_measure: String(row.unit_of_measure ?? 'each'),
    sale_price: toNumber(row.sale_price),
    purchase_price: toNumber(row.purchase_price ?? row.cost_price),
    track_inventory: Boolean(row.track_inventory),
    reorder_level:
      row.reorder_level === null || row.reorder_level === undefined
        ? null
        : toNumber(row.reorder_level),
    is_active: row.is_active !== false,
    created_at: String(row.created_at ?? ''),
  };
}

/** All healthcare-specific rows for a tenant, newest service/drug first. */
export async function listHealthcareCatalogue(
  businessId: string,
  options: { kind?: CatalogueItemKind | 'all'; includeInactive?: boolean } = {},
): Promise<HealthcareCatalogueItem[]> {
  if (!businessId) return [];

  let query = db
    .from('products')
    .select('*')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .not('healthcare_item_type', 'is', null);

  if (options.kind && options.kind !== 'all') {
    query = query.eq('healthcare_item_type', options.kind);
  }
  if (!options.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(normaliseItem);
}

/** Build the payload so both create and update write the same vocabulary. */
export function cataloguePayload(input: CatalogueItemInput): Record<string, unknown> {
  const name = input.name.trim();
  if (!name) throw new Error('A catalogue item name is required.');
  if (!isCatalogueKind(input.kind)) throw new Error('Choose a valid catalogue item type.');

  const salePrice = roundMoney(toNumber(input.salePrice));
  const purchasePrice = roundMoney(toNumber(input.purchasePrice));
  if (salePrice < 0 || purchasePrice < 0) {
    throw new Error('Prices cannot be negative.');
  }

  const trackInventory =
    input.kind === 'service'
      ? false
      : input.kind === 'drug'
        ? true
        : input.trackInventory ?? defaultTrackInventory(input.kind);
  const isDispensable = defaultDispensable(input.kind);

  return {
    name,
    sku: nullableText(input.sku),
    description: nullableText(input.description),
    healthcare_item_type: input.kind,
    product_type: productTypeForKind(input.kind),
    is_dispensable: isDispensable,
    strength: input.kind === 'drug' ? nullableText(input.strength) : null,
    dosage_form: input.kind === 'drug' ? nullableText(input.dosageForm) : null,
    unit_of_measure: nullableText(input.unitOfMeasure) ?? 'each',
    sale_price: salePrice,
    purchase_price: purchasePrice,
    track_inventory: trackInventory,
    reorder_level: input.reorderLevel == null ? null : Math.max(0, toNumber(input.reorderLevel)),
    is_active: input.isActive ?? true,
  };
}

export async function createHealthcareCatalogueItem(
  input: CatalogueItemInput,
): Promise<HealthcareCatalogueItem> {
  if (!input.businessId) throw new Error('A business is required.');

  const { data, error } = await db
    .from('products')
    .insert({
      business_id: input.businessId,
      currency: input.currency || 'MWK',
      ...cataloguePayload(input),
    })
    .select('*')
    .single();

  if (error) throw error;
  return normaliseItem(data as Record<string, unknown>);
}

export async function updateHealthcareCatalogueItem(
  businessId: string,
  itemId: string,
  input: CatalogueItemInput,
): Promise<HealthcareCatalogueItem> {
  if (!businessId || !itemId) throw new Error('A catalogue item is required.');

  const { data, error } = await db
    .from('products')
    .update({
      ...cataloguePayload(input),
      updated_at: new Date().toISOString(),
    })
    .eq('business_id', businessId)
    .eq('id', itemId)
    .select('*')
    .single();

  if (error) throw error;
  return normaliseItem(data as Record<string, unknown>);
}

/** Deactivate rather than delete so historical invoice lines keep their item. */
export async function deactivateHealthcareCatalogueItem(
  businessId: string,
  itemId: string,
): Promise<void> {
  const { error } = await db
    .from('products')
    .update({ is_active: false, is_dispensable: false, updated_at: new Date().toISOString() })
    .eq('business_id', businessId)
    .eq('id', itemId);
  if (error) throw error;
}

/**
 * Aggregate dispensary stock for the catalogue. A batch can be linked by
 * product_id, but older batches only carry the medication name, so the name is
 * used as a fallback. Only positive, unexpired stock is counted.
 */
export function summariseStockForItem(
  item: Pick<HealthcareCatalogueItem, 'id' | 'name'>,
  batches: readonly MedicationBatch[],
  today: Date = new Date(),
): CatalogueStockSummary {
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const itemName = item.name.trim().toLowerCase();

  const matching = batches.filter((batch) => {
    if (toNumber(batch.quantity_on_hand) <= 0) return false;
    if (String(batch.expiry_date).slice(0, 10) <= todayKey) return false;
    if (batch.product_id) return batch.product_id === item.id;
    return batch.medication_name.trim().toLowerCase() === itemName;
  });

  const onHand = matching.reduce((total, batch) => total + toNumber(batch.quantity_on_hand), 0);
  const nearestExpiry =
    matching
      .map((batch) => String(batch.expiry_date).slice(0, 10))
      .sort((a, b) => a.localeCompare(b))[0] ?? null;

  return {
    onHand: Math.round(onHand * 100) / 100,
    nearestExpiry,
    batchCount: matching.length,
  };
}
