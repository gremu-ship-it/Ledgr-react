import { describe, expect, it } from 'vitest';
import { countBusinessDays } from '../leaveUtils';

describe('countBusinessDays', () => {
  it('counts weekdays inclusively for a Monday-to-Friday leave range', () => {
    expect(countBusinessDays('2026-11-02', '2026-11-06')).toBe(5);
  });

  it('excludes weekend days and returns zero for invalid or reversed ranges', () => {
    expect(countBusinessDays('2026-11-06', '2026-11-09')).toBe(2);
    expect(countBusinessDays('2026-11-07', '2026-11-08')).toBe(0);
    expect(countBusinessDays('2026-02-30', '2026-03-01')).toBe(0);
    expect(countBusinessDays('2026-11-09', '2026-11-02')).toBe(0);
  });
});
