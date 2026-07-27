import { AlertTriangle, Clock, CheckCircle2, Calendar, FileText, Banknote } from 'lucide-react';
import type { TaxObligation, UrgencyLevel } from '@/hooks/useTaxObligations';
import { formatCurrencyAmount } from '@/lib/currency';

const URGENCY_STYLES: Record<UrgencyLevel, {
  border: string; bg: string; badge: string; text: string; icon: typeof AlertTriangle;
}> = {
  overdue:  { border: 'border-red-200',   bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',       text: 'text-red-700',   icon: AlertTriangle },
  critical: { border: 'border-red-200',   bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700',       text: 'text-red-700',   icon: AlertTriangle },
  soon:     { border: 'border-amber-200', bg: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700',   text: 'text-amber-700', icon: Clock },
  upcoming: { border: 'border-gray-200',  bg: 'bg-white',     badge: 'bg-gray-100 text-gray-600',     text: 'text-gray-600',  icon: Calendar },
  settled:  { border: 'border-brand-100', bg: 'bg-brand-50',  badge: 'bg-brand-100 text-brand-700',   text: 'text-brand-700', icon: CheckCircle2 },
};

function daysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days} days remaining`;
}

export function TaxObligationCard({
  obligation,
  currency,
  onRecordPayment,
  onMarkFiled,
  onPostJournal,
  onViewReturn,
}: {
  obligation: TaxObligation;
  currency: string;
  onRecordPayment: (o: TaxObligation) => void;
  onMarkFiled: (o: TaxObligation) => void;
  onPostJournal: (o: TaxObligation) => void;
  onViewReturn: (o: TaxObligation) => void;
}) {
  const style = URGENCY_STYLES[obligation.urgency];
  const Icon = style.icon;
  const tr = obligation.taxReturn;
  const isPosted = Boolean(tr.journal_entry_id);

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} p-5 shadow-sm transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{obligation.label}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
              {obligation.authority}
            </span>
            {obligation.isFiled && (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                Filed
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-gray-500">
            {obligation.periodDisplay}
            {obligation.formName && ` · ${obligation.formName}`}
          </p>
        </div>
        <div className={`flex shrink-0 items-center gap-1.5 ${style.text}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-semibold">{daysLabel(obligation.daysRemaining)}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {obligation.isCredit ? 'Refund due' : 'Amount owed'}
          </p>
          <p className={`mt-0.5 text-lg font-semibold ${obligation.isCredit ? 'text-brand-700' : 'text-gray-900'}`}>
            {formatCurrencyAmount(
              obligation.isCredit ? Math.abs(Number(tr.amount_due)) : obligation.outstanding,
              currency,
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Due date</p>
          <p className="mt-0.5 text-sm font-medium text-gray-900">{obligation.dueDateDisplay}</p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
          <p className="mt-0.5 text-sm font-medium capitalize text-gray-900">
            {tr.status}
            {Number(tr.amount_paid) > 0 && !obligation.isPaid && (
              <span className="ml-1 text-xs text-gray-500">
                ({formatCurrencyAmount(Number(tr.amount_paid), currency)} paid)
              </span>
            )}
          </p>
        </div>
      </div>

      {tr.tax_code === 'vat_standard' && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-black/5 pt-3 text-xs text-gray-600">
          <span>Output tax: <strong className="text-gray-900">{formatCurrencyAmount(Number(tr.output_tax), currency)}</strong></span>
          <span>Input tax: <strong className="text-gray-900">{formatCurrencyAmount(Number(tr.input_tax), currency)}</strong></span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onViewReturn(obligation)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          View return
        </button>

        {!isPosted && !obligation.isCredit && (
          <button
            onClick={() => onPostJournal(obligation)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Post to journal
          </button>
        )}

        {!obligation.isFiled && (
          <button
            onClick={() => onMarkFiled(obligation)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Mark as filed
          </button>
        )}

        {!obligation.isPaid && !obligation.isCredit && (
          <button
            onClick={() => onRecordPayment(obligation)}
            disabled={!isPosted}
            title={isPosted ? undefined : 'Post the liability to the journal first'}
            className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
            Mark as paid
          </button>
        )}
      </div>
    </div>
  );
}
