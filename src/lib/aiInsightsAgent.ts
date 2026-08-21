/**
 * Frontend client for the Ledgr AI Insights edge function ("Ledgr AI" chat).
 *
 * The browser calls the function through `supabase.functions.invoke`, which
 * automatically attaches the signed-in user's JWT — so the backend can verify
 * identity without us ever exposing an AI provider key to the client.
 *
 * This replaced the old direct-to-Arena client (`arenaAgent.ts`), which called
 * a speculative api.arena.ai endpoint and would have shipped an API key in the
 * browser bundle.
 */

import { supabase } from '@/lib/supabase';
import { CircuitBreaker, withTimeout } from '@/lib/resilience';

export interface InsightsMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface InsightsResponse {
  content: string;
}

export interface InsightsRequest {
  messages: InsightsMessage[];
  /** Pre-built summary of live business data (P&L, cash, overdue invoices, …). */
  businessContext: string;
}

/**
 * Invokes the `ai-insights` edge function. Throws on network / auth / HTTP
 * errors so the UI can show a friendly fallback message.
 */
// Phase 10.4: bound the AI call so a hung provider cannot hang the page, and
// trip a breaker after repeated failures so the UI fails fast instead of
// hammering a dead upstream.
const AI_TIMEOUT_MS = 30_000;
const aiBreaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

export async function callAiInsightsAgent(request: InsightsRequest): Promise<InsightsResponse> {
  const invoke = () => supabase.functions.invoke<InsightsResponse>('ai-insights', { body: request });
  const { data, error } = await aiBreaker.run(() => withTimeout(invoke(), AI_TIMEOUT_MS, 'AI Insights'));

  if (error) {
    throw new Error(error.message || 'AI Insights request failed');
  }
  if (!data) {
    throw new Error('AI Insights returned an empty response');
  }

  return { content: data.content ?? '' };
}
