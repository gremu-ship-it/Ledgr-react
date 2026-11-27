import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  BedDouble,
  ClipboardPlus,
  DoorOpen,
  Sparkles,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { BedStatusBadge } from '@/components/healthcare/BedStatusBadge';
import { formatCurrency } from '@/lib/formatters';
import { calculateBedNights } from '@/services/inpatientService';
import { patientDisplayName } from '@/lib/healthcare/format';
import type { BedStatus, HospitalBed } from '@/types/healthcare';

export interface BedCardProps {
  bed: HospitalBed;
  currency: string;
  canWrite: boolean;
  onAdmit: (bed: HospitalBed) => void;
  onTransfer: (bed: HospitalBed) => void;
  onDischarge: (bed: HospitalBed) => void;
  onCareLog: (bed: HospitalBed) => void;
  onStatusChange: (bed: HospitalBed, status: BedStatus) => void;
}

const CARD_STYLES: Record<BedStatus, string> = {
  available: 'border-emerald-200 bg-emerald-50/50',
  occupied: 'border-rose-200 bg-rose-50/40',
  cleaning: 'border-amber-200 bg-amber-50/50',
  maintenance: 'border-slate-300 bg-slate-50',
  reserved: 'border-sky-200 bg-sky-50/50',
};

/** One physical bed in the visual ward grid, with its available ADT actions. */
export function BedCard({
  bed,
  currency,
  canWrite,
  onAdmit,
  onTransfer,
  onDischarge,
  onCareLog,
  onStatusChange,
}: BedCardProps) {
  const { t } = useTranslation();
  const admission = bed.current_admission ?? null;
  const nights = useMemo(
    () => (admission ? calculateBedNights(admission.admitted_at, new Date()) : 0),
    [admission],
  );

  const iconButton =
    'inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <article className={`rounded-2xl border p-3 shadow-sm ${CARD_STYLES[bed.status]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 text-gray-600 ring-1 ring-inset ring-black/5">
            <BedDouble className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{bed.bed_number}</p>
            <p className="text-[11px] text-gray-500">
              {t('healthcare.wards.ratePerNight', {
                amount: formatCurrency(bed.daily_rate, currency),
              })}
            </p>
          </div>
        </div>
        <BedStatusBadge status={bed.status} />
      </div>

      {admission ? (
        <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 ring-1 ring-inset ring-black/5">
          <p className="truncate text-sm font-semibold text-gray-900">
            {patientDisplayName(admission.patient) || t('healthcare.inpatient.unknownPatient')}
          </p>
          <p className="text-[11px] text-gray-500">
            {admission.admission_number} · {admission.patient?.mrn ?? '-'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-gray-600">
            {t('healthcare.inpatient.losNights', { count: nights })}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-[11px] text-gray-500">
          {t('healthcare.wards.noPatient')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {bed.status === 'available' ? (
          <button
            type="button"
            onClick={() => onAdmit(bed)}
            disabled={!canWrite}
            className={iconButton}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.actions.admit')}
          </button>
        ) : null}

        {bed.status === 'occupied' ? (
          <>
            <button
              type="button"
              onClick={() => onCareLog(bed)}
              disabled={!canWrite}
              className={iconButton}
            >
              <ClipboardPlus className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.wards.actions.careLog')}
            </button>
            <button
              type="button"
              onClick={() => onTransfer(bed)}
              disabled={!canWrite}
              className={iconButton}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.wards.actions.transfer')}
            </button>
            <button
              type="button"
              onClick={() => onDischarge(bed)}
              disabled={!canWrite}
              className={iconButton}
            >
              <DoorOpen className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.wards.actions.discharge')}
            </button>
          </>
        ) : null}

        {bed.status === 'cleaning' ? (
          <button
            type="button"
            onClick={() => onStatusChange(bed, 'available')}
            disabled={!canWrite}
            className={iconButton}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.actions.markCleaned')}
          </button>
        ) : null}

        {bed.status === 'maintenance' ? (
          <button
            type="button"
            onClick={() => onStatusChange(bed, 'available')}
            disabled={!canWrite}
            className={iconButton}
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.actions.clearMaintenance')}
          </button>
        ) : null}

        {bed.status === 'available' || bed.status === 'reserved' ? (
          <button
            type="button"
            onClick={() => onStatusChange(bed, 'maintenance')}
            disabled={!canWrite}
            className={iconButton}
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.actions.maintenance')}
          </button>
        ) : null}
      </div>
    </article>
  );
}
