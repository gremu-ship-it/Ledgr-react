import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  generateNextVisitNumber,
  type PatientVisit,
  type VisitStage,
} from '@/services/healthcareService';
import { buildTelemedicineRoomUrl } from '@/services/telemedicineService';
import { nextQueueToken, parseQueueToken } from '@/lib/healthcare/queue';
import type {
  AcuityLevel,
  ClinicalProcedureOrder,
  TelemedicineStatus,
  VisitType,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

/** Acuity order used by the doctor, triage and flight boards. */
export const ACUITY_SEVERITY: Record<AcuityLevel, number> = {
  emergency: 0,
  urgent: 1,
  priority: 2,
  routine: 3,
};

export const ACUITY_LEVELS: readonly AcuityLevel[] = [
  'emergency',
  'urgent',
  'priority',
  'routine',
];

/** Visit columns added by the hospital flow migration. */
export interface ClinicalFlowVisit extends PatientVisit {
  queue_token?: string | null;
  acuity_level?: AcuityLevel | null;
  meeting_url?: string | null;
  telemedicine_status?: TelemedicineStatus | null;
  telemedicine_notes?: string | null;
  has_pending_lab?: boolean | null;
  has_pending_radiology?: boolean | null;
  has_pending_procedure?: boolean | null;
  results_ready_for_review?: boolean | null;
  results_ready_at?: string | null;
}

export interface NurseTriageVitals {
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  temperature?: number | null;
  respiratory_rate?: number | null;
  oxygen_saturation?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  blood_sugar_mg_dl?: number | null;
}

export interface NurseTriageInput {
  visitId: string;
  businessId?: string;
  acuity: AcuityLevel;
  vitals: NurseTriageVitals;
  notes?: string | null;
  triagedBy?: string | null;
}

export interface CheckInPatientInput {
  patientId: string;
  visitType?: VisitType | 'outpatient' | 'emergency' | 'follow_up' | 'routine_checkup';
  acuityLevel?: AcuityLevel | null;
  attendingDoctorId?: string | null;
  now?: Date;
}

export interface ClinicalProcedureOrderInput {
  businessId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  procedureName: string;
  procedureCode?: string | null;
  category?: ClinicalProcedureOrder['category'];
  unitPrice?: number;
  notes?: string | null;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

export { formatQueueToken, parseQueueToken } from '@/lib/healthcare/queue';

/** Acuity rank (Emergency 0 … Routine 3) with unknown values last. */
export function acuityRank(acuity: AcuityLevel | string | null | undefined): number {
  if (!acuity) return 4;
  return ACUITY_SEVERITY[acuity as AcuityLevel] ?? 4;
}

/**
 * Emergency before Urgent before Priority before Routine. Within one acuity
 * level the earliest queue token wins, then the oldest registration.
 */
export function sortVisitsByAcuity<T extends {
  acuity_level?: AcuityLevel | string | null;
  queue_token?: string | null;
  created_at?: string | null;
}>(visits: readonly T[]): T[] {
  return [...visits].sort((left, right) => {
    const byAcuity = acuityRank(left.acuity_level) - acuityRank(right.acuity_level);
    if (byAcuity !== 0) return byAcuity;

    const leftToken = parseQueueToken(left.queue_token);
    const rightToken = parseQueueToken(right.queue_token);
    if (leftToken !== null || rightToken !== null) {
      if (leftToken === null) return 1;
      if (rightToken === null) return -1;
      if (leftToken !== rightToken) return leftToken - rightToken;
    }

    return String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''));
  });
}

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ── Queue + reception ──────────────────────────────────────────────────────

