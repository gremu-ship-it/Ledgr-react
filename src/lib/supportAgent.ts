/**
 * Frontend client for the Ledgr Support Agent edge function.
 *
 * The browser calls the function through `supabase.functions.invoke`, which
 * automatically attaches the signed-in user's JWT — so the backend can verify
 * identity without us ever exposing an AI provider key to the client.
 */

import { supabase } from '@/lib/supabase';
import type { CapturedError } from '@/lib/errorCapture';
import { isFeatureEnabled } from '@/lib/featureFlags';

export type SupportCategory = 'query' | 'error' | 'compliance';

export interface SupportAction {
  label: string;
  path: string;
  variant: 'primary' | 'secondary';
}

export interface SupportContext {
  errors?: CapturedError[];
  appVersion?: string;
  platform?: string;
  path?: string;
}

export interface SupportMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SupportResponse {
  content: string;
  actions: SupportAction[];
  escalate: boolean;
  category: SupportCategory;
  supportEmail?: string;
}

export interface SupportRequest {
  messages: SupportMessage[];
  category: SupportCategory;
  context?: SupportContext;
}

/**
 * Invokes the `support-agent` edge function. Throws on network / auth / HTTP
 * errors so the UI can show a friendly fallback and an escalation path.
 */
export async function callSupportAgent(request: SupportRequest): Promise<SupportResponse> {
  const { data, error } = await supabase.functions.invoke<SupportResponse>('support-agent', {
    body: request,
  });

  if (error) {
    throw new Error(error.message || 'Support agent request failed');
  }
  if (!data) {
    throw new Error('Support agent returned an empty response');
  }

  return {
    content: data.content ?? '',
    actions: Array.isArray(data.actions) ? data.actions : [],
    escalate: Boolean(data.escalate),
    category: data.category ?? request.category,
    supportEmail: data.supportEmail,
  };
}

/**
 * Whether the support assistant is wired up. Because it is served by a Supabase
 * edge function (deployed separately), we cannot statically detect it; the
 * caller should simply attempt a request and handle failures gracefully. This
 * helper exists for parity with the AI Insights page and future feature flags.
 */
export function isSupportConfigured(): boolean {
  return isFeatureEnabled('ai_agent');
}
