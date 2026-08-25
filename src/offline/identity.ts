import type { QueueItem, QueueOperationType } from './db';
import type { QueuePayloadFor } from './payloads';

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

/**
 * Validate the tenant-bearing fields inside a semantic queue payload. RLS
 * still authorizes the eventual request, but a user may legitimately belong to
 * multiple businesses; the client must therefore reject a payload for B while
 * the queue envelope and active UI context are A.
 */
export function queuePayloadMatchesBusiness<T extends QueueOperationType>(
  operationType: T,
  payload: QueuePayloadFor<T>,
  businessId: string,
): boolean {
  switch (operationType) {
    case 'income':
    case 'invoice':
      return (payload as QueuePayloadFor<'invoice'>).invoice.business_id === businessId;
    case 'expense':
      return (payload as QueuePayloadFor<'expense'>).expense.business_id === businessId;
    case 'invoice_payment':
      return (payload as QueuePayloadFor<'invoice_payment'>).payment.business_id === businessId;
    case 'expense_payment':
      return (payload as QueuePayloadFor<'expense_payment'>).payment.business_id === businessId;
    case 'payroll_run': {
      const payroll = payload as QueuePayloadFor<'payroll_run'>;
      return (
        payroll.run.business_id === businessId &&
        payroll.lines.every((line) => line.business_id === businessId)
      );
    }
    case 'stock_movement':
      return (payload as QueuePayloadFor<'stock_movement'>).movement.business_id === businessId;
    default: {
      const _exhaustive: never = operationType;
      return _exhaustive;
    }
  }
}

export function queueItemHasValidPayloadScope(
  item: Pick<QueueItem, 'operationType' | 'payload' | 'businessId'>,
): boolean {
  return queuePayloadMatchesBusiness(
    item.operationType,
    item.payload as QueuePayloadFor<typeof item.operationType>,
    item.businessId,
  );
}
