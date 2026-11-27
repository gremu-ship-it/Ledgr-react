/**
 * pharmacyService.ts
 *
 * Pharmacy dispensary data access for the Healthcare vertical.
 *
 * Stock is held in medication batches. FEFO (first-expiry-first-out) is the
 * ordering rule everywhere a batch is proposed or consumed:
 *   - reads sort `expiry_date ASC`,
 *   - batches expiring today or earlier are never dispensable,
 *   - batches inside the 60-day window are flagged for the UI.
 *
 * Dispensing itself is *not* a client-side read-modify-write. The
 * `dispense_prescription_item` RPC locks the batch row, re-checks expiry and
 * stock, decrements quantity_on_hand, writes the audit row, marks the item
 * dispensed and advances the visit to billing. This service only validates
 * inputs and translates the RPC result.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  DispensationRecord,
  DispenseItemPayload,
  DispenseResult,
  MedicationBatch,
  MedicationBatchInput,
  PharmacyQueueVisit,
  Prescription,
  PrescriptionItem,
  PrescriptionStatus,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

export type { DispenseResult } from '@/types/healthcare';

/** Warning window for stock that is about to expire. */
export const NEAR_EXPIRY_DAYS = 60;

export type BatchExpiryStatus = 'expired' | 'near_expiry' | 'valid';

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Local (not UTC) `YYYY-MM-DD` key so a late-evening dispense stays on today. */
export function toDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Add whole days to a `YYYY-MM-DD` key without DST drift. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + Math.trunc(days));
  return date.toISOString().slice(0, 10);
}

/**
 * Whole days between today and the batch expiry. Negative values are already
 * expired; the comparison runs on UTC midnights so DST never shifts a day.
 */
