/**
 * healthcareService.ts
 *
 * Data access for the Healthcare & Clinic Management vertical (Phase 1).
 *
 * The vertical is Enterprise-only and is only reachable when the business has
 * HEALTHCARE in `operating_models`; the database enforces tenant isolation and
 * role-aware write authority through RLS (see migration
 * 20261229000000_healthcare_clinic_foundation.sql). This module never trusts a
 * caller-supplied business boundary: every read and write is scoped to the
 * business the UI passes in, and child rows are always created under the
 * parent record that was read back from the database.
 *
 * Pure helpers (MRN formatting, BMI, allergy warnings, bill totals) live here
 * too so they can be unit-tested without a database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { accrueDoctorEarnings } from '@/services/doctorFeeService';

/**
 * The generated Database type predates this vertical, so healthcare tables are
 * not in it yet. Using the untyped client here keeps `from('patients')` legal
 * without weakening the rest of the app, and every response is re-typed to the
 * interfaces below at the boundary.
 */
const db = supabase as unknown as SupabaseClient;

/** Standard walk-in consultation fee (functional currency, VAT exempt). */
export const CONSULTATION_FEE = 15_000;

/** Medical services are VAT exempt in this workflow. */
export const MEDICAL_TAX_RATE = 0;

export type VisitType = 'outpatient' | 'emergency' | 'follow_up' | 'routine_checkup';
export type VisitStage =
  | 'registered'
  | 'triaged'
  | 'with_doctor'
  | 'in_lab'
  | 'at_pharmacy'
  | 'in_billing'
  | 'completed'
  | 'cancelled';

export const ACTIVE_VISIT_STAGES: readonly VisitStage[] = [
  'registered',
  'triaged',
  'with_doctor',
  'in_lab',
  'at_pharmacy',
  'in_billing',
];

/** Linear queue walk used by the one-tap "advance station" action. */
export const VISIT_STAGE_SEQUENCE: readonly VisitStage[] = [
  'registered',
  'triaged',
  'with_doctor',
  'in_lab',
  'at_pharmacy',
  'in_billing',
  'completed',
];

export type BillingType = 'cash' | 'insurance' | 'corporate';
export type BillingCategory = 'consultation' | 'laboratory' | 'pharmacy' | 'procedure';

