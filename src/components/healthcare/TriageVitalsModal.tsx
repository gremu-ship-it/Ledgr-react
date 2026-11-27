import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice } from '@/components/healthcare/healthcareUi';
import { useAppStore } from '@/store/useAppStore';
import { calculateBmi, recordTriageVitals, type PatientVisit } from '@/services/healthcareService';
import { patientDisplayName } from '@/lib/healthcare/format';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

interface TriageVitalsModalProps {
  visit: PatientVisit;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Triage vitals capture. BMI is derived live from weight and height and is not
 * persisted separately — it is always recomputed from the measurements.
 */
export function TriageVitalsModal({ visit, onClose, onSaved }: TriageVitalsModalProps) {
  const { t } = useTranslation();
  const userId = useAppStore((state) => state.currentUser?.id ?? null);

  const [systolic, setSystolic] = useState(visit.systolic_bp?.toString() ?? '');
  const [diastolic, setDiastolic] = useState(visit.diastolic_bp?.toString() ?? '');
  const [temperature, setTemperature] = useState(visit.temperature?.toString() ?? '');
  const [heartRate, setHeartRate] = useState(visit.heart_rate?.toString() ?? '');
  const [respiratoryRate, setRespiratoryRate] = useState(visit.respiratory_rate?.toString() ?? '');
  const [oxygenSaturation, setOxygenSaturation] = useState(visit.oxygen_saturation?.toString() ?? '');
  const [weight, setWeight] = useState(visit.weight_kg?.toString() ?? '');
  const [height, setHeight] = useState(visit.height_cm?.toString() ?? '');
  const [bloodSugar, setBloodSugar] = useState(visit.blood_sugar_mg_dl?.toString() ?? '');
  const [notes, setNotes] = useState(visit.triage_notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bmi = calculateBmi(weight, height);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const vitals = {
      systolic_bp: optionalNumber(systolic),
      diastolic_bp: optionalNumber(diastolic),
      temperature: optionalNumber(temperature),
      heart_rate: optionalNumber(heartRate),
      respiratory_rate: optionalNumber(respiratoryRate),
      oxygen_saturation: optionalNumber(oxygenSaturation),
      weight_kg: optionalNumber(weight),
      height_cm: optionalNumber(height),
      blood_sugar_mg_dl: optionalNumber(bloodSugar),
      triage_notes: notes.trim() || null,
    };

    const hasInvalid = Object.values(vitals).some((value) => Number.isNaN(value));
    if (hasInvalid) {
      setError(t('healthcare.triage.invalidValue'));
      return;
    }
    const hasMeasurement = Object.entries(vitals).some(
      ([key, value]) => key !== 'triage_notes' && value !== null,
    );
    if (!hasMeasurement) {
      setError(t('healthcare.triage.requiredVital'));
      return;
    }
    if (!visit.id) {
      setError(t('healthcare.triage.saveError'));
      return;
    }

    setIsSaving(true);
    try {
      await recordTriageVitals(visit.id, vitals, userId);
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('healthcare.triage.saveError'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="triage-vitals-title"
    >
      <form
        onSubmit={submit}
        className="my-6 w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Activity className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 id="triage-vitals-title" className="text-lg font-semibold text-gray-900">
                {t('healthcare.triage.title')}
              </h2>
              <p className="text-sm text-gray-500">
                {patientDisplayName(visit.patient)} · {visit.patient?.mrn ?? ''} · {visit.visit_number}
              </p>
              <p className="text-xs text-gray-400">{t('healthcare.triage.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error && <ErrorNotice message={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-semibold text-gray-600">
              {t('healthcare.triage.bloodPressure')}
            </legend>
            <div className="mt-1 flex items-end gap-3">
              <label className="flex-1">
                <span className="text-[11px] text-gray-500">{t('healthcare.triage.systolic')}</span>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={systolic}
                  onChange={(event) => setSystolic(event.target.value)}
                  className={INPUT_CLASS}
                  aria-label={t('healthcare.triage.systolic')}
                />
              </label>
              <span className="pb-2 text-lg text-gray-400">/</span>
              <label className="flex-1">
                <span className="text-[11px] text-gray-500">{t('healthcare.triage.diastolic')}</span>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={diastolic}
                  onChange={(event) => setDiastolic(event.target.value)}
                  className={INPUT_CLASS}
                  aria-label={t('healthcare.triage.diastolic')}
                />
              </label>
              <span className="pb-2 text-sm text-gray-400">{t('healthcare.triage.mmHg')}</span>
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.temperature')}</span>
            <input
              type="number"
              step="0.1"
              min={0}
              max={50}
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.heartRate')}</span>
            <input
              type="number"
              min={0}
              max={300}
              value={heartRate}
              onChange={(event) => setHeartRate(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.respiratoryRate')}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={respiratoryRate}
              onChange={(event) => setRespiratoryRate(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.oxygenSaturation')}</span>
            <input
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={oxygenSaturation}
              onChange={(event) => setOxygenSaturation(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.weight')}</span>
            <input
              type="number"
              step="0.01"
              min={0}
              max={500}
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.height')}</span>
            <input
              type="number"
              step="0.01"
              min={0}
              max={300}
              value={height}
              onChange={(event) => setHeight(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.bloodSugar')}</span>
            <input
              type="number"
              step="0.1"
              min={0}
              max={1000}
              value={bloodSugar}
              onChange={(event) => setBloodSugar(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <div className="flex flex-col justify-end rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {t('healthcare.triage.bmi')}
            </span>
            <span className="text-2xl font-semibold text-gray-900">
              {bmi === null ? '—' : bmi.toFixed(1)}
            </span>
            <span className="text-[11px] text-gray-400">{t('healthcare.triage.bmiHint')}</span>
          </div>

          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-gray-600">{t('healthcare.triage.notes')}</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            {t('healthcare.triage.cancel')}
          </Button>
          <Button type="submit" isLoading={isSaving}>
            {isSaving ? t('healthcare.triage.saving') : t('healthcare.triage.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
