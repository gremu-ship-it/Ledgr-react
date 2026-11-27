/**
 * labService.ts
 *
 * Laboratory diagnostics data access for the Healthcare vertical.
 *
 * The important rule is result classification: a numeric value is compared
 * against the reference bounds in this exact order so a panic value is never
 * reported as merely "abnormal":
 *
 *   1. empty value            -> pending
 *   2. non-numeric qualitative -> POSITIVE/REACTIVE/ABNORMAL -> abnormal,
 *                                 CRITICAL/PANIC -> critical, NEGATIVE -> normal
 *   3. value <= critical_low  -> critical
 *   4. value >= critical_high -> critical
 *   5. value <  min_normal    -> abnormal
 *   6. value >  max_normal    -> abnormal
 *   7. otherwise              -> normal
 *
 * Specimen barcodes follow the clinic MRN/visit style: SMP-YYYY-NNNN, one
 * sequence per business and year.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type {
  CollectSpecimenInput,
  LabOrder,
  LabOrderItem,
  LabReferenceRange,
  LabResultPayload,
  LabSpecimen,
  ResultStatus,
  SpecimenType,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

export type ReferenceRange = LabReferenceRange;

export const SPECIMEN_TYPES: readonly SpecimenType[] = [
  'blood',
  'urine',
  'stool',
  'sputum',
  'swab',
  'tissue',
  'other',
];

/** Result states that still need a number before an order can be verified. */
export function isResultPending(status: ResultStatus | null | undefined): boolean {
  return !status || status === 'pending';
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  // `3,5` is a decimal comma; `1,234.5` is a thousands separator.
  const normalized = /^[+-]?\d+,\d{1,2}$/.test(raw)
    ? raw.replace(',', '.')
    : raw.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Classify a laboratory result. `referenceRange` may be omitted for
 * qualitative tests, in which case the text itself drives the status.
 */
export function evaluateResultStatus(
  value: string | number | null | undefined,
  referenceRange: ReferenceRange = {},
): ResultStatus {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (raw === '') return 'pending';

  const numeric = toNumberOrNull(raw);
  if (numeric === null) {
    const text = raw.toUpperCase().replace(/\s+/g, ' ');

    if (/\b(CRITICAL|PANIC)\b/.test(text)) return 'critical';
    if (/\b(NON[- ]?REACTIVE|NOT DETECTED|NEGATIVE|NORMAL)\b/.test(text)) return 'normal';
    if (/\b(POSITIVE|REACTIVE|ABNORMAL|DETECTED)\b/.test(text)) return 'abnormal';
    return 'normal';
  }

  const criticalLow = finiteNumber(referenceRange.criticalLow ?? referenceRange.criticalMin);
  const criticalHigh = finiteNumber(referenceRange.criticalHigh ?? referenceRange.criticalMax);
  const minNormal = finiteNumber(referenceRange.minNormal ?? referenceRange.min);
  const maxNormal = finiteNumber(referenceRange.maxNormal ?? referenceRange.max);

  if (criticalLow !== null && numeric <= criticalLow) return 'critical';
  if (criticalHigh !== null && numeric >= criticalHigh) return 'critical';
  if (minNormal !== null && numeric < minNormal) return 'abnormal';
  if (maxNormal !== null && numeric > maxNormal) return 'abnormal';
  return 'normal';
}

/** Bound-aware status for a row already loaded from the database. */
export function evaluateLabItemStatus(item: Pick<
  LabOrderItem,
  'result_value' | 'min_normal' | 'max_normal' | 'critical_low' | 'critical_high'
>): ResultStatus {
  return evaluateResultStatus(item.result_value ?? '', {
    minNormal: item.min_normal ?? null,
    maxNormal: item.max_normal ?? null,
    criticalLow: item.critical_low ?? null,
    criticalHigh: item.critical_high ?? null,
  });
}

/** Short human-readable range, e.g. `3.9 - 7.8 mmol/L`. */
export function buildReferenceRangeLabel(range: ReferenceRange): string {
  const min = finiteNumber(range.minNormal ?? range.min);
  const max = finiteNumber(range.maxNormal ?? range.max);
  const unit = range.unit?.trim() ?? '';

  let label = '';
  if (min !== null && max !== null) label = `${min} - ${max}`;
  else if (min !== null) label = `>= ${min}`;
  else if (max !== null) label = `<= ${max}`;

  if (!label) return unit;
  return unit ? `${label} ${unit}` : label;
}

// ── Specimen barcode ────────────────────────────────────────────────────────

export function formatSpecimenBarcode(year: number, sequence: number): string {
  const safeSequence = Number.isFinite(sequence) ? Math.max(1, Math.trunc(sequence)) : 1;
  return `SMP-${year}-${String(safeSequence).padStart(4, '0')}`;
}

/** Highest sequence already issued for the year, so the next one is +1. */
export function nextSpecimenSequence(
  existingBarcodes: readonly string[],
  year: number,
): number {
  const prefix = `SMP-${year}-`;
  let highest = 0;
  for (const barcode of existingBarcodes) {
    if (!barcode?.startsWith(prefix)) continue;
    const tail = Number(barcode.slice(prefix.length));
    if (Number.isInteger(tail) && tail > highest) highest = tail;
  }
  return highest + 1;
}

/**
 * Reserve the next barcode for the business. The unique
 * (business_id, specimen_barcode) constraint is the real guard; callers retry
 * on a 23505 race (see collectSpecimen).
 */
export async function generateSpecimenBarcode(
  businessId: string,
  now: Date = new Date(),
): Promise<string> {
  if (!businessId) throw new Error('A business is required.');
  const year = now.getFullYear();

  const { data, error } = await db
    .from('lab_specimens')
    .select('specimen_barcode')
    .eq('business_id', businessId)
    .like('specimen_barcode', `SMP-${year}-%`)
    .order('specimen_barcode', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const existing = (data as { specimen_barcode?: string } | null)?.specimen_barcode;
  return formatSpecimenBarcode(year, nextSpecimenSequence(existing ? [existing] : [], year));
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '23505';
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * PostgREST does not order an embedded collection unless asked, and a
 * recollected sample would otherwise hide the newest specimen behind the
 * rejected one. Normalise the array once at the boundary.
 */
function withNewestSpecimen(order: LabOrder): LabOrder {
  const specimens = [...(order.specimens ?? [])].sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  );
  return { ...order, specimens };
}

/** Every non-cancelled lab order with its patient, visit, items and specimens. */
export async function getLabOrders(businessId: string): Promise<LabOrder[]> {
  if (!businessId) return [];

  const { data, error } = await db
    .from('lab_orders')
    .select(
      `*,
       patient:patients(id, mrn, first_name, last_name, date_of_birth, gender, phone, allergies),
       visit:patient_visits(id, visit_number, visit_date, stage),
       items:lab_order_items(*, specimen:lab_specimens(*)),
       specimens:lab_specimens(*)`,
    )
    .eq('business_id', businessId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as LabOrder[]).map(withNewestSpecimen);
}

export async function getLabOrder(
  businessId: string,
  labOrderId: string,
): Promise<LabOrder | null> {
  if (!businessId || !labOrderId) return null;

  const { data, error } = await db
    .from('lab_orders')
    .select(
      `*,
       patient:patients(id, mrn, first_name, last_name, date_of_birth, gender, phone, allergies),
       visit:patient_visits(id, visit_number, visit_date, stage),
       items:lab_order_items(*, specimen:lab_specimens(*)),
       specimens:lab_specimens(*)`,
    )
    .eq('business_id', businessId)
    .eq('id', labOrderId)
    .maybeSingle();

  if (error) throw error;
  const order = (data as unknown as LabOrder | null) ?? null;
  return order ? withNewestSpecimen(order) : null;
}

export interface LabWorklist {
  awaitingCollection: LabOrder[];
  collected: LabOrder[];
  inAnalysis: LabOrder[];
  pendingVerification: LabOrder[];
  verified: LabOrder[];
}

/** Bucket the worklist for the lab station tabs from a single read. */
export function splitLabWorklist(orders: readonly LabOrder[]): LabWorklist {
  const worklist: LabWorklist = {
    awaitingCollection: [],
    collected: [],
    inAnalysis: [],
    pendingVerification: [],
    verified: [],
  };

  for (const order of orders) {
    if (order.status === 'completed') {
      worklist.verified.push(order);
      continue;
    }
    const specimen = order.specimens?.[0];
    if (!specimen || specimen.status === 'pending') {
      worklist.awaitingCollection.push(order);
      continue;
    }
    if (specimen.status === 'in_analysis') {
      worklist.inAnalysis.push(order);
      continue;
    }
    if (specimen.status === 'collected') {
      const hasResults = (order.items ?? []).some((item) => !isResultPending(item.result_status));
      if (hasResults) worklist.pendingVerification.push(order);
      else worklist.collected.push(order);
      continue;
    }
    // Rejected specimens return to the collection queue for recollection.
    worklist.awaitingCollection.push(order);
  }

  return worklist;
}

// ── Specimens ───────────────────────────────────────────────────────────────

/**
 * Register a specimen against an order and link every item on that order to
 * it. Barcode collisions are retried twice before the database error surfaces.
 */
export async function collectSpecimen(input: CollectSpecimenInput): Promise<LabSpecimen> {
  if (!input.businessId) throw new Error('A business is required.');
  if (!input.labOrderId) throw new Error('A laboratory order is required.');
  if (!SPECIMEN_TYPES.includes(input.specimenType)) {
    throw new Error('A valid specimen type is required.');
  }

  const { data: order, error: orderError } = await db
    .from('lab_orders')
    .select('id')
    .eq('id', input.labOrderId)
    .eq('business_id', input.businessId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw new Error('Laboratory order not found.');

  const collectedBy = input.collectedBy ?? (await getCurrentUserId());
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const barcode = await generateSpecimenBarcode(input.businessId);
    const { data, error } = await db
      .from('lab_specimens')
      .insert({
        business_id: input.businessId,
        lab_order_id: input.labOrderId,
        specimen_barcode: barcode,
        specimen_type: input.specimenType,
        status: 'collected',
        collected_at: new Date().toISOString(),
        collected_by: collectedBy,
        notes: input.notes?.trim() || null,
      })
      .select('*')
      .single();

    if (!error) {
      const specimen = data as unknown as LabSpecimen;

      await db
        .from('lab_order_items')
        .update({ specimen_id: specimen.id })
        .eq('lab_order_id', input.labOrderId)
        .eq('business_id', input.businessId);

      await db
        .from('lab_orders')
        .update({ status: 'sample_collected' })
        .eq('id', input.labOrderId)
        .eq('business_id', input.businessId)
        .eq('status', 'ordered');

      return specimen;
    }

    lastError = error;
    if (!isUniqueViolation(error)) throw error;
  }

  throw lastError ?? new Error('Could not allocate a specimen barcode.');
}

export async function markSpecimenInAnalysis(
  businessId: string,
  specimenId: string,
): Promise<void> {
  const { error } = await db
    .from('lab_specimens')
    .update({ status: 'in_analysis' })
    .eq('id', specimenId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function rejectSpecimen(
  businessId: string,
  specimenId: string,
  reason: string,
): Promise<void> {
  if (!reason?.trim()) throw new Error('A rejection reason is required.');

  const { error } = await db
    .from('lab_specimens')
    .update({ status: 'rejected', rejection_reason: reason.trim() })
    .eq('id', specimenId)
    .eq('business_id', businessId);
  if (error) throw error;
}

// ── Results ─────────────────────────────────────────────────────────────────

/**
 * Store a result and its classification. Omitting a range falls back to
 * whatever bounds were already captured on the item.
 */
export async function recordLabResult(
  input: LabResultPayload,
  existing?: Partial<LabOrderItem>,
): Promise<LabOrderItem> {
  if (!input.businessId) throw new Error('A business is required.');
  if (!input.itemId) throw new Error('A laboratory item is required.');

  let range: LabReferenceRange = input.referenceRange ?? {
    minNormal: existing?.min_normal ?? null,
    maxNormal: existing?.max_normal ?? null,
    criticalLow: existing?.critical_low ?? null,
    criticalHigh: existing?.critical_high ?? null,
    unit: existing?.unit_of_measure ?? null,
  };

  // Callers that only pass the value still get the stored reference bounds.
  if (!input.referenceRange && !existing) {
    const { data: stored, error: storedError } = await db
      .from('lab_order_items')
      .select('min_normal, max_normal, critical_low, critical_high, unit_of_measure')
      .eq('id', input.itemId)
      .eq('business_id', input.businessId)
      .maybeSingle();
    if (storedError) throw storedError;
    if (stored) {
      const row = stored as Record<string, unknown>;
      range = {
        minNormal: toNumberOrNull(row.min_normal as number | null),
        maxNormal: toNumberOrNull(row.max_normal as number | null),
        criticalLow: toNumberOrNull(row.critical_low as number | null),
        criticalHigh: toNumberOrNull(row.critical_high as number | null),
        unit: (row.unit_of_measure as string | null) ?? null,
      };
    }
  }

  const value = input.resultValue === null || input.resultValue === undefined
    ? ''
    : String(input.resultValue);
  const status = evaluateResultStatus(value, range);
  const technicianId = input.technicianId ?? (await getCurrentUserId());
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('lab_order_items')
    .update({
      result_value: value.trim() || null,
      reference_range: buildReferenceRangeLabel(range) || null,
      result_status: status,
      unit_of_measure: range.unit?.trim() || null,
      min_normal: range.minNormal ?? null,
      max_normal: range.maxNormal ?? null,
      critical_low: range.criticalLow ?? null,
      critical_high: range.criticalHigh ?? null,
      technician_notes: input.technicianNotes?.trim() || null,
      technician_id: technicianId,
      completed_at: status === 'pending' ? null : now,
      updated_at: now,
    })
    .eq('id', input.itemId)
    .eq('business_id', input.businessId)
    .select('*')
    .single();

  if (error) throw error;
  const saved = data as unknown as LabOrderItem;

  // A collected specimen with at least one result is on the bench.
  if (saved.specimen_id && status !== 'pending') {
    await db
      .from('lab_specimens')
      .update({ status: 'in_analysis' })
      .eq('id', saved.specimen_id)
      .eq('business_id', input.businessId)
      .eq('status', 'collected');
  }

  return saved;
}

/**
 * Sign off an order. Every result must be present; the update stamps each item
 * and the header, then returns the visit to the doctor for the plan.
 */
export async function verifyLabOrder(
  businessId: string,
  labOrderId: string,
  technicianId?: string | null,
): Promise<LabOrder> {
  if (!businessId || !labOrderId) throw new Error('A laboratory order is required.');

  const { data: items, error: itemsError } = await db
    .from('lab_order_items')
    .select('id, result_status')
    .eq('lab_order_id', labOrderId)
    .eq('business_id', businessId);

  if (itemsError) throw itemsError;
  const rows = (items ?? []) as Array<{ id: string; result_status: ResultStatus }>;
  if (rows.length === 0) throw new Error('This order has no laboratory tests.');

  const pending = rows.filter((row) => isResultPending(row.result_status));
  if (pending.length > 0) {
    throw new Error(
      `${pending.length} result${pending.length === 1 ? '' : 's'} still pending; enter every result before verifying.`,
    );
  }

  const verifier = technicianId ?? (await getCurrentUserId());
  const now = new Date().toISOString();

  const { error: stampError } = await db
    .from('lab_order_items')
    .update({ verified_at: now, technician_id: verifier, updated_at: now })
    .eq('lab_order_id', labOrderId)
    .eq('business_id', businessId);

  if (stampError) throw stampError;

  const { data: order, error: orderError } = await db
    .from('lab_orders')
    .update({ status: 'completed', verified_at: now, verified_by: verifier, updated_at: now })
    .eq('id', labOrderId)
    .eq('business_id', businessId)
    .select('id, visit_id')
    .single();

  if (orderError) throw orderError;

  const visitId = (order as { visit_id?: string }).visit_id;
  if (visitId) {
    await db
      .from('patient_visits')
      .update({ stage: 'with_doctor' })
      .eq('id', visitId)
      .eq('business_id', businessId)
      .eq('stage', 'in_lab');
  }

  const refreshed = await getLabOrder(businessId, labOrderId);
  if (!refreshed) throw new Error('Laboratory order not found after verification.');
  return refreshed;
}

// ── Reference defaults ──────────────────────────────────────────────────────

interface DefaultRange extends LabReferenceRange {
  keywords: readonly string[];
}

/**
 * Common test defaults used by the result-entry form. Numbers are adult
 * reference intervals in SI units; the technician can always override them.
 */
const DEFAULT_RANGES: readonly DefaultRange[] = [
  {
    keywords: ['fasting blood glucose', 'fasting glucose', 'fbg'],
    unit: 'mmol/L',
    minNormal: 3.9,
    maxNormal: 5.6,
    criticalLow: 2.5,
    criticalHigh: 25,
  },
  {
    keywords: ['random blood sugar', 'random blood glucose', 'rbs', 'blood sugar'],
    unit: 'mmol/L',
    minNormal: 3.9,
    maxNormal: 7.8,
    criticalLow: 2.5,
    criticalHigh: 25,
  },
  {
    keywords: ['haemoglobin', 'hemoglobin', 'hb'],
    unit: 'g/dL',
    minNormal: 12,
    maxNormal: 17,
    criticalLow: 7,
    criticalHigh: 20,
  },
  {
    keywords: ['white blood cell', 'wbc', 'leucocyte', 'leukocyte'],
    unit: 'x10^9/L',
    minNormal: 4,
    maxNormal: 11,
    criticalLow: 2,
    criticalHigh: 30,
  },
  {
    keywords: ['platelet'],
    unit: 'x10^9/L',
    minNormal: 150,
    maxNormal: 450,
    criticalLow: 20,
    criticalHigh: 1000,
  },
  {
    keywords: ['creatinine'],
    unit: 'umol/L',
    minNormal: 60,
    maxNormal: 110,
    criticalLow: 20,
    criticalHigh: 500,
  },
  {
    keywords: ['potassium', 'k+'],
    unit: 'mmol/L',
    minNormal: 3.5,
    maxNormal: 5.1,
    criticalLow: 2.5,
    criticalHigh: 6.5,
  },
  {
    keywords: ['sodium', 'na+'],
    unit: 'mmol/L',
    minNormal: 135,
    maxNormal: 145,
    criticalLow: 120,
    criticalHigh: 160,
  },
  {
    keywords: ['cd4'],
    unit: 'cells/uL',
    minNormal: 500,
    maxNormal: null,
    criticalLow: 200,
    criticalHigh: null,
  },
];

/** Best-effort defaults for a test name; empty when the test is qualitative. */
export function findLabReferenceDefaults(testName: string): LabReferenceRange {
  const name = testName.toLowerCase();
  const match = DEFAULT_RANGES.find((range) =>
    range.keywords.some((keyword) => name.includes(keyword)),
  );
  if (!match) return {};
  return {
    unit: match.unit ?? null,
    minNormal: match.minNormal ?? null,
    maxNormal: match.maxNormal ?? null,
    criticalLow: match.criticalLow ?? null,
    criticalHigh: match.criticalHigh ?? null,
  };
}
