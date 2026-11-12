import { describe, expect, it } from 'vitest';
import { getPosAnalyticsWindow } from '@/hooks/usePosOwnerAnalytics';

describe('POS analytics server date windows', () => {
  const anchor = new Date(2026, 10, 6, 15, 30);

  it('uses local calendar boundaries for today, seven days, and thirty days', () => {
    expect(getPosAnalyticsWindow('today', anchor)).toEqual({
      from: new Date(2026, 10, 6).toISOString(),
      to: new Date(2026, 10, 7).toISOString(),
    });
    expect(getPosAnalyticsWindow('7d', anchor)).toEqual({
      from: new Date(2026, 9, 31).toISOString(),
      to: new Date(2026, 10, 7).toISOString(),
    });
    expect(getPosAnalyticsWindow('30d', anchor)).toEqual({
      from: new Date(2026, 9, 8).toISOString(),
      to: new Date(2026, 10, 7).toISOString(),
    });
  });

  it('leaves both boundaries open for all-time aggregation', () => {
    expect(getPosAnalyticsWindow('all_time', anchor)).toEqual({ from: null, to: null });
  });
});
