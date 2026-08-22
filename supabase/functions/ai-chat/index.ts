// Ledgr AI Chat — Supabase Edge Function
// ---------------------------------------------------------------------------
// Optional LLM backend for the in-app assistants (src/lib/ai/*). The browser
// only reaches it when VITE_AI_CHAT_URL is set; with no configuration at all
// the client's deterministic rules engine answers everything offline.
//
// SECURITY MODEL
//   • The caller's JWT is verified with auth.getUser(). No JWT, no answer.
//   • The company is derived SERVER-SIDE from public.business_users. The
//     `context` the client posts is used for conversation framing only —
//     never as a data source and never as a tenant selector.
//   • The DataContext is rebuilt here from public.ai_context(business_id),
//     the same function src/lib/ai/context.ts calls, so the model always sees
//     fresh, authorised numbers.
//   • The AI provider key lives in Supabase secrets and never reaches the
//     browser.
//
// SECRETS
//   AI_PROVIDER   groq (default) | gemini | openrouter | anthropic
//   AI_API_KEY    provider key (falls back to ANTHROPIC_API_KEY when
//                 AI_PROVIDER=anthropic, which Ledgr already sets)
//   AI_MODEL      optional model override
//
// Returns { content, provider }.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

// ── Environment ─────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AI_PROVIDER = (Deno.env.get('AI_PROVIDER') || 'groq').toLowerCase();
const AI_API_KEY = Deno.env.get('AI_API_KEY')
  || (AI_PROVIDER === 'anthropic' ? Deno.env.get('ANTHROPIC_API_KEY') : undefined);
const AI_MODEL = Deno.env.get('AI_MODEL');

/** Requests per user per rolling minute (mirrors ai-insights). */
const RATE_LIMIT = 40;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

// ── Types ───────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type Json = Record<string, unknown>;

// ── HTTP helpers ────────────────────────────────────────────────────────────
function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
      ...extra,
    },
  });
}

// ── Rate limiting (reuses public.ai_insights_usage) ─────────────────────────
async function checkRateLimit(req: Request, userId: string): Promise<Response | null> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  try {
    const { data } = await admin
      .from('ai_insights_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('window_start', windowStart)
      .maybeSingle();

    const used = (data?.count as number | undefined) ?? 0;
    if (used >= RATE_LIMIT) {
      return json(req, { error: 'Rate limit exceeded. Please wait a minute and try again.' }, 429, {
        'Retry-After': '60',
      });
    }

    if (data) {
      await admin
        .from('ai_insights_usage')
        .update({ count: used + 1 })
        .eq('user_id', userId)
        .eq('window_start', windowStart);
    } else {
      await admin
        .from('ai_insights_usage')
        .insert({ user_id: userId, window_start: windowStart, count: 1 });
    }
  } catch {
    // Table not provisioned — never block the assistant on telemetry.
  }
  return null;
}

// ── Tenant derivation (server-side, never from the client) ──────────────────
/**
 * Resolves the business this user may be answered about. If the client asked
 * for a specific business, it is honoured ONLY when the user is an active
 * member of it; otherwise we fall back to their (single) active membership.
 */
async function resolveBusiness(
  userId: string,
  requestedId: string | null,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await admin
    .from('business_users')
    .select('business_id, businesses:business_id (id, name, deleted_at)')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error || !data || data.length === 0) return null;

  type Membership = {
    business_id: string;
    businesses: { id: string; name: string; deleted_at: string | null } | null;
  };

  const memberships = (data as unknown as Membership[]).filter(
    (m) => m.businesses && !m.businesses.deleted_at,
  );
  if (memberships.length === 0) return null;

  const chosen = requestedId
    ? memberships.find((m) => m.business_id === requestedId)
    : memberships[0];

  if (!chosen || !chosen.businesses) return null;
  return { id: chosen.businesses.id, name: chosen.businesses.name };
}

// ── Data context (same source as src/lib/ai/context.ts) ─────────────────────
async function buildDataContext(businessId: string): Promise<Json | null> {
  const { data, error } = await admin.rpc('ai_context', { p_business_id: businessId });
  if (error) {
    console.error('[ai-chat] ai_context failed:', error.message);
    return null;
  }
  return (data ?? null) as Json | null;
}

// ── Deterministic pre-computation ───────────────────────────────────────────
// The model is never asked to do arithmetic: cash-flow projections and the
// headline advice are computed here (mirroring src/lib/ai/forecast.ts and
// advisor.ts) and handed to it as facts.

