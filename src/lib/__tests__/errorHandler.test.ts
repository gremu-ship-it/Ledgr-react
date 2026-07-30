import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyError, getErrorMessage, withRetry } from '../errorHandler';
import { NotFoundError, ValidationError, UnauthorizedError, DatabaseError } from '@/dal/errors/RepositoryError';

// Mock pushError and pushWarning from notifications
vi.mock('@/lib/notifications', () => ({
  pushError: vi.fn(),
  pushWarning: vi.fn(),
}));

// Mock the logger to prevent console output
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  }),
}));

describe('classifyError', () => {
  it('should classify NotFoundError as low severity', () => {
    const err = new NotFoundError('invoices', '123');
    const classification = classifyError(err);
    expect(classification.severity).toBe('low');
    expect(classification.category).toBe('not_found');
    expect(classification.shouldNotify).toBe(true);
    expect(classification.shouldReport).toBe(false);
  });

  it('should classify ValidationError as low severity', () => {
    const err = new ValidationError('invoices', 'amount is required');
    const classification = classifyError(err);
    expect(classification.severity).toBe('low');
    expect(classification.category).toBe('validation');
    expect(classification.shouldNotify).toBe(true);
    expect(classification.shouldReport).toBe(false);
  });

  it('should classify UnauthorizedError as medium severity', () => {
    const err = new UnauthorizedError('invoices');
    const classification = classifyError(err);
    expect(classification.severity).toBe('medium');
    expect(classification.category).toBe('unauthorized');
    expect(classification.shouldNotify).toBe(true);
  });

  it('should classify DatabaseError as high severity with retry', () => {
    const err = new DatabaseError('invoices', 'connection failed');
    const classification = classifyError(err);
    expect(classification.severity).toBe('high');
    expect(classification.category).toBe('database');
    expect(classification.shouldRetry).toBe(true);
    expect(classification.shouldReport).toBe(true);
  });

  it('should classify unknown errors as high severity', () => {
    const err = new Error('something weird');
    const classification = classifyError(err);
    expect(classification.severity).toBe('high');
    expect(classification.category).toBe('unknown');
    expect(classification.shouldReport).toBe(true);
  });

  it('should classify network errors as medium severity with retry', () => {
    const err = new TypeError('fetch failed: network timeout');
    const classification = classifyError(err);
    // Note: "Failed to fetch" is caught by isChunkLoadError first, so we use
    // a different network error message that still contains "fetch"
    expect(classification.severity).toBe('medium');
    expect(classification.category).toBe('network');
    expect(classification.shouldRetry).toBe(true);
  });
});

describe('getErrorMessage', () => {
  it('should extract message from RepositoryError', () => {
    const err = new NotFoundError('invoices', '123');
    const message = getErrorMessage(err);
    expect(message).toContain('not found');
  });

  it('should handle network errors gracefully', () => {
    const err = new Error('Failed to fetch');
    const message = getErrorMessage(err);
    expect(message).toContain('Network error');
  });

  it('should handle string errors', () => {
    const message = getErrorMessage('something went wrong');
    expect(message).toBe('something went wrong');
  });

  it('should handle unknown error types', () => {
    const message = getErrorMessage(42);
    expect(message).toBe('An unexpected error occurred.');
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const result = await withRetry(operation, { module: 'Test', operation: 'test' });
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should not retry non-retryable errors', async () => {
    const err = new ValidationError('invoices', 'bad data');
    const operation = vi.fn().mockRejectedValue(err);
    const result = await withRetry(operation, { module: 'Test', operation: 'test' });
    expect(result).toBeNull();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
