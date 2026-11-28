import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  History,
  Package,
  PackagePlus,
  Pill,
  Search,
  Stethoscope,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  AllergyPills,
  ErrorNotice,
  LoadingNotice,
  StageBadge,
} from '@/components/healthcare/healthcareUi';
import { MedicationLabelPrinter } from '@/components/healthcare/MedicationLabelPrinter';
import { ReceiveMedicationBatchModal } from '@/components/healthcare/ReceiveMedicationBatchModal';
import {
  DispensePrescriptionModal,
  type DispenseTarget,
} from '@/components/healthcare/DispensePrescriptionModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { formatCurrency } from '@/lib/formatters';
import { formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import {
  daysUntilExpiry,
  getBatchExpiryStatus,
  getDispensationLogs,
  getPharmacyDispensaryQueue,
  listMedicationBatches,
} from '@/services/pharmacyService';
import type { VisitStage } from '@/services/healthcareService';
import type { MedicationLabelPayload } from '@/types/healthcare';

type PharmacyTab = 'queue' | 'batches' | 'logs';

const TAB_ICONS = {
  queue: Stethoscope,
  batches: Boxes,
  logs: History,
} as const;

const EXPIRY_STYLES = {
  expired: 'border-red-200 bg-red-50 text-red-700',
  near_expiry: 'border-amber-200 bg-amber-50 text-amber-800',
  valid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
} as const;

/** Pharmacy counter: dispense queue, FEFO stock and the hand-out audit trail. */
export function PharmacyStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [tab, setTab] = useState<PharmacyTab>('queue');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<DispenseTarget | null>(null);
  const [labelPayload, setLabelPayload] = useState<MedicationLabelPayload | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const queueQuery = useQuery({
    queryKey: ['healthcare', 'pharmacy', 'queue', businessId],
    queryFn: () => getPharmacyDispensaryQueue(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });

  const batchesQuery = useQuery({
    queryKey: ['healthcare', 'pharmacy', 'batches', businessId, 'all'],
    queryFn: () => listMedicationBatches(businessId as string),
    enabled: Boolean(businessId) && (tab === 'batches' || tab === 'queue'),
    staleTime: 15_000,
  });

  const logsQuery = useQuery({
    queryKey: ['healthcare', 'pharmacy', 'logs', businessId],
    queryFn: () => getDispensationLogs(businessId as string),
    enabled: Boolean(businessId) && tab === 'logs',
    staleTime: 10_000,
  });

  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);

  const pendingLines = useMemo(
    () =>
      queue.reduce(
        (total, visit) =>
          total +
          visit.prescriptions.reduce(
            (count, prescription) => count + prescription.items.length,
            0,
          ),
        0,
      ),
    [queue],
  );

  const nearExpiryCount = useMemo(
    () => batches.filter((batch) => getBatchExpiryStatus(batch) === 'near_expiry').length,
    [batches],
  );

  const filteredBatches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return batches;
    return batches.filter(
      (batch) =>
        batch.medication_name.toLowerCase().includes(term) ||
        batch.batch_number.toLowerCase().includes(term) ||
        (batch.supplier_name ?? '').toLowerCase().includes(term),
    );
  }, [batches, query]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'pharmacy'] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'bill'] });
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Pill className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('healthcare.pharmacy.title')}
            </h1>
            <p className="text-sm text-gray-500">{t('healthcare.pharmacy.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/healthcare/catalogue"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <Package className="h-4 w-4" aria-hidden />
            {t('healthcare.catalogue.title')}
          </Link>
          <Button onClick={() => setReceiveOpen(true)} disabled={!canWrite}>
            <PackagePlus className="h-4 w-4" aria-hidden />
            {t('healthcare.pharmacy.receive.button')}
          </Button>
        </div>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.pharmacy.metrics.visits')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{queue.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.pharmacy.metrics.lines')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{pendingLines}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {t('healthcare.pharmacy.metrics.nearExpiry')}
          </p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-gray-900">
            {nearExpiryCount}
            {nearExpiryCount > 0 ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            ) : null}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-gray-200">
        {(['queue', 'batches', 'logs'] as const).map((option) => {
          const Icon = TAB_ICONS[option];
          return (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              aria-pressed={tab === option}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition ${
                tab === option
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(`healthcare.pharmacy.tabs.${option}`)}
            </button>
          );
        })}
      </div>

      {tab === 'queue' ? (
        <section className="space-y-3">
          {queueQuery.isLoading ? (
            <LoadingNotice label={t('healthcare.pharmacy.queue.loading')} />
          ) : null}
          {queueQuery.isError ? (
            <ErrorNotice
              message={
                queueQuery.error instanceof Error
                  ? queueQuery.error.message
                  : t('healthcare.pharmacy.queue.error')
              }
            />
          ) : null}
          {!queueQuery.isLoading && queue.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.pharmacy.queue.emptyTitle')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.pharmacy.queue.emptyHint')}
              </p>
            </div>
          ) : null}

          {queue.map((visit) => (
            <article
              key={visit.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    {patientDisplayName(visit.patient) || t('healthcare.workspace.unknownPatient')}
                  </h2>
                  <p className="font-mono text-xs text-gray-500">
                    {visit.patient?.mrn} · {visit.visit_number} ·{' '}
                    {formatDateValue(visit.visit_date)}
                  </p>
                  <div className="mt-1.5">
                    <AllergyPills allergies={visit.patient?.allergies} />
                  </div>
                </div>
                <StageBadge stage={visit.stage as VisitStage} />
              </div>

              <div className="mt-3 divide-y divide-gray-100">
                {visit.prescriptions.map((prescription) => (
                  <div key={prescription.id} className="py-2 first:pt-0 last:pb-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {t('healthcare.pharmacy.queue.script', {
                        date: formatDateValue(prescription.created_at),
                      })}
                    </p>
                    <ul className="mt-1.5 space-y-2">
                      {prescription.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">
                              {item.medication_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {item.dosage} · {item.frequency} ·{' '}
                              {t('healthcare.pharmacy.queue.duration', {
                                days: item.duration_days,
                              })}{' '}
                              ·{' '}
                              {item.quantity_dispensed && item.quantity_dispensed > 0
                                ? t('healthcare.pharmacy.queue.partialQuantity', {
                                    dispensed: item.quantity_dispensed,
                                    quantity: item.quantity,
                                  })
                                : t('healthcare.pharmacy.queue.quantity', {
                                    quantity: item.quantity,
                                  })}
                            </p>
                            {item.instructions ? (
                              <p className="mt-0.5 text-[11px] text-gray-400">{item.instructions}</p>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            disabled={!canWrite}
                            onClick={() =>
                              setTarget({ visit, prescription, item })
                            }
                          >
                            <Pill className="h-3.5 w-3.5" aria-hidden />
                            {t('healthcare.pharmacy.queue.dispense')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {tab === 'batches' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="relative min-w-[240px] flex-1 sm:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('healthcare.pharmacy.batches.searchPlaceholder')}
                aria-label={t('healthcare.pharmacy.batches.searchPlaceholder')}
                className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <p className="text-xs text-gray-500">
              {t('healthcare.pharmacy.batches.count', { total: filteredBatches.length })}
            </p>
          </div>

          {batchesQuery.isLoading ? (
            <LoadingNotice label={t('healthcare.pharmacy.batches.loading')} />
          ) : null}
          {batchesQuery.isError ? (
            <ErrorNotice
              message={
                batchesQuery.error instanceof Error
                  ? batchesQuery.error.message
                  : t('healthcare.pharmacy.batches.error')
              }
            />
          ) : null}

          {!batchesQuery.isLoading && filteredBatches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <Boxes className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.pharmacy.batches.emptyTitle')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.pharmacy.batches.emptyHint')}
              </p>
            </div>
          ) : null}

          {filteredBatches.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.batches.medication')}
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.batches.batchNumber')}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t('healthcare.pharmacy.batches.onHand')}
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.batches.expiry')}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t('healthcare.pharmacy.batches.unitCost')}
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.batches.supplier')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBatches.map((batch) => {
                    const expiryStatus = getBatchExpiryStatus(batch);
                    const days = daysUntilExpiry(batch);
                    return (
                      <tr key={batch.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{batch.medication_name}</p>
                          {batch.storage_location ? (
                            <p className="text-[11px] text-gray-400">{batch.storage_location}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">
                          {batch.batch_number}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {batch.quantity_on_hand}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${EXPIRY_STYLES[expiryStatus]}`}
                          >
                            {expiryStatus !== 'valid' ? (
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                            ) : null}
                            {formatDateValue(batch.expiry_date)}
                          </span>
                          {expiryStatus === 'near_expiry' ? (
                            <p className="mt-1 text-[11px] text-amber-700">
                              {t('healthcare.pharmacy.batches.expiresIn', { days })}
                            </p>
                          ) : null}
                          {expiryStatus === 'expired' ? (
                            <p className="mt-1 text-[11px] font-medium text-red-700">
                              {t('healthcare.pharmacy.batches.expired')}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {formatCurrency(batch.unit_cost, currency)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {batch.supplier_name || t('healthcare.common.notRecorded')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'logs' ? (
        <section className="space-y-3">
          {logsQuery.isLoading ? (
            <LoadingNotice label={t('healthcare.pharmacy.logs.loading')} />
          ) : null}
          {logsQuery.isError ? (
            <ErrorNotice
              message={
                logsQuery.error instanceof Error
                  ? logsQuery.error.message
                  : t('healthcare.pharmacy.logs.error')
              }
            />
          ) : null}
          {!logsQuery.isLoading && logs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <History className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm font-medium text-gray-700">
                {t('healthcare.pharmacy.logs.emptyTitle')}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('healthcare.pharmacy.logs.emptyHint')}
              </p>
            </div>
          ) : null}

          {logs.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.logs.dispensedAt')}
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.logs.medication')}
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('healthcare.pharmacy.logs.batch')}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t('healthcare.pharmacy.logs.quantity')}
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      {t('healthcare.pharmacy.logs.unitPrice')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {formatDateValue(log.dispensed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {log.item?.medication_name ??
                            log.batch?.medication_name ??
                            t('healthcare.common.notRecorded')}
                        </p>
                        {log.item?.dosage ? (
                          <p className="text-[11px] text-gray-400">{log.item.dosage}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {log.batch?.batch_number ?? '—'}
                        {log.batch?.expiry_date ? (
                          <p className="font-sans text-[11px] text-gray-400">
                            {t('healthcare.pharmacy.logs.expiry', {
                              date: formatDateValue(log.batch.expiry_date),
                            })}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {log.quantity_dispensed}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatCurrency(log.unit_price, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <ReceiveMedicationBatchModal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        businessId={businessId}
        canWrite={canWrite}
        onCreated={() => {
          invalidate();
          setTab('batches');
        }}
      />

      <DispensePrescriptionModal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        businessId={businessId}
        target={target}
        canWrite={canWrite}
        onDispensed={() => invalidate()}
        onPrintLabel={(payload) => {
          setTarget(null);
          setLabelPayload(payload);
        }}
      />

      <MedicationLabelPrinter
        open={Boolean(labelPayload)}
        onClose={() => setLabelPayload(null)}
        payload={labelPayload}
      />
    </div>
  );
}
