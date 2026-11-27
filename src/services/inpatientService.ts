/**
 * inpatientService.ts
 *
 * Wards, beds, admissions/transfer/discharge (ADT), care logs and inpatient
 * stay charging for the Healthcare vertical (Phase 4).
 *
 * Every read and write is scoped on business_id. Bed state changes are applied
 * here because PostgREST cannot wrap them in a transaction from the browser;
 * the service therefore validates state first and rolls back the most harmful
 * partial transition (a failed transfer) on a best-effort basis.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { calculateAccommodationCoverage } from '@/lib/healthcare/accommodation';
import type {
  AccommodationCoveragePolicy,
  AccommodationCoverageResult,
  AdmissionStatus,
  BedAllocation,
  BedStatus,
  CareLogType,
  DischargeCondition,
  GenderRestriction,
  HospitalBed,
  HospitalWard,
  InpatientAccommodationBillItem,
  InpatientCareLog,
  InpatientStayCharge,
  PatientAdmission,
  WardType,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

const BED_STATUSES: readonly BedStatus[] = [
  'available',
  'occupied',
  'cleaning',
  'maintenance',
  'reserved',
];

const WARD_SELECT = `
  *,
  beds:hospital_beds(
    *,
    current_admission:patient_admissions(
      *,
      patient:patients(id, mrn, first_name, last_name, gender, date_of_birth, blood_group, allergies, billing_type, phone)
    )
  )
`;

const ADMISSION_SELECT = `
  *,
  patient:patients(id, mrn, first_name, last_name, gender, date_of_birth, blood_group, allergies, billing_type, phone),
  allocations:bed_allocations(
    *,
    bed:hospital_beds(*, ward:hospital_wards(*))
  ),
  care_logs:inpatient_care_logs(*)
`;

const STAY_SELECT = `
  assigned_at,
  bed_id,
  released_at,
  daily_rate_applied,
  bed:hospital_beds(
    bed_number,
    ward:hospital_wards(name, ward_type)
  )
`;

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function nullableText(value: unknown): string | null {
  if (value == null) return null;
  const valueText = String(value).trim();
  return valueText === '' ? null : valueText;
}

function isoOrNow(value: unknown, fallback: Date): string {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function formatAdmissionNumber(year: number, sequence: number): string {
  const safeYear = Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
  const safeSequence = Number.isFinite(sequence) ? Math.max(1, Math.trunc(sequence)) : 1;
  return `ADM-${safeYear}-${String(safeSequence).padStart(4, '0')}`;
}

/**
 * Calculate billable bed-nights between two instants. A stay shorter than 24
 * hours still consumes one night, and an exact 24 hours consumes one night
 * (not two).
 */
