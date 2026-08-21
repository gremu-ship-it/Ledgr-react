/**
 * Phase 10.4 — minimal circuit breaker for the gateway's upstream proxy.
 *
 * Kept as a tiny standalone module (the server package cannot import from
 * the React app's src/lib). Semantics mirror src/lib/resilience.ts in the
 * app: after `failureThreshold` consecutive failures the breaker opens and
 * calls fail fast with a CircuitOpenError; after `resetTimeoutMs` a single
 * probe is allowed through (half-open); success closes, failure re-opens.
 */

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open — downstream unavailable, failing fast');
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;

  constructor(
    private readonly options: {
      failureThreshold: number;
      resetTimeoutMs: number;
      halfOpenMaxInFlight?: number;
    },
  ) {}

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
