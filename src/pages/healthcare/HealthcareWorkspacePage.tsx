import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BedDouble,
  ClipboardList,
  Clock3,
  Plus,
  Receipt,
  RefreshCw,
  Stethoscope,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  ErrorNotice,
  LoadingNotice,
  StageBadge,
  VitalSignsBadge,
} from '@/components/healthcare/healthcareUi';
import { PatientRegistrationModal } from '@/components/healthcare/PatientRegistrationModal';
import { TriageVitalsModal } from '@/components/healthcare/TriageVitalsModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import {
  advanceVisitStage,
  countVisitsByStage,
  listActiveVisits,
  nextVisitStage,
  type PatientVisit,
  type QueueCounters,
} from '@/services/healthcareService';
import { formatDateValue, hasVitals, patientDisplayName } from '@/lib/healthcare/format';

const COUNTER_STAGES: Array<keyof QueueCounters> = [
  'registered',
  'triaged',
  'with_doctor',
  'in_lab',
  'at_pharmacy',
  'in_billing',
];

const COUNTER_STYLES: Record<string, string> = {
  registered: 'border-slate-200 bg-slate-50 text-slate-700',
  triaged: 'border-sky-200 bg-sky-50 text-sky-700',
  with_doctor: 'border-violet-200 bg-violet-50 text-violet-700',
  in_lab: 'border-amber-200 bg-amber-50 text-amber-800',
  at_pharmacy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  in_billing: 'border-rose-200 bg-rose-50 text-rose-700',
};

/**
 * Clinic hub: live queue board across every station, with the quick actions a
 * receptionist, nurse or doctor needs at the start of a shift.
 */