/** Reserve the next Q-NNN token for today's queue. */
export async function generateQueueToken(
  businessId: string,
  now = new Date(),
): Promise<string> {
  const { data, error } = await db
    .from('patient_visits')
    .select('queue_token')
    .eq('business_id', businessId)
    .eq('visit_date', todayIso(now))
    .not('queue_token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return nextQueueToken(data);
}

/**
 * Reception check-in: allocates the visit number and queue token, and creates
 * the Jitsi room up-front when the patient is booked for telemedicine.
 */
export async function checkInPatient(
  businessId: string,
  input: CheckInPatientInput,
): Promise<ClinicalFlowVisit> {
  if (!businessId) throw new Error('Business is required');
  if (!input.patientId) throw new Error('Patient is required');

  const now = input.now ?? new Date();
  const visitType = input.visitType ?? 'in_person';
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [visitNumber, queueToken] = await Promise.all([
      generateNextVisitNumber(businessId, now),
      generateQueueToken(businessId, now),
    ]);

    const meetingUrl =
      visitType === 'telemedicine'
        ? buildTelemedicineRoomUrl(businessId, `${visitNumber}-${queueToken}`)
        : null;

    const { data, error } = await db
      .from('patient_visits')
      .insert({
        business_id: businessId,
        patient_id: input.patientId,
        visit_number: visitNumber,
        visit_date: todayIso(now),
        visit_type: visitType,
        stage: 'registered',
        queue_token: queueToken,
        acuity_level: input.acuityLevel ?? null,
        attending_doctor_id: input.attendingDoctorId ?? null,
        meeting_url: meetingUrl,
        telemedicine_status: visitType === 'telemedicine' ? 'waiting' : 'waiting',
      })
      .select('*, patient:patients(*)')
      .single();

    if (!error) return data as unknown as ClinicalFlowVisit;
    lastError = error;
    // Visit-number or queue-token collision: re-read the maxima and retry.
    if ((error as { code?: string }).code !== '23505') throw error;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not allocate a visit or queue number');
}

/** All visits still moving through the hospital, newest first. */
export async function listClinicalFlowVisits(
  businessId: string,
): Promise<ClinicalFlowVisit[]> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .not('stage', 'in', '(completed,cancelled)')
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) throw error;
  return (data ?? []) as unknown as ClinicalFlowVisit[];
}

/** Today's reception queue, acuity-sorted. */
export async function listReceptionQueue(
  businessId: string,
  now = new Date(),
): Promise<ClinicalFlowVisit[]> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .eq('visit_date', todayIso(now))
    .in('stage', ['registered', 'triaged'])
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) throw error;
  return sortVisitsByAcuity(
    (data ?? []) as unknown as ClinicalFlowVisit[],
  );
}

// ── Nurse triage ───────────────────────────────────────────────────────────

function normalizeTriageInput(
  visitIdOrInput: string | NurseTriageInput,
  maybeInput?: NurseTriageInput,
): NurseTriageInput {
  if (typeof visitIdOrInput === 'string') {
    if (!maybeInput) throw new Error('Triage details are required');
    return { ...maybeInput, visitId: visitIdOrInput };
  }
  return visitIdOrInput;
}

/**
 * Persist acuity + vitals and move the visit to `triaged`. The doctor station
 * reads the acuity column to sort its queue Emergency → Routine.
 */
export async function submitNurseTriage(
  input: NurseTriageInput,
): Promise<ClinicalFlowVisit>;
export async function submitNurseTriage(
  visitId: string,
  input: NurseTriageInput,
): Promise<ClinicalFlowVisit>;
export async function submitNurseTriage(
  visitIdOrInput: string | NurseTriageInput,
  maybeInput?: NurseTriageInput,
): Promise<ClinicalFlowVisit> {
  const input = normalizeTriageInput(visitIdOrInput, maybeInput);
  if (!input.visitId) throw new Error('Visit is required');
  if (!ACUITY_LEVELS.includes(input.acuity)) {
    throw new Error('Select an acuity level');
  }

  const vitals = input.vitals ?? {};
  const hasVital = Object.values(vitals).some(
    (value) => value !== null && value !== undefined && value !== '',
  );
  if (!hasVital) throw new Error('Record at least one vital sign');

  const payload = {
    ...vitals,
    acuity_level: input.acuity,
    triage_notes: input.notes ?? null,
    triaged_at: new Date().toISOString(),
    triaged_by: input.triagedBy ?? null,
    stage: 'triaged' as VisitStage,
  };

  let query = db.from('patient_visits').update(payload).eq('id', input.visitId);
  if (input.businessId) query = query.eq('business_id', input.businessId);

  const { data, error } = await query.select('*, patient:patients(*)').single();
  if (error) throw error;
  return data as unknown as ClinicalFlowVisit;
}

// ── Diagnostic loop-back ───────────────────────────────────────────────────

async function pendingDiagnostics(
  businessId: string,
  visitId: string,
  labAlreadyComplete = false,
): Promise<{ lab: number; radiology: number }> {
  const [labResult, radiologyResult] = await Promise.all([
    labAlreadyComplete
      ? Promise.resolve({ data: [] as unknown[], error: null })
      : db
          .from('lab_orders')
          .select('id, status')
          .eq('business_id', businessId)
          .eq('visit_id', visitId)
          .neq('status', 'completed')
          .neq('status', 'cancelled'),
    db
      .from('radiology_orders')
      .select('id, status')
      .eq('business_id', businessId)
      .eq('visit_id', visitId)
      .neq('status', 'completed')
      .neq('status', 'cancelled'),
  ]);

  if (labResult.error) throw labResult.error;
  if (radiologyResult.error) throw radiologyResult.error;

  return {
    lab: (labResult.data ?? []).length,
    radiology: (radiologyResult.data ?? []).length,
  };
}

