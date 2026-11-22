// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateLease,
  getLocalLease,
  storeLocalLease,
  type SubscriptionLease,
} from '../subscriptionLeaseService';

const BUSINESS_ID = 'biz-test-001';

function createLease(nowEpoch: number, daysValid = 14, daysGrace = 3): SubscriptionLease {
  const validUntil = nowEpoch + daysValid * 86400;
  const graceUntil = validUntil + daysGrace * 86400;
  return {
    payload: {
      business_id: BUSINESS_ID,
      issued_to_user: 'user-test-001',
      plan: 'growth',
      operating_models: ['PRODUCT_SALES'],
      issued_at: nowEpoch,
      valid_until: validUntil,
      grace_until: graceUntil,
    },
    signature: 'deadbeefcafebabe',
    algorithm: 'HMAC-SHA256',
  };
}

describe('subscriptionLeaseService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('Test 1: Active lease within 14 days returns status ACTIVE and canWrite true', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lease = createLease(nowEpoch);
    storeLocalLease(BUSINESS_ID, lease);

    // Advance 5 days
    vi.advanceTimersByTime(5 * 86400 * 1000);

    const evaluation = evaluateLease(BUSINESS_ID);
    expect(evaluation.status).toBe('ACTIVE');
    expect(evaluation.canWrite).toBe(true);
    expect(evaluation.canRead).toBe(true);
    expect(evaluation.plan).toBe('growth');
    expect(evaluation.daysRemaining).toBe(9);
  });

  it('Test 2: Lease in grace period (day 15) returns status GRACE_PERIOD, canWrite true with warning', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lease = createLease(nowEpoch);
    storeLocalLease(BUSINESS_ID, lease);

    // Advance 15 days (1 day into 3-day grace period)
    vi.advanceTimersByTime(15 * 86400 * 1000);

    const evaluation = evaluateLease(BUSINESS_ID);
    expect(evaluation.status).toBe('GRACE_PERIOD');
    expect(evaluation.canWrite).toBe(true);
    expect(evaluation.canRead).toBe(true);
    expect(evaluation.daysRemaining).toBe(2);
    expect(evaluation.error).toBe('subscription.errors.gracePeriodWarning');
  });

  it('Test 3: Lease past grace period (day 18) returns status EXPIRED and canWrite false', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lease = createLease(nowEpoch);
    storeLocalLease(BUSINESS_ID, lease);

    // Advance 18 days (past 14 + 3 days)
    vi.advanceTimersByTime(18 * 86400 * 1000);

    const evaluation = evaluateLease(BUSINESS_ID);
    expect(evaluation.status).toBe('EXPIRED');
    expect(evaluation.canWrite).toBe(false);
    expect(evaluation.canRead).toBe(true);
    expect(evaluation.daysRemaining).toBe(0);
    expect(evaluation.error).toBe('subscription.errors.leaseExpired');
  });

  it('Test 4: Clock rollback triggers status CLOCK_TAMPERED and locks writes', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lease = createLease(nowEpoch);
    storeLocalLease(BUSINESS_ID, lease);

    // Advance 2 days and evaluate to set watermark forward
    vi.advanceTimersByTime(2 * 86400 * 1000);
    expect(evaluateLease(BUSINESS_ID).status).toBe('ACTIVE');

    // Roll back system clock by 1 day (> 60s tolerance)
    vi.setSystemTime(new Date(Date.now() - 86400 * 1000));

    const evaluation = evaluateLease(BUSINESS_ID);
    expect(evaluation.status).toBe('CLOCK_TAMPERED');
    expect(evaluation.canWrite).toBe(false);
    expect(evaluation.canRead).toBe(true);
    expect(evaluation.error).toBe('subscription.errors.clockTampered');
  });

  it('Test 5: Storage and parsing of valid lease payloads', () => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lease = createLease(nowEpoch);
    storeLocalLease(BUSINESS_ID, lease);

    const retrieved = getLocalLease(BUSINESS_ID);
    expect(retrieved).toEqual(lease);
    expect(getLocalLease('non-existent-biz')).toBeNull();
  });
});
