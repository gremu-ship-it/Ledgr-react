import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { TelemedicineStatus } from '@/types/healthcare';
import type { ClinicalFlowVisit } from '@/services/clinicalFlowService';

const db = supabase as unknown as SupabaseClient;

/** Jitsi Meet is embedded directly; no video SDK or npm package is used. */
export const JITSI_MEET_ORIGIN = 'https://meet.jit.si';
export const JITSI_ROOM_PREFIX = 'Ledgr';

/**
 * Deterministic, URL-safe room segment. Hashing keeps raw tenant and visit
 * UUIDs out of a public room name while still producing the same room for the
 * same business + visit on every device.
 */
export function hashRoomSegment(value: string): string {
  let hash = 0x811c9dc5;
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    // FNV-1a 32-bit multiply.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/**
 * `https://meet.jit.si/Ledgr-<businessHash>-<visitHash>#config.prejoinPageEnabled=false`
 *
 * The pre-join page is disabled so a patient lands straight in the waiting
 * room after clicking their WhatsApp/SMS link.
 */
export function buildTelemedicineRoomUrl(businessId: string, visitId: string): string {
  const businessSegment = hashRoomSegment(String(businessId ?? ''));
  const visitSegment = hashRoomSegment(String(visitId ?? ''));
  return `${JITSI_MEET_ORIGIN}/${JITSI_ROOM_PREFIX}-${businessSegment}-${visitSegment}#config.prejoinPageEnabled=false`;
}

export function telemedicineRoomName(meetingUrl: string | null | undefined): string | null {
  if (!meetingUrl) return null;
  const match = /meet\.jit\.si\/([^#?]+)/.exec(meetingUrl);
  return match?.[1] ?? null;
}

function normalisePhone(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '');
}

export interface TelemedicineInviteInput {
  patientName: string;
  doctorName?: string | null;
  meetingUrl: string;
}

/** Plain-language invite shared by WhatsApp and SMS. */
export function buildTelemedicineInviteMessage(input: TelemedicineInviteInput): string {
  const patient = input.patientName.trim() || 'there';
  const doctor = input.doctorName?.trim()
    ? ` with ${input.doctorName.trim()}`
    : '';
  return `Hello ${patient}, your telemedicine consultation${doctor} is ready. Join the secure video room: ${input.meetingUrl}`;
}

export interface WhatsAppInviteInput extends TelemedicineInviteInput {
  phone: string | null | undefined;
}

/** Native WhatsApp click-to-chat URL; no messaging API or package involved. */
export function buildWhatsAppInviteUrl(input: WhatsAppInviteInput): string {
  const phone = normalisePhone(input.phone);
  const message = buildTelemedicineInviteMessage(input);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/** Native SMS composer URL for patients without WhatsApp. */
export function buildSmsInviteUrl(input: WhatsAppInviteInput): string {
  const phone = normalisePhone(input.phone);
  const message = buildTelemedicineInviteMessage(input);
  return `sms:${phone}?body=${encodeURIComponent(message)}`;
}

export function normalizeTelemedicineStatus(
  status: string | null | undefined,
): TelemedicineStatus {
  switch (status) {
    case 'link_sent':
    case 'in_call':
    case 'completed':
    case 'cancelled':
      return status;
    default:
      return 'waiting';
  }
}

// ── Data access ─────────────────────────────────────────────────────────────

export async function listTelemedicineQueue(
  businessId: string,
): Promise<ClinicalFlowVisit[]> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .eq('visit_type', 'telemedicine')
    .not('stage', 'in', '(completed,cancelled)')
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as unknown as ClinicalFlowVisit[];
}

export async function getTelemedicineVisit(
  businessId: string,
  visitId: string,
): Promise<ClinicalFlowVisit> {
  const { data, error } = await db
    .from('patient_visits')
    .select('*, patient:patients(*)')
    .eq('business_id', businessId)
    .eq('id', visitId)
    .single();

  if (error) throw error;
  return data as unknown as ClinicalFlowVisit;
}

/**
 * Creates (or returns) the Jitsi room for a visit. Reception normally creates
 * it at check-in; this covers visits booked before the room was provisioned.
 */
export async function ensureTelemedicineMeeting(
  businessId: string,
  visitId: string,
): Promise<ClinicalFlowVisit> {
  const visit = await getTelemedicineVisit(businessId, visitId);
  if (visit.meeting_url) return visit;

  const meetingUrl = buildTelemedicineRoomUrl(businessId, visitId);
  const { data, error } = await db
    .from('patient_visits')
    .update({
      meeting_url: meetingUrl,
      visit_type: 'telemedicine',
      telemedicine_status: normalizeTelemedicineStatus(visit.telemedicine_status),
    })
    .eq('business_id', businessId)
    .eq('id', visitId)
    .select('*, patient:patients(*)')
    .single();

  if (error) throw error;
  return data as unknown as ClinicalFlowVisit;
}

export async function updateTelemedicineStatus(
  businessId: string,
  visitId: string,
  status: TelemedicineStatus,
): Promise<ClinicalFlowVisit> {
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = { telemedicine_status: status };
  if (status === 'in_call') {
    payload.telemedicine_started_at = nowIso;
  }
  if (status === 'completed') {
    payload.telemedicine_ended_at = nowIso;
  }

  const { data, error } = await db
    .from('patient_visits')
    .update(payload)
    .eq('business_id', businessId)
    .eq('id', visitId)
    .select('*, patient:patients(*)')
    .single();

  if (error) throw error;
  return data as unknown as ClinicalFlowVisit;
}

/** Mark the invite as dispatched after WhatsApp/SMS opens or clipboard copies. */
export async function markTelemedicineLinkSent(
  businessId: string,
  visitId: string,
): Promise<ClinicalFlowVisit> {
  return updateTelemedicineStatus(businessId, visitId, 'link_sent');
}

/** Persist the doctor's split-screen charting notes for the virtual visit. */
export async function saveTelemedicineNotes(
  businessId: string,
  visitId: string,
  notes: string,
): Promise<ClinicalFlowVisit> {
  const { data, error } = await db
    .from('patient_visits')
    .update({ telemedicine_notes: notes })
    .eq('business_id', businessId)
    .eq('id', visitId)
    .select('*, patient:patients(*)')
    .single();

  if (error) throw error;
  return data as unknown as ClinicalFlowVisit;
}

export async function startTelemedicineCall(
  businessId: string,
  visitId: string,
): Promise<ClinicalFlowVisit> {
  return updateTelemedicineStatus(businessId, visitId, 'in_call');
}

export async function completeTelemedicineCall(
  businessId: string,
  visitId: string,
): Promise<ClinicalFlowVisit> {
  return updateTelemedicineStatus(businessId, visitId, 'completed');
}
