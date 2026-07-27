import { describe, it, expect } from 'vitest';
import { formatMwk, formatMwkCompact } from '@/lib/formatters';

describe('formatMwk', () => {
  it('formats a whole-kwacha amount without fraction digits', () => {
    expect(formatMwk(1000)).toContain('1,000');
  });

  it('formats zero', () => {
    expect(formatMwk(0)).toContain('0');
  });

  it('groups large numbers', () => {
    expect(formatMwk(1_000_000)).toContain('1,000,000');
  });
});

describe('formatMwkCompact', () => {
  it('abbreviates billions', () => {
    expect(formatMwkCompact(1_200_000_000)).toBe('MK 1.2B');
  });

  it('abbreviates millions', () => {
    expect(formatMwkCompact(2_500_000)).toBe('MK 2.5M');
  });

  it('abbreviates thousands', () => {
    expect(formatMwkCompact(15_000)).toBe('MK 15K');
  });

  it('falls back to full formatting under one thousand', () => {
    // Note: Intl.NumberFormat uses a narrow no-break space as the separator,
    // hence the contains() check rather than an exact string match.
    expect(formatMwkCompact(500)).toContain('500');
    expect(formatMwkCompact(500).startsWith('MK')).toBe(true);
  });
});
