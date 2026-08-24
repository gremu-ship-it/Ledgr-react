import { describe, it, expect } from 'vitest';
import {
  VAT_STANDARD_RATE,
  VAT_STANDARD_RATE_PERCENT,
  computeVatNetDue,
  vatDueDateForPeriodEnd,
  vatPeriodLabel,
  previousCalendarMonth,
} from '@/lib/vat';

describe('VAT standard rate (Phase 10 A-05)', () => {
  it('centralises the statutory rate at 17.5%', () => {
    expect(VAT_STANDARD_RATE).toBe(0.175);
    expect(VAT_STANDARD_RATE_PERCENT).toBe(17.5);
  });

  it('derives the display percentage from the rate (labels cannot drift)', () => {
    expect(VAT_STANDARD_RATE_PERCENT).toBe(VAT_STANDARD_RATE * 100);
    expect(`VAT ${VAT_STANDARD_RATE_PERCENT}%`).toBe('VAT 17.5%');
  });
});

describe('VAT return helpers', () => {
  it('never returns a negative net due', () => {
    expect(computeVatNetDue(100, 250)).toBe(0);
  });

  it('rounds to the nearest tambala', () => {
    expect(computeVatNetDue(10.226, 0.001)).toBe(10.23);
  });

  it('sets the MRA due date to the 25th of the following month', () => {
    expect(vatDueDateForPeriodEnd('2026-06-30')).toBe('2026-07-25');
    expect(vatDueDateForPeriodEnd('2026-01-31')).toBe('2026-02-25');
  });

  it('labels a period as YYYY-MM', () => {
    expect(vatPeriodLabel('2026-06-01')).toBe('2026-06');
  });

  it('resolves the prior calendar month from a fixed clock', () => {
    const { periodStart, periodEnd } = previousCalendarMonth(new Date(2026, 7, 22));
    expect(periodStart).toBe('2026-07-01');
    expect(periodEnd).toBe('2026-07-31');
  });
});
