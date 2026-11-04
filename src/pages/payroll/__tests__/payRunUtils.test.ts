import { describe, expect, it } from 'vitest';
import { formatPayPeriod, formatPayRunMoney, payRunPostingErrorTranslation } from '../payRunUtils';

describe('pay-run presentation helpers', () => {
  it('formats pay amounts in the business currency with exactly two decimals', () => {
    expect(formatPayRunMoney(1234.5, 'MWK', 'en')).toContain('1,234.50');
    expect(formatPayRunMoney(1234.5, 'JPY', 'en')).toContain('1,234.50');
    expect(formatPayRunMoney(1234.5, 'INVALID', 'en')).toBe('INVALID 1234.50');
  });

  it('formats pay-run periods with a localized month and year', () => {
    expect(formatPayPeriod('2026-10-01', 'en')).toBe('Oct 2026');
  });

  it('translates actionable payroll posting setup failures', () => {
    expect(payRunPostingErrorTranslation(new Error('Set an expense account on payroll component BASIC before posting.')))
      .toEqual({ key: 'payroll.postMissingExpenseAccount', values: { component: 'BASIC' } });
    expect(payRunPostingErrorTranslation(new Error('Payroll component BONUS points to an account outside this business.')))
      .toEqual({ key: 'payroll.postInvalidComponentAccount', values: { component: 'BONUS' } });
    expect(payRunPostingErrorTranslation(new Error('No PAYE tax bands are configured for fiscal year 2026.')))
      .toEqual({ key: 'payroll.postNoTaxBands', values: { year: '2026' } });
  });
});
