import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ArrowRightLeft,
  BedDouble,
  ClipboardList,
  ClipboardPlus,
  DoorOpen,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AdmitPatientModal } from '@/components/healthcare/AdmitPatientModal';
import { BedStatusBadge } from '@/components/healthcare/BedStatusBadge';
import { DischargePatientModal } from '@/components/healthcare/DischargePatientModal';
import { InpatientCareLogModal } from '@/components/healthcare/InpatientCareLogModal';
import { TransferBedModal } from '@/components/healthcare/TransferBedModal';
import { ErrorNotice, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { listClinicDoctors } from '@/services/doctorFeeService';
import { listOpenVisits } from '@/services/healthcareService';
import {
  calculateBedNights,
  getWardsAndBeds,
  listAdmissions,
} from '@/services/inpatientService';
import { formatCurrency } from '@/lib/formatters';
import { formatDateValue, patientDisplayName } from '@/lib/healthcare/format';
import type { AdmissionStatus, PatientAdmission } from '@/types/healthcare';

type RegistryFilter = AdmissionStatus | 'all';

const REGISTRY_FILTERS: readonly RegistryFilter[] = ['admitted', 'discharged', 'all'];

const ADMISSION_STATUS_STYLES: Record<AdmissionStatus, string> = {
  admitted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  discharged: 'border-slate-200 bg-slate-50 text-slate-600',
  transferred: 'border-sky-200 bg-sky-50 text-sky-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};

/** Inpatient registry: active ADT list plus discharge and care-log actions. */
export function InpatientAdmissionsStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [filter, setFilter] = useState<RegistryFilter>('admitted');
  const [search, setSearch] = useState('');
  const [admitOpen, setAdmitOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<PatientAdmission | null>(null);
  const [dischargeTarget, setDischargeTarget] = useState<PatientAdmission | null>(null);
  const [careLogTarget, setCareLogTarget] = useState<PatientAdmission | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dischargedNotice, setDischargedNotice] = useState<PatientAdmission | null>(null);
  const [now] = useState(() => new Date());

  const admissionsQuery = useQuery({
    queryKey: ['healthcare', 'inpatient', 'admissions', businessId, 'all'],
    queryFn: () => listAdmissions(businessId as string, { status: 'all', limit: 500 }),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const wardsQuery = useQuery({
    queryKey: ['healthcare', 'inpatient', 'wards', businessId],
    queryFn: () => getWardsAndBeds(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const visitsQuery = useQuery({
    queryKey: ['healthcare', 'openVisits', businessId],
    queryFn: () => listOpenVisits(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const doctorsQuery = useQuery({
    queryKey: ['healthcare', 'doctors', businessId],
    queryFn: () => listClinicDoctors(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });

  const admissions = useMemo(() => admissionsQuery.data ?? [], [admissionsQuery.data]);
  const wards = useMemo(() => wardsQuery.data ?? [], [wardsQuery.data]);
  const doctors = useMemo(() => doctorsQuery.data ?? [], [doctorsQuery.data]);

  const admittedIds = useMemo(
    () => new Set(admissions.filter((item) => item.status === 'admitted').map((item) => item.id)),
    [admissions],
  );
  const admissibleVisits = useMemo(() => {
    const admittedVisitIds = new Set(
      admissions
        .filter((item) => item.status === 'admitted')
        .map((item) => item.visit_id),
    );
    const admittedPatientIds = new Set(
      admissions
        .filter((item) => item.status === 'admitted')
        .map((item) => item.patient_id),
    );
    return (visitsQuery.data ?? []).filter(
      (visit) =>
        visit.id &&
        !admittedVisitIds.has(visit.id) &&
        !admittedPatientIds.has(visit.patient_id) &&
        visit.stage !== 'completed' &&
        visit.stage !== 'cancelled',
    );
  }, [admissions, visitsQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return admissions
      .filter((admission) => filter === 'all' || admission.status === filter)
      .filter((admission) => {
        if (!term) return true;
        const name = patientDisplayName(admission.patient).toLowerCase();
        return (
          admission.admission_number.toLowerCase().includes(term) ||
          name.includes(term) ||
          (admission.patient?.mrn ?? '').toLowerCase().includes(term) ||
          (admission.attending_doctor_name ?? '').toLowerCase().includes(term)
        );
      });
  }, [admissions, filter, search]);

  const counts = useMemo(
    () => ({
      admitted: admissions.filter((item) => item.status === 'admitted').length,
      discharged: admissions.filter((item) => item.status === 'discharged').length,
      total: admissions.length,
    }),
    [admissions],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'inpatient'] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'bill'] });
  };

  const losNights = (admission: PatientAdmission): number => {
    const end = admission.discharged_at ? new Date(admission.discharged_at) : now;
    return calculateBedNights(admission.admitted_at, end);
  };

  const requireAdmission = (admission: PatientAdmission) => {
    if (!admittedIds.has(admission.id)) {
      setActionError(t('healthcare.inpatient.actions.notAdmitted'));
      return false;
    }
    return true;
  };

  return (
    <div className="mx-auto max-w-[1300px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <ClipboardList className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('healthcare.inpatient.title')}
            </h1>
            <p className="text-sm text-gray-500">{t('healthcare.inpatient.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/healthcare/wards"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-700"
          >
            <BedDouble className="h-4 w-4" aria-hidden />
            {t('healthcare.inpatient.openWards')}
          </Link>
          <Button type="button" onClick={() => setAdmitOpen(true)} disabled={!canWrite}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {t('healthcare.inpatient.admitPatient')}
          </Button>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { key: 'admitted', value: counts.admitted, label: t('healthcare.inpatient.metrics.admitted') },
          { key: 'discharged', value: counts.discharged, label: t('healthcare.inpatient.metrics.discharged') },
          { key: 'total', value: counts.total, label: t('healthcare.inpatient.metrics.total') },
          {
            key: 'beds',
            value: wards.flatMap((ward) => ward.beds ?? []).filter((bed) => bed.status === 'available').length,
            label: t('healthcare.inpatient.metrics.availableBeds'),
          },
        ].map((metric) => (
          <div
            key={metric.key}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {metric.label}
            </p>
            <p className="text-lg font-semibold text-gray-900">{metric.value}</p>
          </div>
        ))}
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {REGISTRY_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition ${
                filter === option
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {t(`healthcare.inpatient.filters.${option}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">{t('healthcare.inpatient.search')}</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('healthcare.inpatient.searchPlaceholder')}
              className="w-64 rounded-xl border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={admissionsQuery.isFetching}
            onClick={() => {
              void admissionsQuery.refetch();
              void wardsQuery.refetch();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.inpatient.refresh')}
          </Button>
        </div>
      </div>

      {dischargedNotice ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>
            {t('healthcare.inpatient.dischargedNotice', {
              name:
                patientDisplayName(dischargedNotice.patient) ||
                t('healthcare.inpatient.unknownPatient'),
              admission: dischargedNotice.admission_number,
            })}
          </span>
          <Link
            to={`/healthcare/billing?visitId=${dischargedNotice.visit_id}`}
            className="font-semibold underline"
          >
            {t('healthcare.inpatient.openBill')}
          </Link>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-3">
          <ErrorNotice message={actionError} />
        </div>
      ) : null}

      {admissionsQuery.isLoading ? (
        <LoadingNotice label={t('healthcare.inpatient.loading')} />
      ) : null}
      {admissionsQuery.isError ? (
        <ErrorNotice
          message={
            admissionsQuery.error instanceof Error
              ? admissionsQuery.error.message
              : t('healthcare.inpatient.loadError')
          }
        />
      ) : null}

      {admissionsQuery.isSuccess && filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-gray-900">
            {t('healthcare.inpatient.emptyTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('healthcare.inpatient.emptyHint')}</p>
          <Button type="button" className="mt-4" onClick={() => setAdmitOpen(true)} disabled={!canWrite}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('healthcare.inpatient.admitPatient')}
          </Button>
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <caption className="sr-only">{t('healthcare.inpatient.tableCaption')}</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th scope="col" className="px-3 py-2">{t('healthcare.inpatient.columns.admission')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.inpatient.columns.patient')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.inpatient.columns.bed')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.inpatient.columns.admitted')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('healthcare.inpatient.columns.los')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.inpatient.columns.doctor')}</th>
                <th scope="col" className="px-3 py-2">{t('healthcare.inpatient.columns.status')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('healthcare.inpatient.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((admission) => {
                const bed = admission.current_bed;
                const nights = losNights(admission);
                const isAdmitted = admittedIds.has(admission.id);
                return (
                  <tr key={admission.id} className="align-top">
                    <td className="px-3 py-3">
                      <p className="font-mono text-xs font-semibold text-gray-900">
                        {admission.admission_number}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {t('healthcare.inpatient.careLogCount', {
                          count: admission.care_logs?.length ?? 0,
                        })}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-gray-900">
                        {patientDisplayName(admission.patient) ||
                          t('healthcare.inpatient.unknownPatient')}
                      </p>
                      <p className="font-mono text-[11px] text-gray-500">
                        {admission.patient?.mrn ?? '-'}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {bed ? (
                        <>
                          <p className="text-gray-800">
                            {bed.ward?.name ?? '-'} · {bed.bed_number}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {formatCurrency(bed.daily_rate, currency)}
                          </p>
                        </>
                      ) : (
                        <p className="text-gray-500">{t('healthcare.inpatient.noBed')}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-700">
                      {formatDateValue(admission.admitted_at)}
                      {admission.expected_discharge_date ? (
                        <p className="text-[11px] text-gray-500">
                          {t('healthcare.inpatient.expectedDischarge', {
                            date: formatDateValue(admission.expected_discharge_date),
                          })}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-900">
                      {t('healthcare.inpatient.losNights', { count: nights })}
                    </td>
                    <td className="px-3 py-3 text-gray-700">
                      {admission.attending_doctor_name ??
                        admission.attending_doctor_id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ADMISSION_STATUS_STYLES[admission.status]}`}
                      >
                        {t(`healthcare.inpatient.status.${admission.status}`)}
                      </span>
                      {admission.discharge_condition ? (
                        <p className="mt-1 text-[11px] text-gray-500">
                          {t(
                            `healthcare.inpatient.dischargeCondition.${admission.discharge_condition}`,
                          )}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {isAdmitted ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              if (requireAdmission(admission)) setCareLogTarget(admission);
                            }}
                            disabled={!canWrite}
                          >
                            <ClipboardPlus className="h-3.5 w-3.5" aria-hidden />
                            {t('healthcare.inpatient.actions.careLog')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              if (requireAdmission(admission)) setTransferTarget(admission);
                            }}
                            disabled={!canWrite || !admission.current_bed}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
                            {t('healthcare.inpatient.actions.transfer')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              if (requireAdmission(admission)) setDischargeTarget(admission);
                            }}
                            disabled={!canWrite}
                          >
                            <DoorOpen className="h-3.5 w-3.5" aria-hidden />
                            {t('healthcare.inpatient.actions.discharge')}
                          </Button>
                        </div>
                      ) : admission.status === 'discharged' ? (
                        <div className="text-right">
                          <Link
                            to={`/healthcare/billing?visitId=${admission.visit_id}`}
                            className="text-xs font-semibold text-brand-700 underline"
                          >
                            {t('healthcare.inpatient.openBill')}
                          </Link>
                          {bed ? <BedStatusBadge status={bed.status} /> : null}
                        </div>
                      ) : (
                        <p className="text-right text-xs text-gray-400">
                          {t('healthcare.inpatient.noActions')}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <AdmitPatientModal
        open={admitOpen}
        businessId={businessId}
        wards={wards}
        visits={admissibleVisits}
        doctors={doctors}
        canWrite={canWrite}
        preselectedBedId={null}
        onClose={() => setAdmitOpen(false)}
        onAdmitted={() => invalidate()}
      />
      <TransferBedModal
        open={Boolean(transferTarget)}
        businessId={businessId}
        admission={transferTarget}
        wards={wards}
        currency={currency}
        canWrite={canWrite}
        onClose={() => setTransferTarget(null)}
        onTransferred={() => invalidate()}
      />
      <DischargePatientModal
        open={Boolean(dischargeTarget)}
        businessId={businessId}
        admission={dischargeTarget}
        currency={currency}
        canWrite={canWrite}
        onClose={() => setDischargeTarget(null)}
        onDischarged={(admission) => {
          setDischargedNotice(admission);
          invalidate();
        }}
      />
      <InpatientCareLogModal
        open={Boolean(careLogTarget)}
        businessId={businessId}
        admission={careLogTarget}
        canWrite={canWrite}
        onClose={() => setCareLogTarget(null)}
        onSaved={() => invalidate()}
      />
    </div>
  );
}
