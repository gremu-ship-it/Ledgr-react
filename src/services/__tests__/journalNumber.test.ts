import { describe, it, expect } from 'vitest';
import {
  composeJournalEntryNumber,
  formatFallbackJournalNumber,
} from '@/services/journalNumber';

describe('composeJournalEntryNumber', () => {
  it('returns the base number when no suffix is given', () => {
    expect(composeJournalEntryNumber('JNL-20260822-000001')).toBe('JNL-20260822-000001');
  });

  it('appends a clean suffix with a single hyphen', () => {
    expect(composeJournalEntryNumber('JNL-20260822-000001', 'COGS')).toBe(
      'JNL-20260822-000001-COGS',
    );
  });

  it('strips a leading hyphen on the suffix so callers can pass -CAP1', () => {
    expect(composeJournalEntryNumber('JNL-20260822-000001', '-CAP1')).toBe(
      'JNL-20260822-000001-CAP1',
    );
  });
});

describe('formatFallbackJournalNumber', () => {
  it('uses the JNL-YYYYMMDDHHMMSS shape as a last-resort fallback', () => {
    const stamped = formatFallbackJournalNumber(new Date(Date.UTC(2026, 7, 22, 13, 5, 9)));
    expect(stamped).toMatch(/^JNL-\d{14}$/);
  });
});
