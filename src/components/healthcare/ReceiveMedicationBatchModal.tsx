import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import {
  addDaysToDateKey,
  createMedicationBatch,
  toDateKey,
} from '@/services/pharmacyService';
import type { MedicationBatch } from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/** Receives a physical delivery into the pharmacy store as one FEFO batch. */
interface ReceiveBatchProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  canWrite: boolean;
  defaultMedicationName?: string;
  onCreated?: (batch: MedicationBatch) => void;
}

export function ReceiveMedicationBatchModal({
  open,
  defaultMedicationName = '',
  ...props
}: ReceiveBatchProps) {
  if (!open) return null;
  return (
    <ReceiveBatchBody
      key={defaultMedicationName}
      defaultMedicationName={defaultMedicationName}
      {...props}
    />
  );
}

function ReceiveBatchBody({
  onClose,
  businessId,
  canWrite,
  defaultMedicationName,
  onCreated,
}: Omit<ReceiveBatchProps, 'open'> & { defaultMedicationName: string }) {
  const { t } = useTranslation();
  const today = toDateKey();
  const earliestExpiry = addDaysToDateKey(today, 1);
  const [medicationName, setMedicationName] = useState(defaultMedicationName);
  const [batchNumber, setBatchNumber] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [receivedDate, setReceivedDate] = useState(today);
  const [supplierName, setSupplierName] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setError(null);
    setIsSaving(true);
    try {
      const batch = await createMedicationBatch({
        businessId,
        medicationName,
        batchNumber,
        quantityReceived: Number(quantity),
        unitCost: Number(unitCost || 0),
        expiryDate,
        receivedDate: receivedDate || today,
        supplierName,
        storageLocation,
        notes,
      });
      onCreated?.(batch);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.pharmacy.receive.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <HealthcareModal
      open
      titleId="receive-batch-title"
      title={t('healthcare.pharmacy.receive.title')}
      subtitle={t('healthcare.pharmacy.receive.subtitle')}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.common.cancel')}
          </Button>
          <Button type="submit" form="receive-batch-form" isLoading={isSaving} disabled={!canWrite}>
            <PackagePlus className="h-4 w-4" aria-hidden />
            {t('healthcare.pharmacy.receive.submit')}
          </Button>
        </>
      }
    >
      <form id="receive-batch-form" onSubmit={submit} className="space-y-4">
        {error ? <ErrorNotice message={error} /> : null}
        {!canWrite ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('healthcare.pharmacy.receive.readOnly')}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.medicationName')}
            </span>
            <input
              type="text"
              required
              value={medicationName}
              onChange={(event) => setMedicationName(event.target.value)}
              placeholder={t('healthcare.pharmacy.receive.medicationPlaceholder')}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.batchNumber')}
            </span>
            <input
              type="text"
              required
              value={batchNumber}
              onChange={(event) => setBatchNumber(event.target.value)}
              placeholder={t('healthcare.pharmacy.receive.batchPlaceholder')}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.quantity')}
            </span>
            <input
              type="number"
              required
              min={0.01}
              step="0.01"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.unitCost')}
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.expiryDate')}
            </span>
            <input
              type="date"
              required
              min={earliestExpiry}
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              className={INPUT_CLASS}
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              {t('healthcare.pharmacy.receive.expiryHint')}
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.receivedDate')}
            </span>
            <input
              type="date"
              value={receivedDate}
              onChange={(event) => setReceivedDate(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.supplier')}
            </span>
            <input
              type="text"
              value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.storageLocation')}
            </span>
            <input
              type="text"
              value={storageLocation}
              onChange={(event) => setStorageLocation(event.target.value)}
              placeholder={t('healthcare.pharmacy.receive.storagePlaceholder')}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.receive.notes')}
            </span>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </div>
      </form>
    </HealthcareModal>
  );
}
