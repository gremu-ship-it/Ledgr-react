/**
 * Phase 10.4 — small resilience primitives: timeouts and a circuit breaker.
 *
 * These are intentionally dependency-free and hand-rolled (no cockatiel):
 * the codebase has no runtime deps for this and the semantics needed are
 * tiny. Wire them around slow/failure-prone outbound calls (AI agent,
 * webhook dispatch, gateway upstream) so a stuck downstream cannot pile up
 * work or take the whole request path with it.
 */

/** Reject `promise` if it does not settle within `ms`. The underlying work
 * keeps running (no cancellation) but the caller stops waiting. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker open. */
  failureThreshold: number;
  /** Milliseconds the breaker stays open before a half-open probe. */
  resetTimeoutMs: number;
  /** Max in-flight calls while half-open (default 1 = single probe). */
  halfOpenMaxInFlight?: number;
}

type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * Minimal circuit breaker. While open, calls fail fast with a
 * CircuitOpenError instead of hitting the downstream; after resetTimeoutMs a
 * single probe is let through; success closes it, failure re-opens it.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  get currentState(): BreakerState {
    return this.state;
  }

  get failureCount(): number {
    return this.consecutiveFailures;
  }

  /** Call `fn` guarded by the breaker. Throws CircuitOpenError when open. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new CircuitOpenError();
      }
    }

    if (this.state === 'half-open') {
      const max = this.options.halfOpenMaxInFlight ?? 1;
      if (this.halfOpenInFlight >= max) throw new CircuitOpenError();
      this.halfOpenInFlight += 1;
      try {
        const result = await fn();
        this.halfOpenInFlight -= 1;
        this.reset();
        return result;
      } catch (err) {
        this.halfOpenInFlight -= 1;
        this.trip();
        throw err;
      }
    }

    try {
      const result = await fn();
      this.consecutiveFailures = 0;
      return result;
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.options.failureThreshold) this.trip();
      throw err;
    }
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = Date.now();
  }

  private reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open — downstream unavailable, failing fast');
    this.name = 'CircuitOpenError';
  }
}
