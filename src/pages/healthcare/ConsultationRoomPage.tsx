import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ClipboardList,
  FlaskConical,
  Pill,
  Plus,
  Search,
  Stethoscope,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  BillingTypeBadge,
  ErrorNotice,
  Field,
  LoadingNotice,
  StageBadge,
} from '@/components/healthcare/healthcareUi';
import { TriageVitalsModal } from '@/components/healthcare/TriageVitalsModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import {
  advanceVisitStage,
  calculateBmi,
  checkInPatientVisit,
  findAllergyWarnings,
  getConsultationForVisit,
  getPatient,
  getPatientVisit,
  getVisitLabOrders,
  getVisitPrescriptions,
  listOpenVisits,
  saveConsultation,
  saveVisitLabOrder,
  saveVisitPrescription,
  searchMedications,
  type ConsultationRecord,
  type LabOrderItemInput,
  type LabOrderRecord,
  type PatientRecord,
  type PatientVisit,
  type PrescriptionRecord,
} from '@/services/healthcareService';
import {
  calculateAge,
  formatDateValue,
  hasVitals,
  patientDisplayName,
} from '@/lib/healthcare/format';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';
const TABLE_INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const QUICK_TESTS = [
  { code: 'FBC', name: 'Full Blood Count (FBC)', labelKey: 'healthcare.consultation.testFbc', price: 8000 },
  { code: 'MRDT', name: 'Malaria RDT', labelKey: 'healthcare.consultation.testMalaria', price: 3000 },
  { code: 'URINE', name: 'Urinalysis', labelKey: 'healthcare.consultation.testUrinalysis', price: 5000 },
  { code: 'RBS', name: 'Random Blood Sugar', labelKey: 'healthcare.consultation.testBloodSugar', price: 2500 },
] as const;

interface RxDraft {
  key: string;
  product_id: string | null;
  medication_name: string;
  dosage: string;
  frequency: string;
  duration_days: string;
  quantity: string;
  unit_price: string;
  instructions: string;
}

let draftKeySeed = 0;
function nextDraftKey(prefix: string): string {
  draftKeySeed += 1;
  return `${prefix}-${draftKeySeed}`;
}

