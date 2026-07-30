/**
 * Standardised error handling utilities for Ledgr.
 *
 * Provides consistent patterns for:
 *  - Classifying errors by severity and type
 *  - Extracting user-friendly messages
 *  - Logging with context
 *  - Deciding whether to retry or fail
 */

import { createLogger } from './logger';
import { pushError, pushWarning } from './notifications';
import {
  RepositoryError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  DatabaseError,
} from '@/dal/errors/RepositoryError';
import { isChunkLoadError } from './chunkRecovery';

const log = createLogger('ErrorHandler');

// ── Error classification ─────────────────────────────────────────────────────

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ErrorClassification {
  severity: ErrorSeverity;
  category: string;
  userMessage: string;
  shouldRetry: boolean;
  shouldNotify: boolean;
  shouldReport: boolean;
}

/**
 * Classify an error to determine how to handle it.
 */
export function classifyError(error: unknown): ErrorClassification {
  // Chunk load errors — low severity, auto-recoverable
  if (isChunkLoadError(error)) {
    return {
      severity: 'low',
      category: 'chunk_load',
      userMessage: 'A new version is available. Please refresh the page.',
      shouldRetry: false, // Chunk recovery handles this
      shouldNotify: false,
      shouldReport: false,
    };
  }

  // Repository errors (from DAL layer)
  if (error instanceof NotFoundError) {
    return {
      severity: 'low',
      category: 'not_found',
      userMessage: error.message,
      shouldRetry: false,
      shouldNotify: true,
      shouldReport: false,
    };
  }

  if (error instanceof ValidationError) {
    return {
      severity: 'low',
      category: 'validation',
      userMessage: error.message,
      shouldRetry: false,
      shouldNotify: true,
      shouldReport: false,
    };
  }

  if (error instanceof UnauthorizedError) {
    return {
      severity: 'medium',
      category: 'unauthorized',
      userMessage: 'You do not have permission to perform this action.',
      shouldRetry: false,
      shouldNotify: true,
      shouldReport: false,
    };
  }

  if (error instanceof DatabaseError) {
    return {
      severity: 'high',
      category: 'database',
      userMessage: 'A database error occurred. Please try again.',
      shouldRetry: true,
      shouldNotify: true,
      shouldReport: true,
    };
  }

  if (error instanceof RepositoryError) {
    return {
      severity: 'medium',
      category: 'repository',
      userMessage: error.message,
      shouldRetry: false,
      shouldNotify: true,
      shouldReport: true,
    };
  }

  // Network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      severity: 'medium',
      category: 'network',
      userMessage: 'Network error. Please check your connection and try again.',
      shouldRetry: true,
      shouldNotify: true,
      shouldReport: false,
    };
  }

  // Unknown errors
  return {
    severity: 'high',
    category: 'unknown',
    userMessage: 'An unexpected error occurred. Please try again.',
    shouldRetry: false,
    shouldNotify: true,
    shouldReport: true,
  };
}

// ── Error handling functions ─────────────────────────────────────────────────

export interface HandleErrorOptions {
  /** Module or service name for logging context. */
  module?: string;
  /** Operation being performed (e.g. 'createInvoice'). */
  operation?: string;
  /** Business ID for context. */
  businessId?: string | null;
  /** Override the user-facing message. */
  userMessage?: string;
  /** Whether to show a notification to the user (default: based on classification). */
  notify?: boolean;
  /** Whether to log to Sentry (default: based on classification). */
  report?: boolean;
  /** Title for the notification. */
  title?: string;
}

/**
 * Handle an error consistently: classify, log, notify, and report.
 *
 * @example
 * try {
 *   await createInvoice(data);
 * } catch (error) {
 *   handleError(error, {
 *     module: 'InvoicePage',
 *     operation: 'createInvoice',
 *     businessId: currentBusiness?.id,
 *   });
 * }
 */
export function handleError(error: unknown, options: HandleErrorOptions = {}): ErrorClassification {
  const classification = classifyError(error);
  const {
    module = 'App',
    operation,
    businessId,
    userMessage,
    notify = classification.shouldNotify,
    title,
  } = options;

  // Create a contextual logger
  const contextLog = log.child({
    module,
    operation,
    businessId,
    severity: classification.severity,
    category: classification.category,
  });

  // Log the error
  const err = error instanceof Error ? error : new Error(String(error));
  if (classification.severity === 'critical' || classification.severity === 'high') {
    contextLog.error(`Error in ${operation || 'operation'}: ${err.message}`, err);
  } else {
    contextLog.warn(`Error in ${operation || 'operation'}: ${err.message}`, { error: err });
  }

  // Notify the user
  if (notify) {
    const message = userMessage || classification.userMessage;
    const notificationTitle = title || `${operation || 'Operation'} failed`;

    if (classification.severity === 'critical' || classification.severity === 'high') {
      pushError(notificationTitle, message, undefined, businessId);
    } else {
      pushWarning(notificationTitle, message, undefined, businessId);
    }
  }

  // Report to Sentry if needed (the logger handles this automatically for error/fatal levels)
  // The `report` flag is used by the classification to determine if Sentry should be notified
  // Since the logger already reports error/fatal levels, we don't need to do anything extra here

  return classification;
}

// ── Async operation wrapper ──────────────────────────────────────────────────

/**
 * Wrap an async operation with consistent error handling.
 *
 * @example
 * const result = await withErrorHandling(
 *   () => createInvoice(data),
 *   {
 *     module: 'InvoicePage',
 *     operation: 'createInvoice',
 *     businessId: currentBusiness?.id,
 *   }
 * );
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options: HandleErrorOptions,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    handleError(error, options);
    return null;
  }
}

// ── Retry logic ──────────────────────────────────────────────────────────────

export interface RetryOptions extends HandleErrorOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxAttempts?: number;
  /** Initial delay between retries in ms (default: 1000). */
  initialDelay?: number;
  /** Multiplier for exponential backoff (default: 2). */
  backoffMultiplier?: number;
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @example
 * const result = await withRetry(
 *   () => fetchFromAPI('/data'),
 *   {
 *     module: 'DataService',
 *     operation: 'fetchData',
 *     maxAttempts: 3,
 *   }
 * );
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T | null> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    backoffMultiplier = 2,
    ...errorOptions
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const classification = classifyError(error);

      // Don't retry if the error shouldn't be retried
      if (!classification.shouldRetry) {
        handleError(error, errorOptions);
        return null;
      }

      // Log the retry attempt
      log.warn(
        `Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms`,
        {
          module: errorOptions.module,
          operation: errorOptions.operation,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      // Wait before retrying
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= backoffMultiplier;
      }
    }
  }

  // All attempts failed
  handleError(lastError, {
    ...errorOptions,
    userMessage: `Operation failed after ${maxAttempts} attempts. Please try again later.`,
  });

  return null;
}

// ── Error message extraction ─────────────────────────────────────────────────

/**
 * Extract a user-friendly message from any error type.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof RepositoryError) {
    return error.message;
  }

  if (error instanceof Error) {
    // Clean up common error messages
    const message = error.message;

    // Network errors
    if (message.includes('Failed to fetch')) {
      return 'Network error. Please check your connection.';
    }

    if (message.includes('timeout')) {
      return 'Request timed out. Please try again.';
    }

    return message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred.';
}
