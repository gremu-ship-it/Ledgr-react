import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { transferPatientBed } from '@/services/inpatientService';
import { formatCurrency } from '@/lib/formatters';
import { patientDisplayName } from '@/lib/healthcare/format';
import type { HospitalWard, PatientAdmission } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

export interface TransferBedModalProps {
  open: boolean;
  businessId: string | null;
  admission: PatientAdmission | null;
  wards: HospitalWard[];
  currency: string;
  canWrite: boolean;
  onClose: () => void;
  onTransferred: (admission: PatientAdmission) => void;
}

export function TransferBedModal(props: TransferBedModalProps) {
  if (!props.open) return null;
  return <TransferBedModalBody key={props.admission?.id ?? 'none'} {...props} />;
}

function TransferBedModalBody({
  businessId,
  admission,
  wards,
  currency,
  canWrite,
  onClose,
  onTransferred,
}: TransferBedModalProps) {
  const { t } = useTranslation();
  const [newBedId, setNewBedId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currentBed = admission?.current_bed ?? null;
  const availableBeds = useMemo(
    () =>
      wards.flatMap((ward) =>
        (ward.beds ?? [])
          .filter((bed) => bed.status === 'available' && bed.id !== currentBed?.id)
          .map((bed) => ({ bed, ward })),
      ),
    [currentBed?.id, wards],
  );

  const submit = async () => {
    if (!businessId || !admission) return;
    setError(null);
    if (!newBedId) {
      setError(t('healthcare.inpatient.transfer.bedRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const updated = await transferPatientBed({
        businessId,
        admissionId: admission.id,
        newBedId,
        reason: reason.trim() || null,
      });
      onTransferred(updated);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.inpatient.transfer.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="transfer-bed-title"
      title={t('healthcare.inpatient.transfer.title')}
      subtitle={t('healthcare.inpatient.transfer.subtitle')}
      closeLabel={t('healthcare.inpatient.close')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.inpatient.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.inpatient.saving') : t('healthcare.inpatient.transfer.submit')}
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
            {admission?.admission_number} ·{' '}
            {currentBed
              ? t('healthcare.inpatient.transfer.currentBed', {
                  bed: currentBed.bed_number,
                  rate: formatCurrency(currentBed.daily_rate, currency),
                })
              : t('healthcare.inpatient.transfer.noBed')}
          </p>
        </div>

        <div className="grid gap-3">
          <Field label={t('healthcare.inpatient.transfer.newBed')}>
            <select
              value={newBedId}
              onChange={(event) => setNewBedId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
              autoFocus
            >
              <option value="">{t('healthcare.inpatient.transfer.selectBed')}</option>
              {availableBeds.map(({ bed, ward }) => (
                <option key={bed.id} value={bed.id}>
                  {ward.name} · {bed.bed_number} ·{' '}
                  {formatCurrency(bed.daily_rate, currency)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.inpatient.transfer.reason')}>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.inpatient.transfer.reasonPlaceholder')}
              disabled={!canWrite}
            />
          </Field>
        </div>

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
