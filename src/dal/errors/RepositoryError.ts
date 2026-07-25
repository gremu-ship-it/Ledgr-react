export abstract class RepositoryError extends Error {
  public readonly resource: string;
  public readonly cause?: any;
  constructor(message: string, resource: string, cause?: any) {
    super(message);
    this.name = this.constructor.name;
    this.resource = resource;
    this.cause = cause;
  }
}
export class NotFoundError extends RepositoryError {
  constructor(resource: string, id: string, cause?: any) {
    super(`${resource} with id "${id}" was not found.`, resource, cause);
  }
}
export class ValidationError extends RepositoryError {
  constructor(resource: string, message: string, cause?: any) {
    super(`Validation failed for ${resource}: ${message}`, resource, cause);
  }
}
export class UnauthorizedError extends RepositoryError {
  constructor(resource: string, message = 'Not authorized.', cause?: any) {
    super(`${resource}: ${message}`, resource, cause);
  }
}
export class DatabaseError extends RepositoryError {
  constructor(resource: string, message: string, cause?: any) {
    super(`Database error in ${resource}: ${message}`, resource, cause);
  }
}
/** Thrown when a method is not applicable for a given table (e.g. softDelete on append-only tables). */
export class UnsupportedOperationError extends RepositoryError {
  constructor(resource: string, operation: string) {
    super(`${operation}() is not supported on '${resource}'.`, resource);
  }
}
export function toRepositoryError(resource: string, error: any): RepositoryError {
  const err = error as { code?: string; message?: string; details?: string } | null;
  const message = err?.message ?? 'Unknown error';
  const code = err?.code;
  if (code === '23505' || code === '23503' || code === '23514')
    return new ValidationError(resource, err?.details ?? message, error);
  if (code === 'PGRST116') return new NotFoundError(resource, 'unknown', error);
  if (code === '42501' || code === 'PGRST301' || code === '401' || code === '403')
    return new UnauthorizedError(resource, message, error);
  return new DatabaseError(resource, message, error);
}