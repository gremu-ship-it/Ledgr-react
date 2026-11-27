import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Barcode,
  Beaker,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileCheck2,
  FileText,
  FlaskConical,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNotice, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { CollectSpecimenModal } from '@/components/healthcare/CollectSpecimenModal';
import {
  EnterLabResultModal,
  type LabResultTarget,
} from '@/components/healthcare/EnterLabResultModal';
import { LabReportPdfModal } from '@/components/healthcare/LabReportPdfModal';
import {
  ResultStatusBadge,
} from '@/components/healthcare/ResultStatusBadge';
import {
  SpecimenBarcodeLabel,
  type SpecimenLabelPayload,
} from '@/components/healthcare/SpecimenBarcodeLabel';
import { usePermissions } from '@/hooks/usePermissions';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { useAppStore } from '@/store/useAppStore';
import { formatDateValue, patientDisplayName, calculateAge } from '@/lib/healthcare/format';
import { buildReferenceRangeLabel, getLabOrders, isResultPending, splitLabWorklist, verifyLabOrder } from '@/services/labService';
import type {
  LabOrder,
  LabReportData,
  LabSpecimen,
  ResultStatus,
  SpecimenStatus,
} from '@/types/healthcare';

type LabTab = 'worklist' | 'results' | 'reports';

const TAB_ICONS = {
  worklist: ClipboardList,
  results: Beaker,
  reports: FileCheck2,
} as const;

const SPECIMEN_STATUS_STYLES: Record<SpecimenStatus, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-600',
  collected: 'border-sky-200 bg-sky-50 text-sky-700',
  in_analysis: 'border-violet-200 bg-violet-50 text-violet-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
};

function specimenStatusKey(status: SpecimenStatus): string {
  return `healthcare.lab.specimenStatus.${status}`;
}

