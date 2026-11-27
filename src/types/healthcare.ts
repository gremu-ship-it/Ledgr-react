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
