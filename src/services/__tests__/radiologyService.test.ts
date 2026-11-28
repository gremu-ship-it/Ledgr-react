import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      upsert: (input: unknown) => {
        operation = 'upsert';
        values = input;
        return builder;
      },
      delete: () => {
        operation = 'delete';
        return builder;
      },
      eq: passthrough,
      neq: passthrough,
      in: passthrough,
      ilike: passthrough,
      like: passthrough,
      or: passthrough,
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

import {
  calculateDiagnosticTotal,
  calculateRadiologyOrderTotal,
  createRadiologyOrder,
  formatRadiologyOrderNumber,
  generateRadiologyOrderNumber,
  parseRadiologyOrderNumber,
  recordScanFindings,
} from '../radiologyService';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  hc.handlers.clear();
  hc.calls.length = 0;
});

describe('radiology order numbers', () => {
  it('formats and parses RAD-YYYY-XXXX', () => {
    expect(formatRadiologyOrderNumber(2026, 7)).toBe('RAD-2026-0007');
    expect(formatRadiologyOrderNumber(2026, 1234)).toBe('RAD-2026-1234');
    expect(parseRadiologyOrderNumber('RAD-2026-0042')).toEqual({ year: 2026, sequence: 42 });
    expect(parseRadiologyOrderNumber('RAD-26-0042')).toBeNull();
  });

  it('allocates the next number from the highest order this year', async () => {
    hc.handlers.set('radiology_orders', (operation) =>
      operation === 'select'
        ? {
            data: [{ order_number: 'RAD-2026-0010' }, { order_number: 'RAD-2026-0007' }],
            error: null,
          }
        : { data: null, error: null },
    );

    await expect(
      generateRadiologyOrderNumber(BUSINESS_ID, new Date('2026-11-27T08:00:00Z')),
    ).resolves.toBe('RAD-2026-0011');
  });
});

describe('radiology requisitions', () => {
  it('creates a header + scan lines and flags the visit as pending imaging', async () => {
    hc.handlers.set('radiology_orders', (operation, values) => {
      if (operation === 'select') {
        return { data: [{ order_number: 'RAD-2026-0004' }], error: null };
      }
      return {
        data: { id: ORDER_ID, ...(values as Record<string, unknown>) },
        error: null,
      };
    });
    hc.handlers.set('radiology_order_items', (operation, values) => {
      if (operation === 'insert') {
        return {
          data: (values as Array<Record<string, unknown>>).map((row, index) => ({
            id: `${ITEM_ID}-${index}`,
            ...row,
          })),
          error: null,
        };
      }
      return { data: null, error: null };
    });
    hc.handlers.set('patient_visits', () => ({ data: null, error: null }));

    const order = await createRadiologyOrder({
      businessId: BUSINESS_ID,
      visitId: VISIT_ID,
      patientId: PATIENT_ID,
      doctorId: 'doctor-1',
      clinicalIndication: 'Rule out pneumonia',
      urgency: 'urgent',
      items: [
        { modality: 'xray', procedureName: 'Chest X-Ray PA', bodySite: 'Chest', unitPrice: 25000 },
        { modality: 'ultrasound', procedureName: 'Abdominal ultrasound', unitPrice: 18000 },
      ],
      now: new Date('2026-11-27T08:00:00Z'),
    });

    expect(order.order_number).toBe('RAD-2026-0005');
    expect(order.urgency).toBe('urgent');
    expect(order.items).toHaveLength(2);

    const itemInsert = hc.calls.find(
      (call) => call.table === 'radiology_order_items' && call.operation === 'insert',
    );
    expect(itemInsert?.values).toHaveLength(2);
    expect((itemInsert?.values as Array<Record<string, unknown>>)[0]).toMatchObject({
      radiology_order_id: ORDER_ID,
      business_id: BUSINESS_ID,
      modality: 'xray',
      procedure_name: 'Chest X-Ray PA',
      status: 'pending',
    });

    const visitUpdate = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(visitUpdate?.values).toMatchObject({
      has_pending_radiology: true,
      stage: 'in_radiology',
      results_ready_for_review: false,
    });
    expect(calculateRadiologyOrderTotal(order.items)).toBe(43000);
    expect(calculateDiagnosticTotal(order.items)).toBe(43000);
  });

  it('captures findings + impression, signs the scan off and loops the doctor back', async () => {
    hc.handlers.set('radiology_order_items', (operation) => {
      if (operation === 'update') {
        return {
          data: {
            id: ITEM_ID,
            radiology_order_id: ORDER_ID,
            business_id: BUSINESS_ID,
            modality: 'xray',
            procedure_name: 'Chest X-Ray PA',
            status: 'completed',
            unit_price: 25000,
          },
          error: null,
        };
      }
      return { data: [], error: null };
    });
    hc.handlers.set('radiology_orders', (operation, values) => {
      if (operation === 'update') {
        return {
          data: {
            id: ORDER_ID,
            business_id: BUSINESS_ID,
            visit_id: VISIT_ID,
            order_number: 'RAD-2026-0005',
            ...(values as Record<string, unknown>),
          },
          error: null,
        };
      }
      return { data: [], error: null };
    });
    hc.handlers.set('patient_visits', () => ({ data: null, error: null }));
    hc.handlers.set('lab_orders', () => ({ data: [], error: null }));

    const result = await recordScanFindings({
      businessId: BUSINESS_ID,
      itemId: ITEM_ID,
      orderId: ORDER_ID,
      findings: 'Patchy right lower lobe consolidation.',
      impression: 'Right lower lobe pneumonia.',
      recommendations: 'Follow-up after antibiotics.',
      imageUrls: ['https://images.example/xray-1.jpg'],
      radiologistId: 'radiologist-1',
    });

    expect(result.orderCompleted).toBe(true);
    const itemUpdate = hc.calls.find(
      (call) => call.table === 'radiology_order_items' && call.operation === 'update',
    );
    expect(itemUpdate?.values).toMatchObject({
      findings: 'Patchy right lower lobe consolidation.',
      impression: 'Right lower lobe pneumonia.',
    });
    expect((itemUpdate?.values as { reported_at: string }).reported_at).toBeTruthy();

    const orderUpdate = hc.calls.find(
      (call) => call.table === 'radiology_orders' && call.operation === 'update',
    );
    expect(orderUpdate?.values).toMatchObject({ status: 'completed' });

    const visitUpdates = hc.calls.filter(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(visitUpdates.some((call) => (call.values as { stage?: string }).stage === 'in_diagnostics')).toBe(true);
    expect(
      visitUpdates.some(
        (call) =>
          (call.values as { stage?: string; results_ready_for_review?: boolean }).stage ===
            'results_review' &&
          (call.values as { results_ready_for_review?: boolean }).results_ready_for_review === true,
      ),
    ).toBe(true);
  });
});
