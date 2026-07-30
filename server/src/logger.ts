/**
 * Structured server-side logger for the Ledgr API gateway.
 *
 * Mirrors the client-side logger's API (levels, context, child loggers)
 * but writes JSON-structured lines to stdout/stderr for container log
 * aggregation (Railway, Render, CloudWatch, etc.).
 *
 * In development, output is pretty-printed with colors.
 * In production, output is single-line JSON for machine parsing.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const IS_PROD = (process.env.APP_ENV || process.env.NODE_ENV) === 'production';
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (IS_PROD ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LEVEL];
}

// ANSI colors for dev output
const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[35m',  // magenta
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  fatal: '\x1b[41m\x1b[37m', // white on red
};
const RESET = '\x1b[0m';

interface LogContext {
  module?: string;
  operation?: string;
  [key: string]: unknown;
}

interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, errorOrExtra?: Error | Record<string, unknown>, extra?: Record<string, unknown>): void;
  fatal(message: string, errorOrExtra?: Error | Record<string, unknown>, extra?: Record<string, unknown>): void;
  child(additionalContext: Record<string, unknown>): Logger;
}

function emitLog(level: LogLevel, message: string, context: LogContext, error?: Error): void {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (key === 'module' || key === 'operation') continue;
    if (value !== undefined && value !== null) meta[key] = value;
  }

  if (IS_PROD) {
    // JSON line for machine parsing
    const line: Record<string, unknown> = {
      ts: timestamp,
      level,
      msg: message,
      ...(context.module ? { module: context.module } : {}),
      ...(context.operation ? { operation: context.operation } : {}),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
      ...(error ? { error: { message: error.message, stack: error.stack } } : {}),
    };
    const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(line) + '\n');
  } else {
    // Pretty-printed for dev
    const color = COLORS[level];
    const prefix = context.module ? `[${context.module}]` : '';
    const op = context.operation ? `(${context.operation})` : '';
    const label = `${color}${level.toUpperCase().padEnd(5)}${RESET} ${prefix}${op}`.trim();
    const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    stream.write(`${timestamp} ${label} ${message}`);
    if (Object.keys(meta).length > 0) stream.write(` ${JSON.stringify(meta)}`);
    if (error) stream.write(`\n  ${error.stack || error.message}`);
    stream.write('\n');
  }
}

function createLoggerWithContext(baseContext: LogContext): Logger {
  return {
    debug(message, extra) {
      emitLog('debug', message, { ...baseContext, ...extra });
    },
    info(message, extra) {
      emitLog('info', message, { ...baseContext, ...extra });
    },
    warn(message, extra) {
      emitLog('warn', message, { ...baseContext, ...extra });
    },
    error(message, errorOrExtra?, extra?) {
      const err = errorOrExtra instanceof Error ? errorOrExtra : undefined;
      const merged = err ? { ...extra } : { ...errorOrExtra, ...extra };
      emitLog('error', message, { ...baseContext, ...merged }, err);
    },
    fatal(message, errorOrExtra?, extra?) {
      const err = errorOrExtra instanceof Error ? errorOrExtra : undefined;
      const merged = err ? { ...extra } : { ...errorOrExtra, ...extra };
      emitLog('fatal', message, { ...baseContext, ...merged }, err);
    },
    child(additionalContext) {
      return createLoggerWithContext({ ...baseContext, ...additionalContext });
    },
  };
}

export function createServerLogger(module: string): Logger {
  return createLoggerWithContext({ module });
}

export const serverLogger = createLoggerWithContext({});
