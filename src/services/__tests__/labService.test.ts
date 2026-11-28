import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabOrder } from '@/types/healthcare';

const lab = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (operation: string, values: unknown, filters: Array<[string, unknown[]]>) => {
      data?: unknown;
      error?: unknown;
    }
  >(),
  calls: [] as Array<{
    table: string;
    operation: string;
    values: unknown;
    filters: Array<[string, unknown[]]>;
  }>,
  user: { id: 'tech-1' } as { id: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let operation = 'select';
    let values: unknown = null;
    const filters: Array<[string, unknown[]]> = [];

    const resolve = () => {
      lab.calls.push({ table, operation, values, filters });
      const handler = lab.handlers.get(table);
      return handler ? handler(operation, values, filters) : { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const passthrough = (name: string) => (...args: unknown[]) => {
      filters.push([name, args]);
      return builder;
    };

    Object.assign(builder, {
      select: passthrough('select'),
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
      delete: () => {
        operation = 'delete';
        return builder;
      },
      eq: passthrough('eq'),
      neq: passthrough('neq'),
      in: passthrough('in'),
      gt: passthrough('gt'),
      lt: passthrough('lt'),
      like: passthrough('like'),
      ilike: passthrough('ilike'),
      or: passthrough('or'),
      is: passthrough('is'),
      not: passthrough('not'),
      order: passthrough('order'),
      limit: passthrough('limit'),
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    });

    return builder;
  };

  return {
    supabase: {
      from: makeBuilder,
      auth: { getUser: async () => ({ data: { user: lab.user } }) },
    },
  };
});

const {
  buildReferenceRangeLabel,
  collectSpecimen,
  evaluateLabItemStatus,
  evaluateResultStatus,
  findLabReferenceDefaults,
  formatSpecimenBarcode,
  generateSpecimenBarcode,
  getLabOrders,
  isResultPending,
  nextSpecimenSequence,
  recordLabResult,
  rejectSpecimen,
  splitLabWorklist,
  verifyLabOrder,
} = await import('../labService');

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';

