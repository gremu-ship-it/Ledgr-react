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
  const _upcomingDates = dueDates.filter((d) => !d.isOverdue && !d.isDueSoon);

  const hasUrgent = overdueDates.length > 0 || dueSoonDates.length > 0;

  return (
    <div className={`mb-6 rounded-2xl border p-5 ${
      overdueDates.length > 0
        ? 'border-red-200 bg-red-50'
        : dueSoonDates.length > 0
        ? 'border-amber-200 bg-amber-50'
        : 'border-brand-100 bg-brand-50'
    }`}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {overdueDates.length > 0 ? (
            <AlertTriangle className="h-5 w-5 text-red-500" />
          ) : dueSoonDates.length > 0 ? (
            <Clock className="h-5 w-5 text-amber-500" />
          ) : (
            <Calendar className="h-5 w-5 text-brand-500" />
          )}
          <h2 className="text-base font-semibold text-gray-900">
            MRA Tax Remittance
          </h2>
          {hasUrgent && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              overdueDates.length > 0
                ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {overdueDates.length > 0
                ? `${overdueDates.length} overdue`
                : `${dueSoonDates.length} due soon`}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {new Date().toLocaleDateString('en-MW', { month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* VAT Summary */}
        <div className="rounded-xl border border-white/60 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            VAT Position (Last Month)
          </p>
          {vat.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Output VAT (Sales)</span>
                <span className="font-medium">{formatMwk(vat.data?.outputVat ?? 0)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Input VAT (Expenses)</span>
                <span className="font-medium text-brand-600">
                  − {formatMwk(vat.data?.inputVat ?? 0)}
                </span>
              </div>
              <div className={`flex justify-between border-t border-gray-100 pt-1.5 font-semibold ${
                (vat.data?.vatPayable ?? 0) > 0 ? 'text-red-600' : 'text-brand-600'
              }`}>
                <span>VAT Payable to MRA</span>
                <span>{formatMwk(vat.data?.vatPayable ?? 0)}</span>
              </div>
              <p className="text-xs text-gray-400">Period: {vat.data?.period ?? '—'}</p>
            </div>
          )}
        </div>

        {/* PAYE Summary */}
        <div className="rounded-xl border border-white/60 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            PAYE Due (Last Month)
          </p>
          {paye.isLoading ? (
            <div className="h-4 animate-pulse rounded bg-gray-100" />
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-semibold text-red-600">
                <span>Total PAYE to Remit</span>
                <span>{formatMwk(paye.data?.totalPaye ?? 0)}</span>
              </div>
              <p className="text-xs text-gray-400">Period: {paye.data?.period ?? '—'}</p>
              <p className="text-xs text-gray-400">
                Due: 14th of current month
              </p>
            </div>
          )}
        </div>

        {/* Due Dates */}
        <div className="rounded-xl border border-white/60 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Upcoming Due Dates
          </p>
          <div className="space-y-2">
            {dueDates.slice(0, 4).map((d) => (
              <div key={d.taxType} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  {d.isOverdue ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  ) : d.isDueSoon ? (
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5 text-gray-300" />
                  )}
                  <span className={`font-medium ${
                    d.isOverdue ? 'text-red-700' : d.isDueSoon ? 'text-amber-700' : 'text-gray-700'
                  }`}>
                    {d.taxType}
                  </span>
                </div>
                <div className="text-right">
                  <p className={`text-xs font-semibold ${
                    d.isOverdue ? 'text-red-600' : d.isDueSoon ? 'text-amber-600' : 'text-gray-500'
                  }`}>
                    {d.isOverdue
                      ? `${Math.abs(d.daysUntilDue)}d overdue`
                      : d.daysUntilDue === 0
                      ? 'Due today!'
                      : `${d.daysUntilDue}d left`}
                  </p>
                  <p className="text-xs text-gray-400">{d.dueDateStr}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
