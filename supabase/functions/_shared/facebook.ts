// supabase/functions/_shared/facebook.ts
//
// Thin Facebook Graph API client for the Marketing Agent (Phase 3).
// Implements the publish flow: authorize → long-lived user token → Page token
// (stored encrypted) → POST to the Page's feed.
//
// Secrets:
//   FB_APP_ID, FB_APP_SECRET          — your Meta app credentials
//   FB_REDIRECT_URI (optional)        — defaults to <SUPABASE_URL>/functions/v1/facebook-auth
//
// Permissions requested: pages_show_list, pages_read_engagement, pages_manage_posts
// (the last two require App Review before non-developer users can publish).
//
// Graph API version v25.0 (current as of 2026).

export const GRAPH_VERSION = 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

export const FB_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

export function fbAppId(): string {
  return env('FB_APP_ID') ?? '';
}
export function fbAppSecret(): string {
  return env('FB_APP_SECRET') ?? '';
}
export function fbConfigured(): boolean {
  return Boolean(fbAppId() && fbAppSecret());
}

export function defaultRedirectUri(): string {
  const override = env('FB_REDIRECT_URI');
  if (override) return override.replace(/\/+$/, '');
  const supabaseUrl = (env('SUPABASE_URL') || '').replace(/\/+$/, '');
  return `${supabaseUrl}/functions/v1/facebook-auth`;
}

/** Build the Facebook Login authorization URL (browser navigates here). */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: fbAppId(),
    redirect_uri: redirectUri,
    state,
    scope: FB_SCOPES.join(','),
    response_type: 'code',
  });
  return `${DIALOG}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  error?: { message: string };
}

async function graphGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as TokenResponse & Record<string, unknown>;
  if (!res.ok || data.error) {
    const msg = data.error?.message || `Graph API ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/** Exchange the Login `code` for a short-lived User access token. */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const data = (await graphGet('/oauth/access_token', {
    client_id: fbAppId(),
    redirect_uri: redirectUri,
    client_secret: fbAppSecret(),
    code,
  })) as TokenResponse;
  if (!data.access_token) throw new Error('Facebook did not return an access token');
  return data.access_token;
}

/** Exchange a short-lived User token for a long-lived (~60 day) User token. */
export async function exchangeLongLivedUserToken(shortLived: string): Promise<string> {
  const data = (await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: fbAppId(),
    client_secret: fbAppSecret(),
    fb_exchange_token: shortLived,
  })) as TokenResponse;
  if (!data.access_token) throw new Error('Facebook did not return a long-lived token');
  return data.access_token;
}

export interface FbPage {
  id: string;
  name: string;
  access_token: string;
}

/** List the Pages the user administers (with Page access tokens, long-lived). */
export async function listPages(longLivedUserToken: string): Promise<FbPage[]> {
  const data = (await graphGet('/me/accounts', {
    access_token: longLivedUserToken,
    fields: 'id,name,access_token',
  })) as { data?: FbPage[] };
  return Array.isArray(data.data) ? data.data : [];
}

/** Post a message to a Page's feed. Returns the new post id. */
export async function postToPageFeed(pageId: string, pageToken: string, message: string): Promise<string> {
  const url = `${GRAPH}/${pageId}/feed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, access_token: pageToken, published: true }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message: string } };
  if (!res.ok || data.error || !data.id) {
    throw new Error(data.error?.message || `Publish failed (${res.status})`);
  }
  return data.id;
}
