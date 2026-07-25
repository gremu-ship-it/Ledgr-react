import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Send, Bot, User, Sparkles, TrendingUp, AlertCircle, Users, Receipt, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { callArenaAgent, isArenaConfigured } from '@/lib/arenaAgent';

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

type JournalAnomalyRow = {
  status: string;
  entry_date: string;
  total_debits?: number | string | null;
};

type ForecastMovementRow = {
  total_debits?: number | string | null;
  total_credits?: number | string | null;
};

let messageSequence = 0;
function nextMessageId(): string {
  messageSequence += 1;
  return `msg-${messageSequence}`;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Suggested Questions ───────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  { icon: TrendingUp, textKey: 'ai.suggestPerformance' },
  { icon: AlertCircle, textKey: 'ai.suggestOverdue' },
  { icon: Receipt, textKey: 'ai.suggestExpenses' },
  { icon: Users, textKey: 'ai.suggestCustomers' },
];

// ── Anomaly Detection (runs on load) ─────────────────────────────────────────
async function detectAnomalies(businessId: string): Promise<string[]> {
  const anomalies: string[] = [];
  try {
    const { data } = await supabase
      .from('journal_entries')
      .select('status,entry_date,total_debits')
      .eq('business_id', businessId)
      .eq('status', 'posted');

    const posted = (data ?? []) as unknown as JournalAnomalyRow[];
    if (posted.length > 5) {
      const amounts = posted.map((j) => Number(j.total_debits ?? 0));
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const large = posted.filter((j) => Number(j.total_debits ?? 0) > avg * 2);
      if (large.length) anomalies.push(`${large.length} unusually large journal(s) (>2× average)`);
    }

    // Duplicate amounts same day
    const byDay: Record<string, number[]> = {};
    posted.forEach((j) => {
      const d = j.entry_date;
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(Number(j.total_debits ?? 0));
    });
    Object.entries(byDay).forEach(([d, arr]) => {
      const seen = new Set<number>();
      arr.forEach((a) => {
        if (seen.has(a)) anomalies.push(`Duplicate amount ${formatMwk(a)} on ${d}`);
        seen.add(a);
      });
    });
  } catch {
    return anomalies;
  }
  return anomalies;
}

// ── Cash Flow Forecast (simple 60-day projection) ─────────────────────────────
async function buildCashForecast(businessId: string): Promise<{ dates: string[]; projected: number[]; lower: number[]; upper: number[] }> {
  // Very lightweight projection — real implementation would use regression
  const today = new Date();
  const dates: string[] = [];
  const projected: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];

  // Pull last 3 months cash movement
  const start = new Date(today);
  start.setMonth(start.getMonth() - 3);
  const { data: movements } = await supabase
    .from('journal_entries')
    .select('entry_date,total_debits,total_credits')
    .eq('business_id', businessId)
    .gte('entry_date', start.toISOString().slice(0,10))
    .eq('status','posted');

  const netDaily = ((movements || []) as unknown as ForecastMovementRow[]).reduce(
    (sum, m) => sum + (Number(m.total_credits ?? 0) - Number(m.total_debits ?? 0)),
    0,
  ) / 90;
  let balance = 500000; // placeholder opening cash

  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0,10));
    balance += netDaily;
    projected.push(Math.round(balance));
    lower.push(Math.round(balance * 0.85));
    upper.push(Math.round(balance * 1.15));
  }
  return { dates, projected, lower, upper };
}

// ── Build Business Context ────────────────────────────────────────────────────

