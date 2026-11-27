import { useTranslation } from 'react-i18next';
import type { BedStatus } from '@/types/healthcare';

const BED_STATUS_STYLES: Record<BedStatus, string> = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  occupied: 'border-rose-200 bg-rose-50 text-rose-700',
  cleaning: 'border-amber-200 bg-amber-50 text-amber-800',
  maintenance: 'border-slate-300 bg-slate-100 text-slate-700',
  reserved: 'border-sky-200 bg-sky-50 text-sky-700',
};

export function BedStatusBadge({ status }: { status: BedStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${BED_STATUS_STYLES[status]}`}
    >
      {t(`healthcare.wards.status.${status}`)}
    </span>
  );
}
