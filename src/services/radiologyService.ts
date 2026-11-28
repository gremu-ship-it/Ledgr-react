import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { checkAndTriggerResultsReview } from '@/services/clinicalFlowService';
import type {
  RadiologyModality,
  RadiologyOrder,
  RadiologyOrderItem,
  RadiologyOrderItemInput,
  RadiologyOrderStatus,
  RadiologyUrgency,
} from '@/types/healthcare';

const db = supabase as unknown as SupabaseClient;

export const RADIOLOGY_MODALITIES: readonly RadiologyModality[] = [
  'xray',
  'ultrasound',
  'ct',
  'mri',
  'ecg',
  'echo',
  'mammography',
  'other',
];

export const RADIOLOGY_URGENCIES: readonly RadiologyUrgency[] = [
  'routine',
  'urgent',
  'stat',
];

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Radiology order number: RAD-YYYY-0001. */
export function formatRadiologyOrderNumber(year: number, sequence: number): string {
  const safe = Number.isFinite(sequence) ? Math.max(1, Math.trunc(sequence)) : 1;
  return `RAD-${Math.trunc(year)}-${String(safe).padStart(4, '0')}`;
}

export function parseRadiologyOrderNumber(orderNumber: string | null | undefined): {
  year: number;
  sequence: number;
} | null {
  if (!orderNumber) return null;
  const match = /^RAD-(\d{4})-(\d{4,})$/.exec(orderNumber.trim().toUpperCase());
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

export function calculateRadiologyOrderTotal(
  items: ReadonlyArray<{ unit_price?: number | string | null }> | null | undefined,
): number {
  const total = (items ?? []).reduce((sum, item) => {
    const value = Number(item.unit_price ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return Math.round(total * 100) / 100;
}

/** Same total, named for the central-bill aggregation call sites. */
export const calculateDiagnosticTotal = calculateRadiologyOrderTotal;

/** Reserve the next radiology order number for the calendar year. */
export async function generateRadiologyOrderNumber(
  businessId: string,
  now = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const prefix = `RAD-${year}-`;
  const { data, error } = await db
    .from('radiology_orders')
    .select('order_number')
    .eq('business_id', businessId)
    .ilike('order_number', `${prefix}%`)
    .order('order_number', { ascending: false })
    .limit(1);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{ order_number?: string }>;
  const highest = rows.reduce((max, row) => {
    const parsed = parseRadiologyOrderNumber(row.order_number);
    return parsed && parsed.sequence > max ? parsed.sequence : max;
  }, 0);

  return formatRadiologyOrderNumber(year, highest + 1);
}

export interface CreateRadiologyOrderInput {
  businessId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  items: RadiologyOrderItemInput[];
  clinicalIndication?: string | null;
  urgency?: RadiologyUrgency;
  now?: Date;
}

/**
 * Create a radiology requisition and its scan lines in one pass. The visit is
 * flagged with a pending imaging order and moved into the imaging stage.
 */
export async function createRadiologyOrder(
  input: CreateRadiologyOrderInput,
): Promise<RadiologyOrder> {
  if (!input.businessId) throw new Error('Business is required');
  if (!input.visitId) throw new Error('Visit is required');
  const items = (input.items ?? []).filter((item) => item.procedureName?.trim());
  if (items.length === 0) throw new Error('Add at least one scan');

  const now = input.now ?? new Date();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const orderNumber = await generateRadiologyOrderNumber(input.businessId, now);
    const { data: order, error: orderError } = await db
      .from('radiology_orders')
      .insert({
        business_id: input.businessId,
        visit_id: input.visitId,
        patient_id: input.patientId,
        doctor_id: input.doctorId,
        order_number: orderNumber,
        status: 'ordered',
        urgency: input.urgency ?? 'routine',
        clinical_indication: input.clinicalIndication ?? null,
        ordered_at: now.toISOString(),
      })
      .select('*')
      .single();

    if (orderError) {
      lastError = orderError;
      if ((orderError as { code?: string }).code !== '23505') throw orderError;
      continue;
    }

    const orderRow = order as unknown as RadiologyOrder;
    const { data: insertedItems, error: itemsError } = await db
      .from('radiology_order_items')
      .insert(
        items.map((item) => ({
          radiology_order_id: orderRow.id,
          business_id: input.businessId,
          modality: item.modality,
          procedure_name: item.procedureName.trim(),
          body_site: item.bodySite ?? null,
          unit_price: Number(item.unitPrice ?? 0) || 0,
          status: 'pending',
        })),
      )
      .select('*');

    if (itemsError) throw itemsError;

    await db
      .from('patient_visits')
      .update({
        has_pending_radiology: true,
        results_ready_for_review: false,
        stage: 'in_radiology',
      })
      .eq('business_id', input.businessId)
      .eq('id', input.visitId);

    return {
      ...orderRow,
      items: (insertedItems ?? []) as unknown as RadiologyOrderItem[],
    };
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Could not allocate a radiology order number');
}

/** Worklist for the imaging station, optionally narrowed to one status. */
export async function listRadiologyOrders(
  businessId: string,
  options: { status?: RadiologyOrderStatus | 'open'; limit?: number } = {},
): Promise<RadiologyOrder[]> {
  let query = db
    .from('radiology_orders')
    .select(
      '*, patient:patients(id, mrn, first_name, last_name, phone, date_of_birth, gender), visit:patient_visits(id, visit_number, queue_token, acuity_level, visit_type, stage), items:radiology_order_items(*)',
    )
    .eq('business_id', businessId);

  if (options.status && options.status !== 'open') {
    query = query.eq('status', options.status);
  } else if (options.status === 'open') {
    query = query.in('status', ['ordered', 'scheduled', 'in_progress']);
  }

  const { data, error } = await query
    .order('ordered_at', { ascending: true })
    .limit(options.limit ?? 200);

  if (error) throw error;
  return (data ?? []) as unknown as RadiologyOrder[];
}

export async function getRadiologyOrder(
  businessId: string,
  orderId: string,
): Promise<RadiologyOrder> {
  const { data, error } = await db
    .from('radiology_orders')
    .select(
      '*, patient:patients(*), visit:patient_visits(*), items:radiology_order_items(*)',
    )
    .eq('business_id', businessId)
    .eq('id', orderId)
    .single();

  if (error) throw error;
  return data as unknown as RadiologyOrder;
}

export interface RecordScanFindingsInput {
  businessId: string;
  itemId: string;
  orderId?: string;
  findings: string;
  impression: string;
  recommendations?: string | null;
  imageUrls?: string[];
  radiologistId?: string | null;
  technicianId?: string | null;
}

/**
 * Capture the radiologist's findings + impression and sign the scan off.
 * Returns the updated order and whether it was the last open scan.
 */
export async function recordScanFindings(
  input: RecordScanFindingsInput,
): Promise<{ item: RadiologyOrderItem; orderCompleted: boolean; orderId: string | null }> {
  if (!input.findings?.trim()) throw new Error('Findings are required');
  if (!input.impression?.trim()) throw new Error('Impression is required');

  const nowIso = new Date().toISOString();
  const { data: item, error } = await db
    .from('radiology_order_items')
    .update({
      findings: input.findings.trim(),
      impression: input.impression.trim(),
      recommendations: input.recommendations ?? null,
      image_urls: (input.imageUrls ?? []).filter(Boolean),
      radiologist_id: input.radiologistId ?? null,
      technician_id: input.technicianId ?? null,
      status: 'completed',
      performed_at: nowIso,
      reported_at: nowIso,
    })
    .eq('business_id', input.businessId)
    .eq('id', input.itemId)
    .select('*')
    .single();

  if (error) throw error;
  const typedItem = item as unknown as RadiologyOrderItem;
  const orderId = input.orderId ?? typedItem.radiology_order_id ?? null;
  if (!orderId) return { item: typedItem, orderCompleted: false, orderId: null };

  const { data: openItems, error: openError } = await db
    .from('radiology_order_items')
    .select('id, status')
    .eq('business_id', input.businessId)
    .eq('radiology_order_id', orderId)
    .neq('status', 'completed')
    .neq('status', 'cancelled');

  if (openError) throw openError;

  if ((openItems ?? []).length > 0) {
    return { item: typedItem, orderCompleted: false, orderId };
  }

  await completeRadiologyOrder(input.businessId, orderId);
  return { item: typedItem, orderCompleted: true, orderId };
}

/**
 * Complete the requisition, then run the loop-back check. When the lab track is
 * also finished the visit returns to the doctor at `results_review`.
 */
export async function completeRadiologyOrder(
  businessId: string,
  orderId: string,
  visitId?: string,
): Promise<RadiologyOrder> {
  const { data: order, error } = await db
    .from('radiology_orders')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('business_id', businessId)
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw error;
  const typedOrder = order as unknown as RadiologyOrder;
  const resolvedVisitId = visitId ?? typedOrder.visit_id;

  if (resolvedVisitId) {
    await db
      .from('patient_visits')
      .update({ stage: 'in_diagnostics' })
      .eq('business_id', businessId)
      .eq('id', resolvedVisitId)
      .eq('stage', 'in_radiology');
    await checkAndTriggerResultsReview(resolvedVisitId, businessId);
  }

  return typedOrder;
}

export async function updateRadiologyOrderStatus(
  businessId: string,
  orderId: string,
  status: RadiologyOrderStatus,
): Promise<RadiologyOrder> {
  const { data, error } = await db
    .from('radiology_orders')
    .update({ status })
    .eq('business_id', businessId)
    .eq('id', orderId)
    .select('*')
    .single();

  if (error) throw error;
  return data as unknown as RadiologyOrder;
}

export function isRadiologyModality(value: string): value is RadiologyModality {
  return (RADIOLOGY_MODALITIES as readonly string[]).includes(value);
}
