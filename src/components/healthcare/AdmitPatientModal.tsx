import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, Field } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { admitPatientToBed } from '@/services/inpatientService';
import { patientDisplayName } from '@/lib/healthcare/format';
import type { PatientVisit } from '@/services/healthcareService';
import type { ClinicDoctor, HospitalWard, PatientAdmission } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-500';

export interface AdmitPatientModalProps {
  open: boolean;
  businessId: string | null;
  wards: HospitalWard[];
  visits: PatientVisit[];
  doctors: ClinicDoctor[];
  canWrite: boolean;
  preselectedBedId?: string | null;
  onClose: () => void;
  onAdmitted: (admission: PatientAdmission) => void;
}

export function AdmitPatientModal(props: AdmitPatientModalProps) {
  if (!props.open) return null;
  return (
    <AdmitPatientModalBody
      key={`${props.preselectedBedId ?? 'first'}-${props.open ? 'open' : 'closed'}`}
      {...props}
    />
  );
}

function AdmitPatientModalBody({
  businessId,
  wards,
  visits,
  doctors,
  canWrite,
  preselectedBedId,
  onClose,
  onAdmitted,
}: AdmitPatientModalProps) {
  const { t } = useTranslation();
  const [visitId, setVisitId] = useState('');
  const [bedId, setBedId] = useState(preselectedBedId ?? '');
  const [admittingDoctorId, setAdmittingDoctorId] = useState(doctors[0]?.id ?? '');
  const [attendingDoctorId, setAttendingDoctorId] = useState(doctors[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const availableBeds = useMemo(
    () =>
      wards.flatMap((ward) =>
        (ward.beds ?? [])
          .filter((bed) => bed.status === 'available')
          .map((bed) => ({ bed, ward })),
      ),
    [wards],
  );

  const selectedVisit = useMemo(
    () => visits.find((visit) => visit.id === visitId) ?? null,
    [visitId, visits],
  );

  const submit = async () => {
    if (!businessId) return;
    setError(null);
    if (!selectedVisit?.id || !selectedVisit.patient_id) {
      setError(t('healthcare.inpatient.admit.patientRequired'));
      return;
    }
    if (!bedId) {
      setError(t('healthcare.inpatient.admit.bedRequired'));
      return;
    }
    if (!admittingDoctorId || !attendingDoctorId) {
      setError(t('healthcare.inpatient.admit.doctorRequired'));
      return;
    }
    if (!reason.trim()) {
      setError(t('healthcare.inpatient.admit.reasonRequired'));
      return;
    }

    setIsSaving(true);
    try {
      const admission = await admitPatientToBed({
        businessId,
        visitId: selectedVisit.id,
        patientId: selectedVisit.patient_id,
        bedId,
        admittingDoctorId,
        attendingDoctorId,
        admissionReason: reason.trim(),
        expectedDischargeDate: expectedDate || null,
      });
      onAdmitted(admission);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.inpatient.admit.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="admit-patient-title"
      title={t('healthcare.inpatient.admit.title')}
      subtitle={t('healthcare.inpatient.admit.subtitle')}
      closeLabel={t('healthcare.inpatient.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('healthcare.inpatient.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} isLoading={isSaving} disabled={!canWrite}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {isSaving ? t('healthcare.inpatient.saving') : t('healthcare.inpatient.admit.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('healthcare.inpatient.admit.visit')} className="sm:col-span-2">
            <select
              value={visitId}
              onChange={(event) => setVisitId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
              autoFocus
            >
              <option value="">{t('healthcare.inpatient.admit.selectVisit')}</option>
              {visits.map((visit) => (
                <option key={visit.id} value={visit.id}>
                  {visit.visit_number} · {patientDisplayName(visit.patient)} ·{' '}
                  {visit.patient?.mrn ?? '-'}
                </option>
              ))}
            </select>
          </Field>

          {selectedVisit ? (
            <div className="sm:col-span-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-800">
              {t('healthcare.inpatient.admit.selectedPatient', {
                name: patientDisplayName(selectedVisit.patient),
                mrn: selectedVisit.patient?.mrn ?? '-',
              })}
            </div>
          ) : null}

          <Field label={t('healthcare.inpatient.admit.bed')}>
            <select
              value={bedId}
              onChange={(event) => setBedId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              <option value="">{t('healthcare.inpatient.admit.selectBed')}</option>
              {availableBeds.map(({ bed, ward }) => (
                <option key={bed.id} value={bed.id}>
                  {ward.name} · {bed.bed_number}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.inpatient.admit.expectedDischarge')}>
            <input
              type="date"
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            />
          </Field>
          <Field label={t('healthcare.inpatient.admit.admittingDoctor')}>
            <select
              value={admittingDoctorId}
              onChange={(event) => setAdmittingDoctorId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              <option value="">{t('healthcare.inpatient.admit.selectDoctor')}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.inpatient.admit.attendingDoctor')}>
            <select
              value={attendingDoctorId}
              onChange={(event) => setAttendingDoctorId(event.target.value)}
              className={INPUT_CLASS}
              disabled={!canWrite}
            >
              <option value="">{t('healthcare.inpatient.admit.selectDoctor')}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('healthcare.inpatient.admit.reason')} className="sm:col-span-2">
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('healthcare.inpatient.admit.reasonPlaceholder')}
              disabled={!canWrite}
            />
          </Field>
        </div>

        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </HealthcareModal>
  );
}
