import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, X, ExternalLink } from 'lucide-react';
import { getMraDueDates, type TaxDueDate } from '@/hooks/useTaxData';

export function TaxReminderModal() {
  const [open, setOpen] = useState(false);
  const [urgentDates, setUrgentDates] = useState<TaxDueDate[]>([]);

  useEffect(() => {
    // Only show once per session
    if (sessionStorage.getItem('ledgr_tax_reminder_shown')) return;

    const dueDates = getMraDueDates();
    const urgent = dueDates.filter((d) => d.isOverdue || d.isDueSoon);

    if (urgent.length > 0) {
      setUrgentDates(urgent);
      setOpen(true);
      sessionStorage.setItem('ledgr_tax_reminder_shown', '1');
    }
  }, []);

  if (!open) return null;

  const hasOverdue = urgentDates.some((d) => d.isOverdue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl">
        {/* Header */}
        <div className={`rounded-t-2xl px-5 py-4 ${
          hasOverdue ? 'bg-red-500' : 'bg-amber-500'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {hasOverdue
                ? <AlertTriangle className="h-5 w-5 text-white" />
                : <Clock className="h-5 w-5 text-white" />}
              <h2 className="text-base font-semibold text-white">
                {hasOverdue ? 'Tax Payment Overdue!' : 'Tax Payment Due Soon'}
              </h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-1 text-sm text-white/80">
            {hasOverdue
              ? 'You have overdue MRA tax payments. Failure to remit attracts penalties.'
              : 'The following MRA tax payments are due within 7 days.'}
          </p>
        </div>

        {/* Due dates list */}
        <div className="p-5">
          <div className="space-y-3">
            {urgentDates.map((d) => (
              <div
                key={d.taxType}
                className={`rounded-xl p-3 ${
                  d.isOverdue ? 'bg-red-50 border border-red-100' : 'bg-amber-50 border border-amber-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-semibold ${
                      d.isOverdue ? 'text-red-800' : 'text-amber-800'
                    }`}>
                      {d.taxType}
                    </p>
                    <p className="text-xs text-gray-500">Period: {d.period}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${
                      d.isOverdue ? 'text-red-600' : 'text-amber-600'
                    }`}>
                      {d.isOverdue
                        ? `${Math.abs(d.daysUntilDue)} days overdue`
                        : d.daysUntilDue === 0
                        ? 'Due TODAY'
                        : `Due in ${d.daysUntilDue} days`}
                    </p>
                    <p className="text-xs text-gray-500">{d.dueDateStr}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* MRA penalty warning */}
          {hasOverdue && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
              ⚠ Failure to remit PAYE/WHT/VAT on time attracts a <strong>20% penalty</strong> on the unpaid amount per MRA regulations.
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setOpen(false)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors ${
                hasOverdue
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-amber-500 hover:bg-amber-600'
              }`}
            >
              Acknowledge
            </button>
            <a
              href="https://mra.mw"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              MRA Portal
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <p className="mt-3 text-center text-xs text-gray-400">
            This reminder shows once per session
          </p>
        </div>
      </div>
    </div>
  );
}