/** Laboratory bench: specimen collection, result capture and report sign-off. */
export function LabStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { businessName, logoUrl } = useBrandTheme();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const { canWrite } = usePermissions();

  const [tab, setTab] = useState<LabTab>('worklist');
  const [collectTarget, setCollectTarget] = useState<LabOrder | null>(null);
  const [resultTarget, setResultTarget] = useState<LabResultTarget | null>(null);
  const [specimenLabel, setSpecimenLabel] = useState<SpecimenLabelPayload | null>(null);
  const [reportData, setReportData] = useState<LabReportData | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['healthcare', 'lab', 'orders', businessId],
    queryFn: () => getLabOrders(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });

  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const worklist = useMemo(() => splitLabWorklist(orders), [orders]);

  const resultOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status !== 'completed' &&
          (order.items ?? []).some((item) => isResultPending(item.result_status)),
      ),
    [orders],
  );

  const reportOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          (order.specimens?.length ?? 0) > 0 ||
          (order.items ?? []).some((item) => !isResultPending(item.result_status)),
      ),
    [orders],
  );

  const pendingReportCount = useMemo(
    () =>
      reportOrders.filter(
        (order) =>
          order.status !== 'completed' &&
          (order.items ?? []).every((item) => !isResultPending(item.result_status)),
      ).length,
    [reportOrders],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'lab'] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] });
  };

  const printSpecimen = (order: LabOrder, specimen: LabSpecimen) => {
    setSpecimenLabel({
      patientName:
        patientDisplayName(order.patient) || t('healthcare.workspace.unknownPatient'),
      mrn: order.patient?.mrn ?? '',
      specimenType: t(`healthcare.lab.specimenType.${specimen.specimen_type}`),
      testNames: (order.items ?? []).map((item) => item.test_name),
      barcode: specimen.specimen_barcode,
      collectedAt: formatDateValue(specimen.collected_at),
    });
  };

  const buildReportData = (order: LabOrder): LabReportData => {
    const specimen = order.specimens?.[0] ?? order.items[0]?.specimen ?? null;
    const age = calculateAge(order.patient?.date_of_birth ?? null);
    const pendingItems = (order.items ?? []).filter((item) =>
      isResultPending(item.result_status),
    );

    return {
      businessName,
      logoUrl,
      orderNumber: `LAB-${order.id.slice(0, 8).toUpperCase()}`,
      orderDate: formatDateValue(order.created_at),
      patientName:
        patientDisplayName(order.patient) || t('healthcare.workspace.unknownPatient'),
      mrn: order.patient?.mrn ?? '',
      age: age === null ? '' : String(age),
      sex: order.patient?.gender ?? '',
      visitNumber: order.visit?.visit_number ?? '',
      orderedBy: order.doctor_id ? order.doctor_id.slice(0, 8).toUpperCase() : '',
      clinicalIndication: order.clinical_indication ?? '',
      specimenBarcode: specimen?.specimen_barcode ?? '',
      specimenType: specimen
        ? t(`healthcare.lab.specimenType.${specimen.specimen_type}`)
        : '',
      collectedAt: formatDateValue(specimen?.collected_at),
      verifiedBy: order.verified_by ? order.verified_by.slice(0, 8).toUpperCase() : '',
      verifiedAt: formatDateValue(order.verified_at),
      isVerified: order.status === 'completed',
      labels: {
        title: t('healthcare.lab.report.docTitle'),
        patient: t('healthcare.lab.report.patient'),
        mrn: t('healthcare.lab.report.mrn'),
        age: t('healthcare.lab.report.age'),
        sex: t('healthcare.lab.report.sex'),
        visit: t('healthcare.lab.report.visit'),
        orderedBy: t('healthcare.lab.report.orderedBy'),
        specimen: t('healthcare.lab.report.specimen'),
        barcode: t('healthcare.lab.report.barcode'),
        collected: t('healthcare.lab.report.collected'),
        clinicalIndication: t('healthcare.lab.report.clinicalIndication'),
        test: t('healthcare.lab.report.test'),
        result: t('healthcare.lab.report.result'),
        unit: t('healthcare.lab.report.unit'),
        reference: t('healthcare.lab.report.reference'),
        status: t('healthcare.lab.report.status'),
        verifiedBy: t('healthcare.lab.report.verifiedBy'),
        verifiedAt: t('healthcare.lab.report.verifiedAt'),
        pendingVerification:
          pendingItems.length > 0
            ? t('healthcare.lab.report.pendingVerification', { total: pendingItems.length })
            : t('healthcare.lab.report.awaitingVerification'),
        noResults: t('healthcare.lab.report.noResults'),
        printed: t('healthcare.lab.report.printed'),
        statusNormal: t('healthcare.lab.resultStatus.normal'),
        statusAbnormal: t('healthcare.lab.resultStatus.abnormal'),
        statusCritical: t('healthcare.lab.resultStatus.critical'),
        statusPending: t('healthcare.lab.resultStatus.pending'),
      },
      items: (order.items ?? []).map((item) => ({
        testName: item.test_name,
        result: item.result_value ?? '',
        unit: item.unit_of_measure ?? '',
        reference:
          item.reference_range ??
          buildReferenceRangeLabel({
            unit: item.unit_of_measure,
            minNormal: item.min_normal,
            maxNormal: item.max_normal,
            criticalLow: item.critical_low,
            criticalHigh: item.critical_high,
          }),
        status: item.result_status as ResultStatus,
      })),
    };
  };

  const verify = async (order: LabOrder) => {
    if (!businessId) return;
    setVerifyError(null);
    setVerifyingId(order.id);
    try {
      await verifyLabOrder(businessId, order.id);
      invalidate();
    } catch (error) {
      setVerifyError(
        error instanceof Error ? error.message : t('healthcare.lab.reports.verifyError'),
      );
    } finally {
      setVerifyingId(null);
    }
  };

  if (!businessId) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorNotice message={t('healthcare.workspace.noBusiness')} />
      </div>
    );
  }

  const renderOrderCard = (order: LabOrder) => {
    const specimen = order.specimens?.[0] ?? null;
    const pendingItems = (order.items ?? []).filter((item) =>
      isResultPending(item.result_status),
    );
    const allResultsIn = pendingItems.length === 0;
    const canCollect = !specimen || specimen.status === 'rejected';

    return (
      <article
        key={order.id}
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {patientDisplayName(order.patient) || t('healthcare.workspace.unknownPatient')}
            </h2>
            <p className="font-mono text-xs text-gray-500">
              {order.patient?.mrn} · {order.visit?.visit_number ?? order.visit_id} ·{' '}
              {formatDateValue(order.created_at)}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {specimen ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SPECIMEN_STATUS_STYLES[specimen.status]}`}
                >
                  <Barcode className="h-3 w-3" aria-hidden />
                  {t(specimenStatusKey(specimen.status))}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  <FlaskConical className="h-3 w-3" aria-hidden />
                  {t('healthcare.lab.worklist.awaitingSpecimen')}
                </span>
              )}
              {specimen ? (
                <span className="font-mono text-[11px] text-gray-500">
                  {specimen.specimen_barcode}
                </span>
              ) : null}
            </div>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {t('healthcare.lab.worklist.tests', { total: order.items.length })}
          </span>
        </div>

        <ul className="mt-3 space-y-1.5">
          {(order.items ?? []).map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5"
            >
              <span className="text-sm text-gray-800">{item.test_name}</span>
              <span className="flex items-center gap-2">
                <ResultStatusBadge status={item.result_status} />
                {!isResultPending(item.result_status) ? (
                  <span className="text-xs text-gray-500">
                    {item.result_value}
                    {item.unit_of_measure ? ` ${item.unit_of_measure}` : ''}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canCollect ? (
            <Button
              size="sm"
              disabled={!canWrite}
              onClick={() => setCollectTarget(order)}
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.lab.worklist.collect')}
            </Button>
          ) : null}
          {specimen ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => printSpecimen(order, specimen)}
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.lab.worklist.printLabel')}
            </Button>
          ) : null}
          {pendingItems.length > 0 && specimen && specimen.status !== 'rejected' ? (
            <Button
              size="sm"
              variant={canCollect ? 'secondary' : 'primary'}
              disabled={!canWrite}
              onClick={() => setResultTarget({ order, item: pendingItems[0] })}
            >
              <Beaker className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.lab.worklist.enterResult')}
            </Button>
          ) : null}
          {allResultsIn && (order.items ?? []).length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setReportData(buildReportData(order))}>
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.lab.worklist.viewReport')}
            </Button>
          ) : null}
        </div>
      </article>
    );
  };

  const emptyState = (icon: typeof FileText, title: string, hint: string) => {
    const Icon = icon;
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
        <Icon className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
        <p className="mt-2 text-sm font-medium text-gray-700">{title}</p>
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <FlaskConical className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.lab.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.lab.subtitle')}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t('healthcare.lab.metrics.collect')}
            </p>
            <p className="text-lg font-semibold text-gray-900">
              {worklist.awaitingCollection.length}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t('healthcare.lab.metrics.results')}
            </p>
            <p className="text-lg font-semibold text-gray-900">{resultOrders.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t('healthcare.lab.metrics.verify')}
            </p>
            <p className="text-lg font-semibold text-gray-900">{pendingReportCount}</p>
          </div>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-gray-200">
        {(['worklist', 'results', 'reports'] as const).map((option) => {
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
              {t(`healthcare.lab.tabs.${option}`)}
            </button>
          );
        })}
      </div>

      {verifyError ? (
        <div className="mb-3">
          <ErrorNotice message={verifyError} />
        </div>
      ) : null}

      {ordersQuery.isLoading ? <LoadingNotice label={t('healthcare.lab.loading')} /> : null}
      {ordersQuery.isError ? (
        <ErrorNotice
          message={
            ordersQuery.error instanceof Error
              ? ordersQuery.error.message
              : t('healthcare.lab.loadError')
          }
        />
      ) : null}

      {tab === 'worklist' ? (
        <section className="space-y-4">
          {orders.length === 0 && ordersQuery.isSuccess
            ? emptyState(
                FlaskConical,
                t('healthcare.lab.worklist.emptyTitle'),
                t('healthcare.lab.worklist.emptyHint'),
              )
            : null}

          {worklist.awaitingCollection.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {t('healthcare.lab.worklist.sectionCollect', {
                  total: worklist.awaitingCollection.length,
                })}
              </h2>
              <div className="space-y-3">{worklist.awaitingCollection.map(renderOrderCard)}</div>
            </div>
          ) : null}

          {worklist.collected.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {t('healthcare.lab.worklist.sectionCollected', {
                  total: worklist.collected.length,
                })}
              </h2>
              <div className="space-y-3">{worklist.collected.map(renderOrderCard)}</div>
            </div>
          ) : null}

          {worklist.inAnalysis.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {t('healthcare.lab.worklist.sectionAnalysis', {
                  total: worklist.inAnalysis.length,
                })}
              </h2>
              <div className="space-y-3">{worklist.inAnalysis.map(renderOrderCard)}</div>
            </div>
          ) : null}

          {worklist.verified.length > 0 ? (
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {t('healthcare.lab.worklist.sectionVerified', {
                  total: worklist.verified.length,
                })}
              </h2>
              <div className="space-y-3">{worklist.verified.slice(0, 5).map(renderOrderCard)}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'results' ? (
        <section className="space-y-4">
          {resultOrders.length === 0 && ordersQuery.isSuccess
            ? emptyState(
                Beaker,
                t('healthcare.lab.results.emptyTitle'),
                t('healthcare.lab.results.emptyHint'),
              )
            : null}

          {resultOrders.map((order) => {
            const specimen = order.specimens?.[0] ?? null;
            return (
              <article
                key={order.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {patientDisplayName(order.patient) ||
                        t('healthcare.workspace.unknownPatient')}
                    </h2>
                    <p className="font-mono text-xs text-gray-500">
                      {order.patient?.mrn} · {order.visit?.visit_number ?? order.visit_id}
                    </p>
                  </div>
                  {specimen ? (
                    <span className="font-mono text-[11px] text-gray-500">
                      {specimen.specimen_barcode}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {t('healthcare.lab.results.noSpecimen')}
                    </span>
                  )}
                </div>

                <div className="mt-3 divide-y divide-gray-100">
                  {(order.items ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{item.test_name}</p>
                        <p className="text-[11px] text-gray-500">
                          {item.result_value
                            ? `${item.result_value}${item.unit_of_measure ? ` ${item.unit_of_measure}` : ''}`
                            : t('healthcare.lab.results.notEntered')}
                          {item.reference_range ? ` · ${item.reference_range}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <ResultStatusBadge status={item.result_status} />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canWrite}
                          onClick={() => setResultTarget({ order, item })}
                        >
                          <Beaker className="h-3.5 w-3.5" aria-hidden />
                          {isResultPending(item.result_status)
                            ? t('healthcare.lab.results.enter')
                            : t('healthcare.lab.results.edit')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {!specimen ? (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      disabled={!canWrite}
                      onClick={() => setCollectTarget(order)}
                    >
                      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                      {t('healthcare.lab.results.collectFirst')}
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {tab === 'reports' ? (
        <section className="space-y-4">
          {reportOrders.length === 0 && ordersQuery.isSuccess
            ? emptyState(
                FileText,
                t('healthcare.lab.reports.emptyTitle'),
                t('healthcare.lab.reports.emptyHint'),
              )
            : null}

          {reportOrders.map((order) => {
            const pendingItems = (order.items ?? []).filter((item) =>
              isResultPending(item.result_status),
            );
            const isVerified = order.status === 'completed';
            const ready = pendingItems.length === 0 && !isVerified;
            return (
              <article
                key={order.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {patientDisplayName(order.patient) ||
                        t('healthcare.workspace.unknownPatient')}
                    </h2>
                    <p className="font-mono text-xs text-gray-500">
                      LAB-{order.id.slice(0, 8).toUpperCase()} ·{' '}
                      {order.patient?.mrn}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {t('healthcare.lab.reports.collectedAt', {
                        date: formatDateValue(order.specimens?.[0]?.collected_at),
                      })}
                    </p>
                  </div>
                  {isVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                      {t('healthcare.lab.reports.verified')}
                    </span>
                  ) : ready ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                      {t('healthcare.lab.reports.ready')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {t('healthcare.lab.reports.pending', { total: pendingItems.length })}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(order.items ?? []).map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600"
                    >
                      {item.test_name}
                      <ResultStatusBadge status={item.result_status} />
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setReportData(buildReportData(order))}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                    {t('healthcare.lab.reports.preview')}
                  </Button>
                  {ready ? (
                    <Button
                      size="sm"
                      disabled={!canWrite}
                      isLoading={verifyingId === order.id}
                      onClick={() => verify(order)}
                    >
                      <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                      {t('healthcare.lab.reports.verify')}
                    </Button>
                  ) : null}
                  {(order.specimens?.length ?? 0) > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const specimen = order.specimens?.[0];
                        if (specimen) printSpecimen(order, specimen);
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" aria-hidden />
                      {t('healthcare.lab.reports.printLabel')}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <CollectSpecimenModal
        open={Boolean(collectTarget)}
        onClose={() => setCollectTarget(null)}
        businessId={businessId}
        order={collectTarget}
        canWrite={canWrite}
        onCollected={() => invalidate()}
        onPrintLabel={(specimen) => {
          if (!collectTarget) return;
          printSpecimen(collectTarget, specimen);
          setCollectTarget(null);
        }}
      />

      <EnterLabResultModal
        open={Boolean(resultTarget)}
        onClose={() => setResultTarget(null)}
        businessId={businessId}
        target={resultTarget}
        canWrite={canWrite}
        onSaved={() => {
          invalidate();
          setResultTarget(null);
        }}
      />

      <SpecimenBarcodeLabel
        open={Boolean(specimenLabel)}
        onClose={() => setSpecimenLabel(null)}
        payload={specimenLabel}
      />

      <LabReportPdfModal
        open={Boolean(reportData)}
        onClose={() => setReportData(null)}
        data={reportData}
      />
    </div>
  );
}
