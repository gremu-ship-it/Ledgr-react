/**
 * Centralised structured logger for Ledgr.
 *
 * Features:
 *  - Log levels: debug, info, warn, error, fatal
 *  - Per-module loggers via `createLogger('moduleName')`
 *  - Context enrichment (businessId, userId, operation) via `logger.child()`
 *  - Automatic Sentry capture for error/fatal in production
 *  - Environment-aware: verbose in dev, filtered in prod
 *  - Structured JSON-like output for easy grepping
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('User logged in', { userId: '...' });
 *
 *   // Module-scoped logger
 *   const log = createLogger('InvoiceService');
 *   log.warn('Retry attempt failed', { attempt: 3 });
 *
 *   // Child logger with persistent context
 *   const scopedLog = log.child({ businessId: '...' });
 *   scopedLog.info('Invoice created');
 */

import * as Sentry from '@sentry/react';

// ── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  /** The module or service name (e.g. 'JournalRepository', 'SyncEngine'). */
  module?: string;
  /** The current business ID, when available. */
  businessId?: string | null;
  /** The authenticated user ID, when available. */
  userId?: string | null;
  /** Free-form operation name (e.g. 'createInvoice', 'syncOffline'). */
  operation?: string;
  /** Any additional key-value pairs. */
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: LogContext;
  /** Error object if this is an error-level log. */
  error?: Error;
}

// ── Configuration ────────────────────────────────────────────────────────────

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

function getMinLevel(): LogLevel {
  // In production, only warn+ unless explicitly overridden
  if (import.meta.env.PROD) {
    const override = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'warn';
    return override;
  }
  // In dev, show everything by default
  return (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getMinLevel()];
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatContext(context: LogContext): string {
  const parts: string[] = [];
  if (context.module) parts.push(`[${context.module}]`);
  if (context.operation) parts.push(`(${context.operation})`);
  return parts.join(' ');
}

function formatMeta(context: LogContext): Record<string, unknown> {
  // Filter out null/undefined values for cleaner output.
  // Also exclude module and operation which are already in the log prefix.
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === 'module' || key === 'operation') continue;
    if (value !== undefined && value !== null) {
      meta[key] = value;
    }
  }
  return meta;
}

// ── Console mapping ──────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'color: #8b5cf6; font-weight: bold',
  info: 'color: #0ea5e9; font-weight: bold',
  warn: 'color: #f59e0b; font-weight: bold',
  error: 'color: #ef4444; font-weight: bold',
  fatal: 'color: #dc2626; font-weight: bold; background: #fef2f2',
};

function emitToConsole(entry: LogEntry): void {
  const prefix = formatContext(entry.context);
  const meta = formatMeta(entry.context);
  const hasMeta = Object.keys(meta).length > 0;
  const label = `${entry.level.toUpperCase()} ${prefix}`;

  switch (entry.level) {
    case 'debug':
      if (hasMeta) console.debug(`%c${label}`, LEVEL_STYLE.debug, entry.message, meta);
      else console.debug(`%c${label}`, LEVEL_STYLE.debug, entry.message);
      break;
    case 'info':
      if (hasMeta) console.info(`%c${label}`, LEVEL_STYLE.info, entry.message, meta);
      else console.info(`%c${label}`, LEVEL_STYLE.info, entry.message);
      break;
    case 'warn':
      if (hasMeta) console.warn(`${label} ${entry.message}`, meta);
      else console.warn(`${label} ${entry.message}`);
      break;
    case 'error':
      if (entry.error) console.error(`${label} ${entry.message}`, entry.error);
      else if (hasMeta) console.error(`${label} ${entry.message}`, meta);
      else console.error(`${label} ${entry.message}`);
      break;
    case 'fatal':
      if (entry.error) console.error(`%c${label} ${entry.message}`, LEVEL_STYLE.fatal, entry.error);
      else console.error(`%c${label} ${entry.message}`, LEVEL_STYLE.fatal);
      break;
  }
}

// ── Sentry integration ───────────────────────────────────────────────────────

function reportToSentry(entry: LogEntry): void {
  // Only report error/fatal to Sentry
  if (entry.level !== 'error' && entry.level !== 'fatal') return;
  // Don't report if Sentry isn't initialised (no DSN)
  if (!import.meta.env.VITE_SENTRY_DSN) return;

  const sentryContext: Record<string, unknown> = {
    ...formatMeta(entry.context),
    module: entry.context.module,
    operation: entry.context.operation,
  };

  if (entry.error) {
    Sentry.captureException(entry.error, {
      level: entry.level === 'fatal' ? 'fatal' : 'error',
      tags: {
        module: entry.context.module ?? 'unknown',
        operation: entry.context.operation ?? 'unknown',
      },
      extra: sentryContext,
    });
  } else {
    Sentry.captureMessage(entry.message, {
      level: entry.level === 'fatal' ? 'fatal' : 'error',
      tags: {
        module: entry.context.module ?? 'unknown',
        operation: entry.context.operation ?? 'unknown',
      },
      extra: sentryContext,
    });
  }
}

// ── Core log function ────────────────────────────────────────────────────────

function log(level: LogLevel, message: string, context: LogContext, error?: Error): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
    error,
  };

  emitToConsole(entry);
  reportToSentry(entry);
}

// ── Logger interface ─────────────────────────────────────────────────────────

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, errorOrExtra?: Error | Record<string, unknown>, extra?: Record<string, unknown>): void;
  fatal(message: string, errorOrExtra?: Error | Record<string, unknown>, extra?: Record<string, unknown>): void;
  /** Create a child logger that inherits + merges context. */
  child(additionalContext: Record<string, unknown>): Logger;
}

function createLoggerWithContext(baseContext: LogContext): Logger {
  return {
    debug(message: string, extra?: Record<string, unknown>) {
      log('debug', message, { ...baseContext, ...extra });
    },
    info(message: string, extra?: Record<string, unknown>) {
      log('info', message, { ...baseContext, ...extra });
    },
    warn(message: string, extra?: Record<string, unknown>) {
      log('warn', message, { ...baseContext, ...extra });
    },
    error(message: string, errorOrExtra?: Error | Record<string, unknown>, extra?: Record<string, unknown>) {
      const err = errorOrExtra instanceof Error ? errorOrExtra : undefined;
      const merged = err ? { ...extra } : { ...errorOrExtra, ...extra };
      log('error', message, { ...baseContext, ...merged }, err);
    },
    fatal(message: string, errorOrExtra?: Error | Record<string, unknown>, extra?: Record<string, unknown>) {
      const err = errorOrExtra instanceof Error ? errorOrExtra : undefined;
      const merged = err ? { ...extra } : { ...errorOrExtra, ...extra };
      log('fatal', message, { ...baseContext, ...merged }, err);
    },
    child(additionalContext: Record<string, unknown>): Logger {
      return createLoggerWithContext({ ...baseContext, ...additionalContext });
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a module-scoped logger.
 *
 * @example
 * const log = createLogger('InvoiceService');
 * log.info('Invoice created', { invoiceId: '...' });
 */
export function createLogger(module: string): Logger {
  return createLoggerWithContext({ module });
}

/**
 * Root logger — use when a module-scoped logger isn't needed.
 *
 * @example
 * logger.info('App initialised');
 */
export const logger = createLoggerWithContext({});
