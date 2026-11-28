import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  HeartPulse,
  Scale,
  UserRound,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AcuityBadge } from '@/components/healthcare/AcuityBadge';
import { PatientFlightBoard } from '@/components/healthcare/PatientFlightBoard';
import { QueueTokenBadge } from '@/components/healthcare/QueueTokenBadge';
import { ErrorNotice, Field, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { calculateBmi } from '@/services/healthcareService';
import {
  ACUITY_LEVELS,
  listReceptionQueue,
  submitNurseTriage,
  type ClinicalFlowVisit,
  type NurseTriageVitals,
} from '@/services/clinicalFlowService';
import { calculateAge, formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import type { AcuityLevel } from '@/types/healthcare';

type VitalsForm = Record<keyof NurseTriageVitals, string>;


const VITAL_FIELDS: ReadonlyArray<{
  key: keyof NurseTriageVitals;
  labelKey: string;
  step: string;
}> = [
  { key: 'systolic_bp', labelKey: 'healthcare.triage.systolic', step: '1' },
  { key: 'diastolic_bp', labelKey: 'healthcare.triage.diastolic', step: '1' },
  { key: 'heart_rate', labelKey: 'healthcare.triage.heartRate', step: '1' },
  { key: 'temperature', labelKey: 'healthcare.triage.temperature', step: '0.1' },
  { key: 'respiratory_rate', labelKey: 'healthcare.triage.respiratoryRate', step: '1' },
  { key: 'oxygen_saturation', labelKey: 'healthcare.triage.oxygenSaturation', step: '0.1' },
  { key: 'weight_kg', labelKey: 'healthcare.triage.weight', step: '0.1' },
  { key: 'height_cm', labelKey: 'healthcare.triage.height', step: '0.1' },
  { key: 'blood_sugar_mg_dl', labelKey: 'healthcare.triage.bloodSugar', step: '0.1' },
];

const ACUITY_BUTTON_STYLES: Record<AcuityLevel, string> = {
  emergency: 'border-red-300 bg-red-50 text-red-800 data-[selected=true]:ring-red-500',
  urgent: 'border-amber-300 bg-amber-50 text-amber-900 data-[selected=true]:ring-amber-500',
  priority: 'border-yellow-300 bg-yellow-50 text-yellow-900 data-[selected=true]:ring-yellow-500',
  routine: 'border-emerald-300 bg-emerald-50 text-emerald-800 data-[selected=true]:ring-emerald-500',
};

function bmiBandKey(bmi: number | null): string | null {
  if (bmi === null) return null;
  if (bmi < 18.5) return 'healthcare.triage.bmiUnderweight';
  if (bmi < 25) return 'healthcare.triage.bmiNormal';
  if (bmi < 30) return 'healthcare.triage.bmiOverweight';
  return 'healthcare.triage.bmiObese';
}

function visitLabel(visit: ClinicalFlowVisit): string {
  const patient = visit.patient;
  const age = calculateAge(patient?.date_of_birth);
  return [patientDisplayName(patient), age === null ? null : `${age}y`, patient?.mrn]
    .filter(Boolean)
    .join(' · ');
}

function initialVitals(visit: ClinicalFlowVisit): VitalsForm {
  return {
    systolic_bp: visit.systolic_bp?.toString() ?? '',
    diastolic_bp: visit.diastolic_bp?.toString() ?? '',
    heart_rate: visit.heart_rate?.toString() ?? '',
    temperature: visit.temperature?.toString() ?? '',
    respiratory_rate: visit.respiratory_rate?.toString() ?? '',
    oxygen_saturation: visit.oxygen_saturation?.toString() ?? '',
    weight_kg: visit.weight_kg?.toString() ?? '',
    height_cm: visit.height_cm?.toString() ?? '',
    blood_sugar_mg_dl: visit.blood_sugar_mg_dl?.toString() ?? '',
  };
}

/**
 * Nurse Triage Station. Reception's Q-NNN patients arrive here, the nurse
 * records vitals + acuity, and the visit moves to `triaged` for the doctor's
 * acuity-sorted queue.
 */
export function TriageStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const { canWrite } = usePermissions();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ['healthcare', 'clinical-flow', 'triage', businessId],
    queryFn: () => listReceptionQueue(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 8_000,
    refetchInterval: 20_000,
  });

  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  // Derive the selection instead of copying it into state in an effect: after a
  // save the visit leaves the queue and the next registered patient is chosen.
  const selected =
    queue.find((visit) => visit.id === selectedId) ??
    queue.find((visit) => visit.stage === 'registered') ??
    queue[0] ??
    null;

  const emergencyCount = queue.filter(
    (visit) => visit.acuity_level === 'emergency' && visit.stage === 'triaged',
  ).length;

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
            <HeartPulse className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('healthcare.triage.stationTitle')}
            </h1>
            <p className="text-sm text-gray-500">{t('healthcare.triage.stationSubtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {queue.length}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 font-semibold text-red-700">
            <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
            {emergencyCount} {t('healthcare.acuity.emergency')}
          </span>
        </div>
      </header>

      {success && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {success}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,5fr)_minmax(0,7fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">{t('healthcare.triage.queueTitle')}</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">{t('healthcare.triage.queueHint')}</p>
          </div>

          {queueQuery.isLoading && (
            <div className="p-4">
              <LoadingNotice label={t('healthcare.triage.loading')} />
            </div>
          )}
          {queueQuery.isError && (
            <div className="p-4">
              <ErrorNotice message={t('healthcare.triage.loadError')} />
            </div>
          )}
          {queueQuery.isSuccess && queue.length === 0 && (
            <div className="px-4 py-10 text-center">
              <UserRound className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm text-gray-500">{t('healthcare.triage.noPatients')}</p>
            </div>
          )}

          <ul className="divide-y divide-gray-100">
            {queue.map((visit) => {
              const isSelected = visit.id === selected?.id;
              return (
                <li key={visit.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(visit.id ?? null)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                      isSelected
                        ? 'bg-sky-50/80 ring-1 ring-inset ring-sky-200'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <QueueTokenBadge token={visit.queue_token} size="sm" className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-gray-900">
                          {patientDisplayName(visit.patient)}
                        </span>
                        <AcuityBadge acuity={visit.acuity_level} showIcon={false} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                        {visitLabel(visit)}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                        <span>{formatDateValue(visit.visit_date)}</span>
                        <span>·</span>
                        <span>{t(`healthcare.queueStage.${visit.stage}`)}</span>
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-4">
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
              <HeartPulse className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm text-gray-500">{t('healthcare.triage.selectPatient')}</p>
            </div>
          ) : (
            <TriageForm
              key={selected.id}
              businessId={businessId}
              visit={selected}
              canWrite={canWrite}
              onSaved={async (message) => {
                setSuccess(message);
                setSelectedId(null);
                await queryClient.invalidateQueries({ queryKey: ['healthcare'] });
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function TriageForm({
  businessId,
  visit,
  canWrite,
  onSaved,
}: {
  businessId: string;
  visit: ClinicalFlowVisit;
  canWrite: boolean;
  onSaved: (message: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [vitals, setVitals] = useState<VitalsForm>(() => initialVitals(visit));
  const [acuity, setAcuity] = useState<AcuityLevel>(
    (visit.acuity_level as AcuityLevel | null) ?? 'routine',
  );
  const [notes, setNotes] = useState(visit.triage_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bmi = calculateBmi(vitals.weight_kg, vitals.height_cm);

  const updateVital = (key: keyof NurseTriageVitals, value: string) => {
    setVitals((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!visit.id) return;
    setError(null);

    const parsed: NurseTriageVitals = {};
    let recorded = 0;
    for (const field of VITAL_FIELDS) {
      const raw = vitals[field.key].trim();
      if (!raw) {
        parsed[field.key] = null;
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        setError(t('healthcare.triage.invalidValue'));
        return;
      }
      parsed[field.key] = value;
      recorded += 1;
    }
    if (recorded === 0) {
      setError(t('healthcare.triage.noVitals'));
      return;
    }

    setSaving(true);
    try {
      await submitNurseTriage({
        visitId: visit.id,
        businessId,
        acuity,
        vitals: parsed,
        notes: notes.trim() || null,
      });
      await onSaved(`${patientDisplayName(visit.patient)} · ${t('healthcare.triage.success')}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : t('healthcare.triage.submitError'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {t('healthcare.triage.selected')}
            </p>
            <h2 className="text-lg font-semibold text-gray-900">
              {patientDisplayName(visit.patient)}
            </h2>
            <p className="text-xs text-gray-500">{visitLabel(visit)}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <QueueTokenBadge token={visit.queue_token} />
            <AcuityBadge acuity={visit.acuity_level} />
          </div>
        </div>
        <PatientFlightBoard
          stage={visit.stage}
          resultsReadyForReview={Boolean(visit.results_ready_for_review)}
          className="mt-3 border-gray-100 bg-gray-50/50 px-2 py-2"
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{t('healthcare.acuity.label')}</h3>
          <p className="text-[11px] text-gray-400">{t('healthcare.triage.acuityHint')}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACUITY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              data-selected={acuity === level}
              onClick={() => setAcuity(level)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-bold uppercase tracking-wide transition data-[selected=true]:ring-2 data-[selected=true]:ring-offset-1 ${ACUITY_BUTTON_STYLES[level]}`}
              aria-pressed={acuity === level}
            >
              {t(`healthcare.acuity.${level}`)}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{t('healthcare.triage.vitals')}</h3>
          <div className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900">
            <Scale className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.triage.bmiLive')}: {bmi ?? '—'}
            {bmi !== null && (
              <span className="font-normal text-sky-700">
                · {t(bmiBandKey(bmi) as string)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VITAL_FIELDS.map((field) => (
            <Field key={field.key} label={t(field.labelKey)}>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step={field.step}
                value={vitals[field.key]}
                onChange={(event) => updateVital(field.key, event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </Field>
          ))}
        </div>

        <Field label={t('healthcare.triage.notes')} hint={t('healthcare.triage.notesHint')}>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm text-gray-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </Field>

        {error && <div className="mt-3"><ErrorNotice message={error} /></div>}

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.triage.subtitle')}
          </p>
          <Button onClick={() => void handleSubmit()} isLoading={saving} disabled={!canWrite}>
            <HeartPulse className="h-4 w-4" aria-hidden />
            {saving ? t('healthcare.triage.submitting') : t('healthcare.triage.submit')}
          </Button>
        </div>
      </div>
    </>
  );
}
