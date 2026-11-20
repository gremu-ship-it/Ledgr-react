import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import { JOURNAL_COMMAND_ERROR_KEYS, journalCommandErrorKind, journalCommandErrorMessage } from '@/lib/journalCommandErrors';

/** Minimal `t` that resolves the English locale, so the assertions below check
 *  real copy rather than a mock's echo. */
function t(key: string, options?: Record<string, unknown>): string {
  let value: unknown = en;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return key;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
}

const commandError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('journal command error copy', () => {
  it('classifies a closed period and returns the translated instruction', () => {
    const error = commandError(
      '22023',
      'period-closed: Journal entry dated 2026-08-31 falls in the closed period "FY2025" (2025-01-01 to 2025-12-31).',
    );
    expect(journalCommandErrorKind(error)).toBe('periodClosed');
    expect(journalCommandErrorMessage(error, t)).toBe(t('journal.errors.periodClosed'));
    expect(journalCommandErrorMessage(error, t)).toMatch(/closed accounting period/i);
  });

  it('classifies an unbalanced entry', () => {
    const error = commandError('22023', 'Unbalanced journal entry: debits (100.00) must equal credits (60.00) and be greater than zero.');
    expect(journalCommandErrorKind(error)).toBe('unbalanced');
    expect(journalCommandErrorMessage(error, t)).toMatch(/does not balance/i);
  });

  it('classifies the draft-only rule and a missing entry', () => {
    expect(journalCommandErrorKind(commandError('22023',
      "Cannot post journal entry je-1: current status is 'posted'. Only 'draft' entries may be posted."))).toBe('alreadyPosted');
    expect(journalCommandErrorKind(commandError('22023', 'Journal entry je-1 was not found.'))).toBe('notFound');
  });

  it('classifies authority refusals, including a raw row-level security denial', () => {
    expect(journalCommandErrorKind(commandError('42501',
      'Not authorised to post financial journals for this business.'))).toBe('unauthorized');
    expect(journalCommandErrorKind(commandError('42501',
      'new row violates row-level security policy for table "journal_entries"'))).toBe('unauthorized');
  });

  it('follows a wrapped cause, because services rethrow repository errors', () => {
    const wrapped = new Error('Saving the share issue failed', {
      cause: commandError('22023', 'period-closed: Journal entry dated 2026-08-31 falls in the closed period "FY2025".'),
    });
    expect(journalCommandErrorKind(wrapped)).toBe('periodClosed');
  });

  it('never hides an unclassified failure behind the generic sentence', () => {
    const error = new Error('Network request failed');
    expect(journalCommandErrorKind(error)).toBeNull();
    expect(journalCommandErrorMessage(error, t)).toBe(
      'The journal could not be posted: Network request failed',
    );
  });

  it('maps every kind to a key that exists in the English locale', () => {
    for (const key of Object.values(JOURNAL_COMMAND_ERROR_KEYS)) {
      expect(t(key), `${key} must be translated`).not.toBe(key);
    }
    expect(t('journal.errors.failed', { reason: 'boom' })).toBe('The journal could not be posted: boom');
  });
});
