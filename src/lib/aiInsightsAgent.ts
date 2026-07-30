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
export async function callAiInsightsAgent(request: InsightsRequest): Promise<InsightsResponse> {
  const { data, error } = await supabase.functions.invoke<InsightsResponse>('ai-insights', {
    body: request,
  });

  if (error) {
    throw new Error(error.message || 'AI Insights request failed');
  }
  if (!data) {
    throw new Error('AI Insights returned an empty response');
  }

  return { content: data.content ?? '' };
}
