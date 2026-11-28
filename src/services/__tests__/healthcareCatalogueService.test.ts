import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cataloguePayload,
  createHealthcareCatalogueItem,
  deactivateHealthcareCatalogueItem,
  defaultDispensable,
  defaultTrackInventory,
  listHealthcareCatalogue,
  productTypeForKind,
  summariseStockForItem,
  updateHealthcareCatalogueItem,
} from '../healthcareCatalogueService';
import type { MedicationBatch } from '@/types/healthcare';

const hc = vi.hoisted(() => ({
  handlers: new Map<string, (operation: string, values: unknown) => { data?: unknown; error?: unknown }>(),
  calls: [] as Array<{ table: string; operation: string; values: unknown }>,
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let operation = 'select';
    let values: unknown = null;

    const resolve = () => {
      hc.calls.push({ table, operation, values });
      const handler = hc.handlers.get(table);
      return handler ? handler(operation, values) : { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;

    Object.assign(builder, {
      select: passthrough,
      insert: (input: unknown) => {
        operation = 'insert';
        values = input;
        return builder;
      },
      update: (input: unknown) => {
        operation = 'update';
        values = input;
        return builder;
      },
      eq: passthrough,
      is: passthrough,
      not: passthrough,
      order: passthrough,
      limit: passthrough,
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    });

    return builder;
  };

  return { supabase: { from: makeBuilder } };
});

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    business_id: BUSINESS_ID,
    name: 'Amoxicillin',
    sku: 'AMX-500',
    description: 'Broad-spectrum antibiotic',
    product_type: 'trading_good',
    healthcare_item_type: 'drug',
    is_dispensable: true,
    strength: '500 mg',
    dosage_form: 'capsule',
    unit_of_measure: 'capsule',
    sale_price: 1200,
    purchase_price: 700,
    track_inventory: true,
    reorder_level: 20,
    is_active: true,
    created_at: '2026-11-27T10:00:00.000Z',
    ...overrides,
  };
}

function batch(overrides: Partial<MedicationBatch> = {}): MedicationBatch {
  return {
    id: 'batch-1',
    business_id: BUSINESS_ID,
    product_id: ITEM_ID,
    medication_name: 'Amoxicillin',
    batch_number: 'AMX-01',
    quantity_received: 100,
    quantity_on_hand: 40,
    unit_cost: 700,
    expiry_date: '2027-06-30',
    received_date: '2026-11-01',
    ...overrides,
  };
}

beforeEach(() => {
  hc.handlers.clear();
  hc.calls.length = 0;
});

describe('catalogue vocabulary', () => {
  it('marks only drugs as dispensable and only services as untracked', () => {
    expect(defaultDispensable('drug')).toBe(true);
    expect(defaultDispensable('supply')).toBe(false);
    expect(defaultDispensable('service')).toBe(false);
    expect(defaultTrackInventory('service')).toBe(false);
    expect(defaultTrackInventory('drug')).toBe(true);
    expect(defaultTrackInventory('supply')).toBe(true);
  });

  it('maps services to product_type=service and goods to trading_good', () => {
    expect(productTypeForKind('service')).toBe('service');
    expect(productTypeForKind('drug')).toBe('trading_good');
    expect(productTypeForKind('product')).toBe('trading_good');
  });

  it('normalises trims, prices and service-specific fields', () => {
    const payload = cataloguePayload({
      businessId: BUSINESS_ID,
      name: '  Physiotherapy session  ',
      kind: 'service',
      salePrice: 25000.129,
      purchasePrice: 0,
      trackInventory: true,
      strength: 'should be dropped',
      dosageForm: 'should be dropped',
    });

    expect(payload).toMatchObject({
      name: 'Physiotherapy session',
      healthcare_item_type: 'service',
      product_type: 'service',
      is_dispensable: false,
      track_inventory: false,
      strength: null,
      dosage_form: null,
      sale_price: 25000.13,
    });
  });

  it('keeps drug strength/form and forces dispensable stock tracking', () => {
    const payload = cataloguePayload({
      businessId: BUSINESS_ID,
      name: 'Amoxicillin',
      kind: 'drug',
      strength: ' 500 mg ',
      dosageForm: ' capsule ',
      salePrice: 1200,
      trackInventory: false,
    });

    expect(payload).toMatchObject({
      healthcare_item_type: 'drug',
      product_type: 'trading_good',
      is_dispensable: true,
      track_inventory: true,
      strength: '500 mg',
      dosage_form: 'capsule',
    });
  });

  it('rejects an empty name and negative prices', () => {
    expect(() =>
      cataloguePayload({ businessId: BUSINESS_ID, name: '  ', kind: 'drug', salePrice: 1 }),
    ).toThrow(/name/i);
    expect(() =>
      cataloguePayload({ businessId: BUSINESS_ID, name: 'Drug', kind: 'drug', salePrice: -1 }),
    ).toThrow(/negative/i);
  });
});

