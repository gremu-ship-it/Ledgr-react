import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Bot,
  Loader2,
  Send,
  Sparkles,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { createLogger } from '@/lib/logger';
import { buildAssistantContext } from '@/lib/ai/context';
import { getProvider, AI_SUGGESTIONS, suggestionsFor } from '@/lib/ai/provider';
import { advise } from '@/lib/ai/advisor';
import { SUPPORT_SUGGESTIONS } from '@/lib/ai/knowledge';
import type { AssistantMode, ChatMessage, DataContext } from '@/lib/ai/types';
import { Markdown } from './Markdown';

const log = createLogger('AssistantDrawer');

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantDrawerProps {
  mode: AssistantMode;
  companyName?: string;
  /** Controlled open state. Omit to let the drawer manage its own launcher. */
  open?: boolean;
  onClose?: () => void;
}

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `am-${sequence}`;
};

/**
 * The single chat surface for both assistants.
 *
 *   mode="support" — knowledge-base help (no company data required).
 *   mode="ai"      — Ledgr AI over live company data, with a business-health
 *                    card and an anomalies card on first open.
 *
 * Works with zero configuration: `getProvider()` returns the offline rules
 * engine unless VITE_AI_CHAT_URL points at the `ai-chat` Edge Function.
 */
export function AssistantDrawer({ mode, companyName, open, onClose }: AssistantDrawerProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const resolvedName = companyName ?? currentBusiness?.business?.name ?? 'your business';

  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? Boolean(open) : internalOpen;

  // Live data context: fetched on first open, then cached by React Query so
  // re-opening the drawer is instant. `buildAssistantContext` never throws for
  // data reasons — the catch is a last-resort guard so the UI still opens.
  const { data: context, isLoading: contextLoading } = useQuery<DataContext>({
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

  // Only the real conversation lives in state; the welcome turn is derived from
  // the context so there is no setState-in-effect and no stale greeting.
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const provider = useMemo(() => getProvider(), []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => {
    if (isControlled) onClose?.();
    else setInternalOpen(false);
  }, [isControlled, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking, isOpen]);

  const welcome = useMemo<DisplayMessage | null>(() => {
    if (!context) return null;
    return { id: 'welcome', role: 'assistant', content: welcomeFor(mode, context, resolvedName) };
  }, [context, mode, resolvedName]);

  const transcript = welcome ? [welcome, ...messages] : messages;

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return;

      const ctx: DataContext = context ?? { companyName: resolvedName };
      const history: ChatMessage[] = [
        ...(welcome ? [{ role: welcome.role, content: welcome.content } as ChatMessage] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
        { role: 'user', content: trimmed },
      ];

      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: trimmed }]);
      setInput('');
      setIsThinking(true);

      try {
        const answer = await provider.answer(history, ctx);
        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: answer.content }]);
        setSuggestions(answer.suggestions?.length ? answer.suggestions : suggestionsFor(trimmed, ctx));
      } catch (err) {
        log.error('Assistant answer failed', err as Error);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: 'Sorry — I could not answer that just now. Please try again, or rephrase the question.',
          },
        ]);
      } finally {
        setIsThinking(false);
        inputRef.current?.focus();
      }
    },
    [context, isThinking, messages, provider, resolvedName, welcome],
  );

  const health = useMemo(() => {
    if (mode !== 'ai' || !context?.data?.kpis) return null;
    return advise(context);
  }, [mode, context]);

  const anomalies = mode === 'ai' ? (context?.data?.anomalies ?? []) : [];
  const showCards = messages.length === 0;
  const chips = suggestions ?? (mode === 'ai' ? AI_SUGGESTIONS : SUPPORT_SUGGESTIONS);
  const providerLabel = provider.name === 'ledgr-rules' ? 'Ledgr analysis engine' : 'Ledgr AI';

  return (
    <>
      {!isControlled && (
        <button
          type="button"
          onClick={() => setInternalOpen((v) => !v)}
          aria-expanded={isOpen}
          aria-label={mode === 'ai' ? 'Open Ledgr AI' : 'Open the Ledgr assistant'}
          // Stacked above the support launcher, which owns bottom-20 / sm:bottom-6.
          className="fixed bottom-36 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-900/40 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-300 sm:bottom-24 sm:right-6"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
        </button>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-label={mode === 'ai' ? 'Ledgr AI assistant' : 'Ledgr support assistant'}
          className={clsx(
            'fixed z-50 flex flex-col overflow-hidden border border-white/10 bg-slate-950 text-slate-100 shadow-2xl',
            // Mobile: full-height sheet. Desktop: right-hand drawer.
            'inset-x-0 bottom-0 top-14 rounded-t-2xl',
            'sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:w-[26rem] sm:rounded-none sm:border-y-0 sm:border-r',
          )}
        >
          {/* Header */}
          <header className="flex items-start gap-3 border-b border-white/10 bg-slate-900/80 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600">
              <Sparkles className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-white">
                  {mode === 'ai' ? 'Ledgr AI' : 'Ledgr Assistant'}
                </h2>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  Connected
                </span>
              </div>
              <p className="truncate text-xs text-slate-400">
                {mode === 'ai' ? `Live data from ${resolvedName}` : 'Product help & how-to'} · {providerLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close assistant"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* Conversation */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {contextLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading your live data…
              </div>
            )}

            {/* Business health */}
            {health && showCards && (
              <section
                className={clsx(
                  'rounded-2xl border p-3',
                  health.rating === 'healthy' && 'border-emerald-500/30 bg-emerald-500/10',
                  health.rating === 'watch' && 'border-amber-500/30 bg-amber-500/10',
                  health.rating === 'danger' && 'border-rose-500/30 bg-rose-500/10',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <TrendingUp
                    className={clsx(
                      'h-4 w-4',
                      health.rating === 'healthy' && 'text-emerald-300',
                      health.rating === 'watch' && 'text-amber-300',
                      health.rating === 'danger' && 'text-rose-300',
                    )}
                    aria-hidden="true"
                  />
                  <span
                    className={clsx(
                      'text-xs font-semibold uppercase tracking-wide',
                      health.rating === 'healthy' && 'text-emerald-300',
                      health.rating === 'watch' && 'text-amber-300',
                      health.rating === 'danger' && 'text-rose-300',
                    )}
                  >
                    Business health · {health.rating}
                  </span>
                </div>
                <p className="text-xs text-slate-200">{health.headline}</p>
                {health.actions.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
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

            {/* Anomalies */}
            {mode === 'ai' && anomalies.length > 0 && showCards && (
              <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'} detected
                </div>
                <ul className="space-y-1 text-xs text-slate-300">
                  {anomalies.slice(0, 3).map((a, i) => (
                    <li key={`${a.type}-${a.occurred_on}-${i}`}>• {a.description}</li>
                  ))}
                  {anomalies.length > 3 && (
                    <li className="text-slate-400">…and {anomalies.length - 3} more.</li>
                  )}
                </ul>
              </section>
            )}

            {transcript.map((message) => (
              <div
                key={message.id}
                className={clsx('flex gap-2', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
              >
                <div
                  className={clsx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    message.role === 'user'
                      ? 'bg-gradient-to-br from-indigo-500 to-violet-600'
                      : 'border border-white/10 bg-slate-800',
                  )}
                  aria-hidden="true"
                >
                  {message.role === 'user'
                    ? <User className="h-3.5 w-3.5 text-white" />
                    : <Bot className="h-3.5 w-3.5 text-indigo-300" />}
                </div>
                <div
                  className={clsx(
                    'max-w-[85%] min-w-0 rounded-2xl px-3 py-2',
                    message.role === 'user'
                      ? 'rounded-tr-sm bg-gradient-to-br from-indigo-500 to-violet-600 text-white'
                      : 'rounded-tl-sm border border-white/10 bg-slate-900 text-slate-200',
                  )}
                >
                  {message.role === 'user'
                    ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                    : <Markdown content={message.content} />}
                </div>
              </div>
            ))}

            {isThinking && (
              <div className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-slate-800">
                  <Bot className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" aria-hidden="true" />
                  Thinking…
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips */}
          {chips.length > 0 && !isThinking && (
            <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-4 py-2">
              {chips.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-indigo-400/50 hover:bg-indigo-500/15 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-white/10 bg-slate-900/80 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex items-end gap-2">
              <label htmlFor="assistant-input" className="sr-only">
                Ask the assistant
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
                placeholder={mode === 'ai' ? 'Ask anything about your business…' : 'Ask how to do something in Ledgr…'}
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400/60 focus:outline-none focus:ring-1 focus:ring-indigo-400/60 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={isThinking || input.trim() === ''}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Press Enter to send · Shift+Enter for a new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function welcomeFor(mode: AssistantMode, ctx: DataContext, companyName: string): string {
  if (mode === 'support') {
    return [
      `Hi! I'm the Ledgr assistant for **${companyName}**.`,
      '',
      'I can walk you through invoicing, expenses, bank and mobile money reconciliation, reports, payroll, tax and MRA deadlines, team roles, and data export or privacy.',
      '',
      'What would you like to do?',
    ].join('\n');
  }

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
