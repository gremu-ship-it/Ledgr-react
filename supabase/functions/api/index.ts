import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as Sentry from 'npm:@sentry/deno@8';
import { z } from 'npm:zod@4.4.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const API_BASE_URL = Deno.env.get('PUBLIC_API_BASE_URL') || `${SUPABASE_URL}/functions/v1/api/api/v1`;

// Rate limits (requests / minute)
const AUTH_RATE_LIMIT = 100; // authenticated API keys
const UNAUTH_RATE_LIMIT = 10; // unauthenticated clients, by IP

// --- Sentry (backend) -------------------------------------------------------
// Anonymised: sendDefaultPii is false so no IP / email / username is attached.
// A non-PII user id (the API key uuid) is set per request in authenticate().
const SENTRY_DSN = Deno.env.get('SENTRY_DSN');
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Deno.env.get('SB_ENV') || 'edge',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

import { corsHeadersForRequest, preflightResponse } from '../_shared/cors.ts';

let _req: Request | undefined;

// Security headers are attached to EVERY response from the API.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

type RouteDef = {
  method: 'GET' | 'POST';
  path: string;
  resource: 'invoices' | 'expenses' | 'accounts' | 'journal-entries';
  table: 'invoices' | 'expenses' | 'accounts' | 'journal_entries';
  event?: string;
  summary: string;
};

const ROUTES: RouteDef[] = [
  { method: 'GET', path: '/invoices', resource: 'invoices', table: 'invoices', summary: 'List invoices' },
  { method: 'POST', path: '/invoices', resource: 'invoices', table: 'invoices', event: 'invoice.created', summary: 'Create invoice' },
  { method: 'GET', path: '/expenses', resource: 'expenses', table: 'expenses', summary: 'List expenses' },
  { method: 'POST', path: '/expenses', resource: 'expenses', table: 'expenses', event: 'expense.created', summary: 'Create expense' },
  { method: 'GET', path: '/accounts', resource: 'accounts', table: 'accounts', summary: 'List chart of accounts' },
  { method: 'GET', path: '/journal-entries', resource: 'journal-entries', table: 'journal_entries', summary: 'List journal entries' },
  { method: 'POST', path: '/journal-entries', resource: 'journal-entries', table: 'journal_entries', event: 'journal_entry.created', summary: 'Create journal entry' },
];

const uuid = z.string().uuid();
const money = z.coerce.number().finite().nonnegative();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD date');
const nullableUuid = uuid.nullish();

// These schemas are intentionally strict. Service-role writes must not inherit
// every database column merely because a client supplied it.
const invoiceCreateSchema = z.object({
  invoice_number: z.string().trim().min(1).max(100), contact_id: uuid,
  issue_date: date.optional(), due_date: date.nullish(), currency: z.string().length(3).optional(),
  invoice_type: z.string().trim().min(1).max(50).optional(), notes: z.string().max(10_000).nullish(),
  terms: z.string().max(2_000).nullish(), po_number: z.string().max(100).nullish(),
  branch_id: nullableUuid, department_id: nullableUuid, ar_account_id: nullableUuid, revenue_account_id: nullableUuid,
  subtotal: money.optional(), taxable_amount: money.optional(), vat_amount: money.optional(),
  wht_amount: money.optional(), discount_amount: money.optional(), discount_percent: money.optional(), total_amount: money.optional(),
}).strict();
const expenseCreateSchema = z.object({
  expense_number: z.string().trim().min(1).max(100), expense_date: date.optional(), due_date: date.nullish(),
  currency: z.string().length(3).optional(), expense_type: z.string().trim().min(1).max(50).optional(),
  notes: z.string().max(10_000).nullish(), reference: z.string().max(200).nullish(), contact_id: nullableUuid,
  branch_id: nullableUuid, department_id: nullableUuid, ap_account_id: nullableUuid,
  subtotal: money.optional(), vat_amount: money.optional(), wht_amount: money.optional(), total_amount: money.optional(),
}).strict();
const journalLineSchema = z.object({
  line_number: z.coerce.number().int().positive().optional(), account_id: uuid, is_debit: z.boolean(),
  amount: money, amount_base: z.coerce.number().finite().positive(), currency: z.string().length(3).optional(),
  exchange_rate: z.coerce.number().finite().positive().optional(), description: z.string().max(2_000).nullish(),
  branch_id: nullableUuid, department_id: nullableUuid, tax_code: z.string().max(50).nullish(), tax_amount: money.optional(),
  original_currency: z.string().length(3).nullish(), original_amount: money.nullish(), rate_date: date.nullish(), rate_is_stale: z.boolean().optional(),
}).strict();
const journalCreateSchema = z.object({
  entry_number: z.string().trim().min(1).max(100), entry_date: date, description: z.string().trim().min(1).max(10_000),
  reference: z.string().max(200).nullish(), currency: z.string().length(3).optional(), exchange_rate: z.coerce.number().finite().positive().optional(),
  branch_id: nullableUuid, department_id: nullableUuid, period_id: nullableUuid, source_type: z.string().max(100).nullish(), source_id: nullableUuid,
  lines: z.array(journalLineSchema).min(2).max(500),
}).strict();

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(_req), ...SECURITY_HEADERS, 'Content-Type': 'application/vnd.api+json', ...headers },
  });
}

