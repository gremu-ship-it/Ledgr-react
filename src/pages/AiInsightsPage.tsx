import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Send, Bot, User, Sparkles, TrendingUp, AlertCircle, Users, Receipt, Loader2, Calendar } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const log = createLogger('AiInsightsPage');
import { useAppStore } from '@/store/useAppStore';
import { callAiInsightsAgent } from '@/lib/aiInsightsAgent';
import {
  buildRichBusinessContext,
  detectAdvancedAnomalies,
  generateCashFlowForecast,
  getTaxPlanningSuggestions,
  generateNarrativeReport,
  type BusinessContext,
  type Anomaly,
  type CashForecast,
  type TaxPlanningSuggestion,
} from '@/lib/aiFinancial';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  timestamp: Date;
}

interface Action {
  label: string;
  path: string;
  variant: 'primary' | 'secondary';
}



let messageSequence = 0;
function nextMessageId(): string {
  messageSequence += 1;
  return `msg-${messageSequence}`;
}

// ── Formatters ────────────────────────────────────────────────────────────────


// ── Suggested Questions ───────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  { icon: TrendingUp, textKey: 'ai.suggestPerformance' },
  { icon: AlertCircle, textKey: 'ai.suggestOverdue' },
  { icon: Receipt, textKey: 'ai.suggestExpenses' },
  { icon: Users, textKey: 'ai.suggestCustomers' },
];

// ── Build Business Context (uses new rich context) ───────────────────────────
async function buildBusinessContext(businessId: string, businessName: string): Promise<string> {
  const ctx = await buildRichBusinessContext(businessId, businessName);
  
  return `BUSINESS CONTEXT FOR AI ASSISTANT
===================================
Business: ${ctx.businessName}
Date: ${ctx.today}
Currency: ${ctx.currency}

FINANCIAL SUMMARY (Last 3 Months)
---------------------------------
${ctx.last3MonthsPL}

CASH POSITION
-------------
Current Cash: ${ctx.cashBalance}

OUTSTANDING INVOICES
--------------------
${ctx.outstandingInvoices}

UPCOMING TAX DEADLINES (MRA)
----------------------------
${ctx.upcomingTaxDeadlines}

ANOMALIES DETECTED
------------------
${ctx.anomalies.length > 0 ? ctx.anomalies.join('\n') : 'No anomalies detected.'}

Use the data above to give specific, actionable financial advice.`.trim();
}

// ── Parse Actions from AI Response ───────────────────────────────────────────

