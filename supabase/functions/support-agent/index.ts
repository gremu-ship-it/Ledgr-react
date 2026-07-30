// Ledgr Support Agent — Supabase Edge Function
// ---------------------------------------------------------------------------
// An in-app assistant that helps users with three things:
//   1. Customer / product questions (how features & tasks work).
//   2. App-error triage (uses auto-captured client errors from context).
//   3. Compliance (data export, account deletion, audit log, MRA tax, RBAC).
//
// It is auth-gated: only a signed-in Ledgr user (JWT) may invoke it. The AI
// provider is Anthropic Claude (ANTHROPIC_API_KEY secret), which is already
// configured for other edge functions in this project. The key is never
// exposed to the browser.
//
// Responses are returned as structured JSON so the UI can render in-app
// navigation shortcuts ("actions") and decide when to escalate to a human.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';

// ── Environment ─────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') || 'support@ledgr.app';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_MODEL = Deno.env.get('SUPPORT_AGENT_MODEL') || 'claude-sonnet-4-20250514';
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

// ── HTTP helpers (mirrors supabase/functions/api for consistency) ────────────
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
type Category = 'query' | 'error' | 'compliance';

interface CapturedError {
  message: string;
  stack?: string;
  url?: string;
  ts: string;
  kind?: string;
}

interface SupportContext {
  errors?: CapturedError[];
  appVersion?: string;
  platform?: string;
  path?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface SupportAction {
  label: string;
  path: string;
  variant: 'primary' | 'secondary';
}

interface SupportResult {
  content: string;
  actions: SupportAction[];
  escalate: boolean;
  category: Category;
  supportEmail?: string;
}

const VALID_CATEGORIES: Category[] = ['query', 'error', 'compliance'];
const VALID_PATHS = [
  '/dashboard', '/income', '/expenses', '/invoices', '/payroll', '/contacts',
  '/products', '/inventory', '/warehouse', '/transfers', '/accounts', '/assets',
  '/capital', '/tax', '/bank-reconcile', '/reports', '/journals', '/periods',
  '/audit', '/settings', '/api-docs', '/api-keys', '/support', '/terms-and-conditions',
];

// ── Rate limiting (per user, per minute) ────────────────────────────────────
// Uses the public.support_agent_usage table. Failures are tolerated so a
// missing/locked table never blocks the assistant.
async function checkRateLimit(userId: string): Promise<Response | null> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  try {
    const { data } = await supabase
      .from('support_agent_usage')
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
        .from('support_agent_usage')
        .update({ count: data.count + 1 })
        .eq('user_id', userId)
        .eq('window_start', windowStart);
    } else {
      await supabase
        .from('support_agent_usage')
        .insert({ user_id: userId, window_start: windowStart, count: 1 });
    }
  } catch {
    // Table not provisioned yet — allow through rather than breaking support.
  }
  return null;
}