describe('catalogue data access', () => {
  it('lists only healthcare-tagged rows for the tenant', async () => {
    hc.handlers.set('products', () => ({ data: [row()], error: null }));

    const items = await listHealthcareCatalogue(BUSINESS_ID, { kind: 'drug' });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: ITEM_ID,
      kind: 'drug',
      name: 'Amoxicillin',
      is_dispensable: true,
      sale_price: 1200,
    });
    expect(hc.calls[0]).toMatchObject({ table: 'products', operation: 'select' });
  });

  it('creates a tenant-scoped product with the healthcare payload', async () => {
    hc.handlers.set('products', (_operation, values) => ({
      data: row({ ...(values as Record<string, unknown>), id: ITEM_ID }),
      error: null,
    }));

    const created = await createHealthcareCatalogueItem({
      businessId: BUSINESS_ID,
      name: 'Amoxicillin',
      kind: 'drug',
      salePrice: 1200,
      purchasePrice: 700,
      unitOfMeasure: 'capsule',
      currency: 'MWK',
    });

    expect(created.id).toBe(ITEM_ID);
    expect(hc.calls[0]).toMatchObject({ table: 'products', operation: 'insert' });
    expect(hc.calls[0].values).toMatchObject({
      business_id: BUSINESS_ID,
      currency: 'MWK',
      healthcare_item_type: 'drug',
      is_dispensable: true,
      name: 'Amoxicillin',
    });
  });

  it('updates and deactivates with business_id + id filters', async () => {
    hc.handlers.set('products', () => ({ data: row({ is_active: false }), error: null }));

    const updated = await updateHealthcareCatalogueItem(BUSINESS_ID, ITEM_ID, {
      businessId: BUSINESS_ID,
      name: 'Amoxicillin',
      kind: 'drug',
      salePrice: 1500,
    });
    expect(updated.is_active).toBe(false);
    expect(hc.calls[0]).toMatchObject({ table: 'products', operation: 'update' });

    hc.calls.length = 0;
    await deactivateHealthcareCatalogueItem(BUSINESS_ID, ITEM_ID);
    expect(hc.calls[0]).toMatchObject({ table: 'products', operation: 'update' });
    expect(hc.calls[0].values).toMatchObject({ is_active: false, is_dispensable: false });
  });
});

describe('catalogue stock aggregation', () => {
  const item = { id: ITEM_ID, name: 'Amoxicillin' };

  it('sums unexpired, positive stock linked by product id', () => {
    const summary = summariseStockForItem(
      item,
      [
        batch({ id: 'b1', quantity_on_hand: 40, expiry_date: '2027-06-30' }),
        batch({ id: 'b2', quantity_on_hand: 10, expiry_date: '2027-01-15' }),
        batch({ id: 'b3', quantity_on_hand: 0, expiry_date: '2027-01-01' }),
        batch({ id: 'b4', quantity_on_hand: 99, expiry_date: '2026-01-01' }),
      ],
      new Date('2026-11-27T12:00:00Z'),
    );

    expect(summary).toEqual({
      onHand: 50,
      nearestExpiry: '2027-01-15',
      batchCount: 2,
    });
  });

  it('falls back to a case-insensitive medication name for legacy batches', () => {
    const summary = summariseStockForItem(
      item,
      [
        batch({ id: 'b1', product_id: null, medication_name: ' amoxicillin ', quantity_on_hand: 12 }),
        batch({ id: 'b2', product_id: null, medication_name: 'Ampicillin', quantity_on_hand: 80 }),
      ],
      new Date('2026-11-27T12:00:00Z'),
    );

    expect(summary.onHand).toBe(12);
    expect(summary.batchCount).toBe(1);
  });
});
