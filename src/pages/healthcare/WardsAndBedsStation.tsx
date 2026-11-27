import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  BedDouble,
  Building2,
  ClipboardList,
  Plus,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AdmitPatientModal } from '@/components/healthcare/AdmitPatientModal';
import { BedCard } from '@/components/healthcare/BedCard';
import { CreateWardAndBedModal } from '@/components/healthcare/CreateWardAndBedModal';
import { DischargePatientModal } from '@/components/healthcare/DischargePatientModal';
import { InpatientCareLogModal } from '@/components/healthcare/InpatientCareLogModal';
import { TransferBedModal } from '@/components/healthcare/TransferBedModal';
import { BedStatusBadge } from '@/components/healthcare/BedStatusBadge';
import { ErrorNotice, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { listClinicDoctors } from '@/services/doctorFeeService';
import { listOpenVisits } from '@/services/healthcareService';
import {
  listAdmissions,
  getWardsAndBeds,
  updateBedStatus,
} from '@/services/inpatientService';
import { formatCurrency } from '@/lib/formatters';
import { patientDisplayName } from '@/lib/healthcare/format';
import {
  GENDER_RESTRICTION_LABEL_KEYS,
  WARD_TYPE_LABEL_KEYS,
} from '@/lib/healthcare/inpatient';
import type {
  BedStatus,
  HospitalBed,
  PatientAdmission,
} from '@/types/healthcare';

const STATUS_FILTERS: ReadonlyArray<BedStatus | 'all'> = [
  'all',
  'available',
  'occupied',
  'cleaning',
  'maintenance',
  'reserved',
];

/** Visual ward/bed board for admissions, transfers and housekeeping. */
export function WardsAndBedsStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const currency = business?.base_currency ?? 'MWK';
  const { canWrite } = usePermissions();

  const [statusFilter, setStatusFilter] = useState<BedStatus | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [admitBedId, setAdmitBedId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<PatientAdmission | null>(null);
  const [dischargeTarget, setDischargeTarget] = useState<PatientAdmission | null>(null);
  const [careLogTarget, setCareLogTarget] = useState<PatientAdmission | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dischargedNotice, setDischargedNotice] = useState<PatientAdmission | null>(null);

  const wardsQuery = useQuery({
    queryKey: ['healthcare', 'inpatient', 'wards', businessId],
    queryFn: () => getWardsAndBeds(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const admissionsQuery = useQuery({
    queryKey: ['healthcare', 'inpatient', 'admissions', businessId, 'admitted'],
    queryFn: () => listAdmissions(businessId as string, { status: 'admitted' }),
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

  const wards = useMemo(() => wardsQuery.data ?? [], [wardsQuery.data]);
  const admissions = useMemo(() => admissionsQuery.data ?? [], [admissionsQuery.data]);
  const doctors = useMemo(() => doctorsQuery.data ?? [], [doctorsQuery.data]);

  const admittedVisitIds = useMemo(
    () => new Set(admissions.map((admission) => admission.visit_id)),
    [admissions],
  );
  const admittedPatientIds = useMemo(
    () => new Set(admissions.map((admission) => admission.patient_id)),
    [admissions],
  );
  const admissibleVisits = useMemo(
    () =>
      (visitsQuery.data ?? []).filter(
        (visit) =>
          visit.id &&
          !admittedVisitIds.has(visit.id) &&
          !admittedPatientIds.has(visit.patient_id) &&
          visit.stage !== 'completed' &&
          visit.stage !== 'cancelled',
      ),
    [admittedPatientIds, admittedVisitIds, visitsQuery.data],
  );

  const stats = useMemo(() => {
    const beds = wards.flatMap((ward) => ward.beds ?? []);
    const count = (status: BedStatus) =>
      beds.filter((bed) => bed.status === status).length;
    return {
      total: beds.length,
      available: count('available'),
      occupied: count('occupied'),
      cleaning: count('cleaning'),
      maintenance: count('maintenance') + count('reserved'),
      occupancyRate: beds.length === 0 ? 0 : Math.round((count('occupied') / beds.length) * 100),
    };
  }, [wards]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'inpatient'] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'openVisits', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['healthcare', 'bill'] });
  };

  const admissionForBed = (bed: HospitalBed): PatientAdmission | null => {
    if (!bed.current_admission_id) return null;
    return (
      admissions.find((admission) => admission.id === bed.current_admission_id) ??
      bed.current_admission ??
      null
    );
  };

  const changeBedStatus = async (bed: HospitalBed, status: BedStatus) => {
    if (!businessId) return;
    setActionError(null);
    try {
      await updateBedStatus({ businessId, bedId: bed.id, status });
      invalidate();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('healthcare.wards.actions.error'),
      );
    }
  };

  const openAdmit = (bed?: HospitalBed) => {
    setAdmitBedId(bed?.id ?? null);
    setAdmitOpen(true);
  };

  const openTransfer = (bed: HospitalBed) => {
    const admission = admissionForBed(bed);
    if (!admission) {
      setActionError(t('healthcare.wards.actions.missingAdmission'));
      return;
    }
    setTransferTarget(admission);
  };

  const openDischarge = (bed: HospitalBed) => {
    const admission = admissionForBed(bed);
    if (!admission) {
      setActionError(t('healthcare.wards.actions.missingAdmission'));
      return;
    }
    setDischargeTarget(admission);
  };

  const openCareLog = (bed: HospitalBed) => {
    const admission = admissionForBed(bed);
    if (!admission) {
      setActionError(t('healthcare.wards.actions.missingAdmission'));
      return;
    }
    setCareLogTarget(admission);
  };

  return (
    <div className="mx-auto max-w-[1300px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <BedDouble className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {t('healthcare.wards.title')}
            </h1>
            <p className="text-sm text-gray-500">{t('healthcare.wards.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/healthcare/admissions"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-700"
          >
            <ClipboardList className="h-4 w-4" aria-hidden />
            {t('healthcare.wards.openRegistry')}
          </Link>
          <Button type="button" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('healthcare.wards.configureWards')}
          </Button>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { key: 'total', value: stats.total, label: t('healthcare.wards.metrics.total') },
          { key: 'available', value: stats.available, label: t('healthcare.wards.metrics.available') },
          { key: 'occupied', value: stats.occupied, label: t('healthcare.wards.metrics.occupied') },
          { key: 'cleaning', value: stats.cleaning, label: t('healthcare.wards.metrics.cleaning') },
          {
            key: 'occupancy',
            value: `${stats.occupancyRate}%`,
            label: t('healthcare.wards.metrics.occupancy'),
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={statusFilter === status}
              onClick={() => setStatusFilter(status)}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition ${
                statusFilter === status
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {status === 'all'
                ? t('healthcare.wards.filters.all')
                : t(`healthcare.wards.status.${status}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void wardsQuery.refetch();
              void admissionsQuery.refetch();
            }}
            isLoading={wardsQuery.isFetching || admissionsQuery.isFetching}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.refresh')}
          </Button>
          <Button type="button" size="sm" onClick={() => openAdmit()} disabled={!canWrite}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.admitPatient')}
          </Button>
        </div>
      </div>

      {dischargedNotice ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>
            {t('healthcare.wards.dischargedNotice', {
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
            {t('healthcare.wards.openBill')}
          </Link>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-3">
          <ErrorNotice message={actionError} />
        </div>
      ) : null}

      {wardsQuery.isLoading ? (
        <LoadingNotice label={t('healthcare.wards.loading')} />
      ) : null}
      {wardsQuery.isError ? (
        <ErrorNotice
          message={
            wardsQuery.error instanceof Error
              ? wardsQuery.error.message
              : t('healthcare.wards.loadError')
          }
        />
      ) : null}

      {wardsQuery.isSuccess && wards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-gray-900">
            {t('healthcare.wards.emptyTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('healthcare.wards.emptyHint')}</p>
          <Button type="button" className="mt-4" onClick={() => setCreateOpen(true)} disabled={!canWrite}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('healthcare.wards.configureWards')}
          </Button>
        </div>
      ) : null}

      <div className="space-y-5">
        {wards.map((ward) => {
          const beds = ward.beds ?? [];
          const visibleBeds =
            statusFilter === 'all'
              ? beds
              : beds.filter((bed) => bed.status === statusFilter);
          const occupied = beds.filter((bed) => bed.status === 'occupied').length;
          const available = beds.filter((bed) => bed.status === 'available').length;
          return (
            <section key={ward.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-gray-900">{ward.name}</h2>
                    <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                      {t(WARD_TYPE_LABEL_KEYS[ward.ward_type])}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                      {t(GENDER_RESTRICTION_LABEL_KEYS[ward.gender_restriction])}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {[
                      ward.floor_number
                        ? t('healthcare.wards.floorValue', { floor: ward.floor_number })
                        : null,
                      t('healthcare.wards.bedCountValue', { count: beds.length }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                    {t('healthcare.wards.availableCount', { count: available })}
                  </span>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">
                    {t('healthcare.wards.occupiedCount', { count: occupied })}
                  </span>
                  <span className="text-gray-400">
                    {t('healthcare.wards.occupancyValue', {
                      rate: beds.length === 0 ? 0 : Math.round((occupied / beds.length) * 100),
                    })}
                  </span>
                </div>
              </div>

              {visibleBeds.length === 0 ? (
                <p className="mt-3 rounded-xl bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
                  {statusFilter === 'all'
                    ? t('healthcare.wards.noBeds')
                    : t('healthcare.wards.noBedsForFilter', {
                        status: t(`healthcare.wards.status.${statusFilter}`),
                      })}
                </p>
              ) : (
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleBeds.map((bed) => (
                    <BedCard
                      key={bed.id}
                      bed={bed}
                      currency={currency}
                      canWrite={canWrite}
                      onAdmit={openAdmit}
                      onTransfer={openTransfer}
                      onDischarge={openDischarge}
                      onCareLog={openCareLog}
                      onStatusChange={(target, status) => void changeBedStatus(target, status)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {stats.maintenance > 0 ? (
        <p className="mt-4 text-xs text-gray-500">
          {t('healthcare.wards.outOfService', { count: stats.maintenance })}
        </p>
      ) : null}

      {wards.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {t('healthcare.wards.housekeepingTitle')}
              </h2>
              <p className="text-xs text-gray-500">{t('healthcare.wards.housekeepingHint')}</p>
            </div>
            <span className="text-xs text-gray-500">
              {t('healthcare.wards.housekeepingCount', { count: stats.cleaning })}
            </span>
          </div>
          {wards.flatMap((ward) => ward.beds ?? []).filter((bed) => bed.status === 'cleaning')
            .length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {wards
                .flatMap((ward) => (ward.beds ?? []).map((bed) => ({ ward, bed })))
                .filter(({ bed }) => bed.status === 'cleaning')
                .map(({ bed, ward }) => (
                  <li
                    key={bed.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-xs text-amber-900">
                      <BedStatusBadge status={bed.status} />
                      <span className="font-semibold">
                        {ward.name} · {bed.bed_number}
                      </span>
                      <span className="text-amber-700">
                        {formatCurrency(bed.daily_rate, currency)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void changeBedStatus(bed, 'available')}
                      disabled={!canWrite}
                    >
                      {t('healthcare.wards.actions.markCleaned')}
                    </Button>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl bg-gray-50 px-3 py-3 text-xs text-gray-500">
              {t('healthcare.wards.housekeepingEmpty')}
            </p>
          )}
        </section>
      ) : null}

      <CreateWardAndBedModal
        open={createOpen}
        businessId={businessId}
        currency={currency}
        canWrite={canWrite}
        onClose={() => setCreateOpen(false)}
        onCreated={() => invalidate()}
      />
      <AdmitPatientModal
        open={admitOpen}
        businessId={businessId}
        wards={wards}
        visits={admissibleVisits}
        doctors={doctors}
        canWrite={canWrite}
        preselectedBedId={admitBedId}
        onClose={() => {
          setAdmitOpen(false);
          setAdmitBedId(null);
        }}
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
