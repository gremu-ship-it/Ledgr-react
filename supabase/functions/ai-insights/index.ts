// Ledgr AI Insights — Supabase Edge Function
// ---------------------------------------------------------------------------
// Powers the AiInsightsPage chat ("Ledgr AI"): a financial assistant that
// answers questions against a business-context summary the client builds from
// live app data (P&L, cash position, overdue invoices, tax deadlines,
// anomalies).
//
// Auth-gated: only a signed-in Ledgr user (JWT) may invoke it, and calls are
// rate-limited per user per minute (public.ai_insights_usage). The provider is
// Anthropic Claude (ANTHROPIC_API_KEY secret) — the key is never exposed to
// the browser.
//
// HISTORY: this replaced a browser-direct call to a speculative "Arena agents"
// endpoint (api.arena.ai/v1/agents/ledgr-financial-advisor/invoke) that does
// not exist publicly and would have shipped an API key in the client bundle.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';

// ── Environment ─────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_MODEL = Deno.env.get('AI_INSIGHTS_MODEL') || 'claude-sonnet-4-20250514';
// Requests per user per rolling minute.
const RATE_LIMIT = 40;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get('SB_ENV') || 'edge',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

// ── HTTP helpers (mirrors supabase/functions/support-agent) ─────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

function preflight() {
  return new Response('ok', { headers: { ...CORS_HEADERS, ...SECURITY_HEADERS } });
}

// ── Types ───────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface InsightsResult {
  content: string;
}

// ── Rate limiting (per user, per minute) ────────────────────────────────────
// Uses the public.ai_insights_usage table. Failures are tolerated so a
// missing/locked table never blocks the assistant.
async function checkRateLimit(userId: string): Promise<Response | null> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  try {
    const { data } = await supabase
      .from('ai_insights_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('window_start', windowStart)
      .maybeSingle();

    if ((data?.count ?? 0) >= RATE_LIMIT) {
      return json(
        { error: 'Rate limit exceeded. Please wait a minute and try again.' },
        429,
        { 'Retry-After': '60' },
      );
    }

    if (data) {
      await supabase
        .from('ai_insights_usage')
        .update({ count: data.count + 1 })
        .eq('user_id', userId)
        .eq('window_start', windowStart);
    } else {
      await supabase
        .from('ai_insights_usage')
        .insert({ user_id: userId, window_start: windowStart, count: 1 });
    }
  } catch {
    // Table not provisioned yet — allow through rather than breaking insights.
  }
  return null;
}

// ── Prompt construction ─────────────────────────────────────────────────────
function buildSystemPrompt(businessContext: string): string {
  return `You are Ledgr AI, a financial assistant for small and medium businesses in Malawi, built into the Ledgr accounting platform. You have access to live business data shown below.

Ground rules:
- Be concise, friendly, and specific — always reference actual numbers from the data.
- When you identify issues (overdue invoices, high expenses, etc.), suggest concrete actions.
- Use MWK currency when discussing money.
- NEVER make up data that is not in the business context below. If the context doesn't answer the question, say so plainly.
- NEVER ask for or repeat secrets, passwords, full card numbers, or other credentials.
- You advise; you cannot execute actions in the app. Point the user at the relevant screen (invoices, expenses, payroll, contacts, reports) instead.

${businessContext || 'No business data was provided for this conversation.'}`;
}

// ── Provider: Anthropic Claude ──────────────────────────────────────────────
async function callAnthropic(
  messages: ChatMessage[],
  systemPrompt: string,
): Promise<InsightsResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1200,
      system: systemPrompt,
      temperature: 0.3,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const blocks: Array<{ type: string; text?: string }> =
    Array.isArray(data.content) ? data.content : [];

  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');

  return { content: text || 'Sorry, I could not generate a response.' };
}

// ── Request handling ────────────────────────────────────────────────────────
serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return preflight();
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // Auth: the browser attaches the user's JWT via supabase.functions.invoke.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const userId = authData.user.id;
    if (SENTRY_DSN) Sentry.setUser({ id: userId });

    const limited = await checkRateLimit(userId);
    if (limited) return limited;

    // Parse & validate body.
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') {
      return json({ error: 'Invalid request body' }, 400);
    }

    const incoming: unknown[] = Array.isArray(raw.messages) ? raw.messages : [];
    const messages: ChatMessage[] = incoming
      .map((m) => {
        if (!m || typeof m !== 'object') return null;
        const msg = m as { role?: string; content?: unknown };
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        const content = typeof msg.content === 'string' ? msg.content.slice(0, 4000).trim() : '';
        return content ? { role, content } : null;
      })
      .filter((m): m is ChatMessage => m !== null)
      .slice(-30);

    if (messages.length === 0) {
      return json({ error: 'No message provided' }, 400);
    }

    const businessContext =
      typeof raw.businessContext === 'string' ? raw.businessContext.slice(0, 8000) : '';

    if (!ANTHROPIC_API_KEY) {
      return json(
        { error: 'AI Insights is not configured (ANTHROPIC_API_KEY secret not set).' },
        503,
      );
    }

    const result = await callAnthropic(messages, buildSystemPrompt(businessContext));
    return json(result);
  } catch (err) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
