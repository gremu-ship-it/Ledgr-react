/**
 * Unit tests for the pure VAT-return arithmetic behind the
 * generate-vat-returns Edge Function (the monthly cron that auto-generates
 * a draft VAT return per VAT-registered business).
 *
 * What this protects: the filing calendar itself. Getting the period bounds
 * or the 25th-of-following-month due date wrong means returns generated for
 * the wrong tax month or alerts scheduled against the wrong deadline — and
 * because the job runs unattended at 06:00 on the 1st, nobody would notice
 * until the MRA penalty arrives. The date rules also encode a real bug that
 * was fixed: rendering local midnights through toISOString (UTC) shifted
 * every bound back one day in timezones ahead of UTC.
 */
import { describe, it, expect } from 'vitest';
import {
  priorMonthPeriod,
  sumTaxAmounts,
  computeAmountDue,
  alertSchedule,
  VAT_ALERT_OFFSETS,
} from '../vatReturn';

describe('priorMonthPeriod', () => {
  it('targets the prior calendar month with the 25th as due date', () => {
    expect(priorMonthPeriod(new Date(2026, 6, 15))).toEqual({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      periodLabel: '2026-06',
      dueDate: '2026-07-25',
    });
  });

  it('works on the 1st — the day the cron actually runs', () => {
    expect(priorMonthPeriod(new Date(2026, 7, 1))).toEqual({
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      periodLabel: '2026-07',
      dueDate: '2026-08-25',
    });
  });

  it('rolls across the year boundary in January', () => {
    // A run on 2026-01-01 files December 2025, due 2026-01-25.
    expect(priorMonthPeriod(new Date(2026, 0, 1))).toEqual({
      periodStart: '2025-12-01',
      periodEnd: '2025-12-31',
      periodLabel: '2025-12',
      dueDate: '2026-01-25',
    });
  });

  it('handles February in leap and non-leap years', () => {
    expect(priorMonthPeriod(new Date(2024, 2, 1)).periodEnd).toBe('2024-02-29');
    expect(priorMonthPeriod(new Date(2026, 2, 1)).periodEnd).toBe('2026-02-28');
  });

  it('is independent of the host timezone (no toISOString drift)', () => {
    // Construct a timestamp that is 22:30 local on the last day of the run
    // month — a rendering bug through UTC would misread both bounds.
    const period = priorMonthPeriod(new Date(2026, 6, 31, 22, 30));
    expect(period.periodStart).toBe('2026-06-01');
    expect(period.dueDate).toBe('2026-07-25');
  });
});

describe('sumTaxAmounts', () => {
  it('sums numeric tax amounts and numeric strings', () => {
    expect(sumTaxAmounts([{ tax_amount: 100 }, { tax_amount: '250.5' }, { tax_amount: 49.5 }])).toBe(400);
  });

  it('returns 0 for an empty line set', () => {
    expect(sumTaxAmounts([])).toBe(0);
  });
});

describe('computeAmountDue', () => {
  it('is output tax less input tax', () => {
    expect(computeAmountDue(100_000, 40_000)).toBe(60_000);
  });

  it('floors at zero — a net credit position is not a negative amount due', () => {
    expect(computeAmountDue(40_000, 100_000)).toBe(0);
  });

  it('rounds to the tambala (0.01 MWK)', () => {
    expect(computeAmountDue(123.456, 0)).toBe(123.46);
    expect(computeAmountDue(0.004, 0)).toBe(0);
  });
});

describe('alertSchedule', () => {
  it('schedules the 14/7/1-day and due-date alerts', () => {
    expect(alertSchedule('2026-07-25')).toEqual([
      { alert_type: '14_day', scheduled_for: '2026-07-11' },
      { alert_type: '7_day', scheduled_for: '2026-07-18' },
      { alert_type: '1_day', scheduled_for: '2026-07-24' },
      { alert_type: 'due_date', scheduled_for: '2026-07-25' },
    ]);
  });

  it('derives its offsets from VAT_ALERT_OFFSETS', () => {
    expect(alertSchedule('2026-01-25')).toHaveLength(VAT_ALERT_OFFSETS.length);
  });
});
