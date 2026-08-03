/**
 * Frontend client for the Ledgr Marketing Agent edge function.
 *
 * The browser calls the function through `supabase.functions.invoke`, which
 * automatically attaches the signed-in user's JWT — so the backend can verify
 * identity and read business data (RLS-scoped) without ever exposing an AI
 * provider key to the client.
 *
 * Phase 0 is draft-only: the function never publishes anything; "publish"
 * mode just produces a draft post for in-app review. See MARKETING_AGENT.md.
 */

import { supabase } from '@/lib/supabase';

export type MarketingMode = 'recommendations' | 'research' | 'publish';

export interface Recommendation {
  title: string;
  rationale: string;
  expectedImpact?: string;
  suggestedAction: string;
  /** WHO the recommendation targets — e.g. "dormant customers", "top 5 customers". */
  targetSegment?: string;
  productRefs?: string[];
}

export interface MarketingDraft {
  channel: string;
  text: string;
  hashtags?: string[];
  cta?: string;
}

export interface ResearchBlock {
  themes: string[];
  opportunities: string[];
  note: string;
}

export interface MarketingResult {
  mode: MarketingMode;
  summary: string;
  recommendations: Recommendation[];
  drafts: MarketingDraft[];
  research: ResearchBlock | null;
  escalate: boolean;
}

export interface MarketingRequest {
  mode: MarketingMode;
  businessId: string;
  /** Optional free-form instruction, e.g. "promote my slow-moving stock". */
  messages?: { role: 'user' | 'assistant'; content: string }[];
  /** Optional brand-voice profile injected into the system prompt. */
  brandVoice?: string;
}

/**
 * Invokes the `marketing-agent` edge function. Throws on network / auth / HTTP
 * errors so the UI can show a friendly fallback (the function may not be
 * deployed yet, e.g. in local development).
 */
export async function callMarketingAgent(request: MarketingRequest): Promise<MarketingResult> {
  const { data, error } = await supabase.functions.invoke<MarketingResult>('marketing-agent', {
    body: request,
  });

  if (error) {
    throw new Error(error.message || 'Marketing agent request failed');
  }
  if (!data) {
    throw new Error('Marketing agent returned an empty response');
  }

  return {
    mode: data.mode ?? request.mode,
    summary: data.summary ?? '',
    recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    drafts: Array.isArray(data.drafts) ? data.drafts : [],
    research: data.research && typeof data.research === 'object' ? data.research : null,
    escalate: Boolean(data.escalate),
  };
}

/** Persist a generated draft to `marketing_posts` (status 'draft') for later review. */
export async function saveDraft(args: {
  businessId: string;
  channel: string;
  text: string;
  title?: string;
}): Promise<void> {
  const { error } = await supabase.from('marketing_posts').insert({
    business_id: args.businessId,
    kind: 'post',
    channel: args.channel,
    status: 'draft',
    title: args.title ?? null,
    content_json: { text: args.text },
  });
  if (error) {
    throw new Error(error.message || 'Could not save draft');
  }
}

// ── Brand voice (Phase 1) ──────────────────────────────────────────────────
// Stored per business in `marketing_settings` and injected into the agent's
// system prompt so generated content matches the business's voice.

/** Load the business's brand-voice profile (empty string if unset). */
export async function loadBrandVoice(businessId: string): Promise<string> {
  const { data, error } = await supabase
    .from('marketing_settings')
    .select('brand_voice')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message || 'Could not load brand voice');
  }
  return data?.brand_voice ?? '';
}

/** Save the business's brand-voice profile (upsert). */
export async function saveBrandVoice(businessId: string, brandVoice: string): Promise<void> {
  const { error } = await supabase
    .from('marketing_settings')
    .upsert({ business_id: businessId, brand_voice: brandVoice.slice(0, 2000) });
  if (error) {
    throw new Error(error.message || 'Could not save brand voice');
  }
}
