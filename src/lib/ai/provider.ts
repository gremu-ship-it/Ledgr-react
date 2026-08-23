import { supabase } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';
import { callSupportAgent } from '@/lib/supportAgent';
import { advise } from './advisor';
import { negativeMonths } from './forecast';
import { mk, monthName, pct, shortDate } from './format';
import { SUPPORT_SUGGESTIONS } from './knowledge';
import type {
  AIAnswer,
  AIProvider,
  AiAnomaly,
  ChatMessage,
  DataContext,
  Forecast,
  KnowledgeArticle,
} from './types';

const log = createLogger('ai/provider');

/**
 * Provider selection.
 *
 *  • `VITE_AI_CHAT_URL` set  → remoteProvider: POST { messages, context } to the
 *    `ai-chat` Edge Function, which verifies the JWT, re-derives the company
 *    from `business_users`, rebuilds the DataContext server-side and calls the
 *    LLM with a server-held key. The key never reaches the browser.
 *  • otherwise               → rulesProvider: a deterministic rule + data
 *    engine that works completely offline with zero API keys.
 *
 * Every remote path falls back to `rulesProvider` (the local knowledge base)
 * on ANY failure — network, auth, timeout, missing deployment — so the
 * assistant is never dead and the user never sees a "couldn't reach the
 * support assistant" dead-end. Fallback answers are flagged with
 * `AIAnswer.fallback` so the UI can show a quiet source note.
 */
export function getProvider(): AIProvider {
  const url = import.meta.env.VITE_AI_CHAT_URL as string | undefined;
  return url ? remoteProvider(url) : rulesProvider();
}

/**
 * Support-mode provider: prefers the `support-agent` Edge Function (which
 * knows how to attach diagnostics, return action buttons and escalate) and
 * automatically degrades to the local knowledge base via `rulesProvider`
 * whenever the function is unreachable or errors. The degradation is silent —
 * `answer()` resolves with a useful built-in answer instead of throwing, so
 * the UI can never surface "couldn't reach the support assistant".
 */
export function getSupportProvider(): AIProvider {
  const local = rulesProvider();

  return {
    name: 'ledgr-support',
    async answer(messages: ChatMessage[], context: DataContext): Promise<AIAnswer> {
      try {
        // The support agent only speaks user/assistant turns.
        const history = messages
          .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content }));

        const result = await callSupportAgent({
          messages: history,
          category: context.support?.category ?? 'query',
          context: context.support?.context,
        });

        const content = result.content?.trim() ?? '';
        if (!content) throw new Error('support-agent returned an empty answer');

        return {
          content,
          provider: 'support-agent',
          suggestions: suggestionsFor(lastUserMessage(messages), context),
          actions: result.actions,
          escalate: result.escalate,
        };
      } catch (err) {
        log.warn('Support agent unavailable — degrading to the local knowledge base', {
          error: err instanceof Error ? err.message : String(err),
        });
        const localAnswer = await local.answer(messages, context);
        return { ...localAnswer, provider: 'ledgr-rules (local knowledge base)', fallback: true };
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Remote provider (LLM through the Edge Function)
// ═══════════════════════════════════════════════════════════════════════════

interface RemoteResponse {
  content?: unknown;
  provider?: unknown;
  suggestions?: unknown;
}

export function remoteProvider(url: string): AIProvider {
  const fallback = rulesProvider();

  return {
    name: 'ledgr-ai',
    async answer(messages: ChatMessage[], context: DataContext): Promise<AIAnswer> {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          // The server does NOT trust `context` for data — it rebuilds it from
          // the caller's membership. We send it so the model sees the same
          // conversation framing the UI showed, and so a support-mode request
          // carries its knowledge base.
          body: JSON.stringify({ messages, context: slimContext(context) }),
        });

        if (!res.ok) throw new Error(`ai-chat responded ${res.status}`);

        const body = (await res.json()) as RemoteResponse;
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) throw new Error('ai-chat returned an empty answer');

        return {
          content,
          provider: typeof body.provider === 'string' ? body.provider : 'ledgr-ai',
          suggestions: Array.isArray(body.suggestions)
            ? body.suggestions.filter((x): x is string => typeof x === 'string').slice(0, 4)
            : suggestionsFor(lastUserMessage(messages), context),
        };
      } catch (err) {
        log.warn('Remote AI unavailable — falling back to the offline engine', {
          error: err instanceof Error ? err.message : String(err),
        });
        const local = await fallback.answer(messages, context);
        return { ...local, provider: `${local.provider} (offline fallback)`, fallback: true };
      }
    },
  };
}

