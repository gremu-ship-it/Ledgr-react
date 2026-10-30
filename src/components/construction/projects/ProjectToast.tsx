import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SuccessBanner } from '../constructionUi';

export function ProjectToast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex max-w-md items-center gap-2 rounded-lg bg-white p-2 shadow-xl"
      aria-live="polite"
    >
      <SuccessBanner message={message} />
      <button
        type="button"
        onClick={onClose}
        className="px-2 text-sm text-gray-600"
      >
        {t('construction.projects.close')}
      </button>
    </div>
  );
}
