import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBillItems,
  calculateBmi,
  checkInPatientVisit,
  computeBillTotals,
  createInvoiceForVisit,
  describeAllergyWarnings,
  findAllergyWarnings,
  formatMrn,
  generateNextMrn,
  getPatientVisitBill,
  mrnPrefix,
  nextSequenceNumber,
  recordTriageVitals,
  saveConsultation,
  saveVisitLabOrder,
  saveVisitPrescription,
} from '../healthcareService';

/**
 * A tiny PostgREST-compatible chain. Every handler receives the operation and
 * the values passed to insert/update so a test can decide what each table
 * returns without standing up a database.
 */
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

const { reserveInvoiceNumber } = vi.hoisted(() => ({
  reserveInvoiceNumber: vi.fn(async () => 'INV-0042'),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    business: {
      reserveNextInvoiceNumber: reserveInvoiceNumber,
    },
  },
}));

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';

const BASE_PATIENT = {
  id: PATIENT_ID,
  business_id: BUSINESS_ID,
  mrn: 'PAT-2026-0001',
  first_name: 'Jane',
  last_name: 'Banda',
  billing_type: 'insurance' as const,
  insurance_provider: 'MASM',
  allergies: ['Penicillin'],
};

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VISIT_ID,
    business_id: BUSINESS_ID,
    patient_id: PATIENT_ID,
    visit_number: 'VST-2026-0001',
    visit_date: '2026-11-27',
    visit_type: 'outpatient',
    stage: 'registered',
    patient: BASE_PATIENT,
    ...overrides,
  };
}

beforeEach(() => {
  hc.handlers.clear();
  hc.calls.length = 0;
  reserveInvoiceNumber.mockClear();
});

describe('MRN and document numbering', () => {
  it('formats an MRN as PAT-YYYY-XXXX with four-digit padding', () => {
    expect(formatMrn(2026, 1)).toBe('PAT-2026-0001');
    expect(formatMrn(2026, 42)).toBe('PAT-2026-0042');
    expect(mrnPrefix(2031)).toBe('PAT-2031-');
  });

  it('increments the highest existing number and restarts at 0001 when empty', () => {
    expect(nextSequenceNumber('PAT-2026-', 'PAT-2026-0007')).toBe('PAT-2026-0008');
    expect(nextSequenceNumber('PAT-2026-', null)).toBe('PAT-2026-0001');
    expect(nextSequenceNumber('PAT-2026-', 'VST-2026-0031')).toBe('PAT-2026-0001');
    expect(nextSequenceNumber('PAT-2026-', 'PAT-2026-0999')).toBe('PAT-2026-1000');
  });

  it('generates the next MRN from the tenant maximum for the current year', async () => {
    hc.handlers.set('patients', (operation) => {
      if (operation !== 'select') return { data: null, error: null };
      return { data: [{ mrn: 'PAT-2026-0007' }], error: null };
    });

    const mrn = await generateNextMrn(BUSINESS_ID, new Date('2026-11-27T10:00:00Z'));
    expect(mrn).toBe('PAT-2026-0008');
    expect(hc.calls[0]).toMatchObject({ table: 'patients', operation: 'select' });
  });

  it('starts a new tenant registry at PAT-YYYY-0001', async () => {
    hc.handlers.set('patients', () => ({ data: [], error: null }));
    await expect(generateNextMrn(BUSINESS_ID, new Date('2026-01-04T08:00:00Z')))
      .resolves.toBe('PAT-2026-0001');
  });
});