function preflight(req: Request) {
  return new Response('ok', { headers: { ...corsHeadersForRequest(req), ...SECURITY_HEADERS } });
}

function errorResponse(status: number, title: string, detail?: string) {
  return response({ errors: [{ status: String(status), title, detail: detail ?? title }] }, status);
}

function apiPath(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const idx = pathname.indexOf('/api/v1');
  if (idx >= 0) return pathname.slice(idx + '/api/v1'.length) || '/';
  return pathname.replace(/^\/api\/?/, '/') || '/';
}

function getApiKey(req: Request): string | null {
  const bearer = req.headers.get('Authorization');
  if (bearer?.startsWith('Bearer ')) return bearer.slice('Bearer '.length).trim();
  return req.headers.get('X-API-Key');
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function jsonApiResource(type: string, row: Record<string, unknown>) {
  const { id, ...attributes } = row;
  return { type, id: String(id), attributes };
}

function jsonApiDocument(type: string, data: unknown, meta?: Record<string, unknown>) {
  const rows = Array.isArray(data) ? data : [data];
  const transformed = rows.map((row) => jsonApiResource(type, row as Record<string, unknown>));
  return { data: Array.isArray(data) ? transformed : transformed[0], ...(meta ? { meta } : {}) };
}

function requestAttributes(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const maybe = body as { data?: { attributes?: Record<string, unknown> }; attributes?: Record<string, unknown> } & Record<string, unknown>;
  return maybe.data?.attributes ?? maybe.attributes ?? maybe;
}

// Generic, per-bucket sliding-window rate limiter backed by public.api_usage.
// `bucket` is the api_key hash for authenticated requests, or `ip:<addr>` for
// unauthenticated ones. Fixes the previous code which referenced a non-existent
// `api_key_id` column.
async function checkRateLimit(bucket: string, limit: number): Promise<Response | null> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const { data: allowed, error } = await supabase.rpc('consume_api_rate_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_start: windowStart,
  });

  // Fail closed if the rate-limit store is unavailable: continuing would make
  // an outage in the limiter an unbounded public-API path.
  if (error || !allowed) {
    return new Response(
      JSON.stringify({
        errors: [{ status: '429', title: 'Rate limit exceeded', detail: `Limit is ${limit} requests per minute.` }],
      }),
      {
        status: 429,
        headers: { ...corsHeadersForRequest(_req), ...SECURITY_HEADERS, 'Content-Type': 'application/vnd.api+json', 'Retry-After': '60' },
      },
    );
  }

  return null;
}

async function authenticate(req: Request): Promise<{ keyId: string; businessId: string } | Response> {
  const apiKey = getApiKey(req);
  if (!apiKey?.startsWith('ledgr_sk_')) return errorResponse(401, 'Unauthorized', 'Missing or invalid API key.');

  const keyHash = await sha256(apiKey);
  const { data: key, error } = await supabase
    .from('api_keys')
    .select('id, business_id, revoked_at')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) return errorResponse(500, 'API key lookup failed', error.message);
  if (!key) return errorResponse(401, 'Unauthorized', 'API key not found or revoked.');

  // 100 req/min per authenticated API key.
  const limited = await checkRateLimit(keyHash, AUTH_RATE_LIMIT);
  if (limited) return limited;

  // Anonymised user context for Sentry (non-PII uuid only).
  if (SENTRY_DSN) Sentry.setUser({ id: key.id });

  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);
  return { keyId: key.id, businessId: key.business_id };
}

function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const normalized = ip.replace(/^\[|\]$/g, '');
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('2001:db8') ||
    (normalized.startsWith('::ffff:') && isPrivateIp(normalized.slice(7)));
}

async function assertPublicWebhookDestination(endpoint: URL): Promise<void> {
  const host = endpoint.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || isPrivateIp(host)) {
    throw new Error('Webhook destination is not a public address');
  }
  const records = await Promise.all(['A', 'AAAA'].map((type) =>
    Deno.resolveDns(host, type as 'A' | 'AAAA').catch(() => [] as string[]),
  ));
  const addresses = records.flat();
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new Error('Webhook destination does not resolve exclusively to public addresses');
  }
}

