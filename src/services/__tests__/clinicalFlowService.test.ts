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
  checkAndTriggerResultsReview,
  checkInPatient,
  formatQueueToken,
  generateQueueToken,
  parseQueueToken,
  sortVisitsByAcuity,
  submitNurseTriage,
} from '../clinicalFlowService';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';

const PATIENT = {
  id: PATIENT_ID,
  business_id: BUSINESS_ID,
  mrn: 'PAT-2026-0001',
  first_name: 'Jane',
  last_name: 'Banda',
  billing_type: 'cash',
};

beforeEach(() => {
  hc.handlers.clear();
  hc.calls.length = 0;
});

describe('queue tokens', () => {
  it('formats Q-NNN and parses the numeric sequence', () => {
    expect(formatQueueToken(1)).toBe('Q-001');
    expect(formatQueueToken(42)).toBe('Q-042');
    expect(formatQueueToken(1234)).toBe('Q-1234');
    expect(parseQueueToken('Q-042')).toBe(42);
    expect(parseQueueToken(' q-007 ')).toBe(7);
    expect(parseQueueToken('A-007')).toBeNull();
    expect(parseQueueToken(null)).toBeNull();
  });

  it('reserves the next token from the highest token already issued today', async () => {
    hc.handlers.set('patient_visits', (operation) =>
      operation === 'select'
        ? {
            data: [{ queue_token: 'Q-003' }, { queue_token: 'Q-011' }, { queue_token: 'Q-007' }],
            error: null,
          }
        : { data: null, error: null },
    );

    await expect(generateQueueToken(BUSINESS_ID, new Date('2026-11-27T08:00:00Z'))).resolves.toBe(
      'Q-012',
    );
  });
});

describe('acuity prioritisation', () => {
  it('sorts Emergency before Urgent before Priority before Routine', () => {
    const sorted = sortVisitsByAcuity([
      { id: 'routine', acuity_level: 'routine', queue_token: 'Q-001', created_at: '2026-11-27T08:00:00Z' },
      { id: 'priority', acuity_level: 'priority', queue_token: 'Q-002', created_at: '2026-11-27T08:01:00Z' },
      { id: 'urgent', acuity_level: 'urgent', queue_token: 'Q-003', created_at: '2026-11-27T08:02:00Z' },
      { id: 'emergency', acuity_level: 'emergency', queue_token: 'Q-004', created_at: '2026-11-27T08:03:00Z' },
    ]);

    expect(sorted.map((visit) => visit.id)).toEqual([
      'emergency',
      'urgent',
      'priority',
      'routine',
    ]);
  });

  it('breaks acuity ties with the earliest queue token', () => {
    const sorted = sortVisitsByAcuity([
      { id: 'later', acuity_level: 'urgent', queue_token: 'Q-009' },
      { id: 'earlier', acuity_level: 'urgent', queue_token: 'Q-002' },
    ]);

    expect(sorted.map((visit) => visit.id)).toEqual(['earlier', 'later']);
  });
});

describe('reception check-in', () => {
  it('creates a registered visit with a Q-NNN token and a Jitsi room for telemedicine', async () => {
    hc.handlers.set('patient_visits', (operation, values) => {
      if (operation === 'select') {
        return {
          data: [{ visit_number: 'VST-2026-0006', queue_token: 'Q-006' }],
          error: null,
        };
      }
      if (operation === 'insert') {
        return {
          data: { id: VISIT_ID, ...(values as Record<string, unknown>), patient: PATIENT },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const visit = await checkInPatient(BUSINESS_ID, {
      patientId: PATIENT_ID,
      visitType: 'telemedicine',
      now: new Date('2026-11-27T08:00:00Z'),
    });

    const insert = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'insert',
    );
    expect(insert?.values).toMatchObject({
      business_id: BUSINESS_ID,
      patient_id: PATIENT_ID,
      visit_type: 'telemedicine',
      stage: 'registered',
      queue_token: 'Q-007',
      telemedicine_status: 'waiting',
    });
    expect((insert?.values as { meeting_url: string }).meeting_url).toMatch(
      /^https:\/\/meet\.jit\.si\/Ledgr-[a-z0-9]+-[a-z0-9]+#config\.prejoinPageEnabled=false$/,
    );
    expect(visit.queue_token).toBe('Q-007');
    expect(visit.patient?.mrn).toBe('PAT-2026-0001');
  });
});

describe('nurse triage', () => {
  it('persists acuity + vitals and moves the visit to triaged', async () => {
    hc.handlers.set('patient_visits', (operation, values) =>
      operation === 'update'
        ? { data: { id: VISIT_ID, ...(values as Record<string, unknown>), patient: PATIENT }, error: null }
        : { data: null, error: null },
    );

    const visit = await submitNurseTriage({
      visitId: VISIT_ID,
      businessId: BUSINESS_ID,
      acuity: 'urgent',
      vitals: {
        systolic_bp: 138,
        diastolic_bp: 92,
        heart_rate: 104,
        temperature: 38.2,
        oxygen_saturation: 96,
      },
      notes: 'Febrile, priority review.',
    });

    const update = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      stage: 'triaged',
      acuity_level: 'urgent',
      systolic_bp: 138,
      diastolic_bp: 92,
      heart_rate: 104,
      temperature: 38.2,
      oxygen_saturation: 96,
      triage_notes: 'Febrile, priority review.',
    });
    expect(visit.stage).toBe('triaged');
  });

  it('rejects triage without any vitals', async () => {
    await expect(
      submitNurseTriage({
        visitId: VISIT_ID,
        businessId: BUSINESS_ID,
        acuity: 'routine',
        vitals: {},
      }),
    ).rejects.toThrow('Record at least one vital sign');
  });
});

describe('diagnostic loop-back', () => {
  it('does not loop back while the lab still has an open order', async () => {
    hc.handlers.set('lab_orders', () => ({ data: [{ id: 'lab-1', status: 'ordered' }], error: null }));
    hc.handlers.set('radiology_orders', () => ({ data: [], error: null }));

    const loopedBack = await checkAndTriggerResultsReview(VISIT_ID, BUSINESS_ID);

    expect(loopedBack).toBe(false);
    const update = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      has_pending_lab: true,
      has_pending_radiology: false,
      results_ready_for_review: false,
    });
  });

  it('loops the patient back to results_review once labs and scans are complete', async () => {
    hc.handlers.set('lab_orders', () => ({ data: [], error: null }));
    hc.handlers.set('radiology_orders', () => ({ data: [], error: null }));

    const loopedBack = await checkAndTriggerResultsReview(VISIT_ID, BUSINESS_ID);

    expect(loopedBack).toBe(true);
    const update = hc.calls.find(
      (call) => call.table === 'patient_visits' && call.operation === 'update',
    );
    expect(update?.values).toMatchObject({
      stage: 'results_review',
      has_pending_lab: false,
      has_pending_radiology: false,
      results_ready_for_review: true,
    });
    expect((update?.values as { results_ready_at: string }).results_ready_at).toBeTruthy();
  });
});