export interface PatientRecord {
  id?: string;
  business_id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  national_id?: string | null;
  blood_group?: string | null;
  allergies?: string[] | null;
  chronic_conditions?: string[] | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  billing_type: BillingType;
  insurance_provider?: string | null;
  insurance_policy_number?: string | null;
  insurance_member_id?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PatientVisit {
  id?: string;
  business_id: string;
  patient_id: string;
  visit_number: string;
  visit_date: string;
  visit_type: VisitType;
  stage: VisitStage;
  attending_doctor_id?: string | null;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  temperature?: number | null;
  respiratory_rate?: number | null;
  oxygen_saturation?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  blood_sugar_mg_dl?: number | null;
  triage_notes?: string | null;
  triaged_at?: string | null;
  triaged_by?: string | null;
  completed_at?: string | null;
  invoice_id?: string | null;
  created_at?: string;
  updated_at?: string;
  patient?: PatientRecord | null;
}

export interface ConsultationRecord {
  id?: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  chief_complaint: string;
  history_of_present_illness?: string | null;
  physical_examination?: string | null;
  diagnosis: string;
  icd10_code?: string | null;
  treatment_plan?: string | null;
  doctor_notes?: string | null;
  follow_up_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PrescriptionItemInput {
  id?: string;
  product_id?: string | null;
  medication_name: string;
  dosage: string;
  frequency: string;
  duration_days: number;
  quantity: number;
  unit_price: number;
  instructions?: string | null;
  is_dispensed?: boolean;
}

export interface PrescriptionItemRecord extends PrescriptionItemInput {
  id: string;
  prescription_id: string;
  created_at?: string;
}

export interface PrescriptionRecord {
  id?: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  status: 'pending' | 'dispensed' | 'cancelled';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  items?: PrescriptionItemRecord[];
}

export interface LabOrderItemInput {
  id?: string;
  test_name: string;
  test_code?: string | null;
  unit_price: number;
  result_value?: string | null;
  reference_range?: string | null;
  result_status?: 'pending' | 'normal' | 'abnormal' | 'critical';
  technician_notes?: string | null;
  completed_at?: string | null;
}

export interface LabOrderItemRecord extends LabOrderItemInput {
  id: string;
  lab_order_id: string;
  created_at?: string;
}

export interface LabOrderRecord {
  id?: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  status: 'ordered' | 'sample_collected' | 'completed' | 'cancelled';
  clinical_indication?: string | null;
  created_at?: string;
  updated_at?: string;
  items?: LabOrderItemRecord[];
}

export interface BillItem {
  description: string;
  category: BillingCategory;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PatientBillSummary {
  visitId: string;
  patientId?: string | null;
  patientName: string;
  mrn: string;
  billingType: string;
  insuranceProvider?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceMemberId?: string | null;
  doctorId?: string | null;
  items: BillItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface MedicationSearchResult {
  id: string;
  name: string;
  unit_price: number;
}

export interface CreatedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  total: number;
}

export interface AllergyWarning {
  allergen: string;
  medication: string;
  severity: 'high';
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Money is rounded to cents so totals never drift by floating-point dust. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Parse a Postgres numeric that may arrive as a string. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Format the next document number for a prefix. `latest` is the highest
 * existing number (e.g. "PAT-2026-0007"); a missing or malformed value starts
 * the sequence at 1.
 */
export function nextSequenceNumber(
  prefix: string,
  latest: string | null | undefined,
  padding = 4,
): string {
  if (!latest || !latest.startsWith(prefix)) {
    return `${prefix}${String(1).padStart(padding, '0')}`;
  }
  const parsed = Number.parseInt(latest.slice(prefix.length), 10);
  const next = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1;
  return `${prefix}${String(next).padStart(padding, '0')}`;
}

/** MRN prefix for a calendar year, e.g. `PAT-2026-`. */
export function mrnPrefix(year: number): string {
  return `PAT-${year}-`;
}

/** Visit number prefix for a calendar year, e.g. `VST-2026-`. */
export function visitNumberPrefix(year: number): string {
  return `VST-${year}-`;
}

/** Formation rule for a new MRN: PAT-YYYY-XXXX. */
export function formatMrn(year: number, sequence: number): string {
  return `${mrnPrefix(year)}${String(Math.max(1, Math.trunc(sequence))).padStart(4, '0')}`;
}

/** Body-mass index rounded to one decimal, or null for unusable inputs. */
export function calculateBmi(
  weightKg: number | string | null | undefined,
  heightCm: number | string | null | undefined,
): number | null {
  const weight = toNumber(weightKg);
  const height = toNumber(heightCm);
  if (weight <= 0 || height <= 0) return null;
  const metres = height / 100;
  return Math.round((weight / (metres * metres)) * 10) / 10;
}

/**
 * Known cross-reactivity groups. A recorded allergy to one member warns on the
 * whole class, because "Penicillin" in the chart must flag Amoxicillin even
 * though the strings differ.
 */
const ALLERGY_CLASSES: readonly (readonly string[])[] = [
  ['penicillin', 'penicillins', 'amoxicillin', 'ampicillin', 'augmentin', 'co-amoxiclav', 'cloxacillin', 'flucloxacillin', 'piperacillin'],
  ['sulfa', 'sulfonamide', 'sulfonamides', 'cotrimoxazole', 'co-trimoxazole', 'sulfamethoxazole', 'sulfasalazine'],
  ['cephalosporin', 'cephalosporins', 'cephalexin', 'ceftriaxone', 'cefuroxime', 'cefixime', 'cefaclor'],
  ['nsaid', 'nsaids', 'ibuprofen', 'diclofenac', 'naproxen', 'meloxicam', 'piroxicam', 'indomethacin'],
  ['aspirin', 'acetylsalicylic acid'],
  ['opioid', 'opioids', 'codeine', 'morphine', 'tramadol', 'pethidine'],
  ['tetracycline', 'tetracyclines', 'doxycycline'],
  ['macrolide', 'macrolides', 'erythromycin', 'azithromycin', 'clarithromycin'],
  ['latex'],
];

function normalizeAllergen(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function shareAllergyClass(allergen: string, medication: string): boolean {
  const allergenNorm = normalizeAllergen(allergen);
  const medicationNorm = normalizeAllergen(medication);
  return ALLERGY_CLASSES.some((group) => {
    const inGroup = (value: string) =>
      group.some((member) => value === member || value.includes(member) || member.includes(value));
    return inGroup(allergenNorm) && inGroup(medicationNorm);
  });
}

/**
 * Allergy safety check. Returns one warning per (allergen, medication) pair
 * that matches directly or through a cross-reactivity class.
 */
export function findAllergyWarnings(
  allergies: readonly string[] | null | undefined,
  medications: readonly string[] | null | undefined,
): AllergyWarning[] {
  const recorded = (allergies ?? []).map(normalizeAllergen).filter((value) => value.length >= 3);
  const prescribed = (medications ?? []).map((value) => value.trim()).filter(Boolean);
  if (recorded.length === 0 || prescribed.length === 0) return [];

  const warnings = new Map<string, AllergyWarning>();
  for (const allergen of recorded) {
    for (const medication of prescribed) {
      const medicationNorm = normalizeAllergen(medication);
      const directMatch = medicationNorm.includes(allergen) || allergen.includes(medicationNorm);
      if (!directMatch && !shareAllergyClass(allergen, medicationNorm)) continue;
      const key = `${allergen}|${medicationNorm}`;
      if (!warnings.has(key)) {
        warnings.set(key, { allergen, medication, severity: 'high' });
      }
    }
  }
  return [...warnings.values()];
}

/** Video-style red banner text for a set of warnings. */
export function describeAllergyWarnings(warnings: readonly AllergyWarning[]): string {
  if (warnings.length === 0) return '';
  return warnings
    .map((warning) => `${warning.medication} conflicts with recorded ${warning.allergen} allergy`)
    .join('; ');
}

export function nextVisitStage(stage: VisitStage): VisitStage | null {
  const index = VISIT_STAGE_SEQUENCE.indexOf(stage);
  if (index < 0 || index === VISIT_STAGE_SEQUENCE.length - 1) return null;
  return VISIT_STAGE_SEQUENCE[index + 1];
}

export interface BillBuildInput {
  consultationFee?: number;
  labItems?: ReadonlyArray<{
    test_name: string;
    unit_price?: number | string | null;
  }>;
  prescriptionItems?: ReadonlyArray<{
    medication_name: string;
    dosage?: string | null;
    quantity?: number | string | null;
    unit_price?: number | string | null;
  }>;
}

/**
 * Build the itemized bill for a visit. Consultation is always billed once;
 * every lab test and every prescribed line is added at its recorded price.
 */
export function buildBillItems(input: BillBuildInput): BillItem[] {
  const items: BillItem[] = [];

  const consultationFee = roundMoney(toNumber(input.consultationFee ?? CONSULTATION_FEE));
  items.push({
    description: 'Medical Consultation & Clinical Assessment',
    category: 'consultation',
    quantity: 1,
    unitPrice: consultationFee,
    total: consultationFee,
  });

  for (const lab of input.labItems ?? []) {
    const price = roundMoney(toNumber(lab.unit_price));
    items.push({
      description: `Lab Test: ${lab.test_name}`,
      category: 'laboratory',
      quantity: 1,
      unitPrice: price,
      total: price,
    });
  }

  for (const rx of input.prescriptionItems ?? []) {
    const quantity = Math.max(1, Math.trunc(toNumber(rx.quantity, 1)));
    const price = roundMoney(toNumber(rx.unit_price));
    const dosage = rx.dosage ? ` (${rx.dosage})` : '';
    items.push({
      description: `Rx: ${rx.medication_name}${dosage}`,
      category: 'pharmacy',
      quantity,
      unitPrice: price,
      total: roundMoney(quantity * price),
    });
  }

  return items;
}

export function computeBillTotals(items: readonly BillItem[], tax = 0): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + toNumber(item.total), 0));
  const taxAmount = roundMoney(tax);
  return { subtotal, tax: taxAmount, total: roundMoney(subtotal + taxAmount) };
}

// ── Patients ────────────────────────────────────────────────────────────────

/**
 * Next sequential MRN for a business in the current year (PAT-2026-0001).
 *
 * The suffix is read from the highest existing MRN rather than the newest row:
 * a back-dated registration must not recycle a number. The unique constraint on
 * (business_id, mrn) is the final guard against a concurrent writer.
 */
export async function generateNextMrn(businessId: string, now = new Date()): Promise<string> {
  const prefix = mrnPrefix(now.getFullYear());

  const { data, error } = await db
    .from('patients')
    .select('mrn')
    .eq('business_id', businessId)
    .ilike('mrn', `${prefix}%`)
    .order('mrn', { ascending: false })
    .limit(1);

  if (error) throw error;
  return nextSequenceNumber(prefix, (data?.[0] as { mrn?: string } | undefined)?.mrn);
}

/** Create or update a patient. MRNs are generated once and never reissued. */
export async function savePatient(patient: PatientRecord): Promise<PatientRecord> {
  const payload: PatientRecord = {
    ...patient,
    mrn: patient.mrn?.trim() || (await generateNextMrn(patient.business_id)),
    first_name: patient.first_name.trim(),
    last_name: patient.last_name.trim(),
    billing_type: patient.billing_type || 'cash',
    status: patient.status || 'active',
  };

  const { data, error } = await db
    .from('patients')
    .upsert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data as unknown as PatientRecord;
}

export async function listPatients(businessId: string, limit = 500): Promise<PatientRecord[]> {
  const { data, error } = await db
    .from('patients')
    .select('*')
    .eq('business_id', businessId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as PatientRecord[];
}

/**
 * Directory search by MRN, name or phone. `term` is passed to PostgREST's ILIKE
 * filters, so callers must keep it short and free of wildcard syntax.
 */
export async function searchPatients(
  businessId: string,
  term: string,
  limit = 100,
): Promise<PatientRecord[]> {
  const cleaned = term.trim().replace(/[.,()%'"]/g, '');
  if (!cleaned) return listPatients(businessId, limit);

  const { data, error } = await db
    .from('patients')
    .select('*')
    .eq('business_id', businessId)
    .neq('status', 'archived')
    .or(`mrn.ilike.%${cleaned}%,first_name.ilike.%${cleaned}%,last_name.ilike.%${cleaned}%,phone.ilike.%${cleaned}%`)
    .order('last_name', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as PatientRecord[];
}

export async function getPatient(businessId: string, patientId: string): Promise<PatientRecord> {
  const { data, error } = await db
    .from('patients')
    .select('*')
    .eq('business_id', businessId)
    .eq('id', patientId)
    .single();

  if (error) throw error;
  return data as unknown as PatientRecord;
}

// ── Visits & queue ──────────────────────────────────────────────────────────

export async function generateNextVisitNumber(businessId: string, now = new Date()): Promise<string> {
  const prefix = visitNumberPrefix(now.getFullYear());
  const { data, error } = await db
    .from('patient_visits')
    .select('visit_number')
    .eq('business_id', businessId)
    .ilike('visit_number', `${prefix}%`)
    .order('visit_number', { ascending: false })
    .limit(1);

  if (error) throw error;
  return nextSequenceNumber(prefix, (data?.[0] as { visit_number?: string } | undefined)?.visit_number);
}

/** Register a new visit and place the patient in the triage queue. */
export async function checkInPatientVisit(
  businessId: string,
  patientId: string,
  visitType: VisitType = 'outpatient',
  now = new Date(),
): Promise<PatientVisit> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visitNumber = await generateNextVisitNumber(businessId, now);
    const { data, error } = await db
      .from('patient_visits')
      .insert({
        business_id: businessId,
        patient_id: patientId,
        visit_number: visitNumber,
        visit_date: now.toISOString().slice(0, 10),
        visit_type: visitType,
        stage: 'registered',
      })
      .select('*, patient:patients(*)')
      .single();

    if (!error) return data as unknown as PatientVisit;

    lastError = error;
    // 23505 = unique_violation. Another receptionist took this number; retry
    // with the refreshed maximum instead of surfacing a cryptic DB error.
    if ((error as { code?: string }).code !== '23505') throw error;
  }

  throw lastError instanceof Error ? lastError : new Error('Could not allocate a visit number');
}

/** Active queue for today's board, newest first. */
export async function listActiveVisits(businessId: string): Promise<PatientVisit[]> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .in('stage', ACTIVE_VISIT_STAGES as VisitStage[])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as unknown as PatientVisit[];
}

/** Every visit that can still be opened for consultation or billing. */
export async function listOpenVisits(businessId: string): Promise<PatientVisit[]> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .in('stage', VISIT_STAGE_SEQUENCE as VisitStage[])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as unknown as PatientVisit[];
}

export async function getPatientVisit(businessId: string, visitId: string): Promise<PatientVisit> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .eq('id', visitId)
    .single();

