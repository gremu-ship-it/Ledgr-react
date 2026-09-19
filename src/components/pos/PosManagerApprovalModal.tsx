import { useState } from 'react';
import { ShieldCheck, X, KeyRound, AlertCircle } from 'lucide-react';

interface PosManagerApprovalModalProps {
  open: boolean;
  onClose: () => void;
  actionDescription: string;
  onApprove: (managerPin: string, approverName: string) => void;
}

export function PosManagerApprovalModal({
  open,
  onClose,
  actionDescription,
  onApprove,
}: PosManagerApprovalModalProps) {
  if (!open) return null;

  const [pin, setPin] = useState('');
  const [managerName, setManagerName] = useState('Store Manager');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length < 4) {
      setError('Please enter a valid 4-digit manager PIN.');
      return;
    }
    // In demo / production, PIN 1234 or any 4 digits can be configured
    onApprove(pin, managerName);
    setPin('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-black text-gray-900">Manager Authorization Required</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action description banner */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          <p className="font-semibold">{actionDescription}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Approving Manager / Supervisor
            </label>
            <input
              type="text"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
              Manager Security PIN *
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="password"
                maxLength={6}
                autoFocus
                required
                placeholder="••••"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-center text-lg font-black tracking-widest focus:border-brand-500 focus:outline-none"
              />
            </div>
            {error && (
              <p className="text-[11px] font-bold text-red-600 mt-1 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-gray-200 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white py-2.5 text-xs font-black shadow-md active:scale-95 transition-all"
            >
              Authorize Action
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
