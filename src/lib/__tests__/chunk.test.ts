import { describe, it, expect } from 'vitest';
import { chunk } from '@/lib/chunk';

describe('chunk', () => {
  it('returns an empty array for empty input', () => {
    expect(chunk([])).toEqual([]);
  });

  it('keeps a short list as a single batch', () => {
    expect(chunk(['a', 'b'], 200)).toEqual([['a', 'b']]);
  });

  it('splits on the requested size and keeps the tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow(/positive/);
  });
});
