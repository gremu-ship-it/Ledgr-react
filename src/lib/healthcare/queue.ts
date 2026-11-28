/**
 * Reception queue token helpers.
 *
 * Tokens are short, human-readable and reset each visit day: Q-001, Q-042.
 * Both the hospital check-in service and the legacy clinic check-in allocate
 * from this module so a patient never receives two different token formats.
 */

/** Reception queue token: Q-001, Q-042, Q-100. */
export function formatQueueToken(sequence: number): string {
  const safe = Number.isFinite(sequence) ? Math.max(1, Math.trunc(sequence)) : 1;
  return `Q-${String(safe).padStart(3, '0')}`;
}

/** Numeric part of a queue token, or null when the token is malformed. */
export function parseQueueToken(token: string | null | undefined): number | null {
  if (!token) return null;
  const match = /^Q-(\d{3,})$/.exec(token.trim().toUpperCase());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Highest token sequence in a PostgREST result (object, array or null). */
export function maxQueueSequence(rows: unknown): number {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return list.reduce((max, row) => {
    const token =
      row && typeof row === 'object'
        ? (row as { queue_token?: string | null }).queue_token
        : null;
    const parsed = parseQueueToken(token);
    return parsed !== null && parsed > max ? parsed : max;
  }, 0);
}

/** Next token from the rows already issued today. */
export function nextQueueToken(rows: unknown): string {
  return formatQueueToken(maxQueueSequence(rows) + 1);
}