function emptyRxDraft(): RxDraft {
  return {
    key: nextDraftKey('rx'),
    product_id: null,
    medication_name: '',
    dosage: '',
    frequency: '',
    duration_days: '5',
    quantity: '1',
    unit_price: '0',
    instructions: '',
  };
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Consultation room shell: resolves the visit, then mounts the clinical editor. */
export function ConsultationRoomPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const visitId = searchParams.get('visitId');
  const patientId = searchParams.get('patientId');

  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const { canWrite } = usePermissions();
  const [triageVisit, setTriageVisit] = useState<PatientVisit | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [startingVisit, setStartingVisit] = useState(false);

  const visitsQuery = useQuery({
    queryKey: ['healthcare', 'openVisits', businessId],
    queryFn: () => listOpenVisits(businessId as string),
    enabled: Boolean(businessId) && !visitId,
    staleTime: 10_000,
  });

  const visitQuery = useQuery({
    queryKey: ['healthcare', 'visit', businessId, visitId],
    queryFn: () => getPatientVisit(businessId as string, visitId as string),
    enabled: Boolean(businessId && visitId),
    staleTime: 10_000,
  });

  const patientQuery = useQuery({
    queryKey: ['healthcare', 'patient', businessId, patientId],
    queryFn: () => getPatient(businessId as string, patientId as string),
    enabled: Boolean(businessId && patientId && !visitId),
    staleTime: 30_000,
  });

  const consultationQuery = useQuery({
    queryKey: ['healthcare', 'consultation', visitId],
    queryFn: () => getConsultationForVisit(businessId as string, visitId as string),
    enabled: Boolean(businessId && visitId),
    staleTime: 10_000,
  });

  const prescriptionsQuery = useQuery({
    queryKey: ['healthcare', 'prescriptions', visitId],
    queryFn: () => getVisitPrescriptions(businessId as string, visitId as string),
    enabled: Boolean(businessId && visitId),
    staleTime: 10_000,
  });

  const labOrdersQuery = useQuery({
    queryKey: ['healthcare', 'labOrders', visitId],
    queryFn: () => getVisitLabOrders(businessId as string, visitId as string),
    enabled: Boolean(businessId && visitId),
    staleTime: 10_000,
  });

  const visit = visitQuery.data
    ?? visitsQuery.data?.find((candidate) => candidate.id === visitId)
    ?? null;

  const invalidateVisit = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'visit', businessId, visitId] }),
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'consultation', visitId] }),
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'prescriptions', visitId] }),
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'labOrders', visitId] }),
    ]);
  };

  const startVisit = async (patient: PatientRecord) => {
    if (!businessId || !patient.id) return;
    setStartError(null);
    setStartingVisit(true);
    try {
      const created = await checkInPatientVisit(businessId, patient.id, 'outpatient');
      if (created.id) {
        setSearchParams({ visitId: created.id });
      }
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : t('healthcare.consultation.startVisitError'),
      );
    } finally {
      setStartingVisit(false);
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  // A patient was opened from the directory but has not been checked in yet.
  if (!visitId && patientId) {
    const patient = patientQuery.data ?? null;
    return (
      <div className="mx-auto max-w-[720px] px-4 py-10">
        <Link to="/healthcare/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('healthcare.consultation.backToPatients')}
        </Link>
        {patientQuery.isLoading && <LoadingNotice label={t('healthcare.consultation.loading')} />}
        {patientQuery.isError && <ErrorNotice message={t('healthcare.consultation.patientNotFound')} />}
        {patient && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold text-gray-900">{patientDisplayName(patient)}</h1>
            <p className="mt-1 font-mono text-xs text-gray-500">{patient.mrn}</p>
            <p className="mt-3 text-sm text-gray-600">{t('healthcare.consultation.noActiveVisit')}</p>
            {startError && <div className="mt-3"><ErrorNotice message={startError} /></div>}
            <Button
              className="mt-4"
              isLoading={startingVisit}
              disabled={!canWrite}
              onClick={() => void startVisit(patient)}
            >
              <Stethoscope className="h-4 w-4" aria-hidden />
              {startingVisit ? t('healthcare.consultation.startingVisit') : t('healthcare.consultation.startVisit')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!visitId) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-6">
        <header className="mb-4 flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Stethoscope className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.consultation.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.consultation.selectVisitHint')}</p>
          </div>
        </header>

        {visitsQuery.isLoading && <LoadingNotice label={t('healthcare.consultation.loading')} />}
        {visitsQuery.isError && (
          <ErrorNotice
            message={
              visitsQuery.error instanceof Error
                ? visitsQuery.error.message
                : t('healthcare.consultation.loadError')
            }
          />
        )}
        {visitsQuery.isSuccess && (visitsQuery.data ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
            <p className="mt-2 text-sm font-medium text-gray-700">{t('healthcare.consultation.noOpenVisits')}</p>
            <Link to="/healthcare/patients" className="mt-4 inline-flex text-sm font-semibold text-brand-700 hover:underline">
              {t('healthcare.consultation.goToPatients')}
            </Link>
          </div>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {(visitsQuery.data ?? []).map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => candidate.id && setSearchParams({ visitId: candidate.id })}
                className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300 hover:ring-2 hover:ring-brand-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {patientDisplayName(candidate.patient)}
                  </span>
                  <StageBadge stage={candidate.stage} />
                </div>
                <p className="mt-1 font-mono text-[11px] text-gray-500">
                  {candidate.patient?.mrn ?? '—'} · {candidate.visit_number}
                </p>
                <p className="mt-2 text-[11px] text-gray-400">
                  {t(`healthcare.visitType.${candidate.visit_type}`)} · {formatDateValue(candidate.visit_date)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (visitQuery.isLoading) {
    return <div className="mx-auto max-w-[1200px] px-4 py-6"><LoadingNotice label={t('healthcare.consultation.loading')} /></div>;
  }
  if (visitQuery.isError || !visit) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice
          message={
            visitQuery.error instanceof Error
              ? visitQuery.error.message
              : t('healthcare.consultation.loadError')
          }
        />
      </div>
    );
  }

  const clinicalDataReady =
    consultationQuery.isSuccess && prescriptionsQuery.isSuccess && labOrdersQuery.isSuccess;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <Link to="/healthcare" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('healthcare.consultation.backToHub')}
      </Link>

      {statusMessage && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {statusMessage}
        </p>
      )}

      {clinicalDataReady ? (
        <ConsultationEditor
          businessId={businessId}
          visit={visit}
          consultation={consultationQuery.data ?? null}
          prescriptions={prescriptionsQuery.data ?? []}
          labOrders={labOrdersQuery.data ?? []}
          canWrite={canWrite}
          onRecordVitals={() => setTriageVisit(visit)}
          onSaved={async (message) => {
            setStatusMessage(message);
            await invalidateVisit();
          }}
        />
      ) : (
        <LoadingNotice
          label={
            consultationQuery.isError || prescriptionsQuery.isError || labOrdersQuery.isError
              ? t('healthcare.consultation.loadError')
              : t('healthcare.consultation.loading')
          }
        />
      )}

      {triageVisit && (
        <TriageVitalsModal
          visit={triageVisit}
          onClose={() => setTriageVisit(null)}
          onSaved={async () => {
            setTriageVisit(null);
            await invalidateVisit();
          }}
        />
      )}
    </div>
  );
}

interface ConsultationEditorProps {
  businessId: string;
  visit: PatientVisit;
  consultation: ConsultationRecord | null;
  prescriptions: PrescriptionRecord[];
  labOrders: LabOrderRecord[];
  canWrite: boolean;
  onRecordVitals: () => void;
  onSaved: (message: string) => Promise<void>;
}

function ConsultationEditor({
  businessId,
  visit,
  consultation,
  prescriptions,
  labOrders,
  canWrite,
  onRecordVitals,
  onSaved,
}: ConsultationEditorProps) {
  const { t } = useTranslation();
  const doctorId = useAppStore((state) => state.currentUser?.id ?? null);
  const patient = visit.patient ?? null;

  const [consultationId, setConsultationId] = useState<string | null>(consultation?.id ?? null);
  const [chiefComplaint, setChiefComplaint] = useState(consultation?.chief_complaint ?? '');
  const [history, setHistory] = useState(consultation?.history_of_present_illness ?? '');
  const [examination, setExamination] = useState(consultation?.physical_examination ?? '');
  const [diagnosis, setDiagnosis] = useState(consultation?.diagnosis ?? '');
  const [icd10, setIcd10] = useState(consultation?.icd10_code ?? '');
  const [treatmentPlan, setTreatmentPlan] = useState(consultation?.treatment_plan ?? '');
  const [doctorNotes, setDoctorNotes] = useState(consultation?.doctor_notes ?? '');
  const [followUpDate, setFollowUpDate] = useState(consultation?.follow_up_date ?? '');
  const [clinicalIndication, setClinicalIndication] = useState(
    labOrders[0]?.clinical_indication ?? '',
  );

  const [rxItems, setRxItems] = useState<RxDraft[]>(() =>
    prescriptions.flatMap((rx) =>
      (rx.items ?? []).map((item) => ({
        key: item.id ?? nextDraftKey('rx'),
        product_id: item.product_id ?? null,
        medication_name: item.medication_name,
        dosage: item.dosage,
        frequency: item.frequency,
        duration_days: String(item.duration_days ?? 5),
        quantity: String(item.quantity ?? 1),
        unit_price: String(item.unit_price ?? 0),
        instructions: item.instructions ?? '',
      })),
    ),
  );

  const [labItems, setLabItems] = useState<LabOrderItemInput[]>(() =>
    labOrders.flatMap((order) =>
      (order.items ?? []).map((item) => ({
        test_name: item.test_name,
        test_code: item.test_code ?? null,
        unit_price: Number(item.unit_price) || 0,
      })),
    ),
  );

  const [medicationSearch, setMedicationSearch] = useState('');
  const [customTest, setCustomTest] = useState('');
  const [customTestPrice, setCustomTestPrice] = useState('0');
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const medicationResultsQuery = useQuery({
    queryKey: ['healthcare', 'medications', businessId, medicationSearch],
    queryFn: () => searchMedications(businessId, medicationSearch),
    enabled: medicationSearch.trim().length >= 2,
    staleTime: 60_000,
  });

  const allergies = useMemo(() => patient?.allergies ?? [], [patient?.allergies]);
  const allergyWarnings = useMemo(
    () => findAllergyWarnings(allergies, rxItems.map((item) => item.medication_name)),
    [allergies, rxItems],
  );

  const bmi = calculateBmi(visit.weight_kg, visit.height_cm);

  const updateRx = (key: string, patch: Partial<RxDraft>) => {
    setRxItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const addMedication = (medication?: { name: string; price: number; productId?: string }) => {
    const draft = emptyRxDraft();
    if (medication) {
      draft.medication_name = medication.name;
      draft.unit_price = String(medication.price);
      draft.product_id = medication.productId ?? null;
    }
    setRxItems((current) => [...current, draft]);
    setMedicationSearch('');
  };

  const toggleQuickTest = (test: (typeof QUICK_TESTS)[number]) => {
    setLabItems((current) => {
      const exists = current.some((item) => item.test_code === test.code);
      if (exists) return current.filter((item) => item.test_code !== test.code);
      return [...current, { test_code: test.code, test_name: test.name, unit_price: test.price }];
    });
  };

  const addCustomTest = () => {
    const name = customTest.trim();
    if (!name) return;
    setLabItems((current) => [
      ...current,
      { test_name: name, test_code: null, unit_price: toNumber(customTestPrice) },
    ]);
    setCustomTest('');
    setCustomTestPrice('0');
  };

  const save = async (target: 'pharmacy' | 'lab' | 'billing' | 'none') => {
    setError(null);
    if (!chiefComplaint.trim() || !diagnosis.trim()) {
      setError(t('healthcare.consultation.requiredFields'));
      return;
    }
    if (!doctorId) {
      setError(t('healthcare.consultation.noDoctor'));
      return;
    }

    const validRx = rxItems.filter((item) => item.medication_name.trim() !== '');
    if (validRx.some((item) => !item.dosage.trim() || !item.frequency.trim())) {
      setError(t('healthcare.consultation.prescriptionIncomplete'));
      return;
    }
    if (!visit.id) {
      setError(t('healthcare.consultation.saveError'));
      return;
    }

    setSavingTarget(target);
    try {
      const saved = await saveConsultation({
        id: consultationId ?? undefined,
        business_id: businessId,
        visit_id: visit.id,
        patient_id: visit.patient_id,
        doctor_id: doctorId,
        chief_complaint: chiefComplaint,
        history_of_present_illness: history,
        physical_examination: examination,
        diagnosis,
        icd10_code: icd10,
        treatment_plan: treatmentPlan,
        doctor_notes: doctorNotes,
        follow_up_date: followUpDate || null,
      });
      setConsultationId(saved.id ?? null);

      await saveVisitPrescription({
        businessId,
        visitId: visit.id,
        patientId: visit.patient_id,
        doctorId,
        items: validRx.map((item) => ({
          product_id: item.product_id,
          medication_name: item.medication_name,
          dosage: item.dosage,
          frequency: item.frequency,
          duration_days: toNumber(item.duration_days),
          quantity: toNumber(item.quantity),
          unit_price: toNumber(item.unit_price),
          instructions: item.instructions,
        })),
      });

      await saveVisitLabOrder({
        businessId,
        visitId: visit.id,
        patientId: visit.patient_id,
        doctorId,
        clinicalIndication,
        items: labItems,
      });

      const stage = target === 'pharmacy'
        ? 'at_pharmacy'
        : target === 'lab'
          ? 'in_lab'
          : target === 'billing'
            ? 'in_billing'
            : null;
      if (stage) {
        await advanceVisitStage(visit.id, stage);
      }

      await onSaved(t('healthcare.consultation.saved'));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('healthcare.consultation.saveError'),
      );
    } finally {
      setSavingTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {patientDisplayName(patient) || t('healthcare.workspace.unknownPatient')}
            </h1>
            <p className="mt-0.5 font-mono text-xs text-gray-500">
              {patient?.mrn ?? '—'} · {visit.visit_number}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StageBadge stage={visit.stage} />
              <BillingTypeBadge billingType={patient?.billing_type ?? 'cash'} />
              {patient?.date_of_birth && (
                <span className="text-[11px] text-gray-500">
                  {t('healthcare.patients.ageYears', { age: calculateAge(patient.date_of_birth) ?? 0 })}
                </span>
              )}
              {patient?.phone && <span className="text-[11px] text-gray-500">{patient.phone}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              {t('healthcare.consultation.visitTypeLabel')}
            </p>
            <p className="text-sm font-medium text-gray-700">
              {t(`healthcare.visitType.${visit.visit_type}`)}
            </p>
            <p className="text-[11px] text-gray-400">{formatDateValue(visit.visit_date)}</p>
          </div>
        </div>
      </header>

      {allergies.length > 0 && (
        <section
          role="alert"
          className="rounded-2xl border-2 border-red-300 bg-red-50 p-4"
          aria-labelledby="allergy-warning-title"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0">
              <h2 id="allergy-warning-title" className="text-sm font-bold text-red-800">
                {t('healthcare.consultation.allergyBannerTitle')}
              </h2>
              <p className="mt-0.5 text-xs text-red-700">{t('healthcare.consultation.allergyBannerBody')}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {allergies.map((allergy) => (
                  <li
                    key={allergy}
                    className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
                  >
                    {allergy}
                  </li>
                ))}
              </ul>
              {allergyWarnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {allergyWarnings.map((warning) => (
                    <li key={`${warning.allergen}-${warning.medication}`} className="text-xs font-semibold text-red-800">
                      {t('healthcare.consultation.allergyConflict', {
                        medication: warning.medication,
                        allergen: warning.allergen,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Activity className="h-4 w-4 text-brand-600" aria-hidden />
            {t('healthcare.consultation.vitalsTitle')}
          </h2>
          {canWrite && (
            <Button size="sm" variant="secondary" onClick={onRecordVitals}>
              {hasVitals(visit) ? t('healthcare.consultation.updateVitals') : t('healthcare.consultation.recordVitals')}
            </Button>
          )}
        </div>
        {hasVitals(visit) ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <VitalTile
              label={t('healthcare.triage.bloodPressure')}
              value={visit.systolic_bp && visit.diastolic_bp ? `${visit.systolic_bp}/${visit.diastolic_bp}` : '—'}
            />
            <VitalTile label={t('healthcare.triage.temperature')} value={visit.temperature ? `${visit.temperature} °C` : '—'} />
            <VitalTile label={t('healthcare.triage.heartRate')} value={visit.heart_rate ? `${visit.heart_rate} bpm` : '—'} />
            <VitalTile label={t('healthcare.triage.oxygenSaturation')} value={visit.oxygen_saturation ? `${visit.oxygen_saturation}%` : '—'} />
            <VitalTile label={t('healthcare.triage.weight')} value={visit.weight_kg ? `${visit.weight_kg} kg` : '—'} />
            <VitalTile label={t('healthcare.consultation.bmi')} value={bmi === null ? '—' : bmi.toFixed(1)} />
          </dl>
        ) : (
          <p className="mt-2 text-xs text-gray-500">{t('healthcare.consultation.vitalsEmpty')}</p>
        )}
        {visit.triage_notes && (
          <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {t('healthcare.consultation.triageNotes')}: {visit.triage_notes}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden />
          {t('healthcare.consultation.soapTitle')}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label={t('healthcare.consultation.chiefComplaint')} htmlFor="chief-complaint" className="md:col-span-2">
            <textarea
              id="chief-complaint"
              rows={2}
              value={chiefComplaint}
              onChange={(event) => setChiefComplaint(event.target.value)}
              placeholder={t('healthcare.consultation.chiefComplaintPlaceholder')}
              className={INPUT_CLASS}
              required
            />
          </Field>
          <Field label={t('healthcare.consultation.history')} htmlFor="clinical-history">
            <textarea
              id="clinical-history"
              rows={3}
              value={history}
              onChange={(event) => setHistory(event.target.value)}
              placeholder={t('healthcare.consultation.historyPlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.consultation.examination')} htmlFor="clinical-examination">
            <textarea
              id="clinical-examination"
              rows={3}
              value={examination}
              onChange={(event) => setExamination(event.target.value)}
              placeholder={t('healthcare.consultation.examinationPlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.consultation.diagnosis')} htmlFor="clinical-diagnosis">
            <input
              id="clinical-diagnosis"
              value={diagnosis}
              onChange={(event) => setDiagnosis(event.target.value)}
              placeholder={t('healthcare.consultation.diagnosisPlaceholder')}
              className={INPUT_CLASS}
              required
            />
          </Field>
          <Field label={t('healthcare.consultation.icd10')} htmlFor="clinical-icd10">
            <input
              id="clinical-icd10"
              value={icd10}
              onChange={(event) => setIcd10(event.target.value)}
              placeholder={t('healthcare.consultation.icd10Placeholder')}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.consultation.treatmentPlan')} htmlFor="clinical-treatment" className="md:col-span-2">
            <textarea
              id="clinical-treatment"
              rows={2}
              value={treatmentPlan}
              onChange={(event) => setTreatmentPlan(event.target.value)}
              placeholder={t('healthcare.consultation.treatmentPlanPlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.consultation.doctorNotes')} htmlFor="clinical-notes">
            <textarea
              id="clinical-notes"
              rows={2}
              value={doctorNotes}
              onChange={(event) => setDoctorNotes(event.target.value)}
              placeholder={t('healthcare.consultation.doctorNotesPlaceholder')}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={t('healthcare.consultation.followUpDate')} htmlFor="clinical-follow-up">
            <input
              id="clinical-follow-up"
              type="date"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Pill className="h-4 w-4 text-brand-600" aria-hidden />
              {t('healthcare.consultation.prescriptionsTitle')}
            </h2>
            <p className="text-xs text-gray-500">{t('healthcare.consultation.prescriptionsHint')}</p>
          </div>
          {canWrite && (
            <Button size="sm" variant="secondary" onClick={() => addMedication()}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.consultation.addMedication')}
            </Button>
          )}
        </div>

        {canWrite && (
          <div className="mt-3">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input
                type="search"
                value={medicationSearch}
                onChange={(event) => setMedicationSearch(event.target.value)}
                placeholder={t('healthcare.consultation.medicationSearchPlaceholder')}
                aria-label={t('healthcare.consultation.medicationSearchPlaceholder')}
                className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            {medicationSearch.trim().length >= 2 && (
              <div className="mt-2 max-w-md rounded-xl border border-gray-200 bg-gray-50 p-2">
                {medicationResultsQuery.isLoading && (
                  <p className="px-2 py-1 text-xs text-gray-500">{t('healthcare.consultation.searching')}</p>
                )}
                {medicationResultsQuery.isSuccess && (medicationResultsQuery.data ?? []).length === 0 && (
                  <p className="px-2 py-1 text-xs text-gray-500">{t('healthcare.consultation.noMedicationResults')}</p>
                )}
                <ul className="divide-y divide-gray-200">
                  {(medicationResultsQuery.data ?? []).map((medication) => (
                    <li key={medication.id}>
                      <button
                        type="button"
                        onClick={() => addMedication({
                          name: medication.name,
                          price: medication.unit_price,
                          productId: medication.id,
                        })}
                        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-white"
                      >
                        <span className="font-medium text-gray-800">{medication.name}</span>
                        <span className="text-gray-500">{medication.unit_price.toLocaleString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {rxItems.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
            {t('healthcare.consultation.noMedications')}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <caption className="sr-only">{t('healthcare.consultation.prescriptionsTitle')}</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-1 py-1">{t('healthcare.consultation.medication')}</th>
                  <th className="px-1 py-1">{t('healthcare.consultation.dosage')}</th>
                  <th className="px-1 py-1">{t('healthcare.consultation.frequency')}</th>
                  <th className="px-1 py-1">{t('healthcare.consultation.durationDays')}</th>
                  <th className="px-1 py-1">{t('healthcare.consultation.quantity')}</th>
                  <th className="px-1 py-1">{t('healthcare.consultation.unitPrice')}</th>
                  <th className="px-1 py-1">{t('healthcare.consultation.instructions')}</th>
                  <th className="px-1 py-1"><span className="sr-only">{t('healthcare.consultation.removeMedication')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rxItems.map((item) => (
                  <tr key={item.key} className="align-top">
                    <td className="min-w-[150px] px-1 py-1">
                      <input
                        value={item.medication_name}
                        onChange={(event) => updateRx(item.key, { medication_name: event.target.value })}
                        aria-label={t('healthcare.consultation.medication')}
                        className={TABLE_INPUT_CLASS}
                        placeholder={t('healthcare.consultation.medicationPlaceholder')}
                      />
                    </td>
                    <td className="min-w-[90px] px-1 py-1">
                      <input
                        value={item.dosage}
                        onChange={(event) => updateRx(item.key, { dosage: event.target.value })}
                        aria-label={t('healthcare.consultation.dosage')}
                        className={TABLE_INPUT_CLASS}
                        placeholder={t('healthcare.consultation.dosagePlaceholder')}
                      />
                    </td>
                    <td className="min-w-[90px] px-1 py-1">
                      <input
                        value={item.frequency}
                        onChange={(event) => updateRx(item.key, { frequency: event.target.value })}
                        aria-label={t('healthcare.consultation.frequency')}
                        className={TABLE_INPUT_CLASS}
                        placeholder={t('healthcare.consultation.frequencyPlaceholder')}
                      />
                    </td>
                    <td className="w-20 px-1 py-1">
                      <input
                        type="number"
                        min={1}
                        value={item.duration_days}
                        onChange={(event) => updateRx(item.key, { duration_days: event.target.value })}
                        aria-label={t('healthcare.consultation.durationDays')}
                        className={TABLE_INPUT_CLASS}
                      />
                    </td>
                    <td className="w-20 px-1 py-1">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) => updateRx(item.key, { quantity: event.target.value })}
                        aria-label={t('healthcare.consultation.quantity')}
                        className={TABLE_INPUT_CLASS}
                      />
                    </td>
                    <td className="w-24 px-1 py-1">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unit_price}
                        onChange={(event) => updateRx(item.key, { unit_price: event.target.value })}
                        aria-label={t('healthcare.consultation.unitPrice')}
                        className={TABLE_INPUT_CLASS}
                      />
                    </td>
                    <td className="min-w-[130px] px-1 py-1">
                      <input
                        value={item.instructions}
                        onChange={(event) => updateRx(item.key, { instructions: event.target.value })}
                        aria-label={t('healthcare.consultation.instructions')}
                        className={TABLE_INPUT_CLASS}
                        placeholder={t('healthcare.consultation.instructionsPlaceholder')}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => setRxItems((current) => current.filter((row) => row.key !== item.key))}
                        aria-label={`${t('healthcare.consultation.removeMedication')}: ${item.medication_name || '—'}`}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FlaskConical className="h-4 w-4 text-brand-600" aria-hidden />
            {t('healthcare.consultation.labsTitle')}
          </h2>
          <p className="text-xs text-gray-500">{t('healthcare.consultation.labsHint')}</p>
        </div>

        <fieldset className="mt-3" disabled={!canWrite}>
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {t('healthcare.consultation.quickPanel')}
          </legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_TESTS.map((test) => {
              const checked = labItems.some((item) => item.test_code === test.code);
              return (
                <label
                  key={test.code}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${
                    checked ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleQuickTest(test)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    {t(test.labelKey)}
                  </span>
                  <span className="text-[11px] text-gray-500">{test.price.toLocaleString()}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {canWrite && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1">
              <span className="text-[11px] font-semibold text-gray-500">{t('healthcare.consultation.customTest')}</span>
              <input
                value={customTest}
                onChange={(event) => setCustomTest(event.target.value)}
                placeholder={t('healthcare.consultation.customTestPlaceholder')}
                className={TABLE_INPUT_CLASS}
              />
            </label>
            <label className="w-28">
              <span className="text-[11px] font-semibold text-gray-500">{t('healthcare.consultation.testPrice')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={customTestPrice}
                onChange={(event) => setCustomTestPrice(event.target.value)}
                className={TABLE_INPUT_CLASS}
              />
            </label>
            <Button type="button" size="sm" variant="secondary" onClick={addCustomTest}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.consultation.addTest')}
            </Button>
          </div>
        )}

        {labItems.length > 0 ? (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {labItems.map((item, index) => (
              <li key={`${item.test_code ?? 'custom'}-${item.test_name}-${index}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-gray-800">
                  {item.test_name}
                  {item.test_code && <span className="ml-2 font-mono text-[10px] text-gray-400">{item.test_code}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.unit_price}
                    onChange={(event) => {
                      const price = toNumber(event.target.value);
                      setLabItems((current) =>
                        current.map((row, rowIndex) => (rowIndex === index ? { ...row, unit_price: price } : row)),
                      );
                    }}
                    aria-label={`${t('healthcare.consultation.testPrice')}: ${item.test_name}`}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                    disabled={!canWrite}
                  />
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setLabItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      aria-label={`${t('healthcare.consultation.removeTest')}: ${item.test_name}`}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
            {t('healthcare.consultation.noTests')}
          </p>
        )}

        <Field label={t('healthcare.consultation.clinicalIndication')} htmlFor="lab-indication" className="mt-3">
          <input
            id="lab-indication"
            value={clinicalIndication}
            onChange={(event) => setClinicalIndication(event.target.value)}
            placeholder={t('healthcare.consultation.clinicalIndicationPlaceholder')}
            className={INPUT_CLASS}
            disabled={!canWrite}
          />
        </Field>
      </section>

      {error && <ErrorNotice message={error} />}

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <p className="text-[11px] text-gray-400">{t('healthcare.consultation.actionsHint')}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canWrite || savingTarget !== null}
            isLoading={savingTarget === 'none'}
            onClick={() => void save('none')}
          >
            {t('healthcare.consultation.saveOnly')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canWrite || savingTarget !== null}
            isLoading={savingTarget === 'lab'}
            onClick={() => void save('lab')}
          >
            {t('healthcare.consultation.saveAndRouteLab')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canWrite || savingTarget !== null}
            isLoading={savingTarget === 'pharmacy'}
            onClick={() => void save('pharmacy')}
          >
            {t('healthcare.consultation.saveAndRoutePharmacy')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canWrite || savingTarget !== null}
            isLoading={savingTarget === 'billing'}
            onClick={() => void save('billing')}
          >
            {t('healthcare.consultation.saveAndRouteBilling')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function VitalTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-gray-800">{value || '—'}</dd>
    </div>
  );
}