// ── Prompt construction ─────────────────────────────────────────────────────
function buildSystemPrompt(category: Category, context?: SupportContext): string {
  const categoryGuidance: Record<Category, string> = {
    query:
      'Focus on helping the user accomplish tasks and understand Ledgr features. ' +
      'Offer an action that opens the relevant in-app screen.',
    error:
      'The user is reporting a technical problem. Prioritise clear, ordered troubleshooting steps. ' +
      'Use the RECENT CLIENT ERRORS context to identify the failure. Common cases: a chunk/version ' +
      'mismatch → reload the page; network or auth errors → sign out and back in; permission errors → ' +
      'the user’s role may not allow that action. If it is likely a bug or a data issue you cannot fix, ' +
      'escalate with a short summary of the error.',
    compliance:
      'Focus on the user’s data rights and regulatory obligations. Point to the exact self-service path ' +
      '(Settings for export / delete / MFA, /audit for the audit log, /terms-and-conditions for terms). ' +
      'Explain what Ledgr does (a grace period before deletion, an immutable audit trail, least-privilege ' +
      'RBAC) without over-claiming. For deletion or legal requests you cannot action, escalate.',
  };

  let contextBlock = '';
  if (category === 'error') {
    const errors = context?.errors ?? [];
    const errLines = errors.length
      ? errors
          .map((e) => {
            const head = `- [${e.kind ?? 'error'}] ${e.message} @ ${e.url ?? 'unknown'} (${e.ts})`;
            const tail = e.stack
              ? '\n    ' + e.stack.split('\n').slice(0, 3).join('\n    ')
              : '';
            return head + tail;
          })
          .join('\n')
      : 'None captured.';
    contextBlock =
      '\n\nRECENT CLIENT ERRORS (auto-captured, sanitised — no personal data beyond what the browser logs):\n' +
      errLines +
      `\n\nSESSION CONTEXT: appVersion=${context?.appVersion ?? 'unknown'}, ` +
      `platform=${context?.platform ?? 'unknown'}, currentPath=${context?.path ?? 'unknown'}.`;
  }

  return `You are Ledgr Support Agent — the in-app assistant for Ledgr, a cloud accounting, bookkeeping and compliance platform for small and medium businesses in Malawi (and white-label partners such as banks and micro-finance institutions).

Your job is to help users with THREE things:
1. Customer / product questions — how features work and how to perform tasks (invoicing, payroll, bank reconciliation, reports, multi-currency, API/webhooks, etc.).
2. App errors — triage problems the user is experiencing, using any captured client error details provided below.
3. Compliance — data privacy and regulatory topics: data export ("export my data"), account deletion and its grace period, cookie consent, audit logs, terms acceptance, MFA, inactivity timeout, role-based access control (RBAC), MRA tax filings (VAT, withholding tax, PAYE), and record retention. Always point users to the correct in-app self-service path and reassure them about their rights.

Ground rules:
- Be concise, friendly, and practical. Use plain language; avoid jargon unless the user uses it.
- Use MWK (Malawian Kwacha) when discussing money.
- NEVER invent features, URLs, or policy. If unsure, say so and offer to escalate to the support team.
- NEVER ask for or repeat secrets, passwords, full card numbers, or other credentials. If a user shares sensitive data, advise them not to and escalate.
- When you reference an in-app screen, return an action with one of the exact paths listed below so the user can jump there.
- If the issue is urgent, sensitive (billing dispute, legal, data-deletion confirmation, suspected fraud/security), or you cannot help, set escalate=true and tell the user the support email.

KNOWLEDGE (brief):
- Core modules: Dashboard, Income, Expenses, Invoices, Payroll, Contacts, Products/Inventory, Warehouses, Transfers, Chart of Accounts, Assets, Capital, Tax (MRA VAT / withholding / PAYE), Bank Reconciliation, Accounting Periods (with locked periods), Audit Log, Reports (financial statements), Branches, Departments, Multi-currency (IAS 21), Public API & Webhooks, Zapier.
- Compliance self-service lives under Settings: export my data, delete account (a grace period with a cancel option), cookie consent, MFA, session / inactivity timeout. Terms must be accepted on signup; re-acceptance is recorded.
- Roles (RBAC), highest privilege first: owner > admin > accountant > payroll_manager > auditor > viewer, plus operational roles (data_entry, sales_clerk, inventory_manager, supervisor, branch_manager, tax_compliance_officer, etc.). Access is least-privilege.
- Support email: ${SUPPORT_EMAIL}.

IN-APP PATHS (use these exact paths for actions):
${VALID_PATHS.join(', ')}.

CURRENT MODE GUIDANCE:
${categoryGuidance[category]}
${contextBlock}`;
}

// ── Provider: Anthropic Claude ──────────────────────────────────────────────
const SUPPORT_TOOL = {
  name: 'support_response',
  description: 'Return the support reply as structured data with optional in-app navigation actions.',
  input_schema: {
    type: 'object' as const,
    properties: {
      content: { type: 'string', description: 'The helpful reply to the user, in Markdown-lite (short paragraphs, bullet points).' },
      category: { type: 'string', enum: ['query', 'error', 'compliance'] },
      escalate: { type: 'boolean', description: 'True if the user should contact the human support team.' },
      actions: {
        type: 'array',
        description: 'Up to 3 in-app navigation shortcuts.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            path: { type: 'string', enum: VALID_PATHS as unknown as string[] },
            variant: { type: 'string', enum: ['primary', 'secondary'] },
          },
          required: ['label', 'path'],
        },
      },
    },
    required: ['content', 'category', 'escalate'],
  },
};

async function callAnthropic(
  messages: ChatMessage[],
  category: Category,
  systemPrompt: string,
): Promise<SupportResult> {
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
      tools: [SUPPORT_TOOL],
      tool_choice: { type: 'tool', name: 'support_response' },
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const blocks: Array<{ type: string; name?: string; input?: Record<string, unknown> }> =
    Array.isArray(data.content) ? data.content : [];

  const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'support_response');
  if (toolUse?.input) {
    const input = toolUse.input as {
      content?: string;
      category?: Category;
      escalate?: boolean;
      actions?: SupportAction[];
    };
    return {
      content: input.content ?? '',
      category: VALID_CATEGORIES.includes(input.category as Category)
        ? (input.category as Category)
        : category,
      escalate: Boolean(input.escalate),
      actions: Array.isArray(input.actions) ? input.actions.slice(0, 3) : [],
    };
  }

  // Fallback: surface any text if the model returned it without a tool call.
  const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text?: string }).text ?? '').join('\n');
  return { content: text || 'Sorry, I could not generate a response.', actions: [], escalate: false, category };
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

    const category = VALID_CATEGORIES.includes(raw.category) ? (raw.category as Category) : 'query';
    const context = (raw.context ?? {}) as SupportContext;

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

    const systemPrompt = buildSystemPrompt(category, context);

    if (!ANTHROPIC_API_KEY) {
      return json(
        { error: 'Support assistant is not configured (ANTHROPIC_API_KEY secret not set).' },
        503,
      );
    }

    const result: SupportResult = await callAnthropic(messages, category, systemPrompt);

    if (result.escalate) result.supportEmail = SUPPORT_EMAIL;

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