export function daysUntilExpiry(
  batch: Pick<MedicationBatch, 'expiry_date'>,
  today: Date = new Date(),
): number {
  const expiry = new Date(`${String(batch.expiry_date).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return Number.NEGATIVE_INFINITY;
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((expiry.getTime() - todayUtc) / 86_400_000);
}

/**
 * A batch expires *on* its expiry date, matching the SQL guard
 * `expiry_date <= CURRENT_DATE`.
 */
export function isBatchExpired(
  batch: Pick<MedicationBatch, 'expiry_date'>,
  today: Date = new Date(),
): boolean {
  return daysUntilExpiry(batch, today) <= 0;
}

export function isBatchNearExpiry(
  batch: Pick<MedicationBatch, 'expiry_date'>,
  withinDays: number = NEAR_EXPIRY_DAYS,
  today: Date = new Date(),
): boolean {
  const days = daysUntilExpiry(batch, today);
  return days > 0 && days <= withinDays;
}

export function getBatchExpiryStatus(
  batch: Pick<MedicationBatch, 'expiry_date'>,
  withinDays: number = NEAR_EXPIRY_DAYS,
  today: Date = new Date(),
): BatchExpiryStatus {
  if (isBatchExpired(batch, today)) return 'expired';
  if (isBatchNearExpiry(batch, withinDays, today)) return 'near_expiry';
  return 'valid';
}

/**
 * FEFO order: expiry first, then the delivery that has been on the shelf
 * longest. The copy keeps callers from sorting a React Query cache in place.
 */
export function sortBatchesFefo<T extends Pick<MedicationBatch, 'expiry_date'> & {
  received_date?: string | null;
  batch_number?: string | null;
}>(batches: readonly T[]): T[] {
  return [...batches].sort((a, b) => {
    const expiry = String(a.expiry_date).localeCompare(String(b.expiry_date));
    if (expiry !== 0) return expiry;
    const received = String(a.received_date ?? '').localeCompare(String(b.received_date ?? ''));
    if (received !== 0) return received;
    return String(a.batch_number ?? '').localeCompare(String(b.batch_number ?? ''));
  });
}

/** First dispensable batch for a drug, or null when FEFO has no stock left. */
export function pickFefoBatch<T extends Pick<MedicationBatch, 'expiry_date' | 'quantity_on_hand'>>(
  batches: readonly T[],
  today: Date = new Date(),
): T | null {
  const available = sortBatchesFefo(batches).filter(
    (batch) => toNumber(batch.quantity_on_hand) > 0 && !isBatchExpired(batch, today),
  );
  return available[0] ?? null;
}

/** Items still to be handed out on a prescription. */
export function pendingPrescriptionItems(
  prescription: Pick<Prescription, 'status' | 'items'>,
): PrescriptionItem[] {
  if (prescription.status === 'cancelled' || prescription.status === 'dispensed') return [];
  return (prescription.items ?? []).filter((item) => !item.is_dispensed);
}

/**
 * The dispensary only works on prescriptions that still owe the patient
 * medication. A cancelled or fully dispensed script is history.
 */
export function isPrescriptionAwaitingDispense(
  prescription: Pick<Prescription, 'status' | 'items'>,
): boolean {
  return (
    prescription.status !== 'cancelled' && pendingPrescriptionItems(prescription).length > 0
  );
}

export function countPendingItems(visit: Pick<PharmacyQueueVisit, 'prescriptions'>): number {
  return (visit.prescriptions ?? []).reduce(
    (total, prescription) => total + pendingPrescriptionItems(prescription).length,
    0,
  );
}

/** Only visits with an open prescription belong on the dispensary queue. */
export function isVisitAwaitingDispense(visit: Pick<PharmacyQueueVisit, 'prescriptions'>): boolean {
  return (visit.prescriptions ?? []).some(isPrescriptionAwaitingDispense);
}

/**
 * The `partially_dispensed` state is written by the RPC; older rows may still
 * say `pending` until the next dispense, so both mean "open".
 */
export function isPrescriptionOpen(status: PrescriptionStatus): boolean {
  return status === 'pending' || status === 'partially_dispensed';
}

export function remainingAfterDispense(
  batch: Pick<MedicationBatch, 'quantity_on_hand'>,
  quantity: number,
): number {
  return Math.max(0, Math.round((toNumber(batch.quantity_on_hand) - toNumber(quantity)) * 100) / 100);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Batches with stock still on hand, expiry ascending. Passing a medication
 * name narrows the list to the drug the pharmacist is about to hand out.
 */
export async function getMedicationBatches(
  businessId: string,
  medicationName?: string,
  options: { includeDepleted?: boolean } = {},
): Promise<MedicationBatch[]> {
  if (!businessId) return [];

  let query = db
    .from('medication_batches')
    .select('*')
    .eq('business_id', businessId);

  if (!options.includeDepleted) query = query.gt('quantity_on_hand', 0);
  if (medicationName?.trim()) query = query.ilike('medication_name', medicationName.trim());

  const { data, error } = await query
    .order('expiry_date', { ascending: true })
    .order('received_date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as MedicationBatch[];
}

/** Stock rows for the whole dispensary, grouped later by medication name. */
export async function listMedicationBatches(
  businessId: string,
  options: { includeDepleted?: boolean } = {},
): Promise<MedicationBatch[]> {
  return getMedicationBatches(businessId, undefined, options);
}

export async function createMedicationBatch(
  input: MedicationBatchInput,
): Promise<MedicationBatch> {
  if (!input.businessId) throw new Error('A business is required.');
  if (!input.medicationName?.trim()) throw new Error('A medication name is required.');
  if (!input.batchNumber?.trim()) throw new Error('A batch number is required.');
  if (!input.expiryDate) throw new Error('An expiry date is required.');

  const quantity = Math.round(toNumber(input.quantityReceived) * 100) / 100;
  if (quantity <= 0) throw new Error('Received quantity must be greater than zero.');
  if (isBatchExpired({ expiry_date: input.expiryDate })) {
    throw new Error('This batch has already expired and cannot be received.');
  }

  const unitCost = Math.round(toNumber(input.unitCost) * 1000) / 1000;
  if (unitCost < 0) throw new Error('Unit cost cannot be negative.');

  const { data, error } = await db
    .from('medication_batches')
    .insert({
      business_id: input.businessId,
      product_id: input.productId ?? null,
      medication_name: input.medicationName.trim(),
      batch_number: input.batchNumber.trim(),
      quantity_received: quantity,
      quantity_on_hand: quantity,
      unit_cost: unitCost,
      expiry_date: input.expiryDate,
      received_date: input.receivedDate ?? toDateKey(),
      supplier_name: input.supplierName?.trim() || null,
      storage_location: input.storageLocation?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as unknown as MedicationBatch;
}

/**
 * Visits with at least one item still to dispense. A script may contain several
 * drugs, so filtering happens after the nested read rather than with a
 * fragile PostgREST inner-join filter.
 */
export async function getPharmacyDispensaryQueue(
  businessId: string,
): Promise<PharmacyQueueVisit[]> {
  if (!businessId) return [];

  const { data, error } = await db
    .from('patient_visits')
    .select(
      `id, business_id, visit_number, visit_date, stage, created_at,
       patient:patients(id, mrn, first_name, last_name, date_of_birth, gender, phone, allergies),
       prescriptions(id, business_id, visit_id, patient_id, doctor_id, status, notes,
                     dispensed_at, created_at,
                     items:prescription_items(*))`,
    )
    .eq('business_id', businessId)
    .in('stage', ['with_doctor', 'in_lab', 'at_pharmacy', 'in_billing'])
    .order('created_at', { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as PharmacyQueueVisit[])
    .map((visit) => ({
      ...visit,
      prescriptions: (visit.prescriptions ?? [])
        .filter(isPrescriptionAwaitingDispense)
        .map((prescription) => ({
          ...prescription,
          items: pendingPrescriptionItems(prescription),
        })),
    }))
    .filter(isVisitAwaitingDispense);
}

/** Most recent hand-outs, newest first, with the batch and drug they came from. */
export async function getDispensationLogs(
  businessId: string,
  limit = 100,
): Promise<DispensationRecord[]> {
  if (!businessId) return [];

  const { data, error } = await db
    .from('dispensation_records')
    .select(
      `*,
       batch:medication_batches(id, medication_name, batch_number, expiry_date),
       item:prescription_items(id, medication_name, dosage, quantity)`,
    )
    .eq('business_id', businessId)
    .order('dispensed_at', { ascending: false })
    .limit(Math.max(1, Math.min(500, Math.trunc(limit))));

  if (error) throw error;
  return (data ?? []) as unknown as DispensationRecord[];
}

// ── Dispensing ──────────────────────────────────────────────────────────────

/**
 * Hand one prescription line to the patient. All validation that protects
 * stock lives in the RPC; this wrapper only rejects obviously bad input so the
 * UI gets a clean message before a round-trip.
 */
export async function dispensePrescriptionItem(
  input: DispenseItemPayload,
): Promise<DispenseResult> {
  if (!input.businessId) throw new Error('A business is required.');
  if (!input.prescriptionItemId) throw new Error('A prescription item is required.');
  if (!input.batchId) throw new Error('A medication batch is required.');

  const quantity = Math.round(toNumber(input.quantity) * 100) / 100;
  if (quantity <= 0) throw new Error('Dispensing quantity must be greater than zero.');

  const { data, error } = await db.rpc('dispense_prescription_item', {
    p_business_id: input.businessId,
    p_prescription_item_id: input.prescriptionItemId,
    p_batch_id: input.batchId,
    p_quantity: quantity,
    p_notes: input.notes?.trim() || null,
  });

  if (error) throw error;
  if (!data) throw new Error('Dispensing did not return a confirmation.');

  const result = data as Record<string, unknown>;
  const fullyDispensed = result.itemFullyDispensed ?? result.item_fully_dispensed;
  const itemRemaining = result.quantityRemainingOnItem ?? result.quantity_remaining_on_item;
  return {
    dispensationId: String(result.dispensationId ?? result.dispensation_id ?? ''),
    prescriptionItemId: String(
      result.prescriptionItemId ?? result.prescription_item_id ?? input.prescriptionItemId,
    ),
    batchId: String(result.batchId ?? result.batch_id ?? input.batchId),
    quantityDispensed: toNumber(result.quantityDispensed ?? result.quantity_dispensed, quantity),
    batchQuantityRemaining: toNumber(
      result.batchQuantityRemaining ?? result.batch_quantity_remaining,
    ),
    prescriptionStatus: String(
      result.prescriptionStatus ?? result.prescription_status ?? 'pending',
    ) as PrescriptionStatus,
    ...(fullyDispensed === undefined ? {} : { itemFullyDispensed: Boolean(fullyDispensed) }),
    ...(itemRemaining === undefined
      ? {}
      : { quantityRemainingOnItem: toNumber(itemRemaining) }),
    visitStage: String(result.visitStage ?? result.visit_stage ?? 'at_pharmacy'),
  };
}
