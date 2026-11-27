import { describe, expect, it } from 'vitest';
import {
  isHealthcareBusiness,
  isHealthcareEnabled,
  isHealthcareEnterprisePlan,
} from '../access';
import { visibleSectionsFor } from '@/components/layout/navConfig';

function healthcarePaths(
  operatingModels: string[],
  planTier: 'free' | 'starter' | 'growth' | 'pro' | 'enterprise',
) {
  return visibleSectionsFor(
    () => true,
    'owner',
    () => true,
    planTier,
    operatingModels,
  )
    .flatMap((section) => section.items)
    .filter((item) => item.path.startsWith('/healthcare'));
}

describe('healthcare vertical boundary', () => {
  it('recognises the HEALTHCARE operating model regardless of stored case', () => {
    expect(isHealthcareBusiness({ operating_models: ['HEALTHCARE'] })).toBe(true);
    expect(isHealthcareBusiness({ operating_models: ['healthcare'] })).toBe(true);
    expect(isHealthcareBusiness({ operating_models: ['RETAIL'] })).toBe(false);
    expect(isHealthcareBusiness({ operating_models: [] })).toBe(false);
    expect(isHealthcareBusiness(null)).toBe(false);
  });

  it('requires Enterprise for the plan gate', () => {
    expect(isHealthcareEnterprisePlan('enterprise')).toBe(true);
    expect(isHealthcareEnterprisePlan('Enterprise')).toBe(true);
    expect(isHealthcareEnterprisePlan('pro')).toBe(false);
    expect(isHealthcareEnterprisePlan(null)).toBe(false);
  });

  it('enables only when the model is present and the effective plan is Enterprise', () => {
    expect(
      isHealthcareEnabled({ operating_models: ['HEALTHCARE'], plan_tier: 'enterprise' }),
    ).toBe(true);
    expect(
      isHealthcareEnabled({ operating_models: ['HEALTHCARE'], plan_tier: 'growth' }),
    ).toBe(false);
    expect(
      isHealthcareEnabled({ operating_models: ['RETAIL'], plan_tier: 'enterprise' }),
    ).toBe(false);
    // Effective tier (which accounts for an expired plan) wins when supplied.
    expect(
      isHealthcareEnabled({ operating_models: ['HEALTHCARE'], plan_tier: 'enterprise' }, 'free'),
    ).toBe(false);
    // A legacy subscription_plan column can still entitle the business.
    expect(
      isHealthcareEnabled({
        operating_models: ['HEALTHCARE'],
        plan_tier: 'free',
        subscription_plan: 'enterprise',
      }),
    ).toBe(true);
  });

  it('removes every clinic navigation item from a non-healthcare business', () => {
    expect(healthcarePaths(['RETAIL'], 'enterprise')).toEqual([]);
    expect(healthcarePaths(['CONSTRUCTION', 'MANUFACTURING'], 'enterprise')).toEqual([]);
  });

  it('shows the clinic section only to a HEALTHCARE business', () => {
    const paths = healthcarePaths(['HEALTHCARE'], 'enterprise').map((item) => item.path);
    expect(paths).toEqual([
      '/healthcare',
      '/healthcare/patients',
      '/healthcare/consultation',
      '/healthcare/billing',
      '/healthcare/pharmacy',
      '/healthcare/wards',
      '/healthcare/admissions',
      '/healthcare/lab',
      '/healthcare/insurance',
      '/healthcare/doctor-fees',
    ]);
    expect(healthcarePaths(['HEALTHCARE'], 'enterprise').every((item) => item.locked === false)).toBe(true);
  });

  it('keeps the Enterprise upsell path for a healthcare business below Enterprise', () => {
    const items = healthcarePaths(['HEALTHCARE'], 'growth');
    expect(items).toHaveLength(10);
    expect(items.every((item) => item.locked === true)).toBe(true);
  });
});
