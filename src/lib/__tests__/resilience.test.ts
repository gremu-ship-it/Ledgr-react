import { describe, it, expect, vi } from 'vitest';
import { withTimeout, CircuitBreaker, CircuitOpenError } from '@/lib/resilience';

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('rejects with a timeout error when the promise is too slow', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve(1), 200));
    await expect(withTimeout(slow, 20, 'test')).rejects.toThrow('test timed out after 20ms');
  });

  it('propagates the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('CircuitBreaker', () => {
  it('passes through while healthy', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    await expect(breaker.run(async () => 1)).resolves.toBe(1);
    await expect(breaker.run(async () => 2)).resolves.toBe(2);
    expect(breaker.currentState).toBe('closed');
  });

  it('trips open after failureThreshold failures and fails fast', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    const fn = vi.fn(async () => { throw new Error('downstream'); });
    await expect(breaker.run(fn)).rejects.toThrow('downstream');
    await expect(breaker.run(fn)).rejects.toThrow('downstream');
    expect(breaker.currentState).toBe('open');
    await expect(breaker.run(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(2); // third call never reached the fn
  });

  it('recovers via half-open probe after the reset window', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30 });
    await expect(breaker.run(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(breaker.currentState).toBe('open');
    await new Promise((r) => setTimeout(r, 40));
    // probe succeeds → closed again
    await expect(breaker.run(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });

  it('re-opens when the half-open probe fails', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 20 });
    await expect(breaker.run(async () => { throw new Error('x'); })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 30));
    await expect(breaker.run(async () => { throw new Error('still down'); })).rejects.toThrow('still down');
    expect(breaker.currentState).toBe('open');
    await expect(breaker.run(async () => 'nope')).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('resets the failure count on success', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    await expect(breaker.run(async () => { throw new Error('x'); })).rejects.toThrow();
    await expect(breaker.run(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.failureCount).toBe(0);
    expect(breaker.currentState).toBe('closed');
  });
});
