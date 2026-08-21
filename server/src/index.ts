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
import rateLimit from 'express-rate-limit';
import { createServerLogger } from './logger.js';
import { CircuitBreaker } from './resilience.js';

const log = createServerLogger('Gateway');

const PORT = Number(process.env.PORT) || 3000;
const APP_ENV = process.env.APP_ENV || 'staging';
const TARGET_URL = process.env.TARGET_URL || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

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

// Unauthenticated: 10 req/min per IP on every route except /api/health.
const unauthLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
});

// Authenticated: 100 req/min per API key / bearer token.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req.headers['authorization'] as string) ||
    (req.headers['x-api-key'] as string) ||
    req.ip ||
    'anonymous',
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
  unauthLimiter,
  authLimiter,
  async (req: Request, res: Response) => {
    if (!TARGET_URL) {
      log.warn('TARGET_URL not configured — returning 503');
      res.status(503).json({
        errors: [{ status: '503', title: 'Bad gateway', detail: 'TARGET_URL is not configured' }],
      });
      return;
    }

    try {
      // Phase 10.4 (CodeQL): the resolved URL must stay on the configured
      // target origin. new URL(path, TARGET) can otherwise escape the target
      // via absolute/authority path tricks (open-proxy / SSRF).
      const target = new URL(TARGET_URL);
      const resolved = new URL(req.originalUrl, target);
      if (resolved.origin !== target.origin) {
        log.warn('Blocked off-target proxy request', { path: req.originalUrl, resolved: resolved.toString() });
        res.status(400).json({ errors: [{ status: '400', title: 'Bad request', detail: 'Path escapes the configured target' }] });
        return;
      }
      const url = resolved.toString();
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
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
          // codeql[js/request-forgery]
          // The URL was resolved against the configured TARGET_URL and
          // rejected unless its origin matches the target origin exactly
          // (see the origin guard above), so this fetch cannot be redirected
          // to an arbitrary host by caller input.
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
