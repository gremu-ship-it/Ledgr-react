import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type { TaxObligation } from '@/hooks/useTaxObligations';

export function MarkFiledModal({
  obligation,
  onClose,
}: {
  obligation: TaxObligation;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [filedRef, setFiledRef] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!filedRef.trim()) throw new Error('Enter the filing acknowledgement reference.');
      return repos.taxReturn.markFiled(obligation.taxReturn.id, filedRef.trim());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_returns'] });
      setAlert({ type: 'success', message: 'Return marked as filed.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Mark as filed</h2>
            <p className="text-xs text-gray-500">
              {obligation.label} · {obligation.periodDisplay}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {alert && (
            <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
              alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
            }`}>
              {alert.type === 'success'
                ? <CheckCircle className="h-4 w-4 shrink-0" />
                : <AlertCircle className="h-4 w-4 shrink-0" />}
              {alert.message}
            </div>
          )}

          <div>
            <label htmlFor="filed-ref" className="mb-1 block text-sm font-medium text-gray-700">
              {obligation.authority} acknowledgement reference *
            </label>
            <input
              id="filed-ref"
              type="text"
              value={filedRef}
              onChange={(e) => setFiledRef(e.target.value)}
              placeholder="e.g. ACK-2026-0012345"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Recording the reference does not move any money — use “Mark as paid” to record the payment.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60">
            {mutation.isPending ? 'Saving…' : 'Mark as filed'}
          </button>
        </div>
      </div>
    </div>
  );
}
