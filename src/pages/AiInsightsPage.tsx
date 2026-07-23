import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, TrendingUp, AlertCircle, Users, Receipt, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';

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

// ── Formatters ────────────────────────────────────────────────────────────────

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Suggested Questions ───────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  { icon: TrendingUp, text: 'How is my business performing this month?' },
  { icon: AlertCircle, text: 'Which invoices are overdue?' },
  { icon: Receipt, text: 'What are my biggest expenses this month?' },
  { icon: Users, text: 'Who are my top customers by revenue?' },
];

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
  } catch (err) {
    return `Business: ${businessName}\nDate: ${today}\nNote: Some data could not be loaded.`;
  }
}

// ── Parse Actions from AI Response ───────────────────────────────────────────

function parseActions(content: string): Action[] {
  const actions: Action[] = [];

  if (content.toLowerCase().includes('overdue') || content.toLowerCase().includes('invoice')) {
    actions.push({ label: 'View Invoices', path: '/invoices', variant: 'primary' });
  }
  if (content.toLowerCase().includes('expense')) {
    actions.push({ label: 'View Expenses', path: '/expenses', variant: 'secondary' });
  }
  if (content.toLowerCase().includes('payroll') || content.toLowerCase().includes('employee')) {
    actions.push({ label: 'View Payroll', path: '/payroll', variant: 'secondary' });
  }
  if (content.toLowerCase().includes('report') || content.toLowerCase().includes('profit') || content.toLowerCase().includes('loss')) {
    actions.push({ label: 'View Reports', path: '/reports', variant: 'secondary' });
  }
  if (content.toLowerCase().includes('customer') || content.toLowerCase().includes('supplier') || content.toLowerCase().includes('contact')) {
    actions.push({ label: 'View Contacts', path: '/contacts', variant: 'secondary' });
  }

  return actions.slice(0, 3);
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, onAction }: { message: Message; onAction: (path: string) => void }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
        isUser ? 'bg-brand-600' : 'bg-surface'
      }`}>
        {isUser
          ? <User className="h-4 w-4 text-white" />
          : <Bot className="h-4 w-4 text-sub" />}
      </div>

      <div className={`max-w-[75%] space-y-2 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand-600 text-white rounded-tr-sm'
            : 'bg-card border border-line text-ink rounded-tl-sm shadow-sm'
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
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'border border-line bg-card text-sub hover:bg-bg'
                }`}
              >
                {action.label} →
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-muted">
          {message.timestamp.toLocaleTimeString('en-MW', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ── Main AiInsight Page────────────────────────────────────────────────────

export function AiInsightsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name ?? 'your business';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Hello! I'm your Ledgr AI assistant for ${businessName}. I have access to your live financial data — invoices, expenses, payroll, and more.\n\nAsk me anything about your business, or try one of the suggestions below.`,
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
      id: Date.now().toString(),
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
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch('https://hsuhuvuxfuufrlejsatw.supabase.co/functions/v1/chat-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: `You are Ledgr AI, a financial assistant for small and medium businesses in Malawi. You have access to live business data shown below. Be concise, friendly, and specific — always reference actual numbers from the data. When you identify issues (overdue invoices, high expenses, etc.), suggest concrete actions. Use MWK currency. Never make up data not in the context

${context}`,
          messages: [
            ...history,
            { role: 'user', content: text.trim() },
          ],
        }),
      });

      const data = await response.json();
      const content = data.content?.[0]?.text ?? 'Sorry, I could not generate a response. Please try again.';

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content,
        actions: parseActions(content),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Sorry, something went wrong. Please check your connection and try again.',
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
        <p className="text-sm text-muted">No business selected.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Ledgr AI</h1>
          <p className="text-xs text-muted">Live data from {businessName} · Powered by Claude</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1">
          <div className="h-2 w-2 rounded-full bg-brand-600 animate-pulse" />
          <span className="text-xs font-medium text-brand-700 dark:text-brand-300">Connected</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-line bg-bg p-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onAction={(path) => navigate(path)}
          />
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface">
              <Bot className="h-4 w-4 text-sub" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-line bg-card px-4 py-3 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-brand-600 dark:text-brand-400" />
              <span className="text-sm text-muted">Analysing your data…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested questions — show only at start */}
      {messages.length === 1 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {SUGGESTED_QUESTIONS.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.text}
                onClick={() => sendMessage(q.text)}
                className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5 text-left text-xs font-medium text-sub hover:border-brand-300 hover:bg-brand-500/10 hover:text-brand-700 dark:text-brand-300 transition-colors shadow-sm"
              >
                <Icon className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                {q.text}
              </button>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div className="mt-3 flex gap-2 items-end">
        <div className="flex-1 rounded-xl border border-line bg-card shadow-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
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
            placeholder="Ask anything about your business…"
            className="w-full resize-none rounded-xl px-4 py-3 text-sm text-ink placeholder-gray-400 focus:outline-none"
            disabled={isLoading}
          />
        </div>
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-muted">Press Enter to send · Shift+Enter for new line</p>
    </div>
  );
}

// ── Navigate shim (avoids importing useNavigate at top level) ─────────────────
function useNavigateShim() {
  return (path: string) => {
    window.location.href = path;
  };
}
