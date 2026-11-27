import type { PatientRecord, PatientVisit } from '@/services/healthcareService';

/** Display name for a patient, tolerating the partial joins used in the queue. */
export function patientDisplayName(
  patient: Pick<PatientRecord, 'first_name' | 'last_name'> | null | undefined,
): string {
  if (!patient) return '';
  return `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim();
}

/** Whole years between date of birth and `now`; null when the DOB is unusable. */
export function calculateAge(
  dateOfBirth: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;

  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function formatDateValue(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed);
}

/** Compact vitals badge text used on queue cards. */
export function vitalSummary(visit: PatientVisit | null | undefined): string {
  if (!visit) return '';
  const parts: string[] = [];
  if (visit.systolic_bp && visit.diastolic_bp) {
    parts.push(`BP ${visit.systolic_bp}/${visit.diastolic_bp}`);
  }
  if (visit.heart_rate) parts.push(`HR ${visit.heart_rate}`);
  if (visit.temperature) parts.push(`T ${visit.temperature}°C`);
  if (visit.oxygen_saturation) parts.push(`SpO₂ ${visit.oxygen_saturation}%`);
  return parts.join(' · ');
}

/** True when any triage measurement exists. */
export function hasVitals(visit: PatientVisit | null | undefined): boolean {
  if (!visit) return false;
  return [
    visit.systolic_bp,
    visit.diastolic_bp,
    visit.heart_rate,
    visit.temperature,
    visit.respiratory_rate,
    visit.oxygen_saturation,
    visit.weight_kg,
    visit.height_cm,
    visit.blood_sugar_mg_dl,
  ].some((value) => value !== null && value !== undefined);
}

/** Queue card age label. */
export function ageLabel(patient: PatientRecord | null | undefined): string {
  const age = calculateAge(patient?.date_of_birth ?? null);
  return age === null ? '' : `${age}`;
}
