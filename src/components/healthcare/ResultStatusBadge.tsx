import { useTranslation } from 'react-i18next';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { ResultStatus } from '@/types/healthcare';

const STATUS_STYLES: Record<ResultStatus, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-600',
  normal: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  abnormal: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-red-300 bg-red-50 text-red-700',
};

const STATUS_ICONS = {
  pending: Clock,
  normal: CheckCircle2,
  abnormal: AlertTriangle,
  critical: AlertOctagon,
} as const;

/** Result classification pill used on worklists, result entry and reports. */
export function ResultStatusBadge({
  status,
  size = 'sm',
}: {
  status: ResultStatus;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const Icon = STATUS_ICONS[status];
  const label = t(`healthcare.lab.resultStatus.${status}`);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${STATUS_STYLES[status]} ${
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'
      }`}
      title={label}
    >
      <Icon className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} aria-hidden />
      {label}
    </span>
  );
}
