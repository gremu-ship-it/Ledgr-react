export abstract class RepositoryError extends Error {
  public readonly resource: string;
  public override readonly cause?: unknown;
  constructor(message: string, resource: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.resource = resource;
    this.cause = cause;
  }
}
export class NotFoundError extends RepositoryError {
  constructor(resource: string, id: string, cause?: unknown) {
    super(
      // Under RLS a row the caller may not read comes back as zero rows, not
      // as an error, so this message covers both "absent" and "forbidden".
      // Say so, rather than sending people to look for a row that is present.
      `${resource} with id "${id}" was not found, or you do not have permission to view it.`,
      resource,
      cause,
    );
  }
}
export class ValidationError extends RepositoryError {
  constructor(
    resource: string,
    message: string,
    cause?: unknown,
    options?: { includeResource?: boolean },
  ) {
    super(
      options?.includeResource === false ? message : `Validation failed for ${resource}: ${message}`,
      resource,
      cause,
    );
  }
}

/** The concise message shown when the server refuses an outbound stock movement. */
export const INSUFFICIENT_STOCK_MESSAGE = 'Not enough stock is available for this sale or transfer.';

/**
 * A stock denial is still a validation error, but database constraint names
 * and failing-row values are implementation details, not useful instructions
 * for a till or warehouse user.
 */
export class InsufficientStockError extends ValidationError {
  constructor(resource: string, cause?: unknown) {
    super(resource, INSUFFICIENT_STOCK_MESSAGE, cause, { includeResource: false });
  }
}

const STOCK_ON_HAND_CONSTRAINT = 'chk_inventory_balances_on_hand_nonneg';

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  cause?: unknown;
};

/**
 * Recognise the stock invariant even when a service has wrapped the original
 * PostgREST error in another Error. The original object remains available as
 * `cause` for logging and diagnostics; only the user-facing text is reduced.
 */
export function isInsufficientStockError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);

    if (current instanceof InsufficientStockError) return true;
    if (typeof current === 'string') {
      return current.includes(STOCK_ON_HAND_CONSTRAINT);
    }
    if (typeof current !== 'object') return false;

    const candidate = current as ErrorLike;
    const text = [candidate.message, candidate.details, candidate.hint]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
    const code = typeof candidate.code === 'string' ? candidate.code : null;

    if (text.includes(STOCK_ON_HAND_CONSTRAINT) && (!code || code === '23514')) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

export class UnauthorizedError extends RepositoryError {
  constructor(resource: string, message = 'Not authorized.', cause?: unknown) {
    super(`${resource}: ${message}`, resource, cause);
  }
}
export class DatabaseError extends RepositoryError {
  constructor(resource: string, message: string, cause?: unknown) {
    super(`Database error in ${resource}: ${message}`, resource, cause);
  }
}
/** Thrown when a method is not applicable for a given table (e.g. softDelete on append-only tables). */
export class UnsupportedOperationError extends RepositoryError {
  constructor(resource: string, operation: string) {
    super(`${operation}() is not supported on '${resource}'.`, resource);
  }
}
export function toRepositoryError(resource: string, error: unknown): RepositoryError {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const message = err?.message ?? 'Unknown error';
  const code = err?.code;
  if (code === '23514' && isInsufficientStockError(error)) {
    // Keep the raw PostgREST payload as `cause` for logs and support while
    // exposing only the action-relevant message to the user.
    return new InsufficientStockError(resource, error);
  }

  if (code === '23505' || code === '23503' || code === '23514')
    // PostgREST splits a constraint violation into message ("…violates check
    // constraint chk_…") and details ("Failing row contains (…)"). Preserve
    // both for constraints that do not have a dedicated user-facing message.
    return new ValidationError(
      resource,
      err?.details ? `${message} — ${err.details}` : message,
      error,
    );
  if (code === 'PGRST116') return new NotFoundError(resource, 'unknown', error);
  if (code === '42501' || code === 'PGRST301' || code === '401' || code === '403')
    return new UnauthorizedError(resource, message, error);
  return new DatabaseError(resource, message, error);
}
