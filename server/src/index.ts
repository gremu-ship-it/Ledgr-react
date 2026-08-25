/**
 * Ledgr API gateway
 * ------------------------------------------------------------------
 * A small, containerised Express service that enforces the cross-cutting
 * production concerns for the Ledgr API and is deployable to Railway or
 * Render (see ../../Dockerfile, ../../railway.json, ../../render.yaml).
 *
 * The canonical backend is the Supabase Edge Function in
 * supabase/functions/api. This gateway is an OPTIONAL, hardened edge in front
 * of it that provides:
 *   - /api/health                 (uptime target, not rate-limited)
 *   - rate limiting               100 req/min authenticated, 10 req/min anon
 *   - security headers            via helmet (CSP, HSTS, X-Frame-Options, ...)
 *   - Sentry error capture        anonymised user context only
 *   - reverse proxy               to the Supabase-hosted API (TARGET_URL)
 *
 * When TARGET_URL is set it proxies /api/v1/* to the Supabase function. If you
 * later migrate the API fully off Supabase Functions, implement the routes here
 * instead of proxying.
 */

// Initialize Sentry FIRST, before importing Express
import * as Sentry from '@sentry/node';

const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.APP_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.request?.url?.includes('/api/health')) {
        return null;
      }
      return event;
    },
    integrations: [
      Sentry.expressIntegration(),
      Sentry.httpIntegration(),
    ],
  });
  console.log('[Sentry] Initialized successfully');
} else {
  console.log('[Sentry] DSN not configured, skipping initialization');
}

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import Redis from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { createServerLogger } from './logger.js';
import { resolveProxyTarget } from './proxyTarget.js';
import { CircuitBreaker } from './resilience.js';

const log = createServerLogger('Gateway');

const PORT = Number(process.env.PORT) || 3000;
const APP_ENV = process.env.APP_ENV || 'staging';
const TARGET_URL = process.env.TARGET_URL || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const REDIS_URL = process.env.REDIS_URL || '';

if (APP_ENV === 'production' && !REDIS_URL) {
  throw new Error('REDIS_URL is required in production so rate limits are shared across instances.');
}
if (APP_ENV === 'production' && TARGET_URL && new URL(TARGET_URL).protocol !== 'https:') {
  throw new Error('Production TARGET_URL must use HTTPS.');
}

// Phase 10.4: bound upstream requests and trip a breaker after repeated
// failures (see the proxy handler below).
const UPSTREAM_TIMEOUT_MS = 15_000;
const upstreamBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });

const app = express();

// Trust Railway's reverse proxy (required for accurate IP detection in rate limiting)
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

app.use(
  cors({
    origin: ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(',').map((o) => o.trim()) : true,
  }),
);

// Capture raw body as a string for proxying (any content type).
app.use(express.text({ type: () => true, limit: '1mb' }));

// Request logging middleware — logs method, path, status, and duration.
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    const reqLog = log.child({ operation: 'request' });
    reqLog[level](`${req.method} ${req.path} → ${res.statusCode}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      method: req.method,
      path: req.path,
    });
  });
  next();
});

const redisClient = REDIS_URL
  ? new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    })
  : null;

const sharedRateStore = redisClient
  ? new RedisStore({
      prefix: 'ledgr-gateway:',
      sendCommand: async (command: string, ...args: string[]): Promise<RedisReply> =>
        await redisClient.call(command, ...args) as RedisReply,
    })
  : undefined;

/**
 * Apply exactly one policy per request: authenticated clients receive 100/min
 * keyed by a non-reversible token hash; anonymous clients receive 10/min using
 * express-rate-limit's IPv6-safe IP normalization.
 */
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: (req) =>
    req.headers.authorization || req.headers['x-api-key'] ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: sharedRateStore,
  keyGenerator: (req) => {
    const credential = req.headers.authorization || req.headers['x-api-key'];
    if (credential) {
      const value = Array.isArray(credential) ? credential.join(',') : credential;
      return `auth:${hashToken(value)}`;
    }
    return `ip:${ipKeyGenerator(req.ip || '')}`;
  },
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', env: APP_ENV, ts: Date.now(), service: 'ledgr-gateway' });
});

// Test endpoint to verify Sentry error capture
app.get('/api/test-error', () => {
  throw new Error('Test error for Sentry verification');
});

app.use(
  '/api/v1',
  apiLimiter,
  async (req: Request, res: Response) => {
    // The upstream API is authenticated and tenant-scoped. Do not rely on an
    // intermediary preserving upstream headers through this reconstructed
    // response; set the policy explicitly at the gateway boundary.
    res.set('Cache-Control', 'no-store');
    if (!TARGET_URL) {
      log.warn('TARGET_URL not configured — returning 503');
      res.status(503).json({
        errors: [{ status: '503', title: 'Bad gateway', detail: 'TARGET_URL is not configured' }],
      });
      return;
    }

    try {
      let resolved: URL;
      try {
        resolved = resolveProxyTarget(TARGET_URL, req.originalUrl);
      } catch (error) {
        log.warn('Blocked invalid proxy request', {
          path: req.originalUrl,
          reason: error instanceof Error ? error.message : 'invalid target',
        });
        res.status(400).json({
          errors: [{ status: '400', title: 'Bad request', detail: 'Path escapes the configured target' }],
        });
        return;
      }
      const url = resolved.toString();
      const headers = new Headers();
      const excludedHeaders = new Set([
        'connection',
        'content-length',
        'host',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
      ]);
      for (const [key, value] of Object.entries(req.headers)) {
        if (excludedHeaders.has(key.toLowerCase())) continue;
        if (Array.isArray(value)) headers.set(key, value.join(', '));
        else if (value) headers.set(key, value);
      }

      // Anonymised user context for Sentry (hashed token — never the raw key).
      const auth = (req.headers['authorization'] as string) || (req.headers['x-api-key'] as string);
      if (auth && SENTRY_DSN) Sentry.setUser({ id: hashToken(auth) });

      // Phase 10.4: bound the upstream call (15s) and trip a breaker after 5
      // consecutive failures so a dead upstream fails fast instead of
      // hanging every request for the full timeout.
      const upstream = await upstreamBreaker.run(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
          // resolveProxyTarget constructs scheme/authority exclusively from
          // TARGET_URL and appends only a validated path/query. The caller
          // cannot redirect this request to another host.
          return await fetch(url, {

            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.body as string | undefined),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      });

      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.set('Content-Type', ct);
      res.send(text);
    } catch (err) {
      const isCircuit = err instanceof Error && err.name === 'CircuitOpenError';
      log.error(isCircuit ? 'Upstream circuit open' : 'Proxy request failed', err as Error, {
        method: req.method,
        path: req.originalUrl,
        target: TARGET_URL,
      });
      if (SENTRY_DSN) Sentry.captureException(err);
      res.status(isCircuit ? 503 : 502).json({
        errors: [{ status: isCircuit ? '503' : '502', title: isCircuit ? 'Service temporarily unavailable' : 'Bad gateway' }],
      });
    }
  },
);

// Registers Sentry's Express error-handling middleware (must come after
// the routes above). Anonymised: only a hashed token is attached via
// Sentry.setUser() inside the proxy handler.
if (SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

app.listen(PORT, () => {
  log.info(`Ledgr gateway listening on :${PORT}`, { env: APP_ENV, port: PORT, target: TARGET_URL || '(none)' });
});

function hashToken(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) {
    h = (Math.imul(31, h) + token.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(16);
}
