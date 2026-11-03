/**
 * The rate resolver and the refusal feedback layer.
 *
 * These tests are about the two things the module refuses to do: pick one of two
 * conflicting periods, and produce a rate for a date the product cannot evidence.
 * They prove nothing about authorisation or about the stored data — the database
 * behaviour is in tests/release/tax-configurations.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_ROW_CHANGED_MESSAGE,
  describePeriodCoverage,
  describeTaxConfigurationFailure,
  explainTaxRateResolution,
  formatRatePercent,
  resolveTaxRate,
  supportedRateFor,
  type TaxRatePeriod,
} from '@/lib/tax/taxConfiguration';
import { VAT_STANDARD_RATE_EVIDENCE_REFERENCE } from '@/lib/vat';

const period = (over: Partial<TaxRatePeriod> = {}): TaxRatePeriod => ({
  id: 'p1',
  tax_code: 'vat_standard',
  name: 'VAT — Standard Rate',
  rate: 17.5,
  is_active: true,
  effective_from: '2026-01-01',
  effective_to: null,
  mra_reference: VAT_STANDARD_RATE_EVIDENCE_REFERENCE,
  ...over,
});

/** The schedule the 1 January 2026 change produces once a business records it. */
const SCHEDULE: TaxRatePeriod[] = [
  period({ id: 'old', rate: 16.5, effective_from: '2024-01-01', effective_to: '2025-12-31', mra_reference: 'VAT Act Cap 42:02 — 16.5% schedule' }),
  period({ id: 'new', rate: 17.5, effective_from: '2026-01-01', effective_to: null }),
];

describe('resolveTaxRate — a stored schedule', () => {
  it('answers the day the 16.5% period ends, the day the 17.5% period starts, and the day after', () => {
    for (const [date, rate] of [['2025-12-31', 16.5], ['2026-01-01', 17.5], ['2026-01-02', 17.5]] as const) {
      const result = resolveTaxRate(SCHEDULE, 'vat_standard', date);
      expect(result.status).toBe('configured');
      if (result.status !== 'configured') return;
      expect(result.ratePercent).toBe(rate);
      expect(result.rateFraction).toBe(rate / 100);
      expect(result.period.id).toBe(rate === 16.5 ? 'old' : 'new');
    }
  });

  it('treats coverage as half-open: a period ending on a date covers that date, and the successor starts the next day', () => {
    // 2025-12-31 is the last day of the 16.5% period — it is NOT the first day of the 17.5% one.
    const lastOld = resolveTaxRate(SCHEDULE, 'vat_standard', '2025-12-31');
    const firstNew = resolveTaxRate(SCHEDULE, 'vat_standard', '2026-01-01');
    expect(lastOld.status === 'configured' && lastOld.period.id).toBe('old');
    expect(firstNew.status === 'configured' && firstNew.period.id).toBe('new');
  });

  it('carries the evidence reference of the period it answered from', () => {
    const result = resolveTaxRate(SCHEDULE, 'vat_standard', '2025-06-01');
    expect(result.status === 'configured' && result.evidenceReference).toBe('VAT Act Cap 42:02 — 16.5% schedule');
  });

  it('a business’s own open-ended 16.5% period is used, not the supported 17.5% rate', () => {
    const result = resolveTaxRate([period({ rate: 16.5, effective_from: '2024-01-01' })], 'vat_standard', '2026-06-01');
    expect(result.status).toBe('configured');
    expect(result.status === 'configured' && result.ratePercent).toBe(16.5);
  });

  it('an inactive period is not a rate: the date falls through to the supported schedule', () => {
    const result = resolveTaxRate([period({ is_active: false })], 'vat_standard', '2026-06-01');
    expect(result.status).toBe('supported_default');
  });

  it('represents a rate stored as a string percentage without changing its value', () => {
    const result = resolveTaxRate([period({ rate: '7.5' })], 'vat_standard', '2026-06-01');
    expect(result.status === 'configured' && result.ratePercent).toBe(7.5);
    expect(result.status === 'configured' && result.rateFraction).toBe(0.075);
  });
});

describe('resolveTaxRate — what it refuses to answer', () => {
  it('reports two covering periods as ambiguous instead of choosing one', () => {
    const overlapping = [period({ id: 'a', rate: 16.5 }), period({ id: 'b', rate: 17.5, mra_reference: 'a different notice' })];
    const result = resolveTaxRate(overlapping, 'vat_standard', '2026-06-01');
    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.periods.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(explainTaxRateResolution(result)).toMatch(/no single rate can be resolved/i);
    expect(explainTaxRateResolution(result)).toMatch(/close one period/i);
  });

  it('never infers 16.5%: a date before the evidenced schedule with nothing stored is unsupported', () => {
    // The start of the 16.5% period is not evidenced anywhere in the product, so
    // no rate may be produced for it — not even the rate the sources say applied.
    for (const date of ['2025-12-31', '2020-01-01', '1999-12-31']) {
      const result = resolveTaxRate([], 'vat_standard', date);
      expect(result.status).toBe('unsupported');
      if (result.status !== 'unsupported') return;
      expect(result.supportedFrom).toBe('2026-01-01');
      expect(JSON.stringify(result)).not.toContain('16.5');
    }
  });

  it('is unsupported for a tax code the product evidences nothing for, whatever the date', () => {
    const result = resolveTaxRate([], 'wht_10', '2026-06-01');
    expect(result.status).toBe('unsupported');
    expect(result.status === 'unsupported' && result.supportedFrom).toBeNull();
  });

  it('ignores rows of another tax code and of another schedule entirely', () => {
    const other = [period({ tax_code: 'wht_15', rate: 15, effective_from: '2020-01-01' })];
    expect(resolveTaxRate(other, 'vat_standard', '2026-06-01').status).toBe('supported_default');
    expect(resolveTaxRate(other, 'wht_15', '2026-06-01').status).toBe('configured');
  });
});

