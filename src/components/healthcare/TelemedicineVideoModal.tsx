import { useTranslation } from 'react-i18next';
import { Copy, MessageCircle, PhoneOff, Save, Video } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HealthcareModal } from '@/components/healthcare/HealthcareModal';
import { AcuityBadge } from '@/components/healthcare/AcuityBadge';
import { QueueTokenBadge } from '@/components/healthcare/QueueTokenBadge';
import type { ClinicalFlowVisit } from '@/services/clinicalFlowService';
import { buildWhatsAppInviteUrl } from '@/services/telemedicineService';

/**
 * Split-screen virtual clinic: Jitsi runs in a native iframe on the left while
 * the doctor charts in the EHR panel on the right. No video SDK is loaded.
 */
export function TelemedicineVideoModal({
  open,
  onClose,
  visit,
  meetingUrl,
  doctorName,
  notes,
  onNotesChange,
  onCopyLink,
  onSendInvite,
  onSaveNotes,
  onEndCall,
  savingNotes = false,
  endingCall = false,
}: {
  open: boolean;
  onClose: () => void;
  visit: ClinicalFlowVisit | null;
  meetingUrl: string | null;
  doctorName?: string | null;
  notes: string;
  onNotesChange: (value: string) => void;
  onCopyLink?: (meetingUrl: string) => void;
  onSendInvite?: () => void;
  onSaveNotes?: () => void;
  onEndCall?: () => void;
  savingNotes?: boolean;
  endingCall?: boolean;
}) {
  const { t } = useTranslation();
  if (!visit) return null;

  const patient = visit.patient;
  const patientName = `${patient?.first_name ?? ''} ${patient?.last_name ?? ''}`.trim() || '—';
  const whatsAppUrl = meetingUrl
    ? buildWhatsAppInviteUrl({
        phone: patient?.phone ?? '',
        patientName,
        doctorName,
        meetingUrl,
      })
    : null;

  const copyLink = async () => {
    if (!meetingUrl) return;
    try {
      await navigator.clipboard?.writeText(meetingUrl);
      onCopyLink?.(meetingUrl);
    } catch {
      // Clipboard access can be blocked by the browser; the room link stays
      // visible in the dispatch card for manual copy.
    }
  };

  return (
    <HealthcareModal
      open={open}
      titleId="telemedicine-video-title"
      title={t('healthcare.telemedicine.videoTitle')}
      subtitle={`${patientName} · ${visit.visit_number}`}
      closeLabel={t('healthcare.telemedicine.close')}
      onClose={onClose}
      width="max-w-[1400px]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('healthcare.telemedicine.close')}
          </Button>
          <Button variant="secondary" onClick={() => void copyLink()} disabled={!meetingUrl}>
            <Copy className="h-4 w-4" aria-hidden />
            {t('healthcare.telemedicine.copyLink')}
          </Button>
          {whatsAppUrl && (
            <Button
              variant="secondary"
              onClick={() => {
                window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
                onSendInvite?.();
              }}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              {t('healthcare.telemedicine.whatsapp')}
            </Button>
          )}
          {onSaveNotes && (
            <Button variant="secondary" isLoading={savingNotes} onClick={onSaveNotes}>
              <Save className="h-4 w-4" aria-hidden />
              {t('healthcare.telemedicine.saveNotes')}
            </Button>
          )}
          {onEndCall && (
            <Button variant="destructive" isLoading={endingCall} onClick={onEndCall}>
              <PhoneOff className="h-4 w-4" aria-hidden />
              {t('healthcare.telemedicine.endCall')}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Video className="h-4 w-4 text-gray-400" aria-hidden />
            <QueueTokenBadge token={visit.queue_token} size="sm" />
            <AcuityBadge acuity={visit.acuity_level} />
            <span className="text-[11px] text-gray-500">
              {t('healthcare.telemedicine.connectionHint')}
            </span>
          </div>
          {meetingUrl ? (
            <iframe
              key={meetingUrl}
              title={t('healthcare.telemedicine.videoTitle')}
              src={meetingUrl}
              allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-[62vh] min-h-[380px] w-full rounded-xl border border-gray-200 bg-slate-950"
            />
          ) : (
            <div className="flex h-[62vh] min-h-[380px] items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 text-center text-sm text-gray-500">
              {t('healthcare.telemedicine.videoUnavailable')}
            </div>
          )}
        </div>

        <aside className="flex min-h-[380px] min-w-0 flex-col rounded-xl border border-gray-200 bg-gray-50/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{patientName}</p>
              <p className="font-mono text-[11px] text-gray-500">
                {patient?.mrn ?? '—'} · {visit.visit_type}
              </p>
            </div>
            {visit.results_ready_for_review && (
              <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-800">
                {t('healthcare.review.ready')}
              </span>
            )}
          </div>

          <label
            htmlFor="telemedicine-ehr-notes"
            className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gray-500"
          >
            {t('healthcare.telemedicine.notes')}
          </label>
          <p className="text-[11px] text-gray-400">{t('healthcare.telemedicine.notesHint')}</p>
          <textarea
            id="telemedicine-ehr-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            className="mt-1 min-h-[240px] flex-1 resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder={t('healthcare.telemedicine.notesHint')}
          />

          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-600">
            <div className="rounded-lg border border-gray-200 bg-white px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                {t('healthcare.radiology.modality')}
              </p>
              <p className="font-semibold text-gray-800">
                {visit.stage === 'results_review'
                  ? t('healthcare.review.ready')
                  : t(`healthcare.queueStage.${visit.stage}`)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                {t('healthcare.telemedicine.status')}
              </p>
              <p className="font-semibold text-gray-800">
                {t(`healthcare.telemedicine.statuses.${visit.telemedicine_status ?? 'waiting'}`)}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </HealthcareModal>
  );
}
