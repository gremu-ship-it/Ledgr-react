import type { PosStockStatus } from '@/types/pos';

/**
 * IC 2026-09-25 P4 — tells the cashier WHERE displayed stock comes from and
 * never lets a failed stock read masquerade as "0 in stock".
 *
 *  - error    → red banner + Retry; items show "Stock ?" and stay sellable
 *               (the server's R06 check still rejects a real shortfall).
 *  - fallback → amber note naming the location the sale will deduct from
 *               (the warehouse-vs-branch selling policy is an OWNER DECISION;
 *               this only reports today's server behaviour).
 */
export function PosStockStatusBanner({ status, onRetry }: { status: PosStockStatus; onRetry: () => void }) {
  if (status.state === 'error') {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
        <span>
          <strong>Stock levels could not be loaded.</strong> Quantities are unknown (not zero); the sale will still be
          checked against stock when it is recorded. {status.message}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      </div>
    );
  }
  if (status.state === 'ok' && status.noLocation) {
    return (
      <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        No stock location is set up for this business, so sales will not deduct stock.
      </div>
    );
  }
  if (status.state === 'ok' && status.isFallback && status.locationName) {
    return (
      <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        This till has no shop location of its own — stock shown and sold is from <strong>{status.locationName}</strong>.
      </div>
    );
  }
  return null;
}