function parseActions(content: string, t: TFunction): Action[] {
  const actions: Action[] = [];

  if (content.toLowerCase().includes('overdue') || content.toLowerCase().includes('invoice')) {
    actions.push({ label: t('ai.viewInvoices'), path: '/invoices', variant: 'primary' });
  }
  if (content.toLowerCase().includes('expense')) {
    actions.push({ label: t('ai.viewExpenses'), path: '/expenses', variant: 'secondary' });
  }
  if (content.toLowerCase().includes('payroll') || content.toLowerCase().includes('employee')) {
    actions.push({ label: t('ai.viewPayroll'), path: '/payroll', variant: 'secondary' });
  }
  if (content.toLowerCase().includes('report') || content.toLowerCase().includes('profit') || content.toLowerCase().includes('loss')) {
    actions.push({ label: t('ai.viewReports'), path: '/reports', variant: 'secondary' });
  }
  if (content.toLowerCase().includes('customer') || content.toLowerCase().includes('supplier') || content.toLowerCase().includes('contact')) {
    actions.push({ label: t('ai.viewContacts'), path: '/contacts', variant: 'secondary' });
  }

  return actions.slice(0, 3);
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, onAction }: { message: Message; onAction: (path: string) => void }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
        isUser ? 'bg-brand-500' : 'bg-gray-100'
      }`}>
        {isUser
          ? <User className="h-4 w-4 text-white" />
          : <Bot className="h-4 w-4 text-gray-600" />}
      </div>

      <div className={`max-w-[75%] space-y-2 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand-500 text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`}>
          {message.content.split('\n').map((line, i) => (
            <span key={i}>
              {line}
              {i < message.content.split('\n').length - 1 && <br />}
            </span>
          ))}
        </div>

        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <button
                key={action.path}
                onClick={() => onAction(action.path)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  action.variant === 'primary'
                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                    : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {action.label} →
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-gray-600">
          {message.timestamp.toLocaleTimeString('en-MW', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ── Main AiInsight Page────────────────────────────────────────────────────

export function AiInsightsPage() {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name ?? t('ai.yourBusiness');

  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [taxSuggestions, setTaxSuggestions] = useState<TaxPlanningSuggestion[]>([]);
  const [cashForecast, setCashForecast] = useState<CashForecast | null>(null);
  const [forecastFailed, setForecastFailed] = useState(false);
  const [richContext, setRichContext] = useState<BusinessContext | null>(null);

  // Load advanced AI intelligence on mount
  useEffect(() => {
    if (!businessId) return;

    const loadIntelligence = async () => {
      // allSettled, not all: generateCashFlowForecast now propagates query
      // failures rather than returning a fabricated flat forecast, and one
      // failing panel must not blank out the other three.
      const [anoms, tax, forecastData, context] = await Promise.allSettled([
        detectAdvancedAnomalies(businessId),
        getTaxPlanningSuggestions(businessId),
        generateCashFlowForecast(businessId),
        buildRichBusinessContext(businessId, businessName),
      ]);

      setAnomalies(anoms.status === 'fulfilled' ? anoms.value : []);
      setTaxSuggestions(tax.status === 'fulfilled' ? tax.value : []);
      setRichContext(context.status === 'fulfilled' ? context.value : null);

      if (forecastData.status === 'fulfilled') {
        setCashForecast(forecastData.value);
        setForecastFailed(false);
      } else {
        // Leave the forecast null and say so in the UI. Showing nothing is
        // fine; showing an invented flat line as though it were a real
        // projection is not.
        log.error('Cash-flow forecast failed', { reason: forecastData.reason });
        setCashForecast(null);
        setForecastFailed(true);
      }
    };

    void loadIntelligence();
  }, [businessId, businessName]);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: t('ai.hello', { business: businessName }),
      actions: [],
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading || !businessId) return;

    const userMessage: Message = {
      id: nextMessageId(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Use rich context
      const context = await buildBusinessContext(businessId, businessName);

      const history = [
        ...messages
          .filter((m) => m.id !== '0')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: userMessage.content },
      ];

      const { content } = await callAiInsightsAgent({
        messages: history,
        businessContext: context,
      });

      // Special handling for natural language report requests
      let finalContent = content;
      if (text.toLowerCase().includes('report') || text.toLowerCase().includes('perform') || text.toLowerCase().includes('q1')) {
        if (richContext) {
          const narrative = await generateNarrativeReport(businessId, text, richContext);
          finalContent = `${content}\n\n---\n**Structured Narrative Report**\n\n${narrative}`;
        }
      }

      const assistantMessage: Message = {
        id: nextMessageId(),
        role: 'assistant',
        content: finalContent,
        actions: parseActions(content, t),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      log.error('AI chat response failed', err as Error);
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: 'assistant',
          content: t('ai.error'),
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">{t('ai.noBusinessSelected')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('ai.title')}</h1>
          <p className="text-xs text-gray-500">{t('ai.liveDataFrom', { business: businessName })}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1">
          <div className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
          <span className="text-xs font-medium text-brand-700">
            {t('ai.connected')}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-4">
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
              <span className="text-sm text-gray-500">{t('ai.analysing')}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Anomaly banner (enhanced) */}
      {anomalies.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <AlertCircle className="h-4 w-4" /> {anomalies.length} Financial Anomaly{anomalies.length > 1 ? 's' : ''} Detected
          </div>
          <div className="text-xs">
            {anomalies.slice(0, 3).map((a, i) => (
              <div key={i}>• {a.description}</div>
            ))}
          </div>
        </div>
      )}

      {/* Tax Planning Banner */}
      {taxSuggestions.length > 0 && (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-semibold mb-1">
            <Calendar className="h-4 w-4" /> Year-End Tax Planning
          </div>
          {taxSuggestions.map((s, i) => (
            <div key={i} className="text-xs mb-1">
              <strong>{s.title}</strong>: {s.description} — Potential saving: {s.potentialSaving}
            </div>
          ))}
        </div>
      )}

      {/* Cash Flow Negative Alert */}
      {cashForecast?.negativeAlert && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          ⚠️ Cash flow forecast shows negative balance within 60 days. Review expenses or accelerate collections.
        </div>
      )}

      {forecastFailed && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ [Unavailable / Experimental] Cash flow forecast is unavailable right now. Cash-account forecast logic is pending implementation. Other insights are unaffected.
        </div>
      )}

      {/* Suggested questions — show only at start */}
      {messages.length === 1 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {SUGGESTED_QUESTIONS.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.textKey}
                onClick={() => sendMessage(t(q.textKey))}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-xs font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors shadow-sm"
              >
                <Icon className="h-4 w-4 shrink-0 text-brand-500" />
                {t(q.textKey)}
              </button>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div className="mt-3 flex gap-2 items-end">
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
            placeholder={t('ai.placeholder')}
            className="w-full resize-none rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
            disabled={isLoading}
          />
        </div>
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-gray-600">{t('ai.enterHint')}</p>
    </div>
  );
}
