import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { ArrowUp, ArrowUpRight, Bot, Sparkles, Trash2, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLedgrAiChat } from './useLedgrAiChat';
import { AiChatMarkdown } from './AiChatMarkdown';
import type { ChatMessage } from '@/services/aiChatService';

interface AiChatViewProps {
  variant: 'drawer' | 'console';
  onClose?: () => void;
}

/** Shared message stream, chips and composer used by the drawer and console. */
export function AiChatView({ variant, onClose }: AiChatViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { messages, input, setInput, send, clear, isThinking, error, chips, context } = useLedgrAiChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant === 'drawer') inputRef.current?.focus();
  }, [variant]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, isThinking]);

  const handleAction = (url?: string) => {
    if (!url) return;
    navigate(url);
    onClose?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {variant === 'drawer' ? (
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-slate-900">{t('ai.chat.drawerTitle')}</h2>
              <p className="text-[11px] text-slate-500">{t('ai.chat.drawerSubtitle')}</p>
              <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                {t('ai.chat.businessBadge', { name: context.businessName, plan: context.plan })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={clear}
              title={t('ai.chat.clearChat')}
              aria-label={t('ai.chat.clearChat')}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title={t('ai.chat.closeAssistant')}
                aria-label={t('ai.chat.closeAssistant')}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>
      ) : (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
              {t('ai.chat.consoleTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{t('ai.chat.consoleSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={clear}
            title={t('ai.chat.clearChat')}
            aria-label={t('ai.chat.clearChat')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Trash2 className="h-3.5 w-3.5" />{t('ai.chat.clearChat')}
          </button>
        </header>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4" aria-live="polite">
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} onAction={handleAction} />
        ))}
        {isThinking && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{t('ai.chat.suggestionsTitle')}</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isThinking}
              onClick={() => void send(chip)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[11px] font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor={`ai-chat-input-${variant}`} className="sr-only">{t('ai.chat.inputPlaceholder')}</label>
          <textarea
            id={`ai-chat-input-${variant}`}
            ref={inputRef}
            value={input}
            rows={2}
            disabled={isThinking}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder={t('ai.chat.inputPlaceholder')}
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={isThinking || input.trim() === ''}
            aria-label={t('ai.chat.sendButton')}
            title={t('ai.chat.sendButton')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message, onAction }: { message: ChatMessage; onAction: (url?: string) => void }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isUser ? 'bg-brand-500 text-white' : 'border border-slate-200 bg-white text-brand-600'}`} aria-hidden="true">
        {isUser ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>
      <div className={`min-w-0 max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-3 py-2 shadow-sm ${isUser ? 'rounded-tr-sm bg-brand-500 text-white' : 'rounded-tl-sm border border-slate-200 bg-white'}`}>
          {isUser ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p> : <AiChatMarkdown content={message.content} />}
        </div>
        {message.actionUrl && message.actionLabel && (
          <button
            type="button"
            onClick={() => onAction(message.actionUrl)}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-100"
          >
            {message.actionLabel}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2" role="status" aria-label={t('ai.analysing')}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-600">
        <Bot className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" />
      </div>
    </div>
  );
}

export default AiChatView;
