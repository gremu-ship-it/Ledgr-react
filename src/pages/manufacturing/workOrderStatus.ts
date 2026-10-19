/**
 * Shared work-order vocabulary: the forward-only lifecycle, its badge tone and
 * its i18n key.
 *
 * The lifecycle is deliberately forward-only — draft → released → in_progress →
 * completed → closed, with cancelled reachable from any non-closed state and no
 * backwards transition. Everything here is presentation only; the transitions
 * themselves are enforced by the manufacturing_wo_* RPCs.
 */

export type WorkOrderStatus =
  | 'draft'
  | 'released'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled';

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  'draft',
  'released',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
];

/** The i18n key under `manufacturing.wo.status.*` for a status. */
export function workOrderStatusKey(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'inProgress';
    default:
      return status;
  }
}

/** Tailwind classes for the status pill. */
export function workOrderStatusClass(status: string): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-700';
    case 'released':
      return 'bg-blue-100 text-blue-800';
    case 'in_progress':
      return 'bg-amber-100 text-amber-800';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'closed':
      return 'bg-emerald-800 text-white';
    case 'cancelled':
      return 'bg-red-100 text-red-700 line-through';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/** Percentage of the planned quantity that has been completed, capped at 100. */
export function workOrderProgressPct(workOrder: {
  planned_quantity: number;
  completed_quantity: number;
}): number {
  const planned = Number(workOrder.planned_quantity ?? 0);
  if (planned <= 0) return 0;
  const pct = (Number(workOrder.completed_quantity ?? 0) / planned) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Yield: completed as a percentage of everything the order produced, scrapped
 * output included. Null until something has actually been produced — an order
 * that has made nothing has no yield, not a zero yield.
 */
export function workOrderYieldPct(workOrder: {
  completed_quantity: number;
  scrapped_quantity: number;
}): number | null {
  const completed = Number(workOrder.completed_quantity ?? 0);
  const scrapped = Number(workOrder.scrapped_quantity ?? 0);
  const produced = completed + scrapped;
  if (produced <= 0) return null;
  return (completed / produced) * 100;
}

/** Which lifecycle actions a status offers. Close is only offered on completed. */
export function workOrderActions(status: string): {
  release: boolean;
  start: boolean;
  complete: boolean;
  close: boolean;
  cancel: boolean;
} {
  return {
    release: status === 'draft',
    start: status === 'released',
    complete: status === 'in_progress' || status === 'released',
    close: status === 'completed',
    cancel: status !== 'closed' && status !== 'cancelled',
  };
}
