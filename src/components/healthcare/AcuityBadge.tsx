import { useTranslation } from 'react-i18next';
import { AlertOctagon, AlertTriangle, ArrowUp, Circle } from 'lucide-react';
import type { AcuityLevel } from '@/types/healthcare';

const ACUITY_STYLES: Record<AcuityLevel, string> = {
  emergency: 'border-red-300 bg-red-50 text-red-800',
  urgent: 'border-amber-300 bg-amber-50 text-amber-900',
  priority: 'border-yellow-300 bg-yellow-50 text-yellow-900',
  routine: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};

const ACUITY_DOT: Record<AcuityLevel, string> = {
  emergency: 'bg-red-600',
  urgent: 'bg-amber-500',
  priority: 'bg-yellow-400',
  routine: 'bg-emerald-500',
};

const ACUITY_ICON: Record<AcuityLevel, typeof AlertOctagon> = {
  emergency: AlertOctagon,
  urgent: AlertTriangle,
  priority: ArrowUp,
  routine: Circle,
};

/** Colour-coded triage acuity: red / amber / yellow / green. */
export function AcuityBadge({
  acuity,
  showIcon = true,
  className = '',
}: {
  acuity: AcuityLevel | string | null | undefined;
  showIcon?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const known = (['emergency', 'urgent', 'priority', 'routine'] as const).includes(
    acuity as AcuityLevel,
  );
  const level = (known ? acuity : 'routine') as AcuityLevel;
  const Icon = ACUITY_ICON[level];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        known ? ACUITY_STYLES[level] : 'border-gray-200 bg-gray-50 text-gray-500'
      } ${className}`}
      title={t('healthcare.acuity.hint')}
    >
      {showIcon ? (
        <Icon className="h-3 w-3" aria-hidden />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${ACUITY_DOT[level]}`} aria-hidden />
      )}
      {known ? t(`healthcare.acuity.${level}`) : t('healthcare.acuity.unknown')}
    </span>
  );
}