export function calculateBedNights(
  admittedAt: string | Date,
  dischargedAt: string | Date = new Date(),
): number {
  const start = admittedAt instanceof Date ? admittedAt : new Date(admittedAt);
  const end = dischargedAt instanceof Date ? dischargedAt : new Date(dischargedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const hours = Math.max(0, end.getTime() - start.getTime()) / 3_600_000;
  const nights = Math.ceil(hours / 24);
  return Math.max(1, nights);
}

function normalizeBed(row: Partial<HospitalBed> | null | undefined): HospitalBed | null {
  if (!row || !row.id) return null;
  const status = BED_STATUSES.includes(row.status as BedStatus)
    ? (row.status as BedStatus)
    : 'available';
  const ward = row.ward ? normalizeWard(row.ward, []) : null;
  return {
    ...row,
    id: String(row.id),
    business_id: text(row.business_id),
    ward_id: text(row.ward_id),
    bed_number: text(row.bed_number),
    daily_rate: roundMoney(toNumber(row.daily_rate)),
    hourly_rate: roundMoney(toNumber(row.hourly_rate)),
    status,
    current_admission_id: nullableText(row.current_admission_id),
    amenities: Array.isArray(row.amenities) ? row.amenities.map((item) => String(item)) : [],
    ward,
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function normalizeWard(
  row: Partial<HospitalWard> | null | undefined,
  beds?: Array<Partial<HospitalBed>>,
): HospitalWard {
  const raw = row ?? {};
  return {
    id: text(raw.id),
    business_id: text(raw.business_id),
    name: text(raw.name),
    ward_type: (raw.ward_type ?? 'general') as WardType,
    floor_number: raw.floor_number ?? null,
    gender_restriction: (raw.gender_restriction ?? 'mixed') as GenderRestriction,
    total_capacity: Math.max(1, Math.trunc(toNumber(raw.total_capacity, 1))),
    is_active: raw.is_active !== false,
    beds: (beds ?? (raw.beds as Array<Partial<HospitalBed>> | undefined) ?? [])
      .map((bed) => normalizeBed(bed))
      .filter((bed): bed is HospitalBed => Boolean(bed))
      .sort((left, right) => left.bed_number.localeCompare(right.bed_number, undefined, { numeric: true })),
    created_at: text(raw.created_at),
    updated_at: text(raw.updated_at),
  };
}

function normalizeAllocation(row: Partial<BedAllocation> | null | undefined): BedAllocation | null {
  if (!row || !row.id) return null;
  return {
    ...row,
    id: String(row.id),
    business_id: text(row.business_id),
    admission_id: text(row.admission_id),
    bed_id: text(row.bed_id),
    assigned_at: text(row.assigned_at),
    released_at: row.released_at ?? null,
    daily_rate_applied: roundMoney(toNumber(row.daily_rate_applied)),
    billing_mode: row.billing_mode === 'hourly' ? 'hourly' : 'daily',
    transfer_reason: row.transfer_reason ?? null,
    bed: normalizeBed(row.bed ?? null),
    created_at: text(row.created_at),
  };
}

function normalizeCareLog(row: Partial<InpatientCareLog> | null | undefined): InpatientCareLog | null {
  if (!row || !row.id) return null;
  return {
    ...row,
    id: String(row.id),
    business_id: text(row.business_id),
    admission_id: text(row.admission_id),
    recorded_by: text(row.recorded_by),
    log_type: (row.log_type ?? 'nurse_note') as CareLogType,
    note: text(row.note),
    recorded_at: text(row.recorded_at),
    recorder_name: row.recorder_name ?? null,
  };
}

export function normalizeAdmission(
  row: Partial<PatientAdmission> | null | undefined,
): PatientAdmission {
  const raw = row ?? {};
  const allocations = ((raw.allocations ?? []) as Array<Partial<BedAllocation>>)
    .map((allocation) => normalizeAllocation(allocation))
    .filter((allocation): allocation is BedAllocation => Boolean(allocation))
    .sort((left, right) => left.assigned_at.localeCompare(right.assigned_at));
  const openAllocation = allocations.find((allocation) => !allocation.released_at) ?? null;
  const careLogs = ((raw.care_logs ?? []) as Array<Partial<InpatientCareLog>>)
    .map((log) => normalizeCareLog(log))
    .filter((log): log is InpatientCareLog => Boolean(log))
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at));

  return {
    ...raw,
    id: text(raw.id),
    business_id: text(raw.business_id),
    visit_id: text(raw.visit_id),
    patient_id: text(raw.patient_id),
    admission_number: text(raw.admission_number),
    admitting_doctor_id: text(raw.admitting_doctor_id),
    attending_doctor_id: text(raw.attending_doctor_id),
    admission_reason: text(raw.admission_reason),
    admitted_at: text(raw.admitted_at),
    expected_discharge_date: raw.expected_discharge_date ?? null,
    discharged_at: raw.discharged_at ?? null,
    discharge_summary: raw.discharge_summary ?? null,
    discharge_condition: raw.discharge_condition ?? null,
    status: (raw.status ?? 'admitted') as AdmissionStatus,
    patient: raw.patient
      ? {
          ...raw.patient,
          id: text(raw.patient.id),
          mrn: text(raw.patient.mrn),
          first_name: text(raw.patient.first_name),
          last_name: text(raw.patient.last_name),
          gender: text(raw.patient.gender),
          date_of_birth: text(raw.patient.date_of_birth),
        }
      : null,
    attending_doctor_name: raw.attending_doctor_name ?? null,
    current_bed: normalizeBed(raw.current_bed ?? openAllocation?.bed ?? null),
    allocations,
    care_logs: careLogs,
    created_at: text(raw.created_at),
    updated_at: text(raw.updated_at),
  };
}

async function attachDoctorNames(
  admissions: PatientAdmission[],
): Promise<PatientAdmission[]> {
  const ids = Array.from(
    new Set(
      admissions
        .flatMap((admission) => [admission.attending_doctor_id, admission.admitting_doctor_id])
        .filter(Boolean),
    ),
  );
  if (ids.length === 0) return admissions;

  const { data, error } = await db
    .from('user_profiles')
    .select('id, full_name')
    .in('id', ids);
  if (error) return admissions;

  const names = new Map(
    ((data ?? []) as Array<{ id?: string; full_name?: string | null }>)
      .filter((profile) => profile.id)
      .map((profile) => [String(profile.id), profile.full_name ?? null]),
  );

  return admissions.map((admission) => ({
    ...admission,
    attending_doctor_name:
      names.get(admission.attending_doctor_id) ??
      admission.attending_doctor_id.slice(0, 8).toUpperCase(),
  }));
}

/**
 * Allocate the next ADM-YYYY-NNNN number. The RPC is race-safe; the fallback
 * keeps the service usable in preview environments where the RPC has not been
 * deployed yet and in unit tests with a minimal Supabase double.
 */
export async function generateAdmissionNumber(
  businessId: string,
  now = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const rpc = (db as unknown as { rpc?: SupabaseClient['rpc'] }).rpc;
  if (typeof rpc === 'function') {
    try {
      const { data, error } = await rpc('next_admission_number', {
        p_business_id: businessId,
      });
      if (!error && typeof data === 'string' && /^ADM-\d{4}-\d{4,}$/.test(data)) {
        return data;
      }
    } catch {
      // Fall through to the MAX()-based allocator.
    }
  }

  const { data } = await db
    .from('patient_admissions')
    .select('admission_number')
    .eq('business_id', businessId)
    .order('admission_number', { ascending: false })
    .limit(1);
  const latest = (data?.[0] as { admission_number?: string } | undefined)?.admission_number;
  const match = latest ? /^ADM-(\d{4})-(\d+)$/.exec(latest) : null;
  const latestYear = match ? Number(match[1]) : null;
  const next = match && latestYear === year ? Number(match[2]) + 1 : 1;
  return formatAdmissionNumber(year, next);
}

export async function getWardsAndBeds(businessId: string): Promise<HospitalWard[]> {
  const { data, error } = await db
    .from('hospital_wards')
    .select(WARD_SELECT)
    .eq('business_id', businessId)
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Partial<HospitalWard>>).map((ward) => normalizeWard(ward));
}

