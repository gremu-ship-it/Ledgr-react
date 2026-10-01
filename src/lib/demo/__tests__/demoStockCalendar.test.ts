import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../dataset';

/**
 * Regression cover for a date-dependent defect found on 2026-10-01: the demo
 * balance sheet showed NEGATIVE Trading Stock for the first five days of every
 * month.
 *
 * Monthly stock deliveries are dated the 6th. The seeder used to skip any
 * delivery dated after the anchor, so on the 1st-5th the current month's COGS
 * was recognised with no replenishment behind it — account 1141 read
 * -6,126,972 instead of +1,396,752. It also failed `demoIntegration`'s
 * solvency assertion, so CI was red five days a month regardless of the change
 * under review.
 */
function stockBalance(anchor: Date): number {
  const tables = buildDemoDataset(anchor) as Record<string, Record<string, unknown>[]>;
  const stockAccountId = (tables.accounts ?? []).find((a) => a.code === '1141')?.id;
  let balance = 0;
  for (const line of tables.journal_lines ?? []) {
    if (line.account_id !== stockAccountId) continue;
    balance += line.is_debit ? Number(line.amount ?? 0) : -Number(line.amount ?? 0);
  }
  return Math.round(balance);
}

describe('demo Trading Stock stays solvent on every calendar day', () => {
  it('is positive on each day of a 31-day month, including days 1-5', () => {
    for (let day = 1; day <= 31; day += 1) {
      const anchor = new Date(2026, 9, day, 10, 0, 0); // October 2026
      expect(stockBalance(anchor), `day ${day} of the month`).toBeGreaterThan(0);
    }
  });

  it('does not jump when the month rolls over', () => {
    const lastDay = stockBalance(new Date(2026, 8, 30, 10, 0, 0));   // 30 Sep
    const firstDay = stockBalance(new Date(2026, 9, 1, 10, 0, 0));   // 1 Oct
    expect(firstDay).toBe(lastDay);
  });

  it('holds across month lengths and a leap day', () => {
    for (const anchor of [
      new Date(2027, 1, 1, 10, 0, 0),   // 1 Feb (28-day month)
      new Date(2028, 1, 29, 10, 0, 0),  // 29 Feb (leap)
      new Date(2026, 11, 31, 10, 0, 0), // 31 Dec
      new Date(2027, 0, 1, 10, 0, 0),   // 1 Jan (year roll)
    ]) {
      expect(stockBalance(anchor), anchor.toDateString()).toBeGreaterThan(0);
    }
  });
});
