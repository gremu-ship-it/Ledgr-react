import { useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, Coins } from 'lucide-react';
import type { PosShift } from '@/types/pos';

interface PosCashMovementModalProps {
  open: boolean;
  onClose: () => void;
  currentShift?: PosShift | null;
  onRecordMovement: (type: 'cash_in' | 'cash_out', amount: number, reason: string) => Promise<void>;
  isProcessing?: boolean;
}

export function PosCashMovementModal({
  open,
  onClose,
  onRecordMovement,
  isProcessing = false,
}: PosCashMovementModalProps) {
  const [type, setType] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState<string>('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      alert('Amount must be greater than zero.');
      return;
    }
    if (!reason.trim()) {
      alert('Please specify a reason for this cash movement.');
      return;
    }
    await onRecordMovement(type, amount, reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">Record Cash In / Out (Petty Cash)</h2>
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
          {/* Movement Type Toggle */}
          <div className="flex rounded-2xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setType('cash_in')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-black transition-all ${
                type === 'cash_in'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <ArrowDownRight className="h-4 w-4 text-emerald-600" />
              Cash In (Float Top-up)
            </button>
            <button
              type="button"
              onClick={() => setType('cash_out')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-black transition-all ${
                type === 'cash_out'
                  ? 'bg-white text-red-700 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <ArrowUpRight className="h-4 w-4 text-red-600" />
              Cash Out (Petty Cash / Drop)
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Amount (MWK) *
            </label>
            <input
              type="number"
              min={1}
              step="any"
              required
              autoFocus
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="e.g. 5000"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base font-black text-gray-900 focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Reason / Destination *
            </label>
            <input
              type="text"
              required
              placeholder={
                type === 'cash_in'
                  ? 'e.g. Additional float from safe'
                  : 'e.g. Office tea supplies, Bank deposit drop'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-xs focus:border-brand-500 focus:outline-none"
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
                type === 'cash_in'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {isProcessing
                ? 'Recording...'
                : type === 'cash_in'
                ? 'Record Cash In'
                : 'Record Cash Out'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
