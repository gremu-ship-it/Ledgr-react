import { AlertTriangle, CheckCircle, Clock, Calendar } from 'lucide-react';
import { getMraDueDates, useVatSummary, usePayeSummary } from '@/hooks/useTaxData';

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface TaxRemittancePanelProps {
  businessId: string;
}

export function TaxRemittancePanel({ businessId }: TaxRemittancePanelProps) {
  const dueDates = getMraDueDates();
  const vat = useVatSummary(businessId);
  const paye = usePayeSummary(businessId);

  const overdueDates = dueDates.filter((d) => d.isOverdue);
  const dueSoonDates = dueDates.filter((d) => !d.isOverdue && d.isDueSoon);
  
  const hasUrgent = overdueDates.length > 0 || dueSoonDates.length > 0;

  return (
    <div className={`mb-6 rounded-2xl border p-5 ${
      overdueDates.length > 0
        ? 'border-danger/20 bg-danger/10'
        : dueSoonDates.length > 0
        ? 'border-warning/20 bg-warning/12'
        : 'border-brand-100 bg-brand-500/10'
    }`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {overdueDates.length > 0 ? (
            <AlertTriangle className="h-5 w-5 text-danger" />
          ) : dueSoonDates.length > 0 ? (
            <Clock className="h-5 w-5 text-warning" />
          ) : (
            <Calendar className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          )}
          <h2 className="text-base font-semibold text-ink">
            MRA Tax Remittance
          </h2>
          {hasUrgent && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              overdueDates.length > 0
                ? 'bg-danger/10 text-danger'
                : 'bg-warning/12 text-warning'
            }`}>
              {overdueDates.length > 0
                ? `${overdueDates.length} overdue`
                : `${dueSoonDates.length} due soon`}
            </span>
          )}
        </div>
        <span className="text-xs text-muted">
          {new Date().toLocaleDateString('en-MW', { month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* VAT Summary */}
        <div className="rounded-xl border border-white/60 bg-card p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            VAT Position (Last Month)
          </p>
          {vat.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-surface" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-sub">
                <span>Output VAT (Sales)</span>
                <span className="font-medium">{formatMwk(vat.data?.outputVat ?? 0)}</span>
              </div>
              <div className="flex justify-between text-sub">
                <span>Input VAT (Expenses)</span>
                <span className="font-medium text-brand-600 dark:text-brand-300">
                  − {formatMwk(vat.data?.inputVat ?? 0)}
                </span>
              </div>
              <div className={`flex justify-between border-t border-line pt-1.5 font-semibold ${
                (vat.data?.vatPayable ?? 0) > 0 ? 'text-danger' : 'text-brand-600 dark:text-brand-300'
              }`}>
                <span>VAT Payable to MRA</span>
                <span>{formatMwk(vat.data?.vatPayable ?? 0)}</span>
              </div>
              <p className="text-xs text-muted">Period: {vat.data?.period ?? '—'}</p>
            </div>
          )}
        </div>

        {/* PAYE Summary */}
        <div className="rounded-xl border border-white/60 bg-card p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            PAYE Due (Last Month)
          </p>
          {paye.isLoading ? (
            <div className="h-4 animate-pulse rounded bg-surface" />
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-semibold text-danger">
                <span>Total PAYE to Remit</span>
                <span>{formatMwk(paye.data?.totalPaye ?? 0)}</span>
              </div>
              <p className="text-xs text-muted">Period: {paye.data?.period ?? '—'}</p>
              <p className="text-xs text-muted">
                Due: 14th of current month
              </p>
            </div>
          )}
        </div>

        {/* Due Dates */}
        <div className="rounded-xl border border-white/60 bg-card p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Upcoming Due Dates
          </p>
          <div className="space-y-2">
            {dueDates.slice(0, 4).map((d) => (
              <div key={d.taxType} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  {d.isOverdue ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                  ) : d.isDueSoon ? (
                    <Clock className="h-3.5 w-3.5 text-warning" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5 text-muted/50" />
                  )}
                  <span className={`font-medium ${
                    d.isOverdue ? 'text-danger' : d.isDueSoon ? 'text-warning' : 'text-sub'
                  }`}>
                    {d.taxType}
                  </span>
                </div>
                <div className="text-right">
                  <p className={`text-xs font-semibold ${
                    d.isOverdue ? 'text-danger' : d.isDueSoon ? 'text-warning' : 'text-muted'
                  }`}>
                    {d.isOverdue
                      ? `${Math.abs(d.daysUntilDue)}d overdue`
                      : d.daysUntilDue === 0
                      ? 'Due today!'
                      : `${d.daysUntilDue}d left`}
                  </p>
                  <p className="text-xs text-muted">{d.dueDateStr}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
