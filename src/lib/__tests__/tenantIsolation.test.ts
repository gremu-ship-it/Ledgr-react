import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import { notificationMatchesContext } from '@/lib/notificationScope';
import { queueItemMatchesIdentity } from '@/offline/identity';

describe('tenant-sensitive cache keys', () => {
  it('separates identical detail ids by business', () => {
    const id = 'same-record-id';
    expect(queryKeys.invoiceLines('business-a', id)).not.toEqual(
      queryKeys.invoiceLines('business-b', id),
    );
    expect(queryKeys.journalEntry('business-a', id)).not.toEqual(
      queryKeys.journalEntry('business-b', id),
    );
    expect(queryKeys.payrollRun('business-a', id)).not.toEqual(
      queryKeys.payrollRun('business-b', id),
    );
    expect(queryKeys.transfer('business-a', id)).not.toEqual(
      queryKeys.transfer('business-b', id),
    );
  });
});

describe('offline queue ownership', () => {
  const item = { ownerUserId: 'user-a', businessId: 'business-a' };

  it('accepts only the exact originating user and business', () => {
    expect(queueItemMatchesIdentity(item, { userId: 'user-a', businessId: 'business-a' })).toBe(true);
    expect(queueItemMatchesIdentity(item, { userId: 'user-b', businessId: 'business-a' })).toBe(false);
    expect(queueItemMatchesIdentity(item, { userId: 'user-a', businessId: 'business-b' })).toBe(false);
  });
});

describe('notification ownership', () => {
  const notification = {
    userId: 'user-a',
    businessId: 'business-a',
    branchId: 'branch-a',
  };

  it('does not expose a notification to another user, business, or branch', () => {
    expect(notificationMatchesContext(notification, 'business-a', 'user-a', 'branch-a')).toBe(true);
    expect(notificationMatchesContext(notification, 'business-a', 'user-b', 'branch-a')).toBe(false);
    expect(notificationMatchesContext(notification, 'business-b', 'user-a', 'branch-a')).toBe(false);
    expect(notificationMatchesContext(notification, 'business-a', 'user-a', 'branch-b')).toBe(false);
  });
});