export function HealthcareWorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = business?.id ?? null;
  const { canWrite } = usePermissions();

  const [showRegistration, setShowRegistration] = useState(false);
  const [triageVisit, setTriageVisit] = useState<PatientVisit | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const queueQuery = useQuery({
    queryKey: ['healthcare', 'queue', businessId],
    queryFn: () => listActiveVisits(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const visits = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const counters = useMemo(() => countVisitsByStage(visits), [visits]);
  const selectedVisit = visits.find((visit) => visit.id === selectedVisitId) ?? null;

  // Realtime queue: another station moving a patient must show up here without
  // a manual refresh. The 20s poll stays as a fallback for a dropped socket.
  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`healthcare-visits-${businessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'patient_visits',
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          void queryClient.invalidateQueries({
            queryKey: ['healthcare', 'queue', businessId],
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [businessId, queryClient]);

  const invalidateClinic = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['healthcare', 'visit'] }),
    ]);
  };

  const openConsultation = (visitId?: string | null) => {
    navigate(visitId ? `/healthcare/consultation?visitId=${visitId}` : '/healthcare/consultation');
  };

  const openBilling = (visitId?: string | null) => {
    navigate(visitId ? `/healthcare/billing?visitId=${visitId}` : '/healthcare/billing');
  };

  const advance = async (visit: PatientVisit) => {
    if (!visit.id) return;
    const nextStage = nextVisitStage(visit.stage);
    if (!nextStage) return;
    setAdvanceError(null);
    setAdvancingId(visit.id);
    try {
      await advanceVisitStage(visit.id, nextStage);
      await invalidateClinic();
      setStatusMessage(t('healthcare.workspace.stageUpdated', {
        patient: patientDisplayName(visit.patient),
        stage: t(`healthcare.queueStage.${nextStage}`),
      }));
    } catch (error) {
      setAdvanceError(
        error instanceof Error ? error.message : t('healthcare.workspace.advanceError'),
      );
    } finally {
      setAdvancingId(null);
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
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Stethoscope className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.title')}</h1>
            <p className="text-sm text-gray-500">
              {business?.name} · {t('healthcare.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void queueQuery.refetch()}
            disabled={queueQuery.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${queueQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden />
            {t('healthcare.workspace.refresh')}
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => setShowRegistration(true)}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.patients.registerNew')}
            </Button>
          )}
        </div>
      </header>

      <section aria-label={t('healthcare.workspace.countersAria')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {COUNTER_STAGES.map((stage) => (
          <div key={stage} className={`rounded-xl border px-3 py-2.5 ${COUNTER_STYLES[stage]}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
              {t(`healthcare.queueStage.${stage}`)}
            </p>
            <p className="mt-0.5 text-2xl font-semibold">{counters[stage]}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t('healthcare.workspace.quickActions')}</h2>
            <p className="text-xs text-gray-500">{t('healthcare.workspace.quickActionsHint')}</p>
          </div>
          {!canWrite && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
              {t('healthcare.workspace.readOnly')}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowRegistration(true)} disabled={!canWrite}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.workspace.registerPatient')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canWrite || !selectedVisit}
            onClick={() => selectedVisit && setTriageVisit(selectedVisit)}
          >
            <Activity className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.workspace.recordVitals')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openConsultation(selectedVisit?.id)}>
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.workspace.newConsultation')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openBilling(selectedVisit?.id)}>
            <Receipt className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.workspace.viewBilling')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('/healthcare/wards')}>
            <BedDouble className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.wards.title')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('/healthcare/admissions')}>
            <UsersRound className="h-3.5 w-3.5" aria-hidden />
            {t('healthcare.inpatient.title')}
          </Button>
          {!selectedVisit && (
            <span className="self-center text-[11px] text-gray-400">
              {t('healthcare.workspace.selectVisitHint')}
            </span>
          )}
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t('healthcare.workspace.queueTitle')}</h2>
            <p className="text-xs text-gray-500">{t('healthcare.workspace.queueSubtitle')}</p>
          </div>
          <span className="text-xs text-gray-400">
            {t('healthcare.workspace.inQueue', { count: visits.length })}
          </span>
        </div>

        {queueQuery.isLoading && <LoadingNotice label={t('healthcare.workspace.loading')} />}
        {queueQuery.isError && (
          <ErrorNotice
            message={
              queueQuery.error instanceof Error
                ? queueQuery.error.message
                : t('healthcare.workspace.loadError')
            }
          />
        )}
        {advanceError && <div className="mt-2"><ErrorNotice message={advanceError} /></div>}
        {statusMessage && (
          <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            {statusMessage}
          </p>
        )}

        {queueQuery.isSuccess && visits.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
            <Stethoscope className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
            <p className="mt-2 text-sm font-medium text-gray-700">{t('healthcare.workspace.emptyQueue')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('healthcare.workspace.emptyQueueHint')}</p>
            {canWrite && (
              <Button className="mt-4" size="sm" onClick={() => setShowRegistration(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('healthcare.workspace.registerPatient')}
              </Button>
            )}
          </div>
        )}

        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visits.map((visit) => {
            const selected = visit.id === selectedVisitId;
            const nextStage = nextVisitStage(visit.stage);
            return (
              <li key={visit.id}>
                <article
                  className={`h-full rounded-2xl border bg-white p-4 shadow-sm transition ${
                    selected ? 'border-brand-400 ring-2 ring-brand-100' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedVisitId(selected ? null : visit.id ?? null)}
                        aria-pressed={selected}
                        className="block truncate text-left text-sm font-semibold text-gray-900 hover:text-brand-700"
                      >
                        {patientDisplayName(visit.patient) || t('healthcare.workspace.unknownPatient')}
                      </button>
                      <p className="mt-0.5 font-mono text-[11px] text-gray-500">
                        {visit.patient?.mrn ?? '—'} · {visit.visit_number}
                      </p>
                    </div>
                    <StageBadge stage={visit.stage} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      {t(`healthcare.visitType.${visit.visit_type}`)}
                    </span>
                    <VitalSignsBadge visit={visit} />
                  </div>

                  <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-400">
                    <Clock3 className="h-3 w-3" aria-hidden />
                    {formatDateValue(visit.visit_date)} · {visit.visit_date === new Date().toISOString().slice(0, 10)
                      ? t('healthcare.workspace.today')
                      : t('healthcare.workspace.visitDate')}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
                    {visit.stage === 'registered' && canWrite ? (
                      <Button size="sm" variant="secondary" onClick={() => setTriageVisit(visit)}>
                        <Activity className="h-3.5 w-3.5" aria-hidden />
                        {t('healthcare.workspace.triageNow')}
                      </Button>
                    ) : nextStage && canWrite ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={advancingId === visit.id}
                        onClick={() => void advance(visit)}
                      >
                        {t('healthcare.workspace.advanceTo', {
                          stage: t(`healthcare.queueStage.${nextStage}`),
                        })}
                      </Button>
                    ) : null}
                    {visit.stage !== 'registered' && (
                      <Button size="sm" variant="ghost" onClick={() => openConsultation(visit.id)}>
                        {t('healthcare.workspace.openConsultation')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openBilling(visit.id)}>
                      {t('healthcare.workspace.billing')}
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </section>

      {showRegistration && (
        <PatientRegistrationModal
          businessId={businessId}
          onClose={() => setShowRegistration(false)}
          onSaved={async (patient) => {
            setShowRegistration(false);
            setStatusMessage(
              t('healthcare.workspace.patientRegistered', {
                patient: patientDisplayName(patient),
                mrn: patient.mrn,
              }),
            );
            await queryClient.invalidateQueries({ queryKey: ['healthcare', 'patients', businessId] });
          }}
        />
      )}

      {triageVisit && (
        <TriageVitalsModal
          visit={triageVisit}
          onClose={() => setTriageVisit(null)}
          onSaved={async () => {
            setTriageVisit(null);
            setStatusMessage(t('healthcare.triage.success'));
            await invalidateClinic();
          }}
        />
      )}

      {selectedVisit && !hasVitals(selectedVisit) && selectedVisit.stage === 'registered' && (
        <p className="mt-3 text-xs text-gray-400">{t('healthcare.workspace.vitalsRequiredHint')}</p>
      )}
    </div>
  );
}
