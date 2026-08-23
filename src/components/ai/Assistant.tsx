import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart2,
  Bot,
  DollarSign,
  Download,
  FileText,
  HelpCircle,
  LifeBuoy,
  Loader2,
  Lock,
  RefreshCw,
  Receipt,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useUsage } from '@/hooks/useUsage';
import { hasCapability } from '@/lib/billing/plans';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { createLogger } from '@/lib/logger';
import { buildAssistantContext } from '@/lib/ai/context';
import {
  answerLocally,
  getProvider,
  getSupportProvider,
  AI_SUGGESTIONS,
  suggestionsFor,
} from '@/lib/ai/provider';
import { advise } from '@/lib/ai/advisor';
import {
  type SupportCategory,
  type SupportContext,
} from '@/lib/supportAgent';
import { getRecentErrors, clearCapturedErrors } from '@/lib/errorCapture';
import type { AnswerAction, AssistantMode, ChatMessage, DataContext } from '@/lib/ai/types';
import { Markdown } from './Markdown';

const log = createLogger('Assistant');

/**
 * The single unified Ledgr assistant — Support and Ledgr AI in one drawer.
 *
 * Replaces the old `SupportChat` + `SupportWidget` (floating help launcher)
 * and the old `AssistantDrawer` + `AssistantWidget` (floating data-aware AI
 * launcher), which used to be mounted as two stacked buttons. AppLayout now
 * mounts ONE of these; the same component is rendered full-page at `/ai`
 * (Ledgr AI tab) and `/support` (Support tab).
 *
 * Resilience: every answer path degrades silently to the local knowledge
 * base — `supportProvider` falls back from the `support-agent` Edge Function
 * and `getProvider` falls back from the `ai-chat` Edge Function to the
 * offline `rulesProvider` engine. A conversation can therefore never end in
 * a "couldn't reach the assistant" dead-end.
 *
 * Brand: emerald (`brand-*`), 60% neutral canvas / 30% navy text / 10%
 * emerald action, per the design system in `src/index.css`.
 */

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AnswerAction[];
  escalate?: boolean;
  fallback?: boolean;
}

interface Chip {
  label: string;
  icon?: LucideIcon;
}

export interface AssistantProps {
  /**
   * 'drawer' — fixed floating panel + launcher button (AppLayout).
   * 'page'   — inline panel that fills its parent (/ai and /support routes).
   */
  variant?: 'drawer' | 'page';
  /** Starting tab. Defaults to 'support'. */
  initialMode?: AssistantMode;
  /** Controlled open state for the drawer variant; omit to manage internally. */
  open?: boolean;
  onClose?: () => void;
  /** Show the title bar (drawer + /ai). /support has its own page header. */
  showHeader?: boolean;
  /** Extra classes for the panel root (page variant sizing). */
  className?: string;
}

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `am-${sequence}`;
};

// ── Support-tab controls (preserved from the old SupportChat) ───────────────

const CATEGORIES: { id: SupportCategory; icon: LucideIcon; labelKey: string }[] = [
  { id: 'query', icon: HelpCircle, labelKey: 'support.categories.query' },
  { id: 'error', icon: AlertTriangle, labelKey: 'support.categories.error' },
  { id: 'compliance', icon: ShieldCheck, labelKey: 'support.categories.compliance' },
];

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