export async function createWard(
  businessId: string,
  input: {
    name: string;
    wardType: WardType;
    floorNumber?: string | null;
    genderRestriction?: GenderRestriction;
    totalCapacity?: number;
  },
): Promise<HospitalWard> {
  const name = input.name.trim();
  if (!name) throw new Error('Ward name is required');
  const { data, error } = await db
    .from('hospital_wards')
    .insert({
      business_id: businessId,
      name,
      ward_type: input.wardType,
      floor_number: nullableText(input.floorNumber),
      gender_restriction: input.genderRestriction ?? 'mixed',
      total_capacity: Math.max(1, Math.trunc(input.totalCapacity ?? 1)),
      is_active: true,
    })
    .select('*')
    .single();
  if (error) throw error;
  return normalizeWard(data as Partial<HospitalWard>);
}

export async function updateWard(
  businessId: string,
  wardId: string,
  patch: {
    name?: string;
    wardType?: WardType;
    floorNumber?: string | null;
    genderRestriction?: GenderRestriction;
    totalCapacity?: number;
    isActive?: boolean;
  },
): Promise<HospitalWard> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.wardType !== undefined) payload.ward_type = patch.wardType;
  if (patch.floorNumber !== undefined) payload.floor_number = nullableText(patch.floorNumber);
  if (patch.genderRestriction !== undefined) payload.gender_restriction = patch.genderRestriction;
  if (patch.totalCapacity !== undefined) {
    payload.total_capacity = Math.max(1, Math.trunc(patch.totalCapacity));
  }
  if (patch.isActive !== undefined) payload.is_active = patch.isActive;

  const { data, error } = await db
    .from('hospital_wards')
    .update(payload)
    .eq('business_id', businessId)
    .eq('id', wardId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeWard(data as Partial<HospitalWard>);
}

