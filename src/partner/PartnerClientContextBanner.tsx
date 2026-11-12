import { Eye, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PartnerClientContextSession } from './partnerClientContext';

export function PartnerClientContextBanner({ session, onExit }: { session: PartnerClientContextSession; onExit: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 sm:px-6" role="status">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-semibold">{t('partner.viewingAsPartner')}</span>
        <span className="text-amber-900">{session.businessName}</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium">{t('partner.readOnly')}</span>
      </div>
      <button type="button" onClick={onExit} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-amber-100">
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t('partner.exitClientContext')}
      </button>
    </div>
  );
}