  if (error) throw error;
  return data as unknown as PatientVisit;
}

/** Record triage vitals and move the visit to `triaged`. */
export async function recordTriageVitals(
  visitId: string,
  vitals: Partial<PatientVisit>,
  triagedBy?: string | null,
): Promise<void> {
  const { error } = await db
    .from('patient_visits')
    .update({
      systolic_bp: vitals.systolic_bp ?? null,
      diastolic_bp: vitals.diastolic_bp ?? null,
      heart_rate: vitals.heart_rate ?? null,
      temperature: vitals.temperature ?? null,
      respiratory_rate: vitals.respiratory_rate ?? null,
      oxygen_saturation: vitals.oxygen_saturation ?? null,
      weight_kg: vitals.weight_kg ?? null,
      height_cm: vitals.height_cm ?? null,
      blood_sugar_mg_dl: vitals.blood_sugar_mg_dl ?? null,
      triage_notes: vitals.triage_notes ?? null,
      stage: 'triaged',
      triaged_at: new Date().toISOString(),
      triaged_by: triagedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId);

  if (error) throw error;
}

export async function advanceVisitStage(visitId: string, stage: VisitStage): Promise<void> {
  const { error } = await db
    .from('patient_visits')
    .update({
      stage,
      ...(stage === 'completed' || stage === 'cancelled'
        ? { completed_at: new Date().toISOString() }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', visitId);

  if (error) throw error;
}

// ── Consultations ───────────────────────────────────────────────────────────

export async function saveConsultation(
  consultation: ConsultationRecord,
): Promise<ConsultationRecord> {
  const payload = {
    business_id: consultation.business_id,
    visit_id: consultation.visit_id,
    patient_id: consultation.patient_id,
    doctor_id: consultation.doctor_id,
    chief_complaint: consultation.chief_complaint.trim(),
    history_of_present_illness: consultation.history_of_present_illness || null,
    physical_examination: consultation.physical_examination || null,
    diagnosis: consultation.diagnosis.trim(),
    icd10_code: consultation.icd10_code?.trim() || null,
    treatment_plan: consultation.treatment_plan || null,
    doctor_notes: consultation.doctor_notes || null,
    follow_up_date: consultation.follow_up_date || null,
    updated_at: new Date().toISOString(),
  };

  const query = consultation.id
    ? db.from('clinical_consultations').update(payload).eq('id', consultation.id)
    : db.from('clinical_consultations').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error) throw error;

  // Stamp the treating clinician on the visit. The billing station reads this
  // field to accrue the doctor's commission when the invoice is posted, so a
  // consultation without it would silently earn the doctor nothing.
  const { error: visitError } = await db
    .from('patient_visits')
    .update({
      attending_doctor_id: consultation.doctor_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', consultation.visit_id)
    .eq('business_id', consultation.business_id);
  if (visitError) throw visitError;

  return data as unknown as ConsultationRecord;
}

export async function getConsultationForVisit(
  businessId: string,
  visitId: string,
): Promise<ConsultationRecord | null> {
  const { data, error } = await db
    .from('clinical_consultations')
    .select('*')
    .eq('business_id', businessId)
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as ConsultationRecord | null) ?? null;
}

// ── Prescriptions ───────────────────────────────────────────────────────────

/**
 * The visit's editable prescription. Only the pending script is returned: a
 * dispensed script is a clinical record and must never be copied back into the
 * editor, where the next save would prescribe and bill it a second time.
 */
export async function getVisitPrescriptions(
  businessId: string,
  visitId: string,
): Promise<PrescriptionRecord[]> {
  const { data, error } = await db
    .from('prescriptions')
    .select('*, items:prescription_items(*)')
    .eq('business_id', businessId)
    .eq('visit_id', visitId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as PrescriptionRecord[];
}

/**
 * Replace this visit's pending prescription with the supplied items.
 *
 * A consultation screen is saved repeatedly; without this, every save would
 * create another prescription and the bill would charge the drug twice. A
 * dispensed prescription is never edited — new medication becomes a new
 * pending prescription instead.
 */
export async function saveVisitPrescription(input: {
  businessId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  notes?: string | null;
  items: PrescriptionItemInput[];
}): Promise<PrescriptionRecord | null> {
  const items = input.items.filter((item) => item.medication_name.trim() !== '');

  const { data: existing, error: existingError } = await db
    .from('prescriptions')
    .select('id')
    .eq('business_id', input.businessId)
    .eq('visit_id', input.visitId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  // Clearing every medication line must clear the pending prescription too;
  // otherwise a removed drug stays on the bill. A dispensed prescription is
  // never deleted.
  if (items.length === 0) {
    if (existing?.id) {
      const { error: deleteError } = await db
        .from('prescriptions')
        .delete()
        .eq('id', existing.id as string)
        .eq('business_id', input.businessId);
      if (deleteError) throw deleteError;
    }
    return null;
  }

  let prescriptionId: string;
  if (existing?.id) {
    prescriptionId = existing.id as string;
    const { error: updateError } = await db
      .from('prescriptions')
      .update({ notes: input.notes || null, doctor_id: input.doctorId, updated_at: new Date().toISOString() })
      .eq('id', prescriptionId)
      .eq('business_id', input.businessId);
    if (updateError) throw updateError;

    const { error: clearError } = await db
      .from('prescription_items')
      .delete()
      .eq('prescription_id', prescriptionId);
    if (clearError) throw clearError;
  } else {
    const { data: created, error: createError } = await db
      .from('prescriptions')
      .insert({
        business_id: input.businessId,
        visit_id: input.visitId,
        patient_id: input.patientId,
        doctor_id: input.doctorId,
        status: 'pending',
        notes: input.notes || null,
      })
      .select('id')
      .single();
    if (createError) throw createError;
    prescriptionId = created.id as string;
  }

  const { error: itemsError } = await db.from('prescription_items').insert(
    items.map((item) => ({
      prescription_id: prescriptionId,
      product_id: item.product_id ?? null,
      medication_name: item.medication_name.trim(),
      dosage: item.dosage.trim(),
      frequency: item.frequency.trim(),
      duration_days: Math.max(1, Math.trunc(toNumber(item.duration_days, 1))),
      quantity: Math.max(1, Math.trunc(toNumber(item.quantity, 1))),
      unit_price: roundMoney(toNumber(item.unit_price)),
      instructions: item.instructions || null,
      is_dispensed: Boolean(item.is_dispensed),
    })),
  );
  if (itemsError) throw itemsError;

  const { data, error } = await db
    .from('prescriptions')
    .select('*, items:prescription_items(*)')
    .eq('id', prescriptionId)
    .single();
  if (error) throw error;
  return data as unknown as PrescriptionRecord;
}

// ── Lab orders ──────────────────────────────────────────────────────────────

/** The visit's editable lab order (open orders only; collected/completed
 *  results are records, not draft lines). */
export async function getVisitLabOrders(
  businessId: string,
  visitId: string,
): Promise<LabOrderRecord[]> {
  const { data, error } = await db
    .from('lab_orders')
    .select('*, items:lab_order_items(*)')
    .eq('business_id', businessId)
    .eq('visit_id', visitId)
    .eq('status', 'ordered')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as LabOrderRecord[];
}

/** Replace the visit's open lab order with the supplied tests (same rationale
 *  as saveVisitPrescription: resaving a consultation must not double-bill). */
export async function saveVisitLabOrder(input: {
  businessId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  clinicalIndication?: string | null;
  items: LabOrderItemInput[];
}): Promise<LabOrderRecord | null> {
  const items = input.items.filter((item) => item.test_name.trim() !== '');

  const { data: existing, error: existingError } = await db
    .from('lab_orders')
    .select('id')
    .eq('business_id', input.businessId)
    .eq('visit_id', input.visitId)
    .eq('status', 'ordered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  // Same clearing rule as prescriptions: an order that was emptied must stop
  // billing its tests. Collected/completed orders are clinical records and are
  // left untouched.
  if (items.length === 0) {
    if (existing?.id) {
      const { error: deleteError } = await db
        .from('lab_orders')
        .delete()
        .eq('id', existing.id as string)
        .eq('business_id', input.businessId);
      if (deleteError) throw deleteError;
    }
    return null;
  }

  let labOrderId: string;
  if (existing?.id) {
    labOrderId = existing.id as string;
    const { error: updateError } = await db
      .from('lab_orders')
      .update({
        doctor_id: input.doctorId,
        clinical_indication: input.clinicalIndication || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', labOrderId)
      .eq('business_id', input.businessId);
    if (updateError) throw updateError;

    const { error: clearError } = await db
      .from('lab_order_items')
      .delete()
      .eq('lab_order_id', labOrderId);
    if (clearError) throw clearError;
  } else {
    const { data: created, error: createError } = await db
      .from('lab_orders')
      .insert({
        business_id: input.businessId,
        visit_id: input.visitId,
        patient_id: input.patientId,
        doctor_id: input.doctorId,
        status: 'ordered',
        clinical_indication: input.clinicalIndication || null,
      })
      .select('id')
      .single();
    if (createError) throw createError;
    labOrderId = created.id as string;
  }

  const { error: itemsError } = await db.from('lab_order_items').insert(
    items.map((item) => ({
      business_id: input.businessId,
      lab_order_id: labOrderId,
      test_name: item.test_name.trim(),
      test_code: item.test_code?.trim() || null,
      unit_price: roundMoney(toNumber(item.unit_price)),
      result_status: item.result_status ?? 'pending',
    })),
  );
  if (itemsError) throw itemsError;

  const { data, error } = await db
    .from('lab_orders')
    .select('*, items:lab_order_items(*)')
    .eq('id', labOrderId)
    .single();
  if (error) throw error;
  return data as unknown as LabOrderRecord;
}

// ── Medications catalogue ───────────────────────────────────────────────────

/** Search the tenant's product catalogue for a dispensable drug. */
export async function searchMedications(
  businessId: string,
  term: string,
  limit = 8,
): Promise<MedicationSearchResult[]> {
  const cleaned = term.trim().replace(/[.,()%'"]/g, '');
  if (cleaned.length < 2) return [];

  const { data, error } = await db
    .from('products')
    .select('id, name, sale_price, unit_price')
    .eq('business_id', businessId)
    .ilike('name', `%${cleaned}%`)
    .order('name', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    unit_price: roundMoney(toNumber(row.sale_price ?? row.unit_price)),
  }));
}

// ── Billing ─────────────────────────────────────────────────────────────────

/** Compile the itemized bill for a patient visit (consultation + lab + Rx). */
export async function getPatientVisitBill(visitId: string): Promise<PatientBillSummary> {
  const { data: visit, error: visitError } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('id', visitId)
    .single();

  if (visitError) throw visitError;
  if (!visit) throw new Error('Patient visit not found');

  const typedVisit = visit as unknown as PatientVisit;
  const patient = typedVisit.patient ?? null;

  const [{ data: labOrders, error: labError }, { data: prescriptions, error: rxError }] =
    await Promise.all([
      db
        .from('lab_orders')
        .select('id, status, items:lab_order_items(*)')
        .eq('visit_id', visitId)
        .neq('status', 'cancelled'),
      db
        .from('prescriptions')
        .select('id, status, items:prescription_items(*)')
        .eq('visit_id', visitId)
        .neq('status', 'cancelled'),
    ]);

  if (labError) throw labError;
  if (rxError) throw rxError;

  const labItems = ((labOrders ?? []) as Array<{ items?: LabOrderItemRecord[] }>).flatMap(
    (order) => order.items ?? [],
  );
  const prescriptionItems = ((prescriptions ?? []) as Array<{ items?: PrescriptionItemRecord[] }>).flatMap(
    (rx) => rx.items ?? [],
  );

  const items = buildBillItems({
    consultationFee: CONSULTATION_FEE,
    labItems,
    prescriptionItems,
  });
  const totals = computeBillTotals(items, MEDICAL_TAX_RATE);

  return {
    visitId,
    patientId: patient?.id ?? null,
    patientName: `${patient?.first_name ?? ''} ${patient?.last_name ?? ''}`.trim(),
    mrn: patient?.mrn ?? '',
    billingType: patient?.billing_type ?? 'cash',
    insuranceProvider: patient?.insurance_provider ?? null,
    insurancePolicyNumber: patient?.insurance_policy_number ?? null,
    insuranceMemberId: patient?.insurance_member_id ?? null,
    doctorId: typedVisit.attending_doctor_id ?? null,
    items,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
  };
}

/**
 * Post the visit bill to Ledgr Invoicing as a draft AR invoice and link the
 * visit to it. Medical lines are VAT exempt, so tax fields stay at zero.
 *
 * A patient is not an AR customer, so the caller chooses the payer contact
 * (the patient's customer record, an insurer, or a corporate account).
 */
export async function createInvoiceForVisit(input: {
  businessId: string;
  visitId: string;
  contactId: string;
  currency: string;
  createdBy?: string | null;
  dueInDays?: number;
  /**
   * Optional payer-share lines. Insurance billing passes the insurer portion of
   * each split line so the draft AR invoice bills the HMO, not the full gross
   * bill. Cash billing omits this and keeps the Phase 1 full-bill behaviour.
   */
  invoiceLines?: BillItem[];
}): Promise<CreatedInvoice> {
  if (!input.contactId) throw new Error('Select the invoice customer or payer first');

  const bill = await getPatientVisitBill(input.visitId);
  if (bill.items.length === 0) throw new Error('This visit has no billable items');

  const invoiceItems = (input.invoiceLines ?? bill.items).filter(
    (item) => Number.isFinite(item.total) && item.total > 0,
  );
  if (invoiceItems.length === 0) throw new Error('This visit has no billable items');
  const invoiceSubtotal = roundMoney(
    invoiceItems.reduce((total, item) => total + item.total, 0),
  );

  const invoiceNumber = await repos.business.reserveNextInvoiceNumber(input.businessId);
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + (input.dueInDays ?? 0));

  const { data: invoice, error: invoiceError } = await db
    .from('invoices')
    .insert({
      business_id: input.businessId,
      contact_id: input.contactId,
      invoice_number: invoiceNumber,
      invoice_type: 'invoice',
      status: 'draft',
      issue_date: issueDate.toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
      currency: input.currency,
      exchange_rate: 1,
      rate_is_stale: false,
      template: 'professional',
      subtotal: invoiceSubtotal,
      discount_amount: 0,
      discount_percent: 0,
      taxable_amount: 0,
      vat_amount: 0,
      wht_amount: 0,
      total_amount: invoiceSubtotal,
      amount_paid: 0,
      amount_due: invoiceSubtotal,
      notes: `Patient visit ${input.visitId} · MRN ${bill.mrn}`,
      created_by: input.createdBy ?? null,
    })
    .select('id, invoice_number, total_amount')
    .single();

  if (invoiceError) throw invoiceError;

  const invoiceId = invoice.id as string;
  const { error: linesError } = await db.from('invoice_lines').insert(
    invoiceItems.map((item, index) => ({
      invoice_id: invoiceId,
      business_id: input.businessId,
      line_number: index + 1,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_subtotal: item.total,
      line_total: item.total,
      discount_amount: 0,
      discount_percent: 0,
      tax_amount: 0,
      tax_rate: MEDICAL_TAX_RATE,
      tax_code: 'vat_exempt',
    })),
  );
  if (linesError) throw linesError;

  const { error: linkError } = await db
    .from('patient_visits')
    .update({ invoice_id: invoiceId, updated_at: new Date().toISOString() })
    .eq('id', input.visitId)
    .eq('business_id', input.businessId);
  if (linkError) throw linkError;

  // Automated doctor accrual: the commission is earned by the clinical work,
  // not by the payer mix, so it is calculated from the full visit bill even
  // when the invoice itself only bills the insurer share.
  if (bill.doctorId) {
    const consultation = roundMoney(
      bill.items
        .filter((item) => item.category === 'consultation')
        .reduce((total, item) => total + item.total, 0),
    );
    const lab = roundMoney(
      bill.items
        .filter((item) => item.category === 'laboratory')
        .reduce((total, item) => total + item.total, 0),
    );
    const pharmacy = roundMoney(
      bill.items
        .filter((item) => item.category === 'pharmacy')
        .reduce((total, item) => total + item.total, 0),
    );
    try {
      await accrueDoctorEarnings(input.businessId, input.visitId, bill.doctorId, invoiceId, {
        consultation,
        lab,
        pharmacy,
      });
    } catch (accrualError) {
      // The invoice is already posted; failing the whole request would make the
      // cashier retry and create a second invoice. Surface the problem in the
      // console and let the commissions station re-accrue or fix the contract.
      console.warn('Doctor commission accrual failed:', accrualError);
    }
  }

  return {
    invoiceId,
    invoiceNumber: String(invoice.invoice_number ?? invoiceNumber),
    total: roundMoney(toNumber(invoice.total_amount, invoiceSubtotal)),
  };
}

// ── Dashboard counters ──────────────────────────────────────────────────────

export interface QueueCounters {
  registered: number;
  triaged: number;
  with_doctor: number;
  in_lab: number;
  at_pharmacy: number;
  in_billing: number;
  completed: number;
}

export function countVisitsByStage(visits: readonly PatientVisit[]): QueueCounters {
  const counters: QueueCounters = {
    registered: 0,
    triaged: 0,
    with_doctor: 0,
    in_lab: 0,
    at_pharmacy: 0,
    in_billing: 0,
    completed: 0,
  };
  for (const visit of visits) {
    if (visit.stage in counters) counters[visit.stage as keyof QueueCounters] += 1;
  }
  return counters;
}
