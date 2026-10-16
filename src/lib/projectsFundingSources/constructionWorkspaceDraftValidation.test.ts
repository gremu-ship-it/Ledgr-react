import { describe, expect, it } from 'vitest';
import {
  validateConstructionWorkspaceDraft,
  type ConstructionWorkspaceDraftFields,
} from './constructionWorkspaceDraftValidation';

function draft(overrides: Partial<ConstructionWorkspaceDraftFields> = {}): ConstructionWorkspaceDraftFields {
  return {
    projectCode: '',
    projectName: 'Borehole works',
    clientName: '',
    siteName: '',
    siteLocation: '',
    contractValue: '',
    contractCurrency: '',
    approvedBudget: '',
    budgetCurrency: '',
    plannedStartDate: '',
    plannedCompletionDate: '',
    projectManagerName: '',
    status: 'draft',
    ...overrides,
  };
}

describe('construction workspace local-draft validation', () => {
  it('requires only a project name and leaves the other brief fields optional', () => {
    const result = validateConstructionWorkspaceDraft(draft());

    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      projectName: 'Borehole works',
      projectCode: '',
      clientName: '',
      siteName: '',
      siteLocation: '',
      contractValue: '',
      approvedBudget: '',
      plannedStartDate: '',
      plannedCompletionDate: '',
      projectManagerName: '',
      status: 'draft',
    });
  });

  it('rejects a missing project name', () => {
    const result = validateConstructionWorkspaceDraft(draft({ projectName: '   ' }));

    expect(result.values).toBeNull();
    expect(result.errors.projectName).toBe('Project name is required to keep a draft in this tab.');
  });

  it.each([
    ['negative amount', '-1'],
    ['non-finite amount', 'Infinity'],
    ['non-numeric amount', 'MWK 1200'],
    ['decimal exponent amount', '1e6'],
  ])('rejects an invalid contract value (%s)', (_description, contractValue) => {
    const result = validateConstructionWorkspaceDraft(draft({ contractValue, contractCurrency: 'MWK' }));

    expect(result.values).toBeNull();
    expect(result.errors.contractValue).toBe('Contract value must be a finite amount of zero or more.');
  });

  it('requires a currency note when an amount is entered and normalizes the code', () => {
    const missingCurrency = validateConstructionWorkspaceDraft(draft({ contractValue: '1250.50' }));
    expect(missingCurrency.values).toBeNull();
    expect(missingCurrency.errors.contractCurrency).toBe('Add a currency code when entering contract value.');

    const validCurrency = validateConstructionWorkspaceDraft(draft({
      contractValue: '1250.50',
      contractCurrency: ' mwk ',
    }));
    expect(validCurrency.errors).toEqual({});
    expect(validCurrency.values?.contractCurrency).toBe('MWK');
  });

  it('rejects invalid calendar dates', () => {
    const result = validateConstructionWorkspaceDraft(draft({ plannedStartDate: '2027-02-29' }));

    expect(result.values).toBeNull();
    expect(result.errors.plannedStartDate).toBe('Planned start date must be a valid calendar date.');
  });

  it('rejects a completion date before the start date', () => {
    const result = validateConstructionWorkspaceDraft(draft({
      plannedStartDate: '2027-05-01',
      plannedCompletionDate: '2027-04-30',
    }));

    expect(result.values).toBeNull();
    expect(result.errors.plannedCompletionDate)
      .toBe('Planned completion date must be on or after the planned start date.');
  });

  it('trims optional text and accepts a zero amount without requiring an official project record', () => {
    const result = validateConstructionWorkspaceDraft(draft({
      projectCode: '  TEMP-01 ',
      projectName: '  Water works ',
      approvedBudget: '0',
      budgetCurrency: 'MWK',
    }));

    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      projectCode: 'TEMP-01',
      projectName: 'Water works',
      approvedBudget: '0',
      budgetCurrency: 'MWK',
    });
  });
});
