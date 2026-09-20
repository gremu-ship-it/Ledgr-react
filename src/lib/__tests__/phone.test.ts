/**
 * Phone numbers are an identity, so the normaliser is a contract: the Edge
 * Function provisions an account under `phoneLoginEmail(number)` and the login
 * screen derives the same address months later from whatever the cashier types.
 * Any drift here silently locks staff out of their own accounts.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALLING_CODE,
  PHONE_LOGIN_EMAIL_DOMAIN,
  formatPhoneForDisplay,
  isPhoneLoginEmail,
  normalizePhone,
  phoneDigits,
  phoneLoginEmail,
  smsShareLink,
  whatsappShareLink,
} from '../phone';

describe('normalizePhone', () => {
  it('accepts the formats an owner actually types (Malawi default)', () => {
    const expected = '+265991234567';
    expect(normalizePhone('0991234567')).toBe(expected);
    expect(normalizePhone('0991 234 567')).toBe(expected);
    expect(normalizePhone('0991-234-567')).toBe(expected);
    expect(normalizePhone('+265991234567')).toBe(expected);
    expect(normalizePhone('+265 991 234 567')).toBe(expected);
    expect(normalizePhone('265991234567')).toBe(expected);
    expect(normalizePhone('991234567')).toBe(expected);
    expect(normalizePhone('00265991234567')).toBe(expected);
    expect(normalizePhone('  0991234567  ')).toBe(expected);
  });

  it('keeps an explicit foreign country code', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
    expect(normalizePhone('+27712345678', { defaultCallingCode: '27' })).toBe('+27712345678');
  });

  it('honours a different default calling code for local numbers', () => {
    expect(normalizePhone('0712345678', { defaultCallingCode: '27' })).toBe('+27712345678');
  });

  it('rejects input that cannot be a phone number', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone('not a number')).toBeNull();
    expect(normalizePhone('12345')).toBeNull(); // too short even after the calling code
    expect(normalizePhone('01234')).toBeNull();
    expect(normalizePhone('1'.repeat(16))).toBeNull(); // beyond E.164's 15 digits
  });

  it('never emits a leading zero', () => {
    const result = normalizePhone('00265991234567');
    expect(result?.startsWith('+0')).toBe(false);
  });
});

describe('phoneLoginEmail', () => {
  it('is deterministic — the login screen relies on deriving the same address', () => {
    expect(phoneLoginEmail('0991234567')).toBe(`265991234567@${PHONE_LOGIN_EMAIL_DOMAIN}`);
    expect(phoneLoginEmail('0991234567')).toBe(phoneLoginEmail('+265 991 234 567'));
  });

  it('returns null for an unusable number', () => {
    expect(phoneLoginEmail('123')).toBeNull();
  });

  it('produces an address isPhoneLoginEmail recognises', () => {
    const email = phoneLoginEmail('0991234567');
    expect(isPhoneLoginEmail(email)).toBe(true);
  });
});

describe('isPhoneLoginEmail', () => {
  it('is false for ordinary addresses and look-alikes', () => {
    expect(isPhoneLoginEmail('owner@ledgr.app')).toBe(false);
    expect(isPhoneLoginEmail('john@gmail.com')).toBe(false);
    expect(isPhoneLoginEmail(`abc@${PHONE_LOGIN_EMAIL_DOMAIN}`)).toBe(false); // local part not digits
    expect(isPhoneLoginEmail('265991234567@phone.ledgr.app.evil.com')).toBe(false);
    expect(isPhoneLoginEmail(null)).toBe(false);
    expect(isPhoneLoginEmail('')).toBe(false);
  });
});

describe('formatPhoneForDisplay', () => {
  it('groups a Malawi number for reading', () => {
    expect(formatPhoneForDisplay('0991234567')).toBe('+265 991 234 567');
  });

  it('falls back to the raw input when it cannot be normalised', () => {
    expect(formatPhoneForDisplay('n/a')).toBe('n/a');
  });
});

describe('share links', () => {
  it('builds a WhatsApp link the owner can send from their own phone', () => {
    expect(whatsappShareLink('0991234567', 'Join Ledgr')).toBe(
      'https://wa.me/265991234567?text=Join%20Ledgr',
    );
  });

  it('builds an sms: link for feature phones', () => {
    expect(smsShareLink('0991234567', 'Join Ledgr')).toBe('sms:+265991234567?body=Join%20Ledgr');
  });

  it('returns null instead of a broken link for a bad number', () => {
    expect(whatsappShareLink('nope', 'x')).toBeNull();
    expect(smsShareLink('nope', 'x')).toBeNull();
  });
});

describe('constants', () => {
  it('defaults to Malawi', () => {
    expect(DEFAULT_CALLING_CODE).toBe('265');
    expect(phoneDigits('+265991234567')).toBe('265991234567');
  });
});