describe('visit check-in and triage', () => {
  it('registers a visit with the next number, tenant id and the registered stage', async () => {
    hc.handlers.set('patient_visits', (operation) => {
      if (operation === 'select') return { data: [{ visit_number: 'VST-2026-0004' }], error: null };
      if (operation === 'insert') return { data: visitRow({ visit_number: 'VST-2026-0005' }), error: null };
      return { data: null, error: null };
    });

    const visit = await checkInPatientVisit(
      BUSINESS_ID,
      PATIENT_ID,
      'outpatient',
      new Date('2026-11-27T09:15:00Z'),
    );

    expect(visit.visit_number).toBe('VST-2026-0005');
    expect(visit.stage).toBe('registered');
    expect(visit.patient?.mrn).toBe('PAT-2026-0001');

    const insert = hc.calls.find((call) => call.table === 'patient_visits' && call.operation === 'insert');
    expect(insert?.values).toMatchObject({
      business_id: BUSINESS_ID,
      patient_id: PATIENT_ID,
      visit_number: 'VST-2026-0005',
      visit_date: '2026-11-27',
      visit_type: 'outpatient',
      stage: 'registered',
    });
  });

  it('records vitals and moves the visit to triaged with an audit timestamp', async () => {
    hc.handlers.set('patient_visits', () => ({ data: null, error: null }));

    await recordTriageVitals(
      VISIT_ID,
      {
        systolic_bp: 120,
        diastolic_bp: 80,
        temperature: 37.2,
        heart_rate: 72,
        oxygen_saturation: 98,
        weight_kg: 70,
        height_cm: 175,
      },
      'doctor-1',
    );

    const update = hc.calls.find((call) => call.operation === 'update');
    expect(update?.values).toMatchObject({
      systolic_bp: 120,
      diastolic_bp: 80,
      temperature: 37.2,
      heart_rate: 72,
      oxygen_saturation: 98,
      weight_kg: 70,
      height_cm: 175,
      stage: 'triaged',
      triaged_by: 'doctor-1',
    });
    expect(typeof (update?.values as Record<string, unknown>).triaged_at).toBe('string');
  });

  it('derives BMI from weight and height without persisting it', () => {
    expect(calculateBmi(70, 175)).toBe(22.9);
    expect(calculateBmi('90', '180')).toBe(27.8);
    expect(calculateBmi(0, 175)).toBeNull();
    expect(calculateBmi(70, null)).toBeNull();
  });
});