function n(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mk(value: number): string {
  const rounded = Math.round(n(value));
  const abs = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `-MK ${abs}` : `MK ${abs}`;
}

const RUN_RATE_WEIGHTS = [0.5, 0.3, 0.2];

function weightedAverage(series: number[]): number {
  if (series.length === 0) return 0;
  const recent = series.slice(-RUN_RATE_WEIGHTS.length).reverse();
  let total = 0;
  let weight = 0;
  recent.forEach((value, i) => {
    total += value * RUN_RATE_WEIGHTS[i];
    weight += RUN_RATE_WEIGHTS[i];
  });
  return weight > 0 ? total / weight : 0;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(key: string, offset: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + offset, 1));
}

interface ForecastMonth {
  month: string;
  projected_in: number;
  projected_out: number;
  projected_balance: number;
}

interface ServerForecast {
  cashFlow: ForecastMonth[];
  assumptions: string[];
  confidence: 'high' | 'medium' | 'low';
}

function buildForecast(data: Json, monthsAhead = 3): ServerForecast {
  const trend = (Array.isArray(data.monthlyTrend) ? data.monthlyTrend : []) as Json[];
  const kpis = (data.kpis ?? {}) as Json;
  const overdue = (Array.isArray(data.overdueInvoices) ? data.overdueInvoices : []) as Json[];
  const upcomingIn = (Array.isArray(data.upcomingReceivables) ? data.upcomingReceivables : []) as Json[];
  const upcomingOut = (Array.isArray(data.upcomingPayables) ? data.upcomingPayables : []) as Json[];

  const now = new Date();
  const current = monthKey(now);
  const sorted = [...trend].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const complete = sorted.filter((m) => String(m.month) < current);
  const basis = complete.length > 0 ? complete : sorted;

  const active = sorted.filter(
    (m) => n(m.revenue) !== 0 || n(m.expenses) !== 0 || n(m.cash_in) !== 0 || n(m.cash_out) !== 0,
  ).length;
  const confidence: ServerForecast['confidence'] = active >= 9 ? 'high' : active >= 4 ? 'medium' : 'low';

  const baseIn = Math.max(0, weightedAverage(basis.map((m) => n(m.cash_in))));
  const baseOut = Math.max(0, weightedAverage(basis.map((m) => n(m.cash_out))));

  const collections = new Array(monthsAhead).fill(0);
  const overdueTotal = overdue.reduce((s, i) => s + n(i.amount_outstanding), 0);
  if (monthsAhead >= 1) collections[0] += overdueTotal * 0.6;
  if (monthsAhead >= 2) collections[1] += overdueTotal * 0.3;

  let due0to30 = 0;
  let due30to60 = 0;
  for (const r of upcomingIn) {
    const days = n(r.days_until_due);
    if (days <= 30) due0to30 += n(r.amount_outstanding);
    else if (days <= 60) due30to60 += n(r.amount_outstanding);
  }
  if (monthsAhead >= 1) collections[0] += due0to30 * 0.85;
  if (monthsAhead >= 2) collections[1] += due30to60 * 0.5;

  const committed = new Array(monthsAhead).fill(0);
  let committedTotal = 0;
  for (const p of upcomingOut) {
    const amount = n(p.amount);
    if (amount <= 0) continue;
    const due = new Date(`${String(p.due_date)}T00:00:00`);
    const offset = Number.isNaN(due.getTime())
      ? 0
      : (due.getFullYear() - now.getFullYear()) * 12 + (due.getMonth() - now.getMonth());
    committed[Math.max(0, Math.min(monthsAhead - 1, offset))] += amount;
    committedTotal += amount;
  }

  let balance = n(kpis.cash_balance);
  const cashFlow: ForecastMonth[] = [];
  for (let i = 0; i < monthsAhead; i += 1) {
    const projectedIn = Math.max(0, baseIn + collections[i]);
    const projectedOut = Math.max(0, baseOut + committed[i]);
    balance += projectedIn - projectedOut;
    cashFlow.push({
      month: addMonths(current, i + 1),
      projected_in: Math.round(projectedIn),
      projected_out: Math.round(projectedOut),
      projected_balance: Math.round(balance),
    });
  }

  const assumptions = [
    `Ongoing trade projected at the weighted 3-month cash run rate (50/30/20, most recent first): ${mk(baseIn)} in and ${mk(baseOut)} out per month.`,
    `Overdue invoices (${mk(overdueTotal)}) collected 60% within 30 days and 30% within 60 days.`,
    `Invoices due within 30 days collected at 85% (${mk(due0to30)}); due in 30-60 days at 50% (${mk(due30to60)}).`,
    `Committed outflows — unpaid bills, approved payroll and unpaid MRA returns totalling ${mk(committedTotal)} — paid in full when due.`,
    `Opening cash is the current balance of ${mk(n(kpis.cash_balance))}.`,
    'No new borrowing, capital injection or one-off item is assumed; prices and salaries held flat.',
  ];
  if (confidence === 'low') {
    assumptions.unshift(
      `Limited history — only ${active} month(s) of activity, so this projection is indicative only.`,
    );
  }

  return { cashFlow, assumptions, confidence };
}

