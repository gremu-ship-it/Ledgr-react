/**
 * User-facing copy for journal command failures.
 *
 * `post_financial_journal` / `post_draft_financial_journal` reject a request with
 * a SQLSTATE and a sentence written for an accountant: "period-closed: Journal
 * entry dated … falls in the closed period …". That sentence is useful in a log
 * and unhelpful in a dialog, so the repository turns it into a ValidationError
 * and this module maps the *reason* to a translated instruction.
 *
 * The mapping is by reason rather than by message because the server text
 * carries values (period name, dates, amounts) that must not be duplicated in
 * five locales.
 */

export type JournalCommandErrorKind =
  | 'unbalanced'
  | 'periodClosed'
  | 'unauthorized'
  | 'alreadyPosted'
  | 'notFound';

export const JOURNAL_COMMAND_ERROR_KEYS: Record<JournalCommandErrorKind, string> = {
  unbalanced: 'journal.errors.unbalanced',
  periodClosed: 'journal.errors.periodClosed',
  unauthorized: 'journal.errors.unauthorized',
  alreadyPosted: 'journal.errors.alreadyPosted',
  notFound: 'journal.errors.notFound',
};

/** Ordered: the first matching rule wins. */
const RULES: Array<[JournalCommandErrorKind, RegExp]> = [
  ['periodClosed', /period-closed|closed period|period .*is closed/i],
  ['unbalanced', /unbalanced|does not balance|debits .* credits/i],
  ['alreadyPosted', /only '?draft'? entries|current status is/i],
  ['notFound', /was not found|no journal entry/i],
  ['unauthorized', /not authori[sz]ed|permission|row-level security|insufficient privileges/i],
];

type ErrorLike = { message?: unknown; code?: unknown; cause?: unknown };

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as ErrorLike).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

/**
 * Classify a journal command failure. `cause` is followed one level deep because
 * a service may wrap the repository's error while keeping the original.
 */
export function journalCommandErrorKind(error: unknown): JournalCommandErrorKind | null {
  const texts = [messageOf(error)];
  const cause = error && typeof error === 'object' ? (error as ErrorLike).cause : undefined;
  if (cause) texts.push(messageOf(cause));

  for (const text of texts) {
    if (!text) continue;
    for (const [kind, pattern] of RULES) {
      if (pattern.test(text)) return kind;
    }
  }
  return null;
}

/**
 * Translated, action-oriented message for a journal command failure.
 *
 * Falls back to the original message so an unclassified failure is never hidden
 * behind a generic sentence.
 */
export function journalCommandErrorMessage(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const kind = journalCommandErrorKind(error);
  if (kind) return t(JOURNAL_COMMAND_ERROR_KEYS[kind]);

  const detail = messageOf(error).trim();
  return detail
    ? t('journal.errors.failed', { reason: detail })
    : t('journal.errors.failed', { reason: 'unknown error' });
}
