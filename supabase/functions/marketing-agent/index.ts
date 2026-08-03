// Ledgr Marketing Agent — Supabase Edge Function
// ---------------------------------------------------------------------------
// The in-app Marketing Assistant for a Ledgr business. It does three things:
//   1. recommendations — analyze the business's own products, stock, sales and
//      customers, and propose promotions, repricing, cross-sells & bundles.
//   2. research        — general marketing/strategy guidance for the business.
//      (Live web + social search arrives in Phase 2 — see MARKETING_AGENT.md.
//       Until then research returns clearly-labelled general guidance, not
//       invented live stats.)
//   3. publish         — draft a product/marketing post (Facebook-style) that the
//       user reviews in-app. Phase 0 is draft-only: nothing is posted for real.
//
// It is auth-gated: only a signed-in Ledgr user (JWT) may invoke it, and calls
// are rate-limited per user per minute (public.marketing_agent_usage). The AI
// provider is Anthropic Claude (ANTHROPIC_API_KEY secret) — already configured
// for the other agents. The key is never exposed to the browser.
//
// Business data is read through a client that carries the user's JWT, so
// Postgres RLS automatically scopes every read to the businesses the user
// belongs to; we additionally filter by the requested business_id.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

// ── Environment ─────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_MODEL = Deno.env.get('MARKETING_AGENT_MODEL') || 'claude-sonnet-4-20250514';
// Requests per user per rolling minute.
const RATE_LIMIT = 30;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get('SB_ENV') || 'edge',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

let _currentReq: Request | undefined;

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_currentReq), ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

function preflight(req: Request) {
  return preflightResponse(req);
}

// ── Types ───────────────────────────────────────────────────────────────────
type Mode = 'recommendations' | 'research' | 'publish';
const VALID_MODES: Mode[] = ['recommendations', 'research', 'publish'];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Recommendation {
  title: string;
  rationale: string;
  expectedImpact: string;
  suggestedAction: string;
  productRefs: string[];
}

interface Draft {
  channel: string;
  text: string;
  hashtags: string[];
  cta: string;
}

interface ResearchBlock {
  themes: string[];
  opportunities: string[];
  note: string;
}

interface MarketingResult {
  mode: Mode;
  summary: string;
  recommendations: Recommendation[];
  drafts: Draft[];
  research: ResearchBlock | null;
  escalate: boolean;
}

// ── Rate limiting (per user, per minute) ────────────────────────────────────
// Mirrors support-agent. Tolerates a missing/locked table so the assistant
// keeps working if the migration hasn't been applied yet.
async function checkRateLimit(client: ReturnType<typeof createClient>, userId: string): Promise<Response | null> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  try {
    const { data } = await client
      .from('marketing_agent_usage')
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
      await client
        .from('marketing_agent_usage')
        .update({ count: data.count + 1 })
        .eq('user_id', userId)
        .eq('window_start', windowStart);
    } else {
      await client
        .from('marketing_agent_usage')
        .insert({ user_id: userId, window_start: windowStart, count: 1 });
    }
  } catch {
    // Table not provisioned yet — allow through rather than breaking the assistant.
  }
  return null;
}

// ── Data context builder (business-scoped, RLS-enforced via the user JWT) ────
function mwk(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `MK${Math.round(n).toLocaleString('en-MW')}`;
}

