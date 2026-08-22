import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '@/lib/security';

describe('timingSafeEqual', () => {
  it('accepts identical strings', () => {
    expect(timingSafeEqual('cron-secret-value', 'cron-secret-value')).toBe(true);
  });

  it('rejects different strings of the same length', () => {
    expect(timingSafeEqual('aaaaaaaa', 'aaaaaaab')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(timingSafeEqual('short', 'much-longer')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });

  it('does not treat empty strings as a configured secret match for callers', () => {
    // Fail-closed cron auth must never treat "" === "" as authorised when
    // the secret is missing; that check lives in cronAuth. The primitive
    // itself is honest about empty equality.
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
