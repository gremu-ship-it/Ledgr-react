/**
 * Pharmacy dispensary and laboratory diagnostics domain types.
 *
 * These describe the shapes the Phase 2 services return from PostgREST
 * (snake_case columns, nested relations) and the camelCase payloads the UI
 * passes between modals. Phase 1 keeps its own `*Record` types inside
 * `healthcareService`; this module is the single shared surface for the
 * dispensary and lab stations.
 */

/** Result classification used by `labService.evaluateResultStatus`. */
export type ResultStatus = 'pending' | 'normal' | 'abnormal' | 'critical';

/** Triage acuity, ordered from most to least urgent. */
export type AcuityLevel = 'emergency' | 'urgent' | 'priority' | 'routine';

/** How the patient is being seen. */
export type VisitType = 'in_person' | 'telemedicine' | 'home_visit';

/** Lifecycle of a telemedicine waiting-room entry. */
export type TelemedicineStatus =
  | 'waiting'
  | 'link_sent'
  | 'in_call'
  | 'completed'
  | 'cancelled';

/** Imaging modalities accepted by the radiology station. */
export type RadiologyModality =
  | 'xray'
  | 'ultrasound'
  | 'ct'
  | 'mri'
  | 'ecg'
  | 'echo'
  | 'mammography'
  | 'other';

export type RadiologyOrderStatus =
  | 'ordered'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type RadiologyItemStatus =
  | 'pending'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type RadiologyUrgency = 'routine' | 'urgent' | 'stat';