async function buildMarketingContext(
  authClient: ReturnType<typeof createClient>,
  businessId: string,
): Promise<string> {
  // Run reads in parallel; any single failure degrades gracefully rather than
  // blanking the whole context.
  const [productsRes, balancesRes, invoicesRes, businessRes] = await Promise.allSettled([
    authClient
      .from('products')
      .select('id,name,sku,sale_price,purchase_price,description,reorder_level,category:product_categories(name)')
      .eq('business_id', businessId)
      .order('name', { ascending: true })
      .limit(60),
    authClient
      .from('inventory_balances')
      .select('quantity_on_hand,quantity_available,product:products(name,reorder_level)')
      .eq('business_id', businessId)
      .limit(200),
    authClient
      .from('invoices')
      .select('issue_date,status,total_amount,amount_paid,contact:contacts(name)')
      .eq('business_id', businessId)
      .order('issue_date', { ascending: false })
      .limit(60),
    authClient.from('businesses').select('name,base_currency').eq('id', businessId).maybeSingle(),
  ]);

  const business =
    businessRes.status === 'fulfilled' ? (businessRes.value.data ?? null) : null;
  const currency = business?.base_currency || 'MWK';

  const lines: string[] = [];
  lines.push(`BUSINESS: ${business?.name ?? 'your business'}`);
  lines.push(`CURRENCY: ${currency}`);

  // Products
  const products =
    productsRes.status === 'fulfilled'
      ? ((productsRes.value.data ?? []) as Array<Record<string, unknown>>)
      : [];
  lines.push('');
  lines.push(`PRODUCTS (${products.length}):`);
  for (const p of products.slice(0, 40)) {
    const name = String(p.name ?? 'Unnamed');
    const sku = p.sku ? ` [${p.sku}]` : '';
    const cat = (p.category as { name?: string } | null)?.name ? ` (${(p.category as { name: string }).name})` : '';
    const price = p.sale_price != null ? ` sell ${mwk(p.sale_price as number)}` : '';
    const cost = p.purchase_price != null ? ` cost ${mwk(p.purchase_price as number)}` : '';
    lines.push(`- ${name}${sku}${cat}:${price}${cost}`);
  }
  if (products.length === 0) lines.push('- (no products recorded)');

  // Inventory — flag low / out-of-stock lines
  const balances =
    balancesRes.status === 'fulfilled'
      ? ((balancesRes.value.data ?? []) as Array<Record<string, unknown>>)
      : [];
  const low: string[] = [];
  const out: string[] = [];
  for (const b of balances) {
    const onHand = (b.quantity_on_hand as number | null) ?? 0;
    const prod = b.product as { name?: string; reorder_level?: number | null } | null;
    const reorder = prod?.reorder_level ?? null;
    const name = prod?.name ?? 'item';
    if (onHand <= 0) out.push(name);
    else if (reorder != null && onHand <= reorder) low.push(`${name} (${onHand} left)`);
  }
  lines.push('');
  lines.push('STOCK SIGNALS:');
  lines.push(`- Out of stock: ${out.length ? out.join(', ') : 'none'}`);
  lines.push(`- Low / near reorder: ${low.length ? low.join(', ') : 'none'}`);

  // Recent sales — totals + top customers
  const invoices =
    invoicesRes.status === 'fulfilled'
      ? ((invoicesRes.value.data ?? []) as Array<Record<string, unknown>>)
      : [];
  const totalSales = invoices.reduce((s, i) => s + ((i.total_amount as number | null) ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + ((i.amount_paid as number | null) ?? 0), 0);
  const outstanding = Math.max(totalSales - totalPaid, 0);
  const byCustomer = new Map<string, number>();
  for (const i of invoices) {
    const name = (i.contact as { name?: string } | null)?.name ?? 'Unknown';
    byCustomer.set(name, (byCustomer.get(name) ?? 0) + ((i.total_amount as number | null) ?? 0));
  }
  const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push('');
  lines.push(`RECENT SALES (last ~${invoices.length} invoices):`);
  lines.push(`- Total invoiced: ${mwk(totalSales)} | Outstanding: ${mwk(outstanding)}`);
  lines.push(`- Top customers: ${top.length ? top.map(([n, v]) => `${n} (${mwk(v)})`).join(', ') : 'none'}`);

  lines.push('');
  lines.push('Use ONLY the data above. Do not invent prices, stock levels, or customer testimonials.');
  return lines.join('\n');
}

// ── Prompt construction ─────────────────────────────────────────────────────
function buildSystemPrompt(mode: Mode, context: string, brandVoice?: string): string {
  const voice = (brandVoice && brandVoice.trim())
    ? `\n\nBRAND VOICE (follow this exactly):\n${brandVoice.trim().slice(0, 1500)}`
    : '';

  const modeGuidance: Record<Mode, string> = {
    recommendations:
      'Analyze the business data provided and return concrete, prioritised marketing ' +
      'recommendations: promotions, repricing, bundles, cross-sells, and which customers or ' +
      'segments to target. Every recommendation MUST cite the real data (which product, which ' +
      'stock signal, which customer). Prefer promoting slow-moving / overstocked lines, ' +
      're-engaging top or dormant customers, and protecting margin. Populate `recommendations` ' +
      'and `summary`; you may omit drafts and research.',
    research:
      'You do NOT have live web or social data in this version. Return honest, clearly-labelled ' +
      'GENERAL marketing & growth strategy tailored to this business (its products, customers, ' +
      'and Malawian SME context). Populate `research` with themes, opportunities, and a short ' +
      'note that live trend search is coming later. Do NOT fabricate live statistics, follower ' +
      'counts, or competitor prices. You may also add general `recommendations`.',
    publish:
      'Draft ready-to-post marketing copy for the business based on its real products and stock. ' +
      'Phase 0 is Facebook-style. Write authentic, non-spammy copy: a hook, the real product ' +
      'name and (if known) real price in MWK, and a clear call to action. Do NOT invent ' +
      'scarcity ("only 2 left!") unless the STOCK SIGNALS actually show low stock. Do NOT ' +
      'invent testimonials or discounts. Keep each post under ~280 words. Populate `drafts` ' +
      '(channel "facebook", text, a few relevant hashtags, cta) and `summary`.',
  };

  return `You are the Ledgr Marketing Agent — an in-app marketing assistant for Ledgr, a cloud accounting platform for small and medium businesses in Malawi. You help a business market its real products, manage promotions, and (later) publish to its Facebook page.

Ground rules:
- Be concise, warm, and practical. Plain language. You may use a light Malawian English register; do not overdo slang.
- Use MWK (Malawian Kwacha) for money.
- NEVER invent prices, stock levels, product names, customer testimonials, or offers. Only use the business data provided. If data is missing, say so.
- Respect platform norms: no deceptive scarcity, no spammy repetition, no exaggerated claims, no medical/financial guarantees.
- Recommendations must be specific and tied to the data, not generic filler.
- When you cannot help (e.g. policy question, something needing a human), set escalate=true.

${modeGuidance[mode]}${voice}

BUSINESS DATA (real, live, business-scoped):
${context}`;
}

// ── Provider: Anthropic Claude (forced tool-use for structured JSON) ─────────
const MARKETING_TOOL = {
  name: 'marketing_response',
  description: 'Return the marketing assistant result as structured data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'A 1-3 sentence overview of what you did and the key takeaway.' },
      recommendations: {
        type: 'array',
        description: 'Prioritised marketing recommendations tied to the business data.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            rationale: { type: 'string', description: 'Why this makes sense, citing real data.' },
            expectedImpact: { type: 'string' },
            suggestedAction: { type: 'string', description: 'The concrete next step.' },
            productRefs: { type: 'array', items: { type: 'string' }, description: 'Real product names/SKUs involved.' },
          },
          required: ['title', 'rationale', 'suggestedAction'],
        },
      },
      drafts: {
        type: 'array',
        description: 'Ready-to-review post drafts.',
        items: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            text: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' } },
            cta: { type: 'string' },
          },
          required: ['channel', 'text'],
        },
      },
      research: {
        type: 'object',
        description: 'General strategy guidance (no live data in this version).',
        properties: {
          themes: { type: 'array', items: { type: 'string' } },
          opportunities: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      escalate: { type: 'boolean', description: 'True if a human should be involved.' },
    },
    required: ['summary', 'escalate'],
  },
};