describe('resolveTaxRate — the supported schedule', () => {
  it('answers the evidenced 17.5% from 1 January 2026, with its reference, and only from that date', () => {
    const result = resolveTaxRate([], 'vat_standard', '2026-01-01');
    expect(result.status).toBe('supported_default');
    if (result.status !== 'supported_default') return;
    expect(result.ratePercent).toBe(17.5);
    expect(result.rateFraction).toBe(0.175);
    expect(result.supportedFrom).toBe('2026-01-01');
    expect(result.evidenceReference).toBe(VAT_STANDARD_RATE_EVIDENCE_REFERENCE);
    expect(resolveTaxRate([], 'vat_standard', '2025-12-31').status).toBe('unsupported');
  });

  it('exposes exactly one supported rate, for the standard VAT code', () => {
    expect(supportedRateFor('vat_standard')?.effectiveFrom).toBe('2026-01-01');
    expect(supportedRateFor('vat_exempt')).toBeNull();
  });
});

describe('describePeriodCoverage', () => {
  it('says where a stored period sits relative to the date asked about', () => {
    expect(describePeriodCoverage(period({ effective_from: '2024-01-01', effective_to: null }), '2026-06-01')).toBe('in_effect');
    expect(describePeriodCoverage(period({ effective_from: '2099-01-01' }), '2026-06-01')).toBe('scheduled');
    expect(describePeriodCoverage(period({ effective_from: '2024-01-01', effective_to: '2025-12-31' }), '2026-06-01')).toBe('ended');
    expect(describePeriodCoverage(period({ is_active: false, effective_from: '2024-01-01', effective_to: null }), '2026-06-01')).toBe('inactive');
  });

  it('formats a percentage the way the table does', () => {
    expect(formatRatePercent(17.5)).toBe('17.50%');
    expect(formatRatePercent(0)).toBe('0.00%');
  });
});

describe('describeTaxConfigurationFailure', () => {
  it('explains an overlap refusal by the constraint the server names, keeping the server’s wording', () => {
    const error = Object.assign(
      new Error('conflicting key value violates exclusion constraint "tax_configurations_no_overlap"'),
      { code: '23P01' },
    );
    const failure = describeTaxConfigurationFailure(error);
    expect(failure.constraint).toBe('tax_configurations_no_overlap');
    expect(failure.sqlState).toBe('23P01');
    expect(failure.explanation?.summary).toMatch(/already covers part of these dates/i);
    expect(failure.explanation?.action).toMatch(/ends the day before/i);
    expect(failure.message).toContain('tax_configurations_no_overlap');
    expect(failure.isAuthorityDenial).toBe(false);
  });

  it('explains a missing evidence reference', () => {
    const failure = describeTaxConfigurationFailure(
      Object.assign(new Error('new row for relation "tax_configurations" violates check constraint "tax_configurations_evidence_chk"'), { code: '23514' }),
    );
    expect(failure.explanation?.summary).toMatch(/must record the reference it relies on/i);
    expect(failure.explanation?.action).toMatch(/MRA reference/i);
  });

  it('explains the period and rate-range checks', () => {
    expect(describeTaxConfigurationFailure(new Error('violates check constraint "tax_configurations_period_chk"')).explanation?.summary)
      .toMatch(/end date is not after the start date/i);
    expect(describeTaxConfigurationFailure(new Error('violates check constraint "tax_configurations_rate_chk"')).explanation?.summary)
      .toMatch(/between 0 and 100/i);
  });

  it('treats an authority denial as one, without inventing an explanation', () => {
    const failure = describeTaxConfigurationFailure(
      Object.assign(new Error('permission denied for table tax_configurations'), { code: '42501' }),
    );
    expect(failure.explanation).toBeNull();
    expect(failure.isAuthorityDenial).toBe(true);
    expect(failure.message).toContain('permission denied');
  });

  it('preserves an unexplained message verbatim and never returns an empty one', () => {
    expect(describeTaxConfigurationFailure(new Error('synthetic server wording')).message).toBe('synthetic server wording');
    const silent = describeTaxConfigurationFailure(new Error(NO_ROW_CHANGED_MESSAGE));
    expect(silent.message).toBe(NO_ROW_CHANGED_MESSAGE);
    expect(silent.explanation).toBeNull();
    expect(describeTaxConfigurationFailure(undefined).message).toBe('The change could not be saved.');
  });
});