export async function createBed(
  businessId: string,
  input: {
    wardId: string;
    bedNumber: string;
    dailyRate: number;
    hourlyRate?: number;
    amenities?: string[];
  },
): Promise<HospitalBed> {
  const bedNumber = input.bedNumber.trim();
  if (!bedNumber) throw new Error('Bed number is required');
  if (!Number.isFinite(input.dailyRate) || input.dailyRate < 0) {
    throw new Error('Daily rate must be zero or more');
  }
  const { data, error } = await db
    .from('hospital_beds')
    .insert({
      business_id: businessId,
      ward_id: input.wardId,
      bed_number: bedNumber,
      daily_rate: roundMoney(input.dailyRate),
      hourly_rate: roundMoney(input.hourlyRate ?? 0),
      status: 'available',
      amenities: input.amenities ?? [],
    })
    .select('*')
    .single();
  if (error) throw error;
  const bed = normalizeBed(data as Partial<HospitalBed>);
  if (!bed) throw new Error('Could not create the bed');
  return bed;
}

/** Create a ward and its first batch of numbered beds in one action. */
export async function createWardAndBeds(
  businessId: string,
  input: {
    name: string;
    wardType: WardType;
    floorNumber?: string | null;
    genderRestriction?: GenderRestriction;
    bedCount: number;
    dailyRate: number;
    bedPrefix?: string;
  },
): Promise<HospitalWard> {
  const bedCount = Math.max(1, Math.trunc(input.bedCount));
  const ward = await createWard(businessId, {
    name: input.name,
    wardType: input.wardType,
    floorNumber: input.floorNumber,
    genderRestriction: input.genderRestriction,
    totalCapacity: bedCount,
  });
  const prefix = input.bedPrefix?.trim() || 'Bed';
  for (let index = 1; index <= bedCount; index += 1) {
    await createBed(businessId, {
      wardId: ward.id,
      bedNumber: `${prefix} ${index}`,
      dailyRate: input.dailyRate,
    });
  }
  const wards = await getWardsAndBeds(businessId);
  return wards.find((item) => item.id === ward.id) ?? ward;
}

export async function listAdmissions(
  businessId: string,
  options: { status?: AdmissionStatus | 'all'; limit?: number } = {},
): Promise<PatientAdmission[]> {
  let query = db
    .from('patient_admissions')
    .select(ADMISSION_SELECT)
    .eq('business_id', businessId);

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }

  const { data, error } = await query
    .order('admitted_at', { ascending: false })
    .limit(options.limit ?? 200);
  if (error) throw error;
  const admissions = ((data ?? []) as Array<Partial<PatientAdmission>>).map((row) =>
    normalizeAdmission(row),
  );
  return attachDoctorNames(admissions);
}

export async function getAdmission(
  businessId: string,
  admissionId: string,
): Promise<PatientAdmission> {
  const { data, error } = await db
    .from('patient_admissions')
    .select(ADMISSION_SELECT)
    .eq('business_id', businessId)
    .eq('id', admissionId)
    .single();
  if (error) throw error;
  const [admission] = await attachDoctorNames([
    normalizeAdmission(data as Partial<PatientAdmission>),
  ]);
  return admission;
}

