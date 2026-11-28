import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Phone, Search, UserPlus, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  AllergyPills,
  BillingTypeBadge,
  ErrorNotice,
  LoadingNotice,
} from '@/components/healthcare/healthcareUi';
import { PatientRegistrationModal } from '@/components/healthcare/PatientRegistrationModal';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/store/useAppStore';
import {
  checkInPatientVisit,
  searchPatients,
  type PatientRecord,
} from '@/services/healthcareService';
import { checkInPatient } from '@/services/clinicalFlowService';
import { calculateAge, patientDisplayName } from '@/lib/healthcare/format';

const TH_CLASS = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const TD_CLASS = 'px-3 py-3 align-middle text-sm text-gray-700';

/** Master patient registry with MRN/name/phone search and one-tap check-in. */
export function PatientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const { canWrite } = usePermissions();

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [showRegistration, setShowRegistration] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [checkingInMode, setCheckingInMode] = useState<'clinic' | 'virtual' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const patientsQuery = useQuery({
    queryKey: ['healthcare', 'patients', businessId, deferredSearch],
    queryFn: () => searchPatients(businessId as string, deferredSearch),
    enabled: Boolean(businessId),
    staleTime: 10_000,
  });

  const patients = patientsQuery.data ?? [];

  const checkIn = async (patient: PatientRecord, mode: 'clinic' | 'virtual' = 'clinic') => {
    if (!businessId || !patient.id) return;
    setActionError(null);
    setCheckingInId(patient.id);
    setCheckingInMode(mode);
    try {
      const visit =
        mode === 'virtual'
          ? await checkInPatient(businessId, {
              patientId: patient.id,
              visitType: 'telemedicine',
            })
          : await checkInPatientVisit(businessId, patient.id, 'outpatient');
      setStatusMessage(
        t('healthcare.patients.checkInSuccess', {
          patient: patientDisplayName(patient),
          visit: visit.visit_number,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['healthcare', 'queue', businessId] });
      if (visit.id) {
        navigate(
          mode === 'virtual'
            ? '/healthcare/telemedicine'
            : `/healthcare/consultation?visitId=${visit.id}`,
        );
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('healthcare.patients.checkInError'),
      );
    } finally {
      setCheckingInId(null);
      setCheckingInMode(null);
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
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.patients.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.patients.subtitle')}</p>
          </div>
        </div>
        {canWrite && (
          <Button onClick={() => setShowRegistration(true)}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {t('healthcare.patients.registerNew')}
          </Button>
        )}
      </header>

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('healthcare.patients.searchPlaceholder')}
          aria-label={t('healthcare.patients.searchPlaceholder')}
          className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {statusMessage && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {statusMessage}
        </p>
      )}
      {actionError && <div className="mb-3"><ErrorNotice message={actionError} /></div>}

      {patientsQuery.isLoading && <LoadingNotice label={t('healthcare.patients.loading')} />}
      {patientsQuery.isError && (
        <ErrorNotice
          message={
            patientsQuery.error instanceof Error
              ? patientsQuery.error.message
              : t('healthcare.patients.loadError')
          }
        />
      )}

      {patientsQuery.isSuccess && patients.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <Users className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <p className="mt-2 text-sm font-medium text-gray-700">
            {deferredSearch.trim() ? t('healthcare.patients.noResults') : t('healthcare.patients.empty')}
          </p>
          <p className="mt-1 text-xs text-gray-500">{t('healthcare.patients.emptyHint')}</p>
          {!deferredSearch.trim() && canWrite && (
            <Button className="mt-4" size="sm" onClick={() => setShowRegistration(true)}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              {t('healthcare.patients.registerNew')}
            </Button>
          )}
        </div>
      )}

      {patients.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100">
            <caption className="sr-only">{t('healthcare.patients.tableCaption')}</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnPatient')}</th>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnMrn')}</th>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnAge')}</th>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnPhone')}</th>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnBloodGroup')}</th>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnAllergies')}</th>
                <th scope="col" className={TH_CLASS}>{t('healthcare.patients.columnBilling')}</th>
                <th scope="col" className={`${TH_CLASS} text-right`}>{t('healthcare.patients.columnActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {patients.map((patient) => {
                const age = calculateAge(patient.date_of_birth);
                return (
                  <tr key={patient.id} className="hover:bg-gray-50/70">
                    <td className={TD_CLASS}>
                      <span className="font-medium text-gray-900">{patientDisplayName(patient)}</span>
                      {patient.gender && (
                        <span className="ml-2 text-xs text-gray-400">
                          {t(`healthcare.registration.${patient.gender}`)}
                        </span>
                      )}
                    </td>
                    <td className={TD_CLASS}>
                      <span className="font-mono text-xs text-gray-600">{patient.mrn}</span>
                    </td>
                    <td className={TD_CLASS}>
                      {age === null ? <span className="text-gray-400">—</span> : t('healthcare.patients.ageYears', { age })}
                    </td>
                    <td className={TD_CLASS}>
                      {patient.phone ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <Phone className="h-3 w-3 text-gray-400" aria-hidden />
                          {patient.phone}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={TD_CLASS}>
                      <span className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gray-700">
                        {patient.blood_group && patient.blood_group !== 'Unknown'
                          ? patient.blood_group
                          : t('healthcare.patients.unknownBloodGroup')}
                      </span>
                    </td>
                    <td className={TD_CLASS}><AllergyPills allergies={patient.allergies} /></td>
                    <td className={TD_CLASS}><BillingTypeBadge billingType={patient.billing_type} /></td>
                    <td className={`${TD_CLASS} text-right`}>
                      <div className="inline-flex gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canWrite || checkingInId === patient.id}
                          isLoading={checkingInId === patient.id && checkingInMode === 'clinic'}
                          onClick={() => void checkIn(patient)}
                        >
                          {t('healthcare.patients.checkIn')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canWrite || checkingInId === patient.id}
                          isLoading={checkingInId === patient.id && checkingInMode === 'virtual'}
                          onClick={() => void checkIn(patient, 'virtual')}
                          title={t('healthcare.patients.checkInVirtual')}
                        >
                          <Video className="h-3.5 w-3.5" aria-hidden />
                          {t('healthcare.patients.checkInVirtual')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/healthcare/consultation?patientId=${patient.id}`)}
                        >
                          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                          {t('healthcare.patients.consult')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showRegistration && (
        <PatientRegistrationModal
          businessId={businessId}
          onClose={() => setShowRegistration(false)}
          onSaved={async (patient) => {
            setShowRegistration(false);
            setStatusMessage(
              t('healthcare.patients.registered', {
                patient: patientDisplayName(patient),
                mrn: patient.mrn,
              }),
            );
            await queryClient.invalidateQueries({ queryKey: ['healthcare', 'patients', businessId] });
          }}
        />
      )}
    </div>
  );
}
