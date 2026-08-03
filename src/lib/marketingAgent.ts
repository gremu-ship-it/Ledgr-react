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

export interface Source {
  title: string;
  url: string;
  snippet: string;
}

export interface MarketingResult {
  mode: MarketingMode;
  summary: string;
  recommendations: Recommendation[];
  drafts: MarketingDraft[];
  research: ResearchBlock | null;
  /** Web sources used to ground a research response (empty unless research + search). */
  sources: Source[];
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
    sources: Array.isArray(data.sources) ? data.sources : [],
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

// ── Autopilot settings (Phase 4) ────────────────────────────────────────────

export interface AutopilotSettings {
  autopilotEnabled: boolean;
  maxPostsPerDay: number;
  aiDisclosure: boolean;
}

export async function getAutopilotSettings(businessId: string): Promise<AutopilotSettings> {
  const { data, error } = await supabase
    .from('marketing_settings')
    .select('autopilot_enabled,max_posts_per_day,ai_disclosure')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load autopilot settings');
  return {
    autopilotEnabled: data?.autopilot_enabled ?? false,
    maxPostsPerDay: data?.max_posts_per_day ?? 1,
    aiDisclosure: data?.ai_disclosure ?? true,
  };
}

export async function saveAutopilotSettings(businessId: string, s: AutopilotSettings): Promise<void> {
  const { error } = await supabase.from('marketing_settings').upsert({
    business_id: businessId,
    autopilot_enabled: s.autopilotEnabled,
    max_posts_per_day: Math.max(1, Math.min(10, Math.round(s.maxPostsPerDay))),
    ai_disclosure: s.aiDisclosure,
  });
  if (error) throw new Error(error.message || 'Could not save autopilot settings');
}

// ── Scheduling + content library (Phase 4) ──────────────────────────────────

export type MarketingPostStatus =
  | 'draft'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'archived';

export interface MarketingPost {
  id: string;
  status: MarketingPostStatus;
  channel: string;
  text: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  error: string | null;
  metrics: { impressions?: number; reactions?: number; comments?: number };
  createdAt: string;
}

/** Approve a draft and schedule it for the autopilot to publish. */
export async function scheduleDraft(args: {
  businessId: string;
  text: string;
  scheduledFor: string; // ISO datetime
  channel?: string;
}): Promise<MarketingPost> {
  const { data, error } = await supabase
    .from('marketing_posts')
    .insert({
      business_id: args.businessId,
      kind: 'post',
      channel: args.channel ?? 'facebook',
      status: 'approved',
      content_json: { text: args.text },
      scheduled_for: args.scheduledFor,
    })
    .select('id,status,channel,content_json,scheduled_for,published_at,error,metrics_json,created_at')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not schedule draft');
  return rowToPost(data);
}

/** The business's content library (drafts / scheduled / published + metrics). */
export async function listMarketingPosts(businessId: string): Promise<MarketingPost[]> {
  const { data, error } = await supabase
    .from('marketing_posts')
    .select('id,status,channel,content_json,scheduled_for,published_at,error,metrics_json,created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message || 'Could not load posts');
  return (data ?? []).map(rowToPost);
}

/** Permanently remove a draft/scheduled post (not published ones). */
export async function deleteMarketingPost(postId: string): Promise<void> {
  const { error } = await supabase.from('marketing_posts').delete().eq('id', postId);
  if (error) throw new Error(error.message || 'Could not delete post');
}

function rowToPost(r: Record<string, unknown>): MarketingPost {
  const cj = (r.content_json ?? null) as { text?: string } | null;
  const mj = (r.metrics_json ?? null) as { impressions?: number; reactions?: number; comments?: number } | null;
  return {
    id: String(r.id),
    status: (r.status as MarketingPostStatus) ?? 'draft',
    channel: typeof r.channel === 'string' ? r.channel : 'facebook',
    text: typeof cj?.text === 'string' ? cj.text : '',
    scheduledFor: typeof r.scheduled_for === 'string' ? r.scheduled_for : null,
    publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
    error: typeof r.error === 'string' ? r.error : null,
    metrics: {
      impressions: typeof mj?.impressions === 'number' ? mj.impressions : undefined,
      reactions: typeof mj?.reactions === 'number' ? mj.reactions : undefined,
      comments: typeof mj?.comments === 'number' ? mj.comments : undefined,
    },
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
  };
}
