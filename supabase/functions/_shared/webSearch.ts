// supabase/functions/_shared/webSearch.ts
//
// Provider-agnostic web search for Ledgr Edge Functions. Used by the Marketing
// Agent (Phase 2) to ground "research" responses in live web results.
//
// Providers (set ONE key as a Supabase secret):
//   • Tavily — set TAVILY_API_KEY        (POST https://api.tavily.com/search,
//                                         Authorization: Bearer <key>)
//   • Brave  — set BRAVE_API_KEY         (GET  https://api.search.brave.com/...,
//                                         X-Subscription-Token: <key>)
//
// Optional: WEB_SEARCH_PROVIDER = 'tavily' | 'brave' forces a provider.
// Otherwise the first present key wins (Tavily preferred, then Brave).
//
// When no key is configured — or the provider errors/times out — searchWeb()
// returns an empty array so callers can fall back gracefully (e.g. the agent
// returns clearly-labelled general guidance instead of pretending to have live
// data). Search results are never invented.

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Whether any search provider key is configured. */
export function webSearchConfigured(): boolean {
  return Boolean(env('TAVILY_API_KEY') || env('BRAVE_API_KEY'));
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function pickProvider(): 'tavily' | 'brave' | null {
  const forced = (env('WEB_SEARCH_PROVIDER') || '').toLowerCase();
  if (forced === 'tavily' || forced === 'brave') return forced;
  if (env('TAVILY_API_KEY')) return 'tavily';
  if (env('BRAVE_API_KEY')) return 'brave';
  return null;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function searchTavily(query: string, max: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const key = env('TAVILY_API_KEY');
  if (!key) return [];
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({
      query,
      max_results: max,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const results = Array.isArray(data.results) ? (data.results as unknown[]) : [];
  return results
    .slice(0, max)
    .map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: asString(o.title),
        url: asString(o.url),
        snippet: asString(o.content) || asString(o.description),
      };
    })
    .filter((r) => r.url);
}

async function searchBrave(query: string, max: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const key = env('BRAVE_API_KEY');
  if (!key) return [];
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(max));
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'x-subscription-token': key },
    signal,
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const web = (data.web ?? null) as { results?: unknown[] } | null;
  const results = Array.isArray(web?.results) ? (web!.results as unknown[]) : [];
  return results
    .slice(0, max)
    .map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: asString(o.title),
        url: asString(o.url),
        snippet: asString(o.description),
      };
    })
    .filter((r) => r.url);
}

/**
 * Run a web search. Returns normalised results, or [] when unconfigured /
 * errored / timed out (8s) — never throws, never invents results.
 */
export async function searchWeb(query: string, max = 6): Promise<WebSearchResult[]> {
  const q = query.trim().slice(0, 400);
  if (!q) return [];
  const provider = pickProvider();
  if (!provider) return [];
  try {
    return await withTimeout(
      (signal) => (provider === 'tavily' ? searchTavily(q, max, signal) : searchBrave(q, max, signal)),
      8000,
    );
  } catch {
    return []; // abort / network / parse error — fail soft
  }
}