export function Assistant({
  variant = 'drawer',
  initialMode = 'support',
  open,
  onClose,
  showHeader = true,
  className,
}: AssistantProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const resolvedName = currentBusiness?.business?.name ?? 'your business';

  const isPage = variant === 'page';
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isPage || (isControlled ? Boolean(open) : internalOpen);

  const [tab, setTab] = useState<AssistantMode>(initialMode);
  const [category, setCategory] = useState<SupportCategory>('query');
  const [attachDiagnostics, setAttachDiagnostics] = useState(true);

  // The Ledgr AI tab needs (a) the `ai_agent` feature flag, (b) a business in
  // scope and (c) the `ai_insights` plan capability — the same gate that
  // guards the /ai route. The Support tab is always available. If the AI tab
  // becomes unavailable while open (e.g. a plan change), we render Support.
  const { planTier } = useUsage();
  const aiAvailable =
    isFeatureEnabled('ai_agent') && Boolean(businessId) && hasCapability(planTier, 'ai_insights');
  const mode: AssistantMode = aiAvailable ? tab : 'support';

  // One conversation per tab so switching tabs never loses the transcript.
  const [conversations, setConversations] = useState<Record<AssistantMode, DisplayMessage[]>>({
    support: [],
    ai: [],
  });
  const [suggestions, setSuggestions] = useState<Record<AssistantMode, string[] | null>>({
    support: null,
    ai: null,
  });
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  // Live data context, fetched on first open (drawer) or mount (page) and
  // cached by React Query so re-opening is instant. buildAssistantContext
  // never throws for data reasons — the catch is a last-resort guard.
  const contextQuery = useQuery<DataContext>({
    queryKey: ['assistant-context', mode, businessId ?? null, currentUser?.id ?? null],
    queryFn: async () => {
      try {
        return await buildAssistantContext(currentUser?.id ?? null, businessId ?? null, mode);
      } catch (err) {
        log.error('Failed to build assistant context', err as Error);
        return { companyName: resolvedName };
      }
    },
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });
  const context = contextQuery.data;

  const providers = useMemo(
    () => ({
      support: getSupportProvider(),
      ai: getProvider(),
    }),
    [],
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => {
    if (isPage) return;
    if (isControlled) onClose?.();
    else setInternalOpen(false);
  }, [isPage, isControlled, onClose]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!isOpen || isPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isPage, close]);

  // Keep the newest message in view.
  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, isThinking, isOpen]);

  // Focus the composer when the drawer opens.
  useEffect(() => {
    if (isOpen && !isPage) inputRef.current?.focus();
  }, [isOpen, isPage]);

  // The welcome turn is derived from the context (no setState-in-effect).
  const welcome = useMemo<{ id: string; role: 'assistant'; content: string } | null>(() => {
    if (!context) return null;
    if (mode === 'support') {
      return { id: 'welcome', role: 'assistant', content: t('support.greeting') };
    }
    return { id: 'welcome', role: 'assistant', content: welcomeForAi(context, resolvedName) };
  }, [context, mode, resolvedName, t]);

  const messages = conversations[mode];
  const transcript = welcome ? [welcome, ...messages] : messages;

  const pushMessage = useCallback((m: AssistantMode, msg: DisplayMessage) => {
    setConversations((prev) => ({ ...prev, [m]: [...prev[m], msg] }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return;

      const activeMode = mode;
      const provider = providers[activeMode];
      const baseCtx: DataContext = context ?? { companyName: resolvedName };

      // Diagnostics attachment (preserved from SupportChat): recent sanitised
      // browser errors ride along with "Report a problem" messages.
      const diagnostics: SupportContext | undefined =
        activeMode === 'support' && category === 'error' && attachDiagnostics
          ? {
              errors: getRecentErrors(),
              appVersion: import.meta.env.VITE_APP_VERSION,
              platform: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
              path: typeof window !== 'undefined' ? window.location.pathname : undefined,
            }
          : undefined;

      const ctx: DataContext =
        activeMode === 'support'
          ? { ...baseCtx, support: { category, context: diagnostics } }
          : baseCtx;

      const history: ChatMessage[] = [
        ...(welcome ? [{ role: 'assistant' as const, content: welcome.content }] : []),
        ...conversations[activeMode].map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
        { role: 'user' as const, content: trimmed },
      ];

      pushMessage(activeMode, { id: nextId(), role: 'user', content: trimmed });
      setInput('');
      setIsThinking(true);

      try {
        // Both providers resolve on their local knowledge base when the
        // remote function fails, so this catch is a last-resort guard that
        // also answers locally — the user never sees a dead-end error.
        const answer = await provider.answer(history, ctx);

        // Diagnostics were consumed by the support agent only when it
        // actually answered (not when the local KB took over).
        if (activeMode === 'support' && diagnostics && !answer.fallback) clearCapturedErrors();

        pushMessage(activeMode, {
          id: nextId(),
          role: 'assistant',
          content: answer.content,
          actions: answer.actions,
          escalate: answer.escalate,
          fallback: answer.fallback,
        });

        if (activeMode === 'ai') {
          setSuggestions((prev) => ({
            ...prev,
            ai: answer.suggestions?.length ? answer.suggestions : suggestionsFor(trimmed, ctx),
          }));
        }
      } catch (err) {
        log.error('Assistant answer failed — answering from the local knowledge base', err as Error);
        pushMessage(activeMode, {
          id: nextId(),
          role: 'assistant',
          content: answerLocally(trimmed, ctx),
          fallback: true,
        });
        if (activeMode === 'ai') {
          setSuggestions((prev) => ({ ...prev, ai: suggestionsFor(trimmed, ctx) }));
        }
      } finally {
        setIsThinking(false);
        inputRef.current?.focus();
      }
    },
    [attachDiagnostics, category, context, conversations, isThinking, mode, providers, pushMessage, resolvedName, welcome],
  );

  // Business health + anomalies cards (Ledgr AI tab, first screen only).
  const health = useMemo(() => {
    if (mode !== 'ai' || !context?.data?.kpis) return null;
    return advise(context);
  }, [mode, context]);

  const anomalies = mode === 'ai' ? (context?.data?.anomalies ?? []) : [];
  const showCards = messages.length === 0;

  const chips = useMemo<Chip[]>(() => {
    if (mode === 'support') {
      return SUGGESTED[category].map((c) => ({ icon: c.icon, label: t(c.textKey) }));
    }
    return (suggestions.ai ?? AI_SUGGESTIONS).map((s) => ({ label: s }));
  }, [mode, category, suggestions.ai, t]);

  const escalated = messages.some((m) => m.escalate);
  const providerLabel =
    mode === 'support'
      ? t('assistant.provider.ledgrSupport')
      : t(providers.ai.name.startsWith('ledgr-ai') ? 'assistant.provider.ledgrAi' : 'assistant.provider.ledgrRules');

  const subtitle =
    mode === 'support'
      ? `${t('assistant.supportSubtitle')} · ${providerLabel}`
      : `${t('assistant.aiSubtitle', { business: resolvedName })} · ${providerLabel}`;

  const panel = (
    <div
      role={isPage ? undefined : 'dialog'}
      aria-label={isPage ? undefined : t('assistant.title')}
      aria-modal={isPage ? undefined : true}
      className={clsx(
        'flex min-h-0 flex-col overflow-hidden bg-white text-gray-900',
        !isPage &&
          clsx(
            'fixed z-50 border border-gray-200 shadow-2xl',
            // Mobile: full-height sheet. Desktop: right-hand drawer.
            'inset-x-0 bottom-0 top-14 rounded-t-2xl',
            'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[26rem] sm:rounded-none sm:border-y-0 sm:border-l',
          ),
        isPage && clsx('h-full', className),
      )}
    >
      {/* Header */}
      {showHeader && (
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700">
            <Sparkles className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-gray-900">{t('assistant.title')}</h2>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                {t('assistant.online')}
              </span>
            </div>
            <p className="truncate text-xs text-gray-500">{subtitle}</p>
          </div>
          {!isPage && (
            <button
              type="button"
              onClick={close}
              aria-label={t('assistant.close')}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </header>
      )}

      {/* Mode tabs — hidden when only Support is available */}
      {aiAvailable && (
        <div role="tablist" aria-label={t('assistant.tabs.label')} className="flex gap-1 border-b border-gray-200 bg-gray-50 px-3 py-2">
          {(
            [
              { id: 'support' as const, icon: LifeBuoy, labelKey: 'assistant.tabs.support' },
              { id: 'ai' as const, icon: Sparkles, labelKey: 'assistant.tabs.ai' },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  active ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-gray-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      )}

      {/* Support-tab controls (category + diagnostics attachment) */}
      {mode === 'support' && (
        <div className="space-y-2 border-b border-gray-200 bg-gray-50/60 px-4 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active = cat.id === category;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  aria-pressed={active}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-brand-500 text-white'
                      : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t(cat.labelKey)}
                </button>
              );
            })}
          </div>

          {category === 'error' && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={attachDiagnostics}
                onChange={(e) => setAttachDiagnostics(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              />
              {t('support.attachDiagnostics')}
            </label>
          )}
        </div>
      )}

      {/* Conversation */}
      <div role="tabpanel" className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4">
        {contextQuery.isLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" />
            {t('assistant.loadingData')}
          </div>
        )}

        {/* Business health (Ledgr AI) */}
        {health && showCards && (
          <section
            className={clsx(
              'rounded-2xl border p-3',
              health.rating === 'healthy' && 'border-brand-200 bg-brand-50',
              health.rating === 'watch' && 'border-amber-200 bg-amber-50',
              health.rating === 'danger' && 'border-red-200 bg-red-50',
            )}
          >
            <div className="mb-1 flex items-center gap-2">
              <TrendingUp
                className={clsx(
                  'h-4 w-4',
                  health.rating === 'healthy' && 'text-brand-700',
                  health.rating === 'watch' && 'text-amber-600',
                  health.rating === 'danger' && 'text-red-600',
                )}
                aria-hidden="true"
              />
              <span
                className={clsx(
                  'text-xs font-semibold uppercase tracking-wide',
                  health.rating === 'healthy' && 'text-brand-700',
                  health.rating === 'watch' && 'text-amber-700',
                  health.rating === 'danger' && 'text-red-700',
                )}
              >
                {t('assistant.healthCard')} · {health.rating}
              </span>
            </div>
            <p className="text-xs text-gray-700">{health.headline}</p>
            {health.actions.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-gray-600">
                {health.actions.slice(0, 2).map((action) => (
                  <li key={action} className="flex gap-1.5">
                    <span aria-hidden="true">→</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Anomalies (Ledgr AI) */}
        {anomalies.length > 0 && showCards && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {t('assistant.anomaliesDetected', { count: anomalies.length })}
            </div>
            <ul className="space-y-1 text-xs text-gray-600">
              {anomalies.slice(0, 3).map((a, i) => (
                <li key={`${a.type}-${a.occurred_on}-${i}`}>• {a.description}</li>
              ))}
              {anomalies.length > 3 && (
                <li className="text-gray-500">{t('assistant.andMore', { count: anomalies.length - 3 })}</li>
              )}
            </ul>
          </section>
        )}

        {transcript.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            fallbackNote={t('assistant.fallbackNote')}
            onAction={(path) => navigate(path)}
          />
        ))}

        {isThinking && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
              <Bot className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden="true" />
              {t('assistant.thinking')}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips */}
      {chips.length > 0 && !isThinking && (
        <div className="flex flex-wrap gap-1.5 border-t border-gray-200 bg-white px-4 py-2">
          {chips.slice(0, 4).map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => void send(chip.label)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                {Icon && <Icon className="h-3 w-3 shrink-0 text-brand-600" aria-hidden="true" />}
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Escalation footer */}
      {escalated && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {t('support.escalateFooter', { email: 'support@ledgr.app' })}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            {t('assistant.askLabel')}
          </label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={input}
            rows={1}
            disabled={isThinking}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={mode === 'ai' ? t('assistant.placeholderAi') : t('assistant.placeholderSupport')}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={isThinking || input.trim() === ''}
            aria-label={t('assistant.send')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">{t('assistant.enterHint')}</p>
      </div>
    </div>
  );

  if (isPage) return panel;

  return (
    <>
      {/* Launcher — the single floating assistant button */}
      <button
        type="button"
        onClick={() => setInternalOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label={t('assistant.open')}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 transition-transform hover:scale-105 hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-300 sm:bottom-6 sm:right-6"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {isOpen && panel}
    </>
  );
}

function MessageBubble({
  message,
  fallbackNote,
  onAction,
}: {
  message: DisplayMessage;
  fallbackNote: string;
  onAction: (path: string) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-brand-500' : 'border border-gray-200 bg-gray-100',
        )}
        aria-hidden="true"
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-white" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-brand-600" />
        )}
      </div>

      <div className={`flex min-w-0 max-w-[85%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={clsx(
            'rounded-2xl px-3 py-2',
            isUser
              ? 'rounded-tr-sm bg-brand-500 text-white'
              : 'rounded-tl-sm border border-gray-200 bg-white text-gray-800 shadow-sm',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          ) : (
            <Markdown content={message.content} />
          )}
        </div>

        {message.escalate && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
            <LifeBuoy className="h-3 w-3" aria-hidden="true" />
            <EscalatedLabel />
          </div>
        )}

        {message.fallback && (
          <p className="mt-1 text-[10px] text-gray-400">{fallbackNote}</p>
        )}

        {message.actions && message.actions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.actions.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => onAction(action.path)}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                  action.variant === 'primary'
                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {action.label}
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** i18n'd escalation chip text (kept in a tiny component for hook locality). */
function EscalatedLabel() {
  const { t } = useTranslation();
  return <span>{t('support.escalated')}</span>;
}

function welcomeForAi(ctx: DataContext, companyName: string): string {
  if (!ctx.data?.kpis) {
    return [
      `Hi! I'm **Ledgr AI** for **${companyName}**.`,
      '',
      'I could not find any posted activity yet. Once you capture invoices and expenses I can analyse performance, forecast cash and flag anomalies from your real numbers.',
    ].join('\n');
  }

  return [
    `Hi! I'm **Ledgr AI**, reading **${companyName}**'s live books.`,
    '',
    'Ask me about performance, overdue invoices, a cash-flow forecast, or what to improve — every figure I quote comes straight from your ledger.',
  ].join('\n');
}
