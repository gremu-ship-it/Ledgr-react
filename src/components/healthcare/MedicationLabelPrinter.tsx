import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, Sticker } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { formatDateValue } from '@/lib/healthcare/format';
import { buildMedicationLabelHtml, printHtmlDocument } from '@/lib/healthcare/print';
import type { MedicationLabelFormat, MedicationLabelPayload } from '@/types/healthcare';

/**
 * Prints the pharmacy sticker on a 58mm or 80mm roll. The label is written into
 * an isolated iframe with its own @page size, so the browser never prints the
 * dispensary screen.
 */
export function MedicationLabelPrinter({
  open,
  onClose,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  payload: MedicationLabelPayload | null;
}) {
  const { t } = useTranslation();
  const { businessName } = useBrandTheme();
  const [format, setFormat] = useState<MedicationLabelFormat>('80mm');

  if (!payload) return null;

  const handlePrint = () => {
    const html = buildMedicationLabelHtml(
      {
        businessName,
        patientName: payload.patientName,
        mrn: payload.mrn,
        medicationName: payload.medicationName,
        dosage: payload.dosage,
        frequency: payload.frequency,
        durationDays: payload.durationDays,
        quantity: payload.quantity,
        instructions: payload.instructions,
        batchNumber: payload.batchNumber,
        expiryDate: formatDateValue(payload.expiryDate),
        dispensedAt: formatDateValue(payload.dispensedAt),
        pharmacist: payload.pharmacist,
        warnings: payload.warnings,
        labels: {
          title: t('healthcare.pharmacy.label.title'),
          patient: t('healthcare.pharmacy.label.patient'),
          mrn: t('healthcare.pharmacy.label.mrn'),
          dosage: t('healthcare.pharmacy.label.dosage'),
          frequency: t('healthcare.pharmacy.label.frequency'),
          duration: t('healthcare.pharmacy.label.duration'),
          durationValue: `${payload.durationDays} ${t('healthcare.pharmacy.label.daysUnit')}`,
          quantity: t('healthcare.pharmacy.label.quantity'),
          batch: t('healthcare.pharmacy.label.batch'),
          expiry: t('healthcare.pharmacy.label.expiry'),
          dispensed: t('healthcare.pharmacy.label.dispensed'),
          instructions: t('healthcare.pharmacy.label.instructions'),
          warning: t('healthcare.pharmacy.label.warning'),
          preparedBy: t('healthcare.pharmacy.label.preparedBy'),
        },
      },
      format,
    );
    printHtmlDocument(html, 'ledgr-medication-label-frame');
  };

  return (
    <HealthcareModal
      open={open}
      titleId="medication-label-title"
      title={t('healthcare.pharmacy.label.modalTitle')}
      subtitle={t('healthcare.pharmacy.label.modalSubtitle')}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.common.close')}
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4" aria-hidden />
            {t('healthcare.pharmacy.label.print')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600">
            {t('healthcare.pharmacy.label.format')}
          </span>
          {(['58mm', '80mm'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFormat(option)}
              aria-pressed={format === option}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                format === option
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {option === '58mm'
                ? t('healthcare.pharmacy.label.format58')
                : t('healthcare.pharmacy.label.format80')}
            </button>
          ))}
        </div>

        <div className="mx-auto max-w-sm rounded-xl border border-dashed border-gray-300 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-dashed border-gray-300 pb-2">
            <Sticker className="h-4 w-4 text-brand-600" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold uppercase tracking-wide text-gray-700">
                {businessName}
              </p>
              <p className="text-[10px] text-gray-500">{t('healthcare.pharmacy.label.title')}</p>
            </div>
          </div>
          <p className="mt-2 text-base font-bold text-gray-900">{payload.medicationName}</p>
          <p className="text-sm font-semibold text-gray-800">
            {payload.dosage} · {payload.frequency}
          </p>
          <dl className="mt-2 space-y-1 text-[11px] text-gray-600">
            <div className="flex justify-between gap-2">
              <dt>{t('healthcare.pharmacy.label.patient')}</dt>
              <dd className="font-medium text-gray-800">{payload.patientName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t('healthcare.pharmacy.label.mrn')}</dt>
              <dd className="font-mono text-gray-800">{payload.mrn}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t('healthcare.pharmacy.label.batch')}</dt>
              <dd className="font-medium text-gray-800">{payload.batchNumber}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t('healthcare.pharmacy.label.expiry')}</dt>
              <dd className="font-medium text-gray-800">{formatDateValue(payload.expiryDate)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t('healthcare.pharmacy.label.quantity')}</dt>
              <dd className="font-medium text-gray-800">{payload.quantity}</dd>
            </div>
          </dl>
          {payload.instructions ? (
            <p className="mt-2 border-t border-dashed border-gray-300 pt-2 text-[11px] text-gray-700">
              <span className="font-semibold">{t('healthcare.pharmacy.label.instructions')}:</span>{' '}
              {payload.instructions}
            </p>
          ) : null}
          {(payload.warnings ?? []).length > 0 ? (
            <p className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
              {t('healthcare.pharmacy.label.warning')}: {payload.warnings?.join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
    </HealthcareModal>
  );
}
