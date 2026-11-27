import { useTranslation } from 'react-i18next';
import { ShieldCheck, UserRound, WalletCards } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import type { ClaimServiceCategory, SplitBillBreakdown } from '@/types/healthcare';

const CATEGORY_KEYS: Record<ClaimServiceCategory, string> = {
  consultation: 'healthcare.insurance.categories.consultation',
  medication: 'healthcare.insurance.categories.medication',
  laboratory: 'healthcare.insurance.categories.laboratory',
  procedure: 'healthcare.insurance.categories.procedure',
  accommodation: 'healthcare.insurance.categories.accommodation',
  other: 'healthcare.insurance.categories.other',
};

export interface SplitBillingCardProps {
  breakdown: SplitBillBreakdown;
  currency: string;
  copayPercent: number;
  onCopayPercentChange?: (value: number) => void;
  copayCap?: string;
  onCopayCapChange?: (value: string) => void;
  providerName?: string | null;
  disabled?: boolean;
}

/**
 * Live Patient vs Insurer liability card used by the billing station.
 * Inputs are controlled by the page so the same numbers can be posted to the
 * invoice and the claim without a second calculation.
 */
export function SplitBillingCard({
  breakdown,
  currency,
  copayPercent,
  onCopayPercentChange,
  copayCap = '',
  onCopayCapChange,
  providerName,
  disabled = false,
}: SplitBillingCardProps) {
  const { t } = useTranslation();
  const editable = Boolean(onCopayPercentChange) && !disabled;
  const theoreticalPatientShare =
    breakdown.totalGross * (Math.max(0, Math.min(100, copayPercent)) / 100);
  const capApplied = theoreticalPatientShare - breakdown.patientCopay > 0.009;

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <ShieldCheck className="h-4 w-4 text-indigo-600" aria-hidden />
            {t('healthcare.insurance.split.title')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">{t('healthcare.insurance.split.subtitle')}</p>
        </div>
        {providerName ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {providerName}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            {t('healthcare.insurance.split.copayPercent')}
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={Number.isFinite(copayPercent) ? copayPercent : 0}
              onChange={(event) => onCopayPercentChange?.(Number(event.target.value))}
              disabled={!editable}
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-500"
            />
            <span className="text-sm font-semibold text-gray-500">%</span>
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            {t('healthcare.insurance.split.copayCap')}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={copayCap}
            onChange={(event) => onCopayCapChange?.(event.target.value)}
            disabled={!editable}
            placeholder={t('healthcare.insurance.split.copayCapPlaceholder')}
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <span className="mt-1 block text-[11px] text-gray-400">
            {t('healthcare.insurance.split.copayCapHint')}
          </span>
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.insurance.totalBill')}
          </p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {formatCurrency(breakdown.totalGross, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            <UserRound className="h-3 w-3" aria-hidden />
            {t('healthcare.insurance.patientPortion')}
          </p>
          <p className="mt-1 text-lg font-semibold text-sky-900">
            {formatCurrency(breakdown.patientCopay, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            <WalletCards className="h-3 w-3" aria-hidden />
            {t('healthcare.insurance.insurerPortion')}
          </p>
          <p className="mt-1 text-lg font-semibold text-emerald-900">
            {formatCurrency(breakdown.insurerClaim, currency)}
          </p>
        </div>
      </div>

      {capApplied ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('healthcare.insurance.split.capApplied')}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <caption className="sr-only">{t('healthcare.insurance.split.breakdown')}</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th scope="col" className="px-2 py-2">{t('healthcare.insurance.split.service')}</th>
              <th scope="col" className="px-2 py-2 text-right">{t('healthcare.insurance.split.gross')}</th>
              <th scope="col" className="px-2 py-2 text-right">{t('healthcare.insurance.patientPortion')}</th>
              <th scope="col" className="px-2 py-2 text-right">{t('healthcare.insurance.insurerPortion')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {breakdown.items.map((item, index) => (
              <tr key={`${item.category}-${index}-${item.description}`}>
                <td className="px-2 py-2 text-gray-800">
                  <span className="mr-2 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                    {t(CATEGORY_KEYS[item.category])}
                  </span>
                  {item.description}
                </td>
                <td className="px-2 py-2 text-right text-gray-700">
                  {formatCurrency(item.grossAmount, currency)}
                </td>
                <td className="px-2 py-2 text-right text-sky-800">
                  {formatCurrency(item.patientShare, currency)}
                </td>
                <td className="px-2 py-2 text-right font-medium text-emerald-800">
                  {formatCurrency(item.insurerShare, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