function buildAdvice(data: Json, f: ServerForecast): Json {
  const kpis = (data.kpis ?? {}) as Json;
  const trend = (Array.isArray(data.monthlyTrend) ? data.monthlyTrend : []) as Json[];

  const revenue = n(kpis.revenue_mtd);
  const cash = n(kpis.cash_balance);
  const receivables = n(kpis.receivables_total);
  const overdue = n(kpis.overdue_total);
  const margin = kpis.profit_margin_pct === null ? null : n(kpis.profit_margin_pct);

  const outs = trend.map((m) => n(m.cash_out)).filter((v) => v > 0);
  const avgOut = outs.length > 0 ? outs.reduce((s, v) => s + v, 0) / outs.length : 0;
  const runway = avgOut > 0 ? cash / avgOut : null;
  const overdueRatio = receivables > 0 ? (overdue / receivables) * 100 : 0;
  const negative = f.cashFlow.find((m) => m.projected_balance < 0);

  let rating: 'healthy' | 'watch' | 'danger' = 'healthy';
  const flags: string[] = [];

  if (revenue > 0 && margin !== null) {
    if (margin < 5) { rating = 'danger'; flags.push(`net margin ${margin.toFixed(1)}% (danger below 5%)`); }
    else if (margin < 20 && rating !== 'danger') { rating = 'watch'; flags.push(`net margin ${margin.toFixed(1)}% (watch below 20%)`); }
  }
  if (runway !== null) {
    if (runway < 1) { rating = 'danger'; flags.push(`cash runway ${runway.toFixed(1)} months`); }
    else if (runway < 3 && rating !== 'danger') { rating = 'watch'; flags.push(`cash runway ${runway.toFixed(1)} months`); }
  }
  if (overdueRatio > 30) { rating = 'danger'; flags.push(`${overdueRatio.toFixed(1)}% of receivables overdue`); }
  else if (overdueRatio > 15 && rating !== 'danger') { rating = 'watch'; flags.push(`${overdueRatio.toFixed(1)}% of receivables overdue`); }
  if (negative) { rating = 'danger'; flags.push(`projected cash of ${mk(negative.projected_balance)} in ${negative.month}`); }

  const concentration = (data.concentration ?? null) as Json | null;
  if (concentration && n(concentration.concentration_pct) > 40) {
    rating = 'danger';
    flags.push(`${String(concentration.top_customer)} is ${n(concentration.concentration_pct).toFixed(1)}% of revenue`);
  }

  return {
    rating,
    signals: flags,
    cash_runway_months: runway === null ? null : Number(runway.toFixed(1)),
    overdue_ratio_pct: Number(overdueRatio.toFixed(1)),
  };
}

// ── Prompt ──────────────────────────────────────────────────────────────────
const MAX_DATA_CHARS = 16_000;
const MAX_KB_CHARS = 20_000;

function buildSystemPrompt(companyName: string, payload: Json, knowledgeBase: string): string {
  let dataJson = JSON.stringify(payload);
  if (dataJson.length > MAX_DATA_CHARS) {
    const data = (payload.data ?? {}) as Json;
    const trimmed: Json = { ...data };
    for (const key of ['upcomingReceivables', 'upcomingPayables', 'anomalies', 'overdueInvoices', 'topCustomers', 'topExpenses', 'monthlyTrend']) {
      const value = trimmed[key];
      if (Array.isArray(value) && value.length > 5) trimmed[key] = value.slice(0, 5);
      dataJson = JSON.stringify({ ...payload, data: trimmed });
      if (dataJson.length <= MAX_DATA_CHARS) break;
    }
    dataJson = dataJson.slice(0, MAX_DATA_CHARS);
  }

  return [
    `You are Ledgr AI, the financial assistant built into Ledgr, an accounting platform for small and medium businesses in Malawi. You are answering for the business "${companyName}".`,
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
    `LIVE BUSINESS DATA (JSON):\n${dataJson}`,
    knowledgeBase ? `\nPRODUCT KNOWLEDGE BASE:\n${knowledgeBase.slice(0, MAX_KB_CHARS)}` : '',
  ].filter(Boolean).join('\n');
}

