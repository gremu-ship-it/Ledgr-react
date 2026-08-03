/**
 * Frontend client for Facebook connection + publishing (Marketing Agent Phase 3).
 *
 * The browser never sees a Facebook access token — only whether a Page is
 * connected (and its non-sensitive name/id). All token handling happens
 * server-side in the facebook-auth / facebook-publish edge functions.
 */

import { supabase } from '@/lib/supabase';

export interface FacebookConnection {
  id: string;
  pageId: string;
  pageName: string;
  connectedAt: string;
}

/** Whether a (non-revoked) Facebook Page is connected for this business. */
export async function getFacebookConnection(businessId: string): Promise<FacebookConnection | null> {
  // Deliberately select only non-sensitive columns — never the access token.
  const { data, error } = await supabase
    .from('social_connections')
    .select('id,account_id,account_name,connected_at')
    .eq('business_id', businessId)
    .eq('provider', 'facebook')
    .is('revoked_at', null)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Could not load Facebook connection');
  if (!data) return null;
  return {
    id: data.id,
    pageId: data.account_id,
    pageName: data.account_name || 'Facebook Page',
    connectedAt: data.connected_at,
  };
}

/** Start the Facebook Login flow; returns the URL the app should navigate to. */
export async function startFacebookConnect(businessId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ authUrl?: string; error?: string }>('facebook-auth', {
    body: { action: 'start', businessId },
  });
  if (error) throw new Error(error.message || 'Could not start Facebook connection');
  if (!data?.authUrl) throw new Error(data?.error || 'No authorization URL returned');
  return data.authUrl;
}

/** Revoke the business's Facebook connection (sets revoked_at). */
export async function disconnectFacebook(businessId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('facebook-auth', {
    body: { action: 'disconnect', businessId },
  });
  if (error) throw new Error(error.message || 'Could not disconnect Facebook');
}

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  postId?: string;
  pageName?: string;
  error?: string;
}

/** Publish a draft (by id) or raw text to the connected Facebook Page. */
export async function publishToFacebook(args: {
  businessId: string;
  text: string;
  postId?: string;
  channel?: string;
}): Promise<PublishResult> {
  const { data, error } = await supabase.functions.invoke<PublishResult>('facebook-publish', {
    body: args,
  });
  if (error) {
    return { ok: false, error: error.message || 'Publish request failed' };
  }
  return data ?? { ok: false, error: 'Empty response from publisher' };
}