/**
 * After a lab or scan is completed, check the other track. Once neither track
 * has an open order the patient loops back to the doctor with
 * `stage='results_review'` and `results_ready_for_review=true`.
 *
 * Returns true when the visit was looped back.
 */
export async function checkAndTriggerResultsReview(
  visitId: string,
  businessId?: string,
  options: { labAlreadyComplete?: boolean } = {},
): Promise<boolean> {
  let tenantId = businessId;
  if (!tenantId) {
    const { data: visit, error } = await db
      .from('patient_visits')
      .select('id, business_id')
      .eq('id', visitId)
      .single();
    if (error) throw error;
    tenantId = (visit as { business_id?: string } | null)?.business_id;
  }
  if (!tenantId) throw new Error('Patient visit not found');

  const pending = await pendingDiagnostics(
    tenantId,
    visitId,
    Boolean(options.labAlreadyComplete),
  );
  const pendingLab = pending.lab > 0;
  const pendingRadiology = pending.radiology > 0;

  if (pendingLab || pendingRadiology) {
    const { error } = await db
      .from('patient_visits')
      .update({
        has_pending_lab: pendingLab,
        has_pending_radiology: pendingRadiology,
        results_ready_for_review: false,
      })
      .eq('id', visitId)
      .eq('business_id', tenantId);
    if (error) throw error;
    return false;
  }

  const nowIso = new Date().toISOString();
  const { error } = await db
    .from('patient_visits')
    .update({
      stage: 'results_review' as VisitStage,
      has_pending_lab: false,
      has_pending_radiology: false,
      has_pending_procedure: false,
      results_ready_for_review: true,
      results_ready_at: nowIso,
    })
    .eq('id', visitId)
    .eq('business_id', tenantId);

  if (error) throw error;
  return true;
}

/** Doctor acknowledges the loop-back and resumes the consultation. */
export async function markResultsReviewed(
  businessId: string,
  visitId: string,
  nextStage: VisitStage = 'with_doctor',
): Promise<ClinicalFlowVisit> {
  const { data, error } = await db
    .from('patient_visits')
    .update({
      stage: nextStage,
      results_ready_for_review: false,
    })
    .eq('business_id', businessId)
    .eq('id', visitId)
    .select('*, patient:patients(*)')
    .single();

  if (error) throw error;
  return data as unknown as ClinicalFlowVisit;
}

// ── Treatment-room procedures ──────────────────────────────────────────────

export async function createClinicalProcedureOrder(
  input: ClinicalProcedureOrderInput,
): Promise<ClinicalProcedureOrder> {
  if (!input.procedureName.trim()) throw new Error('Procedure name is required');

  const { data, error } = await db
    .from('clinical_procedure_orders')
    .insert({
      business_id: input.businessId,
      visit_id: input.visitId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      procedure_code: input.procedureCode ?? null,
      procedure_name: input.procedureName.trim(),
      category: input.category ?? 'other',
      status: 'ordered',
      unit_price: Number(input.unitPrice ?? 0) || 0,
      notes: input.notes ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;

  await db
    .from('patient_visits')
    .update({ has_pending_procedure: true })
    .eq('business_id', input.businessId)
    .eq('id', input.visitId);

  return data as unknown as ClinicalProcedureOrder;
}

export async function listVisitProcedureOrders(
  businessId: string,
  visitId: string,
): Promise<ClinicalProcedureOrder[]> {
  const { data, error } = await db
    .from('clinical_procedure_orders')
    .select('*')
    .eq('business_id', businessId)
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as ClinicalProcedureOrder[];
}

export async function completeClinicalProcedureOrder(
  businessId: string,
  procedureId: string,
  performedBy?: string | null,
): Promise<ClinicalProcedureOrder> {
  const { data, error } = await db
    .from('clinical_procedure_orders')
    .update({
      status: 'completed',
      performed_by: performedBy ?? null,
      performed_at: new Date().toISOString(),
    })
    .eq('business_id', businessId)
    .eq('id', procedureId)
    .select('*')
    .single();

  if (error) throw error;
  return data as unknown as ClinicalProcedureOrder;
}
