import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_LOCATION_TYPES,
  LOCATION_TYPES,
  MANUFACTURING_LOCATION_TYPES,
  locationTypesForModels,
} from '../useLocationTypes';

/**
 * Vertical isolation for the location-type picker is "absent, not locked":
 * a business must never be OFFERED a type from a vertical it does not
 * operate, while `warehouse` is universal. The resolver is pure so the
 * contract is tested without React; the hook itself just feeds it
 * `profile.operating_models`.
 */
describe('locationTypesForModels', () => {
  const values = (models: readonly string[]) =>
    locationTypesForModels(models).map((option) => option.value);

  it('offers only warehouse when no vertical model is selected', () => {
    expect(values([])).toEqual(['warehouse']);
    expect(values(['RETAIL', 'PRODUCT_SALES', 'SERVICE_SALES'])).toEqual(['warehouse']);
  });

  it('adds the manufacturing stores only for MANUFACTURING', () => {
    const offered = values(['MANUFACTURING']);
    expect(offered).toEqual(['warehouse', ...MANUFACTURING_LOCATION_TYPES]);
    for (const constructionType of CONSTRUCTION_LOCATION_TYPES) {
      expect(offered).not.toContain(constructionType);
    }
  });

  it('adds the construction site types only for CONSTRUCTION', () => {
    const offered = values(['CONSTRUCTION']);
    expect(offered).toEqual(['warehouse', ...CONSTRUCTION_LOCATION_TYPES]);
    for (const manufacturingType of MANUFACTURING_LOCATION_TYPES) {
      expect(offered).not.toContain(manufacturingType);
    }
  });

  it('offers the full vocabulary to a dual-vertical business', () => {
    expect(values(['CONSTRUCTION', 'MANUFACTURING'])).toEqual([...LOCATION_TYPES]);
  });

  it('mirrors the database CHECK vocabulary exactly (20261106000000)', () => {
    expect([...LOCATION_TYPES].sort()).toEqual(
      [
        'warehouse',
        'raw_materials_store',
        'production_floor',
        'finished_goods_store',
        'job_site',
        'site_office',
        'material_yard',
      ].sort(),
    );
  });

  it('points every option at the shared label vocabulary', () => {
    for (const option of locationTypesForModels(['CONSTRUCTION', 'MANUFACTURING'])) {
      expect(option.labelKey).toBe(`manufacturing.locationType.${option.value}`);
    }
  });
});
