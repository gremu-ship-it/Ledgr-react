import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, PackageCheck, Pill, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice } from '@/components/healthcare/healthcareUi';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { useAppStore } from '@/store/useAppStore';
import { formatCurrency } from '@/lib/formatters';
import { formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import {
  NEAR_EXPIRY_DAYS,
  daysUntilExpiry,
  dispensePrescriptionItem,
  getBatchExpiryStatus,
  getMedicationBatches,
  isBatchExpired,
  pickFefoBatch,
  type DispenseResult,
} from '@/services/pharmacyService';
import type {
  MedicationLabelPayload,
  PharmacyQueueVisit,
  Prescription,
  PrescriptionItem,
} from '@/types/healthcare';

const INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export interface DispenseTarget {
  visit: PharmacyQueueVisit;
  prescription: Prescription;
  item: PrescriptionItem;
}

/**
 * FEFO dispensing dialog. Stock validation is repeated in the database RPC;
 * this screen only presents the earliest-expiring usable batch and explains why
 * a batch is blocked.
 */
interface DispenseModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  target: DispenseTarget | null;
  canWrite: boolean;
  onDispensed?: (result: DispenseResult) => void;
  onPrintLabel?: (payload: MedicationLabelPayload) => void;
}

/**
 * The dialog body is a separate component so every opening starts from the
 * selected item's quantity (state resets by remount instead of an effect).
 */
export function DispensePrescriptionModal(props: DispenseModalProps) {
  const { open, target } = props;
  if (!open || !target) return null;
  return (
    <DispenseModalBody
      key={`${target.visit.id}:${target.prescription.id}:${target.item.id}`}
      {...props}
      target={target}
    />
  );
}

