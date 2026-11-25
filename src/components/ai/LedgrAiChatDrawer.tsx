import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AiChatView } from './AiChatView';

export interface LedgrAiChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Global slide-over conversational assistant launched from AppLayout. */
export function LedgrAiChatDrawer({ isOpen, onClose }: LedgrAiChatDrawerProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label={t('ai.chat.closeAssistant')}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-slate-950/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
      >
        <AiChatView variant="drawer" onClose={onClose} />
      </aside>
    </div>
  );
}

export default LedgrAiChatDrawer;
