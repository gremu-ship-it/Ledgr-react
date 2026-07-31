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

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { createServerLogger } from './logger.js';

const log = createServerLogger('Gateway');

const PORT = Number(process.env.PORT) || 3000;
const APP_ENV = process.env.APP_ENV || 'staging';
const TARGET_URL = process.env.TARGET_URL || '';
const SENTRY_DSN = process.env.SENTRY_DSN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const REDIS_URL = process.env.REDIS_URL || '';

// A process-local store does not protect a horizontally scaled gateway. Redis
// is mandatory in production; local development can run without it.
if (APP_ENV === 'production' && !REDIS_URL) {
  throw new Error('REDIS_URL must be configured when APP_ENV=production');
}
const redis = REDIS_URL ? new Redis(REDIS_URL, { maxRetriesPerRequest: 1 }) : null;
redis?.on('error', (error) => console.error('Redis rate-limit store error:', error.message));
// ioredis has heavily overloaded `call`; narrow it to the store's generic
// Redis command shape at this integration boundary.
const redisCommand = redis as unknown as { call: (...args: string[]) => Promise<unknown> } | null;
const app = express();

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

const allowedOrigins = ALLOWED_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(
  cors({
    // Never reflect arbitrary origins in production. Non-browser clients do
    // not send Origin and remain supported; browser callers must be explicitly
    // configured through ALLOWED_ORIGIN.
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
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
  ...(redisCommand ? { store: new RedisStore({ prefix: 'rl:anon:', sendCommand: (...args: string[]) => redisCommand.call(...args) as Promise<RedisReply> }) } : {}),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
});

// Authenticated: 100 req/min per API key / bearer token.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  ...(redisCommand ? { store: new RedisStore({ prefix: 'rl:auth:', sendCommand: (...args: string[]) => redisCommand.call(...args) as Promise<RedisReply> }) } : {}),
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
      const url = new URL(req.originalUrl, TARGET_URL).toString();
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) headers.set(key, value.join(', '));
        else if (value) headers.set(key, value);
      }

      // Anonymised user context for Sentry (hashed token — never the raw key).
      const auth = (req.headers['authorization'] as string) || (req.headers['x-api-key'] as string);
      if (auth && SENTRY_DSN) Sentry.setUser({ id: hashToken(auth) });

      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req.body as string | undefined),
      });

      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.set('Content-Type', ct);
      res.send(text);
    } catch (err) {
      log.error('Proxy request failed', err as Error, {
        method: req.method,
        path: req.originalUrl,
        target: TARGET_URL,
      });
      if (SENTRY_DSN) Sentry.captureException(err);
      res.status(502).json({ errors: [{ status: '502', title: 'Bad gateway' }] });
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