function DispenseModalBody({
  open,
  onClose,
  businessId,
  target,
  canWrite,
  onDispensed,
  onPrintLabel,
}: Omit<DispenseModalProps, 'target'> & { target: DispenseTarget }) {
  const { t } = useTranslation();
  const currency = useAppStore((state) => state.currentBusiness?.business?.base_currency ?? 'MWK');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(
    String(Math.max(0.01, target.item.quantity - (target.item.quantity_dispensed ?? 0))),
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DispenseResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const medicationName = target.item.medication_name;

  const batchesQuery = useQuery({
    queryKey: ['healthcare', 'pharmacy', 'batches', businessId, medicationName],
    queryFn: () => getMedicationBatches(businessId as string, medicationName),
    enabled: open && Boolean(businessId) && Boolean(medicationName),
    staleTime: 10_000,
  });

  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const fefoBatch = useMemo(() => pickFefoBatch(batches), [batches]);

  const effectiveBatchId = selectedBatchId ?? fefoBatch?.id ?? '';
  const selectedBatch = batches.find((batch) => batch.id === effectiveBatchId) ?? null;
  const quantityNumber = Number(quantity);
  const quantityValid = Number.isFinite(quantityNumber) && quantityNumber > 0;
  const stockShort = Boolean(
    selectedBatch && quantityValid && quantityNumber > selectedBatch.quantity_on_hand,
  );
  const selectedExpired = selectedBatch ? isBatchExpired(selectedBatch) : false;
  const remainingToDispense = Math.max(
    0,
    target.item.quantity - (target.item.quantity_dispensed ?? 0),
  );
  const overRemaining = quantityValid && quantityNumber > remainingToDispense;
  const selectedDays = selectedBatch ? daysUntilExpiry(selectedBatch) : 0;
  const canSubmit =
    canWrite &&
    Boolean(selectedBatch) &&
    quantityValid &&
    !stockShort &&
    !selectedExpired &&
    !overRemaining;

  const patientName = patientDisplayName(target.visit.patient) || t('healthcare.workspace.unknownPatient');
  const partialSuccess = result?.itemFullyDispensed === false;

  const submit = async () => {
    if (!businessId || !selectedBatch || !quantityValid) return;
    setError(null);
    setIsSaving(true);
    try {
      const dispensed = await dispensePrescriptionItem({
        businessId,
        prescriptionItemId: target.item.id,
        batchId: selectedBatch.id,
        quantity: quantityNumber,
        notes: notes.trim() || null,
      });
      setResult(dispensed);
      onDispensed?.(dispensed);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t('healthcare.pharmacy.dispense.error'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const printLabel = () => {
    if (!selectedBatch || !onPrintLabel) return;
    const allergies = (target.visit.patient?.allergies ?? []).filter(Boolean);
    onPrintLabel({
      patientName,
      mrn: target.visit.patient?.mrn ?? '',
      medicationName: target.item.medication_name,
      dosage: target.item.dosage,
      frequency: target.item.frequency,
      durationDays: target.item.duration_days,
      quantity: quantityNumber,
      instructions: target.item.instructions,
      batchNumber: selectedBatch.batch_number,
      expiryDate: selectedBatch.expiry_date,
      dispensedAt: new Date().toISOString(),
      warnings: allergies.map((allergy) =>
        t('healthcare.pharmacy.dispense.allergyWarning', { allergy }),
      ),
    });
  };

  return (
    <HealthcareModal
      open={open}
      titleId="dispense-prescription-title"
      title={t('healthcare.pharmacy.dispense.title')}
      subtitle={`${patientName} · ${target.visit.patient?.mrn ?? ''} · ${target.visit.visit_number}`}
      closeLabel={t('healthcare.common.close')}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        result ? (
          <>
            {onPrintLabel ? (
              <Button variant="secondary" onClick={printLabel}>
                <Printer className="h-4 w-4" aria-hidden />
                {t('healthcare.pharmacy.dispense.printLabel')}
              </Button>
            ) : null}
            <Button onClick={onClose}>{t('healthcare.common.done')}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('healthcare.common.cancel')}
            </Button>
            <Button onClick={submit} isLoading={isSaving} disabled={!canSubmit}>
              <PackageCheck className="h-4 w-4" aria-hidden />
              {t('healthcare.pharmacy.dispense.confirm')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <div
            className={`flex items-start gap-3 rounded-xl border p-4 ${
              partialSuccess
                ? 'border-amber-200 bg-amber-50'
                : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            {partialSuccess ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
            )}
            <div>
              <p
                className={`text-sm font-semibold ${
                  partialSuccess ? 'text-amber-800' : 'text-emerald-800'
                }`}
              >
                {partialSuccess
                  ? t('healthcare.pharmacy.dispense.partialSuccessTitle')
                  : t('healthcare.pharmacy.dispense.successTitle')}
              </p>
              <p
                className={`mt-0.5 text-xs ${
                  partialSuccess ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {t('healthcare.pharmacy.dispense.successBody', {
                  medication: target.item.medication_name,
                  quantity: result.quantityDispensed,
                  remaining: result.batchQuantityRemaining,
                })}
              </p>
              {partialSuccess ? (
                <p className="mt-1 text-xs font-medium text-amber-800">
                  {t('healthcare.pharmacy.dispense.partialSuccessBody', {
                    remaining: result.quantityRemainingOnItem ?? 0,
                  })}
                </p>
              ) : null}
              <p
                className={`mt-1 text-xs ${
                  partialSuccess ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {t('healthcare.pharmacy.dispense.visitStage', {
                  stage: t(`healthcare.queueStage.${result.visitStage}`),
                })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? <ErrorNotice message={error} /> : null}
          {!canWrite ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('healthcare.pharmacy.dispense.readOnly')}
            </div>
          ) : null}

          <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-700 ring-1 ring-gray-200">
                <Pill className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{target.item.medication_name}</p>
                <p className="text-xs text-gray-600">
                  {target.item.dosage} · {target.item.frequency} ·{' '}
                  {t('healthcare.pharmacy.dispense.prescribedQuantity', {
                    quantity: target.item.quantity,
                  })}
                </p>
                {target.item.instructions ? (
                  <p className="mt-1 text-xs text-gray-500">{target.item.instructions}</p>
                ) : null}
              </div>
            </div>
          </section>

          <div>
            <p className="text-xs font-semibold text-gray-600">
              {t('healthcare.pharmacy.dispense.batchLabel')}
            </p>
            <p className="text-[11px] text-gray-400">{t('healthcare.pharmacy.dispense.fefoHint')}</p>

            {batchesQuery.isLoading ? (
              <p className="mt-2 text-sm text-gray-500">{t('healthcare.pharmacy.dispense.loadingBatches')}</p>
            ) : null}
            {batchesQuery.isError ? (
              <ErrorNotice
                message={
                  batchesQuery.error instanceof Error
                    ? batchesQuery.error.message
                    : t('healthcare.pharmacy.dispense.batchError')
                }
              />
            ) : null}
            {!batchesQuery.isLoading && batches.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
                {t('healthcare.pharmacy.dispense.noStock')}
              </div>
            ) : null}

            <div className="mt-2 space-y-2">
              {batches.map((batch) => {
                const expiryStatus = getBatchExpiryStatus(batch);
                const expired = expiryStatus === 'expired';
                const days = daysUntilExpiry(batch);
                const isSelected = batch.id === effectiveBatchId;
                return (
                  <label
                    key={batch.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                      expired
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                        : isSelected
                          ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-200'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="medication-batch"
                      value={batch.id}
                      checked={isSelected}
                      disabled={expired}
                      onChange={() => setSelectedBatchId(batch.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-gray-900">
                          {batch.batch_number}
                        </span>
                        {batch.id === fefoBatch?.id ? (
                          <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800">
                            {t('healthcare.pharmacy.dispense.fefoBadge')}
                          </span>
                        ) : null}
                        {expiryStatus === 'expired' ? (
                          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                            {t('healthcare.pharmacy.batch.statusExpired')}
                          </span>
                        ) : expiryStatus === 'near_expiry' ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                            {t('healthcare.pharmacy.batch.statusNearExpiry')}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[11px] text-gray-500">
                        {t('healthcare.pharmacy.batch.expiryOn', {
                          date: formatDateValue(batch.expiry_date),
                        })}
                        {' · '}
                        {t('healthcare.pharmacy.batch.onHand', {
                          quantity: batch.quantity_on_hand,
                        })}
                        {' · '}
                        {formatCurrency(batch.unit_cost, currency)}
                      </span>
                      {expiryStatus === 'near_expiry' ? (
                        <span className="mt-1 block text-[11px] font-medium text-amber-700">
                          {t('healthcare.pharmacy.dispense.nearExpiryWarning', { days })}
                        </span>
                      ) : null}
                      {expired ? (
                        <span className="mt-1 block text-[11px] font-medium text-red-700">
                          {t('healthcare.pharmacy.dispense.expiredBatch')}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">
                {t('healthcare.pharmacy.dispense.quantity')}
              </span>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">
                {t('healthcare.pharmacy.dispense.notes')}
              </span>
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t('healthcare.pharmacy.dispense.notesPlaceholder')}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          {overRemaining ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {t('healthcare.pharmacy.dispense.overQuantity', {
                remaining: remainingToDispense,
              })}
            </div>
          ) : null}
          {quantityValid && quantityNumber < remainingToDispense ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('healthcare.pharmacy.dispense.partialWarning', {
                prescribed: remainingToDispense,
              })}
            </div>
          ) : null}
          {stockShort && selectedBatch ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {t('healthcare.pharmacy.dispense.insufficientStock', {
                onHand: selectedBatch.quantity_on_hand,
              })}
            </div>
          ) : null}
          {selectedExpired ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {t('healthcare.pharmacy.dispense.expiredBlocked')}
            </div>
          ) : null}
          {selectedDays > 0 && selectedDays <= NEAR_EXPIRY_DAYS && !selectedExpired ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('healthcare.pharmacy.dispense.nearExpiryWarning', { days: selectedDays })}
            </div>
          ) : null}
        </div>
      )}
    </HealthcareModal>
  );
}