/** Inpatient admissions at any point in their life (billing uses this). */
export async function getAdmissionForVisit(
  businessId: string,
  visitId: string,
): Promise<PatientAdmission | null> {
  const { data, error } = await db
    .from('patient_admissions')
    .select(ADMISSION_SELECT)
    .eq('business_id', businessId)
    .eq('visit_id', visitId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeAdmission(data as Partial<PatientAdmission>) : null;
}

export interface AdmitPatientToBedInput {
  businessId: string;
  visitId: string;
  patientId: string;
  bedId: string;
  admittingDoctorId: string;
  attendingDoctorId: string;
  admissionReason: string;
  expectedDischargeDate?: string | null;
  admittedAt?: string;
}

export async function admitPatientToBed(input: AdmitPatientToBedInput): Promise<PatientAdmission> {
  const reason = input.admissionReason.trim();
  if (!reason) throw new Error('Admission reason is required');
  if (!input.admittingDoctorId || !input.attendingDoctorId) {
    throw new Error('Select the admitting and attending doctors');
  }

  const { data: active, error: activeError } = await db
    .from('patient_admissions')
    .select('id, admission_number')
    .eq('business_id', input.businessId)
    .eq('patient_id', input.patientId)
    .eq('status', 'admitted')
    .limit(1)
    .maybeSingle();
  if (activeError) throw activeError;
  if (active) throw new Error('This patient already has an open inpatient admission');

  const { data: bedRow, error: bedError } = await db
    .from('hospital_beds')
    .select('*')
    .eq('business_id', input.businessId)
    .eq('id', input.bedId)
    .single();
  if (bedError) throw bedError;
  const bed = normalizeBed(bedRow as Partial<HospitalBed>);
  if (!bed) throw new Error('Bed not found');
  if (bed.status !== 'available') throw new Error('The selected bed is not available');

  const admittedAt = isoOrNow(input.admittedAt, new Date());
  const admissionNumber = await generateAdmissionNumber(input.businessId, new Date(admittedAt));

  const { data: admissionRow, error: admissionError } = await db
    .from('patient_admissions')
    .insert({
      business_id: input.businessId,
      visit_id: input.visitId,
      patient_id: input.patientId,
      admission_number: admissionNumber,
      admitting_doctor_id: input.admittingDoctorId,
      attending_doctor_id: input.attendingDoctorId,
      admission_reason: reason,
      admitted_at: admittedAt,
      expected_discharge_date: nullableText(input.expectedDischargeDate),
      status: 'admitted',
    })
    .select(ADMISSION_SELECT)
    .single();
  if (admissionError) throw admissionError;
  const admission = normalizeAdmission(admissionRow as Partial<PatientAdmission>);

  try {
    await insertAllocation(input.businessId, admission.id, bed, admittedAt, 'daily');
    const { error: occupyError } = await db
      .from('hospital_beds')
      .update({
        status: 'occupied',
        current_admission_id: admission.id,
        updated_at: new Date().toISOString(),
      })
      .eq('business_id', input.businessId)
      .eq('id', bed.id);
    if (occupyError) throw occupyError;
  } catch (error) {
    // Best-effort compensation: remove the allocation and cancel the admission
    // so a failed bed update never leaves an admitted patient without a bed.
    await db.from('bed_allocations').delete().eq('admission_id', admission.id);
    await db
      .from('patient_admissions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('business_id', input.businessId)
      .eq('id', admission.id);
    throw error;
  }

  return getAdmission(input.businessId, admission.id);
}

async function insertAllocation(
  businessId: string,
  admissionId: string,
  bed: HospitalBed,
  assignedAt: string,
  billingMode: 'daily' | 'hourly',
  transferReason?: string | null,
): Promise<void> {
  const { error } = await db.from('bed_allocations').insert({
    business_id: businessId,
    admission_id: admissionId,
    bed_id: bed.id,
    assigned_at: assignedAt,
    daily_rate_applied: bed.daily_rate,
    billing_mode: billingMode,
    transfer_reason: transferReason ?? null,
  });
  if (error) throw error;
}

export async function transferPatientBed(input: {
  businessId: string;
  admissionId: string;
  newBedId: string;
  reason?: string | null;
  transferredAt?: string;
}): Promise<PatientAdmission> {
  const transferredAt = isoOrNow(input.transferredAt, new Date());
  const admission = await getAdmission(input.businessId, input.admissionId);
  if (admission.status !== 'admitted') throw new Error('Only admitted patients can be transferred');

  const currentAllocation =
    admission.allocations?.find((allocation) => !allocation.released_at) ?? null;
  if (!currentAllocation) throw new Error('This admission has no open bed allocation');

  const { data: bedRow, error: bedError } = await db
    .from('hospital_beds')
    .select('*')
    .eq('business_id', input.businessId)
    .eq('id', input.newBedId)
    .single();
  if (bedError) throw bedError;
  const newBed = normalizeBed(bedRow as Partial<HospitalBed>);
  if (!newBed) throw new Error('Bed not found');
  if (newBed.id === currentAllocation.bed_id) throw new Error('Select a different bed');
  if (newBed.status !== 'available') throw new Error('The selected bed is not available');

  const { error: releaseError } = await db
    .from('bed_allocations')
    .update({ released_at: transferredAt })
    .eq('business_id', input.businessId)
    .eq('id', currentAllocation.id)
    .is('released_at', null);
  if (releaseError) throw releaseError;

  const { error: cleanError } = await db
    .from('hospital_beds')
    .update({
      status: 'cleaning',
      current_admission_id: null,
      updated_at: transferredAt,
    })
    .eq('business_id', input.businessId)
    .eq('id', currentAllocation.bed_id);
  if (cleanError) {
    await db
      .from('bed_allocations')
      .update({ released_at: null })
      .eq('business_id', input.businessId)
      .eq('id', currentAllocation.id);
    throw cleanError;
  }

  try {
    await insertAllocation(
      input.businessId,
      admission.id,
      newBed,
      transferredAt,
      'daily',
      input.reason ?? null,
    );
    const { error: occupyError } = await db
      .from('hospital_beds')
      .update({
        status: 'occupied',
        current_admission_id: admission.id,
        updated_at: transferredAt,
      })
      .eq('business_id', input.businessId)
      .eq('id', newBed.id);
    if (occupyError) throw occupyError;
  } catch (error) {
    // Re-open the old allocation and restore the old bed; otherwise the
    // admission would be left unbilled and the old bed stranded in cleaning.
    await db
      .from('bed_allocations')
      .update({ released_at: null })
      .eq('business_id', input.businessId)
      .eq('id', currentAllocation.id);
    await db
      .from('hospital_beds')
      .update({
        status: 'occupied',
        current_admission_id: admission.id,
        updated_at: new Date().toISOString(),
      })
      .eq('business_id', input.businessId)
      .eq('id', currentAllocation.bed_id);
    throw error;
  }

  return getAdmission(input.businessId, admission.id);
}

export async function dischargePatient(input: {
  businessId: string;
  admissionId: string;
  dischargeSummary: string;
  dischargeCondition: DischargeCondition;
  dischargedAt?: string;
  /** When true, releases the bed as clean instead of dirty. */
  bedAlreadyClean?: boolean;
}): Promise<PatientAdmission> {
  const dischargedAt = isoOrNow(input.dischargedAt, new Date());
  const admission = await getAdmission(input.businessId, input.admissionId);
  if (admission.status === 'discharged') throw new Error('This patient is already discharged');
  if (admission.status === 'cancelled') throw new Error('This admission was cancelled');

  const openAllocation =
    admission.allocations?.find((allocation) => !allocation.released_at) ?? null;

  if (openAllocation) {
    const { error: releaseError } = await db
      .from('bed_allocations')
      .update({ released_at: dischargedAt })
      .eq('business_id', input.businessId)
      .eq('id', openAllocation.id)
      .is('released_at', null);
    if (releaseError) throw releaseError;

    const { error: bedError } = await db
      .from('hospital_beds')
      .update({
        status: input.bedAlreadyClean ? 'available' : 'cleaning',
        current_admission_id: null,
        updated_at: dischargedAt,
      })
      .eq('business_id', input.businessId)
      .eq('id', openAllocation.bed_id);
    if (bedError) throw bedError;
  }

  const { error: admissionError } = await db
    .from('patient_admissions')
    .update({
      status: 'discharged',
      discharged_at: dischargedAt,
      discharge_summary: nullableText(input.dischargeSummary),
      discharge_condition: input.dischargeCondition,
      updated_at: dischargedAt,
    })
    .eq('business_id', input.businessId)
    .eq('id', admission.id);
  if (admissionError) throw admissionError;

  return getAdmission(input.businessId, admission.id);
}

const BED_STATUS_TRANSITIONS: Record<BedStatus, readonly BedStatus[]> = {
  available: ['cleaning', 'maintenance', 'reserved'],
  occupied: [],
  cleaning: ['available', 'maintenance', 'reserved'],
  maintenance: ['available'],
  reserved: ['available', 'maintenance'],
};

export async function updateBedStatus(input: {
  businessId: string;
  bedId: string;
  status: BedStatus;
}): Promise<HospitalBed> {
  const { data, error } = await db
    .from('hospital_beds')
    .select('*')
    .eq('business_id', input.businessId)
    .eq('id', input.bedId)
    .single();
  if (error) throw error;
  const bed = normalizeBed(data as Partial<HospitalBed>);
  if (!bed) throw new Error('Bed not found');
  if (bed.status === input.status) return bed;
  if (bed.status === 'occupied') {
    throw new Error('Discharge or transfer the patient before changing this bed');
  }
  if (!BED_STATUS_TRANSITIONS[bed.status].includes(input.status)) {
    throw new Error(`A ${bed.status} bed cannot move to ${input.status}`);
  }

  const { data: updated, error: updateError } = await db
    .from('hospital_beds')
    .update({
      status: input.status,
      current_admission_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('business_id', input.businessId)
    .eq('id', bed.id)
    .select('*')
    .single();
  if (updateError) throw updateError;
  const normalized = normalizeBed(updated as Partial<HospitalBed>);
  if (!normalized) throw new Error('Could not update the bed');
  return normalized;
}

export async function addInpatientCareLog(input: {
  businessId: string;
  admissionId: string;
  recordedBy: string;
  logType: CareLogType;
  note: string;
  recordedAt?: string;
}): Promise<InpatientCareLog> {
  const note = input.note.trim();
  if (!note) throw new Error('Care note is required');
  if (!input.recordedBy) throw new Error('A recorder is required');

  const { data, error } = await db
    .from('inpatient_care_logs')
    .insert({
      business_id: input.businessId,
      admission_id: input.admissionId,
      recorded_by: input.recordedBy,
      log_type: input.logType,
      note,
      recorded_at: isoOrNow(input.recordedAt, new Date()),
    })
    .select('*')
    .single();
  if (error) throw error;
  const log = normalizeCareLog(data as Partial<InpatientCareLog>);
  if (!log) throw new Error('Could not save the care log');
  return log;
}

export async function listInpatientCareLogs(
  businessId: string,
  admissionId: string,
): Promise<InpatientCareLog[]> {
  const { data, error } = await db
    .from('inpatient_care_logs')
    .select('*')
    .eq('business_id', businessId)
    .eq('admission_id', admissionId)
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<Partial<InpatientCareLog>>)
    .map((row) => normalizeCareLog(row))
    .filter((log): log is InpatientCareLog => Boolean(log));
}

/** Compute one charge line per historical bed allocation. */
export async function calculateInpatientStayCharges(
  businessId: string,
  admissionId: string,
  asOf: Date = new Date(),
): Promise<InpatientStayCharge[]> {
  const { data, error } = await db
    .from('bed_allocations')
    .select(STAY_SELECT)
    .eq('business_id', businessId)
    .eq('admission_id', admissionId)
    .order('assigned_at', { ascending: true });
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const bed = (row.bed ?? {}) as Record<string, unknown>;
    const ward = (bed.ward ?? {}) as Record<string, unknown>;
    const assignedAt = text(row.assigned_at, asOf.toISOString());
    const releasedAt = text(row.released_at, asOf.toISOString());
    const dailyRate = roundMoney(toNumber(row.daily_rate_applied));
    const nights = calculateBedNights(assignedAt, releasedAt);
    return {
      bedId: nullableText(bed.id) ?? undefined,
      bedNumber: text(bed.bed_number),
      wardName: text(ward.name),
      wardType: (ward.ward_type ?? null) as WardType | null,
      assignedAt,
      releasedAt,
      nights,
      dailyRate,
      totalCharge: roundMoney(nights * dailyRate),
    };
  });
}

/** Accommodation lines for one visit, including every ward in a transfer chain. */
export async function getVisitBedStayCharges(
  businessId: string,
  visitId: string,
  asOf: Date = new Date(),
): Promise<InpatientStayCharge[]> {
  const admission = await getAdmissionForVisit(businessId, visitId);
  if (!admission) return [];
  return calculateInpatientStayCharges(businessId, admission.id, asOf);
}

export function toAccommodationBillItems(
  charges: readonly InpatientStayCharge[],
): InpatientAccommodationBillItem[] {
  return charges
    .filter((charge) => charge.nights > 0 && charge.dailyRate > 0)
    .map((charge) => {
      const ward = charge.wardName || 'Ward';
      const bed = charge.bedNumber ? ` - ${charge.bedNumber}` : '';
      const nightLabel = charge.nights === 1 ? 'night' : 'nights';
      return {
        description: `Bed stay: ${ward}${bed} (${charge.nights} ${nightLabel})`,
        wardName: ward,
        bedNumber: charge.bedNumber,
        nights: charge.nights,
        dailyRate: charge.dailyRate,
        total: charge.totalCharge,
      };
    });
}

/**
 * Pure HMO split for a chain of bed allocations. Exposed separately so the
 * billing screen and tests can reason about caps/upgrades without a database.
 */
export function calculateInpatientInsuranceSplit(
  charges: readonly InpatientStayCharge[],
  policy: AccommodationCoveragePolicy,
): AccommodationCoverageResult {
  return calculateAccommodationCoverage(charges, policy);
}

/** Re-export for callers that prefer the co-pay clamp helper. */
export function clampInsuranceCopayPercent(value: number | undefined): number {
  return clampPercent(value);
}
