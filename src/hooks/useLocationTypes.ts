import { useBusinessProfile } from './useBusinessProfile';

/**
 * The location_type values the CHECK constraint admits
 * (supabase/migrations/20261106000000_extend_location_types.sql).
 */
export const LOCATION_TYPES = [
  'warehouse',
  'raw_materials_store',
  'production_floor',
  'finished_goods_store',
  'job_site',
  'site_office',
  'material_yard',
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

/** The manufacturing store roles (20261103000000 §3 vocabulary). */
export const MANUFACTURING_LOCATION_TYPES: readonly LocationType[] = [
  'raw_materials_store',
  'production_floor',
  'finished_goods_store',
];

/** The construction store roles added by P2-2. */
export const CONSTRUCTION_LOCATION_TYPES: readonly LocationType[] = [
  'job_site',
  'site_office',
  'material_yard',
];

export interface LocationTypeOption {
  value: LocationType;
  /** i18n key under manufacturing.locationType (labels live in one vocabulary). */
  labelKey: string;
}

const labelKey = (value: LocationType): string => `manufacturing.locationType.${value}`;

/**
 * Pure resolver, exported for tests: which location types a business may
 * create.
 *
 * Vertical isolation is "absent, not locked": construction-only types appear
 * only when CONSTRUCTION is one of the business's operating models, and
 * manufacturing-only types only when MANUFACTURING is. `warehouse` is
 * universal. The database CHECK stays vertical-neutral so stores created while
 * a model was enabled remain valid after the model is removed — this function
 * only narrows what the UI offers for NEW choices (callers keep an existing
 * row's current type selectable; see LocationsTab).
 */
export function locationTypesForModels(
  operatingModels: readonly string[],
): LocationTypeOption[] {
  const types: LocationTypeOption[] = [{ value: 'warehouse', labelKey: labelKey('warehouse') }];

  if (operatingModels.includes('MANUFACTURING')) {
    for (const value of MANUFACTURING_LOCATION_TYPES) {
      types.push({ value, labelKey: labelKey(value) });
    }
  }

  if (operatingModels.includes('CONSTRUCTION')) {
    for (const value of CONSTRUCTION_LOCATION_TYPES) {
      types.push({ value, labelKey: labelKey(value) });
    }
  }

  return types;
}

/**
 * Location-type options for the active business, from its organisation
 * profile (`profile.operating_models` is `string[]`).
 */
export function useLocationTypes(): LocationTypeOption[] {
  const { profile } = useBusinessProfile();
  return locationTypesForModels(profile?.operating_models ?? []);
}
