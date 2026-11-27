import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { ResultStatusBadge } from '@/components/healthcare/ResultStatusBadge';
import {
  buildReferenceRangeLabel,
  evaluateResultStatus,
  findLabReferenceDefaults,
  recordLabResult,
} from '@/services/labService';
import type { LabOrder, LabOrderItem } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export interface LabResultTarget {
  order: LabOrder;
  item: LabOrderItem;
}

function numericInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseBound(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Result capture with a live classification preview. The same
 * `evaluateResultStatus` function runs in the service, so what the technician
 * sees before saving is exactly what gets stored and printed.
 */
interface EnterLabResultProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  target: LabResultTarget | null;
  canWrite: boolean;
  onSaved?: (item: LabOrderItem) => void;
}

export function EnterLabResultModal(props: EnterLabResultProps) {
  const { open, target } = props;
  if (!open || !target) return null;
  return <EnterLabResultBody key={target.item.id} {...props} target={target} />;
}

function EnterLabResultBody({
  onClose,
  businessId,
  target,
  canWrite,
  onSaved,
}: Omit<EnterLabResultProps, 'open'> & { target: LabResultTarget }) {
  const { t } = useTranslation();
  const defaults = findLabReferenceDefaults(target.item.test_name);
  const [resultValue, setResultValue] = useState(target.item.result_value ?? '');
  const [unit, setUnit] = useState(target.item.unit_of_measure ?? defaults.unit ?? '');
  const [minNormal, setMinNormal] = useState(
    numericInput(target.item.min_normal ?? defaults.minNormal),
  );
  const [maxNormal, setMaxNormal] = useState(
    numericInput(target.item.max_normal ?? defaults.maxNormal),
  );
  const [criticalLow, setCriticalLow] = useState(
    numericInput(target.item.critical_low ?? defaults.criticalLow),
  );
  const [criticalHigh, setCriticalHigh] = useState(
    numericInput(target.item.critical_high ?? defaults.criticalHigh),
  );
  const [technicianNotes, setTechnicianNotes] = useState(target.item.technician_notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const range = {
    unit: unit.trim() || null,
    minNormal: parseBound(minNormal),
    maxNormal: parseBound(maxNormal),
    criticalLow: parseBound(criticalLow),
    criticalHigh: parseBound(criticalHigh),
  };
  const previewStatus = evaluateResultStatus(resultValue, range);
  const referenceLabel = buildReferenceRangeLabel(range);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setError(null);
    setIsSaving(true);
    try {
      const saved = await recordLabResult(
        {
          businessId,
          itemId: target.item.id,
          resultValue,
          referenceRange: range,
          technicianNotes,
        },
        target.item,
      );
      onSaved?.(saved);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.lab.result.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="enter-lab-result-title"
      title={t('healthcare.lab.result.title')}
      subtitle={`${target.item.test_name} · ${target.order.patient?.mrn ?? ''}`}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.common.cancel')}
          </Button>
          <Button
            type="submit"
            form="lab-result-form"
            isLoading={isSaving}
            disabled={!canWrite}
          >
            <FlaskConical className="h-4 w-4" aria-hidden />
            {t('healthcare.lab.result.submit')}
          </Button>
        </>
      }
    >
      <form id="lab-result-form" onSubmit={submit} className="space-y-4">
        {error ? <ErrorNotice message={error} /> : null}
        {!canWrite ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('healthcare.lab.result.readOnly')}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.result.value')}
            </span>
            <input
              type="text"
              value={resultValue}
              onChange={(event) => setResultValue(event.target.value)}
              placeholder={t('healthcare.lab.result.valuePlaceholder')}
              className={INPUT_CLASS}
              autoFocus
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              {t('healthcare.lab.result.qualitativeHint')}
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.result.unit')}
            </span>
            <input
              type="text"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder={t('healthcare.lab.result.unitPlaceholder')}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-xs font-semibold text-gray-600">
            {t('healthcare.lab.result.preview')}
          </span>
          <ResultStatusBadge status={previewStatus} />
          {referenceLabel ? (
            <span className="text-xs text-gray-500">
              {t('healthcare.lab.result.reference', { range: referenceLabel })}
            </span>
          ) : (
            <span className="text-xs text-gray-400">{t('healthcare.lab.result.noReference')}</span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.result.minNormal')}
            </span>
            <input
              type="number"
              step="any"
              value={minNormal}
              onChange={(event) => setMinNormal(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.result.maxNormal')}
            </span>
            <input
              type="number"
              step="any"
              value={maxNormal}
              onChange={(event) => setMaxNormal(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.result.criticalLow')}
            </span>
            <input
              type="number"
              step="any"
              value={criticalLow}
              onChange={(event) => setCriticalLow(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.result.criticalHigh')}
            </span>
            <input
              type="number"
              step="any"
              value={criticalHigh}
              onChange={(event) => setCriticalHigh(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            {t('healthcare.lab.result.notes')}
          </span>
          <textarea
            rows={2}
            value={technicianNotes}
            onChange={(event) => setTechnicianNotes(event.target.value)}
            placeholder={t('healthcare.lab.result.notesPlaceholder')}
            className={INPUT_CLASS}
          />
        </label>

        <p className="text-[11px] text-gray-400">{t('healthcare.lab.result.criticalHint')}</p>
      </form>
    </HealthcareModal>
  );
}
