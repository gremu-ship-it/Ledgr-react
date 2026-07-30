// supabase/functions/suggest-bank-matches/index.ts
//
// AI-powered bank statement → ledger entry matching. Sends a minimal
// subset of transaction data to Anthropic Claude for fuzzy matching.
//
// Security:
//   - Auth-gated: caller must present a valid Supabase JWT.
//   - Rate-limited: 10 requests per user per minute (uses ai_insights_usage
//     table to share the same per-user budget as the AI chat).
//   - Input size-capped: bank lines and ledger entries are truncated to
//     prevent prompt-injection via enormous payloads.
//   - CORS origin-checked via the shared helper.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

// Rate limit: 10 AI matching requests per user per minute
const RATE_LIMIT = 10;
// Max items to send to the AI (prevents prompt bloat / cost explosion)
const MAX_BANK_LINES = 200;
const MAX_LEDGER_ENTRIES = 500;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

async function checkRateLimit(userId: string): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  try {
    const { data } = await supabase
      .from('ai_insights_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('window_start', windowStart)
      .maybeSingle();

    if ((data?.count ?? 0) >= RATE_LIMIT) return false;

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
    // Table not provisioned — allow through rather than blocking
  }
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  try {
    // ── Auth ────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401, req);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorised' }, 401, req);

    // ── Rate limit ──────────────────────────────────────────────────
    const allowed = await checkRateLimit(user.id);
    if (!allowed) {
      return json(
        { error: 'Rate limit exceeded. Please wait a minute and try again.' },
        429,
        req,
      );
    }

    // ── Parse & validate input ──────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid request body' }, 400, req);
    }

    const { bankLines, ledgerEntries } = body;
    if (!Array.isArray(bankLines) || !Array.isArray(ledgerEntries)) {
      return json({ error: 'bankLines and ledgerEntries arrays are required' }, 400, req);
    }
    if (bankLines.length === 0 || ledgerEntries.length === 0) {
      return json({ matches: [] }, 200, req);
    }

    if (!ANTHROPIC_API_KEY) {
      return json({ error: 'AI matching is not configured' }, 503, req);
    }

    // Truncate to safe limits — only send the minimum fields needed
    const safeBankLines = bankLines.slice(0, MAX_BANK_LINES).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (x: any, i: number) => ({
        i,
        date: x.date,
        amount: x.amount,
        type: x.type,
        description: typeof x.description === 'string' ? x.description.slice(0, 200) : '',
        reference: typeof x.reference === 'string' ? x.reference.slice(0, 100) : '',
      }),
    );
    const safeEntries = ledgerEntries.slice(0, MAX_LEDGER_ENTRIES).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (x: any) => ({
        id: x.id,
        date: x.entry_date,
        amount: x.amount,
        description: typeof x.description === 'string' ? x.description.slice(0, 200) : '',
        reference: typeof x.reference === 'string' ? x.reference.slice(0, 100) : '',
      }),
    );

    // ── Call AI ─────────────────────────────────────────────────────
    const prompt = `Match Malawi bank statement lines to Ledgr journal entries. Match only when amount is exact, date is within 3 days, and payee/reference supports it. Return JSON only: {"matches":[{"bankIndex":0,"entryId":"id","confidence":0-1,"reason":"short"}]}. Bank lines: ${JSON.stringify(safeBankLines)}. Entries: ${JSON.stringify(safeEntries)}.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude matching request failed (${response.status})`);
    }

    const payload = await response.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = payload.content?.find((x: any) => x.type === 'text')?.text || '{"matches":[]}';

    // Parse the AI response safely
    let result: { matches?: unknown[] };
    try {
      result = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      result = { matches: [] };
    }

    return json(result, 200, req);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unable to suggest matches' },
      400,
      req,
    );
  }
});
