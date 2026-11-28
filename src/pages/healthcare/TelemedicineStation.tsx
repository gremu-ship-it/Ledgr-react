import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Copy,
  ExternalLink,
  MessageCircle,
  Phone,
  Stethoscope,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { AcuityBadge } from '@/components/healthcare/AcuityBadge';
import { QueueTokenBadge } from '@/components/healthcare/QueueTokenBadge';
import { TelemedicineVideoModal } from '@/components/healthcare/TelemedicineVideoModal';
import { ErrorNotice, LoadingNotice } from '@/components/healthcare/healthcareUi';
import { useAppStore } from '@/store/useAppStore';
import {
  buildSmsInviteUrl,
  buildWhatsAppInviteUrl,
  completeTelemedicineCall,
  ensureTelemedicineMeeting,
  listTelemedicineQueue,
  markTelemedicineLinkSent,
  saveTelemedicineNotes,
  startTelemedicineCall,
} from '@/services/telemedicineService';
import type { ClinicalFlowVisit } from '@/services/clinicalFlowService';
import { calculateAge, patientDisplayName } from '@/lib/healthcare/format';
import type { TelemedicineStatus } from '@/types/healthcare';

const STATUS_STYLES: Record<TelemedicineStatus, string> = {
  waiting: 'border-slate-200 bg-slate-50 text-slate-700',
  link_sent: 'border-sky-200 bg-sky-50 text-sky-700',
  in_call: 'border-violet-200 bg-violet-50 text-violet-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-red-200 bg-red-50 text-red-700',
};

/**
 * Telemedicine Virtual Clinic. A virtual waiting room dispatches Jitsi links
 * by WhatsApp/SMS and opens the split-screen EHR video consultation.
 */
