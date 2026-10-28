import { describe, expect, it } from 'vitest';
import { validateConstructionProject } from './constructionProjectValidation';
import { canTransitionConstructionProjectStatus } from '@/dal/types/construction';

describe('persisted construction project validation', () => {
  it('accepts required commercial details with optional dates', () => {
    expect(validateConstructionProject({
      name: 'School block',
      client_name: 'District Council',
      contract_sum: '0',
      retention_pct: '5',
      budget: '125000.50',
      start_date: '',
      end_date: '',
    })).toEqual({
      values: {
        name: 'School block',
        client_name: 'District Council',
        contract_sum: 0,
        retention_pct: 5,
        budget: 125000.5,
        start_date: null,
        end_date: null,
      },
      errors: {},
    });
  });

  it('rejects invalid amounts, retention values and reversed dates', () => {
    const result = validateConstructionProject({
      name: '   ',
      client_name: '',
      contract_sum: '-1',
      retention_pct: '101',
      budget: 'NaN',
      start_date: '2027-04-10',
      end_date: '2027-04-09',
    });
    expect(result.values).toBeNull();
    expect(result.errors).toMatchObject({
      name: 'construction.validation.nameRequired',
      contract_sum: 'construction.validation.amountNonNegative',
      retention_pct: 'construction.validation.retentionRange',
      budget: 'construction.validation.amountNonNegative',
      end_date: 'construction.validation.dateOrder',
    });
  });
});

describe('construction project status lifecycle', () => {
  it('allows draft activation and hold, and keeps completed and closed terminal', () => {
    expect(canTransitionConstructionProjectStatus('draft', 'active')).toBe(true);
    expect(canTransitionConstructionProjectStatus('active', 'on_hold')).toBe(true);
    expect(canTransitionConstructionProjectStatus('on_hold', 'active')).toBe(true);
    expect(canTransitionConstructionProjectStatus('completed', 'active')).toBe(false);
    expect(canTransitionConstructionProjectStatus('closed', 'draft')).toBe(false);
  });

  it('preserves the established procurement lifecycle', () => {
    expect(canTransitionConstructionProjectStatus('tender', 'active')).toBe(true);
    expect(canTransitionConstructionProjectStatus('active', 'practical_completion')).toBe(true);
    expect(canTransitionConstructionProjectStatus('practical_completion', 'defect_liability')).toBe(true);
    expect(canTransitionConstructionProjectStatus('defect_liability', 'closed')).toBe(true);
  });
});
