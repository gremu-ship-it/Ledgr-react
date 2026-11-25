import { useTranslation } from 'react-i18next';
import { AiChatView } from './AiChatView';

/** Full-width embedded conversational console for the AI Insights page. */
export function AiChatConsole() {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label={t('ai.chat.consoleTitle')}>
      <div className="h-[min(75vh,640px)] min-h-[460px]">
        <AiChatView variant="console" />
      </div>
    </section>
  );
}

export default AiChatConsole;
