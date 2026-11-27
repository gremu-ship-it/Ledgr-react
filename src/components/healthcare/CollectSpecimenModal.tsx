import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FlaskConical, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import { collectSpecimen } from '@/services/labService';
import type { LabOrder, LabSpecimen, SpecimenType } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const SPECIMEN_OPTIONS: Array<{ value: SpecimenType; labelKey: string }> = [
  { value: 'blood', labelKey: 'healthcare.lab.specimenType.blood' },
  { value: 'urine', labelKey: 'healthcare.lab.specimenType.urine' },
  { value: 'stool', labelKey: 'healthcare.lab.specimenType.stool' },
  { value: 'sputum', labelKey: 'healthcare.lab.specimenType.sputum' },
  { value: 'swab', labelKey: 'healthcare.lab.specimenType.swab' },
  { value: 'tissue', labelKey: 'healthcare.lab.specimenType.tissue' },
  { value: 'other', labelKey: 'healthcare.lab.specimenType.other' },
];

/** Registers a collected sample and allocates its SMP-YYYY-NNNN barcode. */
interface CollectSpecimenProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  order: LabOrder | null;
  canWrite: boolean;
  onCollected?: (specimen: LabSpecimen) => void;
  onPrintLabel?: (specimen: LabSpecimen) => void;
}

export function CollectSpecimenModal(props: CollectSpecimenProps) {
  const { open, order } = props;
  if (!open || !order) return null;
  return <CollectSpecimenBody key={order.id} {...props} order={order} />;
}

function CollectSpecimenBody({
  onClose,
  businessId,
  order,
  canWrite,
  onCollected,
  onPrintLabel,
}: Omit<CollectSpecimenProps, 'open'> & { order: LabOrder }) {
  const { t } = useTranslation();
  const [specimenType, setSpecimenType] = useState<SpecimenType>('blood');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [specimen, setSpecimen] = useState<LabSpecimen | null>(null);

  const patientName =
    patientDisplayName(order.patient) || t('healthcare.workspace.unknownPatient');

  const submit = async () => {
    if (!businessId) return;
    setError(null);
    setIsSaving(true);
    try {
      const collected = await collectSpecimen({
        businessId,
        labOrderId: order.id,
        specimenType,
        notes,
      });
      setSpecimen(collected);
      onCollected?.(collected);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.lab.collect.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="collect-specimen-title"
      title={t('healthcare.lab.collect.title')}
      subtitle={`${patientName} · ${order.patient?.mrn ?? ''} · ${order.visit?.visit_number ?? ''}`}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      footer={
        specimen ? (
          <>
            {onPrintLabel ? (
              <Button variant="secondary" onClick={() => onPrintLabel(specimen)}>
                <Printer className="h-4 w-4" aria-hidden />
                {t('healthcare.lab.collect.printLabel')}
              </Button>
            ) : null}
            <Button onClick={onClose}>{t('healthcare.common.done')}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('healthcare.common.cancel')}
            </Button>
            <Button onClick={submit} isLoading={isSaving} disabled={!canWrite}>
              <FlaskConical className="h-4 w-4" aria-hidden />
              {t('healthcare.lab.collect.submit')}
            </Button>
          </>
        )
      }
    >
      {specimen ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-emerald-800">
                {t('healthcare.lab.collect.successTitle')}
              </p>
              <p className="mt-0.5 text-xs text-emerald-700">
                {t('healthcare.lab.collect.successBody', {
                  barcode: specimen.specimen_barcode,
                })}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {t('healthcare.lab.collect.barcode')}
            </p>
            <p className="mt-1 font-mono text-xl font-bold tracking-[0.12em] text-gray-900">
              {specimen.specimen_barcode}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('healthcare.lab.collect.collectedAt', {
                date: formatDateValue(specimen.collected_at),
              })}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? <ErrorNotice message={error} /> : null}
          {!canWrite ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('healthcare.lab.collect.readOnly')}
            </div>
          ) : null}

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.collect.orderedTests')}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-gray-800">
              {order.items.map((item) => (
                <li key={item.id}>{item.test_name}</li>
              ))}
            </ul>
          </section>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.collect.specimenType')}
            </span>
            <select
              value={specimenType}
              onChange={(event) => setSpecimenType(event.target.value as SpecimenType)}
              className={INPUT_CLASS}
            >
              {SPECIMEN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.lab.collect.notes')}
            </span>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('healthcare.lab.collect.notesPlaceholder')}
              className={INPUT_CLASS}
            />
          </label>

          <p className="text-[11px] text-gray-400">{t('healthcare.lab.collect.barcodeHint')}</p>
        </div>
      )}
    </HealthcareModal>
  );
}
