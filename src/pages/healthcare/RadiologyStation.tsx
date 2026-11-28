import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  Images,
  ScanLine,
  Stethoscope,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AcuityBadge } from '@/components/healthcare/AcuityBadge';
import { QueueTokenBadge } from '@/components/healthcare/QueueTokenBadge';
import { RadiologyReportPdfModal } from '@/components/healthcare/RadiologyReportPdfModal';
import { ErrorNotice, Field, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { usePermissions } from '@/hooks/usePermissions';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { useAppStore } from '@/store/useAppStore';
import {
  listRadiologyOrders,
  RADIOLOGY_MODALITIES,
  recordScanFindings,
} from '@/services/radiologyService';
import { calculateAge, formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import type {
  RadiologyModality,
  RadiologyOrder,
  RadiologyOrderItem,
  RadiologyOrderStatus,
  RadiologyReportData,
} from '@/types/healthcare';

type StatusFilter = 'open' | 'completed' | 'all';

const STATUS_STYLES: Record<RadiologyOrderStatus, string> = {
  ordered: 'border-slate-200 bg-slate-50 text-slate-700',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-700',
  in_progress: 'border-amber-200 bg-amber-50 text-amber-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};

const URGENCY_STYLES: Record<string, string> = {
  routine: 'border-gray-200 bg-white text-gray-600',
  urgent: 'border-amber-300 bg-amber-50 text-amber-800',
  stat: 'border-red-300 bg-red-50 text-red-700',
};

function orderPatientLabel(order: RadiologyOrder): string {
  const age = calculateAge(order.patient?.date_of_birth);
  return [patientDisplayName(order.patient), age === null ? null : `${age}y`]
    .filter(Boolean)
    .join(' · ');
}

function itemIsOpen(item: RadiologyOrderItem): boolean {
  return item.status !== 'completed' && item.status !== 'cancelled';
}

/**
 * Radiology / Imaging Station: modality worklist, findings + impression
 * capture, scan sign-off and the printable imaging report.
 */
export function RadiologyStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currentUser = useAppStore((state) => state.currentUser);
  const { canWrite } = usePermissions();
  const { businessName } = useBrandTheme();

  const doctorName = currentUser?.profile?.full_name || currentUser?.email || null;

  const [modality, setModality] = useState<'all' | RadiologyModality>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [imageUrls, setImageUrls] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reportData, setReportData] = useState<RadiologyReportData | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['healthcare', 'radiology', 'orders', businessId],
    queryFn: () => listRadiologyOrders(businessId as string, { limit: 300 }),
    enabled: Boolean(businessId),
    staleTime: 8_000,
    refetchInterval: 20_000,
  });

  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);

  const filteredOrders = useMemo(() => {
    const urgencyRank: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };
    return orders
      .filter((order) => {
        if (statusFilter === 'open' && order.status === 'completed') return false;
        if (statusFilter === 'completed' && order.status !== 'completed') return false;
        if (modality === 'all') return true;
        return (order.items ?? []).some((item) => item.modality === modality);
      })
      .sort((left, right) => {
        const byUrgency =
          (urgencyRank[left.urgency] ?? 3) - (urgencyRank[right.urgency] ?? 3);
        if (byUrgency !== 0) return byUrgency;
        return String(left.ordered_at ?? '').localeCompare(String(right.ordered_at ?? ''));
      });
  }, [orders, modality, statusFilter]);

  const selectedOrder =
    filteredOrders.find((order) => order.id === selectedOrderId) ??
    orders.find((order) => order.id === selectedOrderId) ??
    null;
  const selectedItem =
    (selectedOrder?.items ?? []).find((item) => item.id === selectedItemId) ??
    (selectedOrder?.items ?? []).find(itemIsOpen) ??
    null;

  const openCount = orders.filter((order) => order.status !== 'completed').length;
  const completedCount = orders.filter((order) => order.status === 'completed').length;

  const selectItem = (order: RadiologyOrder, item: RadiologyOrderItem) => {
    setSelectedOrderId(order.id);
    setSelectedItemId(item.id ?? null);
    setFindings(item.findings ?? '');
    setImpression(item.impression ?? '');
    setRecommendations(item.recommendations ?? '');
    setImageUrls((item.image_urls ?? []).join('\n'));
    setError(null);
    setSuccess(null);
  };

  const selectOrder = (order: RadiologyOrder) => {
    const item = (order.items ?? []).find(itemIsOpen) ?? (order.items ?? [])[0];
    if (item) {
      selectItem(order, item);
    } else {
      setSelectedOrderId(order.id);
      setSelectedItemId(null);
      setFindings('');
      setImpression('');
      setRecommendations('');
      setImageUrls('');
    }
  };

  const buildReportData = (
    order: RadiologyOrder,
    item: RadiologyOrderItem,
    overrides: {
      findings?: string;
      impression?: string;
      recommendations?: string | null;
      imageUrls?: string[];
    } = {},
  ): RadiologyReportData => ({
    businessName: businessName || business?.name || 'Ledgr Clinic',
    orderNumber: order.order_number,
    patientName: patientDisplayName(order.patient),
    mrn: order.patient?.mrn ?? '',
    modality: t(`healthcare.radiology.modalities.${item.modality}`),
    procedureName: item.procedure_name,
    bodySite: item.body_site,
    clinicalIndication: order.clinical_indication,
    findings: overrides.findings ?? item.findings ?? '',
    impression: overrides.impression ?? item.impression ?? '',
    recommendations: overrides.recommendations ?? item.recommendations ?? null,
    imageUrls: overrides.imageUrls ?? item.image_urls ?? [],
    performedAt: item.performed_at ? formatDateValue(item.performed_at) : null,
    reportedAt: item.reported_at
      ? formatDateValue(item.reported_at)
      : new Date().toLocaleString(),
    radiologist: doctorName,
    technician: null,
    labels: {
      title: t('healthcare.radiology.labels.title'),
      patient: t('healthcare.radiology.labels.patient'),
      mrn: t('healthcare.radiology.labels.mrn'),
      modality: t('healthcare.radiology.labels.modality'),
      procedure: t('healthcare.radiology.labels.procedure'),
      bodySite: t('healthcare.radiology.labels.bodySite'),
      indication: t('healthcare.radiology.labels.indication'),
      findings: t('healthcare.radiology.labels.findings'),
      impression: t('healthcare.radiology.labels.impression'),
      recommendations: t('healthcare.radiology.labels.recommendations'),
      images: t('healthcare.radiology.labels.images'),
      performedAt: t('healthcare.radiology.labels.performedAt'),
      reportedAt: t('healthcare.radiology.labels.reportedAt'),
      radiologist: t('healthcare.radiology.labels.radiologist'),
      technician: t('healthcare.radiology.labels.technician'),
      signature: t('healthcare.radiology.labels.signature'),
      disclaimer: t('healthcare.radiology.labels.disclaimer'),
    },
  });

  const handleSignOff = async () => {
    if (!businessId || !selectedOrder || !selectedItem?.id) {
      setError(t('healthcare.radiology.selectScanFirst'));
      return;
    }
    if (!findings.trim() || !impression.trim()) {
      setError(t('healthcare.radiology.saveError'));
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const urls = imageUrls
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      await recordScanFindings({
        businessId,
        itemId: selectedItem.id,
        orderId: selectedOrder.id,
        findings,
        impression,
        recommendations: recommendations.trim() || null,
        imageUrls: urls,
        radiologistId: currentUser?.id ?? null,
      });

      setReportData(
        buildReportData(selectedOrder, selectedItem, {
          findings,
          impression,
          recommendations: recommendations.trim() || null,
          imageUrls: urls,
        }),
      );
      setSuccess(t('healthcare.radiology.success'));
      setSelectedItemId(null);
      await queryClient.invalidateQueries({ queryKey: ['healthcare'] });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('healthcare.radiology.saveError'),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
            <ScanLine className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.radiology.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.radiology.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 font-semibold text-cyan-800">
            {openCount} {t('healthcare.radiology.worklist')}
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">
            {completedCount} {t('healthcare.radiology.statuses.completed')}
          </span>
        </div>
      </header>

      {success && (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(['open', 'completed', 'all'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              statusFilter === status
                ? 'bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {status === 'open'
              ? t('healthcare.radiology.worklist')
              : status === 'completed'
                ? t('healthcare.radiology.statuses.completed')
                : t('healthcare.radiology.filterAll')}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setModality('all')}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            modality === 'all'
              ? 'border-cyan-300 bg-cyan-50 text-cyan-800'
              : 'border-gray-200 bg-white text-gray-600'
          }`}
        >
          {t('healthcare.radiology.filterAll')}
        </button>
        {RADIOLOGY_MODALITIES.map((value) => {
          const count = orders.filter((order) =>
            (order.items ?? []).some((item) => item.modality === value),
          ).length;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setModality(value)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                modality === value
                  ? 'border-cyan-300 bg-cyan-50 text-cyan-800'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              {t(`healthcare.radiology.modalities.${value}`)}
              {count > 0 && <span className="ml-1 text-[10px] opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,5fr)_minmax(0,7fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <ClipboardList className="h-4 w-4 text-gray-400" aria-hidden />
              {t('healthcare.radiology.worklist')}
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-500">{t('healthcare.radiology.worklistHint')}</p>
          </div>

          {ordersQuery.isLoading && (
            <div className="p-4"><LoadingNotice label={t('healthcare.radiology.loading')} /></div>
          )}
          {ordersQuery.isError && (
            <div className="p-4"><ErrorNotice message={t('healthcare.radiology.loadError')} /></div>
          )}
          {ordersQuery.isSuccess && filteredOrders.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Images className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm text-gray-500">{t('healthcare.radiology.noOrders')}</p>
            </div>
          )}

          <ul className="divide-y divide-gray-100">
            {filteredOrders.map((order) => {
              const items = (order.items ?? []).filter(
                (item) => modality === 'all' || item.modality === modality,
              );
              const isSelected = order.id === selectedOrderId;
              return (
                <li key={order.id} className={isSelected ? 'bg-cyan-50/50' : ''}>
                  <button
                    type="button"
                    onClick={() => selectOrder(order)}
                    className="w-full px-4 py-3 text-left transition hover:bg-gray-50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-gray-500">
                        {order.order_number}
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${URGENCY_STYLES[order.urgency] ?? ''}`}
                        >
                          {t(`healthcare.radiology.urgencies.${order.urgency}`)}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[order.status]}`}
                        >
                          {t(`healthcare.radiology.statuses.${order.status}`)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900">
                        {patientDisplayName(order.patient)}
                      </span>
                      <AcuityBadge acuity={order.visit?.acuity_level} showIcon={false} />
                      <QueueTokenBadge token={order.visit?.queue_token} size="sm" />
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {orderPatientLabel(order)} · {order.patient?.mrn ?? '—'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {items.map((item) => (
                        <span
                          key={item.id ?? `${order.id}-${item.procedure_name}`}
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                            itemIsOpen(item)
                              ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {t(`healthcare.radiology.modalities.${item.modality}`)} ·{' '}
                          {item.procedure_name}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-4">
          {!selectedOrder ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
              <ScanLine className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
              <p className="mt-2 text-sm text-gray-500">{t('healthcare.radiology.selectHint')}</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-bold text-cyan-700">
                      {selectedOrder.order_number}
                    </p>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {patientDisplayName(selectedOrder.patient)}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {selectedOrder.patient?.mrn ?? '—'} ·{' '}
                      {selectedOrder.visit?.visit_number ?? '—'} ·{' '}
                      {formatDateValue(selectedOrder.ordered_at)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>
                      {t('healthcare.radiology.urgency')}:{' '}
                      <span className="font-semibold text-gray-800">
                        {t(`healthcare.radiology.urgencies.${selectedOrder.urgency}`)}
                      </span>
                    </p>
                    <p>
                      {t('healthcare.radiology.indication')}:{' '}
                      {selectedOrder.clinical_indication || '—'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">
                  {t('healthcare.radiology.scanLines')}
                </h3>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(selectedOrder.items ?? []).map((item) => (
                    <button
                      key={item.id ?? item.procedure_name}
                      type="button"
                      onClick={() => selectItem(selectedOrder, item)}
                      className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold transition ${
                        selectedItem?.id === item.id
                          ? 'border-cyan-300 bg-cyan-50 text-cyan-900 ring-1 ring-cyan-200'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {t(`healthcare.radiology.modalities.${item.modality}`)} ·{' '}
                      {item.procedure_name}
                      {!itemIsOpen(item) && (
                        <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-600" aria-hidden />
                      )}
                    </button>
                  ))}
                </div>

                {selectedItem ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-semibold">
                        {t(`healthcare.radiology.statuses.${selectedItem.status}`)}
                      </span>
                      {selectedItem.body_site && (
                        <span>
                          {t('healthcare.radiology.bodySite')}: {selectedItem.body_site}
                        </span>
                      )}
                      {selectedItem.performed_at && (
                        <span>
                          {t('healthcare.radiology.performedAt')}:{' '}
                          {formatDateValue(selectedItem.performed_at)}
                        </span>
                      )}
                      {!itemIsOpen(selectedItem) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setReportData(buildReportData(selectedOrder, selectedItem))
                          }
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          {t('healthcare.radiology.reportTitle')}
                        </Button>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Field label={t('healthcare.radiology.findings')}>
                        <textarea
                          value={findings}
                          onChange={(event) => setFindings(event.target.value)}
                          rows={4}
                          placeholder={t('healthcare.radiology.findingsPlaceholder')}
                          disabled={!canWrite || !itemIsOpen(selectedItem)}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                        />
                      </Field>
                      <Field label={t('healthcare.radiology.impression')}>
                        <textarea
                          value={impression}
                          onChange={(event) => setImpression(event.target.value)}
                          rows={3}
                          placeholder={t('healthcare.radiology.impressionPlaceholder')}
                          disabled={!canWrite || !itemIsOpen(selectedItem)}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                        />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t('healthcare.radiology.recommendations')}>
                          <textarea
                            value={recommendations}
                            onChange={(event) => setRecommendations(event.target.value)}
                            rows={2}
                            placeholder={t('healthcare.radiology.recommendationsPlaceholder')}
                            disabled={!canWrite || !itemIsOpen(selectedItem)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                          />
                        </Field>
                        <Field
                          label={t('healthcare.radiology.imageUrls')}
                          hint={t('healthcare.radiology.imageUrlsHint')}
                        >
                          <textarea
                            value={imageUrls}
                            onChange={(event) => setImageUrls(event.target.value)}
                            rows={2}
                            disabled={!canWrite || !itemIsOpen(selectedItem)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 font-mono text-xs disabled:bg-gray-50 disabled:text-gray-500"
                          />
                        </Field>
                      </div>
                    </div>

                    {error && <div className="mt-3"><ErrorNotice message={error} /></div>}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                        {t('healthcare.radiology.signOffHint')}
                      </p>
                      <Button
                        onClick={() => void handleSignOff()}
                        isLoading={saving}
                        disabled={!canWrite || !itemIsOpen(selectedItem)}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        {t('healthcare.radiology.signOff')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-xs text-gray-500">
                    <AlertTriangle className="mx-auto mb-1 h-5 w-5 text-gray-300" aria-hidden />
                    {t('healthcare.radiology.selectScanFirst')}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <RadiologyReportPdfModal
        open={Boolean(reportData)}
        data={reportData}
        onClose={() => setReportData(null)}
      />
    </div>
  );
}
