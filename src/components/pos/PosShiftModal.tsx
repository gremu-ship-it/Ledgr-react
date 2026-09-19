import { useState } from 'react';
import { X, Lock, Unlock, Coins } from 'lucide-react';
import type { PosShift } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosShiftModalProps {
  open: boolean;
  onClose: () => void;
  currentShift: PosShift | null;
  onOpenShift: (openingFloat: number, notes?: string) => Promise<void>;
  onCloseShift: (closingCash: number, notes?: string) => Promise<void>;
  isProcessing?: boolean;
}

export function PosShiftModal({
  open,
  onClose,
  currentShift,
  onOpenShift,
  onCloseShift,
  isProcessing = false,
}: PosShiftModalProps) {
  const isOpenShift = !currentShift || currentShift.status === 'closed';
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');

  const expectedCash = currentShift ? Number(currentShift.expected_cash ?? currentShift.expectedCash ?? 0) : 0;
  const variance = !isOpenShift ? amount - expectedCash : 0;

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOpenShift) {
      await onOpenShift(amount, notes);
    } else {
      await onCloseShift(amount, notes);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            {isOpenShift ? (
              <Unlock className="h-5 w-5 text-emerald-600" />
            ) : (
              <Lock className="h-5 w-5 text-amber-600" />
            )}
            <h2 className="text-base font-black text-gray-900">
              {isOpenShift ? 'Open New Register Shift' : 'Close Active Register Shift'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isOpenShift ? (
            /* ── OPEN SHIFT ── */
            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                Count the physical cash in the drawer to establish your opening cash float before starting sales.
              </p>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Opening Cash Float (MWK) *
                </label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    required
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    placeholder="e.g. 20000"
                    className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-base font-black text-gray-900 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* ── CLOSE SHIFT ── */
            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-1 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Shift Opened:</span>
                  <span className="font-semibold">
                    {new Date(currentShift.opened_at || currentShift.start_time || '').toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Opening Float:</span>
                  <span className="font-semibold">
                    {formatMwkDetailed(Number(currentShift.opening_float || currentShift.opening_cash || 0))}
                  </span>
                </div>
                <div className="flex justify-between text-gray-900 font-bold pt-1 border-t border-gray-200">
                  <span>Expected Drawer Cash:</span>
                  <span>{formatMwkDetailed(expectedCash)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Actual Counted Cash in Drawer (MWK) *
                </label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    required
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    placeholder="e.g. 150000"
                    className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-base font-black text-gray-900 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Variance display */}
              <div
                className={`flex items-center justify-between rounded-xl p-2.5 text-xs font-black ${
                  variance === 0
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : variance > 0
                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                <span>Reconciliation Variance:</span>
                <span>
                  {variance > 0 ? '+' : ''}
                  {formatMwkDetailed(variance)}
                  {variance !== 0 && (
                    <span className="ml-1 text-[10px] font-normal">
                      ({variance > 0 ? 'Surplus / Overage' : 'Shortage / Deficit'})
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Notes / Handover Remarks
            </label>
            <input
              type="text"
              placeholder="e.g. Verified by shift supervisor"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-gray-200 py-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing}
              className={`flex-1 rounded-2xl py-3 text-xs font-black text-white shadow-md transition-all active:scale-95 ${
                isOpenShift ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {isProcessing
                ? 'Processing...'
                : isOpenShift
                ? 'Open Shift & Register'
                : 'Close & Reconcile Shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