async function deliverWebhooks(businessId: string, event: string, payload: unknown) {
  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .contains('events', [event]);

  for (const webhook of webhooks ?? []) {
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const endpoint = new URL(webhook.url);
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
          throw new Error('Webhook destination is not a permitted public HTTPS endpoint');
        }
        // Resolve immediately before delivery. Redirects remain disabled; deploy
        // an egress proxy with DNS pinning for protection against DNS rebinding.
        await assertPublicWebhookDestination(endpoint);
        const res = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'X-Ledgr-Event': event,
            'X-Ledgr-Signature': await hmacSha256(webhook.secret, body),
          },
          body,
        });
        // Recipient bodies are untrusted and may contain sensitive data; only
        // store delivery metadata.
        await supabase.from('webhook_deliveries').insert({
          webhook_id: webhook.id,
          event,
          payload,
          status_code: res.status,
          response_body: null,
          attempt,
          delivered_at: res.ok ? new Date().toISOString() : null,
        });
        await supabase.from('webhooks').update({ last_triggered_at: new Date().toISOString() }).eq('id', webhook.id);
        if (res.ok) break;
      } catch (err) {
        await supabase.from('webhook_deliveries').insert({
          webhook_id: webhook.id,
          event,
          payload,
          status_code: null,
          response_body: err instanceof Error ? err.message : String(err),
          attempt,
        });
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2 ** (attempt - 1) * 1000));
    }
  }
}

function openApiSpec() {
  const paths: Record<string, unknown> = {};
  for (const route of ROUTES) {
    paths[route.path] ??= {};
    (paths[route.path] as Record<string, unknown>)[route.method.toLowerCase()] = {
      summary: route.summary,
      tags: [route.resource],
      security: [{ ApiKeyAuth: [] }],
      responses: {
        '200': { description: 'Success' },
        '201': { description: 'Created' },
        '401': { description: 'Unauthorized' },
        '429': { description: 'Rate limit exceeded' },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Ledgr Public API',
      version: '1.0.0',
      description: 'JSON:API REST API for Ledgr accounting integrations.',
    },
    servers: [{ url: API_BASE_URL }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'ledgr_sk_*' },
      },
    },
    paths,
  };
}

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

serve(async (req) => {
  _req = req;
  try {
    if (req.method === 'OPTIONS') return preflight(req);

    const path = apiPath(req);

    // Health check used by Better Uptime (excluded from rate limiting so
    // uptime pings always succeed).
    if (req.method === 'GET' && path === '/health') {
      return response({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        service: 'ledgr-api',
        environment: Deno.env.get('SB_ENV') || 'edge',
      });
    }

    // Unauthenticated rate limit: 10 req/min per client IP on all API routes.
    const unauthLimited = await checkRateLimit(`ip:${clientIp(req)}`, UNAUTH_RATE_LIMIT);
    if (unauthLimited) return unauthLimited;

    if (req.method === 'GET' && (path === '/openapi.json' || path === '/swagger.json')) {
      return response(openApiSpec(), 200, { 'Content-Type': 'application/json' });
    }

    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;

    const route = ROUTES.find((r) => r.path === path && r.method === req.method);
    if (!route) return errorResponse(404, 'Not Found', `No route for ${req.method} ${path}`);

    try {
      if (route.method === 'GET') {
        // Filter soft-deleted records for tables that support soft-delete.
        // Tables without a deleted_at column (journal_entries, accounts) are
        // unaffected — the conditional .is() is simply skipped.
        const SOFT_DELETE_TABLES = new Set(['invoices', 'expenses']);
        let query = supabase
          .from(route.table)
          .select('*', { count: 'exact' })
          .eq('business_id', auth.businessId) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (SOFT_DELETE_TABLES.has(route.table)) {
          query = query.is('deleted_at', null);
        }
        const { data, error, count } = await query
          .order('created_at', { ascending: false });
        if (error) throw error;
        return response(jsonApiDocument(route.resource, data ?? [], { count: count ?? (data?.length ?? 0) }));
      }

      const body = await req.json().catch(() => ({}));
      const attrs = requestAttributes(body);

      if (route.resource === 'journal-entries') {
        const entry = journalCreateSchema.parse(attrs);
        const lines = entry.lines.map((line, index) => ({ ...line, line_number: line.line_number ?? index + 1 }));
        const { data, error } = await supabase.rpc('create_api_journal_entry', {
          p_business_id: auth.businessId,
          // The RPC consumes an allowlisted subset of this object; keeping the
          // lines here avoids a lossy client-side object reconstruction.
          p_entry: entry,
          p_lines: lines,
        });
        if (error) throw error;
        await deliverWebhooks(auth.businessId, route.event!, data);
        return response(jsonApiDocument(route.resource, data), 201);
      }

      // Explicit schemas prevent callers from writing lifecycle, audit,
      // payment, ownership, or soft-delete columns through the service role.
      const safeAttrs = route.resource === 'invoices'
        ? invoiceCreateSchema.parse(attrs)
        : expenseCreateSchema.parse(attrs);
      const { data, error } = await supabase
        .from(route.table)
        .insert({ ...safeAttrs, business_id: auth.businessId })
        .select('*')
        .single();
      if (error) throw error;
      if (route.event) await deliverWebhooks(auth.businessId, route.event, data);
      return response(jsonApiDocument(route.resource, data), 201);
    } catch (err) {
      return errorResponse(400, 'Request failed', err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    if (SENTRY_DSN) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    return errorResponse(500, 'Internal Server Error', err instanceof Error ? err.message : String(err));
  }
});
