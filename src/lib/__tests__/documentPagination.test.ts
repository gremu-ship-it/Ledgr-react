/**
 * Tests for computePageCuts — block-aware pagination for the PDF pipeline.
 *
 * The old pipeline sliced the rasterised document at exact A4 intervals, which
 * cut table rows and text in half at page boundaries. The new algorithm must
 * instead prefer measured element boundaries, while guaranteeing forward
 * progress for blocks taller than a page and never emitting sliver pages.
 */

import { describe, it, expect } from 'vitest';
import { computePageCuts } from '../documents/pagination';

const PAGE = 1000; // pretend one A4 content page is 1000px tall

describe('computePageCuts', () => {
  it('keeps short documents on a single page', () => {
    expect(computePageCuts({ totalHeightPx: 400, pageHeightPx: PAGE })).toEqual([0]);
    expect(computePageCuts({ totalHeightPx: PAGE, pageHeightPx: PAGE })).toEqual([0]);
  });

  it('falls back to exact page intervals when no break points exist', () => {
    expect(computePageCuts({ totalHeightPx: 2500, pageHeightPx: PAGE })).toEqual([0, 1000, 2000]);
  });

  it('prefers the closest break point within the fill window', () => {
    // Page 1 turns 60px early at 940. The point at 2000 then lies beyond the
    // next page's fill window (940..1940), so that page takes the hard cut.
    expect(
      computePageCuts({ totalHeightPx: 2500, pageHeightPx: PAGE, breakPointsPx: [940, 2000] }),
    ).toEqual([0, 940, 1940]);
  });

  it('cuts mid-block when a single block is taller than a page', () => {
    // Only break point is at 200: after cutting there, the window 200..1200
    // contains no other point, so a hard cut must happen at 1200.
    expect(
      computePageCuts({ totalHeightPx: 2500, pageHeightPx: PAGE, breakPointsPx: [200] }),
    ).toEqual([0, 200, 1200, 2200]);
  });

  it('ignores break points that would create slices smaller than minSlicePx', () => {
    // Break point at 50 is too close to the previous cut (0). After turning at
    // 996 the remaining window has no candidate, so the hard cut lands one
    // full page later at 1996.
    expect(
      computePageCuts({ totalHeightPx: 2500, pageHeightPx: PAGE, breakPointsPx: [50, 996] }),
    ).toEqual([0, 996, 1996]);
  });

  it('ignores break points inside the guard band at the page bottom', () => {
    // Point at 998 is within the 4px guard of the 1000px fill limit.
    expect(
      computePageCuts({ totalHeightPx: 2500, pageHeightPx: PAGE, breakPointsPx: [998] }),
    ).toEqual([0, 1000, 2000]);
  });

  it('absorbs trailing slivers instead of emitting a near-blank last page', () => {
    expect(
      computePageCuts({ totalHeightPx: PAGE + 1, pageHeightPx: PAGE }),
    ).toEqual([0]);
  });

  it('handles unsorted, duplicate and out-of-range break points', () => {
    expect(
      computePageCuts({ totalHeightPx: 2500, pageHeightPx: PAGE, breakPointsPx: [2000, 900, 900, 940, -10, 99999] }),
    ).toEqual([0, 940, 1940]);
  });

  it('always progresses and terminates even for extreme inputs', () => {
    const cuts = computePageCuts({
      totalHeightPx: 100_000,
      pageHeightPx: PAGE,
      breakPointsPx: [300],
    });
    expect(cuts[0]).toBe(0);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i]).toBeGreaterThan(cuts[i - 1]);
      expect(cuts[i]).toBeLessThanOrEqual(100_000);
    }
  });

  it('degenerates gracefully for zero or negative input', () => {
    expect(computePageCuts({ totalHeightPx: 0, pageHeightPx: PAGE })).toEqual([0]);
    expect(computePageCuts({ totalHeightPx: -20, pageHeightPx: PAGE })).toEqual([0]);
    expect(computePageCuts({ totalHeightPx: 500, pageHeightPx: 0 })).toEqual([0]);
  });
});