describe('patient bill calculation', () => {
  it('sums the consultation fee, lab tests and prescription lines with no VAT', async () => {
    hc.handlers.set('patient_visits', () => ({ data: visitRow(), error: null }));
    hc.handlers.set('lab_orders', () => ({
      data: [
        {
          id: 'lab-1',
          status: 'completed',
          items: [
            { id: 'li-1', lab_order_id: 'lab-1', test_name: 'Full Blood Count (FBC)', unit_price: 8000 },
            { id: 'li-2', lab_order_id: 'lab-1', test_name: 'Malaria RDT', unit_price: 3000 },
          ],
        },
      ],
      error: null,
    }));
    hc.handlers.set('prescriptions', () => ({
      data: [
        {
          id: 'rx-1',
          status: 'pending',
          items: [
            {
              id: 'rxi-1',
              prescription_id: 'rx-1',
              medication_name: 'Amoxicillin',
              dosage: '500mg',
              frequency: 'TDS',
              duration_days: 5,
              quantity: 2,
              unit_price: 1500,
            },
          ],
        },
      ],
      error: null,
    }));

    const bill = await getPatientVisitBill(VISIT_ID);

    expect(bill.patientName).toBe('Jane Banda');
    expect(bill.mrn).toBe('PAT-2026-0001');
    expect(bill.billingType).toBe('insurance');
    expect(bill.insuranceProvider).toBe('MASM');
    expect(bill.items).toHaveLength(4);
    expect(bill.items.filter((item) => item.category === 'laboratory')).toHaveLength(2);
    expect(bill.items.find((item) => item.category === 'pharmacy')?.total).toBe(3000);
    expect(bill.subtotal).toBe(15_000 + 8_000 + 3_000 + 3_000);
    expect(bill.tax).toBe(0);
    expect(bill.total).toBe(29_000);
  });

  it('adds one accommodation line per ward when the visit has an inpatient stay', async () => {
    hc.handlers.set('patient_visits', () => ({ data: visitRow(), error: null }));
    hc.handlers.set('lab_orders', () => ({ data: [], error: null }));
    hc.handlers.set('prescriptions', () => ({ data: [], error: null }));
    hc.handlers.set('patient_admissions', () => ({
      data: {
        id: 'adm-1',
        business_id: BUSINESS_ID,
        visit_id: VISIT_ID,
        patient_id: PATIENT_ID,
        admission_number: 'ADM-2026-0007',
        status: 'discharged',
        admitted_at: '2026-01-01T08:00:00.000Z',
        discharged_at: '2026-01-05T08:00:00.000Z',
      },
      error: null,
    }));
    hc.handlers.set('bed_allocations', () => ({
      data: [
        {
          assigned_at: '2026-01-01T08:00:00.000Z',
          released_at: '2026-01-03T08:00:00.000Z',
          daily_rate_applied: '50000.00',
          bed: { bed_number: 'Bed 1', ward: { name: 'General Ward A', ward_type: 'general' } },
        },
        {
          assigned_at: '2026-01-03T08:00:00.000Z',
          released_at: '2026-01-05T08:00:00.000Z',
          daily_rate_applied: 80_000,
          bed: { bed_number: 'Bed 9', ward: { name: 'Private Wing', ward_type: 'private' } },
        },
      ],
      error: null,
    }));

    const bill = await getPatientVisitBill(VISIT_ID);
    const accommodation = bill.items.filter((item) => item.category === 'accommodation');

    expect(accommodation).toHaveLength(2);
    expect(accommodation[0]).toMatchObject({
      quantity: 2,
      unitPrice: 50_000,
      total: 100_000,
    });
    expect(accommodation[1]).toMatchObject({
      quantity: 2,
      unitPrice: 80_000,
      total: 160_000,
    });
    expect(accommodation[1].description).toContain('Private Wing');
    expect(bill.subtotal).toBe(15_000 + 260_000);
    expect(bill.total).toBe(275_000);
  });

  it('builds bill lines from raw clinical rows and rounds money to cents', () => {
    const items = buildBillItems({
      consultationFee: 15_000,
      labItems: [{ test_name: 'Urinalysis', unit_price: '5000.50' }],
      prescriptionItems: [
        { medication_name: 'Paracetamol', dosage: '1g', quantity: '3', unit_price: '250.25' },
        { medication_name: 'ORS', dosage: null, quantity: null, unit_price: null },
      ],
    });

    expect(items.map((item) => item.category)).toEqual([
      'consultation',
      'laboratory',
      'pharmacy',
      'pharmacy',
    ]);
    expect(items[2]).toMatchObject({ quantity: 3, unitPrice: 250.25, total: 750.75 });
    expect(items[3]).toMatchObject({ quantity: 1, unitPrice: 0, total: 0 });
    expect(computeBillTotals(items)).toEqual({
      subtotal: 20_751.25,
      tax: 0,
      total: 20_751.25,
    });
  });

  it('posts the bill to Ledgr Invoicing as a VAT-exempt draft and links the visit', async () => {
    hc.handlers.set('patient_visits', (operation) => {
      if (operation === 'select') return { data: visitRow(), error: null };
      return { data: null, error: null };
    });
    hc.handlers.set('lab_orders', () => ({ data: [], error: null }));
    hc.handlers.set('prescriptions', () => ({ data: [], error: null }));
    hc.handlers.set('invoices', () => ({
      data: { id: 'invoice-1', invoice_number: 'INV-0042', total_amount: 15_000 },
      error: null,
    }));
    hc.handlers.set('invoice_lines', () => ({ data: null, error: null }));

    const created = await createInvoiceForVisit({
      businessId: BUSINESS_ID,
      visitId: VISIT_ID,
      contactId: 'contact-1',
      currency: 'MWK',
      createdBy: 'user-1',
    });

    expect(reserveInvoiceNumber).toHaveBeenCalledWith(BUSINESS_ID);
    expect(created).toEqual({ invoiceId: 'invoice-1', invoiceNumber: 'INV-0042', total: 15_000 });

    const invoiceLine = hc.calls.find((call) => call.table === 'invoice_lines');
    expect(invoiceLine?.values).toEqual([
      expect.objectContaining({
        invoice_id: 'invoice-1',
        business_id: BUSINESS_ID,
        tax_code: 'vat_exempt',
        tax_amount: 0,
        line_total: 15_000,
      }),
    ]);

    const visitUpdate = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(visitUpdate?.values).toMatchObject({ invoice_id: 'invoice-1' });
  });

  it('stamps the treating clinician on the visit so billing can accrue commission', async () => {
    hc.handlers.set('clinical_consultations', () => ({
      data: {
        id: 'consultation-1',
        business_id: BUSINESS_ID,
        visit_id: VISIT_ID,
        patient_id: PATIENT_ID,
        doctor_id: 'doctor-1',
        chief_complaint: 'Fever',
        diagnosis: 'Malaria',
      },
      error: null,
    }));
    hc.handlers.set('patient_visits', () => ({ data: null, error: null }));

    await saveConsultation({
      business_id: BUSINESS_ID,
      visit_id: VISIT_ID,
      patient_id: PATIENT_ID,
      doctor_id: 'doctor-1',
      chief_complaint: 'Fever',
      diagnosis: 'Malaria',
    });

    const visitUpdate = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(visitUpdate?.values).toMatchObject({
      attending_doctor_id: 'doctor-1',
    });
  });

  it('refuses to post an invoice without a payer contact', async () => {
    await expect(
      createInvoiceForVisit({
        businessId: BUSINESS_ID,
        visitId: VISIT_ID,
        contactId: '',
        currency: 'MWK',
      }),
    ).rejects.toThrow('Select the invoice customer or payer first');
  });
});

