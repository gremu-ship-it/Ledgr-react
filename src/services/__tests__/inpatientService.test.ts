import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admitPatientToBed,
  calculateBedNights,
  calculateInpatientStayCharges,
  dischargePatient,
  formatAdmissionNumber,
  generateAdmissionNumber,
  transferPatientBed,
} from '../inpatientService';
import { calculateAccommodationCoverage } from '@/lib/healthcare/accommodation';

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

const state = vi.hoisted(() => ({
  admissions: [] as Row[],
  beds: [] as Row[],
  allocations: [] as Row[],
  careLogs: [] as Row[],
  wards: [] as Row[],
  nextAdmission: 'ADM-2026-0007',
  idCounter: 0,
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let operation = 'select';
    let values: Row = {};
    const filters: Filter[] = [];

    const resolve = () => {
      if (table === 'patient_admissions' && operation === 'select') {
        const byId = filters.find((filter) => filter.column === 'id');
        if (byId) {
          const admission = state.admissions.find((row) => row.id === byId.value);
          if (!admission) return { data: null, error: null };
          return {
            data: {
              ...admission,
              allocations: state.allocations
                .filter((allocation) => allocation.admission_id === admission.id)
                .map((allocation) => ({
                  ...allocation,
                  bed: state.beds.find((bed) => bed.id === allocation.bed_id) ?? null,
                })),
              care_logs: state.careLogs.filter(
                (log) => log.admission_id === admission.id,
              ),
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }

      if (table === 'patient_admissions' && operation === 'insert') {
        state.idCounter += 1;
        const admission = {
          id: `adm-${state.idCounter}`,
          status: 'admitted',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          ...values,
        };
        state.admissions.push(admission);
        return { data: admission, error: null };
      }

      if (table === 'patient_admissions' && operation === 'update') {
        const byId = filters.find((filter) => filter.column === 'id');
        const admission = state.admissions.find((row) => row.id === byId?.value);
        if (admission) Object.assign(admission, values);
        return { data: admission ?? null, error: null };
      }

      if (table === 'hospital_beds' && operation === 'select') {
        const byId = filters.find((filter) => filter.column === 'id');
        const bed = state.beds.find((row) => row.id === byId?.value) ?? null;
        return { data: bed, error: null };
      }

      if (table === 'hospital_beds' && operation === 'update') {
        const byId = filters.find((filter) => filter.column === 'id');
        const bed = state.beds.find((row) => row.id === byId?.value);
        if (bed) Object.assign(bed, values);
        return { data: bed ?? null, error: null };
      }

      if (table === 'bed_allocations' && operation === 'insert') {
        state.idCounter += 1;
        const allocation = {
          id: `alloc-${state.idCounter}`,
          released_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
          ...values,
        };
        state.allocations.push(allocation);
        return { data: allocation, error: null };
      }

      if (table === 'bed_allocations' && operation === 'update') {
        const byId = filters.find((filter) => filter.column === 'id');
        const allocation = state.allocations.find((row) => row.id === byId?.value);
        if (allocation) Object.assign(allocation, values);
        return { data: allocation ?? null, error: null };
      }

      if (table === 'bed_allocations' && operation === 'select') {
        const admissionId = filters.find((filter) => filter.column === 'admission_id')?.value;
        const rows = state.allocations
          .filter((allocation) => allocation.admission_id === admissionId)
          .map((allocation) => {
            const bed = state.beds.find((row) => row.id === allocation.bed_id) ?? {};
            return {
              ...allocation,
              bed: {
                ...bed,
                ward: state.wards.find((ward) => ward.id === bed.ward_id) ?? null,
              },
            };
          });
        return { data: rows, error: null };
      }

      if (table === 'inpatient_care_logs') {
        return { data: null, error: null };
      }

      if (table === 'user_profiles') {
        return { data: [], error: null };
      }

      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    const passthrough = () => builder;
    Object.assign(builder, {
      select: passthrough,
      insert: (input: Row) => {
        operation = 'insert';
        values = input;
        return builder;
      },
      update: (input: Row) => {
        operation = 'update';
        values = input;
        return builder;
      },
      delete: () => {
        operation = 'delete';
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      },
      neq: passthrough,
      in: passthrough,
      like: passthrough,
      is: (column: string, value: unknown) => {
        filters.push({ column, value });
        return builder;
      },
      order: passthrough,
      limit: passthrough,
      single: () => Promise.resolve(resolve()),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    });
    return builder;
  };

  return {
    supabase: {
      from: makeBuilder,
      rpc: async () => ({ data: state.nextAdmission, error: null }),
    },
  };
});

function reset(): void {
  state.admissions.splice(0);
  state.beds.splice(0);
  state.allocations.splice(0);
  state.careLogs.splice(0);
  state.wards.splice(0);
  state.idCounter = 0;
}

beforeEach(reset);

function seedBed(id: string, rate: number, extra: Row = {}): void {
  state.wards.push({ id: 'ward-1', name: 'General Ward A', ward_type: 'general' });
  state.beds.push({
    id,
    business_id: 'biz-1',
    ward_id: 'ward-1',
    bed_number: `Bed ${id.slice(-1)}`,
    daily_rate: rate,
    hourly_rate: 0,
    status: 'available',
    current_admission_id: null,
    amenities: [],
    ...extra,
  });
}

describe('calculateBedNights', () => {
  it('bills a stay under 24 hours as one night', () => {
    expect(
      calculateBedNights('2026-01-01T08:00:00.000Z', '2026-01-01T20:00:00.000Z'),
    ).toBe(1);
  });

  it('bills an exact 24 hours as one night and 24h+1m as two', () => {
    expect(
      calculateBedNights('2026-01-01T08:00:00.000Z', '2026-01-02T08:00:00.000Z'),
    ).toBe(1);
    expect(
      calculateBedNights('2026-01-01T08:00:00.000Z', '2026-01-02T08:01:00.000Z'),
    ).toBe(2);
  });

  it('bills multi-day stays by calendar night count', () => {
    expect(
      calculateBedNights('2026-01-01T08:00:00.000Z', '2026-01-06T08:00:00.000Z'),
    ).toBe(5);
  });
});

describe('admission numbering', () => {
  it('formats ADM-YYYY-NNNN with at least four sequence digits', () => {
    expect(formatAdmissionNumber(2026, 7)).toBe('ADM-2026-0007');
    expect(formatAdmissionNumber(2026, 12345)).toBe('ADM-2026-12345');
  });

  it('uses the race-safe RPC allocator', async () => {
    await expect(generateAdmissionNumber('biz-1')).resolves.toBe('ADM-2026-0007');
  });
});

describe('admission, transfer and discharge state machine', () => {
  it('admits a patient, occupies the bed and opens a rated allocation', async () => {
    seedBed('bed-1', 50_000);
    const admission = await admitPatientToBed({
      businessId: 'biz-1',
      visitId: 'visit-1',
      patientId: 'patient-1',
      bedId: 'bed-1',
      admittingDoctorId: 'doc-1',
      attendingDoctorId: 'doc-1',
      admissionReason: 'Severe pneumonia',
    });

    expect(admission.status).toBe('admitted');
    expect(admission.admission_number).toBe('ADM-2026-0007');
    expect(state.beds[0]).toMatchObject({
      status: 'occupied',
      current_admission_id: admission.id,
    });
    expect(state.allocations).toHaveLength(1);
    expect(state.allocations[0]).toMatchObject({
      admission_id: admission.id,
      bed_id: 'bed-1',
      daily_rate_applied: 50_000,
      released_at: null,
    });
  });

  it('transfers to a new bed, closes the old allocation and applies the new rate', async () => {
    seedBed('bed-1', 50_000);
    seedBed('bed-2', 80_000);
    const admission = await admitPatientToBed({
      businessId: 'biz-1',
      visitId: 'visit-1',
      patientId: 'patient-1',
      bedId: 'bed-1',
      admittingDoctorId: 'doc-1',
      attendingDoctorId: 'doc-1',
      admissionReason: 'Observation',
      admittedAt: '2026-01-01T08:00:00.000Z',
    });

    const transferred = await transferPatientBed({
      businessId: 'biz-1',
      admissionId: admission.id,
      newBedId: 'bed-2',
      reason: 'Needs ICU monitoring',
      transferredAt: '2026-01-03T08:00:00.000Z',
    });

    expect(transferred.status).toBe('admitted');
    expect(state.allocations).toHaveLength(2);
    const [first, second] = state.allocations;
    expect(first.released_at).toBe('2026-01-03T08:00:00.000Z');
    expect(second).toMatchObject({
      bed_id: 'bed-2',
      daily_rate_applied: 80_000,
      released_at: null,
      transfer_reason: 'Needs ICU monitoring',
    });
    expect(state.beds.find((bed) => bed.id === 'bed-1')).toMatchObject({
      status: 'cleaning',
      current_admission_id: null,
    });
    expect(state.beds.find((bed) => bed.id === 'bed-2')).toMatchObject({
      status: 'occupied',
      current_admission_id: admission.id,
    });
  });

  it('discharges the patient, releases the allocation and sends the bed to cleaning', async () => {
    seedBed('bed-1', 50_000);
    const admission = await admitPatientToBed({
      businessId: 'biz-1',
      visitId: 'visit-1',
      patientId: 'patient-1',
      bedId: 'bed-1',
      admittingDoctorId: 'doc-1',
      attendingDoctorId: 'doc-1',
      admissionReason: 'Dehydration',
      admittedAt: '2026-01-01T08:00:00.000Z',
    });

    const discharged = await dischargePatient({
      businessId: 'biz-1',
      admissionId: admission.id,
      dischargeSummary: 'Rehydrated and stable.',
      dischargeCondition: 'improved',
      dischargedAt: '2026-01-03T08:00:00.000Z',
    });

    expect(discharged.status).toBe('discharged');
    expect(discharged.discharge_condition).toBe('improved');
    expect(state.allocations[0].released_at).toBe('2026-01-03T08:00:00.000Z');
    expect(state.beds[0]).toMatchObject({
      status: 'cleaning',
      current_admission_id: null,
    });
  });
});

describe('multi-ward stay charging', () => {
  it('sums one line per allocation at the rate applied in each ward', async () => {
    state.wards.push(
      { id: 'ward-1', name: 'General Ward A', ward_type: 'general' },
      { id: 'ward-2', name: 'Private Wing', ward_type: 'private' },
    );
    state.beds.push(
      { id: 'bed-1', ward_id: 'ward-1', bed_number: 'Bed 1' },
      { id: 'bed-2', ward_id: 'ward-2', bed_number: 'Bed 9' },
    );
    state.allocations.push(
      {
        id: 'alloc-1',
        business_id: 'biz-1',
        admission_id: 'adm-1',
        bed_id: 'bed-1',
        assigned_at: '2026-01-01T08:00:00.000Z',
        released_at: '2026-01-04T08:00:00.000Z',
        daily_rate_applied: 50_000,
      },
      {
        id: 'alloc-2',
        business_id: 'biz-1',
        admission_id: 'adm-1',
        bed_id: 'bed-2',
        assigned_at: '2026-01-04T08:00:00.000Z',
        released_at: '2026-01-06T20:00:00.000Z',
        daily_rate_applied: 120_000,
      },
    );

    const charges = await calculateInpatientStayCharges(
      'biz-1',
      'adm-1',
      new Date('2026-01-07T00:00:00.000Z'),
    );

    expect(charges).toHaveLength(2);
    expect(charges[0]).toMatchObject({
      wardName: 'General Ward A',
      bedNumber: 'Bed 1',
      nights: 3,
      dailyRate: 50_000,
      totalCharge: 150_000,
    });
    expect(charges[1]).toMatchObject({
      wardName: 'Private Wing',
      bedNumber: 'Bed 9',
      nights: 3,
      dailyRate: 120_000,
      totalCharge: 360_000,
    });
    expect(charges.reduce((total, charge) => total + charge.totalCharge, 0)).toBe(510_000);
  });
});

describe('HMO accommodation coverage', () => {
  const charge = {
    bedNumber: 'Bed 9',
    wardName: 'Private Wing',
    assignedAt: '2026-01-01T08:00:00.000Z',
    releasedAt: '2026-01-03T08:00:00.000Z',
    nights: 2,
    dailyRate: 120_000,
    totalCharge: 240_000,
  };

  it('caps the covered nightly rate and charges the upgrade differential to the patient', () => {
    const coverage = calculateAccommodationCoverage([charge], {
      dailyCap: 80_000,
      copayPercent: 10,
      roomUpgradeChargeToPatient: true,
    });

    expect(coverage.lines[0]).toMatchObject({
      coveredDailyRate: 80_000,
      coveredAmount: 160_000,
      upgradeDifferential: 80_000,
      patientCopay: 16_000,
      patientShare: 96_000,
      insurerShare: 144_000,
    });
    expect(coverage.totalCharge).toBe(240_000);
    expect(coverage.patientShare + coverage.insurerShare).toBe(240_000);
  });

  it('leaves the differential with the payer when upgrades are not patient-charged', () => {
    const coverage = calculateAccommodationCoverage([charge], {
      dailyCap: 80_000,
      copayPercent: 10,
      roomUpgradeChargeToPatient: false,
    });

    expect(coverage.lines[0].upgradeDifferential).toBe(0);
    expect(coverage.lines[0].patientShare).toBe(16_000);
    expect(coverage.lines[0].insurerShare).toBe(224_000);
  });

  it('applies the co-pay to the full charge when no cap is configured', () => {
    const coverage = calculateAccommodationCoverage([charge], { copayPercent: 20 });
    expect(coverage.patientShare).toBe(48_000);
    expect(coverage.insurerShare).toBe(192_000);
  });
});
