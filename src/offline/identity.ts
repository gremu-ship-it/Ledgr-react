import type { QueueItem } from './db';

export interface OfflineSyncIdentity {
  userId: string;
  businessId: string;
}

/** Pure ownership check used before every durable financial queue submission. */
export function queueItemMatchesIdentity(
  item: Pick<QueueItem, 'ownerUserId' | 'businessId'>,
  identity: OfflineSyncIdentity,
): boolean {
  return item.ownerUserId === identity.userId && item.businessId === identity.businessId;
}
