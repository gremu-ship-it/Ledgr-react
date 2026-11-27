import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { addInpatientCareLog } from '@/services/inpatientService';
import { useAppStore } from '@/store/useAppStore';
import { patientDisplayName } from '@/lib/healthcare/format';
import { CARE_LOG_LABEL_KEYS, CARE_LOG_TYPES } from '@/lib/healthcare/inpatient';
import type { CareLogType, InpatientCareLog, PatientAdmission } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

export interface InpatientCareLogModalProps {
  open: boolean;
  businessId: string | null;
  admission: PatientAdmission | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (log: InpatientCareLog) => void;
}

export function InpatientCareLogModal(props: InpatientCareLogModalProps) {
  if (!props.open) return null;
  return <InpatientCareLogModalBody key={props.admission?.id ?? 'none'} {...props} />;
}

function InpatientCareLogModalBody({
  businessId,
  admission,
  canWrite,
  onClose,
  onSaved,
}: InpatientCareLogModalProps) {
  const { t } = useTranslation();
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const [logType, setLogType] = useState<CareLogType>('doctor_round');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (!businessId || !admission) return;
    setError(null);
    if (!note.trim()) {
      setError(t('healthcare.inpatient.careLog.noteRequired'));
      return;
    }
    if (!userId) {
      setError(t('healthcare.inpatient.careLog.userRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const log = await addInpatientCareLog({
        businessId,
        admissionId: admission.id,
        recordedBy: userId,
        logType,
        note: note.trim(),
      });
      onSaved(log);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.inpatient.careLog.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="inpatient-care-log-title"
      title={t('healthcare.inpatient.careLog.title')}
      subtitle={t('healthcare.inpatient.careLog.subtitle')}
      closeLabel={t('healthcare.inpatient.close')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.inpatient.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <ClipboardPlus className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.inpatient.saving') : t('healthcare.inpatient.careLog.submit')}
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
            {admission?.admission_number} · {admission?.current_bed?.bed_number ?? '-'}
          </p>
        </div>

        <Field label={t('healthcare.inpatient.careLog.type')}>
          <select
            value={logType}
            onChange={(event) => setLogType(event.target.value as CareLogType)}
            className={INPUT_CLASS}
            disabled={!canWrite}
          >
            {CARE_LOG_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(CARE_LOG_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('healthcare.inpatient.careLog.note')}>
          <textarea
            rows={5}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={INPUT_CLASS}
            placeholder={t('healthcare.inpatient.careLog.notePlaceholder')}
            disabled={!canWrite}
          />
        </Field>

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
