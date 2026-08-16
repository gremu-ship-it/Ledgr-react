import { describe, it, expect } from 'vitest';
import { isMissingAccountError } from '@/lib/journalErrors';

describe('isMissingAccountError (Phase 10 A-02)', () => {
  it('recognises the exact getAccountByCode "missing" message', () => {
    const err = new Error(
      'Account 4130 not found. Please ensure your Chart of Accounts is set up.',
    );
    expect(isMissingAccountError(err)).toBe(true);
  });

  it('recognises a plain missing-account message for any account code', () => {
    expect(isMissingAccountError(new Error('Account 5175 not found'))).toBe(true);
    expect(isMissingAccountError(new Error('account 4260 not found.'))).toBe(true);
  });

  it('returns false for unrelated errors (network/RLS/DB)', () => {
    expect(isMissingAccountError(new Error('NetworkError when attempting to fetch resource.'))).toBe(false);
    expect(isMissingAccountError(new Error('permission denied for table accounts'))).toBe(false);
    expect(isMissingAccountError(new Error('relation "accounts" does not exist'))).toBe(false);
    expect(isMissingAccountError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isMissingAccountError(null)).toBe(false);
    expect(isMissingAccountError(undefined)).toBe(false);
    expect(isMissingAccountError('Account 4130 not found')).toBe(false);
    expect(isMissingAccountError({ message: 'Account 4130 not found' })).toBe(false);
  });
});