export function TelemedicineStation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const currentUser = useAppStore((state) => state.currentUser);

  const doctorName = currentUser?.profile?.full_name || currentUser?.email || null;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeVisit, setActiveVisit] = useState<ClinicalFlowVisit | null>(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [endingCall, setEndingCall] = useState(false);

  const queueQuery = useQuery({
    queryKey: ['healthcare', 'telemedicine', 'queue', businessId],
    queryFn: () => listTelemedicineQueue(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 8_000,
    refetchInterval: 20_000,
  });

  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const waitingCount = queue.filter((visit) => visit.telemedicine_status !== 'in_call').length;
  const inCallCount = queue.filter((visit) => visit.telemedicine_status === 'in_call').length;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['healthcare'] });
  };

  const withMeeting = async (visit: ClinicalFlowVisit): Promise<ClinicalFlowVisit> => {
    if (!businessId || !visit.id) throw new Error('Telemedicine visit not found');
    return ensureTelemedicineMeeting(businessId, visit.id);
  };

  const dispatchInvite = async (visit: ClinicalFlowVisit, channel: 'whatsapp' | 'sms') => {
    if (!businessId || !visit.id) return;
    const actionKey = `${visit.id}:${channel}`;
    setBusy(actionKey);
    setError(null);
    setNotice(null);
    try {
      if (!visit.patient?.phone) {
        setError(t('healthcare.telemedicine.patientPhoneMissing'));
        return;
      }
      const ensured = await withMeeting(visit);
      const meetingUrl = ensured.meeting_url ?? '';
      const inviteUrl =
        channel === 'whatsapp'
          ? buildWhatsAppInviteUrl({
              phone: visit.patient.phone,
              patientName: patientDisplayName(visit.patient),
              doctorName,
              meetingUrl,
            })
          : buildSmsInviteUrl({
              phone: visit.patient.phone,
              patientName: patientDisplayName(visit.patient),
              doctorName,
              meetingUrl,
            });

      if (channel === 'whatsapp') {
        window.open(inviteUrl, '_blank', 'noopener,noreferrer');
      } else {
        window.open(inviteUrl, '_self');
      }
      await markTelemedicineLinkSent(businessId, visit.id);
      setNotice(t('healthcare.telemedicine.dispatchSuccess'));
      await refresh();
    } catch (dispatchError) {
      setError(
        dispatchError instanceof Error ? dispatchError.message : t('healthcare.telemedicine.sendError'),
      );
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (visit: ClinicalFlowVisit) => {
    if (!businessId || !visit.id) return;
    setBusy(`${visit.id}:copy`);
    setError(null);
    setNotice(null);
    try {
      const ensured = await withMeeting(visit);
      const meetingUrl = ensured.meeting_url ?? '';
      await navigator.clipboard.writeText(meetingUrl);
      await markTelemedicineLinkSent(businessId, visit.id);
      setNotice(t('healthcare.telemedicine.copied'));
      await refresh();
    } catch (copyError) {
      setError(
        copyError instanceof Error ? copyError.message : t('healthcare.telemedicine.copyError'),
      );
    } finally {
      setBusy(null);
    }
  };

  const joinCall = async (visit: ClinicalFlowVisit) => {
    if (!businessId || !visit.id) return;
    setBusy(`${visit.id}:join`);
    setError(null);
    setNotice(null);
    try {
      const ensured = await withMeeting(visit);
      const started = await startTelemedicineCall(businessId, ensured.id as string);
      setNotes(started.telemedicine_notes ?? '');
      setActiveVisit(started);
      await refresh();
    } catch (joinError) {
      setError(
        joinError instanceof Error ? joinError.message : t('healthcare.telemedicine.startError'),
      );
    } finally {
      setBusy(null);
    }
  };

  const saveNotes = async () => {
    if (!businessId || !activeVisit?.id) return;
    setSavingNotes(true);
    setError(null);
    try {
      const updated = await saveTelemedicineNotes(businessId, activeVisit.id, notes);
      setActiveVisit((current) => (current ? { ...current, ...updated } : current));
      setNotice(t('healthcare.telemedicine.notesSaved'));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('healthcare.telemedicine.sendError'),
      );
    } finally {
      setSavingNotes(false);
    }
  };

  const endCall = async () => {
    if (!businessId || !activeVisit?.id) return;
    setEndingCall(true);
    setError(null);
    try {
      await saveTelemedicineNotes(businessId, activeVisit.id, notes);
      await completeTelemedicineCall(businessId, activeVisit.id);
      setNotice(t('healthcare.telemedicine.callEnded'));
      setActiveVisit(null);
      await refresh();
    } catch (endError) {
      setError(
        endError instanceof Error ? endError.message : t('healthcare.telemedicine.sendError'),
      );
    } finally {
      setEndingCall(false);
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
    <div className="mx-auto max-w-[1300px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <Video className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t('healthcare.telemedicine.title')}</h1>
            <p className="text-sm text-gray-500">{t('healthcare.telemedicine.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 font-semibold text-violet-700">
            {inCallCount} {t('healthcare.telemedicine.inCall')}
          </span>
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600">
            {waitingCount} {t('healthcare.telemedicine.waiting')}
          </span>
        </div>
      </header>

      {notice && (
        <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && <div className="mb-3"><ErrorNotice message={error} /></div>}

      <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
        <p className="font-semibold">{t('healthcare.telemedicine.waitingRoom')}</p>
        <p className="mt-0.5 text-sky-800">{t('healthcare.telemedicine.dispatchHint')}</p>
      </div>

      {queueQuery.isLoading && <LoadingNotice label={t('healthcare.telemedicine.loading')} />}
      {queueQuery.isError && <ErrorNotice message={t('healthcare.telemedicine.loadError')} />}
      {queueQuery.isSuccess && queue.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
          <Video className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
          <p className="mt-2 text-sm text-gray-500">{t('healthcare.telemedicine.noPatients')}</p>
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {queue.map((visit) => {
          const status = (visit.telemedicine_status ?? 'waiting') as TelemedicineStatus;
          const age = calculateAge(visit.patient?.date_of_birth);
          const isCalling = status === 'in_call';
          return (
            <li
              key={visit.id}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <QueueTokenBadge token={visit.queue_token} size="sm" />
                  <AcuityBadge acuity={visit.acuity_level} showIcon={false} />
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[status]}`}
                >
                  {t(`healthcare.telemedicine.statuses.${status}`)}
                </span>
              </div>

              <h2 className="mt-2 truncate text-base font-semibold text-gray-900">
                {patientDisplayName(visit.patient)}
              </h2>
              <p className="text-[11px] text-gray-500">
                {visit.patient?.mrn ?? '—'} · {age === null ? '—' : `${age}y`} ·{' '}
                {visit.patient?.phone ?? t('healthcare.telemedicine.patientPhoneMissing')}
              </p>

              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {visit.visit_number}
                <span>·</span>
                <span className={visit.meeting_url ? 'text-emerald-700' : 'text-amber-700'}>
                  {visit.meeting_url
                    ? t('healthcare.telemedicine.roomReady')
                    : t('healthcare.telemedicine.roomMissing')}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void dispatchInvite(visit, 'whatsapp')}
                  isLoading={busy === `${visit.id}:whatsapp`}
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  {t('healthcare.telemedicine.whatsapp')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void dispatchInvite(visit, 'sms')}
                  isLoading={busy === `${visit.id}:sms`}
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  {t('healthcare.telemedicine.sms')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void copyLink(visit)}
                  isLoading={busy === `${visit.id}:copy`}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {t('healthcare.telemedicine.copyLink')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void joinCall(visit)}
                  isLoading={busy === `${visit.id}:join`}
                >
                  <Video className="h-3.5 w-3.5" aria-hidden />
                  {isCalling ? t('healthcare.telemedicine.joinCall') : t('healthcare.telemedicine.join')}
                </Button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                <Link
                  to={`/healthcare/consultation?visitId=${visit.id}`}
                  className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                >
                  <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                  {t('healthcare.telemedicine.openChart')}
                </Link>
                {visit.meeting_url && (
                  <a
                    href={visit.meeting_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    Jitsi
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <TelemedicineVideoModal
        open={Boolean(activeVisit)}
        visit={activeVisit}
        meetingUrl={activeVisit?.meeting_url ?? null}
        doctorName={doctorName}
        notes={notes}
        onNotesChange={setNotes}
        onCopyLink={() => setNotice(t('healthcare.telemedicine.copied'))}
        onSendInvite={() => setNotice(t('healthcare.telemedicine.dispatchSuccess'))}
        onSaveNotes={() => void saveNotes()}
        savingNotes={savingNotes}
        onEndCall={() => void endCall()}
        endingCall={endingCall}
        onClose={() => setActiveVisit(null)}
      />
    </div>
  );
}
