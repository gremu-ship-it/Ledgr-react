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
      <div className="w-full max-w-md rounded-2xl border border-line bg-card shadow-2xl">
        {/* Header */}
        <div className={`rounded-t-2xl px-5 py-4 ${
          hasOverdue ? 'bg-danger' : 'bg-warning'
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
                  d.isOverdue ? 'bg-danger/10 border border-danger/20' : 'bg-warning/12 border border-warning/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-semibold ${
                      d.isOverdue ? 'text-danger' : 'text-warning'
                    }`}>
                      {d.taxType}
                    </p>
                    <p className="text-xs text-muted">Period: {d.period}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${
                      d.isOverdue ? 'text-danger' : 'text-warning'
                    }`}>
                      {d.isOverdue
                        ? `${Math.abs(d.daysUntilDue)} days overdue`
                        : d.daysUntilDue === 0
                        ? 'Due TODAY'
                        : `Due in ${d.daysUntilDue} days`}
                    </p>
                    <p className="text-xs text-muted">{d.dueDateStr}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* MRA penalty warning */}
          {hasOverdue && (
            <div className="mt-3 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
              ⚠ Failure to remit PAYE/WHT/VAT on time attracts a <strong>20% penalty</strong> on the unpaid amount per MRA regulations.
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setOpen(false)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors ${
                hasOverdue
                  ? 'bg-danger hover:bg-danger'
                  : 'bg-warning hover:bg-warning'
              }`}
            >
              Acknowledge
            </button>
            <a
              href="https://mra.mw"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-sub hover:bg-bg transition-colors"
            >
              MRA Portal
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <p className="mt-3 text-center text-xs text-muted">
            This reminder shows once per session
          </p>
        </div>
      </div>
    </div>
  );
}