// ── Providers ───────────────────────────────────────────────────────────────
function chatOnly(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

async function callProvider(system: string, messages: ChatMessage[]): Promise<string> {
  const model = AI_MODEL;

  if (AI_PROVIDER === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${encodeURIComponent(AI_API_KEY!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return (body.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('');
  }

  if (AI_PROVIDER === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': AI_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-haiku-latest',
        system,
        temperature: 0.2,
        max_tokens: 900,
        messages: chatOnly(messages),
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return (body.content ?? [])
      .filter((c: { type?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text ?? '')
      .join('\n');
  }

  // groq (default) and openrouter share the OpenAI chat-completions shape.
  const isOpenRouter = AI_PROVIDER === 'openrouter';
  const url = isOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const defaultModel = isOpenRouter ? 'meta-llama/llama-3.1-8b-instruct:free' : 'llama-3.1-8b-instant';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${AI_API_KEY!}` },
    body: JSON.stringify({
      model: model || defaultModel,
      temperature: 0.2,
      max_tokens: 900,
      messages: [{ role: 'system', content: system }, ...chatOnly(messages)],
    }),
  });
  if (!res.ok) throw new Error(`${AI_PROVIDER} ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? '';
}

// ── Request handling ────────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method === 'OPTIONS') return preflightResponse(req);
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

    // 1. Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'Unauthorized' }, 401);

    const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return json(req, { error: 'Unauthorized' }, 401);
    const userId = authData.user.id;

    // 2. Rate limit
    const limited = await checkRateLimit(req, userId);
    if (limited) return limited;

    // 3. Body
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return json(req, { error: 'Invalid request body' }, 400);

    const body = raw as { messages?: unknown; context?: unknown };
    const messages: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
      .map((m): ChatMessage | null => {
        if (!m || typeof m !== 'object') return null;
        const msg = m as { role?: unknown; content?: unknown };
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        const content = typeof msg.content === 'string' ? msg.content.slice(0, 4000).trim() : '';
        return content ? { role, content } : null;
      })
      .filter((m): m is ChatMessage => m !== null)
      .slice(-20);

    if (messages.length === 0) return json(req, { error: 'No message provided' }, 400);

    if (!AI_API_KEY) {
      return json(
        req,
        { error: 'The AI chat function is not configured (set AI_API_KEY). The in-app assistant still works offline.' },
        503,
      );
    }

    // 4. Tenant — derived server-side. A business id in the client context is
    //    only ever a HINT; it is validated against the user's memberships.
    const clientContext = (body.context ?? {}) as Json;
    const hintedId =
      typeof (clientContext.companyId as string | undefined) === 'string'
        ? (clientContext.companyId as string)
        : typeof ((clientContext.data as Json | undefined)?.company as Json | undefined)?.id === 'string'
          ? String(((clientContext.data as Json).company as Json).id)
          : null;

    const business = await resolveBusiness(userId, hintedId);
    if (!business) return json(req, { error: 'No active business found for this user.' }, 403);

    // 5. Rebuild the data context from the database — never from the client.
    const data = await buildDataContext(business.id);
    if (!data) {
      return json(req, { error: 'Could not load business data for this conversation.' }, 502);
    }

    const serverForecast = buildForecast(data, 3);
    const advice = buildAdvice(data, serverForecast);

    // The knowledge base is product documentation, not tenant data, so taking
    // it from the client is safe (it is bounded and only used as reference).
    const kbTopics = Array.isArray(clientContext.knowledgeBaseTopics)
      ? (clientContext.knowledgeBaseTopics as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    const knowledgeBase = kbTopics.length > 0
      ? `Ledgr covers these help topics; point the user at the matching screen: ${kbTopics.join('; ')}.`
      : '';

    const system = buildSystemPrompt(
      business.name,
      { data, forecast: serverForecast, advice },
      knowledgeBase,
    );

    const content = (await callProvider(system, messages)).trim();
    if (!content) {
      return json(req, { error: 'The AI provider returned an empty answer.' }, 502);
    }

    return json(req, { content, provider: AI_PROVIDER });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[ai-chat]', message);
    return json(req, { error: message }, 500);
  }
});
