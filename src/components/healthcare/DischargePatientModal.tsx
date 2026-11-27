import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DoorOpen, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import {
  calculateInpatientStayCharges,
  dischargePatient,
} from '@/services/inpatientService';
import { formatCurrency } from '@/lib/formatters';
import { patientDisplayName } from '@/lib/healthcare/format';
import {
  DISCHARGE_CONDITIONS,
  DISCHARGE_CONDITION_LABEL_KEYS,
} from '@/lib/healthcare/inpatient';
import type { DischargeCondition, PatientAdmission } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

export interface DischargePatientModalProps {
  open: boolean;
  businessId: string | null;
  admission: PatientAdmission | null;
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onDischarged: (admission: PatientAdmission) => void;
}

export function DischargePatientModal(props: DischargePatientModalProps) {
  if (!props.open) return null;
  return <DischargePatientModalBody key={props.admission?.id ?? 'none'} {...props} />;
}

function DischargePatientModalBody({
  businessId,
  admission,
  currency,
  canWrite,
  onClose,
  onDischarged,
}: DischargePatientModalProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState('');
  const [condition, setCondition] = useState<DischargeCondition>('stable');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const chargesQuery = useQuery({
    queryKey: ['healthcare', 'inpatient', 'stay-charges', businessId, admission?.id],
    queryFn: () =>
      calculateInpatientStayCharges(businessId as string, admission?.id as string),
    enabled: Boolean(businessId && admission?.id),
    staleTime: 5_000,
  });

  const charges = useMemo(() => chargesQuery.data ?? [], [chargesQuery.data]);
  const total = useMemo(
    () => charges.reduce((sum, charge) => sum + charge.totalCharge, 0),
    [charges],
  );
  const nights = useMemo(
    () => charges.reduce((sum, charge) => sum + charge.nights, 0),
    [charges],
  );

  const submit = async () => {
    if (!businessId || !admission) return;
    setError(null);
    if (!summary.trim()) {
      setError(t('healthcare.inpatient.discharge.summaryRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const discharged = await dischargePatient({
        businessId,
        admissionId: admission.id,
        dischargeSummary: summary.trim(),
        dischargeCondition: condition,
      });
      onDischarged(discharged);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.inpatient.discharge.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="discharge-patient-title"
      title={t('healthcare.inpatient.discharge.title')}
      subtitle={t('healthcare.inpatient.discharge.subtitle')}
      closeLabel={t('healthcare.inpatient.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.inpatient.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <DoorOpen className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.inpatient.saving') : t('healthcare.inpatient.discharge.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">
            {patientDisplayName(admission?.patient) || t('healthcare.inpatient.unknownPatient')}
          </p>
          <p className="text-xs text-gray-500">
            {admission?.admission_number} · {admission?.current_bed?.bed_number ?? '-'} ·{' '}
            {t('healthcare.inpatient.losNights', { count: nights })}
          </p>
        </div>

        {chargesQuery.isLoading ? (
          <LoadingNotice label={t('healthcare.inpatient.discharge.loadingCharges')} />
        ) : (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-800">
              <ReceiptText className="h-4 w-4" aria-hidden />
              {t('healthcare.inpatient.discharge.chargesTitle')}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-sky-900">
              {charges.map((charge, index) => (
                <li key={`${charge.bedNumber}-${index}`} className="flex justify-between gap-2">
                  <span>
                    {charge.wardName} · {charge.bedNumber} ·{' '}
                    {t('healthcare.inpatient.nightsAtRate', {
                      count: charge.nights,
                      rate: formatCurrency(charge.dailyRate, currency),
                    })}
                  </span>
                  <span className="font-semibold">
                    {formatCurrency(charge.totalCharge, currency)}
                  </span>
                </li>
              ))}
              {charges.length === 0 ? (
                <li className="text-sky-700">{t('healthcare.inpatient.discharge.noCharges')}</li>
              ) : null}
            </ul>
            <p className="mt-2 flex justify-between border-t border-sky-200 pt-2 text-sm font-semibold text-sky-900">
              <span>{t('healthcare.inpatient.discharge.total')}</span>
              <span>{formatCurrency(total, currency)}</span>
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.inpatient.discharge.condition')}>
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value as DischargeCondition)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              {DISCHARGE_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {t(DISCHARGE_CONDITION_LABEL_KEYS[value])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.inpatient.discharge.summary')} className="sm:col-span-2">
            <textarea
              rows={4}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.inpatient.discharge.summaryPlaceholder')}
              disabled={!canWrite}
            />
          </Field>
        </div>

        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('healthcare.inpatient.discharge.billingHint')}
        </p>

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