function order(overrides: Partial<LabOrder> = {}): LabOrder {
  return {
    id: ORDER_ID,
    business_id: BUSINESS_ID,
    visit_id: 'visit-1',
    patient_id: 'patient-1',
    doctor_id: 'doctor-1',
    status: 'ordered',
    created_at: '2026-06-15T08:00:00Z',
    items: [
      {
        id: 'item-1',
        test_name: 'Random Blood Sugar',
        unit_price: 5000,
        result_value: null,
        result_status: 'pending',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  lab.handlers.clear();
  lab.calls.length = 0;
  lab.user = { id: 'tech-1' };
});

describe('evaluateResultStatus', () => {
  const range = { minNormal: 3.9, maxNormal: 7.8, criticalLow: 2.5, criticalHigh: 25 };

  it('returns pending for an empty value', () => {
    expect(evaluateResultStatus('')).toBe('pending');
    expect(evaluateResultStatus('   ')).toBe('pending');
    expect(evaluateResultStatus(null)).toBe('pending');
    expect(evaluateResultStatus(undefined)).toBe('pending');
  });

  it('treats the critical bounds as inclusive', () => {
    expect(evaluateResultStatus(2.5, range)).toBe('critical');
    expect(evaluateResultStatus(25, range)).toBe('critical');
    expect(evaluateResultStatus('2.4', range)).toBe('critical');
    expect(evaluateResultStatus('30', range)).toBe('critical');
  });

  it('flags values outside the normal interval but inside the critical bounds', () => {
    expect(evaluateResultStatus(3.8, range)).toBe('abnormal');
    expect(evaluateResultStatus(8.1, range)).toBe('abnormal');
    expect(evaluateResultStatus('3.9', range)).toBe('normal');
    expect(evaluateResultStatus('7.8', range)).toBe('normal');
    expect(evaluateResultStatus('5.4', range)).toBe('normal');
  });

  it('accepts comma decimal separators', () => {
    expect(evaluateResultStatus('3,5', range)).toBe('abnormal');
  });

  it('classifies qualitative results', () => {
    expect(evaluateResultStatus('POSITIVE')).toBe('abnormal');
    expect(evaluateResultStatus('reactive')).toBe('abnormal');
    expect(evaluateResultStatus('Abnormal')).toBe('abnormal');
    expect(evaluateResultStatus('CRITICAL')).toBe('critical');
    expect(evaluateResultStatus('Panic value')).toBe('critical');
    expect(evaluateResultStatus('NEGATIVE')).toBe('normal');
    expect(evaluateResultStatus('Non-Reactive')).toBe('normal');
    expect(evaluateResultStatus('Not detected')).toBe('normal');
  });

  it('accepts the short min/max aliases used by callers', () => {
    expect(evaluateResultStatus('2', { min: 3, max: 8, criticalMin: 2.5, criticalMax: 20 })).toBe(
      'critical',
    );
    expect(evaluateResultStatus('4', { min: 3, max: 8 })).toBe('normal');
  });

  it('ignores absent bounds', () => {
    expect(evaluateResultStatus('900')).toBe('normal');
    expect(evaluateResultStatus('900', { minNormal: 10, maxNormal: 100 })).toBe('abnormal');
  });

  it('evaluates a stored item using its captured bounds', () => {
    expect(
      evaluateLabItemStatus({
        result_value: '1.9',
        min_normal: 3.9,
        max_normal: 7.8,
        critical_low: 2.5,
        critical_high: 25,
      }),
    ).toBe('critical');
  });

  it('knows which statuses still block verification', () => {
    expect(isResultPending('pending')).toBe(true);
    expect(isResultPending(null)).toBe(true);
    expect(isResultPending('normal')).toBe(false);
  });
});

describe('reference ranges', () => {
  it('renders both bounds with a unit', () => {
    expect(buildReferenceRangeLabel({ minNormal: 3.9, maxNormal: 7.8, unit: 'mmol/L' })).toBe(
      '3.9 - 7.8 mmol/L',
    );
  });

  it('renders one-sided ranges', () => {
    expect(buildReferenceRangeLabel({ maxNormal: 5, unit: 'mg/L' })).toBe('<= 5 mg/L');
    expect(buildReferenceRangeLabel({ minNormal: 40 })).toBe('>= 40');
    expect(buildReferenceRangeLabel({ unit: 'mmol/L' })).toBe('mmol/L');
  });

  it('offers defaults for common tests only', () => {
    expect(findLabReferenceDefaults('Random Blood Sugar').unit).toBe('mmol/L');
    expect(findLabReferenceDefaults('Fasting Blood Glucose').maxNormal).toBe(5.6);
    expect(findLabReferenceDefaults('Malaria RDT')).toEqual({});
  });
});

describe('specimen barcodes', () => {
  it('uses SMP-YYYY-NNNN with four digits', () => {
    expect(formatSpecimenBarcode(2026, 1)).toBe('SMP-2026-0001');
    expect(formatSpecimenBarcode(2026, 42)).toBe('SMP-2026-0042');
    expect(formatSpecimenBarcode(2026, 0)).toBe('SMP-2026-0001');
  });

  it('continues after the highest number for that year only', () => {
    expect(
      nextSpecimenSequence(
        ['SMP-2026-0007', 'SMP-2026-0012', 'SMP-2025-0099', 'garbage'],
        2026,
      ),
    ).toBe(13);
    expect(nextSpecimenSequence([], 2026)).toBe(1);
  });

  it('reads the latest barcode for the business', async () => {
    lab.handlers.set('lab_specimens', () => ({
      data: { specimen_barcode: 'SMP-2026-0004' },
      error: null,
    }));
    await expect(generateSpecimenBarcode(BUSINESS_ID, new Date('2026-06-15T00:00:00'))).resolves.toBe(
      'SMP-2026-0005',
    );
    const [call] = lab.calls;
    expect(call.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(call.filters).toContainEqual(['like', ['specimen_barcode', 'SMP-2026-%']]);
    expect(call.filters).toContainEqual(['order', ['specimen_barcode', { ascending: false }]]);
  });
});

describe('collectSpecimen', () => {
  it('registers the specimen, links the order items and advances the order', async () => {
    lab.handlers.set('lab_orders', (operation) =>
      operation === 'select' ? { data: { id: ORDER_ID }, error: null } : { error: null },
    );
    lab.handlers.set('lab_specimens', (operation) => {
      if (operation === 'select') return { data: null, error: null };
      return {
        data: {
          id: 'specimen-1',
          business_id: BUSINESS_ID,
          lab_order_id: ORDER_ID,
          specimen_barcode: 'SMP-2026-0001',
          specimen_type: 'blood',
          status: 'collected',
          collected_at: '2026-06-15T09:00:00Z',
          collected_by: 'tech-1',
        },
        error: null,
      };
    });
    lab.handlers.set('lab_order_items', () => ({ error: null }));
    lab.handlers.set('patient_visits', () => ({ error: null }));

    const specimen = await collectSpecimen({
      businessId: BUSINESS_ID,
      labOrderId: ORDER_ID,
      specimenType: 'blood',
    });

    expect(specimen.specimen_barcode).toBe('SMP-2026-0001');
    expect(specimen.status).toBe('collected');
    expect(specimen.collected_by).toBe('tech-1');

    const insert = lab.calls.find(
      (call) => call.table === 'lab_specimens' && call.operation === 'insert',
    );
    expect(insert?.values).toMatchObject({
      business_id: BUSINESS_ID,
      lab_order_id: ORDER_ID,
      specimen_type: 'blood',
      status: 'collected',
      collected_by: 'tech-1',
    });

    const itemLink = lab.calls.find(
      (call) => call.table === 'lab_order_items' && call.operation === 'update',
    );
    expect(itemLink?.values).toEqual({ specimen_id: 'specimen-1' });
    expect(itemLink?.filters).toContainEqual(['eq', ['lab_order_id', ORDER_ID]]);

    const orderUpdate = lab.calls.find(
      (call) => call.table === 'lab_orders' && call.operation === 'update',
    );
    expect(orderUpdate?.values).toEqual({ status: 'sample_collected' });
    expect(orderUpdate?.filters).toContainEqual(['eq', ['status', 'ordered']]);
  });

  it('retries a barcode collision', async () => {
    lab.handlers.set('lab_orders', (operation) =>
      operation === 'select' ? { data: { id: ORDER_ID }, error: null } : { error: null },
    );
    let inserts = 0;
    lab.handlers.set('lab_specimens', (operation) => {
      if (operation === 'select') {
        return { data: { specimen_barcode: 'SMP-2026-0001' }, error: null };
      }
      inserts += 1;
      if (inserts === 1) return { error: { code: '23505' } };
      return {
        data: {
          id: 'specimen-2',
          business_id: BUSINESS_ID,
          lab_order_id: ORDER_ID,
          specimen_barcode: 'SMP-2026-0002',
          specimen_type: 'urine',
          status: 'collected',
        },
        error: null,
      };
    });
    lab.handlers.set('lab_order_items', () => ({ error: null }));

    const specimen = await collectSpecimen({
      businessId: BUSINESS_ID,
      labOrderId: ORDER_ID,
      specimenType: 'urine',
      collectedBy: 'tech-2',
    });
    expect(inserts).toBe(2);
    expect(specimen.id).toBe('specimen-2');
  });

  it('refuses an order that does not belong to the tenant', async () => {
    lab.handlers.set('lab_orders', () => ({ data: null, error: null }));
    await expect(
      collectSpecimen({ businessId: BUSINESS_ID, labOrderId: ORDER_ID, specimenType: 'blood' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects an unknown specimen type before reading anything', async () => {
    await expect(
      collectSpecimen({
        businessId: BUSINESS_ID,
        labOrderId: ORDER_ID,
        // @ts-expect-error runtime guard covers untyped callers
        specimenType: 'saliva',
      }),
    ).rejects.toThrow(/specimen type/i);
  });
});

describe('recordLabResult', () => {
  it('stores the numeric bounds and the computed status', async () => {
    lab.handlers.set('lab_order_items', () => ({
      data: { id: 'item-1', result_status: 'critical' },
      error: null,
    }));

    await recordLabResult({
      businessId: BUSINESS_ID,
      itemId: 'item-1',
      resultValue: '1.9',
      referenceRange: {
        unit: 'mmol/L',
        minNormal: 3.9,
        maxNormal: 7.8,
        criticalLow: 2.5,
        criticalHigh: 25,
      },
      technicianNotes: '  Repeat requested  ',
    });

    const update = lab.calls.find(
      (call) => call.table === 'lab_order_items' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      result_value: '1.9',
      reference_range: '3.9 - 7.8 mmol/L',
      result_status: 'critical',
      unit_of_measure: 'mmol/L',
      min_normal: 3.9,
      max_normal: 7.8,
      critical_low: 2.5,
      critical_high: 25,
      technician_notes: 'Repeat requested',
      technician_id: 'tech-1',
    });
    expect(update?.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
  });

  it('falls back to the bounds already stored on the item', async () => {
    lab.handlers.set('lab_order_items', (operation) =>
      operation === 'select'
        ? {
            data: {
              min_normal: 3.9,
              max_normal: 7.8,
              critical_low: 2.5,
              critical_high: 25,
              unit_of_measure: 'mmol/L',
            },
            error: null,
          }
        : { data: { id: 'item-1' }, error: null },
    );

    await recordLabResult({
      businessId: BUSINESS_ID,
      itemId: 'item-1',
      resultValue: '1.9',
    });

    const update = lab.calls.find(
      (call) => call.table === 'lab_order_items' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({ result_status: 'critical', unit_of_measure: 'mmol/L' });
  });

  it('marks an empty result pending and clears the completion stamp', async () => {
    lab.handlers.set('lab_order_items', () => ({ data: { id: 'item-1' }, error: null }));
    await recordLabResult({
      businessId: BUSINESS_ID,
      itemId: 'item-1',
      resultValue: '   ',
      referenceRange: {},
    });
    const update = lab.calls.find(
      (call) => call.table === 'lab_order_items' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      result_value: null,
      result_status: 'pending',
      completed_at: null,
    });
  });
});

describe('specimen rejection', () => {
  it('requires a reason and scopes the update to the tenant', async () => {
    lab.handlers.set('lab_specimens', () => ({ error: null }));
    await rejectSpecimen(BUSINESS_ID, 'specimen-1', 'Haemolysed sample');
    const update = lab.calls.find(
      (call) => call.table === 'lab_specimens' && call.operation === 'update',
    );
    expect(update?.values).toEqual({
      status: 'rejected',
      rejection_reason: 'Haemolysed sample',
    });
    expect(update?.filters).toContainEqual(['eq', ['id', 'specimen-1']]);
    expect(update?.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);

    await expect(rejectSpecimen(BUSINESS_ID, 'specimen-1', ' ')).rejects.toThrow(/reason/i);
  });
});

describe('verifyLabOrder', () => {
  it('refuses to verify while a result is still pending', async () => {
    lab.handlers.set('lab_order_items', () => ({
      data: [
        { id: 'item-1', result_status: 'normal' },
        { id: 'item-2', result_status: 'pending' },
      ],
      error: null,
    }));
    await expect(verifyLabOrder(BUSINESS_ID, ORDER_ID)).rejects.toThrow(/1 result still pending/i);
    expect(lab.calls.some((call) => call.table === 'lab_orders')).toBe(false);
  });

  it('stamps every item, completes the order and returns the visit to the doctor', async () => {
    lab.handlers.set('lab_order_items', (operation) =>
      operation === 'select'
        ? {
            data: [
              { id: 'item-1', result_status: 'normal' },
              { id: 'item-2', result_status: 'critical' },
            ],
            error: null,
          }
        : { error: null },
    );
    lab.handlers.set('lab_orders', (operation) => {
      if (operation === 'update') {
        return { data: { id: ORDER_ID, visit_id: 'visit-1' }, error: null };
      }
      return { data: order({ status: 'completed', verified_at: '2026-06-15T10:00:00Z' }), error: null };
    });
    lab.handlers.set('patient_visits', () => ({ error: null }));

    const verified = await verifyLabOrder(BUSINESS_ID, ORDER_ID);
    expect(verified.status).toBe('completed');

    const itemUpdate = lab.calls.filter(
      (call) => call.table === 'lab_order_items' && call.operation === 'update',
    )[0];
    expect(itemUpdate.values).toMatchObject({ technician_id: 'tech-1' });
    expect(itemUpdate.values).toHaveProperty('verified_at');
    expect(itemUpdate.filters).toContainEqual(['eq', ['lab_order_id', ORDER_ID]]);

    const orderUpdate = lab.calls.find(
      (call) => call.table === 'lab_orders' && call.operation === 'update',
    );
    expect(orderUpdate?.values).toMatchObject({
      status: 'completed',
      verified_by: 'tech-1',
    });

    const visitUpdates = lab.calls.filter(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(visitUpdates[0]?.values).toEqual({ stage: 'in_diagnostics' });
    expect(visitUpdates[0]?.filters).toContainEqual(['eq', ['stage', 'in_lab']]);
    // Imaging has no open order in this fixture, so the patient loops straight
    // back to the doctor for results review.
    expect(visitUpdates[1]?.values).toMatchObject({
      stage: 'results_review',
      results_ready_for_review: true,
    });
  });
});

describe('worklist buckets', () => {
  function specimenOrder(
    status: LabOrder['status'],
    specimenStatus: 'pending' | 'collected' | 'in_analysis' | 'rejected',
    resultStatus: 'pending' | 'normal' = 'pending',
  ): LabOrder {
    return order({
      status,
      specimens: [
        {
          id: 'specimen-1',
          business_id: BUSINESS_ID,
          lab_order_id: ORDER_ID,
          specimen_barcode: 'SMP-2026-0001',
          specimen_type: 'blood',
          status: specimenStatus,
        },
      ],
      items: [
        {
          id: 'item-1',
          test_name: 'Random Blood Sugar',
          unit_price: 5000,
          result_value: resultStatus === 'pending' ? null : '5.2',
          result_status: resultStatus,
        },
      ],
    });
  }

  it('routes orders to the right tab', () => {
    const worklist = splitLabWorklist([
      specimenOrder('ordered', 'pending'),
      specimenOrder('sample_collected', 'collected'),
      specimenOrder('sample_collected', 'in_analysis'),
      specimenOrder('sample_collected', 'collected', 'normal'),
      specimenOrder('completed', 'collected', 'normal'),
      specimenOrder('sample_collected', 'rejected'),
    ]);

    expect(worklist.awaitingCollection).toHaveLength(2);
    expect(worklist.collected).toHaveLength(1);
    expect(worklist.inAnalysis).toHaveLength(1);
    expect(worklist.pendingVerification).toHaveLength(1);
    expect(worklist.verified).toHaveLength(1);
  });
});

describe('getLabOrders', () => {
  it('reads non-cancelled orders for the tenant with patient, items and specimens', async () => {
    lab.handlers.set('lab_orders', () => ({ data: [order()], error: null }));
    await expect(getLabOrders(BUSINESS_ID)).resolves.toHaveLength(1);
    const [call] = lab.calls;
    expect(call.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(call.filters).toContainEqual(['neq', ['status', 'cancelled']]);
    expect(String(call.filters.find(([name]) => name === 'select')?.[1][0])).toContain(
      'items:lab_order_items',
    );
  });

  it('returns nothing without a business', async () => {
    await expect(getLabOrders('')).resolves.toEqual([]);
    expect(lab.calls).toHaveLength(0);
  });
});
