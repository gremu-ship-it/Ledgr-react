import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, X, LifeBuoy } from 'lucide-react';
import { SupportChat } from './SupportChat';

/**
 * Floating, always-available support assistant. Mounted once in AppLayout so it
 * appears on every authenticated page. Opening it reveals the shared SupportChat
 * in a compact popover; the full experience also lives at /support.
 */
export function SupportWidget() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Launcher button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('support.widgetAriaLabel')}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 transition-transform hover:scale-105 hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-300 sm:bottom-6 sm:right-6"
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={t('support.title')}
          className="fixed bottom-24 right-4 z-50 flex h-[72vh] max-h-[640px] w-[calc(100vw-2rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:bottom-24 sm:right-6"
        >
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500">
              <LifeBuoy className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-gray-900">
                {t('support.title')}
              </h2>
              <p className="truncate text-xs text-gray-500">{t('support.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 p-3">
            <SupportChat />
          </div>
        </div>
      )}
    </>
  );
}
