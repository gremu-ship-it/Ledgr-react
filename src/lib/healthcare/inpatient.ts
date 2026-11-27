import type {
  CareLogType,
  DischargeCondition,
  GenderRestriction,
  WardType,
} from '@/types/healthcare';

export const WARD_TYPES: readonly WardType[] = [
  'general',
  'semi_private',
  'private',
  'vip',
  'icu',
  'high_dependency',
  'isolation',
  'maternity',
  'pediatric',
  'surgical',
  'emergency_observation',
];

export const GENDER_RESTRICTIONS: readonly GenderRestriction[] = [
  'mixed',
  'male_only',
  'female_only',
  'pediatric',
];

export const CARE_LOG_TYPES: readonly CareLogType[] = [
  'doctor_round',
  'nurse_note',
  'dietary',
  'physiotherapy',
  'incident',
];

export const DISCHARGE_CONDITIONS: readonly DischargeCondition[] = [
  'recovered',
  'improved',
  'stable',
  'referred',
  'discharged_against_medical_advice',
  'deceased',
];

export const WARD_TYPE_LABEL_KEYS: Record<WardType, string> = {
  general: 'healthcare.wards.wardType.general',
  semi_private: 'healthcare.wards.wardType.semi_private',
  private: 'healthcare.wards.wardType.private',
  vip: 'healthcare.wards.wardType.vip',
  icu: 'healthcare.wards.wardType.icu',
  high_dependency: 'healthcare.wards.wardType.high_dependency',
  isolation: 'healthcare.wards.wardType.isolation',
  maternity: 'healthcare.wards.wardType.maternity',
  pediatric: 'healthcare.wards.wardType.pediatric',
  surgical: 'healthcare.wards.wardType.surgical',
  emergency_observation: 'healthcare.wards.wardType.emergency_observation',
};

export const GENDER_RESTRICTION_LABEL_KEYS: Record<GenderRestriction, string> = {
  mixed: 'healthcare.wards.gender.mixed',
  male_only: 'healthcare.wards.gender.male_only',
  female_only: 'healthcare.wards.gender.female_only',
  pediatric: 'healthcare.wards.gender.pediatric',
};

export const CARE_LOG_LABEL_KEYS: Record<CareLogType, string> = {
  doctor_round: 'healthcare.inpatient.careLogType.doctor_round',
  nurse_note: 'healthcare.inpatient.careLogType.nurse_note',
  dietary: 'healthcare.inpatient.careLogType.dietary',
  physiotherapy: 'healthcare.inpatient.careLogType.physiotherapy',
  incident: 'healthcare.inpatient.careLogType.incident',
};

export const DISCHARGE_CONDITION_LABEL_KEYS: Record<DischargeCondition, string> = {
  recovered: 'healthcare.inpatient.dischargeCondition.recovered',
  improved: 'healthcare.inpatient.dischargeCondition.improved',
  stable: 'healthcare.inpatient.dischargeCondition.stable',
  referred: 'healthcare.inpatient.dischargeCondition.referred',
  discharged_against_medical_advice:
    'healthcare.inpatient.dischargeCondition.discharged_against_medical_advice',
  deceased: 'healthcare.inpatient.dischargeCondition.deceased',
};

export function patientInitials(
  patient: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string {
  const first = patient?.first_name?.trim().charAt(0) ?? '';
  const last = patient?.last_name?.trim().charAt(0) ?? '';
  return `${first}${last}`.toUpperCase() || '?';
}