/** One scan line inside a radiology requisition. */
export interface RadiologyOrderItem {
  id?: string;
  radiology_order_id?: string;
  business_id?: string;
  modality: RadiologyModality;
  procedure_name: string;
  body_site?: string | null;
  unit_price: number;
  status: RadiologyItemStatus;
  findings?: string | null;
  impression?: string | null;
  recommendations?: string | null;
  image_urls?: string[];
  technician_id?: string | null;
  radiologist_id?: string | null;
  performed_at?: string | null;
  reported_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A radiology / imaging requisition (header + scan lines). */
export interface RadiologyOrder {
  id: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  order_number: string;
  status: RadiologyOrderStatus;
  urgency: RadiologyUrgency;
  clinical_indication?: string | null;
  ordered_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  items?: RadiologyOrderItem[];
  patient?: {
    id?: string;
    mrn: string;
    first_name: string;
    last_name: string;
    phone?: string | null;
    date_of_birth?: string | null;
    gender?: string | null;
  } | null;
  visit?: {
    id?: string;
    visit_number?: string;
    queue_token?: string | null;
    acuity_level?: AcuityLevel | null;
    visit_type?: string;
    stage?: string;
  } | null;
}

export interface RadiologyOrderItemInput {
  modality: RadiologyModality;
  procedureName: string;
  bodySite?: string | null;
  unitPrice: number;
}

/** One treatment-room / minor procedure performed during a visit. */
export interface ClinicalProcedureOrder {
  id?: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  procedure_code?: string | null;
  procedure_name: string;
  category:
    | 'minor_surgery'
    | 'wound_care'
    | 'injection'
    | 'dressing'
    | 'diagnostic'
    | 'other';
  status: 'ordered' | 'in_progress' | 'completed' | 'cancelled';
  unit_price: number;
  notes?: string | null;
  performed_by?: string | null;
  performed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Data the printable imaging report needs. */
export interface RadiologyReportData {
  businessName: string;
  orderNumber: string;
  patientName: string;
  mrn: string;
  modality: RadiologyModality | string;
  procedureName: string;
  bodySite?: string | null;
  clinicalIndication?: string | null;
  findings: string;
  impression: string;
  recommendations?: string | null;
  imageUrls?: string[];
  performedAt?: string | null;
  reportedAt?: string | null;
  radiologist?: string | null;
  technician?: string | null;
  labels: {
    title: string;
    patient: string;
    mrn: string;
    modality: string;
    procedure: string;
    bodySite: string;
    indication: string;
    findings: string;
    impression: string;
    recommendations: string;
    images: string;
    performedAt: string;
    reportedAt: string;
    radiologist: string;
    technician: string;
    signature: string;
    disclaimer: string;
  };
}

/** Formats accepted on a medication sticker. */
export type MedicationLabelFormat = '58mm' | '80mm';

/** Specimen states mirrored by the `lab_specimens.status` check constraint. */
export type SpecimenStatus = 'pending' | 'collected' | 'in_analysis' | 'rejected';

/** Specimen types mirrored by the `lab_specimens.specimen_type` check. */
export type SpecimenType =
  | 'blood'
  | 'urine'
  | 'stool'
  | 'sputum'
  | 'swab'
  | 'tissue'
  | 'other';

/** One physical delivery of a medication into the pharmacy store. */
export interface MedicationBatch {
  id: string;
  business_id: string;
  product_id?: string | null;
  medication_name: string;
  batch_number: string;
  quantity_received: number;
  quantity_on_hand: number;
  unit_cost: number;
  /** ISO date (`YYYY-MM-DD`). */
  expiry_date: string;
  /** ISO date (`YYYY-MM-DD`). */
  received_date: string;
  supplier_name?: string | null;
  storage_location?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MedicationBatchInput {
  businessId: string;
  medicationName: string;
  batchNumber: string;
  quantityReceived: number;
  unitCost: number;
  expiryDate: string;
  receivedDate?: string;
  supplierName?: string | null;
  storageLocation?: string | null;
  notes?: string | null;
  productId?: string | null;
}

/** An immutable audit row written by `dispense_prescription_item`. */
/** Data a dispensary hands to the 58/80mm label printer. */
export interface MedicationLabelPayload {
  patientName: string;
  mrn: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instructions?: string | null;
  batchNumber: string;
  expiryDate: string;
  dispensedAt: string;
  pharmacist?: string | null;
  warnings?: string[];
}

export interface DispensationRecord {
  id: string;
  business_id: string;
  prescription_item_id: string;
  batch_id: string;
  quantity_dispensed: number;
  unit_price: number;
  dispensed_by: string;
  dispensed_at: string;
  notes?: string | null;
  batch?: Pick<
    MedicationBatch,
    'id' | 'medication_name' | 'batch_number' | 'expiry_date'
  > | null;
  item?: Pick<
    PrescriptionItem,
    'id' | 'medication_name' | 'dosage' | 'quantity'
  > | null;
}

export interface PrescriptionItem {
  id: string;
  prescription_id?: string;
  product_id?: string | null;
  medication_name: string;
  dosage: string;
  frequency: string;
  duration_days: number;
  quantity: number;
  unit_price: number;
  instructions?: string | null;
  is_dispensed: boolean;
  quantity_dispensed?: number;
  dispensed_at?: string | null;
  created_at?: string | null;
}

export type PrescriptionStatus =
  | 'pending'
  | 'partially_dispensed'
  | 'dispensed'
  | 'cancelled';

export interface Prescription {
  id: string;
  business_id?: string;
  visit_id?: string;
  patient_id?: string;
  doctor_id?: string;
  status: PrescriptionStatus;
  notes?: string | null;
  dispensed_at?: string | null;
  created_at?: string | null;
  items: PrescriptionItem[];
}

/** Minimal patient projection rendered on dispensary and lab screens. */
export interface HealthcarePatientSummary {
  id: string;
  mrn: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  gender?: string | null;
  phone?: string | null;
  allergies?: string[] | null;
}

/** A visit waiting at the pharmacy counter. */
export interface PharmacyQueueVisit {
  id: string;
  business_id?: string;
  visit_number: string;
  visit_date: string;
  stage: string;
  patient: HealthcarePatientSummary | null;
  prescriptions: Prescription[];
}

export interface DispenseItemPayload {
  businessId: string;
  prescriptionItemId: string;
  batchId: string;
  quantity: number;
  notes?: string | null;
}

/** Return value of the atomic `dispense_prescription_item` RPC. */
export interface DispenseResult {
  dispensationId: string;
  prescriptionItemId: string;
  batchId: string;
  quantityDispensed: number;
  batchQuantityRemaining: number;
  prescriptionStatus: PrescriptionStatus;
  itemFullyDispensed?: boolean;
  quantityRemainingOnItem?: number;
  visitStage: string;
}

/** A physical sample registered against a laboratory order. */
export interface LabSpecimen {
  id: string;
  business_id: string;
  lab_order_id: string;
  specimen_barcode: string;
  specimen_type: SpecimenType;
  status: SpecimenStatus;
  collected_at?: string | null;
  collected_by?: string | null;
  rejection_reason?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Laboratory order item, including the Phase 2 reference-range columns. */
export interface LabOrderItem {
  id: string;
  lab_order_id?: string;
  business_id?: string;
  test_name: string;
  test_code?: string | null;
  unit_price: number;
  result_value?: string | null;
  reference_range?: string | null;
  result_status: ResultStatus;
  technician_notes?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  specimen_id?: string | null;
  unit_of_measure?: string | null;
  min_normal?: number | null;
  max_normal?: number | null;
  critical_low?: number | null;
  critical_high?: number | null;
  technician_id?: string | null;
  verified_at?: string | null;
  specimen?: LabSpecimen | null;
}

export type LabOrderStatus = 'ordered' | 'sample_collected' | 'completed' | 'cancelled';

export interface LabOrder {
  id: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  status: LabOrderStatus;
  clinical_indication?: string | null;
  technician_notes?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
  updated_at?: string | null;
  patient?: HealthcarePatientSummary | null;
  visit?: {
    id: string;
    visit_number: string;
    visit_date: string;
    stage: string;
  } | null;
  items: LabOrderItem[];
  specimens?: LabSpecimen[];
}

/** Numeric bounds used to classify a laboratory result. */
export interface LabReferenceRange {
  unit?: string | null;
  minNormal?: number | null;
  maxNormal?: number | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  /** Short aliases accepted by `evaluateResultStatus` callers. */
  min?: number | null;
  max?: number | null;
  criticalMin?: number | null;
  criticalMax?: number | null;
}

/** Alias used by result-classification callers. */
export type ReferenceRange = LabReferenceRange;

export interface LabResultPayload {
  businessId: string;
  itemId: string;
  resultValue: string;
  referenceRange?: LabReferenceRange;
  technicianNotes?: string | null;
  technicianId?: string | null;
}

export interface CollectSpecimenInput {
  businessId: string;
  labOrderId: string;
  specimenType: SpecimenType;
  collectedBy?: string | null;
  notes?: string | null;
}

/** Labels the report/template builders cannot resolve from i18n themselves. */
export interface LabReportLabels {
  title: string;
  patient: string;
  mrn: string;
  age: string;
  sex: string;
  visit: string;
  orderedBy: string;
  specimen: string;
  barcode: string;
  collected: string;
  clinicalIndication: string;
  test: string;
  result: string;
  unit: string;
  reference: string;
  status: string;
  verifiedBy: string;
  verifiedAt: string;
  pendingVerification: string;
  noResults: string;
  printed: string;
  statusNormal: string;
  statusAbnormal: string;
  statusCritical: string;
  statusPending: string;
}

export interface LabReportData {
  businessName: string;
  logoUrl?: string | null;
  orderNumber: string;
  orderDate: string;
  patientName: string;
  mrn: string;
  age: string;
  sex: string;
  visitNumber: string;
  orderedBy: string;
  clinicalIndication: string;
  specimenBarcode: string;
  specimenType: string;
  collectedAt: string;
  verifiedBy: string;
  verifiedAt: string;
  isVerified: boolean;
  labels: LabReportLabels;
  items: Array<{
    testName: string;
    result: string;
    unit: string;
    reference: string;
    status: ResultStatus;
  }>;
}

// ── Phase 3: insurance claims and doctor revenue share ──────────────────────

/** Insurance / HMO payer configured for the clinic. */
export interface InsuranceProvider {
  id: string;
  business_id: string;
  name: string;
  payer_code?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  billing_address?: string | null;
  default_copay_percent: number;
  credit_period_days: number;
  /** Maximum accommodation rate the payer covers per bed-night (null = no cap). */
  bed_daily_cap?: number | null;
  /** Charge room-upgrade differentials above the cap to the patient. */
  room_upgrade_charge_to_patient?: boolean;
  receivable_account_id?: string | null;
  settlement_account_id?: string | null;
  write_off_account_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InsuranceProviderInput {
  name: string;
  payer_code?: string | null;
  contact_person?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  billing_address?: string | null;
  default_copay_percent: number;
  credit_period_days: number;
  bed_daily_cap?: number | null;
  room_upgrade_charge_to_patient?: boolean;
  receivable_account_id?: string | null;
  settlement_account_id?: string | null;
  write_off_account_id?: string | null;
  is_active: boolean;
}

export type ClaimStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'settled'
  | 'disputed';

export type ClaimServiceCategory =
  | 'consultation'
  | 'medication'
  | 'laboratory'
  | 'procedure'
  | 'accommodation'
  | 'other';

export interface InsuranceClaim {
  id: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  provider_id: string;
  invoice_id?: string | null;
  claim_number: string;
  policy_number?: string | null;
  member_id?: string | null;
  pre_auth_code?: string | null;
  total_bill_amount: number;
  patient_copay_amount: number;
  insurer_claim_amount: number;
  approved_amount?: number;
  settled_amount?: number;
  disallowance_amount?: number;
  status: ClaimStatus;
  submission_date?: string | null;
  settlement_date?: string | null;
  rejection_reason?: string | null;
  remittance_reference?: string | null;
  settlement_journal_entry_id?: string | null;
  created_at: string;
  updated_at: string;
  provider?: InsuranceProvider | null;
  patient?: {
    first_name: string;
    last_name: string;
    mrn: string;
  } | null;
  items?: InsuranceClaimItem[];
}

export interface InsuranceClaimItem {
  id: string;
  business_id: string;
  claim_id: string;
  service_category: ClaimServiceCategory;
  item_description: string;
  gross_amount: number;
  patient_share: number;
  insurer_share: number;
  status: 'approved' | 'rejected' | 'adjusted';
  created_at?: string;
}

export type DoctorContractType = 'percentage' | 'fixed' | 'hybrid';

export interface DoctorFeeContract {
  id: string;
  business_id: string;
  doctor_id: string;
  contract_type: DoctorContractType;
  consultation_share_percent: number;
  fixed_consultation_fee: number;
  lab_procedure_share_percent: number;
  pharmacy_share_percent: number;
  expense_account_id?: string | null;
  payable_account_id?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  doctor?: {
    full_name?: string | null;
    email?: string | null;
  } | null;
}

export type DoctorEarningStatus = 'pending' | 'approved' | 'posted' | 'paid';

export interface DoctorFeeEarning {
  id: string;
  business_id: string;
  doctor_id: string;
  visit_id: string;
  invoice_id?: string | null;
  consultation_amount: number;
  lab_amount: number;
  pharmacy_amount: number;
  earned_commission: number;
  status: DoctorEarningStatus;
  journal_entry_id?: string | null;
  payout_journal_entry_id?: string | null;
  posted_at?: string | null;
  paid_at?: string | null;
  created_at: string;
  doctor?: {
    raw_user_meta_data?: { full_name?: string | null };
    full_name?: string | null;
    email?: string | null;
  } | null;
  visit?: {
    id: string;
    visit_number: string;
    visit_date: string;
    patient?: {
      first_name: string;
      last_name: string;
      mrn: string;
    } | null;
  } | null;
}

export interface SplitBillItem {
  category: ClaimServiceCategory;
  description: string;
  grossAmount: number;
  patientShare: number;
  insurerShare: number;
}

export interface SplitBillBreakdown {
  totalGross: number;
  patientCopay: number;
  insurerClaim: number;
  items: SplitBillItem[];
}

/** Minimal doctor identity used by contract and payout selectors. */
export interface ClinicDoctor {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
}

/** Minimal chart-of-accounts row used by fee and remittance selectors. */
export interface AccountOption {
  id: string;
  code: string;
  name: string;
  account_type: string;
  account_subtype?: string | null;
  is_bank_account?: boolean;
}

/** Labels passed into the native doctor payout voucher template. */
export interface DoctorPayoutVoucherLabels {
  title: string;
  voucherNumber: string;
  doctor: string;
  period: string;
  generated: string;
  visit: string;
  patient: string;
  consultation: string;
  laboratory: string;
  pharmacy: string;
  earned: string;
  status: string;
  total: string;
  currency: string;
  preparedBy: string;
  signature: string;
  footer: string;
  statuses: Record<DoctorEarningStatus, string>;
}

export interface DoctorPayoutVoucherData {
  businessName: string;
  logoUrl?: string | null;
  voucherNumber: string;
  doctorName: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  currency: string;
  labels: DoctorPayoutVoucherLabels;
  lines: Array<{
    visitNumber: string;
    patientName: string;
    consultationAmount: number;
    labAmount: number;
    pharmacyAmount: number;
    earnedCommission: number;
    status: DoctorEarningStatus;
  }>;
  total: number;
}

// ── Phase 4: hospital wards, beds and inpatient ADT ────────────────────────

export type WardType =
  | 'general'
  | 'semi_private'
  | 'private'
  | 'vip'
  | 'icu'
  | 'high_dependency'
  | 'isolation'
  | 'maternity'
  | 'pediatric'
  | 'surgical'
  | 'emergency_observation';

export type BedStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved';
export type AdmissionStatus = 'admitted' | 'discharged' | 'transferred' | 'cancelled';
export type DischargeCondition =
  | 'recovered'
  | 'improved'
  | 'stable'
  | 'referred'
  | 'discharged_against_medical_advice'
  | 'deceased';
export type CareLogType =
  | 'doctor_round'
  | 'nurse_note'
  | 'dietary'
  | 'physiotherapy'
  | 'incident';
export type GenderRestriction = 'male_only' | 'female_only' | 'mixed' | 'pediatric';

export interface HospitalWard {
  id: string;
  business_id: string;
  name: string;
  ward_type: WardType;
  floor_number?: string | null;
  gender_restriction: GenderRestriction;
  total_capacity: number;
  is_active: boolean;
  beds?: HospitalBed[];
  created_at: string;
  updated_at: string;
}

export interface HospitalBed {
  id: string;
  business_id: string;
  ward_id: string;
  bed_number: string;
  daily_rate: number;
  hourly_rate: number;
  status: BedStatus;
  current_admission_id?: string | null;
  amenities?: string[] | null;
  ward?: HospitalWard | null;
  current_admission?: PatientAdmission | null;
  created_at: string;
  updated_at: string;
}

export interface PatientAdmissionPatient {
  id?: string;
  mrn: string;
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  blood_group?: string | null;
  allergies?: string[] | null;
  billing_type?: string | null;
  phone?: string | null;
}

export interface PatientAdmission {
  id: string;
  business_id: string;
  visit_id: string;
  patient_id: string;
  admission_number: string;
  admitting_doctor_id: string;
  attending_doctor_id: string;
  admission_reason: string;
  admitted_at: string;
  expected_discharge_date?: string | null;
  discharged_at?: string | null;
  discharge_summary?: string | null;
  discharge_condition?: DischargeCondition | null;
  status: AdmissionStatus;
  patient?: PatientAdmissionPatient | null;
  attending_doctor_name?: string | null;
  current_bed?: HospitalBed | null;
  allocations?: BedAllocation[];
  care_logs?: InpatientCareLog[];
  created_at: string;
  updated_at: string;
}

export interface BedAllocation {
  id: string;
  business_id: string;
  admission_id: string;
  bed_id: string;
  assigned_at: string;
  released_at?: string | null;
  daily_rate_applied: number;
  billing_mode: 'daily' | 'hourly';
  transfer_reason?: string | null;
  bed?: HospitalBed | null;
  created_at: string;
}

export interface InpatientCareLog {
  id: string;
  business_id: string;
  admission_id: string;
  recorded_by: string;
  log_type: CareLogType;
  note: string;
  recorded_at: string;
  recorder_name?: string | null;
}

/** One accommodation line for a single bed stay (a transfer creates two). */
export interface InpatientStayCharge {
  bedId?: string;
  bedNumber: string;
  wardName: string;
  wardType?: WardType | null;
  assignedAt: string;
  releasedAt: string;
  nights: number;
  dailyRate: number;
  totalCharge: number;
}

/** Payer accommodation policy used by the pure split helpers. */
export interface AccommodationCoveragePolicy {
  dailyCap?: number | null;
  copayPercent?: number;
  roomUpgradeChargeToPatient?: boolean;
}

export interface AccommodationCoverageLine extends InpatientStayCharge {
  coveredDailyRate: number;
  coveredAmount: number;
  upgradeDifferential: number;
  patientCopay: number;
  patientShare: number;
  insurerShare: number;
}

export interface AccommodationCoverageResult {
  lines: AccommodationCoverageLine[];
  totalCharge: number;
  patientShare: number;
  insurerShare: number;
  upgradeDifferential: number;
}

/** A ready-to-post bill line for the inpatient bed stay. */
export interface InpatientAccommodationBillItem {
  description: string;
  wardName: string;
  bedNumber: string;
  nights: number;
  dailyRate: number;
  total: number;
}
