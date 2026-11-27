import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicationBatch, PharmacyQueueVisit, Prescription } from '@/types/healthcare';

/**
 * PostgREST chain mock. Handlers decide what a table returns; `calls` keeps the
 * operation, payload and filter arguments so query-shape regressions (FEFO
 * ordering, tenant scoping) are caught without a database.
 */
const ph = vi.hoisted(() => ({
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
  rpc: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  user: { id: 'user-1' },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let operation = 'select';
    let values: unknown = null;
    const filters: Array<[string, unknown[]]> = [];

    const resolve = () => {
      ph.calls.push({ table, operation, values, filters });
      const handler = ph.handlers.get(table);
      return handler ? handler(operation, values, filters) : { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const passthrough = (name: string) => (...args: unknown[]) => {
      filters.push([name, args]);
      return builder;
    };

    Object.assign(builder, {
      select: (columns?: unknown) => {
        filters.push(['select', [columns]]);
        return builder;
      },
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
      eq: passthrough('eq'),
      neq: passthrough('neq'),
      in: passthrough('in'),
      gt: passthrough('gt'),
      gte: passthrough('gte'),
      lt: passthrough('lt'),
      lte: passthrough('lte'),
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
      rpc: (name: string, args: unknown) => {
        ph.rpcCalls.push({ name, args });
        return Promise.resolve(ph.rpc);
      },
      auth: {
        getUser: async () => ({ data: { user: ph.user } }),
      },
    },
  };
});

const {
  addDaysToDateKey,
  countPendingItems,
  createMedicationBatch,
  daysUntilExpiry,
  dispensePrescriptionItem,
  getBatchExpiryStatus,
  getDispensationLogs,
  getMedicationBatches,
  getPharmacyDispensaryQueue,
  isBatchExpired,
  isBatchNearExpiry,
  isPrescriptionAwaitingDispense,
  isVisitAwaitingDispense,
  pendingPrescriptionItems,
  pickFefoBatch,
  remainingAfterDispense,
  sortBatchesFefo,
} = await import('../pharmacyService');

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const TODAY = new Date('2026-06-15T10:00:00');

function batch(overrides: Partial<MedicationBatch> = {}): MedicationBatch {
  return {
    id: 'batch-1',
    business_id: BUSINESS_ID,
    medication_name: 'Amoxicillin 500mg',
    batch_number: 'AMX-01',
    quantity_received: 100,
    quantity_on_hand: 40,
    unit_cost: 120,
    expiry_date: '2027-01-31',
    received_date: '2026-01-10',
    ...overrides,
  };
}

function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: 'prescription-1',
    status: 'pending',
    items: [
      {
        id: 'item-1',
        medication_name: 'Amoxicillin 500mg',
        dosage: '500mg',
        frequency: 'TDS',
        duration_days: 5,
        quantity: 15,
        unit_price: 120,
        is_dispensed: false,
      },
      {
        id: 'item-2',
        medication_name: 'Paracetamol 500mg',
        dosage: '500mg',
        frequency: 'PRN',
        duration_days: 3,
        quantity: 9,
        unit_price: 50,
        is_dispensed: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  ph.handlers.clear();
  ph.calls.length = 0;
  ph.rpcCalls.length = 0;
  ph.rpc = { data: null, error: null };
  ph.user = { id: 'user-1' };
});

describe('date helpers', () => {
  it('adds days to a date key without timezone drift', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateKey('2026-06-15', 60)).toBe('2026-08-14');
    expect(addDaysToDateKey('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('pharmacy expiry helpers', () => {
  it('treats the expiry date itself as expired', () => {
    expect(isBatchExpired({ expiry_date: '2026-06-15' }, TODAY)).toBe(true);
    expect(isBatchExpired({ expiry_date: '2026-06-14' }, TODAY)).toBe(true);
    expect(isBatchExpired({ expiry_date: '2026-06-16' }, TODAY)).toBe(false);
  });

  it('flags stock inside the 60-day window, excluding expired stock', () => {
    expect(isBatchNearExpiry({ expiry_date: '2026-08-14' }, 60, TODAY)).toBe(true);
    expect(isBatchNearExpiry({ expiry_date: '2026-08-15' }, 60, TODAY)).toBe(false);
    expect(isBatchNearExpiry({ expiry_date: '2026-06-15' }, 60, TODAY)).toBe(false);
    expect(daysUntilExpiry({ expiry_date: '2026-06-25' }, TODAY)).toBe(10);
  });

  it('classifies each batch once', () => {
    expect(getBatchExpiryStatus({ expiry_date: '2026-06-01' }, 60, TODAY)).toBe('expired');
    expect(getBatchExpiryStatus({ expiry_date: '2026-07-01' }, 60, TODAY)).toBe('near_expiry');
    expect(getBatchExpiryStatus({ expiry_date: '2028-01-01' }, 60, TODAY)).toBe('valid');
  });
});

describe('FEFO ordering', () => {
  it('sorts by expiry, then oldest delivery, without mutating the input', () => {
    const input = [
      batch({ id: 'later', expiry_date: '2027-03-01', received_date: '2026-01-01' }),
      batch({ id: 'sooner-newer', expiry_date: '2026-12-01', received_date: '2026-05-01' }),
      batch({ id: 'sooner-older', expiry_date: '2026-12-01', received_date: '2026-02-01' }),
    ];
    const sorted = sortBatchesFefo(input);
    expect(sorted.map((row) => row.id)).toEqual(['sooner-older', 'sooner-newer', 'later']);
    expect(input[0].id).toBe('later');
  });

  it('picks the first non-expired batch that still has stock', () => {
    const picked = pickFefoBatch(
      [
        batch({ id: 'expired', expiry_date: '2026-05-01', quantity_on_hand: 100 }),
        batch({ id: 'empty', expiry_date: '2026-09-01', quantity_on_hand: 0 }),
        batch({ id: 'usable', expiry_date: '2026-10-01', quantity_on_hand: 5 }),
        batch({ id: 'later', expiry_date: '2027-01-01', quantity_on_hand: 50 }),
      ],
      TODAY,
    );
    expect(picked?.id).toBe('usable');
  });

  it('returns null when only expired stock remains', () => {
    expect(pickFefoBatch([batch({ expiry_date: '2026-01-01' })], TODAY)).toBeNull();
  });
});

describe('dispensary queue helpers', () => {
  it('lists only the lines still owed to the patient', () => {
    expect(pendingPrescriptionItems(prescription()).map((item) => item.id)).toEqual(['item-1']);
  });

  it('treats partially dispensed and pending scripts as open, cancelled as closed', () => {
    expect(isPrescriptionAwaitingDispense(prescription())).toBe(true);
    expect(isPrescriptionAwaitingDispense(prescription({ status: 'partially_dispensed' }))).toBe(true);
    expect(isPrescriptionAwaitingDispense(prescription({ status: 'dispensed' }))).toBe(false);
    expect(
      isPrescriptionAwaitingDispense(prescription({ status: 'cancelled' })),
    ).toBe(false);
  });

  it('counts pending lines and keeps only waiting visits', () => {
    const visit = {
      prescriptions: [prescription(), prescription({ id: 'prescription-2', status: 'dispensed' })],
    } as Pick<PharmacyQueueVisit, 'prescriptions'>;
    expect(countPendingItems(visit)).toBe(1);
    expect(isVisitAwaitingDispense(visit)).toBe(true);
    expect(
      isVisitAwaitingDispense({ prescriptions: [prescription({ status: 'dispensed' })] }),
    ).toBe(false);
  });

  it('never reports negative remaining stock', () => {
    expect(remainingAfterDispense({ quantity_on_hand: 5 }, 2)).toBe(3);
    expect(remainingAfterDispense({ quantity_on_hand: 1 }, 4)).toBe(0);
  });
});

describe('getMedicationBatches', () => {
  it('scopes to the tenant, excludes empty batches and orders expiry ascending', async () => {
    const rows = [batch({ id: 'b1' })];
    ph.handlers.set('medication_batches', () => ({ data: rows, error: null }));

    await expect(getMedicationBatches(BUSINESS_ID)).resolves.toEqual(rows);
    expect(ph.calls).toHaveLength(1);
    const [call] = ph.calls;
    expect(call.table).toBe('medication_batches');
    expect(call.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(call.filters).toContainEqual(['gt', ['quantity_on_hand', 0]]);
    expect(call.filters).toContainEqual(['order', ['expiry_date', { ascending: true }]]);
  });

  it('narrows to one drug and can include depleted stock for inventory', async () => {
    ph.handlers.set('medication_batches', () => ({ data: [], error: null }));
    await getMedicationBatches(BUSINESS_ID, '  Amoxicillin  ', { includeDepleted: true });
    const [call] = ph.calls;
    expect(call.filters).toContainEqual(['ilike', ['medication_name', 'Amoxicillin']]);
    expect(call.filters).not.toContainEqual(['gt', ['quantity_on_hand', 0]]);
  });

  it('surfaces database errors', async () => {
    ph.handlers.set('medication_batches', () => ({ error: new Error('rls denied') }));
    await expect(getMedicationBatches(BUSINESS_ID)).rejects.toThrow('rls denied');
  });
});

describe('createMedicationBatch', () => {
  const input = {
    businessId: BUSINESS_ID,
    medicationName: '  Amoxicillin 500mg ',
    batchNumber: ' AMX-99 ',
    quantityReceived: 120,
    unitCost: 115.5,
    expiryDate: '2027-05-31',
    supplierName: '  Pharma Ltd ',
  };

  it('receives a batch into both received and on-hand stock', async () => {
    ph.handlers.set('medication_batches', () => ({ data: batch({ id: 'new' }), error: null }));
    await createMedicationBatch(input);
    const insert = ph.calls[0].values as Record<string, unknown>;
    expect(insert).toMatchObject({
      business_id: BUSINESS_ID,
      medication_name: 'Amoxicillin 500mg',
      batch_number: 'AMX-99',
      quantity_received: 120,
      quantity_on_hand: 120,
      unit_cost: 115.5,
      expiry_date: '2027-05-31',
      supplier_name: 'Pharma Ltd',
    });
  });

  it('refuses expired stock before touching the database', async () => {
    await expect(
      createMedicationBatch({ ...input, expiryDate: '2020-01-01' }),
    ).rejects.toThrow(/expired/i);
    expect(ph.calls).toHaveLength(0);
  });

  it('rejects non-positive quantities and negative cost', async () => {
    await expect(createMedicationBatch({ ...input, quantityReceived: 0 })).rejects.toThrow(
      /greater than zero/i,
    );
    await expect(createMedicationBatch({ ...input, unitCost: -1 })).rejects.toThrow(/negative/i);
  });
});

describe('getPharmacyDispensaryQueue', () => {
  it('keeps visits with an open script and drops dispensed lines', async () => {
    ph.handlers.set('patient_visits', () => ({
      data: [
        {
          id: 'visit-1',
          visit_number: 'VST-2026-0001',
          visit_date: '2026-06-15',
          stage: 'at_pharmacy',
          patient: { id: 'patient-1', mrn: 'PAT-2026-0001', first_name: 'Jane', last_name: 'Banda' },
          prescriptions: [prescription()],
        },
        {
          id: 'visit-2',
          visit_number: 'VST-2026-0002',
          visit_date: '2026-06-15',
          stage: 'at_pharmacy',
          patient: { id: 'patient-2', mrn: 'PAT-2026-0002', first_name: 'John', last_name: 'Phiri' },
          prescriptions: [prescription({ status: 'dispensed' })],
        },
      ],
      error: null,
    }));

    const queue = await getPharmacyDispensaryQueue(BUSINESS_ID);
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('visit-1');
    expect(queue[0].prescriptions[0].items.map((item) => item.id)).toEqual(['item-1']);

    const call = ph.calls.find((row) => row.table === 'patient_visits');
    expect(call?.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(call?.filters).toContainEqual([
      'in',
      ['stage', ['with_doctor', 'in_lab', 'at_pharmacy', 'in_billing']],
    ]);
  });

  it('returns an empty list without a business id', async () => {
    await expect(getPharmacyDispensaryQueue('')).resolves.toEqual([]);
    expect(ph.calls).toHaveLength(0);
  });
});

describe('dispensePrescriptionItem', () => {
  const input = {
    businessId: BUSINESS_ID,
    prescriptionItemId: 'item-1',
    batchId: 'batch-1',
    quantity: 15,
    notes: 'Counselled on completion',
  };

  it('calls the atomic RPC and maps the snake_case confirmation', async () => {
    ph.rpc = {
      data: {
        dispensation_id: 'disp-1',
        prescription_item_id: 'item-1',
        batch_id: 'batch-1',
        quantity_dispensed: 15,
        batch_quantity_remaining: 25,
        prescription_status: 'dispensed',
        item_fully_dispensed: true,
        quantity_remaining_on_item: 0,
        visit_stage: 'in_billing',
      },
      error: null,
    };

    await expect(dispensePrescriptionItem(input)).resolves.toEqual({
      dispensationId: 'disp-1',
      prescriptionItemId: 'item-1',
      batchId: 'batch-1',
      quantityDispensed: 15,
      batchQuantityRemaining: 25,
      prescriptionStatus: 'dispensed',
      itemFullyDispensed: true,
      quantityRemainingOnItem: 0,
      visitStage: 'in_billing',
    });

    expect(ph.rpcCalls).toEqual([
      {
        name: 'dispense_prescription_item',
        args: {
          p_business_id: BUSINESS_ID,
          p_prescription_item_id: 'item-1',
          p_batch_id: 'batch-1',
          p_quantity: 15,
          p_notes: 'Counselled on completion',
        },
      },
    ]);
  });

  it('reports a split line when the RPC leaves a remainder', async () => {
    ph.rpc = {
      data: {
        dispensationId: 'disp-2',
        prescriptionItemId: 'item-1',
        batchId: 'batch-1',
        quantityDispensed: 5,
        batchQuantityRemaining: 0,
        prescriptionStatus: 'partially_dispensed',
        itemFullyDispensed: false,
        quantityRemainingOnItem: 10,
        visitStage: 'at_pharmacy',
      },
      error: null,
    };

    await expect(dispensePrescriptionItem({ ...input, quantity: 5 })).resolves.toMatchObject({
      quantityDispensed: 5,
      prescriptionStatus: 'partially_dispensed',
      itemFullyDispensed: false,
      quantityRemainingOnItem: 10,
      visitStage: 'at_pharmacy',
    });
  });

  it('rejects zero quantities before the RPC', async () => {
    await expect(dispensePrescriptionItem({ ...input, quantity: 0 })).rejects.toThrow(
      /greater than zero/i,
    );
    expect(ph.rpcCalls).toHaveLength(0);
  });

  it('propagates the stock guard from the database', async () => {
    ph.rpc = { data: null, error: new Error('Insufficient stock: 5 on hand, 15 requested.') };
    await expect(dispensePrescriptionItem(input)).rejects.toThrow(/Insufficient stock/);
  });

  it('refuses a silent success with no confirmation body', async () => {
    ph.rpc = { data: null, error: null };
    await expect(dispensePrescriptionItem(input)).rejects.toThrow(/confirmation/i);
  });
});

describe('getDispensationLogs', () => {
  it('reads newest first with the batch and item joined', async () => {
    ph.handlers.set('dispensation_records', () => ({
      data: [{ id: 'disp-1', batch: { id: 'batch-1' } }],
      error: null,
    }));
    await expect(getDispensationLogs(BUSINESS_ID, 25)).resolves.toHaveLength(1);
    const [call] = ph.calls;
    expect(call.filters).toContainEqual(['eq', ['business_id', BUSINESS_ID]]);
    expect(call.filters).toContainEqual(['order', ['dispensed_at', { ascending: false }]]);
    expect(call.filters).toContainEqual(['limit', [25]]);
  });
});