describe('clearing an emptied order', () => {
  it('deletes the pending prescription when every medication row is removed', async () => {
    hc.handlers.set('prescriptions', (operation) => {
      if (operation === 'select') return { data: { id: 'rx-1' }, error: null };
      return { data: null, error: null };
    });

    await expect(
      saveVisitPrescription({
        businessId: BUSINESS_ID,
        visitId: VISIT_ID,
        patientId: PATIENT_ID,
        doctorId: 'doctor-1',
        items: [],
      }),
    ).resolves.toBeNull();

    const deletion = hc.calls.find(
      (call) => call.table === 'prescriptions' && call.operation === 'delete',
    );
    expect(deletion).toBeDefined();
  });

  it('stamps the tenant on every laboratory item it creates', async () => {
    hc.handlers.set('lab_orders', (operation) =>
      operation === 'insert'
        ? { data: { id: 'lab-1' }, error: null }
        : { data: null, error: null },
    );
    hc.handlers.set('lab_order_items', () => ({ error: null }));

    await saveVisitLabOrder({
      businessId: BUSINESS_ID,
      visitId: VISIT_ID,
      patientId: PATIENT_ID,
      doctorId: 'doctor-1',
      items: [{ test_name: 'Random Blood Sugar', unit_price: 5000 }],
    });

    const insert = hc.calls.find(
      (call) => call.table === 'lab_order_items' && call.operation === 'insert',
    );
    expect(insert?.values).toEqual([
      expect.objectContaining({
        business_id: BUSINESS_ID,
        lab_order_id: 'lab-1',
        test_name: 'Random Blood Sugar',
      }),
    ]);
  });

  it('deletes the open lab order when every test is removed', async () => {
    hc.handlers.set('lab_orders', (operation) => {
      if (operation === 'select') return { data: { id: 'lab-1' }, error: null };
      return { data: null, error: null };
    });

    await expect(
      saveVisitLabOrder({
        businessId: BUSINESS_ID,
        visitId: VISIT_ID,
        patientId: PATIENT_ID,
        doctorId: 'doctor-1',
        items: [],
      }),
    ).resolves.toBeNull();

    const deletion = hc.calls.find(
      (call) => call.table === 'lab_orders' && call.operation === 'delete',
    );
    expect(deletion).toBeDefined();
  });
});

describe('allergy safety warnings', () => {
  it('flags a direct allergy match on a prescribed medication', () => {
    const warnings = findAllergyWarnings(['Aspirin'], ['Aspirin 300mg']);
    expect(warnings).toEqual([
      { allergen: 'aspirin', medication: 'Aspirin 300mg', severity: 'high' },
    ]);
  });

  it('flags cross-reactivity inside a known drug class', () => {
    const warnings = findAllergyWarnings(['Penicillin'], ['Amoxicillin 500mg']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ allergen: 'penicillin', severity: 'high' });
    expect(describeAllergyWarnings(warnings)).toContain('Amoxicillin 500mg');
    expect(describeAllergyWarnings(warnings)).toContain('penicillin');
  });

  it('does not warn on an unrelated medication or an empty chart', () => {
    expect(findAllergyWarnings(['Penicillin'], ['Paracetamol 500mg'])).toEqual([]);
    expect(findAllergyWarnings([], ['Amoxicillin'])).toEqual([]);
    expect(findAllergyWarnings(['Penicillin'], [])).toEqual([]);
    expect(findAllergyWarnings(null, null)).toEqual([]);
    expect(describeAllergyWarnings([])).toBe('');
  });

  it('matches case-insensitively and ignores very short allergen tokens', () => {
    expect(findAllergyWarnings(['penicillin'], ['AMOXICILLIN'])).toHaveLength(1);
    expect(findAllergyWarnings(['ab'], ['Abciximab'])).toEqual([]);
  });
});
