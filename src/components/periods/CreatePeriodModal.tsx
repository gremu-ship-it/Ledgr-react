import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, X, CheckCircle, AlertCircle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type { InsertDto } from '@/dal/types/database';

interface Alert { type: 'success' | 'error'; message: string; }

function AlertBox({ alert }: { alert: Alert }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
      {alert.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {alert.message}
    </div>
  );
}

/**
 * Formats a Date's local calendar date as YYYY-MM-DD without ever routing
 * through UTC conversion (i.e. never via .toISOString()). For timezones
 * ahead of UTC (e.g. Africa/Johannesburg, UTC+2), constructing a local
 * midnight Date and calling .toISOString() shifts it back into the
 * previous day once converted to UTC — silently producing an off-by-one
 * day range. Building the string directly from local getFullYear/getMonth/
 * getDate avoids that conversion entirely.
 */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentMonthRange(): { name: string; start: string; end: string } {
  const now = new Date();
  const start = toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = toLocalDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const name = now.toLocaleDateString('en-MW', { month: 'long', year: 'numeric' });
  return { name, start, end };
}

interface CreatePeriodModalProps {
  businessId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreatePeriodModal({ businessId, onClose, onSuccess }: CreatePeriodModalProps) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [form, setForm] = useState({ name: '', period_start: '', period_end: '' });

  function set<K extends keyof typeof form>(field: K, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function useThisMonth() {
    const { name, start, end } = currentMonthRange();
    setForm({ name, period_start: start, period_end: end });
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Period name is required.');
      if (!form.period_start) throw new Error('Start date is required.');
      if (!form.period_end) throw new Error('End date is required.');

      return repos.period.createPeriod({
        business_id: businessId,
        name: form.name.trim(),
        period_start: form.period_start,
        period_end: form.period_end,
        is_closed: false,
      } as InsertDto<'accounting_periods'>);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Period created successfully.' });
      queryClient.invalidateQueries({ queryKey: ['accounting_periods'] });
      setTimeout(() => { onSuccess(); onClose(); }, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Create Accounting Period</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {alert && <AlertBox alert={alert} />}

        <button
          onClick={useThisMonth}
          className="mb-4 w-full rounded-lg border border-dashed border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 transition-colors"
        >
          Use This Month
        </button>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Period Name</label>
            <input
              type="text"
              placeholder="e.g. March 2025, Q1 2025"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
              <input
                type="date"
                value={form.period_start}
                onChange={(e) => set('period_start', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">End Date</label>
              <input
                type="date"
                value={form.period_end}
                onChange={(e) => set('period_end', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
            >
              {mutation.isPending ? 'Creating…' : 'Create Period'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}