async function buildBusinessContext(businessId: string, businessName: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = `${today.slice(0, 7)}-01`;
  const startOfYear = `${today.slice(0, 4)}-01-01`;

  try {
    const [invoices, expenses, payrollRuns, contacts, accounts] = await Promise.all([
      repos.invoice.findByBusiness(businessId),
      repos.expense.findByBusiness(businessId),
      repos.payroll.findByBusiness(businessId),
      repos.contact.findByBusiness(businessId),
      repos.account.findByBusiness(businessId),
    ]);

    // Invoice analysis
    const allInvoices = invoices.filter((i) => i.invoice_type === 'invoice');
    const overdueInvoices = allInvoices.filter((i) =>
      i.status !== 'paid' && i.due_date && i.due_date < today
    );
    const monthInvoices = allInvoices.filter((i) => i.issue_date >= startOfMonth);
    const yearInvoices = allInvoices.filter((i) => i.issue_date >= startOfYear);
    const totalRevenue = yearInvoices.reduce((s, i) => s + Number(i.total_amount), 0);
    const monthRevenue = monthInvoices.reduce((s, i) => s + Number(i.total_amount), 0);
    const overdueAmount = overdueInvoices.reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0);

    // Expense analysis
    const monthExpenses = expenses.filter((e) => e.expense_date >= startOfMonth);
    const yearExpenses = expenses.filter((e) => e.expense_date >= startOfYear);
    const monthExpenseTotal = monthExpenses.reduce((s, e) => s + Number(e.total_amount), 0);
    const yearExpenseTotal = yearExpenses.reduce((s, e) => s + Number(e.total_amount), 0);

    // Payroll
    const lastPayroll = payrollRuns[0];

    // Cash position (bank accounts)
    const bankAccounts = accounts.filter((a) => a.is_bank_account);
    const cashAccounts = accounts.filter((a) =>
      a.account_subtype === 'current_asset' && !a.is_group && (a.code === '1110' || a.code === '1111')
    );

    // Top customers
    const customerRevenue: Record<string, { name: string; total: number }> = {};
    for (const inv of allInvoices) {
      if (!inv.contact_id) continue;
      const contact = contacts.find((c) => c.id === inv.contact_id);
      if (!contact) continue;
      if (!customerRevenue[inv.contact_id]) customerRevenue[inv.contact_id] = { name: contact.name, total: 0 };
      customerRevenue[inv.contact_id].total += Number(inv.total_amount);
    }
    const topCustomers = Object.values(customerRevenue)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Net profit this month
    const netProfitMonth = monthRevenue - monthExpenseTotal;

    const context = `
BUSINESS CONTEXT FOR AI ASSISTANT
===================================
Business: ${businessName}
Date: ${today}
Currency: Malawian Kwacha (MWK)

INCOME & INVOICES
-----------------
Total invoices this month: ${monthInvoices.length} (${formatMwk(monthRevenue)})
Total invoices this year: ${yearInvoices.length} (${formatMwk(totalRevenue)})
Overdue invoices: ${overdueInvoices.length} totalling ${formatMwk(overdueAmount)}
${overdueInvoices.length > 0 ? `Overdue details:\n${overdueInvoices.map((i) => `  - Invoice ${i.invoice_number}: ${formatMwk(Number(i.total_amount) - Number(i.amount_paid))} due ${i.due_date}`).join('\n')}` : ''}

EXPENSES
--------
Total expenses this month: ${monthExpenses.length} (${formatMwk(monthExpenseTotal)})
Total expenses this year: ${yearExpenses.length} (${formatMwk(yearExpenseTotal)})

PROFITABILITY
-------------
Net profit this month: ${formatMwk(netProfitMonth)} (${netProfitMonth >= 0 ? 'PROFIT' : 'LOSS'})
Net profit this year: ${formatMwk(totalRevenue - yearExpenseTotal)} (${totalRevenue - yearExpenseTotal >= 0 ? 'PROFIT' : 'LOSS'})

PAYROLL
-------
${lastPayroll ? `Last payroll run: ${lastPayroll.run_number} (${lastPayroll.payroll_period}) — Gross: ${formatMwk(Number(lastPayroll.total_gross))}, Net: ${formatMwk(Number(lastPayroll.total_net))}` : 'No payroll runs recorded yet.'}

TOP CUSTOMERS (by revenue)
--------------------------
${topCustomers.length > 0 ? topCustomers.map((c, i) => `${i + 1}. ${c.name}: ${formatMwk(c.total)}`).join('\n') : 'No customer data yet.'}

CONTACTS
--------
Total customers: ${contacts.filter((c) => c.contact_type === 'customer').length}
Total suppliers: ${contacts.filter((c) => c.contact_type === 'supplier').length}

BANK ACCOUNTS
-------------
${bankAccounts.length > 0 ? bankAccounts.map((a) => `${a.name} (${a.code}): Opening balance ${formatMwk(Number(a.opening_balance))}`).join('\n') : 'No bank accounts configured.'}
${cashAccounts.length > 0 ? cashAccounts.map((a) => `${a.name}: ${formatMwk(Number(a.opening_balance))}`).join('\n') : ''}
`.trim();

    return context;
  } catch {
    return `Business: ${businessName}\nDate: ${today}\nNote: Some data could not be loaded.`;
  }
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

        <span className="text-xs text-gray-400">
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

  const [anomalies, setAnomalies] = useState<string[]>([]);
  const [forecast, setForecast] = useState<unknown>(null);
  void forecast;

  useEffect(() => {
    if (businessId) {
      detectAnomalies(businessId).then(setAnomalies);
      buildCashForecast(businessId).then(setForecast);
    }
  }, [businessId]);

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
  const navigate = useNavigateShim();

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
      // Build context
      const context = await buildBusinessContext(businessId, businessName);

      // Build conversation history for the API
      const history = messages
        .filter((m) => m.id !== '0')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const { content } = await callArenaAgent(
        history,
        t('ai.systemPrompt'),
        context
      );

      const assistantMessage: Message = {
        id: nextMessageId(),
        role: 'assistant',
        content,
        actions: parseActions(content, t),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
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
            {isArenaConfigured() ? t('ai.arenaAgent') : t('ai.connected')}
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

      {/* Anomaly banner */}
      {anomalies.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('ai.anomaliesDetected', { count: anomalies.length, items: anomalies.slice(0, 2).join(', ') })}
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
      <p className="mt-2 text-center text-xs text-gray-400">{t('ai.enterHint')}</p>
    </div>
  );
}

// ── Navigate shim (avoids importing useNavigate at top level) ─────────────────
function useNavigateShim() {
  return (path: string) => {
    window.location.href = path;
  };
}