async function callAnthropic(messages: ChatMessage[], systemPrompt: string): Promise<MarketingResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      tools: [MARKETING_TOOL],
      tool_choice: { type: 'tool', name: 'marketing_response' },
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

  const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'marketing_response');
  const input = (toolUse?.input ?? {}) as {
    summary?: string;
    recommendations?: Recommendation[];
    drafts?: Draft[];
    research?: ResearchBlock;
    escalate?: boolean;
  };

  return {
    summary: input.summary ?? '',
    recommendations: Array.isArray(input.recommendations) ? input.recommendations.slice(0, 8) : [],
    drafts: Array.isArray(input.drafts) ? input.drafts.slice(0, 5) : [],
    research: input.research && typeof input.research === 'object' ? input.research : null,
    escalate: Boolean(input.escalate),
  };
}

// ── Request handling ────────────────────────────────────────────────────────
serve(async (req) => {
  _currentReq = req;
  try {
    if (req.method === 'OPTIONS') return preflight(req);
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

    const limited = await checkRateLimit(authClient, userId);
    if (limited) return limited;

    // Parse & validate body.
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') {
      return json({ error: 'Invalid request body' }, 400);
    }

    const mode: Mode = VALID_MODES.includes(raw.mode) ? (raw.mode as Mode) : 'recommendations';
    const businessId = typeof raw.businessId === 'string' ? raw.businessId : '';
    const brandVoice = typeof raw.brandVoice === 'string' ? raw.brandVoice.slice(0, 1500) : '';

    if (!businessId) {
      return json({ error: 'businessId is required' }, 400);
    }

    // Optional free-form instruction from the user.
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
      .slice(-20);

    if (messages.length === 0) {
      // No instruction: let the model work from the data + the mode's defaults.
      messages.push({ role: 'user', content: `Please give me ${mode} for my business based on my data.` });
    }

    if (!ANTHROPIC_API_KEY) {
      return json(
        { error: 'Marketing assistant is not configured (ANTHROPIC_API_KEY secret not set).' },
        503,
      );
    }

    const context = await buildMarketingContext(authClient, businessId);
    const systemPrompt = buildSystemPrompt(mode, context, brandVoice);

    const result: MarketingResult = await callAnthropic(messages, systemPrompt);
    result.mode = mode;

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
