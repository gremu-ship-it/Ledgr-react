import { useTranslation } from 'react-i18next';
import type { ClaimStatus } from '@/types/healthcare';

const STATUS_STYLES: Record<ClaimStatus, string> = {
  draft: 'border-gray-200 bg-gray-50 text-gray-700',
  submitted: 'border-sky-200 bg-sky-50 text-sky-700',
  under_review: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
  settled: 'border-teal-200 bg-teal-50 text-teal-700',
  disputed: 'border-violet-200 bg-violet-50 text-violet-700',
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus | string }) {
  const { t } = useTranslation();
  const safeStatus: ClaimStatus = status in STATUS_STYLES ? (status as ClaimStatus) : 'draft';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[safeStatus]}`}
    >
      {t(`healthcare.insurance.status.${safeStatus}`)}
    </span>
  );
}
