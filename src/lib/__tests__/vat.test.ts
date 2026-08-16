import { describe, it, expect } from 'vitest';
import { VAT_STANDARD_RATE, VAT_STANDARD_RATE_PERCENT } from '@/lib/vat';

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
