import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Send,
  Bot,
  User,
  Loader2,
  HelpCircle,
  AlertTriangle,
  ShieldCheck,
  Receipt,
  DollarSign,
  BarChart2,
  RefreshCw,
  Lock,
  Download,
  Trash2,
  FileText,
  ArrowUpRight,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import {
  callSupportAgent,
  type SupportCategory,
  type SupportAction,
} from '@/lib/supportAgent';
import { getRecentErrors, clearCapturedErrors } from '@/lib/errorCapture';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: SupportAction[];
  escalate?: boolean;
}

let messageSequence = 0;
function nextMessageId(): string {
  messageSequence += 1;
  return `support-msg-${messageSequence}`;
}

const SUGGESTED: Record<SupportCategory, { icon: LucideIcon; textKey: string }[]> = {
  query: [
    { icon: Receipt, textKey: 'support.suggest.invoicing' },
    { icon: DollarSign, textKey: 'support.suggest.expenses' },
    { icon: BarChart2, textKey: 'support.suggest.reports' },
    { icon: HelpCircle, textKey: 'support.suggest.gettingStarted' },
  ],
  error: [
    { icon: AlertTriangle, textKey: 'support.suggest.crash' },
    { icon: RefreshCw, textKey: 'support.suggest.sync' },
    { icon: Lock, textKey: 'support.suggest.login' },
    { icon: Loader2, textKey: 'support.suggest.slow' },
  ],
  compliance: [
    { icon: Download, textKey: 'support.suggest.export' },
    { icon: Trash2, textKey: 'support.suggest.delete' },
    { icon: ShieldCheck, textKey: 'support.suggest.audit' },
    { icon: FileText, textKey: 'support.suggest.gdpr' },
  ],
};

const CATEGORIES: { id: SupportCategory; icon: LucideIcon; labelKey: string }[] = [
  { id: 'query', icon: HelpCircle, labelKey: 'support.categories.query' },
  { id: 'error', icon: AlertTriangle, labelKey: 'support.categories.error' },
  { id: 'compliance', icon: ShieldCheck, labelKey: 'support.categories.compliance' },
];

function MessageBubble({
  message,
  onAction,
}: {
  message: Message;
  onAction: (path: string) => void;
}) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-brand-500' : 'bg-gray-100'
        }`}
        aria-hidden="true"
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : (
          <Bot className="h-4 w-4 text-gray-600" />
        )}
      </div>

      <div
        className={`max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}
      >
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-brand-500 text-white rounded-tr-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
          }`}
        >
          {message.content}
        </div>

        {message.escalate && (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <LifeBuoy className="h-3.5 w-3.5" />
            {t('support.escalated')}
          </div>
        )}

        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => onAction(action.path)}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  action.variant === 'primary'
                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {action.label}
                <ArrowUpRight className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-gray-600">
          {new Date().toLocaleTimeString('en-MW', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

export function SupportChat() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: t('support.greeting'),
      actions: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [category, setCategory] = useState<SupportCategory>('query');
  const [attachDiagnostics, setAttachDiagnostics] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMessage: Message = {
        id: nextMessageId(),
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);
      setLastError(null);

      try {
        const context =
          category === 'error' && attachDiagnostics
            ? {
                errors: getRecentErrors(),
                appVersion: import.meta.env.VITE_APP_VERSION,
                platform:
                  typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                path: typeof window !== 'undefined' ? window.location.pathname : undefined,
              }
            : undefined;

        const history = messages
          .filter((m) => m.id !== '0')
          .map((m) => ({ role: m.role, content: m.content }));

        const result = await callSupportAgent({
          messages: [...history, { role: 'user', content: trimmed }],
          category,
          context,
        });

        if (category === 'error' && attachDiagnostics) clearCapturedErrors();

        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(),
            role: 'assistant',
            content: result.content,
            actions: result.actions,
            escalate: result.escalate,
          },
        ]);
      } catch {
        setLastError(t('support.error'));
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(),
            role: 'assistant',
            content: t('support.error'),
            actions: [],
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [category, attachDiagnostics, isLoading, messages, t],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const suggested = SUGGESTED[category];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Category selector */}
      <div className="flex flex-wrap gap-2 px-1 pb-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = cat.id === category;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-brand-500 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
              aria-pressed={active}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(cat.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Diagnostics toggle for error reports */}
      {category === 'error' && (
        <label className="mb-3 flex items-center gap-2 px-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={attachDiagnostics}
            onChange={(e) => setAttachDiagnostics(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          {t('support.attachDiagnostics')}
        </label>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onAction={(path) => navigate(path)}
          />
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
              <Bot className="h-4 w-4 text-gray-600" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
              <span className="text-sm text-gray-500">{t('support.analysing')}</span>
            </div>
          </div>
        )}

        {/* Suggested questions — only at the start of a conversation */}
        {messages.length === 1 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {suggested.map((q) => {
              const Icon = q.icon;
              return (
                <button
                  key={q.textKey}
                  type="button"
                  onClick={() => void sendMessage(t(q.textKey))}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  <Icon className="h-4 w-4 shrink-0 text-brand-500" />
                  {t(q.textKey)}
                </button>
              );
            })}
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Escalation footer */}
      {(lastError || messages.some((m) => m.escalate)) && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          {t('support.escalateFooter', { email: 'support@ledgr.app' })}
        </div>
      )}

      {/* Input */}
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1 rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('support.placeholder')}
            className="w-full resize-none rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
            disabled={isLoading}
          />
        </div>
        <button
          type="button"
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
          aria-label={t('support.send')}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-gray-600">{t('support.enterHint')}</p>
    </div>
  );
}