/** Trim the context before it crosses the wire (the server rebuilds data anyway). */
function slimContext(context: DataContext): Omit<DataContext, 'knowledgeBase'> & { knowledgeBaseTopics?: string[] } {
  const { knowledgeBase, ...rest } = context;
  return {
    ...rest,
    knowledgeBaseTopics: knowledgeBase?.map((a) => a.topic),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Rules provider (free, offline, deterministic)
// ═══════════════════════════════════════════════════════════════════════════

const INTENT = {
  greeting: /^\s*(hi|hey|hello|good\s*(morning|afternoon|evening)|yo|habari|moni)\b/i,
  forecast: /\b(forecast|projection|project(ed|ion)?|cash\s*flow|cashflow|runway|next\s+(month|quarter|3\s*months)|enough\s+cash|will\s+i\s+have)\b/i,
  revenueForecast: /\b(revenue|sales|income)\b.*\b(forecast|project|next month|outlook|expect)\b|\b(forecast|project)\b.*\b(revenue|sales|income)\b/i,
  expenseForecast: /\b(expense|spend|cost)s?\b.*\b(forecast|project|next month|outlook|expect)\b|\b(forecast|project)\b.*\b(expense|spend|cost)/i,
  advice: /\b(advice|advise|recommend(ation)?s?|what should i|how am i doing|improve|do better|suggestions?|help me grow)\b/i,
  performance: /\b(perform(ance|ing)?|overview|summary|health|kpis?|snapshot|profit(able|ability)?|margin|bottom\s*line)\b|\bhow\s+(is|are|'?s|was)\b[^?.!]{0,20}\b(business|company|things|we|it|trading)\b|\bhow\s+(are\s+we|am\s+i|is\s+it)\s+doing\b/i,
  overdue: /\b(overdue|past\s*due|late\s+(invoice|payment)|unpaid|owe(s|d)?\s+me|debtors?|receivables?|chase)\b/i,
  topExpenses: /\b(top|biggest|largest|highest|main)\b.*\b(expense|spend|cost)|(\bexpense|\bspending)\b.*\b(breakdown|categor|where)/i,
  topCustomers: /\b(top|best|biggest|largest)\b.*\b(customer|client)|\bcustomer\b.*\b(revenue|concentration|risk)/i,
  anomalies: /\b(anomal|unusual|suspicious|fraud|duplicate|irregular|strange|outlier)/i,
  error: /\b(error|broken|not working|bug|crash|can'?t|cannot|failed|stuck|blank screen|won'?t load)\b/i,
} as const;

export function rulesProvider(): AIProvider {
  return {
    name: 'ledgr-rules',
    async answer(messages: ChatMessage[], context: DataContext): Promise<AIAnswer> {
      const question = lastUserMessage(messages);
      return {
        content: answerLocally(question, context),
        provider: 'ledgr-rules',
        suggestions: suggestionsFor(question, context),
      };
    },
  };
}

/** Pure, synchronous rules engine — exported for tests and the welcome card. */
export function answerLocally(question: string, context: DataContext): string {
  const q = question.trim();
  const hasData = Boolean(context.data?.kpis);

  // 1. Greeting
  if (INTENT.greeting.test(q) && q.length < 40) {
    return greeting(context);
  }

  // 2. Knowledge base (scored). A KB hit wins whenever it scores at all,
  //    EXCEPT when the question is clearly about the user's own numbers.
  const dataIntent =
    INTENT.forecast.test(q) || INTENT.advice.test(q) || INTENT.performance.test(q)
    || INTENT.overdue.test(q) || INTENT.topExpenses.test(q) || INTENT.topCustomers.test(q)
    || INTENT.anomalies.test(q);

  if (!dataIntent || !hasData) {
    const article = matchArticle(q, context.knowledgeBase ?? []);
    if (article) return `**${article.topic}**\n\n${article.body}`;
  }

  // 3. Data intents (ordered)
  if (INTENT.revenueForecast.test(q)) return renderSeriesForecast(context, 'revenue');
  if (INTENT.expenseForecast.test(q)) return renderSeriesForecast(context, 'expenses');
  if (INTENT.forecast.test(q)) return renderCashForecast(context);
  if (INTENT.advice.test(q)) return renderAdvice(context);
  if (INTENT.performance.test(q)) return renderPerformance(context);
  if (INTENT.overdue.test(q)) return renderOverdue(context);
  if (INTENT.topExpenses.test(q)) return renderTopExpenses(context);
  if (INTENT.topCustomers.test(q)) return renderTopCustomers(context);
  if (INTENT.anomalies.test(q)) return renderAnomalies(context);

  // 4. Troubleshooting
  if (INTENT.error.test(q)) return renderTroubleshooting(context);

  // 5. Fallback
  return renderFallback(context);
}

// ── Knowledge-base matching ─────────────────────────────────────────────────

/** Topic match +5, each keyword match +2. Highest score above 0 wins. */
export function matchArticle(question: string, kb: KnowledgeArticle[]): KnowledgeArticle | null {
  const q = question.toLowerCase();
  if (!q.trim()) return null;

  let best: KnowledgeArticle | null = null;
  let bestScore = 0;

  for (const article of kb) {
    let score = 0;
    if (q.includes(article.topic.toLowerCase())) score += 5;
    for (const word of article.topic.toLowerCase().split(/[^a-z]+/)) {
      if (word.length > 4 && q.includes(word)) score += 1;
    }
    for (const keyword of article.keywords) {
      if (q.includes(keyword.toLowerCase())) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = article;
    }
  }

  return bestScore > 0 ? best : null;
}

// ── Renderers ────────────────────────────────────────────────────────────────

function companyOf(ctx: DataContext): string {
  return ctx.companyName ?? ctx.data?.company?.name ?? 'your business';
}

function greeting(ctx: DataContext): string {
  const company = companyOf(ctx);
  if (!ctx.data?.kpis) {
    return [
      `Hello! I'm the Ledgr assistant for **${company}**.`,
      '',
      'Ask me how to do something in Ledgr — invoicing, expenses, bank reconciliation, payroll, reports, tax or team access — and I will walk you through it step by step.',
    ].join('\n');
  }
  const k = ctx.data.kpis;
  return [
    `Hello! I'm Ledgr AI for **${company}**, working from your live books.`,
    '',
    `Right now: **${mk(k.revenue_mtd)}** revenue month-to-date, **${mk(k.expenses_mtd)}** of costs, **${mk(k.cash_balance)}** in cash and **${mk(k.overdue_total)}** overdue.`,
    '',
    'Ask about performance, overdue invoices, a cash-flow forecast, or what to improve.',
  ].join('\n');
}

function noData(ctx: DataContext, what: string): string {
  return [
    `I could not read ${what} for **${companyOf(ctx)}**.`,
    '',
    'This usually means there is no posted activity yet, or the assistant could not reach the database. Capture some invoices in **/invoices** and expenses in **/expenses**, then ask again.',
  ].join('\n');
}

function renderPerformance(ctx: DataContext): string {
  const k = ctx.data?.kpis;
  if (!k) return noData(ctx, 'your performance figures');

  const a = advise(ctx);
  const ratingIcon = a.rating === 'healthy' ? '🟢' : a.rating === 'watch' ? '🟡' : '🔴';

  const lines = [
    `**${companyOf(ctx)} — month to date (${shortDate(k.period_start)} to today)**`,
    '',
    `- Revenue: **${mk(k.revenue_mtd)}**`,
    `- Expenses: **${mk(k.expenses_mtd)}**`,
    `- Net profit: **${mk(k.net_profit_mtd)}** (margin ${pct(k.profit_margin_pct)})`,
    `- Cash: **${mk(k.cash_balance)}**`,
    `- Receivables: **${mk(k.receivables_total)}**, of which **${mk(k.overdue_total)}** is overdue`,
  ];
  if (k.avg_days_to_pay !== null) {
    lines.push(`- Customers pay in **${k.avg_days_to_pay.toFixed(0)} days** on average`);
  }

  lines.push('', `${ratingIcon} **${a.rating.toUpperCase()}** — ${a.headline}`);

  if (a.actions.length > 0) {
    lines.push('', '**Do next**');
    a.actions.slice(0, 3).forEach((action, i) => lines.push(`${i + 1}. ${action}`));
  }

  return lines.join('\n');
}

function renderOverdue(ctx: DataContext): string {
  const list = ctx.data?.overdueInvoices ?? [];
  const k = ctx.data?.kpis;

  if (!ctx.data) return noData(ctx, 'your invoices');
  if (list.length === 0) {
    return [
      `**No overdue invoices** for ${companyOf(ctx)}. 🎉`,
      '',
      k ? `Open receivables total **${mk(k.receivables_total)}** across ${Math.round(k.open_invoice_count)} invoice(s), all still within terms.` : '',
    ].filter(Boolean).join('\n');
  }

  const total = list.reduce((s, i) => s + i.amount_outstanding, 0);
  const sorted = [...list].sort((a, b) => b.days_overdue - a.days_overdue).slice(0, 8);

  const lines = [
    `**${list.length} overdue invoice${list.length === 1 ? '' : 's'} — ${mk(total)} outstanding**`,
    '',
    '| Customer | Invoice | Amount | Days overdue |',
    '| --- | --- | ---: | ---: |',
    ...sorted.map((i) => `| ${i.customer} | ${i.invoice_number} | ${mk(i.amount_outstanding)} | ${Math.round(i.days_overdue)} |`),
  ];

  if (list.length > sorted.length) lines.push('', `_…and ${list.length - sorted.length} more._`);

  const worst = sorted[0];
  lines.push(
    '',
    `Start with **${worst.customer}** — ${mk(worst.amount_outstanding)} is ${Math.round(worst.days_overdue)} days past its ${shortDate(worst.due_date)} due date. Open it in **/invoices** and send a reminder.`,
  );

  return lines.join('\n');
}

function renderTopExpenses(ctx: DataContext): string {
  const list = ctx.data?.topExpenses ?? [];
  if (!ctx.data) return noData(ctx, 'your expenses');
  if (list.length === 0) {
    return `No expenses have been recorded for **${companyOf(ctx)}** in the last 90 days. Capture them in **/expenses** so cost analysis has something to work with.`;
  }

  const sorted = [...list].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const total = list.reduce((s, e) => s + e.amount, 0);

  const lines = [
    `**Biggest expense categories — last 90 days (${mk(total)} total)**`,
    '',
    '| Category | Amount | Share | Documents |',
    '| --- | ---: | ---: | ---: |',
    ...sorted.map((e) => {
      const share = total > 0 ? (e.amount / total) * 100 : 0;
      return `| ${e.category} | ${mk(e.amount)} | ${share.toFixed(1)}% | ${Math.round(e.document_count)} |`;
    }),
  ];

  const top = sorted[0];
  lines.push(
    '',
    `**${top.category}** is your largest line at ${mk(top.amount)}. A 10% saving there is ${mk(top.amount * 0.1)} back in cash.`,
  );

  return lines.join('\n');
}

function renderTopCustomers(ctx: DataContext): string {
  const list = ctx.data?.topCustomers ?? [];
  if (!ctx.data) return noData(ctx, 'your customers');
  if (list.length === 0) {
    return `No customer revenue recorded for **${companyOf(ctx)}** in the last 12 months. Raise invoices in **/invoices** to build the picture.`;
  }

  const sorted = [...list].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const lines = [
    '**Top customers — rolling 12 months**',
    '',
    '| Customer | Revenue | Share | Outstanding |',
    '| --- | ---: | ---: | ---: |',
    ...sorted.map((c) => `| ${c.customer} | ${mk(c.revenue)} | ${pct(c.share_pct)} | ${mk(c.outstanding)} |`),
  ];

  const conc = ctx.data.concentration;
  if (conc && conc.concentration_pct !== null) {
    lines.push('');
    lines.push(
      conc.concentration_pct > 40
        ? `⚠️ **Concentration risk:** ${conc.top_customer} is ${pct(conc.concentration_pct)} of revenue (${mk(conc.top_customer_revenue)} of ${mk(conc.total_revenue)}). Losing them would take out more than a third of the business — win two mid-sized accounts to spread the risk.`
        : `Concentration is healthy: your largest customer, ${conc.top_customer}, is ${pct(conc.concentration_pct)} of revenue across ${Math.round(conc.customer_count)} customers.`,
    );
  }

  return lines.join('\n');
}

function renderAnomalies(ctx: DataContext): string {
  const list = ctx.data?.anomalies ?? [];
  if (!ctx.data) return noData(ctx, 'your transactions');
  if (list.length === 0) {
    return `**No anomalies detected** for ${companyOf(ctx)} in the last 90 days — no unusually large transactions, duplicates, suspicious round amounts or overdrawn cash accounts. ✅`;
  }

  const bySeverity = (sev: AiAnomaly['severity']) => list.filter((a) => a.severity === sev);
  const lines = [`**${list.length} anomal${list.length === 1 ? 'y' : 'ies'} in the last 90 days**`];

  for (const [sev, icon, label] of [
    ['high', '🔴', 'High'],
    ['medium', '🟡', 'Medium'],
    ['low', '⚪', 'Low'],
  ] as const) {
    const group = bySeverity(sev);
    if (group.length === 0) continue;
    lines.push('', `${icon} **${label} severity (${group.length})**`);
    group.slice(0, 5).forEach((a) => lines.push(`- ${a.description}`));
    if (group.length > 5) lines.push(`- _…and ${group.length - 5} more._`);
  }

  lines.push('', 'Each item links to a real posting — check them in **/journals**, **/expenses** or **/invoices** and void or correct anything wrong.');
  return lines.join('\n');
}

function renderCashForecast(ctx: DataContext): string {
  const f: Forecast | undefined = ctx.forecast;
  if (!f || f.cashFlow.length === 0) return noData(ctx, 'enough history to project cash');

  const opening = ctx.data?.kpis?.cash_balance ?? 0;
  const lines = [
    `**Cash-flow forecast — next ${f.cashFlow.length} months for ${companyOf(ctx)}**`,
    '',
    `Opening cash: **${mk(opening)}**`,
    '',
    '| Month | Money in | Money out | Closing balance |',
    '| --- | ---: | ---: | ---: |',
    ...f.cashFlow.map((m) => {
      const flag = m.projected_balance < 0 ? ' ⚠️' : '';
      return `| ${monthName(m.month)} | ${mk(m.projected_in)} | ${mk(m.projected_out)} | **${mk(m.projected_balance)}**${flag} |`;
    }),
  ];

  const negatives = negativeMonths(f);
  if (negatives.length > 0) {
    const first = negatives[0];
    lines.push(
      '',
      `⚠️ **Cash goes negative in ${monthName(first.month)}** at ${mk(first.projected_balance)}. You need roughly ${mk(Math.abs(first.projected_balance))} more in that month — pull collections forward, delay non-committed spend, or arrange an overdraft now.`,
    );
  } else {
    const last = f.cashFlow[f.cashFlow.length - 1];
    lines.push('', `✅ Cash stays positive throughout, ending at **${mk(last.projected_balance)}** in ${monthName(last.month)}.`);
  }

  lines.push('', `**Confidence: ${f.confidence}**`, '', '**Key assumptions**');
  f.assumptions.slice(0, 5).forEach((a) => lines.push(`- ${a}`));
  if (f.assumptions.length > 5) {
    lines.push(`- _…plus ${f.assumptions.length - 5} more (ask "show all forecast assumptions")._`);
  }

  return lines.join('\n');
}

function renderSeriesForecast(ctx: DataContext, kind: 'revenue' | 'expenses'): string {
  const f = ctx.forecast;
  if (!f) return noData(ctx, `enough history to project ${kind}`);

  const points = kind === 'revenue' ? f.revenue : f.expenses;
  if (points.length === 0) return noData(ctx, `enough history to project ${kind}`);

  const history = (ctx.data?.monthlyTrend ?? []).slice(-3);
  const label = kind === 'revenue' ? 'Revenue' : 'Expenses';

  const lines = [`**${label} forecast — next ${points.length} months for ${companyOf(ctx)}**`, ''];

  if (history.length > 0) {
    lines.push('Recent actuals:');
    history.forEach((m) => {
      lines.push(`- ${monthName(m.month)}: ${mk(kind === 'revenue' ? m.revenue : m.expenses)}`);
    });
    lines.push('');
  }

  lines.push('Projected:');
  points.forEach((p) => lines.push(`- **${monthName(p.month)}: ${mk(p.projected)}**`));

  const relevant = f.assumptions.filter((a) =>
    a.toLowerCase().includes(kind) || a.toLowerCase().includes('limited history'),
  );
  lines.push('', `**Confidence: ${f.confidence}**`, '', '**Assumptions**');
  (relevant.length > 0 ? relevant : f.assumptions.slice(0, 3)).forEach((a) => lines.push(`- ${a}`));

  return lines.join('\n');
}

function renderAdvice(ctx: DataContext): string {
  if (!ctx.data?.kpis) return noData(ctx, 'your figures');

  const a = advise(ctx);
  const icon = a.rating === 'healthy' ? '🟢' : a.rating === 'watch' ? '🟡' : '🔴';

  const lines = [`${icon} **${a.rating.toUpperCase()} — ${a.headline}**`];

  if (a.insights.length > 0) {
    lines.push('', '**What the numbers say**');
    a.insights.forEach((i) => lines.push(`- ${i}`));
  }

  if (a.actions.length > 0) {
    lines.push('', '**What to do**');
    a.actions.forEach((action, i) => lines.push(`${i + 1}. ${action}`));
  }

  return lines.join('\n');
}

function renderTroubleshooting(ctx: DataContext): string {
  const article = (ctx.knowledgeBase ?? []).find((a) => a.id === 'kb-troubleshooting');
  const body = article ? article.body : 'Try reloading the page, then check the offline banner for queued work.';
  return [
    '**Let\'s get that unstuck**',
    '',
    body,
    '',
    'If none of that helps, use **Settings → Report a problem** — recent browser errors are attached automatically so we can see exactly what failed.',
  ].join('\n');
}

function renderFallback(ctx: DataContext): string {
  if (ctx.data?.kpis) {
    return [
      `I can work through **${companyOf(ctx)}**'s live books, but I did not recognise that question.`,
      '',
      'Try one of these:',
      '- "How is my business performing?"',
      '- "Which invoices are overdue?"',
      '- "Forecast my cash flow for 3 months"',
      '- "What are my biggest expenses?"',
      '- "What should I improve?"',
    ].join('\n');
  }

  return [
    'I did not quite catch that. I can help with:',
    '',
    '- Creating and sending invoices',
    '- Recording expenses and supplier bills',
    '- Bank and mobile money reconciliation',
    '- Reports (P&L, balance sheet, cash flow)',
    '- Payroll, tax and MRA deadlines',
    '- Team roles, data export and privacy',
    '',
    'Ask in your own words — e.g. "how do I reconcile Airtel Money?"',
  ].join('\n');
}

// ── Suggestion chips ─────────────────────────────────────────────────────────

export const AI_SUGGESTIONS: string[] = [
  'How is my business performing?',
  'Which invoices are overdue?',
  'Forecast my cash flow for 3 months',
  'What should I improve?',
];

export function suggestionsFor(question: string, ctx: DataContext): string[] {
  const hasData = Boolean(ctx.data?.kpis);
  if (!hasData) return SUPPORT_SUGGESTIONS;

  const q = question ?? '';

  if (INTENT.forecast.test(q)) {
    return ['What should I improve?', 'Which invoices are overdue?', 'Forecast my revenue', 'How is my business performing?'];
  }
  if (INTENT.overdue.test(q)) {
    return ['Forecast my cash flow for 3 months', 'Who are my top customers?', 'What should I improve?', 'How is my business performing?'];
  }
  if (INTENT.topExpenses.test(q)) {
    return ['Forecast my expenses', 'How is my business performing?', 'Any unusual transactions?', 'What should I improve?'];
  }
  if (INTENT.topCustomers.test(q)) {
    return ['Which invoices are overdue?', 'How is my business performing?', 'What should I improve?', 'Forecast my cash flow for 3 months'];
  }
  if (INTENT.anomalies.test(q)) {
    return ['What are my biggest expenses?', 'How is my business performing?', 'Which invoices are overdue?', 'What should I improve?'];
  }
  if (INTENT.advice.test(q) || INTENT.performance.test(q)) {
    return ['Forecast my cash flow for 3 months', 'Which invoices are overdue?', 'What are my biggest expenses?', 'Any unusual transactions?'];
  }

  return AI_SUGGESTIONS;
}

// ── System prompt (used by the Edge Function; exported for parity/tests) ─────

const MAX_DATA_CHARS = 16_000;
const MAX_KB_CHARS = 20_000;

/**
 * The grounding contract for any LLM: it may only restate numbers that appear
 * in the JSON below. Everything the deterministic engine can compute is
 * pre-computed (forecast, advice) so the model never has to do arithmetic.
 */
export function buildSystemPrompt(ctx: DataContext): string {
  const company = companyOf(ctx);

  const dataJson = ctx.data
    ? truncateJson({ data: ctx.data, forecast: ctx.forecast, advice: advise(ctx) }, MAX_DATA_CHARS)
    : '';

  const kb = (ctx.knowledgeBase ?? [])
    .map((a) => `### ${a.topic}\n${a.body}`)
    .join('\n\n')
    .slice(0, MAX_KB_CHARS);

  return [
    `You are Ledgr AI, the financial assistant built into Ledgr, an accounting platform for small and medium businesses in Malawi. You are answering for the business "${company}".`,
    '',
    'RULES — these are absolute:',
    '1. Use ONLY the numbers in the JSON below. Never invent, estimate or extrapolate a figure that is not there. If the answer is not in the data, say so plainly.',
    '2. Format every amount as MK 1,234,567 — Malawi Kwacha, thousands separators, no decimals.',
    '3. When you discuss a forecast, state its confidence and the assumptions behind it (they are in the JSON).',
    '4. Give specific advice tied to a real figure and a named entity — "chase Blantyre Traders Ltd for MK 4,250,000, 43 days overdue", never "improve collections".',
    '5. Flag anomalies and compliance risks (MRA VAT by the 25th, PAYE and withholding tax by the 14th) when the data shows them.',
    '6. Answer in markdown. Be concise: under 200 words unless the user asks you to expand. Small tables are fine for forecasts.',
    '7. You advise, you do not act. Point at the relevant screen: /invoices, /expenses, /reports, /payroll, /tax, /bank-reconcile, /contacts.',
    '8. Never ask for or repeat passwords, API keys, card numbers or other secrets.',
    '',
    dataJson ? `LIVE BUSINESS DATA (JSON):\n${dataJson}` : 'No live business data is available for this conversation.',
    '',
    kb ? `PRODUCT KNOWLEDGE BASE:\n${kb}` : '',
  ].filter(Boolean).join('\n');
}

/** JSON.stringify with a hard character budget (drops the longest arrays first). */
function truncateJson(value: unknown, limit: number): string {
  let json = safeStringify(value);
  if (json.length <= limit) return json;

  const root = value as { data?: Record<string, unknown> } | null;
  const data = root?.data;
  if (data && typeof data === 'object') {
    const trimmable = ['upcomingReceivables', 'upcomingPayables', 'anomalies', 'overdueInvoices', 'topCustomers', 'topExpenses', 'monthlyTrend'];
    const clone: Record<string, unknown> = { ...data };
    for (const key of trimmable) {
      const arr = clone[key];
      if (Array.isArray(arr) && arr.length > 5) clone[key] = arr.slice(0, 5);
      json = safeStringify({ ...(root as object), data: clone });
      if (json.length <= limit) return json;
    }
  }

  return json.slice(0, limit);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

// ── Reference LLM adapters ───────────────────────────────────────────────────
//
// The production path is the `ai-chat` Edge Function (remoteProvider), which
// holds the API key server-side. These adapters exist so the same request
// shapes are documented in one place and can be unit-tested; they are NOT
// wired into the browser and must never be called with a real key from client
// code.

export interface LlmAdapter {
  provider: 'gemini' | 'groq' | 'openrouter' | 'anthropic';
  defaultModel: string;
  buildRequest(apiKey: string, model: string, system: string, messages: ChatMessage[]): {
    url: string;
    init: RequestInit;
  };
  parseResponse(body: unknown): string;
}

const chat = (messages: ChatMessage[]) =>
  messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

export const LLM_ADAPTERS: Record<LlmAdapter['provider'], LlmAdapter> = {
  groq: {
    provider: 'groq',
    defaultModel: 'llama-3.1-8b-instant',
    buildRequest(apiKey, model, system, messages) {
      return {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 900,
            messages: [{ role: 'system', content: system }, ...chat(messages)],
          }),
        },
      };
    },
    parseResponse(body) {
      const b = body as { choices?: Array<{ message?: { content?: string } }> };
      return b.choices?.[0]?.message?.content ?? '';
    },
  },

  openrouter: {
    provider: 'openrouter',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    buildRequest(apiKey, model, system, messages) {
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 900,
            messages: [{ role: 'system', content: system }, ...chat(messages)],
          }),
        },
      };
    },
    parseResponse(body) {
      const b = body as { choices?: Array<{ message?: { content?: string } }> };
      return b.choices?.[0]?.message?.content ?? '';
    },
  },

  gemini: {
    provider: 'gemini',
    defaultModel: 'gemini-1.5-flash',
    buildRequest(apiKey, model, system, messages) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
            contents: chat(messages).map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        },
      };
    },
    parseResponse(body) {
      const b = body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    },
  },

  anthropic: {
    provider: 'anthropic',
    defaultModel: 'claude-3-5-haiku-latest',
    buildRequest(apiKey, model, system, messages) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            system,
            temperature: 0.2,
            max_tokens: 900,
            messages: chat(messages),
          }),
        },
      };
    },
    parseResponse(body) {
      const b = body as { content?: Array<{ type?: string; text?: string }> };
      return (b.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    },
  },
};

// ── Utilities ────────────────────────────────────────────────────────────────

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}
